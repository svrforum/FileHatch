package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"
)

// CreateFolderRequest represents the request body for folder creation
type CreateFolderRequest struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

// FolderStats represents statistics for a folder
type FolderStats struct {
	Path        string `json:"path"`
	FileCount   int    `json:"fileCount"`
	FolderCount int    `json:"folderCount"`
	TotalSize   int64  `json:"totalSize"`
}

// CreateFolder handles folder creation requests
func (h *Handler) CreateFolder(c echo.Context) error {
	var req CreateFolderRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Folder name required",
		})
	}

	// Validate folder name
	if strings.ContainsAny(req.Name, `/\:*?"<>|`) {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid folder name",
		})
	}

	parentPath := req.Path
	if parentPath == "" {
		parentPath = "/"
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve parent path
	realParentPath, storageType, displayPath, err := h.resolvePath(parentPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	// Cannot create folder at root
	if storageType == "root" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot create folder at root level",
		})
	}

	// Cannot create folders directly under /shared/ (must use admin interface)
	if parentPath == "/shared" || parentPath == "/shared/" {
		return c.JSON(http.StatusForbidden, map[string]string{
			"error": "공유 드라이브는 관리자 설정에서만 생성할 수 있습니다",
		})
	}

	// Check permissions for home folder
	if storageType == StorageHome && claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	// Check shared write permission
	if storageType == StorageShared {
		if claims == nil {
			return c.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Authentication required",
			})
		}
		if !h.CanWriteSharedDrive(claims.UserID, parentPath) {
			return c.JSON(http.StatusForbidden, map[string]string{
				"error": "No permission to create folders in this shared drive",
			})
		}
	}

	folderPath := filepath.Join(realParentPath, req.Name)

	// Check if already exists
	if _, err := os.Stat(folderPath); err == nil {
		return c.JSON(http.StatusConflict, map[string]string{
			"error": "Folder already exists",
		})
	}

	if err := os.MkdirAll(folderPath, 0755); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create folder",
		})
	}

	newFolderPath := filepath.Join(displayPath, req.Name)

	// Log audit event
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	h.auditHandler.LogEvent(userID, c.RealIP(), EventFolderCreate, newFolderPath, map[string]interface{}{
		"name":       req.Name,
		"parentPath": displayPath,
	})

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"success": true,
		"path":    newFolderPath,
		"name":    req.Name,
	})
}

// DeleteFolder handles folder deletion requests
func (h *Handler) DeleteFolder(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Folder path required",
		})
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	realPath, storageType, displayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	// Cannot delete root storage types
	virtualPath := "/" + requestPath
	if storageType == "root" || displayPath == "/home" || displayPath == "/shared" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot delete root folders",
		})
	}

	// Protect shared drive root folders (e.g., /shared/111 but not /shared/111/subfolder)
	if storageType == StorageShared {
		// Count path segments after /shared/
		sharedParts := strings.Split(strings.TrimPrefix(virtualPath, "/shared/"), "/")
		// If only one part (the folder name itself) or empty after trim, it's the root
		if len(sharedParts) == 1 && sharedParts[0] != "" {
			return c.JSON(http.StatusForbidden, map[string]string{
				"error": "공유 드라이브 폴더는 관리자 설정에서만 삭제할 수 있습니다",
			})
		}
	}

	// Check permissions for home folder
	if storageType == StorageHome && claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	// Check shared write permission
	if storageType == StorageShared {
		if claims == nil {
			return c.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Authentication required",
			})
		}
		if !h.CanWriteSharedDrive(claims.UserID, virtualPath) {
			return c.JSON(http.StatusForbidden, map[string]string{
				"error": "No permission to delete folders in this shared drive",
			})
		}
	}

	info, err := os.Stat(realPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "Folder not found",
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to access folder",
		})
	}

	if !info.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Path is not a directory",
		})
	}

	// Check if force delete is requested
	force := c.QueryParam("force") == "true"

	if force {
		if err := os.RemoveAll(realPath); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to delete folder",
			})
		}
	} else {
		// Only delete if empty
		entries, err := os.ReadDir(realPath)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to read folder",
			})
		}

		if len(entries) > 0 {
			return c.JSON(http.StatusConflict, map[string]string{
				"error": "Folder is not empty. Use ?force=true to delete anyway",
			})
		}

		if err := os.Remove(realPath); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to delete folder",
			})
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"path":    displayPath,
	})
}

