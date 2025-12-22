package handlers

import (
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

type Handler struct {
	db           *sql.DB
	dataRoot     string
	auditHandler *AuditHandler
}

func NewHandler(db *sql.DB) *Handler {
	return &Handler{
		db:           db,
		dataRoot:     "/data",
		auditHandler: NewAuditHandler(db),
	}
}

// Storage types
const (
	StorageHome   = "home"   // Personal home folder
	StorageShared = "shared" // Shared folder for all users
)

type HealthResponse struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
	Database  string `json:"database"`
}

func (h *Handler) HealthCheck(c echo.Context) error {
	dbStatus := "connected"
	if err := h.db.Ping(); err != nil {
		dbStatus = "disconnected"
	}

	return c.JSON(http.StatusOK, HealthResponse{
		Status:    "ok",
		Timestamp: time.Now().Format(time.RFC3339),
		Database:  dbStatus,
	})
}

type FileInfo struct {
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	Size      int64     `json:"size"`
	IsDir     bool      `json:"isDir"`
	ModTime   time.Time `json:"modTime"`
	Extension string    `json:"extension,omitempty"`
	MimeType  string    `json:"mimeType,omitempty"`
}

type ListFilesResponse struct {
	Path        string     `json:"path"`
	StorageType string     `json:"storageType"`
	Files       []FileInfo `json:"files"`
	Total       int        `json:"total"`
	TotalSize   int64      `json:"totalSize"`
}

// resolvePath converts a virtual path to a real filesystem path
// Virtual paths:
//   - /home/... -> /data/users/{username}/...
//   - /shared/... -> /data/shared/...
//   - / -> shows available storage roots
func (h *Handler) resolvePath(virtualPath string, claims *JWTClaims) (realPath string, storageType string, displayPath string, err error) {
	cleanPath := filepath.Clean(virtualPath)
	if strings.Contains(cleanPath, "..") {
		return "", "", "", fmt.Errorf("invalid path")
	}

	// Remove leading slash for easier parsing
	pathParts := strings.Split(strings.TrimPrefix(cleanPath, "/"), "/")
	if len(pathParts) == 0 || (len(pathParts) == 1 && pathParts[0] == "") {
		// Root path - show virtual roots
		return "", "root", "/", nil
	}

	root := pathParts[0]
	subPath := ""
	if len(pathParts) > 1 {
		subPath = filepath.Join(pathParts[1:]...)
	}

	switch root {
	case "home":
		if claims == nil {
			return "", "", "", fmt.Errorf("authentication required for home folder")
		}
		realPath = filepath.Join(h.dataRoot, "users", claims.Username, subPath)
		storageType = StorageHome
		displayPath = "/" + filepath.Join("home", subPath)
	case "shared":
		realPath = filepath.Join(h.dataRoot, "shared", subPath)
		storageType = StorageShared
		displayPath = "/" + filepath.Join("shared", subPath)
	default:
		return "", "", "", fmt.Errorf("invalid storage type: %s", root)
	}

	return realPath, storageType, displayPath, nil
}

// EnsureUserHomeDir creates the home directory for a user
func (h *Handler) EnsureUserHomeDir(username string) error {
	userDir := filepath.Join(h.dataRoot, "users", username)
	return os.MkdirAll(userDir, 0755)
}

// EnsureSharedDir creates the shared directory
func (h *Handler) EnsureSharedDir() error {
	sharedDir := filepath.Join(h.dataRoot, "shared")
	return os.MkdirAll(sharedDir, 0755)
}

// InitializeStorage creates required directories
func (h *Handler) InitializeStorage() error {
	dirs := []string{
		filepath.Join(h.dataRoot, "users"),
		filepath.Join(h.dataRoot, "shared"),
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}
	return nil
}

