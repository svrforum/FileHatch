package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// TrashItem represents an item in the trash
type TrashItem struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	OriginalPath string    `json:"originalPath"`
	Size         int64     `json:"size"`
	IsDir        bool      `json:"isDir"`
	DeletedAt    time.Time `json:"deletedAt"`
}

// getTrashPath returns the trash directory path for a user
func (h *Handler) getTrashPath(username string) string {
	return filepath.Join(h.dataRoot, "trash", username)
}

// getTrashMetaPath returns the trash metadata file path
func (h *Handler) getTrashMetaPath(username string) string {
	return filepath.Join(h.dataRoot, "trash", username, ".trash_meta.json")
}

// loadTrashMeta loads the trash metadata
func (h *Handler) loadTrashMeta(username string) (map[string]TrashItem, error) {
	metaPath := h.getTrashMetaPath(username)
	data, err := os.ReadFile(metaPath)
	if err != nil {
		if os.IsNotExist(err) {
			return make(map[string]TrashItem), nil
		}
		return nil, err
	}

	var items map[string]TrashItem
	if err := json.Unmarshal(data, &items); err != nil {
		return make(map[string]TrashItem), nil
	}
	return items, nil
}

// saveTrashMeta saves the trash metadata
func (h *Handler) saveTrashMeta(username string, items map[string]TrashItem) error {
	metaPath := h.getTrashMetaPath(username)
	data, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(metaPath, data, 0644)
}

// syncSMBTrash synchronizes SMB-deleted files (via vfs_recycle) with web UI trash metadata
// SMB recycle module puts files in /data/trash/{username}/.smb/ with directory structure preserved
func (h *Handler) syncSMBTrash(username string) {
	trashPath := h.getTrashPath(username)
	smbTrashPath := filepath.Join(trashPath, ".smb")

	// Create trash directory if it doesn't exist
	if err := os.MkdirAll(trashPath, 0755); err != nil {
		return
	}

	// Check if SMB trash directory exists
	if _, err := os.Stat(smbTrashPath); os.IsNotExist(err) {
		return
	}

	// Load existing metadata
	meta, err := h.loadTrashMeta(username)
	if err != nil {
		meta = make(map[string]TrashItem)
	}

	// Build a set of known trash IDs
	knownIDs := make(map[string]bool)
	for id := range meta {
		knownIDs[id] = true
	}

	modified := false

	// Walk through SMB trash directory recursively
	err = filepath.Walk(smbTrashPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}

		// Skip the root .smb directory itself
		if path == smbTrashPath {
			return nil
		}

		// Skip directories (we only track files, directories are implicit)
		if info.IsDir() {
			return nil
		}

		// Get relative path from .smb directory
		relPath, err := filepath.Rel(smbTrashPath, path)
		if err != nil {
			return nil
		}

		// Generate unique trash ID using timestamp and relative path
		trashID := fmt.Sprintf("smb_%d_%s", info.ModTime().UnixNano(), strings.ReplaceAll(relPath, "/", "_"))

		// Check if already tracked
		if knownIDs[trashID] {
			return nil
		}

		// Also check if any existing entry has the same SMB path
		alreadyTracked := false
		for _, item := range meta {
			if strings.HasPrefix(item.ID, "smb_") && item.OriginalPath == "/home/"+relPath {
				alreadyTracked = true
				break
			}
		}
		if alreadyTracked {
			return nil
		}

		// Extract original filename (remove version suffix like "Copy #2 of file.txt")
		fileName := info.Name()
		originalName := fileName
		if strings.HasPrefix(fileName, "Copy #") {
			// Format: "Copy #N of filename.ext"
			if idx := strings.Index(fileName, " of "); idx > 0 {
				originalName = fileName[idx+4:]
			}
		}

		// Build original path: /home/relative/path/to/file.txt
		originalPath := "/home/" + relPath

		meta[trashID] = TrashItem{
			ID:           trashID,
			Name:         originalName,
			OriginalPath: originalPath,
			Size:         info.Size(),
			IsDir:        false,
			DeletedAt:    info.ModTime(),
		}
		knownIDs[trashID] = true
		modified = true

		return nil
	})

	if err != nil {
		return
	}

	// Save updated metadata
	if modified {
		_ = h.saveTrashMeta(username, meta)
	}
}

