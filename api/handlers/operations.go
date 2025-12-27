package handlers

import (
	"archive/zip"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
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

	// URL decode the path in case browser didn't encode special characters
	if decodedPath, err := url.QueryUnescape(requestPath); err == nil {
		requestPath = decodedPath
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

	// Log audit event
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	// Get file info for isDir check
	fileInfo, _ := os.Stat(newRealPath)
	isDir := fileInfo != nil && fileInfo.IsDir()
	h.auditHandler.LogEvent(userID, c.RealIP(), EventFileRename, displayPath, map[string]interface{}{
		"newName": req.NewName,
		"newPath": newDisplayPath,
		"isDir":   isDir,
	})

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

	// URL decode the path in case browser didn't encode special characters
	decodedPath, err := url.QueryUnescape(requestPath)
	if err == nil {
		requestPath = decodedPath
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

	// Log audit event
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	h.auditHandler.LogEvent(userID, c.RealIP(), EventFileMove, srcDisplayPath, map[string]interface{}{
		"destination": newDisplayPath,
		"isDir":       srcInfo.IsDir(),
	})

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

	// URL decode the path in case browser didn't encode special characters
	if decodedPath, err := url.QueryUnescape(requestPath); err == nil {
		requestPath = decodedPath
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

	// Log audit event
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	h.auditHandler.LogEvent(userID, c.RealIP(), EventFileCopy, srcDisplayPath, map[string]interface{}{
		"destination": newDisplayPath,
		"isDir":       srcInfo.IsDir(),
	})

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
	Name         string     `json:"name"`
	Path         string     `json:"path"`
	Size         int64      `json:"size"`
	IsDir        bool       `json:"isDir"`
	ModTime      time.Time  `json:"modTime"`
	Extension    string     `json:"extension,omitempty"`
	MimeType     string     `json:"mimeType,omitempty"`
	MatchType    string     `json:"matchType,omitempty"`   // "name", "tag", "description", "trash"
	MatchedTag   string     `json:"matchedTag,omitempty"`  // The matched tag (if matchType is "tag")
	Description  string     `json:"description,omitempty"` // File description
	Tags         []string   `json:"tags,omitempty"`        // File tags
	InTrash      bool       `json:"inTrash,omitempty"`     // Whether the item is in trash
	TrashID      string     `json:"trashId,omitempty"`     // Trash ID for restore/delete
	OriginalPath string     `json:"originalPath,omitempty"` // Original path before deletion
	DeletedAt    *time.Time `json:"deletedAt,omitempty"`   // When the item was deleted
}

// SearchResponse is the response for search queries
type SearchResponse struct {
	Query     string         `json:"query"`
	Results   []SearchResult `json:"results"`
	Total     int            `json:"total"`
	Page      int            `json:"page"`
	Limit     int            `json:"limit"`
	HasMore   bool           `json:"hasMore"`
	MatchType string         `json:"matchType,omitempty"` // Filter applied: "all", "name", "tag", "description", "trash"
}

// SearchFiles searches for files and folders by name, tag, or description
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

	// Parse pagination parameters
	page := 1
	if p := c.QueryParam("page"); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil && parsed > 0 {
			page = parsed
		}
	}

	limit := 20
	if l := c.QueryParam("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	// Parse match type filter: "all", "name", "tag", "description"
	matchTypeFilter := c.QueryParam("matchType")
	if matchTypeFilter == "" {
		matchTypeFilter = "all"
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	queryLower := strings.ToLower(query)
	// Fetch more than needed for pagination
	maxResults := 500

	var allResults []SearchResult

	// Search by file name (only if filter allows)
	if matchTypeFilter == "all" || matchTypeFilter == "name" {
		if searchPath == "/" {
			allResults = h.parallelSearch(queryLower, claims, maxResults)
		} else {
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

			allResults = h.searchInDirParallel(realPath, displayPath, queryLower, maxResults)
		}
	}

	// Search in file metadata (tags and descriptions)
	if claims != nil && (matchTypeFilter == "all" || matchTypeFilter == "tag" || matchTypeFilter == "description") {
		metadataResults := h.searchInMetadataFiltered(queryLower, claims.UserID, maxResults, matchTypeFilter)

		// Merge results, avoiding duplicates
		existingPaths := make(map[string]bool)
		for _, r := range allResults {
			existingPaths[r.Path] = true
		}

		for _, mr := range metadataResults {
			if !existingPaths[mr.Path] {
				allResults = append(allResults, mr)
				existingPaths[mr.Path] = true
			}
		}
	}

	// Apply pagination
	totalCount := len(allResults)
	startIdx := (page - 1) * limit
	endIdx := startIdx + limit

	var paginatedResults []SearchResult
	if startIdx < totalCount {
		if endIdx > totalCount {
			endIdx = totalCount
		}
		paginatedResults = allResults[startIdx:endIdx]
	}

	// Ensure results is never nil
	if paginatedResults == nil {
		paginatedResults = []SearchResult{}
	}

	hasMore := endIdx < totalCount

	return c.JSON(http.StatusOK, SearchResponse{
		Query:     query,
		Results:   paginatedResults,
		Total:     totalCount,
		Page:      page,
		Limit:     limit,
		HasMore:   hasMore,
		MatchType: matchTypeFilter,
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
				MatchType: "name",
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
					Name:      dir.Name(),
					Path:      dirDisplayPath,
					Size:      0,
					IsDir:     true,
					ModTime:   info.ModTime(),
					MatchType: "name",
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
						MatchType: "name",
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

// searchInMetadata searches for files by tag or description in the database
func (h *Handler) searchInMetadata(query, userID string, maxResults int) []SearchResult {
	var results []SearchResult

	// Search by tag (exact match or contains)
	tagRows, err := h.db.Query(`
		SELECT file_path, description, tags
		FROM file_metadata
		WHERE user_id = $1 AND (
			EXISTS (
				SELECT 1 FROM jsonb_array_elements_text(tags) AS tag
				WHERE LOWER(tag) LIKE '%' || $2 || '%'
			)
			OR LOWER(description) LIKE '%' || $2 || '%'
		)
		LIMIT $3
	`, userID, query, maxResults)

	if err != nil {
		return results
	}
	defer tagRows.Close()

	for tagRows.Next() {
		var filePath, description string
		var tagsJSON []byte

		if err := tagRows.Scan(&filePath, &description, &tagsJSON); err != nil {
			continue
		}

		// Parse tags
		var tags []string
		json.Unmarshal(tagsJSON, &tags)

		// Determine match type
		matchType := ""
		matchedTag := ""

		// Check if matched by tag
		for _, tag := range tags {
			if strings.Contains(strings.ToLower(tag), query) {
				matchType = "tag"
				matchedTag = tag
				break
			}
		}

		// If not matched by tag, it must be description
		if matchType == "" && strings.Contains(strings.ToLower(description), query) {
			matchType = "description"
		}

		// Get file info from filesystem
		realPath, storageType, _, err := h.resolvePathByUserID(filePath, userID)
		if err != nil || storageType == "root" {
			continue
		}

		info, err := os.Stat(realPath)
		if err != nil {
			continue
		}

		ext := ""
		mimeType := ""
		if !info.IsDir() {
			ext = strings.ToLower(strings.TrimPrefix(filepath.Ext(info.Name()), "."))
			mimeType = getMimeType(ext)
		}

		results = append(results, SearchResult{
			Name:        info.Name(),
			Path:        filePath,
			Size:        info.Size(),
			IsDir:       info.IsDir(),
			ModTime:     info.ModTime(),
			Extension:   ext,
			MimeType:    mimeType,
			MatchType:   matchType,
			MatchedTag:  matchedTag,
			Description: description,
			Tags:        tags,
		})

		if len(results) >= maxResults {
			break
		}
	}

	return results
}

// searchInMetadataFiltered searches for files by tag or description with match type filter
func (h *Handler) searchInMetadataFiltered(query, userID string, maxResults int, matchTypeFilter string) []SearchResult {
	var results []SearchResult

	// Build query based on filter
	var sqlQuery string
	switch matchTypeFilter {
	case "tag":
		sqlQuery = `
			SELECT file_path, description, tags
			FROM file_metadata
			WHERE user_id = $1 AND EXISTS (
				SELECT 1 FROM jsonb_array_elements_text(tags) AS tag
				WHERE LOWER(tag) LIKE '%' || $2 || '%'
			)
			LIMIT $3
		`
	case "description":
		sqlQuery = `
			SELECT file_path, description, tags
			FROM file_metadata
			WHERE user_id = $1 AND LOWER(description) LIKE '%' || $2 || '%'
			LIMIT $3
		`
	default: // "all"
		sqlQuery = `
			SELECT file_path, description, tags
			FROM file_metadata
			WHERE user_id = $1 AND (
				EXISTS (
					SELECT 1 FROM jsonb_array_elements_text(tags) AS tag
					WHERE LOWER(tag) LIKE '%' || $2 || '%'
				)
				OR LOWER(description) LIKE '%' || $2 || '%'
			)
			LIMIT $3
		`
	}

	rows, err := h.db.Query(sqlQuery, userID, query, maxResults)
	if err != nil {
		return results
	}
	defer rows.Close()

	for rows.Next() {
		var filePath, description string
		var tagsJSON []byte

		if err := rows.Scan(&filePath, &description, &tagsJSON); err != nil {
			continue
		}

		// Parse tags
		var tags []string
		json.Unmarshal(tagsJSON, &tags)

		// Determine match type
		matchType := ""
		matchedTag := ""

		// Check if matched by tag
		for _, tag := range tags {
			if strings.Contains(strings.ToLower(tag), query) {
				matchType = "tag"
				matchedTag = tag
				break
			}
		}

		// If not matched by tag, check description
		if matchType == "" && strings.Contains(strings.ToLower(description), query) {
			matchType = "description"
		}

		// Skip if filter doesn't match
		if matchTypeFilter != "all" && matchType != matchTypeFilter {
			continue
		}

		// Get file info from filesystem
		realPath, storageType, _, err := h.resolvePathByUserID(filePath, userID)
		if err != nil || storageType == "root" {
			continue
		}

		info, err := os.Stat(realPath)
		if err != nil {
			continue
		}

		ext := ""
		mimeType := ""
		if !info.IsDir() {
			ext = strings.ToLower(strings.TrimPrefix(filepath.Ext(info.Name()), "."))
			mimeType = getMimeType(ext)
		}

		results = append(results, SearchResult{
			Name:        info.Name(),
			Path:        filePath,
			Size:        info.Size(),
			IsDir:       info.IsDir(),
			ModTime:     info.ModTime(),
			Extension:   ext,
			MimeType:    mimeType,
			MatchType:   matchType,
			MatchedTag:  matchedTag,
			Description: description,
			Tags:        tags,
		})

		if len(results) >= maxResults {
			break
		}
	}

	return results
}

// resolvePathByUserID resolves a virtual path to real path using user ID
func (h *Handler) resolvePathByUserID(virtualPath, userID string) (realPath, storageType, displayPath string, err error) {
	parts := strings.SplitN(strings.TrimPrefix(virtualPath, "/"), "/", 2)
	if len(parts) == 0 {
		return "", "root", "/", nil
	}

	root := parts[0]
	remaining := ""
	if len(parts) > 1 {
		remaining = parts[1]
	}

	// Get username from user ID
	var username string
	err = h.db.QueryRow("SELECT username FROM users WHERE id = $1", userID).Scan(&username)
	if err != nil {
		return "", "", "", err
	}

	switch root {
	case "home":
		realPath = filepath.Join(h.dataRoot, "users", username, remaining)
		storageType = "home"
		displayPath = virtualPath
	case "shared":
		realPath = filepath.Join(h.dataRoot, "shared", remaining)
		storageType = "shared"
		displayPath = virtualPath
	default:
		return "", "root", "/", nil
	}

	return realPath, storageType, displayPath, nil
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

// searchInTrash searches for items in the user's trash by name
func (h *Handler) searchInTrash(query, username string, maxResults int) []SearchResult {
	var results []SearchResult

	meta, err := h.loadTrashMeta(username)
	if err != nil {
		return results
	}

	for _, item := range meta {
		// Check if name matches query (case-insensitive)
		if !strings.Contains(strings.ToLower(item.Name), query) {
			continue
		}

		ext := ""
		mimeType := ""
		if !item.IsDir {
			ext = strings.ToLower(strings.TrimPrefix(filepath.Ext(item.Name), "."))
			mimeType = getMimeType(ext)
		}

		deletedAt := item.DeletedAt
		results = append(results, SearchResult{
			Name:         item.Name,
			Path:         "/trash/" + item.ID, // Virtual path for trash items
			Size:         item.Size,
			IsDir:        item.IsDir,
			ModTime:      item.DeletedAt,
			Extension:    ext,
			MimeType:     mimeType,
			MatchType:    "trash",
			InTrash:      true,
			TrashID:      item.ID,
			OriginalPath: item.OriginalPath,
			DeletedAt:    &deletedAt,
		})

		if len(results) >= maxResults {
			break
		}
	}

	return results
}

// CompressRequest is the request body for compressing files
type CompressRequest struct {
	Paths      []string `json:"paths"`      // List of file/folder paths to compress
	OutputName string   `json:"outputName"` // Optional: output zip file name (without .zip)
}

// CompressFiles creates a zip archive from selected files/folders
func (h *Handler) CompressFiles(c echo.Context) error {
	var req CompressRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}

	fmt.Printf("[Compress] Request: paths=%v, outputName=%s\n", req.Paths, req.OutputName)

	if len(req.Paths) == 0 {
		return RespondError(c, ErrMissingParameter("paths"))
	}

	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	// Determine output directory (parent of first item)
	firstPath := req.Paths[0]
	parentPath := filepath.Dir(firstPath)
	if parentPath == "." {
		parentPath = "/"
	}

	// Resolve parent path to get real path
	parentRealPath, _, parentDisplayPath, err := h.resolvePath(parentPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}

	// Generate output filename
	outputName := req.OutputName
	if outputName == "" {
		if len(req.Paths) == 1 {
			// Use the first item's name
			outputName = filepath.Base(req.Paths[0])
		} else {
			// Use timestamp
			outputName = fmt.Sprintf("archive_%s", time.Now().Format("20060102_150405"))
		}
	}

	// Ensure .zip extension
	if !strings.HasSuffix(strings.ToLower(outputName), ".zip") {
		outputName += ".zip"
	}

	// Check if output file already exists, add suffix if needed
	outputPath := filepath.Join(parentRealPath, outputName)
	baseName := strings.TrimSuffix(outputName, ".zip")
	counter := 1
	for {
		if _, err := os.Stat(outputPath); os.IsNotExist(err) {
			break
		}
		outputName = fmt.Sprintf("%s (%d).zip", baseName, counter)
		outputPath = filepath.Join(parentRealPath, outputName)
		counter++
	}

	// Create zip file
	zipFile, err := os.Create(outputPath)
	if err != nil {
		return RespondError(c, ErrOperationFailed("create zip file", err))
	}
	defer zipFile.Close()

	zipWriter := zip.NewWriter(zipFile)
	defer zipWriter.Close()

	// Add each path to the zip
	for _, path := range req.Paths {
		realPath, _, _, err := h.resolvePath(path, claims)
		if err != nil {
			continue // Skip invalid paths
		}

		info, err := os.Stat(realPath)
		if err != nil {
			continue // Skip non-existent paths
		}

		baseName := filepath.Base(path)

		if info.IsDir() {
			// Add directory recursively
			err = h.addDirToZip(zipWriter, realPath, baseName)
		} else {
			// Add single file
			err = h.addFileToZip(zipWriter, realPath, baseName)
		}

		if err != nil {
			// Log error but continue with other files
			fmt.Printf("[Compress] Error adding %s: %v\n", path, err)
		}
	}

	// Close zip writer to flush
	zipWriter.Close()
	zipFile.Close()

	// Get final file info
	finalInfo, _ := os.Stat(outputPath)
	var finalSize int64
	if finalInfo != nil {
		finalSize = finalInfo.Size()
	}

	// Log audit event
	h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file.compress", parentDisplayPath+"/"+outputName, map[string]interface{}{
		"sourceCount": len(req.Paths),
		"sources":     req.Paths,
		"outputSize":  finalSize,
	})

	// Invalidate storage cache
	InvalidateStorageCache(claims.Username)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":    true,
		"outputPath": parentDisplayPath + "/" + outputName,
		"outputName": outputName,
		"size":       finalSize,
	})
}

// addFileToZip adds a single file to the zip archive
func (h *Handler) addFileToZip(zipWriter *zip.Writer, filePath, zipPath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return err
	}

	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	header.Name = zipPath
	header.Method = zip.Deflate

	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		return err
	}

	_, err = io.Copy(writer, file)
	return err
}