func (h *Handler) ListFiles(c echo.Context) error {
	requestPath := c.QueryParam("path")
	if requestPath == "" {
		requestPath = "/"
	}

	sortBy := c.QueryParam("sort")
	if sortBy == "" {
		sortBy = "name"
	}

	sortOrder := c.QueryParam("order")
	if sortOrder == "" {
		sortOrder = "asc"
	}

	// Get user claims if available
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	realPath, storageType, displayPath, err := h.resolvePath(requestPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	// Handle root path - show available storage types
	if storageType == "root" {
		roots := []FileInfo{
			{
				Name:    "shared",
				Path:    "/shared",
				IsDir:   true,
				ModTime: time.Now(),
			},
		}

		// Add home folder if user is authenticated
		if claims != nil {
			// Ensure home dir exists
			h.EnsureUserHomeDir(claims.Username)
			roots = append([]FileInfo{{
				Name:    "home",
				Path:    "/home",
				IsDir:   true,
				ModTime: time.Now(),
			}}, roots...)
		}

		return c.JSON(http.StatusOK, ListFilesResponse{
			Path:        "/",
			StorageType: "root",
			Files:       roots,
			Total:       len(roots),
			TotalSize:   0,
		})
	}

	// Ensure directory exists
	if storageType == StorageHome && claims != nil {
		h.EnsureUserHomeDir(claims.Username)
	} else if storageType == StorageShared {
		h.EnsureSharedDir()
	}

	// Check if directory exists
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

	entries, err := os.ReadDir(realPath)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to read directory",
		})
	}

	files := make([]FileInfo, 0, len(entries))
	var totalSize int64

	for _, entry := range entries {
		// Skip hidden files (starting with .)
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		ext := ""
		mimeType := ""
		if !entry.IsDir() {
			ext = strings.ToLower(strings.TrimPrefix(filepath.Ext(entry.Name()), "."))
			mimeType = getMimeType(ext)
			totalSize += info.Size()
		}

		files = append(files, FileInfo{
			Name:      entry.Name(),
			Path:      filepath.Join(displayPath, entry.Name()),
			Size:      info.Size(),
			IsDir:     entry.IsDir(),
			ModTime:   info.ModTime(),
			Extension: ext,
			MimeType:  mimeType,
		})
	}

	// Sort files
	sortFiles(files, sortBy, sortOrder)

	return c.JSON(http.StatusOK, ListFilesResponse{
		Path:        displayPath,
		StorageType: storageType,
		Files:       files,
		Total:       len(files),
		TotalSize:   totalSize,
	})
}

func sortFiles(files []FileInfo, sortBy, order string) {
	sort.Slice(files, func(i, j int) bool {
		// Directories always come first
		if files[i].IsDir != files[j].IsDir {
			return files[i].IsDir
		}

		var less bool
		switch sortBy {
		case "size":
			less = files[i].Size < files[j].Size
		case "date", "modTime":
			less = files[i].ModTime.Before(files[j].ModTime)
		case "type", "extension":
			less = files[i].Extension < files[j].Extension
		default: // name
			less = strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
		}

		if order == "desc" {
			return !less
		}
		return less
	})
}

func getMimeType(ext string) string {
	mimeTypes := map[string]string{
		// Images
		"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
		"gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml",
		"ico": "image/x-icon", "bmp": "image/bmp",
		// Videos
		"mp4": "video/mp4", "webm": "video/webm", "avi": "video/x-msvideo",
		"mov": "video/quicktime", "mkv": "video/x-matroska",
		// Audio
		"mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg",
		"flac": "audio/flac", "m4a": "audio/mp4",
		// Documents
		"pdf": "application/pdf", "doc": "application/msword",
		"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"xls": "application/vnd.ms-excel",
		"xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"ppt": "application/vnd.ms-powerpoint",
		"pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		// Text
		"txt": "text/plain", "md": "text/markdown", "json": "application/json",
		"xml": "application/xml", "html": "text/html", "css": "text/css",
		"js": "application/javascript", "ts": "application/typescript",
		// Archives
		"zip": "application/zip", "rar": "application/x-rar-compressed",
		"7z": "application/x-7z-compressed", "tar": "application/x-tar",
		"gz": "application/gzip",
	}

	if mime, ok := mimeTypes[ext]; ok {
		return mime
	}
	return "application/octet-stream"
}

