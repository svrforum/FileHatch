package handlers

import (
	"database/sql"
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
// Uses in-memory caching to avoid expensive filesystem traversal on every request
func (h *Handler) GetStorageUsage(c echo.Context) error {
	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	username := "anonymous"
	if claims != nil {
		username = claims.Username
	}

	// Check for force refresh parameter
	forceRefresh := c.QueryParam("refresh") == "true"

	// Try to get from cache first
	cache := GetStorageCache()
	if !forceRefresh {
		if cached, ok := cache.GetUserUsage(username); ok {
			return c.JSON(http.StatusOK, map[string]interface{}{
				"homeUsed":   cached.HomeUsed,
				"sharedUsed": cached.SharedUsed,
				"trashUsed":  cached.TrashUsed,
				"totalUsed":  cached.TotalUsed,
				"quota":      cached.Quota,
				"cached":     true,
				"cachedAt":   cached.CachedAt,
			})
		}
	}

	// Calculate storage usage (cache miss or force refresh)
	var sharedSize, homeSize, trashSize int64

	// Calculate shared folder usage in background-friendly way
	sharedPath := filepath.Join(h.dataRoot, "shared")
	sharedSize, _ = h.calculateDirSize(sharedPath)

	// Calculate home folder and trash usage if authenticated
	if claims != nil {
		homePath := filepath.Join(h.dataRoot, "users", claims.Username)
		homeSize, _ = h.calculateDirSize(homePath)

		trashPath := filepath.Join(h.dataRoot, "trash", claims.Username)
		trashSize, _ = h.calculateDirSize(trashPath)
	}

	// Total usage includes home + trash (shared is separate quota)
	totalUsed := homeSize + trashSize

	// Get user quota from database or use default
	totalQuota := int64(10 * 1024 * 1024 * 1024) // Default 10GB
	if claims != nil {
		var dbQuota sql.NullInt64
		err := h.db.QueryRow(`SELECT storage_quota FROM users WHERE id = $1`, claims.UserID).Scan(&dbQuota)
		if err == nil && dbQuota.Valid && dbQuota.Int64 > 0 {
			totalQuota = dbQuota.Int64
		}
	}

	// Cache the result
	usageData := &StorageUsageData{
		HomeUsed:   homeSize,
		SharedUsed: sharedSize,
		TrashUsed:  trashSize,
		TotalUsed:  totalUsed,
		Quota:      totalQuota,
	}
	cache.SetUserUsage(username, usageData)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"homeUsed":   homeSize,
		"sharedUsed": sharedSize,
		"trashUsed":  trashSize,
		"totalUsed":  totalUsed,
		"quota":      totalQuota,
		"cached":     false,
	})
}

// InvalidateStorageCache invalidates storage cache for a user
// Call this after file operations that change storage usage
func InvalidateStorageCache(username string) {
	cache := GetStorageCache()
	if username != "" {
		cache.InvalidateUserUsage(username)
	}
	// Also invalidate shared storage since it affects all users
	cache.InvalidateAllUsage()
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
