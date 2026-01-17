package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
	lop "github.com/samber/lo/parallel"
)

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

// isGlobPattern checks if a query string contains glob pattern characters
func isGlobPattern(query string) bool {
	return strings.ContainsAny(query, "*?[")
}

// matchFileName checks if a filename matches the query using either glob pattern or substring
func matchFileName(filename, query string, isGlob bool) bool {
	filenameLower := strings.ToLower(filename)
	if isGlob {
		matched, err := filepath.Match(query, filenameLower)
		if err != nil {
			return false
		}
		return matched
	}
	return strings.Contains(filenameLower, query)
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
	isGlob := isGlobPattern(queryLower)
	// Fetch more than needed for pagination
	maxResults := 500

	var allResults []SearchResult

	// Search by file name (only if filter allows)
	if matchTypeFilter == "all" || matchTypeFilter == "name" {
		if searchPath == "/" {
			allResults = h.parallelSearch(queryLower, isGlob, claims, maxResults)
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

			allResults = h.searchInDirParallel(realPath, displayPath, queryLower, isGlob, maxResults)
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
func (h *Handler) parallelSearch(query string, isGlob bool, claims *JWTClaims, maxResults int) []SearchResult {
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
		return h.searchInDirParallel(target.RealPath, target.DisplayPath, query, isGlob, maxResults)
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
func (h *Handler) searchInDirParallel(realPath, displayPath, query string, isGlob bool, maxResults int) []SearchResult {
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
		if matchFileName(file.Name(), query, isGlob) {
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
			if err == nil && matchFileName(dir.Name(), query, isGlob) {
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
			_ = filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
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

				// Check if name matches query (glob or substring)
				if matchFileName(info.Name(), query, isGlob) {
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
	isGlob := isGlobPattern(query)
	parallelResults := h.searchInDirParallel(realPath, displayPath, query, isGlob, maxResults-len(*results))
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
		_ = json.Unmarshal(tagsJSON, &tags)

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
		_ = json.Unmarshal(tagsJSON, &tags)

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
