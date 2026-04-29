package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/labstack/echo/v4"
)

// moveOrCopy attempts os.Rename first; on cross-device errors, falls back to copy+delete.
func moveOrCopy(src, dst string) error {
	err := os.Rename(src, dst)
	if err == nil {
		return nil
	}
	// Check for cross-device link error
	var linkErr *os.LinkError
	if errors.As(err, &linkErr) && errors.Is(linkErr.Err, syscall.EXDEV) {
		// Cross-device: copy then delete
		srcInfo, statErr := os.Stat(src)
		if statErr != nil {
			return statErr
		}
		if srcInfo.IsDir() {
			if cpErr := copyDir(src, dst); cpErr != nil {
				return cpErr
			}
		} else {
			if cpErr := copyFile(src, dst); cpErr != nil {
				return cpErr
			}
		}
		return os.RemoveAll(src)
	}
	return err
}

// TrashItem represents an item in the trash
type TrashItem struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	OriginalPath string    `json:"originalPath"`
	Size         int64     `json:"size"`
	IsDir        bool      `json:"isDir"`
	DeletedAt    time.Time `json:"deletedAt"`
	StorageType  string    `json:"storageType,omitempty"` // "home", "shared", "external"
	MountID      string    `json:"mountId,omitempty"`     // external storage ID
}

// BatchTrashRequest represents a request to batch operate on trash items
type BatchTrashRequest struct {
	IDs []string `json:"ids"`
}

// BatchMoveToTrashRequest represents a request to batch move items to trash
type BatchMoveToTrashRequest struct {
	Paths []string `json:"paths"`
}