// GetFolderStats returns statistics for a folder (recursive file/folder count and total size)
// Uses caching for improved performance
func (h *Handler) GetFolderStats(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		requestPath = "/"
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	virtualPath := "/" + requestPath
	realPath, storageType, displayPath, err := h.resolvePath(virtualPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	if storageType == "root" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot get stats for root",
		})
	}

	// Check shared read permission
	if storageType == StorageShared {
		if claims == nil {
			return c.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Authentication required",
			})
		}
		if !h.CanReadSharedDrive(claims.UserID, virtualPath) {
			return c.JSON(http.StatusForbidden, map[string]string{
				"error": "No permission to access this shared drive",
			})
		}
	}

	info, err := os.Stat(realPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "Path not found",
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to access path",
		})
	}

	if !info.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Path is not a directory",
		})
	}

	// Check for no-cache query parameter
	noCache := c.QueryParam("no-cache") == "true"

	// Try to get from cache first
	cache := GetStatsCache()
	if cache != nil && !noCache {
		stats, err := cache.GetOrCompute(realPath, func() (*CachedFolderStats, error) {
			return h.computeFolderStatsInternal(realPath)
		})
		if err == nil {
			// Set cache headers
			SetCacheHeaders(c.Response().Writer, GenerateETag(realPath, info.ModTime(), 0), 60) // 1 minute browser cache
			return c.JSON(http.StatusOK, FolderStats{
				Path:        displayPath,
				FileCount:   int(stats.FileCount),
				FolderCount: int(stats.FolderCount),
				TotalSize:   stats.TotalSize,
			})
		}
		// Cache error, fall through to compute
	}

	// Compute stats directly
	stats, err := h.computeFolderStatsInternal(realPath)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to calculate folder stats",
		})
	}

	// Cache the result
	if cache != nil {
		stats.DirModTime = info.ModTime()
		cache.Set(realPath, stats)
	}

	return c.JSON(http.StatusOK, FolderStats{
		Path:        displayPath,
		FileCount:   int(stats.FileCount),
		FolderCount: int(stats.FolderCount),
		TotalSize:   stats.TotalSize,
	})
}

// computeFolderStatsInternal calculates folder statistics
func (h *Handler) computeFolderStatsInternal(realPath string) (*CachedFolderStats, error) {
	var fileCount, folderCount int64
	var totalSize int64

	err := filepath.Walk(realPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}

		// Skip hidden files
		if strings.HasPrefix(info.Name(), ".") {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		// Don't count the root folder itself
		if path == realPath {
			return nil
		}

		if info.IsDir() {
			folderCount++
		} else {
			fileCount++
			totalSize += info.Size()
		}
		return nil
	})

	if err != nil {
		return nil, err
	}

	return &CachedFolderStats{
		FileCount:   fileCount,
		FolderCount: folderCount,
		TotalSize:   totalSize,
	}, nil
}

// BatchGetFolderStats returns statistics for multiple folders at once
func (h *Handler) BatchGetFolderStats(c echo.Context) error {
	var req struct {
		Paths []string `json:"paths"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if len(req.Paths) == 0 || len(req.Paths) > 50 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Paths must contain 1-50 items",
		})
	}

	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	results := make(map[string]interface{})
	cache := GetStatsCache()

	for _, path := range req.Paths {
		realPath, storageType, displayPath, err := h.resolvePath(path, claims)
		if err != nil {
			results[path] = map[string]string{"error": "access denied"}
			continue
		}

		if storageType == "root" {
			results[path] = map[string]string{"error": "invalid path"}
			continue
		}

		// Check shared read permission
		if storageType == StorageShared {
			if claims == nil || !h.CanReadSharedDrive(claims.UserID, path) {
				results[path] = map[string]string{"error": "no permission"}
				continue
			}
		}

		info, err := os.Stat(realPath)
		if err != nil || !info.IsDir() {
			results[path] = map[string]string{"error": "not a directory"}
			continue
		}

		// Try cache
		if cache != nil {
			stats, err := cache.GetOrCompute(realPath, func() (*CachedFolderStats, error) {
				return h.computeFolderStatsInternal(realPath)
			})
			if err == nil {
				results[path] = FolderStats{
					Path:        displayPath,
					FileCount:   int(stats.FileCount),
					FolderCount: int(stats.FolderCount),
					TotalSize:   stats.TotalSize,
				}
				continue
			}
		}

		// Compute directly
		stats, err := h.computeFolderStatsInternal(realPath)
		if err != nil {
			results[path] = map[string]string{"error": "failed to compute"}
			continue
		}

		results[path] = FolderStats{
			Path:        displayPath,
			FileCount:   int(stats.FileCount),
			FolderCount: int(stats.FolderCount),
			TotalSize:   stats.TotalSize,
		}
	}

	return c.JSON(http.StatusOK, results)
}