func (h *Handler) GetFile(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "File path required",
		})
	}

	// URL decode the path for proper handling of special characters
	decodedPath, err := url.PathUnescape(requestPath)
	if err != nil {
		decodedPath = requestPath // fallback to original if decode fails
	}

	// Get user claims if available
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	realPath, _, _, err := h.resolvePath("/"+decodedPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	info, err := os.Stat(realPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "File not found",
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to access file",
		})
	}

	if info.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Path is a directory",
		})
	}

	// Check if download is requested
	if c.QueryParam("download") == "true" {
		c.Response().Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, info.Name()))
	}

	return c.File(realPath)
}

// GetSubtitle finds and returns subtitle for a video file in WebVTT format
func (h *Handler) GetSubtitle(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "File path required",
		})
	}

	// URL decode the path
	decodedPath, err := url.PathUnescape(requestPath)
	if err != nil {
		decodedPath = requestPath
	}

	// Get user claims if available
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path to get the video file directory
	realPath, _, _, err := h.resolvePath("/"+decodedPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	// Get base name without extension
	dir := filepath.Dir(realPath)
	baseName := strings.TrimSuffix(filepath.Base(realPath), filepath.Ext(realPath))

	// Look for subtitle files (.srt, .smi, .vtt)
	subtitleExts := []string{".srt", ".smi", ".sami", ".vtt"}
	var subtitlePath string
	var subtitleExt string

	for _, ext := range subtitleExts {
		path := filepath.Join(dir, baseName+ext)
		if _, err := os.Stat(path); err == nil {
			subtitlePath = path
			subtitleExt = ext
			break
		}
		// Also check uppercase extensions
		path = filepath.Join(dir, baseName+strings.ToUpper(ext))
		if _, err := os.Stat(path); err == nil {
			subtitlePath = path
			subtitleExt = strings.ToLower(ext)
			break
		}
	}

	if subtitlePath == "" {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "No subtitle found",
		})
	}

	// Read subtitle file
	content, err := os.ReadFile(subtitlePath)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to read subtitle file",
		})
	}

	// Convert to WebVTT if needed
	var vttContent string
	switch subtitleExt {
	case ".vtt":
		vttContent = string(content)
	case ".srt":
		vttContent = convertSRTtoVTT(string(content))
	case ".smi", ".sami":
		vttContent = convertSMItoVTT(string(content))
	default:
		vttContent = string(content)
	}

	c.Response().Header().Set("Content-Type", "text/vtt; charset=utf-8")
	return c.String(http.StatusOK, vttContent)
}

// convertSRTtoVTT converts SRT subtitle format to WebVTT
func convertSRTtoVTT(srt string) string {
	// Replace CRLF with LF
	srt = strings.ReplaceAll(srt, "\r\n", "\n")

	var result strings.Builder
	result.WriteString("WEBVTT\n\n")

	lines := strings.Split(srt, "\n")
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])

		// Skip empty lines and sequence numbers
		if line == "" {
			result.WriteString("\n")
			continue
		}

		// Check if this is a timestamp line (contains " --> ")
		if strings.Contains(line, " --> ") {
			// Convert comma to period in timestamps (SRT uses comma, VTT uses period)
			line = strings.ReplaceAll(line, ",", ".")
			result.WriteString(line + "\n")
		} else if _, err := fmt.Sscanf(line, "%d", new(int)); err == nil && !strings.Contains(line, " ") {
			// This is a sequence number, skip it
			continue
		} else {
			// This is subtitle text
			result.WriteString(line + "\n")
		}
	}

	return result.String()
}

