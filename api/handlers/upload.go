package handlers

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tus/tusd/v2/pkg/filestore"
	tusd "github.com/tus/tusd/v2/pkg/handler"
)

// Default storage quota per user (10GB)
const DefaultUserQuota = 10 * 1024 * 1024 * 1024

// UploadError represents an upload validation error
type UploadError struct {
	Code    int
	Message string
}

func (e UploadError) Error() string {
	return e.Message
}

type UploadHandler struct {
	tusHandler   *tusd.UnroutedHandler
	dataRoot     string
	db           *sql.DB
	auditHandler *AuditHandler
}

func NewUploadHandler(dataRoot string, db *sql.DB) (*UploadHandler, error) {
	// Create upload temp directory
	uploadDir := filepath.Join(dataRoot, ".uploads")
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create upload directory: %w", err)
	}

	// Create file store for tus
	store := filestore.New(uploadDir)

	// Create tus handler with unrouted handler for more control
	composer := tusd.NewStoreComposer()
	store.UseIn(composer)

	h := &UploadHandler{
		dataRoot:     dataRoot,
		db:           db,
		auditHandler: NewAuditHandler(db),
	}

	// Create TUS handler with pre-upload validation
	handler, err := tusd.NewUnroutedHandler(tusd.Config{
		BasePath:                "/",
		StoreComposer:           composer,
		NotifyCompleteUploads:   true,
		RespectForwardedHeaders: true,
		PreUploadCreateCallback: h.preUploadCreateCallback,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create tus handler: %w", err)
	}

	h.tusHandler = handler

	// Start goroutine to handle completed uploads
	go h.handleCompletedUploads()

	return h, nil
}

