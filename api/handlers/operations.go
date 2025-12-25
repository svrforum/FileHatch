package handlers

import (
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
	lop "github.com/samber/lo/parallel"
)

// RenameRequest is the request body for renaming files or folders
type RenameRequest struct {
	NewName string `json:"newName"`
}

// RenameItem renames a file or folder
func (h *Handler) RenameItem(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Path required",
		})
	}

	var req RenameRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if req.NewName == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "New name required",
		})
	}

	// Validate new name
	if strings.ContainsAny(req.NewName, `/\:*?"<>|`) {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid name",
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

	if storageType == "root" || displayPath == "/home" || displayPath == "/shared" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot rename root folders",
		})
	}

	// Check permissions for home folder
	if storageType == StorageHome && claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	// Check if source exists
	if _, err := os.Stat(realPath); err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "Item not found",
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to access item",
		})
	}

	// Build new path
	parentDir := filepath.Dir(realPath)
	newRealPath := filepath.Join(parentDir, req.NewName)

	// Check if destination already exists
	if _, err := os.Stat(newRealPath); err == nil {
		return c.JSON(http.StatusConflict, map[string]string{
			"error": "An item with that name already exists",
		})
	}

	// Rename
	if err := os.Rename(realPath, newRealPath); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to rename item",
		})
	}

	newDisplayPath := filepath.Join(filepath.Dir(displayPath), req.NewName)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"oldPath": displayPath,
		"newPath": newDisplayPath,
		"newName": req.NewName,
	})
}

// MoveRequest is the request body for moving files or folders
type MoveRequest struct {
	Destination string `json:"destination"`
}

// MoveItem moves a file or folder to a new location
func (h *Handler) MoveItem(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Path required",
		})
	}

	var req MoveRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if req.Destination == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Destination required",
		})
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve source path
	srcRealPath, srcStorageType, srcDisplayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	if srcStorageType == "root" || srcDisplayPath == "/home" || srcDisplayPath == "/shared" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot move root folders",
		})
	}

	// Resolve destination path
	destRealPath, destStorageType, destDisplayPath, err := h.resolvePath(req.Destination, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	if destStorageType == "root" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot move to root",
		})
	}

	// Check permissions
	if (srcStorageType == StorageHome || destStorageType == StorageHome) && claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	// Check if source exists
	srcInfo, err := os.Stat(srcRealPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "Source not found",
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to access source",
		})
	}

	// Check if destination is a directory
	destInfo, err := os.Stat(destRealPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "Destination not found",
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to access destination",
		})
	}

	if !destInfo.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Destination must be a directory",
		})
	}

	// Build final destination path
	finalDestPath := filepath.Join(destRealPath, srcInfo.Name())

	// Check if destination already exists
	if _, err := os.Stat(finalDestPath); err == nil {
		return c.JSON(http.StatusConflict, map[string]string{
			"error": "An item with that name already exists at destination",
		})
	}

	// Move (rename)
	if err := os.Rename(srcRealPath, finalDestPath); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to move item",
		})
	}

	newDisplayPath := filepath.Join(destDisplayPath, srcInfo.Name())

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"oldPath": srcDisplayPath,
		"newPath": newDisplayPath,
	})
}

// CopyRequest is the request body for copying files or folders
type CopyRequest struct {
	Destination string `json:"destination"`
}