// convertSMItoVTT converts SMI/SAMI subtitle format to WebVTT
func convertSMItoVTT(smi string) string {
	var result strings.Builder
	result.WriteString("WEBVTT\n\n")

	// Replace CRLF with LF
	smi = strings.ReplaceAll(smi, "\r\n", "\n")

	// Find all SYNC tags with timestamps and content
	type syncBlock struct {
		startMs int
		text    string
	}
	var blocks []syncBlock

	lines := strings.Split(smi, "\n")
	var currentText strings.Builder
	currentStart := -1

	for _, line := range lines {
		line = strings.TrimSpace(line)
		upperLine := strings.ToUpper(line)

		// Check for SYNC tag
		if strings.Contains(upperLine, "<SYNC") {
			// Save previous block if exists
			if currentStart >= 0 {
				text := strings.TrimSpace(currentText.String())
				text = stripHTMLTags(text)
				text = strings.ReplaceAll(text, "&nbsp;", " ")
				if text != "" && text != " " {
					blocks = append(blocks, syncBlock{startMs: currentStart, text: text})
				}
			}

			// Parse new timestamp
			startIdx := strings.Index(upperLine, "START=")
			if startIdx != -1 {
				var ms int
				remaining := line[startIdx+6:]
				// Handle both START=1234 and START="1234"
				remaining = strings.TrimPrefix(remaining, "\"")
				fmt.Sscanf(remaining, "%d", &ms)
				currentStart = ms
				currentText.Reset()

				// Get content after the > if on same line
				closeIdx := strings.Index(line, ">")
				if closeIdx != -1 && closeIdx+1 < len(line) {
					currentText.WriteString(line[closeIdx+1:])
				}
			}
		} else if currentStart >= 0 && !strings.HasPrefix(upperLine, "<BODY") && !strings.HasPrefix(upperLine, "</BODY") && !strings.HasPrefix(upperLine, "<SAMI") && !strings.HasPrefix(upperLine, "</SAMI") {
			currentText.WriteString(line + " ")
		}
	}

	// Save last block
	if currentStart >= 0 {
		text := strings.TrimSpace(currentText.String())
		text = stripHTMLTags(text)
		text = strings.ReplaceAll(text, "&nbsp;", " ")
		if text != "" && text != " " {
			blocks = append(blocks, syncBlock{startMs: currentStart, text: text})
		}
	}

	// Convert blocks to VTT cues
	for i := 0; i < len(blocks); i++ {
		startTime := formatVTTTime(blocks[i].startMs)
		var endTime string
		if i+1 < len(blocks) {
			endTime = formatVTTTime(blocks[i+1].startMs)
		} else {
			endTime = formatVTTTime(blocks[i].startMs + 5000) // Default 5 second duration
		}

		if blocks[i].text != "" {
			result.WriteString(fmt.Sprintf("%s --> %s\n%s\n\n", startTime, endTime, blocks[i].text))
		}
	}

	return result.String()
}

// stripHTMLTags removes HTML tags from a string
func stripHTMLTags(s string) string {
	var result strings.Builder
	inTag := false
	for _, r := range s {
		if r == '<' {
			inTag = true
		} else if r == '>' {
			inTag = false
		} else if !inTag {
			result.WriteRune(r)
		}
	}
	return result.String()
}

// formatVTTTime formats milliseconds to VTT timestamp format (HH:MM:SS.mmm)
func formatVTTTime(ms int) string {
	hours := ms / 3600000
	ms %= 3600000
	minutes := ms / 60000
	ms %= 60000
	seconds := ms / 1000
	millis := ms % 1000
	return fmt.Sprintf("%02d:%02d:%02d.%03d", hours, minutes, seconds, millis)
}

// SaveFileContent saves text content to a file
func (h *Handler) SaveFileContent(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "File path required",
		})
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	realPath, storageType, _, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	// Check if file exists
	info, err := os.Stat(realPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "File not found",
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to access file",
		})
	}

	if info.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Path is a directory",
		})
	}

	// Read request body
	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Failed to read request body",
		})
	}

	// Write to file
	if err := os.WriteFile(realPath, body, 0644); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to save file",
		})
	}

	// Log the action
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	clientIP := c.RealIP()
	h.auditHandler.LogEvent(userID, clientIP, EventFileEdit, "/"+requestPath, map[string]interface{}{
		"size":        len(body),
		"storageType": storageType,
	})

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "File saved successfully",
		"size":    len(body),
	})
}