// preUploadCreateCallback validates uploads before they start
// Checks: file path security, storage quota, file type restrictions
func (h *UploadHandler) preUploadCreateCallback(hook tusd.HookEvent) (tusd.HTTPResponse, tusd.FileInfoChanges, error) {
	resp := tusd.HTTPResponse{}
	changes := tusd.FileInfoChanges{}

	// Get metadata
	destPath := hook.Upload.MetaData["path"]
	filename := hook.Upload.MetaData["filename"]
	username := hook.Upload.MetaData["username"]
	uploadSize := hook.Upload.Size

	// Validate required metadata
	if filename == "" {
		resp.StatusCode = 400
		resp.Body = `{"error":"Filename is required"}`
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	if destPath == "" {
		destPath = "/home" // Default to home folder instead of shared
	}

	// Prevent uploads directly to /shared/ root (must upload inside a shared folder)
	if destPath == "/shared" || destPath == "/shared/" {
		resp.StatusCode = 403
		resp.Body = `{"error":"공유 드라이브 루트에는 파일을 업로드할 수 없습니다"}`
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	// Validate path security
	_, err := h.resolveVirtualPath(destPath, username)
	if err != nil {
		resp.StatusCode = 400
		resp.Body = fmt.Sprintf(`{"error":"Invalid upload path: %s"}`, err.Error())
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	// Check storage quota
	if username != "" && uploadSize > 0 {
		quotaOk, remaining, err := h.checkUserQuota(username, uploadSize)
		if err != nil {
			fmt.Printf("Quota check error for user %s: %v\n", username, err)
			// Allow upload on quota check error (fail-open for now)
		} else if !quotaOk {
			resp.StatusCode = 413
			resp.Body = fmt.Sprintf(`{"error":"Storage quota exceeded","remaining":%d,"required":%d}`, remaining, uploadSize)
			return resp, changes, tusd.ErrUploadRejectedByServer
		}
	}

	// Check for shared drive quota if uploading to shared drive
	if strings.HasPrefix(destPath, "/shared/") {
		allowed, quota, used := h.checkSharedDriveQuota(destPath, uploadSize)
		if !allowed && quota > 0 { // quota > 0 means quota is set (not unlimited)
			resp.StatusCode = 413
			resp.Body = fmt.Sprintf(`{"error":"Shared drive quota exceeded","quota":%d,"used":%d,"required":%d}`, quota, used, uploadSize)
			return resp, changes, tusd.ErrUploadRejectedByServer
		}
	}

	// Validate filename (prevent dangerous filenames)
	if err := validateFilename(filename); err != nil {
		resp.StatusCode = 400
		resp.Body = fmt.Sprintf(`{"error":"%s"}`, err.Error())
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	// Log successful pre-upload validation
	fmt.Printf("Pre-upload validation passed: user=%s, path=%s, filename=%s, size=%d\n",
		username, destPath, filename, uploadSize)

	return resp, changes, nil
}

// checkUserQuota checks if user has enough storage quota for the upload
func (h *UploadHandler) checkUserQuota(username string, uploadSize int64) (bool, int64, error) {
	// Get user quota from database (or use default)
	var quota int64 = DefaultUserQuota
	err := h.db.QueryRow(`
		SELECT COALESCE(storage_quota, $1) FROM users WHERE username = $2
	`, DefaultUserQuota, username).Scan(&quota)
	if err != nil && err != sql.ErrNoRows {
		return true, 0, err // Fail-open on error
	}

	// quota of 0 means unlimited
	if quota == 0 {
		return true, -1, nil
	}

	// Calculate current usage
	userPath := filepath.Join(h.dataRoot, "users", username)
	var currentUsage int64
	filepath.Walk(userPath, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			currentUsage += info.Size()
		}
		return nil
	})

	remaining := quota - currentUsage
	if uploadSize > remaining {
		return false, remaining, nil
	}

	return true, remaining, nil
}

// checkSharedDriveQuota checks quota for shared drive
func (h *UploadHandler) checkSharedDriveQuota(path string, uploadSize int64) (allowed bool, quota int64, used int64) {
	folderName := ExtractSharedDriveFolderName(path)
	if folderName == "" {
		return true, 0, 0 // No folder name means root shared, allow
	}

	// Get quota from database
	err := h.db.QueryRow(`
		SELECT storage_quota FROM shared_folders WHERE name = $1 AND is_active = TRUE
	`, folderName).Scan(&quota)
	if err != nil {
		return true, 0, 0 // Allow on error
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

// validateFilename checks for dangerous filename patterns
func validateFilename(filename string) error {
	// Check for empty filename
	if filename == "" {
		return fmt.Errorf("filename cannot be empty")
	}

	// Check for dangerous characters
	dangerousChars := []string{"/", "\\", "\x00", ":", "*", "?", "\"", "<", ">", "|"}
	for _, char := range dangerousChars {
		if strings.Contains(filename, char) {
			return fmt.Errorf("filename contains invalid character")
		}
	}

	// Check for hidden files (starts with .)
	if strings.HasPrefix(filename, ".") {
		return fmt.Errorf("hidden files are not allowed")
	}

	// Check filename length
	if len(filename) > 255 {
		return fmt.Errorf("filename too long (max 255 characters)")
	}

	// Check for dangerous extensions
	dangerousExts := []string{".exe", ".bat", ".cmd", ".sh", ".ps1", ".vbs", ".js"}
	lowerName := strings.ToLower(filename)
	for _, ext := range dangerousExts {
		if strings.HasSuffix(lowerName, ext) {
			return fmt.Errorf("file type not allowed: %s", ext)
		}
	}

	return nil
}

// GetDB returns the database connection for use in handlers
func (h *UploadHandler) GetDB() *sql.DB {
	return h.db
}

// resolveVirtualPath converts a virtual path to a real filesystem path for uploads
// Virtual paths:
//   - /home/... -> /data/users/{username}/...
//   - /shared/... -> /data/shared/...
func (h *UploadHandler) resolveVirtualPath(virtualPath string, username string) (string, error) {
	// Use the shared validation function from handler.go
	cleanPath, err := validateAndCleanPath(virtualPath)
	if err != nil {
		return "", err
	}

	// Parse path parts
	pathParts := strings.Split(strings.TrimPrefix(cleanPath, "/"), "/")
	if len(pathParts) == 0 || (len(pathParts) == 1 && pathParts[0] == "") {
		return "", fmt.Errorf("cannot upload to root")
	}

	root := pathParts[0]
	subPath := ""
	if len(pathParts) > 1 {
		subPath = filepath.Join(pathParts[1:]...)
	}

	// Validate subPath as well
	if subPath != "" {
		if _, err := validateAndCleanPath(subPath); err != nil {
			return "", err
		}
	}

	var realPath string
	var allowedRoot string

	switch root {
	case "home":
		if username == "" {
			return "", fmt.Errorf("username required for home folder")
		}
		allowedRoot = filepath.Join(h.dataRoot, "users", username)
		realPath = filepath.Join(allowedRoot, subPath)
	case "shared":
		// shared uses folder name as subdirectory
		allowedRoot = filepath.Join(h.dataRoot, "shared")
		realPath = filepath.Join(allowedRoot, subPath)
	default:
		return "", fmt.Errorf("invalid storage type: %s", root)
	}

	// Final security check: ensure resolved path is within allowed root
	if !isPathWithinRoot(realPath, allowedRoot) {
		return "", fmt.Errorf("access denied: path escapes allowed directory")
	}

	return realPath, nil
}

func (h *UploadHandler) handleCompletedUploads() {
	for event := range h.tusHandler.CompleteUploads {
		// Get destination path from metadata
		destPath := event.Upload.MetaData["path"]
		filename := event.Upload.MetaData["filename"]
		username := event.Upload.MetaData["username"] // Added for virtual path resolution
		overwrite := event.Upload.MetaData["overwrite"] == "true"

		if destPath == "" {
			destPath = "/home" // Default to home folder
		}
		if filename == "" {
			filename = event.Upload.ID
		}

		// Resolve virtual path to real path
		realDestPath, err := h.resolveVirtualPath(destPath, username)
		if err != nil {
			fmt.Printf("Failed to resolve virtual path %s: %v\n", destPath, err)
			continue
		}

		// Move file to destination
		srcPath := filepath.Join(h.dataRoot, ".uploads", event.Upload.ID)
		finalPath := filepath.Join(realDestPath, filename)

		// Ensure destination directory exists
		if err := os.MkdirAll(filepath.Dir(finalPath), 0755); err != nil {
			fmt.Printf("Failed to create directory: %v\n", err)
			continue
		}

		// Check if file already exists
		if !overwrite {
			// Generate unique name if file exists and overwrite is not requested
			finalPath = h.getUniqueFilePath(finalPath)
		}
		// If overwrite is true, the existing file will be replaced by os.Rename

		// Mark this file as a web upload before moving
		tracker := GetWebUploadTracker()
		tracker.MarkUploading(finalPath)

		// Move file (will overwrite if exists)
		if err := os.Rename(srcPath, finalPath); err != nil {
			fmt.Printf("Failed to move file: %v\n", err)
			tracker.UnmarkUploading(finalPath)
			continue
		}

		// Clean up .info file
		infoPath := srcPath + ".info"
		os.Remove(infoPath)

		fmt.Printf("Upload completed: %s -> %s (overwrite: %v)\n", filename, finalPath, overwrite)

		// Log audit event for file upload
		// Get client IP from the tracker (stored when upload was created)
		ipAddr := GetTusIPTracker().GetIP(event.Upload.ID)
		if ipAddr == "" {
			ipAddr = "0.0.0.0"
		}
		var userID *string
		if username != "" {
			userID = h.getUserIDByUsername(username)
		}
		h.auditHandler.LogEvent(userID, ipAddr, EventFileUpload, destPath+"/"+filename, map[string]interface{}{
			"fileName": filename,
			"size":     event.Upload.Size,
			"source":   "web",
		})

		// Keep the mark for 10 seconds then remove it
		go func(path string) {
			time.Sleep(10 * time.Second)
			tracker.UnmarkUploading(path)
		}(finalPath)
	}
}

// getUserIDByUsername looks up user ID by username
func (h *UploadHandler) getUserIDByUsername(username string) *string {
	if h.auditHandler == nil || h.auditHandler.db == nil {
		return nil
	}
	var userID string
	err := h.auditHandler.db.QueryRow("SELECT id FROM users WHERE username = $1", username).Scan(&userID)
	if err != nil {
		return nil
	}
	return &userID
}

// getUniqueFilePath returns a unique file path by adding [1], [2], etc. if file exists
func (h *UploadHandler) getUniqueFilePath(path string) string {
	// Check if file exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return path
	}

	// File exists, need to generate unique name
	dir := filepath.Dir(path)
	ext := filepath.Ext(path)
	base := strings.TrimSuffix(filepath.Base(path), ext)

	// Try adding [1], [2], etc.
	for i := 1; i < 1000; i++ {
		newPath := filepath.Join(dir, fmt.Sprintf("%s[%d]%s", base, i, ext))
		if _, err := os.Stat(newPath); os.IsNotExist(err) {
			return newPath
		}
	}

	// Fallback: use timestamp (very unlikely to reach here)
	timestamp := fmt.Sprintf("%d", os.Getpid())
	return filepath.Join(dir, fmt.Sprintf("%s_%s%s", base, timestamp, ext))
}

// TusHandler returns the UnroutedHandler for tus uploads
func (h *UploadHandler) TusHandler() *tusd.UnroutedHandler {
	return h.tusHandler
}
