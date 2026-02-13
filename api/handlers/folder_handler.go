package handlers

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
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
// @Summary		Create folder
// @Description	Create a new folder at the specified path
// @Tags		Files
// @Accept		json
// @Produce		json
// @Param		request	body		CreateFolderRequest	true	"Folder creation request"
// @Success		201		{object}	docs.SuccessResponse	"Folder created successfully"
// @Failure		400		{object}	map[string]string	"Bad request"
// @Failure		401		{object}	map[string]string	"Unauthorized"
// @Failure		403		{object}	map[string]string	"Forbidden"
// @Failure		409		{object}	map[string]string	"Folder already exists"
// @Failure		500		{object}	map[string]string	"Internal server error"
// @Security	BearerAuth
// @Router		/folders [post]
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
	result, realParentPath, err := h.resolveStorageForOperation(parentPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	storageType := result.StorageType
	displayPath := result.DisplayPath

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

	// Check readonly
	if err := checkReadonly(result); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{
			"error": err.Error(),
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

	newFolderPath := filepath.Join(displayPath, req.Name)

	// Handle non-local external storage
	if storageType == StorageExternal && realParentPath == "" {
		if result.Backend == nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "No backend available",
			})
		}
		ctx := c.Request().Context()
		folderRelPath := result.RelPath
		if folderRelPath != "" {
			folderRelPath = filepath.Join(folderRelPath, req.Name)
		} else {
			folderRelPath = req.Name
		}

		// Check if already exists
		exists, _ := result.Backend.Exists(ctx, folderRelPath)
		if exists {
			return c.JSON(http.StatusConflict, map[string]string{
				"error": "Folder already exists",
			})
		}

		if err := result.Backend.Mkdir(ctx, folderRelPath); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to create folder",
			})
		}

		// Log audit event
		var userID *string
		if claims != nil {
			userID = &claims.UserID
		}
		_ = h.auditHandler.LogEvent(userID, c.RealIP(), EventFolderCreate, newFolderPath, map[string]interface{}{
			"name":       req.Name,
			"parentPath": displayPath,
		})

		return c.JSON(http.StatusCreated, map[string]interface{}{
			"success": true,
			"path":    newFolderPath,
			"name":    req.Name,
		})
	}

	folderPath := filepath.Join(realParentPath, req.Name)

	// Check if already exists
	if _, err := os.Stat(folderPath); err == nil {
		return c.JSON(http.StatusConflict, map[string]string{
			"error": "Folder already exists",
		})
	}

	// Use appropriate permissions based on storage type
	if storageType == StorageShared {
		// Shared folder: 0775 with users group for SMB access
		if err := MkdirAllShared(folderPath); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to create folder",
			})
		}
	} else {
		// Home folder: standard 0755 permissions
		if err := os.MkdirAll(folderPath, 0755); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to create folder",
			})
		}
	}

	// Log audit event
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	_ = h.auditHandler.LogEvent(userID, c.RealIP(), EventFolderCreate, newFolderPath, map[string]interface{}{
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
// @Summary		Delete folder
// @Description	Delete a folder by path. Use force=true to delete non-empty folders.
// @Tags		Files
// @Accept		json
// @Produce		json
// @Param		path	path		string	true	"Folder path"
// @Param		force	query		bool	false	"Force delete non-empty folder"
// @Success		200		{object}	docs.SuccessResponse	"Folder deleted successfully"
// @Failure		400		{object}	map[string]string	"Bad request"
// @Failure		401		{object}	map[string]string	"Unauthorized"
// @Failure		403		{object}	map[string]string	"Forbidden"
// @Failure		404		{object}	map[string]string	"Folder not found"
// @Failure		409		{object}	map[string]string	"Folder is not empty"
// @Failure		500		{object}	map[string]string	"Internal server error"
// @Security	BearerAuth
// @Router		/folders/{path} [delete]
func (h *Handler) DeleteFolder(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Folder path required",
		})
	}

	// URL decode the path for proper handling of special characters
	decodedPath, err := url.PathUnescape(requestPath)
	if err != nil {
		decodedPath = requestPath // fallback to original if decode fails
	}
	requestPath = decodedPath

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	virtualPath := "/" + requestPath
	result, realPath, err := h.resolveStorageForOperation(virtualPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	storageType := result.StorageType
	displayPath := result.DisplayPath

	// Cannot delete root storage types
	if storageType == "root" || displayPath == "/home" || displayPath == "/shared" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot delete root folders",
		})
	}

	// Check readonly
	if err := checkReadonly(result); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{
			"error": err.Error(),
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

	// Check folder locks (files inside this folder locked by other users)
	if claims != nil {
		if lockErr := h.CheckFolderLocksForOperation(displayPath, claims.UserID); lockErr != nil {
			return RespondError(c, lockErr)
		}
	}

	force := c.QueryParam("force") == "true"

	// Handle non-local external storage
	if storageType == StorageExternal && realPath == "" {
		if result.Backend == nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "No backend available",
			})
		}
		ctx := c.Request().Context()

		info, err := result.Backend.Stat(ctx, result.RelPath)
		if err != nil {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "Folder not found",
			})
		}
		if !info.IsDirectory {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Path is not a directory",
			})
		}

		if force {
			if err := result.Backend.DeleteAll(ctx, result.RelPath); err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": "Failed to delete folder",
				})
			}
		} else {
			// Check if empty
			entries, err := result.Backend.ReadDir(ctx, result.RelPath)
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
			if err := result.Backend.Delete(ctx, result.RelPath); err != nil {
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

	// Calculate folder size before deleting (for storage tracking)
	var folderSize int64
	if force {
		folderSize, _ = GetFileSize(realPath)
	}

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

	// Clean up locks under deleted folder
	_ = h.RemoveLocksUnderPath(displayPath)

	// Update storage tracking (only if force delete with non-zero size)
	if force && folderSize > 0 {
		if storageType == StorageShared {
			folderName := ExtractSharedDriveFolderName(virtualPath)
			if err := h.UpdateSharedFolderStorage(folderName, -folderSize); err != nil {
				fmt.Printf("[Storage] Failed to update shared folder storage: %v\n", err)
			}
		} else if storageType == StorageHome && claims != nil {
			if err := h.UpdateUserStorage(claims.UserID, -folderSize); err != nil {
				fmt.Printf("[Storage] Failed to update user storage: %v\n", err)
			}
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"path":    displayPath,
	})
}

// GetFolderStats returns statistics for a folder (recursive file/folder count and total size)
// Uses caching for improved performance
// @Summary		Get folder statistics
// @Description	Get recursive statistics for a folder including file count, folder count, and total size
// @Tags		Files
// @Accept		json
// @Produce		json
// @Param		path		path		string	true	"Folder path"
// @Param		no-cache	query		bool	false	"Bypass cache and recompute stats"
// @Success		200		{object}	FolderStats	"Folder statistics"
// @Failure		400		{object}	map[string]string	"Bad request"
// @Failure		401		{object}	map[string]string	"Unauthorized"
// @Failure		403		{object}	map[string]string	"Forbidden"
// @Failure		404		{object}	map[string]string	"Path not found"
// @Failure		500		{object}	map[string]string	"Internal server error"
// @Security	BearerAuth
// @Router		/folders/stats/{path} [get]
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
	result, realPath, err := h.resolveStorageForOperation(virtualPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	storageType := result.StorageType
	displayPath := result.DisplayPath

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

	// Handle non-local external storage
	if storageType == StorageExternal && realPath == "" {
		if result.Backend == nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "No backend available",
			})
		}
		ctx := c.Request().Context()
		stats, err := computeFolderStatsFromBackend(ctx, result.Backend, result.RelPath)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to calculate folder stats",
			})
		}
		return c.JSON(http.StatusOK, FolderStats{
			Path:        displayPath,
			FileCount:   int(stats.FileCount),
			FolderCount: int(stats.FolderCount),
			TotalSize:   stats.TotalSize,
		})
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
		_ = cache.Set(realPath, stats)
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
		if IsHiddenFile(info.Name()) {
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

// computeFolderStatsFromBackend calculates folder statistics using a StorageBackend
func computeFolderStatsFromBackend(ctx context.Context, backend StorageBackend, relPath string) (*CachedFolderStats, error) {
	var fileCount, folderCount int64
	var totalSize int64

	err := backend.Walk(ctx, relPath, func(path string, info *StorageFileInfo, walkErr error) error {
		if walkErr != nil {
			return nil // Skip errors
		}

		// Skip root directory itself
		if path == relPath || path == "." {
			return nil
		}

		// Skip hidden files
		if IsHiddenFile(info.FileName) {
			if info.IsDirectory {
				return ErrSkipDir
			}
			return nil
		}

		if info.IsDirectory {
			folderCount++
		} else {
			fileCount++
			totalSize += info.FileSize
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
// @Summary		Batch get folder statistics
// @Description	Get statistics for multiple folders in a single request (max 50 folders)
// @Tags		Files
// @Accept		json
// @Produce		json
// @Param		request	body		object{paths=[]string}	true	"List of folder paths"
// @Success		200		{object}	map[string]FolderStats	"Folder statistics by path"
// @Failure		400		{object}	map[string]string	"Bad request"
// @Security	BearerAuth
// @Router		/folders/batch-stats [post]
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
	ctx := c.Request().Context()

	for _, path := range req.Paths {
		result, realPath, err := h.resolveStorageForOperation(path, claims)
		if err != nil {
			results[path] = map[string]string{"error": "access denied"}
			continue
		}

		if result.StorageType == "root" {
			results[path] = map[string]string{"error": "invalid path"}
			continue
		}

		// Check shared read permission
		if result.StorageType == StorageShared {
			if claims == nil || !h.CanReadSharedDrive(claims.UserID, path) {
				results[path] = map[string]string{"error": "no permission"}
				continue
			}
		}

		// Handle non-local external storage
		if result.StorageType == StorageExternal && realPath == "" {
			if result.Backend == nil {
				results[path] = map[string]string{"error": "no backend"}
				continue
			}
			stats, err := computeFolderStatsFromBackend(ctx, result.Backend, result.RelPath)
			if err != nil {
				results[path] = map[string]string{"error": "failed to compute"}
				continue
			}
			results[path] = FolderStats{
				Path:        result.DisplayPath,
				FileCount:   int(stats.FileCount),
				FolderCount: int(stats.FolderCount),
				TotalSize:   stats.TotalSize,
			}
			continue
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
					Path:        result.DisplayPath,
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
			Path:        result.DisplayPath,
			FileCount:   int(stats.FileCount),
			FolderCount: int(stats.FolderCount),
			TotalSize:   stats.TotalSize,
		}
	}

	return c.JSON(http.StatusOK, results)
}
