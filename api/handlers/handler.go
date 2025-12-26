package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// Handler is the main handler struct for file operations
type Handler struct {
	db           *sql.DB
	dataRoot     string
	auditHandler *AuditHandler
}

// NewHandler creates a new Handler instance
func NewHandler(db *sql.DB) *Handler {
	return &Handler{
		db:           db,
		dataRoot:     "/data",
		auditHandler: NewAuditHandler(db),
	}
}

// Storage types
const (
	StorageHome         = "home"           // Personal home folder
	StorageShared       = "shared"         // Team shared drives
	StorageSharedWithMe = "shared-with-me" // Files shared with user (virtual)
)

// HealthResponse represents the health check response
type HealthResponse struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
	Database  string `json:"database"`
}

// HealthCheck handles health check requests
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

// FileInfo represents file metadata
type FileInfo struct {
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	Size      int64     `json:"size"`
	IsDir     bool      `json:"isDir"`
	ModTime   time.Time `json:"modTime"`
	Extension string    `json:"extension,omitempty"`
	MimeType  string    `json:"mimeType,omitempty"`
}

// ListFilesResponse represents the response for listing files
type ListFilesResponse struct {
	Path        string     `json:"path"`
	StorageType string     `json:"storageType"`
	Files       []FileInfo `json:"files"`
	Total       int        `json:"total"`
	TotalSize   int64      `json:"totalSize"`
	// Pagination fields
	Page       int `json:"page,omitempty"`
	PageSize   int `json:"pageSize,omitempty"`
	TotalPages int `json:"totalPages,omitempty"`
}

// validateAndCleanPath validates a path component and returns cleaned version
// Returns error if path contains dangerous patterns
func validateAndCleanPath(path string) (string, error) {
	// Clean the path first
	cleanPath := filepath.Clean(path)

	// Check for path traversal attempts after cleaning
	if strings.Contains(cleanPath, "..") {
		return "", fmt.Errorf("path traversal not allowed")
	}

	// Check for null bytes (can bypass some checks)
	if strings.ContainsRune(path, '\x00') {
		return "", fmt.Errorf("invalid path: contains null byte")
	}

	// Check for other dangerous patterns
	dangerousPatterns := []string{
		"..\\", // Windows-style traversal
		"..%",  // URL-encoded traversal attempts
		"%2e",  // URL-encoded dot
		"%2f",  // URL-encoded slash
		"%5c",  // URL-encoded backslash
	}
	lowerPath := strings.ToLower(path)
	for _, pattern := range dangerousPatterns {
		if strings.Contains(lowerPath, pattern) {
			return "", fmt.Errorf("invalid path: contains dangerous pattern")
		}
	}

	return cleanPath, nil
}

// isPathWithinRoot checks if the resolved path is within the allowed root directory
// This prevents symlink-based escapes and other path manipulation attacks
func isPathWithinRoot(resolvedPath, allowedRoot string) bool {
	// Get absolute paths
	absResolved, err := filepath.Abs(resolvedPath)
	if err != nil {
		return false
	}
	absRoot, err := filepath.Abs(allowedRoot)
	if err != nil {
		return false
	}

	// Ensure the resolved path starts with the allowed root
	// Add trailing separator to prevent matching partial directory names
	// e.g., /data/users vs /data/users_evil
	if !strings.HasPrefix(absResolved, absRoot+string(filepath.Separator)) && absResolved != absRoot {
		return false
	}

	return true
}