func (h *Handler) DeleteFile(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "File path required",
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

	// Check permissions for home folder
	if storageType == StorageHome && claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	info, err := os.Stat(realPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "File not found",
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to access file",
		})
	}

	if info.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Path is a directory, use DELETE /api/folders instead",
		})
	}

	if err := os.Remove(realPath); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to delete file",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"path":    displayPath,
	})
}

type CreateFolderRequest struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

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

	// Check permissions for home folder
	if storageType == StorageHome && claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
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

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"success": true,
		"path":    filepath.Join(displayPath, req.Name),
		"name":    req.Name,
	})
}

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
	if storageType == "root" || displayPath == "/home" || displayPath == "/shared" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot delete root folders",
		})
	}

	// Check permissions for home folder
	if storageType == StorageHome && claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
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

// FolderStats represents statistics for a folder
type FolderStats struct {
	Path        string `json:"path"`
	FileCount   int    `json:"fileCount"`
	FolderCount int    `json:"folderCount"`
	TotalSize   int64  `json:"totalSize"`
}

// GetFolderStats returns statistics for a folder (recursive file/folder count and total size)
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
	realPath, storageType, displayPath, err := h.resolvePath("/"+requestPath, claims)
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

	var fileCount, folderCount int
	var totalSize int64

	err = filepath.Walk(realPath, func(path string, info os.FileInfo, err error) error {
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
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to calculate folder stats",
		})
	}

	return c.JSON(http.StatusOK, FolderStats{
		Path:        displayPath,
		FileCount:   fileCount,
		FolderCount: folderCount,
		TotalSize:   totalSize,
	})
}

// CheckFileExists checks if a file exists at the given path
func (h *Handler) CheckFileExists(c echo.Context) error {
	requestPath := c.QueryParam("path")
	filename := c.QueryParam("filename")

	if filename == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Filename required",
		})
	}

	if requestPath == "" {
		requestPath = "/"
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	realPath, storageType, displayPath, err := h.resolvePath(requestPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	if storageType == "root" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot check file at root",
		})
	}

	fullPath := filepath.Join(realPath, filename)

	_, err = os.Stat(fullPath)
	exists := !os.IsNotExist(err)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"exists":   exists,
		"path":     filepath.Join(displayPath, filename),
		"filename": filename,
	})
}

func (h *Handler) GetPreview(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "File path required",
		})
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	realPath, _, displayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	info, err := os.Stat(realPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "File not found",
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to access file",
		})
	}

	if info.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Path is a directory",
		})
	}

	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(info.Name()), "."))
	mimeType := getMimeType(ext)

	// For images, return the file directly
	if strings.HasPrefix(mimeType, "image/") {
		return c.File(realPath)
	}

	// For text files, return content
	if strings.HasPrefix(mimeType, "text/") || ext == "json" || ext == "md" {
		file, err := os.Open(realPath)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to open file",
			})
		}
		defer file.Close()

		// Limit preview to first 100KB
		content := make([]byte, 100*1024)
		n, err := file.Read(content)
		if err != nil && err != io.EOF {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to read file",
			})
		}

		return c.JSON(http.StatusOK, map[string]interface{}{
			"type":      "text",
			"mimeType":  mimeType,
			"content":   string(content[:n]),
			"truncated": n == 100*1024,
		})
	}

	// For videos and audio, return file info for streaming
	if strings.HasPrefix(mimeType, "video/") || strings.HasPrefix(mimeType, "audio/") {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"type":     strings.Split(mimeType, "/")[0],
			"mimeType": mimeType,
			"url":      fmt.Sprintf("/api/files/%s", strings.TrimPrefix(displayPath, "/")),
			"size":     info.Size(),
		})
	}

	// For PDFs
	if mimeType == "application/pdf" {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"type":     "pdf",
			"mimeType": mimeType,
			"url":      fmt.Sprintf("/api/files/%s", strings.TrimPrefix(displayPath, "/")),
			"size":     info.Size(),
		})
	}

	// For unsupported types
	return c.JSON(http.StatusOK, map[string]interface{}{
		"type":     "unsupported",
		"mimeType": mimeType,
		"size":     info.Size(),
	})
}