// BatchMoveToTrashResult represents the result of a single item in batch move to trash
type BatchMoveToTrashResult struct {
	Path  string `json:"path"`
	Error string `json:"error,omitempty"`
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
	result, realPath, err := h.resolveStorageForOperation("/"+requestPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}
	storageType := result.StorageType
	displayPath := result.DisplayPath

	if storageType == "root" || displayPath == "/home" || displayPath == "/shared" {
		return RespondError(c, ErrForbidden("Cannot delete root folders"))
	}

	// Check readonly
	if err := checkReadonly(result); err != nil {
		return RespondError(c, ErrForbidden(err.Error()))
	}

	// Check shared drive write permission (read-only viewers cannot send items to trash)
	if storageType == StorageShared {
		if !h.CanWriteSharedDrive(claims.UserID, "/"+requestPath) {
			return RespondError(c, ErrForbidden("No permission to delete items in this shared drive"))
		}
	}

	// Check file lock
	if lockErr := h.CheckFileLockForOperation(displayPath, claims.UserID); lockErr != nil {
		return RespondError(c, lockErr)
	}
	if lockErr := h.CheckFolderLocksForOperation(displayPath, claims.UserID); lockErr != nil {
		return RespondError(c, lockErr)
	}

	// Create trash directory
	trashPath := h.getTrashPath(claims.Username)
	if err := os.MkdirAll(trashPath, 0755); err != nil {
		return RespondError(c, ErrOperationFailed("create trash directory", err))
	}

	var trashID string
	var size int64
	var isDir bool
	var itemName string

	// Non-local external storage: download to local trash, then delete from backend
	if storageType == StorageExternal && realPath == "" {
		ctx := context.Background()

		// Get source info
		info, err := result.Backend.Stat(ctx, result.RelPath)
		if err != nil {
			return RespondError(c, ErrNotFound("Item"))
		}
		itemName = info.FileName
		isDir = info.IsDirectory

		trashID = fmt.Sprintf("%d_%s", time.Now().UnixNano(), itemName)
		trashItemPath := filepath.Join(trashPath, trashID)

		// Download from backend to local trash
		if isDir {
			if err := downloadDirToLocal(ctx, result.Backend, result.RelPath, trashItemPath); err != nil {
				return RespondError(c, ErrOperationFailed("move to trash", err))
			}
		} else {
			if err := downloadFileToLocal(ctx, result.Backend, result.RelPath, trashItemPath); err != nil {
				return RespondError(c, ErrOperationFailed("move to trash", err))
			}
		}

		// Delete from backend
		if err := result.Backend.DeleteAll(ctx, result.RelPath); err != nil {
			return RespondError(c, ErrOperationFailed("delete from external storage", err))
		}

		// Calculate size from local copy
		if isDir {
			size, _ = h.calculateDirSize(trashItemPath)
		} else {
			size = info.FileSize
		}

		// Save metadata with external storage info
		meta, _ := h.loadTrashMeta(claims.Username)
		meta[trashID] = TrashItem{
			ID:           trashID,
			Name:         itemName,
			OriginalPath: displayPath,
			Size:         size,
			IsDir:        isDir,
			DeletedAt:    time.Now(),
			StorageType:  StorageExternal,
			MountID:      result.MountID,
		}
		_ = h.saveTrashMeta(claims.Username, meta)
	} else {
		// Local storage (home, shared, local-mount external)
		info, err := os.Stat(realPath)
		if err != nil {
			if os.IsNotExist(err) {
				return RespondError(c, ErrNotFound("Item"))
			}
			return RespondError(c, ErrOperationFailed("access item", err))
		}
		itemName = info.Name()
		isDir = info.IsDir()

		trashID = fmt.Sprintf("%d_%s", time.Now().UnixNano(), itemName)
		trashItemPath := filepath.Join(trashPath, trashID)

		// Move to trash (handles cross-device moves for external mounts)
		if err := moveOrCopy(realPath, trashItemPath); err != nil {
			return RespondError(c, ErrOperationFailed("move to trash", err))
		}

		// Calculate size
		if isDir {
			size, _ = h.calculateDirSize(trashItemPath)
		} else {
			size = info.Size()
		}

		// Update trash metadata
		meta, _ := h.loadTrashMeta(claims.Username)
		trashItem := TrashItem{
			ID:           trashID,
			Name:         itemName,
			OriginalPath: displayPath,
			Size:         size,
			IsDir:        isDir,
			DeletedAt:    time.Now(),
			StorageType:  storageType,
		}
		// Include MountID for local-mount external storage (needed for restore)
		if storageType == StorageExternal && result.MountID != "" {
			trashItem.MountID = result.MountID
		}
		meta[trashID] = trashItem
		_ = h.saveTrashMeta(claims.Username, meta)
	}

	// Clean up locks after successful move to trash
	_ = h.RemoveLockByPath(displayPath)
	if isDir {
		_ = h.RemoveLocksUnderPath(displayPath)
	}

	// Log audit event
	_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), EventFileDelete, displayPath, map[string]interface{}{
		"isDir":   isDir,
		"size":    size,
		"trashId": trashID,
	})

	// Update storage tracking: move from home to trash (skip for external)
	if storageType != StorageExternal {
		if err := h.UpdateStorageForMove(claims.UserID, size, true); err != nil {
			fmt.Printf("[Storage] Failed to update storage for %s: %v\n", claims.Username, err)
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"path":    displayPath,
		"trashId": trashID,
	})
}

