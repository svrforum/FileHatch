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
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Path required",
		})
	}

	// Get user claims - required for trash
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	// Resolve path
	realPath, storageType, displayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	if storageType == "root" || displayPath == "/home" || displayPath == "/shared" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot delete root folders",
		})
	}

	// Check if source exists
	info, err := os.Stat(realPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "Item not found",
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to access item",
		})
	}

	// Create trash directory
	trashPath := h.getTrashPath(claims.Username)
	if err := os.MkdirAll(trashPath, 0755); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create trash directory",
		})
	}

	// Generate unique ID for trash item
	trashID := fmt.Sprintf("%d_%s", time.Now().UnixNano(), info.Name())
	trashItemPath := filepath.Join(trashPath, trashID)

	// Move to trash
	if err := os.Rename(realPath, trashItemPath); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to move to trash",
		})
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
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	meta, err := h.loadTrashMeta(claims.Username)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to load trash",
		})
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
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Trash ID required",
		})
	}

	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	meta, err := h.loadTrashMeta(claims.Username)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to load trash",
		})
	}

	item, exists := meta[trashID]
	if !exists {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Trash item not found",
		})
	}

	// Resolve original path
	realPath, _, _, err := h.resolvePath(item.OriginalPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot restore to original location",
		})
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
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create parent directory",
		})
	}

	// Move back from trash
	trashItemPath := filepath.Join(h.getTrashPath(claims.Username), trashID)
	if err := os.Rename(trashItemPath, realPath); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to restore item",
		})
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
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Trash ID required",
		})
	}

	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	meta, err := h.loadTrashMeta(claims.Username)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to load trash",
		})
	}

	if _, exists := meta[trashID]; !exists {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Trash item not found",
		})
	}

	// Delete permanently
	trashItemPath := filepath.Join(h.getTrashPath(claims.Username), trashID)
	if err := os.RemoveAll(trashItemPath); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to delete item",
		})
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
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	trashPath := h.getTrashPath(claims.Username)

	// Remove all contents
	if err := os.RemoveAll(trashPath); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to empty trash",
		})
	}

	// Recreate empty trash directory
	os.MkdirAll(trashPath, 0755)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
	})
}