// cleanupEmptySMBDirs removes empty parent directories after restoring SMB files
func (h *Handler) cleanupEmptySMBDirs(username string, restoredPath string) {
	smbTrashPath := filepath.Join(h.getTrashPath(username), ".smb")

	// Walk up the directory tree and remove empty directories
	dir := filepath.Dir(restoredPath)
	for dir != smbTrashPath && strings.HasPrefix(dir, smbTrashPath) {
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) > 0 {
			break
		}
		if err := os.Remove(dir); err != nil {
			break
		}
		dir = filepath.Dir(dir)
	}
}

// MoveToTrash moves a file or folder to trash instead of deleting permanently
// @Summary		Move to trash
// @Description	Move a file or folder to the user's trash (soft delete)
// @Tags		Trash
// @Accept		json
// @Produce		json
// @Param		path	path		string	true	"Item path to move to trash"
// @Success		200		{object}	docs.SuccessResponse	"Item moved to trash"
// @Failure		400		{object}	docs.ErrorResponse	"Bad request"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		403		{object}	docs.ErrorResponse	"Forbidden"
// @Failure		404		{object}	docs.ErrorResponse	"Item not found"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/trash/{path} [post]
func (h *Handler) MoveToTrash(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	// URL decode the path in case browser didn't encode special characters
	if decodedPath, err := url.QueryUnescape(requestPath); err == nil {
		requestPath = decodedPath
	}

	// Get user claims - required for trash
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	// Resolve path
	realPath, storageType, displayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}

	if storageType == "root" || displayPath == "/home" || displayPath == "/shared" {
		return RespondError(c, ErrForbidden("Cannot delete root folders"))
	}

	// Check if source exists
	info, err := os.Stat(realPath)
	if err != nil {
		if os.IsNotExist(err) {
			return RespondError(c, ErrNotFound("Item"))
		}
		return RespondError(c, ErrOperationFailed("access item", err))
	}

	// Create trash directory
	trashPath := h.getTrashPath(claims.Username)
	if err := os.MkdirAll(trashPath, 0755); err != nil {
		return RespondError(c, ErrOperationFailed("create trash directory", err))
	}

	// Generate unique ID for trash item
	trashID := fmt.Sprintf("%d_%s", time.Now().UnixNano(), info.Name())
	trashItemPath := filepath.Join(trashPath, trashID)

	// Move to trash
	if err := os.Rename(realPath, trashItemPath); err != nil {
		return RespondError(c, ErrOperationFailed("move to trash", err))
	}

	// Calculate size
	var size int64
	if info.IsDir() {
		size, _ = h.calculateDirSize(trashItemPath)
	} else {
		size = info.Size()
	}

	// Update trash metadata
	meta, _ := h.loadTrashMeta(claims.Username)
	meta[trashID] = TrashItem{
		ID:           trashID,
		Name:         info.Name(),
		OriginalPath: displayPath,
		Size:         size,
		IsDir:        info.IsDir(),
		DeletedAt:    time.Now(),
	}
	_ = h.saveTrashMeta(claims.Username, meta)

	// Log audit event
	_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), EventFileDelete, displayPath, map[string]interface{}{
		"isDir":   info.IsDir(),
		"size":    size,
		"trashId": trashID,
	})

	// Update storage tracking: move from home to trash
	if err := h.UpdateStorageForMove(claims.UserID, size, true); err != nil {
		fmt.Printf("[Storage] Failed to update storage for %s: %v\n", claims.Username, err)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"path":    displayPath,
		"trashId": trashID,
	})
}

// ListTrash lists items in the user's trash
// @Summary		List trash items
// @Description	Get all items in the user's trash, sorted by deletion time (newest first)
// @Tags		Trash
// @Accept		json
// @Produce		json
// @Success		200		{object}	docs.SuccessResponse{data=docs.TrashListResponse}	"List of trash items"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/trash [get]
func (h *Handler) ListTrash(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	// Sync SMB trash items (files added by Samba vfs_recycle)
	h.syncSMBTrash(claims.Username)

	meta, err := h.loadTrashMeta(claims.Username)
	if err != nil {
		return RespondError(c, ErrOperationFailed("load trash", err))
	}

	items := make([]TrashItem, 0, len(meta))
	var totalSize int64
	for _, item := range meta {
		items = append(items, item)
		totalSize += item.Size
	}

	// Sort by deleted time (newest first)
	sort.Slice(items, func(i, j int) bool {
		return items[i].DeletedAt.After(items[j].DeletedAt)
	})

	return c.JSON(http.StatusOK, map[string]interface{}{
		"items":     items,
		"total":     len(items),
		"totalSize": totalSize,
	})
}