// BatchMoveToTrash moves multiple files/folders to trash in a single request
func (h *Handler) BatchMoveToTrash(c echo.Context) error {
	var req BatchMoveToTrashRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}
	if len(req.Paths) == 0 {
		return RespondError(c, ErrMissingParameter("paths"))
	}

	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	var success []string
	var failed []BatchMoveToTrashResult

	for _, path := range req.Paths {
		// Resolve path
		result, realPath, err := h.resolveStorageForOperation(path, claims)
		if err != nil {
			failed = append(failed, BatchMoveToTrashResult{Path: path, Error: err.Error()})
			continue
		}
		storageType := result.StorageType
		displayPath := result.DisplayPath

		if storageType == "root" || displayPath == "/home" || displayPath == "/shared" {
			failed = append(failed, BatchMoveToTrashResult{Path: path, Error: "Cannot delete root folders"})
			continue
		}

		// Check readonly
		if err := checkReadonly(result); err != nil {
			failed = append(failed, BatchMoveToTrashResult{Path: path, Error: err.Error()})
			continue
		}

		// Check shared drive write permission (read-only viewers cannot send items to trash)
		if storageType == StorageShared {
			if !h.CanWriteSharedDrive(claims.UserID, path) {
				failed = append(failed, BatchMoveToTrashResult{Path: path, Error: "No permission to delete items in this shared drive"})
				continue
			}
		}

		// Check file lock
		if lockErr := h.CheckFileLockForOperation(displayPath, claims.UserID); lockErr != nil {
			failed = append(failed, BatchMoveToTrashResult{Path: path, Error: lockErr.Message})
			continue
		}
		if lockErr := h.CheckFolderLocksForOperation(displayPath, claims.UserID); lockErr != nil {
			failed = append(failed, BatchMoveToTrashResult{Path: path, Error: lockErr.Message})
			continue
		}

		// Create trash directory
		trashPath := h.getTrashPath(claims.Username)
		if err := os.MkdirAll(trashPath, 0755); err != nil {
			failed = append(failed, BatchMoveToTrashResult{Path: path, Error: "Failed to create trash directory"})
			continue
		}

		var trashID string
		var size int64
		var isDir bool
		var itemName string

		// Non-local external storage
		if storageType == StorageExternal && realPath == "" {
			ctx := context.Background()
			info, err := result.Backend.Stat(ctx, result.RelPath)
			if err != nil {
				failed = append(failed, BatchMoveToTrashResult{Path: path, Error: "Item not found"})
				continue
			}
			itemName = info.FileName
			isDir = info.IsDirectory
			trashID = fmt.Sprintf("%d_%s", time.Now().UnixNano(), itemName)
			trashItemPath := filepath.Join(trashPath, trashID)

			if isDir {
				if err := downloadDirToLocal(ctx, result.Backend, result.RelPath, trashItemPath); err != nil {
					failed = append(failed, BatchMoveToTrashResult{Path: path, Error: err.Error()})
					continue
				}
			} else {
				if err := downloadFileToLocal(ctx, result.Backend, result.RelPath, trashItemPath); err != nil {
					failed = append(failed, BatchMoveToTrashResult{Path: path, Error: err.Error()})
					continue
				}
			}

			if err := result.Backend.DeleteAll(ctx, result.RelPath); err != nil {
				failed = append(failed, BatchMoveToTrashResult{Path: path, Error: err.Error()})
				continue
			}

			if isDir {
				size, _ = h.calculateDirSize(trashItemPath)
			} else {
				size = info.FileSize
			}

			meta, _ := h.loadTrashMeta(claims.Username)
			meta[trashID] = TrashItem{
				ID:           trashID,
				Name:         itemName,
				OriginalPath: displayPath,
				Size:         size,
				IsDir:        isDir,
				DeletedAt:    time.Now(),
				StorageType:  StorageExternal,
				MountID:      result.MountID,
			}
			_ = h.saveTrashMeta(claims.Username, meta)
		} else {
			// Local storage
			info, err := os.Stat(realPath)
			if err != nil {
				if os.IsNotExist(err) {
					failed = append(failed, BatchMoveToTrashResult{Path: path, Error: "Item not found"})
				} else {
					failed = append(failed, BatchMoveToTrashResult{Path: path, Error: err.Error()})
				}
				continue
			}
			itemName = info.Name()
			isDir = info.IsDir()

			trashID = fmt.Sprintf("%d_%s", time.Now().UnixNano(), itemName)
			trashItemPath := filepath.Join(trashPath, trashID)

			if err := moveOrCopy(realPath, trashItemPath); err != nil {
				failed = append(failed, BatchMoveToTrashResult{Path: path, Error: err.Error()})
				continue
			}

			if isDir {
				size, _ = h.calculateDirSize(trashItemPath)
			} else {
				size = info.Size()
			}

			meta, _ := h.loadTrashMeta(claims.Username)
			trashItem := TrashItem{
				ID:           trashID,
				Name:         itemName,
				OriginalPath: displayPath,
				Size:         size,
				IsDir:        isDir,
				DeletedAt:    time.Now(),
				StorageType:  storageType,
			}
			if storageType == StorageExternal && result.MountID != "" {
				trashItem.MountID = result.MountID
			}
			meta[trashID] = trashItem
			_ = h.saveTrashMeta(claims.Username, meta)

			// Update storage tracking for non-external items
			if storageType != StorageExternal {
				_ = h.UpdateStorageForMove(claims.UserID, size, true)
			}
		}

		// Clean up locks after successful move to trash
		_ = h.RemoveLockByPath(displayPath)
		if isDir {
			_ = h.RemoveLocksUnderPath(displayPath)
		}

		// Log audit event
		_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), EventFileDelete, displayPath, map[string]interface{}{
			"isDir":   isDir,
			"size":    size,
			"trashId": trashID,
		})

		success = append(success, path)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": success,
		"failed":  failed,
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
	trashItemPath := filepath.Join(h.getTrashPath(claims.Username), trashID)
	restorePath := item.OriginalPath

	// Check if this is an SMB-deleted file (ID starts with "smb_")
	isSMBFile := strings.HasPrefix(trashID, "smb_")
	if isSMBFile {
		relPath := strings.TrimPrefix(item.OriginalPath, "/home/")
		trashItemPath = filepath.Join(h.getTrashPath(claims.Username), ".smb", relPath)
	}

	// Check if restoring to external non-local storage
	if item.StorageType == StorageExternal && item.MountID != "" {
		// Restore to external non-local storage
		restoreResult, restoreRealPath, err := h.resolveStorageForOperation(item.OriginalPath, claims)
		if err != nil {
			return RespondError(c, ErrInvalidPath("Cannot restore to original location"))
		}

		if restoreResult.IsReadonly {
			return RespondError(c, ErrForbidden("External storage is read-only"))
		}

		if restoreResult.Backend != nil && !restoreResult.Backend.IsLocal() {
			// Upload from local trash to non-local backend
			ctx := context.Background()
			if item.IsDir {
				if err := uploadDirToBackend(ctx, trashItemPath, restoreResult.Backend, restoreResult.RelPath); err != nil {
					return RespondError(c, ErrOperationFailed("restore item", err))
				}
			} else {
				if err := uploadFileToBackend(ctx, trashItemPath, restoreResult.Backend, restoreResult.RelPath); err != nil {
					return RespondError(c, ErrOperationFailed("restore item", err))
				}
			}

			// Delete local trash copy
			os.RemoveAll(trashItemPath)

			// Update metadata
			delete(meta, trashID)
			_ = h.saveTrashMeta(claims.Username, meta)

			_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), EventTrashRestore, restorePath, map[string]interface{}{
				"trashId": trashID,
			})

			return c.JSON(http.StatusOK, map[string]interface{}{
				"success":      true,
				"restoredPath": restorePath,
			})
		}
		// Local-mount external: use restoreRealPath directly
		localRealPath := restoreRealPath

		// Check if destination already exists
		if _, existErr := os.Stat(localRealPath); existErr == nil {
			ext := filepath.Ext(localRealPath)
			base := strings.TrimSuffix(localRealPath, ext)
			localRealPath = fmt.Sprintf("%s_restored_%d%s", base, time.Now().Unix(), ext)
			ext = filepath.Ext(restorePath)
			base = strings.TrimSuffix(restorePath, ext)
			restorePath = fmt.Sprintf("%s_restored_%d%s", base, time.Now().Unix(), ext)
		}

		parentDir := filepath.Dir(localRealPath)
		if mkErr := os.MkdirAll(parentDir, 0755); mkErr != nil {
			return RespondError(c, ErrOperationFailed("create parent directory", mkErr))
		}

		if mvErr := moveOrCopy(trashItemPath, localRealPath); mvErr != nil {
			return RespondError(c, ErrOperationFailed("restore item", mvErr))
		}

		delete(meta, trashID)
		_ = h.saveTrashMeta(claims.Username, meta)

		_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), EventTrashRestore, restorePath, map[string]interface{}{
			"trashId": trashID,
		})

		return c.JSON(http.StatusOK, map[string]interface{}{
			"success":      true,
			"restoredPath": restorePath,
		})
	}

	// Local restore (home, shared)
	var realPath string
	if isSMBFile {
		var err error
		realPath, _, _, err = h.resolvePath(item.OriginalPath, claims)
		if err != nil {
			return RespondError(c, ErrInvalidPath("Cannot restore to original location"))
		}
	} else {
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

	// Move back from trash (handles cross-device moves for external mounts)
	if err := moveOrCopy(trashItemPath, realPath); err != nil {
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
	_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), EventTrashRestore, restorePath, map[string]interface{}{
		"trashId": trashID,
	})

	// Update storage tracking: move from trash back to home (skip for external)
	if item.StorageType != StorageExternal {
		if err := h.UpdateStorageForMove(claims.UserID, item.Size, false); err != nil {
			fmt.Printf("[Storage] Failed to update storage for %s: %v\n", claims.Username, err)
		}
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

	// Audit log: permanent deletion (irreversible)
	_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), EventTrashDelete, item.OriginalPath, map[string]interface{}{
		"trashId":   trashID,
		"name":      item.Name,
		"size":      item.Size,
		"isDir":     item.IsDir,
		"permanent": true,
	})

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
	})
}