// CreateFileRequest is the request body for creating new files
type CreateFileRequest struct {
	Path     string `json:"path"`
	Filename string `json:"filename"`
	FileType string `json:"fileType"` // text, docx, xlsx, pptx
}

// CreateFile creates a new empty file
func (h *Handler) CreateFile(c echo.Context) error {
	var req CreateFileRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if req.Filename == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Filename required",
		})
	}

	// Validate filename
	if strings.ContainsAny(req.Filename, `/\:*?"<>|`) {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid filename",
		})
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	targetPath := req.Path
	if targetPath == "" {
		targetPath = "/shared"
	}

	realPath, storageType, _, err := h.resolvePath(targetPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	if storageType == "root" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot create file in root",
		})
	}

	// Check permissions for home folder
	if storageType == StorageHome && claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	// Ensure target directory exists
	if err := os.MkdirAll(realPath, 0755); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create target directory",
		})
	}

	// Build full file path
	filePath := filepath.Join(realPath, req.Filename)

	// Check if file already exists
	if _, err := os.Stat(filePath); err == nil {
		return c.JSON(http.StatusConflict, map[string]string{
			"error": "File already exists",
		})
	}

	// Get template content based on file type
	content := getTemplateContent(req.FileType)

	// Create the file
	if err := os.WriteFile(filePath, content, 0644); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create file",
		})
	}

	// Log audit event
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	h.auditHandler.LogEvent(userID, c.RealIP(), EventFileUpload, targetPath+"/"+req.Filename, map[string]interface{}{
		"fileName": req.Filename,
		"fileType": req.FileType,
		"source":   "create",
	})

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"success":  true,
		"filename": req.Filename,
		"path":     targetPath + "/" + req.Filename,
	})
}

// getTemplateContent returns template content for different file types
func getTemplateContent(fileType string) []byte {
	switch fileType {
	case "text":
		return []byte("")
	case "html":
		return []byte(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>New Document</title>
</head>
<body>

</body>
</html>`)
	case "json":
		return []byte("{\n  \n}")
	case "md":
		return []byte("# New Document\n\n")
	default:
		return []byte("")
	}
}

// SimpleUpload handles simple non-resumable uploads
func (h *Handler) SimpleUpload(c echo.Context) error {
	// Get the file from the request
	file, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "No file uploaded",
		})
	}

	targetPath := c.FormValue("path")
	if targetPath == "" {
		targetPath = "/shared"
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	realPath, storageType, _, err := h.resolvePath(targetPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	if storageType == "root" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot upload to root",
		})
	}

	// Check permissions for home folder
	if storageType == StorageHome && claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	// Ensure target directory exists
	if err := os.MkdirAll(realPath, 0755); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create target directory",
		})
	}

	// Open the uploaded file
	src, err := file.Open()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to open uploaded file",
		})
	}
	defer src.Close()

	// Create the destination file
	destPath := filepath.Join(realPath, file.Filename)

	// Mark this as a web upload to prevent SMB audit logging
	tracker := GetWebUploadTracker()
	tracker.MarkUploading(destPath)

	dst, err := os.Create(destPath)
	if err != nil {
		tracker.UnmarkUploading(destPath)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create destination file",
		})
	}
	defer dst.Close()

	// Copy the file
	if _, err = io.Copy(dst, src); err != nil {
		tracker.UnmarkUploading(destPath)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to save file",
		})
	}

	// Keep the mark for 10 seconds then remove it
	go func() {
		time.Sleep(10 * time.Second)
		tracker.UnmarkUploading(destPath)
	}()

	// Log audit event for file upload
	h.auditHandler.LogEventFromContext(c, EventFileUpload, targetPath+"/"+file.Filename, map[string]interface{}{
		"fileName": file.Filename,
		"size":     file.Size,
		"source":   "web",
	})

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"success":  true,
		"filename": file.Filename,
		"size":     file.Size,
	})
}