// RestoreFromTrash restores an item from trash
// @Summary		Restore from trash
// @Description	Restore an item from trash to its original location
// @Tags		Trash
// @Accept		json
// @Produce		json
// @Param		id		path		string	true	"Trash item ID"
// @Success		200		{object}	docs.SuccessResponse	"Item restored successfully"
// @Failure		400		{object}	docs.ErrorResponse	"Bad request"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		404		{object}	docs.ErrorResponse	"Trash item not found"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/trash/restore/{id} [post]
func (h *Handler) RestoreFromTrash(c echo.Context) error {
	trashID := c.Param("id")
	if trashID == "" {
		return RespondError(c, ErrMissingParameter("id"))
	}

	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	meta, err := h.loadTrashMeta(claims.Username)
	if err != nil {
		return RespondError(c, ErrOperationFailed("load trash", err))
	}

	item, exists := meta[trashID]
	if !exists {
		return RespondError(c, ErrNotFound("Trash item"))
	}

	// Determine restore path and trash item location
	var realPath string
	var trashItemPath string
	restorePath := item.OriginalPath

	// Check if this is an SMB-deleted file (ID starts with "smb_")
	isSMBFile := strings.HasPrefix(trashID, "smb_")

	if isSMBFile {
		// SMB files are stored in .smb subdirectory with original path structure
		// originalPath is like "/home/folder/file.txt"
		// actual location is "/data/trash/{username}/.smb/folder/file.txt"
		relPath := strings.TrimPrefix(item.OriginalPath, "/home/")
		trashItemPath = filepath.Join(h.getTrashPath(claims.Username), ".smb", relPath)

		// Resolve destination path
		var err error
		realPath, _, _, err = h.resolvePath(item.OriginalPath, claims)
		if err != nil {
			return RespondError(c, ErrInvalidPath("Cannot restore to original location"))
		}
	} else {
		// Normal trash items
		trashItemPath = filepath.Join(h.getTrashPath(claims.Username), trashID)

		// Resolve original path
		var err error
		realPath, _, _, err = h.resolvePath(item.OriginalPath, claims)
		if err != nil {
			return RespondError(c, ErrInvalidPath("Cannot restore to original location"))
		}
	}

	// Check if destination already exists
	if _, err := os.Stat(realPath); err == nil {
		// Add suffix to avoid conflict
		ext := filepath.Ext(realPath)
		base := strings.TrimSuffix(realPath, ext)
		realPath = fmt.Sprintf("%s_restored_%d%s", base, time.Now().Unix(), ext)
		// Update restorePath to reflect the new name
		ext = filepath.Ext(restorePath)
		base = strings.TrimSuffix(restorePath, ext)
		restorePath = fmt.Sprintf("%s_restored_%d%s", base, time.Now().Unix(), ext)
	}

	// Ensure parent directory exists
	parentDir := filepath.Dir(realPath)
	if err := os.MkdirAll(parentDir, 0755); err != nil {
		return RespondError(c, ErrOperationFailed("create parent directory", err))
	}

	// Move back from trash
	if err := os.Rename(trashItemPath, realPath); err != nil {
		return RespondError(c, ErrOperationFailed("restore item", err))
	}

	// For SMB files, clean up empty parent directories in .smb
	if isSMBFile {
		h.cleanupEmptySMBDirs(claims.Username, trashItemPath)
	}

	// Update metadata
	delete(meta, trashID)
	_ = h.saveTrashMeta(claims.Username, meta)

	// Log restore event for recent files tracking
	_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "trash.restore", restorePath, map[string]interface{}{
		"trashId": trashID,
	})

	// Update storage tracking: move from trash back to home
	if err := h.UpdateStorageForMove(claims.UserID, item.Size, false); err != nil {
		fmt.Printf("[Storage] Failed to update storage for %s: %v\n", claims.Username, err)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":      true,
		"restoredPath": restorePath,
	})
}