// addDirToZip adds a directory recursively to the zip archive
func (h *Handler) addDirToZip(zipWriter *zip.Writer, dirPath, zipBasePath string) error {
	return filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}

		// Skip hidden files
		if strings.HasPrefix(info.Name(), ".") && path != dirPath {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		// Calculate relative path within zip
		relPath, err := filepath.Rel(dirPath, path)
		if err != nil {
			return nil
		}

		zipPath := filepath.Join(zipBasePath, relPath)
		zipPath = filepath.ToSlash(zipPath) // Use forward slashes in zip

		if info.IsDir() {
			// Add directory entry
			_, err := zipWriter.Create(zipPath + "/")
			return err
		}

		// Add file
		return h.addFileToZip(zipWriter, path, zipPath)
	})
}

// ExtractRequest is the request body for extracting zip files
type ExtractRequest struct {
	Path       string `json:"path"`       // Path to the zip file
	OutputPath string `json:"outputPath"` // Optional: where to extract (defaults to same directory as zip)
}

// ExtractZip extracts a zip archive
func (h *Handler) ExtractZip(c echo.Context) error {
	var req ExtractRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}

	if req.Path == "" {
		return RespondError(c, ErrBadRequest("Path is required"))
	}

	// Get user claims
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	// Resolve the zip file path
	realZipPath, _, displayPath, err := h.resolvePath(req.Path, claims)
	if err != nil {
		return RespondError(c, ErrForbidden(err.Error()))
	}

	// Check if it's a zip file
	if !strings.HasSuffix(strings.ToLower(req.Path), ".zip") {
		return RespondError(c, ErrBadRequest("Only .zip files can be extracted"))
	}

	// Check if file exists
	if _, err := os.Stat(realZipPath); os.IsNotExist(err) {
		return RespondError(c, ErrNotFound("Zip file not found"))
	}

	// Determine output directory
	var outputDir string
	var outputDisplayPath string
	if req.OutputPath != "" {
		outputDir, _, outputDisplayPath, err = h.resolvePath(req.OutputPath, claims)
		if err != nil {
			return RespondError(c, ErrForbidden(err.Error()))
		}
	} else {
		// Extract to the same directory as the zip file
		outputDir = filepath.Dir(realZipPath)
		outputDisplayPath = filepath.Dir(displayPath)
	}

	// Create a folder with the zip file name (without extension)
	zipBaseName := strings.TrimSuffix(filepath.Base(req.Path), ".zip")
	extractDir := filepath.Join(outputDir, zipBaseName)
	extractDisplayPath := filepath.Join(outputDisplayPath, zipBaseName)

	// If folder already exists, add a number suffix
	originalExtractDir := extractDir
	originalExtractDisplayPath := extractDisplayPath
	counter := 1
	for {
		if _, err := os.Stat(extractDir); os.IsNotExist(err) {
			break
		}
		extractDir = fmt.Sprintf("%s_%d", originalExtractDir, counter)
		extractDisplayPath = fmt.Sprintf("%s_%d", originalExtractDisplayPath, counter)
		counter++
	}

	// Create extract directory
	if err := os.MkdirAll(extractDir, 0755); err != nil {
		return RespondError(c, ErrInternal("Failed to create extraction directory"))
	}

	// Open the zip file
	reader, err := zip.OpenReader(realZipPath)
	if err != nil {
		os.RemoveAll(extractDir) // Cleanup on error
		return RespondError(c, ErrInternal("Failed to open zip file"))
	}
	defer reader.Close()

	// Extract files
	var extractedCount int
	for _, file := range reader.File {
		// Sanitize the file path to prevent zip slip attacks
		destPath := filepath.Join(extractDir, file.Name)
		if !strings.HasPrefix(destPath, filepath.Clean(extractDir)+string(os.PathSeparator)) {
			continue // Skip files that would extract outside the target directory
		}

		if file.FileInfo().IsDir() {
			os.MkdirAll(destPath, file.Mode())
			continue
		}

		// Create parent directories
		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			continue
		}

		// Extract file
		if err := h.extractZipFile(file, destPath); err != nil {
			continue
		}
		extractedCount++
	}

	// Log audit event
	h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file.extract", displayPath, map[string]interface{}{
		"extractedTo":    extractDisplayPath,
		"extractedCount": extractedCount,
	})

	// Invalidate storage cache
	InvalidateStorageCache(claims.Username)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":        true,
		"extractedPath":  extractDisplayPath,
		"extractedCount": extractedCount,
	})
}

// extractZipFile extracts a single file from the zip archive
func (h *Handler) extractZipFile(file *zip.File, destPath string) error {
	rc, err := file.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	destFile, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.Mode())
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, rc)
	return err
}