// BatchRestoreFromTrash restores multiple items from trash at once
func (h *Handler) BatchRestoreFromTrash(c echo.Context) error {
	var req BatchTrashRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}
	if len(req.IDs) == 0 {
		return RespondError(c, ErrMissingParameter("ids"))
	}

	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	meta, err := h.loadTrashMeta(claims.Username)
	if err != nil {
		return RespondError(c, ErrOperationFailed("load trash", err))
	}

	var restored []string
	var failed []string
	var errMsgs []string
	var totalRestoredSize int64
	var totalRestoredExternalSize int64

	for _, trashID := range req.IDs {
		item, exists := meta[trashID]
		if !exists {
			failed = append(failed, trashID)
			errMsgs = append(errMsgs, fmt.Sprintf("%s: not found", trashID))
			continue
		}

		trashItemPath := filepath.Join(h.getTrashPath(claims.Username), trashID)
		restorePath := item.OriginalPath

		// Check if this is an SMB-deleted file
		isSMBFile := strings.HasPrefix(trashID, "smb_")
		if isSMBFile {
			relPath := strings.TrimPrefix(item.OriginalPath, "/home/")
			trashItemPath = filepath.Join(h.getTrashPath(claims.Username), ".smb", relPath)
		}

		// Handle external non-local storage restore
		if item.StorageType == StorageExternal && item.MountID != "" {
			restoreResult, restoreRealPath, resolveErr := h.resolveStorageForOperation(item.OriginalPath, claims)
			if resolveErr != nil {
				failed = append(failed, trashID)
				errMsgs = append(errMsgs, fmt.Sprintf("%s: %s", trashID, resolveErr.Error()))
				continue
			}
			if restoreResult.IsReadonly {
				failed = append(failed, trashID)
				errMsgs = append(errMsgs, fmt.Sprintf("%s: read-only storage", trashID))
				continue
			}

			if restoreResult.Backend != nil && !restoreResult.Backend.IsLocal() {
				ctx := context.Background()
				var uploadErr error
				if item.IsDir {
					uploadErr = uploadDirToBackend(ctx, trashItemPath, restoreResult.Backend, restoreResult.RelPath)
				} else {
					uploadErr = uploadFileToBackend(ctx, trashItemPath, restoreResult.Backend, restoreResult.RelPath)
				}
				if uploadErr != nil {
					failed = append(failed, trashID)
					errMsgs = append(errMsgs, fmt.Sprintf("%s: %s", trashID, uploadErr.Error()))
					continue
				}
				os.RemoveAll(trashItemPath)
				delete(meta, trashID)
				restored = append(restored, trashID)
				_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), EventTrashRestore, restorePath, map[string]interface{}{
					"trashId": trashID,
				})
				continue
			}

			// Local-mount external
			localRealPath := restoreRealPath
			if _, existErr := os.Stat(localRealPath); existErr == nil {
				ext := filepath.Ext(localRealPath)
				base := strings.TrimSuffix(localRealPath, ext)
				localRealPath = fmt.Sprintf("%s_restored_%d%s", base, time.Now().Unix(), ext)
			}
			parentDir := filepath.Dir(localRealPath)
			if mkErr := os.MkdirAll(parentDir, 0755); mkErr != nil {
				failed = append(failed, trashID)
				errMsgs = append(errMsgs, fmt.Sprintf("%s: %s", trashID, mkErr.Error()))
				continue
			}
			if mvErr := moveOrCopy(trashItemPath, localRealPath); mvErr != nil {
				failed = append(failed, trashID)
				errMsgs = append(errMsgs, fmt.Sprintf("%s: %s", trashID, mvErr.Error()))
				continue
			}
			delete(meta, trashID)
			restored = append(restored, trashID)
			_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), EventTrashRestore, restorePath, map[string]interface{}{
				"trashId": trashID,
			})
			continue
		}

		// Local restore (home, shared)
		realPath, _, _, resolveErr := h.resolvePath(item.OriginalPath, claims)
		if resolveErr != nil {
			failed = append(failed, trashID)
			errMsgs = append(errMsgs, fmt.Sprintf("%s: %s", trashID, resolveErr.Error()))
			continue
		}

		// Check if destination already exists
		if _, statErr := os.Stat(realPath); statErr == nil {
			ext := filepath.Ext(realPath)
			base := strings.TrimSuffix(realPath, ext)
			realPath = fmt.Sprintf("%s_restored_%d%s", base, time.Now().Unix(), ext)
		}

		parentDir := filepath.Dir(realPath)
		if mkErr := os.MkdirAll(parentDir, 0755); mkErr != nil {
			failed = append(failed, trashID)
			errMsgs = append(errMsgs, fmt.Sprintf("%s: %s", trashID, mkErr.Error()))
			continue
		}

		if mvErr := moveOrCopy(trashItemPath, realPath); mvErr != nil {
			failed = append(failed, trashID)
			errMsgs = append(errMsgs, fmt.Sprintf("%s: %s", trashID, mvErr.Error()))
			continue
		}

		if isSMBFile {
			h.cleanupEmptySMBDirs(claims.Username, trashItemPath)
		}

		delete(meta, trashID)
		restored = append(restored, trashID)

		_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), EventTrashRestore, restorePath, map[string]interface{}{
			"trashId": trashID,
		})

		if item.StorageType != StorageExternal {
			totalRestoredSize += item.Size
		} else {
			totalRestoredExternalSize += item.Size
		}
	}

	// Save metadata once
	if len(restored) > 0 {
		_ = h.saveTrashMeta(claims.Username, meta)
	}

	// Update storage tracking once for all non-external items
	if totalRestoredSize > 0 {
		if err := h.UpdateStorageForMove(claims.UserID, totalRestoredSize, false); err != nil {
			fmt.Printf("[Storage] Failed to update storage for %s: %v\n", claims.Username, err)
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":  len(failed) == 0,
		"restored": restored,
		"failed":   failed,
		"errors":   errMsgs,
	})
}

