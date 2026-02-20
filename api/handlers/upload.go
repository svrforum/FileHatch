package handlers

import (
	"context"
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
	tusHandler     *tusd.UnroutedHandler
	dataRoot       string
	db             *sql.DB
	auditHandler   *AuditHandler
	storageRouter  *StorageRouter
}

func NewUploadHandler(dataRoot string, db *sql.DB, storageRouter *StorageRouter) (*UploadHandler, error) {
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
		dataRoot:      dataRoot,
		db:            db,
		auditHandler:  NewAuditHandler(db, dataRoot),
		storageRouter: storageRouter,
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

	// Debug logging
	LogInfo("[TUS-PreUpload] Received metadata", "path", destPath, "filename", filename, "username", username, "size", uploadSize)

	// Validate required metadata
	if filename == "" {
		LogWarn("[TUS-PreUpload] REJECTED: filename is empty")
		resp.StatusCode = 400
		resp.Body = `{"error":"Filename is required"}`
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	if destPath == "" {
		destPath = "/home" // Default to home folder instead of shared
	}

	// Prevent uploads directly to /shared/ root (must upload inside a shared folder)
	if destPath == "/shared" || destPath == "/shared/" {
		LogWarn("[TUS-PreUpload] REJECTED: cannot upload to shared root")
		resp.StatusCode = 403
		resp.Body = `{"error":"공유 드라이브 루트에는 파일을 업로드할 수 없습니다"}`
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	// Validate path security
	_, err := h.resolveVirtualPath(destPath, username)
	if err != nil {
		LogWarn("[TUS-PreUpload] REJECTED: path validation failed", "error", err.Error())
		resp.StatusCode = 400
		resp.Body = fmt.Sprintf(`{"error":"Invalid upload path: %s"}`, err.Error())
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	// Check storage quota
	if username != "" && uploadSize > 0 {
		quotaOk, remaining, err := h.checkUserQuota(username, uploadSize)
		if err != nil {
			LogError("Quota check error", err, "user", username)
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
	LogInfo("[TUS-PreUpload] Validation passed", "user", username, "path", destPath, "filename", filename, "size", uploadSize)

	return resp, changes, nil
}

// checkUserQuota checks if user has enough storage quota for the upload
// Quota is checked against home folder + trash usage (shared folders have separate quota)
// Uses database-stored values for instant checks (no filesystem scan)
func (h *UploadHandler) checkUserQuota(username string, uploadSize int64) (bool, int64, error) {
	// Get user quota and current usage from database
	var quota, storageUsed, trashUsed sql.NullInt64
	err := h.db.QueryRow(`
		SELECT COALESCE(storage_quota, $1), storage_used, trash_used
		FROM users WHERE username = $2
	`, DefaultUserQuota, username).Scan(&quota, &storageUsed, &trashUsed)

	if err != nil && err != sql.ErrNoRows {
		return true, 0, err // Fail-open on error
	}

	// Get quota value (0 means unlimited)
	var quotaVal int64 = DefaultUserQuota
	if quota.Valid && quota.Int64 > 0 {
		quotaVal = quota.Int64
	} else if quota.Valid && quota.Int64 == 0 {
		return true, -1, nil // Unlimited
	}

	// Get current usage from DB (instant - no filesystem scan)
	var currentUsage int64
	if storageUsed.Valid {
		currentUsage += storageUsed.Int64
	}
	if trashUsed.Valid {
		currentUsage += trashUsed.Int64
	}

	remaining := quotaVal - currentUsage
	if uploadSize > remaining {
		LogInfo("[QuotaCheck] REJECTED", "user", username, "used", currentUsage, "quota", quotaVal, "upload", uploadSize)
		return false, remaining, nil
	}

	return true, remaining, nil
}

// checkSharedDriveQuota checks quota for shared drive
// Uses database-stored storage_used value for instant checks (no filesystem scan)
func (h *UploadHandler) checkSharedDriveQuota(path string, uploadSize int64) (allowed bool, quota int64, used int64) {
	folderName := ExtractSharedDriveFolderName(path)
	if folderName == "" {
		return true, 0, 0 // No folder name means root shared, allow
	}

	// Get quota and current usage from database
	var storageUsed sql.NullInt64
	err := h.db.QueryRow(`
		SELECT storage_quota, storage_used FROM shared_folders WHERE name = $1 AND is_active = TRUE
	`, folderName).Scan(&quota, &storageUsed)
	if err != nil {
		return true, 0, 0 // Allow on error
	}

	// 0 = unlimited
	if quota == 0 {
		return true, 0, 0
	}

	// Get current usage from DB (instant - no filesystem scan)
	if storageUsed.Valid {
		used = storageUsed.Int64
	}

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

	// Note: Dangerous extensions (.exe, .bat, etc.) are allowed for authenticated users
	// Downloads are protected with Content-Disposition: attachment header to prevent execution
	// Public upload links have their own extension restrictions via allowedExtensions

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
	case "external":
		// External storage: use StorageRouter to validate access
		if h.storageRouter == nil {
			return "", fmt.Errorf("external storage not configured")
		}
		if username == "" {
			return "", fmt.Errorf("username required for external storage")
		}
		// Get user ID for the username
		var userID string
		err := h.db.QueryRow("SELECT id FROM users WHERE username = $1", username).Scan(&userID)
		if err != nil {
			return "", fmt.Errorf("user not found: %s", username)
		}
		claims := &JWTClaims{Username: username, UserID: userID}
		result, resolveErr := h.storageRouter.Resolve(virtualPath, claims)
		if resolveErr != nil {
			return "", resolveErr
		}
		if result.IsReadonly {
			return "", fmt.Errorf("external storage is read-only")
		}
		// For local-mount external storage, return the real path
		if result.Backend != nil && result.Backend.IsLocal() {
			rp, rpErr := result.Backend.GetRealPath(result.RelPath)
			if rpErr != nil {
				return "", rpErr
			}
			return rp, nil
		}
		// For non-local (S3, etc.), return a marker path
		if len(pathParts) < 2 {
			return "", fmt.Errorf("external storage mount path required")
		}
		mountPath := pathParts[1]
		extRelPath := ""
		if len(pathParts) > 2 {
			extRelPath = filepath.Join(pathParts[2:]...)
		}
		return fmt.Sprintf("external:%s:%s", mountPath, extRelPath), nil
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
			LogError("[Upload] Failed to resolve virtual path", err, "path", destPath)
			BroadcastUploadError(username, filename, "경로를 확인할 수 없습니다: "+err.Error())
			continue
		}

		// Move file to destination
		srcPath := filepath.Join(h.dataRoot, ".uploads", event.Upload.ID)

		// Check if this is a non-local external storage (marker: "external:{mountPath}:{relPath}")
		if strings.HasPrefix(realDestPath, "external:") {
			// Non-local external storage upload
			parts := strings.SplitN(realDestPath, ":", 3)
			if len(parts) < 3 {
				LogError("[Upload] Invalid external storage marker", nil, "marker", realDestPath)
				BroadcastUploadError(username, filename, "잘못된 외부 스토리지 경로입니다")
				continue
			}
			mountPath := parts[1]
			extRelPath := parts[2]

			// Resolve the external backend
			if h.storageRouter == nil {
				LogError("[Upload] Storage router not available for external upload", nil)
				BroadcastUploadError(username, filename, "외부 스토리지가 구성되지 않았습니다")
				continue
			}

			var userID string
			if err := h.db.QueryRow("SELECT id FROM users WHERE username = $1", username).Scan(&userID); err != nil {
				LogError("[Upload] Failed to get user ID", err, "username", username)
				BroadcastUploadError(username, filename, "사용자 정보를 찾을 수 없습니다")
				continue
			}
			claims := &JWTClaims{Username: username, UserID: userID}
			// Build resolve path: ensure proper path even when extRelPath is empty
			resolvePath := "/external/" + mountPath
			if extRelPath != "" {
				resolvePath = resolvePath + "/" + extRelPath
			}
			extResult, err := h.storageRouter.Resolve(resolvePath, claims)
			if err != nil {
				LogError("[Upload] Failed to resolve external storage", err, "path", resolvePath)
				BroadcastUploadError(username, filename, "외부 스토리지를 확인할 수 없습니다: "+err.Error())
				continue
			}

			// Open the uploaded temp file
			srcFile, err := os.Open(srcPath)
			if err != nil {
				LogError("[Upload] Failed to open uploaded file", err, "path", srcPath)
				BroadcastUploadError(username, filename, "업로드된 임시 파일을 열 수 없습니다")
				continue
			}

			// Write to external backend
			fileRelPath := filepath.Join(extResult.RelPath, filename)
			ctx := context.Background()
			if err := extResult.Backend.WriteFile(ctx, fileRelPath, srcFile, event.Upload.Size); err != nil {
				srcFile.Close()
				LogError("[Upload] Failed to write to external storage", err, "filename", filename, "mount", mountPath)
				BroadcastUploadError(username, filename, "외부 스토리지 쓰기 실패: "+err.Error())
				os.Remove(srcPath)
				os.Remove(srcPath + ".info")
				continue
			}
			srcFile.Close()

			// Clean up temp files
			if err := os.Remove(srcPath); err != nil && !os.IsNotExist(err) {
				LogWarn("[Upload] Failed to clean up temp file", "path", srcPath, "error", err.Error())
			}
			if err := os.Remove(srcPath + ".info"); err != nil && !os.IsNotExist(err) {
				LogWarn("[Upload] Failed to clean up info file", "path", srcPath+".info", "error", err.Error())
			}

			LogInfo("[Upload] Completed (external)", "filename", filename, "mount", mountPath, "relPath", extRelPath, "overwrite", overwrite)

			// Broadcast file change event for UI refresh
			BroadcastFileChange(FileChangeEvent{
				Type:      "create",
				Path:      "/external/" + mountPath + "/" + filepath.Join(extRelPath, filename),
				Name:      filename,
				IsDir:     false,
				Timestamp: time.Now().Unix(),
			})
		} else {
			// Local storage upload (home, shared, local-mount external)
			finalPath := filepath.Join(realDestPath, filename)

			// Ensure destination directory exists with appropriate permissions
			destDir := filepath.Dir(finalPath)
			if strings.HasPrefix(destPath, "/shared/") {
				if err := MkdirAllShared(destDir); err != nil {
					LogError("[Upload] Failed to create directory", err, "dir", destDir)
					BroadcastUploadError(username, filename, "디렉토리 생성 실패: "+err.Error())
					continue
				}
			} else {
				if err := os.MkdirAll(destDir, 0755); err != nil {
					LogError("[Upload] Failed to create directory", err, "dir", destDir)
					BroadcastUploadError(username, filename, "디렉토리 생성 실패: "+err.Error())
					continue
				}
			}

			// Check if file already exists
			if !overwrite {
				// Generate unique name if file exists and overwrite is not requested
				finalPath = h.getUniqueFilePath(finalPath)
			}
			// If overwrite is true, the existing file will be replaced by moveOrCopy

			// Mark this file as a web upload before moving
			tracker := GetWebUploadTracker()
			tracker.MarkUploading(finalPath)

			// Move file (will overwrite if exists; cross-device safe)
			if err := moveOrCopy(srcPath, finalPath); err != nil {
				LogError("[Upload] Failed to move file", err, "src", srcPath, "dst", finalPath)
				BroadcastUploadError(username, filename, "파일 이동 실패: "+err.Error())
				tracker.UnmarkUploading(finalPath)
				continue
			}

			// Set permissions for shared folders
			if strings.HasPrefix(destPath, "/shared/") {
				_ = SetSharedPermissions(finalPath, false)
			}

			// Clean up .info file
			infoPath := srcPath + ".info"
			os.Remove(infoPath)

			LogInfo("[Upload] Completed", "filename", filename, "dest", finalPath, "overwrite", overwrite)

			// Update storage tracking for the user (home folder uploads)
			if username != "" && h.auditHandler != nil && h.auditHandler.db != nil && !strings.HasPrefix(destPath, "/shared/") && !strings.HasPrefix(destPath, "/external/") {
				// Get file size after upload
				fileSize := event.Upload.Size
				_, err := h.auditHandler.db.Exec(`
					UPDATE users
					SET storage_used = GREATEST(0, COALESCE(storage_used, 0) + $1),
					    updated_at = NOW()
					WHERE username = $2
				`, fileSize, username)
				if err != nil {
					LogError("[Storage] Failed to update storage", err, "user", username)
				}
			}

			// Update storage tracking for shared folders
			if strings.HasPrefix(destPath, "/shared/") && h.auditHandler != nil && h.auditHandler.db != nil {
				folderName := ExtractSharedDriveFolderName(destPath)
				if folderName != "" {
					fileSize := event.Upload.Size
					_, err := h.auditHandler.db.Exec(`
						UPDATE shared_folders
						SET storage_used = GREATEST(0, COALESCE(storage_used, 0) + $1),
						    updated_at = NOW()
						WHERE name = $2 AND is_active = TRUE
					`, fileSize, folderName)
					if err != nil {
						LogError("[Storage] Failed to update shared folder storage", err, "folder", folderName)
					}
				}
			}

			// Keep the mark for 10 seconds then remove it
			go func(path string) {
				time.Sleep(10 * time.Second)
				tracker.UnmarkUploading(path)
			}(finalPath)
		}

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
		_ = h.auditHandler.LogEvent(userID, ipAddr, EventFileUpload, destPath+"/"+filename, map[string]interface{}{
			"fileName": filename,
			"size":     event.Upload.Size,
			"source":   "web",
		})
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

// getUniqueFilePath atomically finds and reserves a unique file path.
// Uses O_CREATE|O_EXCL to prevent TOCTOU race conditions between concurrent uploads.
func (h *UploadHandler) getUniqueFilePath(path string) string {
	// Try the original path first - atomically create a placeholder
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if err == nil {
		f.Close()
		return path
	}

	// File exists, try numbered alternatives
	dir := filepath.Dir(path)
	ext := filepath.Ext(path)
	base := strings.TrimSuffix(filepath.Base(path), ext)

	for i := 1; i < 1000; i++ {
		newPath := filepath.Join(dir, fmt.Sprintf("%s[%d]%s", base, i, ext))
		f, err := os.OpenFile(newPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err == nil {
			f.Close()
			return newPath
		}
	}

	// Fallback: use nanosecond timestamp for uniqueness (not PID which is shared across goroutines)
	timestamp := fmt.Sprintf("%d", time.Now().UnixNano())
	fallbackPath := filepath.Join(dir, fmt.Sprintf("%s_%s%s", base, timestamp, ext))
	f, err = os.OpenFile(fallbackPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if err == nil {
		f.Close()
		return fallbackPath
	}
	// Absolute last resort
	return fallbackPath
}

// TusHandler returns the UnroutedHandler for tus uploads
func (h *UploadHandler) TusHandler() *tusd.UnroutedHandler {
	return h.tusHandler
}