// DeleteFromTrash permanently deletes an item from trash
// @Summary		Delete from trash
// @Description	Permanently delete an item from trash (irreversible)
// @Tags		Trash
// @Accept		json
// @Produce		json
// @Param		id		path		string	true	"Trash item ID"
// @Success		200		{object}	docs.SuccessResponse	"Item permanently deleted"
// @Failure		400		{object}	docs.ErrorResponse	"Bad request"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		404		{object}	docs.ErrorResponse	"Trash item not found"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/trash/{id} [delete]
func (h *Handler) DeleteFromTrash(c echo.Context) error {
	trashID := c.Param("id")
	if trashID == "" {
		return RespondError(c, ErrMissingParameter("id"))
	}

	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	meta, err := h.loadTrashMeta(claims.Username)
	if err != nil {
		return RespondError(c, ErrOperationFailed("load trash", err))
	}

	item, exists := meta[trashID]
	if !exists {
		return RespondError(c, ErrNotFound("Trash item"))
	}

	// Delete permanently
	trashItemPath := filepath.Join(h.getTrashPath(claims.Username), trashID)
	if err := os.RemoveAll(trashItemPath); err != nil {
		return RespondError(c, ErrOperationFailed("delete item", err))
	}

	// Update metadata
	delete(meta, trashID)
	_ = h.saveTrashMeta(claims.Username, meta)

	// Update storage tracking: decrease trash used
	if err := h.UpdateUserTrashStorage(claims.UserID, -item.Size); err != nil {
		fmt.Printf("[Storage] Failed to update storage for %s: %v\n", claims.Username, err)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
	})
}

// EmptyTrash permanently deletes all items from trash
// @Summary		Empty trash
// @Description	Permanently delete all items from trash (irreversible)
// @Tags		Trash
// @Accept		json
// @Produce		json
// @Success		200		{object}	docs.SuccessResponse	"Trash emptied"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/trash/empty [delete]
func (h *Handler) EmptyTrash(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	trashPath := h.getTrashPath(claims.Username)

	// Remove all contents
	if err := os.RemoveAll(trashPath); err != nil {
		return RespondError(c, ErrOperationFailed("empty trash", err))
	}

	// Recreate empty trash directory
	_ = os.MkdirAll(trashPath, 0755)

	// Update storage tracking: set trash to 0
	if _, err := h.db.Exec(`UPDATE users SET trash_used = 0, updated_at = NOW() WHERE id = $1`, claims.UserID); err != nil {
		fmt.Printf("[Storage] Failed to reset trash for %s: %v\n", claims.Username, err)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
	})
}

// TrashAutoCleanupConfig holds configuration for automatic trash cleanup
type TrashAutoCleanupConfig struct {
	RetentionDays int           // Number of days to keep items in trash (default: 30)
	CleanupPeriod time.Duration // How often to run cleanup (default: 24 hours)
}

// DefaultTrashCleanupConfig returns the default cleanup configuration
func DefaultTrashCleanupConfig() TrashAutoCleanupConfig {
	retentionDays := 30
	if sh := GetGlobalSettingsHandler(); sh != nil {
		retentionDays = sh.GetTrashRetentionDays()
	}
	return TrashAutoCleanupConfig{
		RetentionDays: retentionDays,
		CleanupPeriod: 24 * time.Hour,
	}
}

// StartTrashAutoCleanup starts the automatic trash cleanup background task
func (h *Handler) StartTrashAutoCleanup(config TrashAutoCleanupConfig) {
	go func() {
		// Get retention days from settings (may have been updated)
		retentionDays := config.RetentionDays
		if sh := GetGlobalSettingsHandler(); sh != nil {
			retentionDays = sh.GetTrashRetentionDays()
		}

		// Run immediately on startup
		h.runTrashCleanup(retentionDays)

		// Then run periodically
		ticker := time.NewTicker(config.CleanupPeriod)
		defer ticker.Stop()

		for range ticker.C {
			// Reload retention days from settings on each run
			currentRetention := config.RetentionDays
			if sh := GetGlobalSettingsHandler(); sh != nil {
				currentRetention = sh.GetTrashRetentionDays()
			}
			h.runTrashCleanup(currentRetention)
		}
	}()

	fmt.Printf("[Trash] Auto-cleanup started: items older than %d days will be deleted every %v\n",
		config.RetentionDays, config.CleanupPeriod)
}

