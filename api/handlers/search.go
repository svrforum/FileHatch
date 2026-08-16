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

// SearchFilter holds advanced search filter parameters
type SearchFilter struct {
	DateFrom  time.Time
	DateTo    time.Time
	MinSize   int64
	MaxSize   int64
	ExtFilter map[string]bool
}

// IsActive returns true if any filter is set
func (f *SearchFilter) IsActive() bool {
	return !f.DateFrom.IsZero() || !f.DateTo.IsZero() || f.MinSize > 0 || f.MaxSize > 0 || len(f.ExtFilter) > 0
}

// Match returns true if the search result passes all active filters
func (f *SearchFilter) Match(result SearchResult) bool {
	// Extension filter
	if len(f.ExtFilter) > 0 {
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(result.Name), "."))
		if !f.ExtFilter[ext] {
			return false
		}
	}
	// Size filter (skip directories for size filtering)
	if !result.IsDir {
		if f.MinSize > 0 && result.Size < f.MinSize {
			return false
		}
		if f.MaxSize > 0 && result.Size > f.MaxSize {
			return false
		}
	}
	// Date filter
	if !f.DateFrom.IsZero() && result.ModTime.Before(f.DateFrom) {
		return false
	}
	if !f.DateTo.IsZero() && result.ModTime.After(f.DateTo) {
		return false
	}
	return true
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

	// Parse advanced filter parameters
	dateFrom := c.QueryParam("dateFrom")
	dateTo := c.QueryParam("dateTo")
	minSizeStr := c.QueryParam("minSize")
	maxSizeStr := c.QueryParam("maxSize")
	extensions := c.QueryParam("ext")

	var minSize, maxSize int64
	if minSizeStr != "" {
		if v, err := strconv.ParseInt(minSizeStr, 10, 64); err == nil && v >= 0 {
			minSize = v
		}
	}
	if maxSizeStr != "" {
		if v, err := strconv.ParseInt(maxSizeStr, 10, 64); err == nil && v >= 0 {
			maxSize = v
		}
	}

	var dateFromTime, dateToTime time.Time
	if dateFrom != "" {
		dateFromTime, _ = time.Parse("2006-01-02", dateFrom)
	}
	if dateTo != "" {
		dateToTime, _ = time.Parse("2006-01-02", dateTo)
		if !dateToTime.IsZero() {
			dateToTime = dateToTime.Add(24*time.Hour - time.Nanosecond) // include the end date fully
		}
	}

	var extFilter map[string]bool
	if extensions != "" {
		extFilter = make(map[string]bool)
		for _, ext := range strings.Split(extensions, ",") {
			ext = strings.TrimSpace(strings.ToLower(ext))
			if ext != "" {
				extFilter[ext] = true
			}
		}
	}

	filter := &SearchFilter{
		DateFrom:  dateFromTime,
		DateTo:    dateToTime,
		MinSize:   minSize,
		MaxSize:   maxSize,
		ExtFilter: extFilter,
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

	// Apply advanced filters
	if filter.IsActive() {
		filtered := make([]SearchResult, 0, len(allResults))
		for _, r := range allResults {
			if filter.Match(r) {
				filtered = append(filtered, r)
			}
		}
		allResults = filtered
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

// readableSharedTargets lists the shared drives the caller may read, one
// search target per drive.
func (h *Handler) readableSharedTargets(claims *JWTClaims) []searchTarget {
	sharedRoot := filepath.Join(h.dataRoot, "shared")
	entries, err := os.ReadDir(sharedRoot)
	if err != nil {
		return nil
	}

	targets := make([]searchTarget, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		displayPath := "/shared/" + entry.Name()
		if !h.CanReadSharedDrive(claims.UserID, displayPath) {
			continue
		}
		targets = append(targets, searchTarget{
			RealPath:    filepath.Join(sharedRoot, entry.Name()),
			DisplayPath: displayPath,
		})
	}
	return targets
}

// parallelSearch searches in multiple directories in parallel
func (h *Handler) parallelSearch(query string, isGlob bool, claims *JWTClaims, maxResults int) []SearchResult {
	targets := []searchTarget{}

	if claims == nil {
		// Nothing is searchable anonymously. Previously /shared was scanned
		// unconditionally, so an unauthenticated query returned every team's
		// filenames.
		return []SearchResult{}
	}

	targets = append(targets, searchTarget{
		RealPath:    filepath.Join(h.dataRoot, "users", claims.Username),
		DisplayPath: "/home",
	})

	// Search each shared folder the caller is actually a member of, rather
	// than /shared as a whole.
	targets = append(targets, h.readableSharedTargets(claims)...)

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
		if IsHiddenFile(entry.Name()) {
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
				if IsHiddenFile(info.Name()) {
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