// resolvePath converts a virtual path to a real filesystem path
// Virtual paths:
//   - /home/... -> /data/users/{username}/...
//   - /shared/... -> /data/shared/...
//   - / -> shows available storage roots
func (h *Handler) resolvePath(virtualPath string, claims *JWTClaims) (realPath string, storageType string, displayPath string, err error) {
	// Validate and clean the path
	cleanPath, err := validateAndCleanPath(virtualPath)
	if err != nil {
		return "", "", "", err
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

	// Validate subPath components individually
	if subPath != "" {
		if _, err := validateAndCleanPath(subPath); err != nil {
			return "", "", "", err
		}
	}

	var allowedRoot string

	switch root {
	case "home":
		if claims == nil {
			return "", "", "", fmt.Errorf("authentication required for home folder")
		}
		allowedRoot = filepath.Join(h.dataRoot, "users", claims.Username)
		realPath = filepath.Join(allowedRoot, subPath)
		storageType = StorageHome
		displayPath = "/" + filepath.Join("home", subPath)
	case "shared":
		if claims == nil {
			return "", "", "", fmt.Errorf("authentication required for shared drives")
		}
		allowedRoot = filepath.Join(h.dataRoot, "shared")
		realPath = filepath.Join(allowedRoot, subPath)
		storageType = StorageShared
		displayPath = "/" + filepath.Join("shared", subPath)
	case "shared-with-me":
		if claims == nil {
			return "", "", "", fmt.Errorf("authentication required for shared files")
		}
		// shared-with-me is a virtual path, doesn't map to a real directory
		// The actual files are accessed via their original paths
		realPath = ""
		storageType = StorageSharedWithMe
		displayPath = "/shared-with-me"
		return realPath, storageType, displayPath, nil
	default:
		return "", "", "", fmt.Errorf("invalid storage type: %s", root)
	}

	// Final security check: ensure resolved path is within allowed root
	if realPath != "" && !isPathWithinRoot(realPath, allowedRoot) {
		return "", "", "", fmt.Errorf("access denied: path escapes allowed directory")
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

// ListFiles handles directory listing requests with optional pagination
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

	// Pagination parameters (optional - if not provided, return all files)
	pageStr := c.QueryParam("page")
	pageSizeStr := c.QueryParam("pageSize")
	var page, pageSize int
	usePagination := false

	if pageStr != "" && pageSizeStr != "" {
		var err error
		page, err = strconv.Atoi(pageStr)
		if err != nil || page < 1 {
			page = 1
		}
		pageSize, err = strconv.Atoi(pageSizeStr)
		if err != nil || pageSize < 1 {
			pageSize = 50
		}
		if pageSize > 500 {
			pageSize = 500 // Max page size limit
		}
		usePagination = true
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

		// Add home folder and shared-with-me if user is authenticated
		if claims != nil {
			// Ensure home dir exists
			h.EnsureUserHomeDir(claims.Username)
			roots = append([]FileInfo{
				{
					Name:    "home",
					Path:    "/home",
					IsDir:   true,
					ModTime: time.Now(),
				},
				{
					Name:    "shared-with-me",
					Path:    "/shared-with-me",
					IsDir:   true,
					ModTime: time.Now(),
				},
			}, roots...)
		}

		return c.JSON(http.StatusOK, ListFilesResponse{
			Path:        "/",
			StorageType: "root",
			Files:       roots,
			Total:       len(roots),
			TotalSize:   0,
		})
	}

	// Handle shared-with-me virtual listing
	if storageType == StorageSharedWithMe {
		return h.listSharedWithMe(c, claims)
	}

	// Ensure directory exists
	if storageType == StorageHome && claims != nil {
		h.EnsureUserHomeDir(claims.Username)
	} else if storageType == StorageShared {
		h.EnsureSharedDir()
	}

	// Check shared drive read permission (skip for root /shared listing)
	if storageType == StorageShared && requestPath != "/shared" {
		if claims == nil {
			return c.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Authentication required",
			})
		}
		if !h.CanReadSharedDrive(claims.UserID, requestPath) {
			return c.JSON(http.StatusForbidden, map[string]string{
				"error": "No permission to access this shared drive",
			})
		}
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

	// Apply pagination if requested
	total := len(files)
	response := ListFilesResponse{
		Path:        displayPath,
		StorageType: storageType,
		Total:       total,
		TotalSize:   totalSize,
	}

	if usePagination {
		totalPages := (total + pageSize - 1) / pageSize
		start := (page - 1) * pageSize
		end := start + pageSize

		if start > total {
			start = total
		}
		if end > total {
			end = total
		}

		response.Files = files[start:end]
		response.Page = page
		response.PageSize = pageSize
		response.TotalPages = totalPages
	} else {
		response.Files = files
	}

	return c.JSON(http.StatusOK, response)
}

// sortFiles sorts a slice of FileInfo
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

// ExtractSharedDriveFolderName extracts the folder name from a shared path
// Path format: /shared/{folder-name}/...
func ExtractSharedDriveFolderName(path string) string {
	cleanPath := filepath.Clean(path)
	parts := strings.Split(strings.TrimPrefix(cleanPath, "/"), "/")
	if len(parts) >= 2 && parts[0] == "shared" {
		return parts[1]
	}
	return ""
}

// CheckSharedDrivePermission checks if user has required permission level for a shared drive path
func (h *Handler) CheckSharedDrivePermission(userID, path string, requiredLevel int) bool {
	folderName := ExtractSharedDriveFolderName(path)
	if folderName == "" {
		return false
	}

	var permissionLevel int
	err := h.db.QueryRow(`
		SELECT sfm.permission_level
		FROM shared_folder_members sfm
		INNER JOIN shared_folders sf ON sf.id = sfm.shared_folder_id
		WHERE sf.name = $1 AND sfm.user_id = $2 AND sf.is_active = TRUE
	`, folderName, userID).Scan(&permissionLevel)

	if err != nil {
		return false
	}

	return permissionLevel >= requiredLevel
}

// CanReadSharedDrive checks if user can read from a shared drive path
func (h *Handler) CanReadSharedDrive(userID, path string) bool {
	return h.CheckSharedDrivePermission(userID, path, 1) // 1 = read-only
}

// CanWriteSharedDrive checks if user can write to a shared drive path
func (h *Handler) CanWriteSharedDrive(userID, path string) bool {
	return h.CheckSharedDrivePermission(userID, path, 2) // 2 = read-write
}

// CheckSharedDriveQuota checks if upload would exceed storage quota
func (h *Handler) CheckSharedDriveQuota(path string, uploadSize int64) (allowed bool, quota int64, used int64) {
	folderName := ExtractSharedDriveFolderName(path)
	if folderName == "" {
		return false, 0, 0
	}

	// Get quota
	err := h.db.QueryRow(`
		SELECT storage_quota FROM shared_folders WHERE name = $1 AND is_active = TRUE
	`, folderName).Scan(&quota)
	if err != nil {
		return false, 0, 0
	}

	// 0 = unlimited
	if quota == 0 {
		return true, 0, 0
	}

	// Calculate current usage
	folderPath := filepath.Join(h.dataRoot, "shared", folderName)
	filepath.Walk(folderPath, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			used += info.Size()
		}
		return nil
	})

	return (used + uploadSize) <= quota, quota, used
}

