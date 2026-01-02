package handlers

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/labstack/echo/v4"
)

// ensureUserHomeDir creates the home directory for a user
func (h *AuthHandler) ensureUserHomeDir(username string) error {
	userDir := h.dataRoot + "/users/" + username
	return os.MkdirAll(userDir, 0755)
}

// calculateStorageUsed calculates the total storage used by a user
// Uses cache for performance optimization
func (h *AuthHandler) calculateStorageUsed(username string) int64 {
	cache := GetStorageCache()

	// Try to get from cache first
	if data, ok := cache.GetUserUsage(username); ok {
		return data.HomeUsed
	}

	// Calculate fresh value
	userDir := h.dataRoot + "/users/" + username
	var totalSize int64

	filepath.Walk(userDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		// Skip .trash directory
		if info.IsDir() && info.Name() == ".trash" {
			return filepath.SkipDir
		}
		if !info.IsDir() {
			totalSize += info.Size()
		}
		return nil
	})

	// Cache the result
	cache.SetUserUsage(username, &StorageUsageData{
		HomeUsed:  totalSize,
		TotalUsed: totalSize,
	})

	return totalSize
}

// invalidateStorageCache invalidates the storage cache for a user
func (h *AuthHandler) invalidateStorageCache(username string) {
	cache := GetStorageCache()
	cache.InvalidateUserUsage(username)
}

// GetUserQuotaInfo returns quota info for a user by username
func (h *AuthHandler) GetUserQuotaInfo(username string) (quota int64, used int64, err error) {
	err = h.db.QueryRow("SELECT COALESCE(storage_quota, 0) FROM users WHERE username = $1", username).Scan(&quota)
	if err != nil {
		return 0, 0, err
	}
	used = h.calculateStorageUsed(username)
	return quota, used, nil
}

// CheckQuota checks if a user can upload a file of given size
// Returns true if upload is allowed, false if quota would be exceeded
func (h *AuthHandler) CheckQuota(username string, fileSize int64) (bool, int64, int64) {
	quota, used, err := h.GetUserQuotaInfo(username)
	if err != nil {
		// If we can't get quota info, allow the upload
		return true, 0, 0
	}
	// quota = 0 means unlimited
	if quota == 0 {
		return true, quota, used
	}
	return (used + fileSize) <= quota, quota, used
}

// GetMyStorageUsage returns the current user's storage usage
func (h *AuthHandler) GetMyStorageUsage(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)
	quota, used, err := h.GetUserQuotaInfo(claims.Username)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to get storage info",
		})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"quota": quota,
		"used":  used,
	})
}
