package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/labstack/echo/v4"
)

// StorageUsage represents storage usage information
type StorageUsage struct {
	Used  int64 `json:"used"`
	Total int64 `json:"total"`
}

// GetStorageUsage returns storage usage for the current user
// Reads from database for instant response - no filesystem scan needed
func (h *Handler) GetStorageUsage(c echo.Context) error {
	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	if claims == nil {
		return c.JSON(http.StatusOK, map[string]any{
			"homeUsed":   0,
			"sharedUsed": 0,
			"trashUsed":  0,
			"totalUsed":  0,
			"quota":      int64(10 * 1024 * 1024 * 1024),
		})
	}

	// Check for recalculate parameter (admin only or self)
	if c.QueryParam("recalculate") == "true" {
		if err := h.RecalculateUserStorage(claims.UserID, claims.Username); err != nil {
			fmt.Printf("[Storage] Recalculate failed for %s: %v\n", claims.Username, err)
		}
	}

	// Read storage values from database (instant query)
	var storageUsed, trashUsed, storageQuota sql.NullInt64
	err := h.db.QueryRow(`
		SELECT storage_used, trash_used, storage_quota
		FROM users WHERE id = $1
	`, claims.UserID).Scan(&storageUsed, &trashUsed, &storageQuota)

	if err != nil {
		// If columns don't exist yet (migration not run), fallback to calculation
		if err == sql.ErrNoRows {
			return RespondError(c, ErrNotFound("User"))
		}
		// Fallback to old calculation method
		return h.getStorageUsageFallback(c, claims)
	}

	homeUsed := storageUsed.Int64
	trashUsedVal := trashUsed.Int64
	totalUsed := homeUsed + trashUsedVal

	// Default quota 10GB
	quota := int64(10 * 1024 * 1024 * 1024)
	if storageQuota.Valid && storageQuota.Int64 > 0 {
		quota = storageQuota.Int64
	}

	// Calculate shared folder usage (cached separately)
	sharedSize := h.getSharedStorageUsage()

	return c.JSON(http.StatusOK, map[string]any{
		"homeUsed":   homeUsed,
		"sharedUsed": sharedSize,
		"trashUsed":  trashUsedVal,
		"totalUsed":  totalUsed,
		"quota":      quota,
	})
}

// getStorageUsageFallback uses the old calculation method if DB columns don't exist
func (h *Handler) getStorageUsageFallback(c echo.Context, claims *JWTClaims) error {
	var sharedSize, homeSize, trashSize int64

	sharedPath := filepath.Join(h.dataRoot, "shared")
	sharedSize, _ = h.calculateDirSize(sharedPath)

	homePath := filepath.Join(h.dataRoot, "users", claims.Username)
	homeSize, _ = h.calculateDirSize(homePath)

	trashPath := filepath.Join(h.dataRoot, "trash", claims.Username)
	trashSize, _ = h.calculateDirSize(trashPath)

	totalUsed := homeSize + trashSize

	totalQuota := int64(10 * 1024 * 1024 * 1024)
	var dbQuota sql.NullInt64
	err := h.db.QueryRow(`SELECT storage_quota FROM users WHERE id = $1`, claims.UserID).Scan(&dbQuota)
	if err == nil && dbQuota.Valid && dbQuota.Int64 > 0 {
		totalQuota = dbQuota.Int64
	}

	return c.JSON(http.StatusOK, map[string]any{
		"homeUsed":   homeSize,
		"sharedUsed": sharedSize,
		"trashUsed":  trashSize,
		"totalUsed":  totalUsed,
		"quota":      totalQuota,
		"fallback":   true,
	})
}

// getSharedStorageUsage returns cached shared storage usage
func (h *Handler) getSharedStorageUsage() int64 {
	cache := GetStorageCache()
	if cached, ok := cache.GetSharedUsage(); ok {
		return cached
	}

	// Calculate and cache
	sharedPath := filepath.Join(h.dataRoot, "shared")
	size, _ := h.calculateDirSize(sharedPath)
	cache.SetSharedUsage(size)
	return size
}

// UpdateUserStorage updates the storage_used value in the database
// delta can be positive (file added) or negative (file removed)
func (h *Handler) UpdateUserStorage(userID string, delta int64) error {
	_, err := h.db.Exec(`
		UPDATE users
		SET storage_used = GREATEST(0, COALESCE(storage_used, 0) + $1),
		    updated_at = NOW()
		WHERE id = $2
	`, delta, userID)
	return err
}

// UpdateUserTrashStorage updates the trash_used value in the database
func (h *Handler) UpdateUserTrashStorage(userID string, delta int64) error {
	_, err := h.db.Exec(`
		UPDATE users
		SET trash_used = GREATEST(0, COALESCE(trash_used, 0) + $1),
		    updated_at = NOW()
		WHERE id = $2
	`, delta, userID)
	return err
}

// UpdateStorageForMove handles storage tracking when moving file from home to trash
func (h *Handler) UpdateStorageForMove(userID string, fileSize int64, toTrash bool) error {
	if toTrash {
		// Moving to trash: decrease home, increase trash
		if err := h.UpdateUserStorage(userID, -fileSize); err != nil {
			return err
		}
		return h.UpdateUserTrashStorage(userID, fileSize)
	}
	// Restoring from trash: increase home, decrease trash
	if err := h.UpdateUserStorage(userID, fileSize); err != nil {
		return err
	}
	return h.UpdateUserTrashStorage(userID, -fileSize)
}

// RecalculateUserStorage recalculates storage by scanning filesystem
// Used for initial migration or manual recalculation
func (h *Handler) RecalculateUserStorage(userID, username string) error {
	homePath := filepath.Join(h.dataRoot, "users", username)
	homeSize, _ := h.calculateDirSize(homePath)

	trashPath := filepath.Join(h.dataRoot, "trash", username)
	trashSize, _ := h.calculateDirSize(trashPath)

	_, err := h.db.Exec(`
		UPDATE users
		SET storage_used = $1, trash_used = $2, updated_at = NOW()
		WHERE id = $3
	`, homeSize, trashSize, userID)

	if err == nil {
		fmt.Printf("[Storage] Recalculated for %s: home=%d, trash=%d\n", username, homeSize, trashSize)
	}
	return err
}

// RecalculateAllUsersStorage recalculates storage for all users (admin function)
func (h *Handler) RecalculateAllUsersStorage() error {
	rows, err := h.db.Query(`SELECT id, username FROM users WHERE is_active = true`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var count int
	for rows.Next() {
		var userID, username string
		if err := rows.Scan(&userID, &username); err != nil {
			continue
		}
		if err := h.RecalculateUserStorage(userID, username); err != nil {
			fmt.Printf("[Storage] Failed to recalculate for %s: %v\n", username, err)
			continue
		}
		count++
	}

	fmt.Printf("[Storage] Recalculated storage for %d users\n", count)
	return nil
}

// InvalidateStorageCache invalidates storage cache (now only for shared storage)
func InvalidateStorageCache(username string) {
	cache := GetStorageCache()
	cache.InvalidateSharedUsage()
}

// calculateDirSize calculates the total size of a directory
func (h *Handler) calculateDirSize(path string) (int64, error) {
	var size int64
	err := filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			size += info.Size()
		}
		return nil
	})
	return size, err
}

// GetFileSize returns the size of a file or directory
func GetFileSize(path string) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}

	if !info.IsDir() {
		return info.Size(), nil
	}

	// For directories, calculate total size
	var size int64
	err = filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			size += info.Size()
		}
		return nil
	})
	return size, err
}