// getMimeType returns the MIME type for a file extension
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

// SharedFileInfo extends FileInfo with share-specific metadata
type SharedFileInfo struct {
	FileInfo
	SharedBy        string    `json:"sharedBy"`
	PermissionLevel int       `json:"permissionLevel"`
	SharedAt        time.Time `json:"sharedAt"`
	OriginalPath    string    `json:"originalPath"`
}

// listSharedWithMe returns files shared with the current user
func (h *Handler) listSharedWithMe(c echo.Context, claims *JWTClaims) error {
	rows, err := h.db.Query(`
		SELECT
			fs.id, fs.item_path, fs.item_name, fs.is_folder,
			fs.permission_level, fs.created_at, u.username
		FROM file_shares fs
		INNER JOIN users u ON u.id = fs.owner_id
		WHERE fs.shared_with_id = $1
		ORDER BY fs.created_at DESC
	`, claims.UserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch shared files",
		})
	}
	defer rows.Close()

	files := make([]SharedFileInfo, 0)
	for rows.Next() {
		var id int64
		var itemPath, itemName, sharedBy string
		var isFolder bool
		var permissionLevel int
		var createdAt time.Time

		if err := rows.Scan(&id, &itemPath, &itemName, &isFolder, &permissionLevel, &createdAt, &sharedBy); err != nil {
			continue
		}

		ext := ""
		mimeType := ""
		var size int64 = 0

		if !isFolder {
			ext = strings.ToLower(strings.TrimPrefix(filepath.Ext(itemName), "."))
			mimeType = getMimeType(ext)
			// Try to get actual file size from the filesystem
			if realPath := h.resolveOriginalPath(itemPath); realPath != "" {
				if info, err := os.Stat(realPath); err == nil {
					size = info.Size()
				}
			}
		}

		files = append(files, SharedFileInfo{
			FileInfo: FileInfo{
				Name:      itemName,
				Path:      itemPath,
				Size:      size,
				IsDir:     isFolder,
				ModTime:   createdAt,
				Extension: ext,
				MimeType:  mimeType,
			},
			SharedBy:        sharedBy,
			PermissionLevel: permissionLevel,
			SharedAt:        createdAt,
			OriginalPath:    itemPath,
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"path":        "/shared-with-me",
		"storageType": StorageSharedWithMe,
		"files":       files,
		"total":       len(files),
		"totalSize":   0,
	})
}