// BatchDeleteFromTrash permanently deletes multiple items from trash at once
func (h *Handler) BatchDeleteFromTrash(c echo.Context) error {
	var req BatchTrashRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}
	if len(req.IDs) == 0 {
		return RespondError(c, ErrMissingParameter("ids"))
	}

	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	meta, err := h.loadTrashMeta(claims.Username)
	if err != nil {
		return RespondError(c, ErrOperationFailed("load trash", err))
	}

	var deleted []string
	var failed []string
	var totalDeletedSize int64
	var deletedItems []TrashItem

	for _, trashID := range req.IDs {
		item, exists := meta[trashID]
		if !exists {
			failed = append(failed, trashID)
			continue
		}

		trashItemPath := filepath.Join(h.getTrashPath(claims.Username), trashID)
		if err := os.RemoveAll(trashItemPath); err != nil {
			failed = append(failed, trashID)
			continue
		}

		delete(meta, trashID)
		deleted = append(deleted, trashID)
		totalDeletedSize += item.Size
		deletedItems = append(deletedItems, item)
	}

	// Save metadata once
	if len(deleted) > 0 {
		_ = h.saveTrashMeta(claims.Username, meta)
	}

	// Update storage tracking once
	if totalDeletedSize > 0 {
		if err := h.UpdateUserTrashStorage(claims.UserID, -totalDeletedSize); err != nil {
			fmt.Printf("[Storage] Failed to update storage for %s: %v\n", claims.Username, err)
		}
	}

	// Audit log: one entry per item permanently deleted (irreversible)
	for _, item := range deletedItems {
		_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), EventTrashDelete, item.OriginalPath, map[string]interface{}{
			"trashId":   item.ID,
			"name":      item.Name,
			"size":      item.Size,
			"isDir":     item.IsDir,
			"permanent": true,
			"batch":     true,
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": len(failed) == 0,
		"deleted": deleted,
		"failed":  failed,
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

	// Count items before deletion (and capture totals for audit)
	meta, _ := h.loadTrashMeta(claims.Username)
	deletedCount := len(meta)
	var totalSize int64
	for _, item := range meta {
		totalSize += item.Size
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

	// Audit log: empty trash is a single irreversible action
	if deletedCount > 0 {
		_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), EventTrashDelete, "/trash", map[string]interface{}{
			"deletedCount": deletedCount,
			"totalSize":    totalSize,
			"permanent":    true,
			"emptyAll":     true,
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":      true,
		"deletedCount": deletedCount,
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

	if err := moveOrCopy(realPath, trashItemPath); err != nil {
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

// downloadFileToLocal downloads a single file from a StorageBackend to a local path
func downloadFileToLocal(ctx context.Context, backend StorageBackend, relPath, localPath string) error {
	reader, _, err := backend.ReadFile(ctx, relPath)
	if err != nil {
		return fmt.Errorf("failed to read from backend: %w", err)
	}
	defer reader.Close()

	if err := os.MkdirAll(filepath.Dir(localPath), 0755); err != nil {
		return err
	}

	f, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.Copy(f, reader)
	return err
}

// downloadDirToLocal recursively downloads a directory from a StorageBackend to a local path
func downloadDirToLocal(ctx context.Context, backend StorageBackend, relPath, localPath string) error {
	if err := os.MkdirAll(localPath, 0755); err != nil {
		return err
	}

	entries, err := backend.ReadDir(ctx, relPath)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		childRelPath := filepath.Join(relPath, entry.EntryName)
		childLocalPath := filepath.Join(localPath, entry.EntryName)

		if entry.IsDir {
			if err := downloadDirToLocal(ctx, backend, childRelPath, childLocalPath); err != nil {
				return err
			}
		} else {
			if err := downloadFileToLocal(ctx, backend, childRelPath, childLocalPath); err != nil {
				return err
			}
		}
	}
	return nil
}

// uploadFileToBackend uploads a local file to a StorageBackend
func uploadFileToBackend(ctx context.Context, localPath string, backend StorageBackend, relPath string) error {
	f, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return err
	}

	return backend.WriteFile(ctx, relPath, f, info.Size())
}

// uploadDirToBackend recursively uploads a local directory to a StorageBackend
func uploadDirToBackend(ctx context.Context, localPath string, backend StorageBackend, relPath string) error {
	if err := backend.Mkdir(ctx, relPath); err != nil {
		return err
	}

	entries, err := os.ReadDir(localPath)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		childLocalPath := filepath.Join(localPath, entry.Name())
		childRelPath := filepath.Join(relPath, entry.Name())

		if entry.IsDir() {
			if err := uploadDirToBackend(ctx, childLocalPath, backend, childRelPath); err != nil {
				return err
			}
		} else {
			if err := uploadFileToBackend(ctx, childLocalPath, backend, childRelPath); err != nil {
				return err
			}
		}
	}
	return nil
}