// CopyItem copies a file or folder to a new location
func (h *Handler) CopyItem(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Path required",
		})
	}

	var req CopyRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if req.Destination == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Destination required",
		})
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve source path
	srcRealPath, srcStorageType, srcDisplayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	if srcStorageType == "root" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot copy root",
		})
	}

	// Resolve destination path
	destRealPath, destStorageType, destDisplayPath, err := h.resolvePath(req.Destination, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	if destStorageType == "root" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot copy to root",
		})
	}

	// Check permissions
	if (srcStorageType == StorageHome || destStorageType == StorageHome) && claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	// Check if source exists
	srcInfo, err := os.Stat(srcRealPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "Source not found",
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to access source",
		})
	}

	// Check if destination is a directory
	destInfo, err := os.Stat(destRealPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "Destination not found",
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to access destination",
		})
	}

	if !destInfo.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Destination must be a directory",
		})
	}

	// Build final destination path
	finalDestPath := filepath.Join(destRealPath, srcInfo.Name())

	// Check if destination already exists - if so, create a copy with a number
	baseName := srcInfo.Name()
	ext := filepath.Ext(baseName)
	nameWithoutExt := strings.TrimSuffix(baseName, ext)
	counter := 1
	for {
		if _, err := os.Stat(finalDestPath); os.IsNotExist(err) {
			break
		}
		if srcInfo.IsDir() {
			finalDestPath = filepath.Join(destRealPath, fmt.Sprintf("%s (%d)", baseName, counter))
		} else {
			finalDestPath = filepath.Join(destRealPath, fmt.Sprintf("%s (%d)%s", nameWithoutExt, counter, ext))
		}
		counter++
	}

	// Perform copy
	if srcInfo.IsDir() {
		err = copyDir(srcRealPath, finalDestPath)
	} else {
		err = copyFile(srcRealPath, finalDestPath)
	}

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to copy item: " + err.Error(),
		})
	}

	newDisplayPath := filepath.Join(destDisplayPath, filepath.Base(finalDestPath))

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"oldPath": srcDisplayPath,
		"newPath": newDisplayPath,
	})
}

// copyFile copies a single file
func copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	destFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, sourceFile)
	if err != nil {
		return err
	}

	// Copy file permissions
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}
	return os.Chmod(dst, srcInfo.Mode())
}

// copyDir recursively copies a directory
func copyDir(src, dst string) error {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dst, srcInfo.Mode()); err != nil {
		return err
	}

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if entry.IsDir() {
			if err := copyDir(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}

	return nil
}

// SearchResult represents a search result item
type SearchResult struct {
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	Size      int64     `json:"size"`
	IsDir     bool      `json:"isDir"`
	ModTime   time.Time `json:"modTime"`
	Extension string    `json:"extension,omitempty"`
	MimeType  string    `json:"mimeType,omitempty"`
}

// SearchResponse is the response for search queries
type SearchResponse struct {
	Query   string         `json:"query"`
	Results []SearchResult `json:"results"`
	Total   int            `json:"total"`
}

// SearchFiles searches for files and folders by name
func (h *Handler) SearchFiles(c echo.Context) error {
	query := c.QueryParam("q")
	if query == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Search query required",
		})
	}

	searchPath := c.QueryParam("path")
	if searchPath == "" {
		searchPath = "/"
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	query = strings.ToLower(query)
	maxResults := 100

	var results []SearchResult

	// Search in both home and shared if root
	if searchPath == "/" {
		// Parallel search in shared and home
		results = h.parallelSearch(query, claims, maxResults)
	} else {
		// Search in specific path
		realPath, storageType, displayPath, err := h.resolvePath(searchPath, claims)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": err.Error(),
			})
		}

		if storageType == "root" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Cannot search root",
			})
		}

		results = h.searchInDirParallel(realPath, displayPath, query, maxResults)
	}

	return c.JSON(http.StatusOK, SearchResponse{
		Query:   query,
		Results: results,
		Total:   len(results),
	})
}

// searchTarget represents a directory to search
type searchTarget struct {
	RealPath    string
	DisplayPath string
}

// parallelSearch searches in multiple directories in parallel
func (h *Handler) parallelSearch(query string, claims *JWTClaims, maxResults int) []SearchResult {
	// Collect search targets
	targets := []searchTarget{
		{
			RealPath:    filepath.Join(h.dataRoot, "shared"),
			DisplayPath: "/shared",
		},
	}

	if claims != nil {
		targets = append(targets, searchTarget{
			RealPath:    filepath.Join(h.dataRoot, "users", claims.Username),
			DisplayPath: "/home",
		})
	}

	// Search all targets in parallel
	allResults := lop.Map(targets, func(target searchTarget, _ int) []SearchResult {
		return h.searchInDirParallel(target.RealPath, target.DisplayPath, query, maxResults)
	})

	// Merge results
	var merged []SearchResult
	for _, results := range allResults {
		merged = append(merged, results...)
		if len(merged) >= maxResults {
			merged = merged[:maxResults]
			break
		}
	}

	return merged
}