// resolveOriginalPath resolves a virtual path to real filesystem path without claims
func (h *Handler) resolveOriginalPath(virtualPath string) string {
	cleanPath := filepath.Clean(virtualPath)
	parts := strings.Split(strings.TrimPrefix(cleanPath, "/"), "/")
	if len(parts) == 0 {
		return ""
	}

	switch parts[0] {
	case "home":
		if len(parts) >= 2 {
			// For home paths, we need the username from the path
			// Path format: /home/username/... (but home folder shows as /home/...)
			// The original owner's username should be determined from the share
			return ""
		}
		return ""
	case "shared":
		subPath := ""
		if len(parts) > 1 {
			subPath = filepath.Join(parts[1:]...)
		}
		return filepath.Join(h.dataRoot, "shared", subPath)
	}
	return ""
}

// CheckFileSharePermission checks if user has required permission for a shared file
func (h *Handler) CheckFileSharePermission(userID, virtualPath string, requiredLevel int) bool {
	// Check exact path match
	var permissionLevel int
	err := h.db.QueryRow(`
		SELECT permission_level FROM file_shares
		WHERE shared_with_id = $1 AND item_path = $2
	`, userID, virtualPath).Scan(&permissionLevel)
	if err == nil && permissionLevel >= requiredLevel {
		return true
	}

	// Check if this is a subpath of a shared folder
	rows, err := h.db.Query(`
		SELECT item_path, permission_level FROM file_shares
		WHERE shared_with_id = $1 AND is_folder = TRUE
	`, userID)
	if err != nil {
		return false
	}
	defer rows.Close()

	for rows.Next() {
		var folderPath string
		var level int
		if err := rows.Scan(&folderPath, &level); err != nil {
			continue
		}
		// Check if virtualPath is under this shared folder
		if strings.HasPrefix(virtualPath, folderPath+"/") && level >= requiredLevel {
			return true
		}
	}

	return false
}

// CanReadSharedFile checks if user can read a shared file
func (h *Handler) CanReadSharedFile(userID, virtualPath string) bool {
	return h.CheckFileSharePermission(userID, virtualPath, 1) // 1 = read-only
}

// CanWriteSharedFile checks if user can write to a shared file
func (h *Handler) CanWriteSharedFile(userID, virtualPath string) bool {
	return h.CheckFileSharePermission(userID, virtualPath, 2) // 2 = read-write
}

// GetSharedFileOwnerPath resolves a shared file's original owner path
func (h *Handler) GetSharedFileOwnerPath(userID, virtualPath string) (realPath string, ownerUsername string, err error) {
	// First check exact path match
	var itemPath string
	err = h.db.QueryRow(`
		SELECT fs.item_path, u.username
		FROM file_shares fs
		INNER JOIN users u ON u.id = fs.owner_id
		WHERE fs.shared_with_id = $1 AND fs.item_path = $2
	`, userID, virtualPath).Scan(&itemPath, &ownerUsername)

	if err == nil {
		// Found exact match - resolve the real path
		cleanPath := filepath.Clean(itemPath)
		parts := strings.Split(strings.TrimPrefix(cleanPath, "/"), "/")
		if len(parts) >= 1 && parts[0] == "home" {
			subPath := ""
			if len(parts) > 1 {
				subPath = filepath.Join(parts[1:]...)
			}
			realPath = filepath.Join(h.dataRoot, "users", ownerUsername, subPath)
			return realPath, ownerUsername, nil
		}
	}

	// Check if this is a subpath of a shared folder
	rows, err := h.db.Query(`
		SELECT fs.item_path, u.username, fs.is_folder
		FROM file_shares fs
		INNER JOIN users u ON u.id = fs.owner_id
		WHERE fs.shared_with_id = $1 AND fs.is_folder = TRUE
	`, userID)
	if err != nil {
		return "", "", fmt.Errorf("failed to check shared folders")
	}
	defer rows.Close()

	for rows.Next() {
		var folderPath, username string
		var isFolder bool
		if err := rows.Scan(&folderPath, &username, &isFolder); err != nil {
			continue
		}
		// Check if virtualPath is under this shared folder
		if strings.HasPrefix(virtualPath, folderPath+"/") {
			// Found parent folder - resolve the subpath
			cleanPath := filepath.Clean(virtualPath)
			parts := strings.Split(strings.TrimPrefix(cleanPath, "/"), "/")
			if len(parts) >= 1 && parts[0] == "home" {
				subPath := ""
				if len(parts) > 1 {
					subPath = filepath.Join(parts[1:]...)
				}
				realPath = filepath.Join(h.dataRoot, "users", username, subPath)
				return realPath, username, nil
			}
		}
	}

	return "", "", fmt.Errorf("shared file not found")
}