// runTrashCleanup performs the actual cleanup of old trash items
func (h *Handler) runTrashCleanup(retentionDays int) {
	cutoffTime := time.Now().AddDate(0, 0, -retentionDays)

	// Get all users with trash folders
	trashRoot := filepath.Join(h.dataRoot, "trash")
	userDirs, err := os.ReadDir(trashRoot)
	if err != nil {
		// Trash directory might not exist yet, that's fine
		return
	}

	var totalCleaned int
	var totalSize int64

	for _, userDir := range userDirs {
		if !userDir.IsDir() {
			continue
		}

		username := userDir.Name()
		meta, err := h.loadTrashMeta(username)
		if err != nil {
			continue
		}

		var toDelete []string
		for trashID, item := range meta {
			if item.DeletedAt.Before(cutoffTime) {
				toDelete = append(toDelete, trashID)
				totalSize += item.Size
			}
		}

		// Delete expired items
		for _, trashID := range toDelete {
			trashItemPath := filepath.Join(h.getTrashPath(username), trashID)
			if err := os.RemoveAll(trashItemPath); err != nil {
				fmt.Printf("[Trash] Failed to delete expired item %s for user %s: %v\n",
					trashID, username, err)
				continue
			}
			delete(meta, trashID)
			totalCleaned++
		}

		// Save updated metadata
		if len(toDelete) > 0 {
			_ = h.saveTrashMeta(username, meta)
		}
	}

	if totalCleaned > 0 {
		fmt.Printf("[Trash] Auto-cleanup completed: deleted %d items (%.2f MB) older than %d days\n",
			totalCleaned, float64(totalSize)/(1024*1024), retentionDays)
	}
}

// MoveToTrashInternal moves a file to trash (internal use for WebDAV/SMB)
// This function is used by WebDAV RemoveAll to support trash functionality
func (h *Handler) MoveToTrashInternal(username, userID, virtualPath, realPath string) error {
	// 1. Check if file exists
	info, err := os.Stat(realPath)
	if err != nil {
		return err
	}

	// 2. Create trash directory
	trashPath := h.getTrashPath(username)
	if err := os.MkdirAll(trashPath, 0755); err != nil {
		return err
	}

	// 3. Generate unique ID and move to trash
	trashID := fmt.Sprintf("%d_%s", time.Now().UnixNano(), info.Name())
	trashItemPath := filepath.Join(trashPath, trashID)

	if err := os.Rename(realPath, trashItemPath); err != nil {
		return err
	}

	// 4. Calculate size
	var size int64
	if info.IsDir() {
		size, _ = h.calculateDirSize(trashItemPath)
	} else {
		size = info.Size()
	}

	// 5. Save metadata
	meta, _ := h.loadTrashMeta(username)
	meta[trashID] = TrashItem{
		ID:           trashID,
		Name:         info.Name(),
		OriginalPath: virtualPath,
		Size:         size,
		IsDir:        info.IsDir(),
		DeletedAt:    time.Now(),
	}
	_ = h.saveTrashMeta(username, meta)

	// 6. Update storage tracking
	_ = h.UpdateStorageForMove(userID, size, true)

	// 7. Log event
	_ = h.auditHandler.LogEvent(&userID, "", EventFileDelete, virtualPath, map[string]interface{}{
		"isDir":   info.IsDir(),
		"size":    size,
		"trashId": trashID,
		"source":  "webdav",
	})

	return nil
}

// GetTrashStats returns statistics about trash usage
// @Summary		Get trash statistics
// @Description	Get statistics about the user's trash including item count, total size, and retention info
// @Tags		Trash
// @Accept		json
// @Produce		json
// @Success		200		{object}	docs.SuccessResponse{data=docs.TrashStatsResponse}	"Trash statistics"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/trash/stats [get]
func (h *Handler) GetTrashStats(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	meta, err := h.loadTrashMeta(claims.Username)
	if err != nil {
		return RespondError(c, ErrOperationFailed("load trash", err))
	}

	var totalSize int64
	var oldestItem *time.Time
	var newestItem *time.Time

	for _, item := range meta {
		totalSize += item.Size
		if oldestItem == nil || item.DeletedAt.Before(*oldestItem) {
			oldestItem = &item.DeletedAt
		}
		if newestItem == nil || item.DeletedAt.After(*newestItem) {
			newestItem = &item.DeletedAt
		}
	}

	// Get retention days from settings
	retentionDays := 30
	if sh := GetGlobalSettingsHandler(); sh != nil {
		retentionDays = sh.GetTrashRetentionDays()
	}

	stats := map[string]interface{}{
		"itemCount":     len(meta),
		"totalSize":     totalSize,
		"retentionDays": retentionDays,
	}

	if oldestItem != nil {
		stats["oldestItem"] = oldestItem
		// Calculate days until auto-deletion for oldest item
		daysLeft := retentionDays - int(time.Since(*oldestItem).Hours()/24)
		if daysLeft < 0 {
			daysLeft = 0
		}
		stats["oldestItemDaysLeft"] = daysLeft
	}

	if newestItem != nil {
		stats["newestItem"] = newestItem
	}

	return c.JSON(http.StatusOK, stats)
}