// searchInDirParallel searches for files in a directory using parallel processing
func (h *Handler) searchInDirParallel(realPath, displayPath, query string, maxResults int) []SearchResult {
	// First, collect top-level directories for parallel processing
	entries, err := os.ReadDir(realPath)
	if err != nil {
		return nil
	}

	// Filter out hidden entries and separate files from directories
	var files []os.DirEntry
	var dirs []os.DirEntry
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if entry.IsDir() {
			dirs = append(dirs, entry)
		} else {
			files = append(files, entry)
		}
	}

	// Results collector with mutex for thread safety
	var mu sync.Mutex
	var results []SearchResult

	// Helper to add result safely
	addResult := func(result SearchResult) bool {
		mu.Lock()
		defer mu.Unlock()
		if len(results) >= maxResults {
			return false
		}
		results = append(results, result)
		return true
	}

	// Process top-level files first (quick)
	for _, file := range files {
		info, err := file.Info()
		if err != nil {
			continue
		}
		if strings.Contains(strings.ToLower(file.Name()), query) {
			ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(file.Name()), "."))
			addResult(SearchResult{
				Name:      file.Name(),
				Path:      filepath.Join(displayPath, file.Name()),
				Size:      info.Size(),
				IsDir:     false,
				ModTime:   info.ModTime(),
				Extension: ext,
				MimeType:  getMimeType(ext),
			})
		}
	}

	// Process directories in parallel
	if len(dirs) > 0 {
		lop.ForEach(dirs, func(dir os.DirEntry, _ int) {
			// Check if we've reached max results
			mu.Lock()
			if len(results) >= maxResults {
				mu.Unlock()
				return
			}
			mu.Unlock()

			dirPath := filepath.Join(realPath, dir.Name())
			dirDisplayPath := filepath.Join(displayPath, dir.Name())

			// Check if directory name matches
			info, err := dir.Info()
			if err == nil && strings.Contains(strings.ToLower(dir.Name()), query) {
				addResult(SearchResult{
					Name:    dir.Name(),
					Path:    dirDisplayPath,
					Size:    0,
					IsDir:   true,
					ModTime: info.ModTime(),
				})
			}

			// Search inside directory
			filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
				if err != nil {
					return nil
				}

				// Check limit
				mu.Lock()
				if len(results) >= maxResults {
					mu.Unlock()
					return filepath.SkipAll
				}
				mu.Unlock()

				// Skip the root of this walk (already handled above)
				if path == dirPath {
					return nil
				}

				// Skip hidden files
				if strings.HasPrefix(info.Name(), ".") {
					if info.IsDir() {
						return filepath.SkipDir
					}
					return nil
				}

				// Check if name contains query
				if strings.Contains(strings.ToLower(info.Name()), query) {
					relPath, _ := filepath.Rel(realPath, path)
					itemDisplayPath := filepath.Join(displayPath, relPath)

					ext := ""
					mimeType := ""
					if !info.IsDir() {
						ext = strings.ToLower(strings.TrimPrefix(filepath.Ext(info.Name()), "."))
						mimeType = getMimeType(ext)
					}

					if !addResult(SearchResult{
						Name:      info.Name(),
						Path:      itemDisplayPath,
						Size:      info.Size(),
						IsDir:     info.IsDir(),
						ModTime:   info.ModTime(),
						Extension: ext,
						MimeType:  mimeType,
					}) {
						return filepath.SkipAll
					}
				}

				return nil
			})
		})
	}

	return results
}

// searchInDir recursively searches for files in a directory (legacy, for compatibility)
func (h *Handler) searchInDir(realPath, displayPath, query string, results *[]SearchResult, maxResults int) {
	parallelResults := h.searchInDirParallel(realPath, displayPath, query, maxResults-len(*results))
	*results = append(*results, parallelResults...)
}

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
				"totalUsed":  cached.TotalUsed,
				"quota":      cached.Quota,
				"cached":     true,
				"cachedAt":   cached.CachedAt,
			})
		}
	}

	// Calculate storage usage (cache miss or force refresh)
	var sharedSize, homeSize int64

	// Calculate shared folder usage in background-friendly way
	sharedPath := filepath.Join(h.dataRoot, "shared")
	sharedSize, _ = h.calculateDirSize(sharedPath)

	// Calculate home folder usage if authenticated
	if claims != nil {
		homePath := filepath.Join(h.dataRoot, "users", claims.Username)
		homeSize, _ = h.calculateDirSize(homePath)
	}

	totalUsed := sharedSize + homeSize

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
		TotalUsed:  totalUsed,
		Quota:      totalQuota,
	}
	cache.SetUserUsage(username, usageData)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"homeUsed":   homeSize,
		"sharedUsed": sharedSize,
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
