package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
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

// MoveToTrash moves a file or folder to trash instead of deleting permanently
func (h *Handler) MoveToTrash(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return RespondError(c, ErrMissingParameter("path"))
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
	h.saveTrashMeta(claims.Username, meta)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"path":    displayPath,
		"trashId": trashID,
	})
}

// ListTrash lists items in the user's trash
func (h *Handler) ListTrash(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	meta, err := h.loadTrashMeta(claims.Username)
	if err != nil {
		return RespondError(c, ErrOperationFailed("load trash", err))
	}

	items := make([]TrashItem, 0, len(meta))
	for _, item := range meta {
		items = append(items, item)
	}

	// Sort by deleted time (newest first)
	sort.Slice(items, func(i, j int) bool {
		return items[i].DeletedAt.After(items[j].DeletedAt)
	})

	return c.JSON(http.StatusOK, map[string]interface{}{
		"items": items,
		"total": len(items),
	})
}

// RestoreFromTrash restores an item from trash
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

	// Resolve original path
	realPath, _, _, err := h.resolvePath(item.OriginalPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath("Cannot restore to original location"))
	}

	// Check if destination already exists
	if _, err := os.Stat(realPath); err == nil {
		// Add suffix to avoid conflict
		ext := filepath.Ext(realPath)
		base := strings.TrimSuffix(realPath, ext)
		realPath = fmt.Sprintf("%s_restored_%d%s", base, time.Now().Unix(), ext)
	}

	// Ensure parent directory exists
	parentDir := filepath.Dir(realPath)
	if err := os.MkdirAll(parentDir, 0755); err != nil {
		return RespondError(c, ErrOperationFailed("create parent directory", err))
	}

	// Move back from trash
	trashItemPath := filepath.Join(h.getTrashPath(claims.Username), trashID)
	if err := os.Rename(trashItemPath, realPath); err != nil {
		return RespondError(c, ErrOperationFailed("restore item", err))
	}

	// Update metadata
	delete(meta, trashID)
	h.saveTrashMeta(claims.Username, meta)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":      true,
		"restoredPath": item.OriginalPath,
	})
}

// DeleteFromTrash permanently deletes an item from trash
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

	if _, exists := meta[trashID]; !exists {
		return RespondError(c, ErrNotFound("Trash item"))
	}

	// Delete permanently
	trashItemPath := filepath.Join(h.getTrashPath(claims.Username), trashID)
	if err := os.RemoveAll(trashItemPath); err != nil {
		return RespondError(c, ErrOperationFailed("delete item", err))
	}

	// Update metadata
	delete(meta, trashID)
	h.saveTrashMeta(claims.Username, meta)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
	})
}

// EmptyTrash permanently deletes all items from trash
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
	os.MkdirAll(trashPath, 0755)

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
			h.saveTrashMeta(username, meta)
		}
	}

	if totalCleaned > 0 {
		fmt.Printf("[Trash] Auto-cleanup completed: deleted %d items (%.2f MB) older than %d days\n",
			totalCleaned, float64(totalSize)/(1024*1024), retentionDays)
	}
}

// GetTrashStats returns statistics about trash usage
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
