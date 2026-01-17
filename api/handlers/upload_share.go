package handlers

import (
	"database/sql"
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/tus/tusd/v2/pkg/filestore"
	tusd "github.com/tus/tusd/v2/pkg/handler"
	"golang.org/x/crypto/bcrypt"
)

// UploadShareHandler handles upload share functionality
type UploadShareHandler struct {
	db                  *sql.DB
	dataRoot            string
	auditHandler        *AuditHandler
	notificationService *NotificationService
	tusHandler          *tusd.UnroutedHandler
}

// UploadShareInfo represents upload share access information
type UploadShareInfo struct {
	Token             string     `json:"token"`
	FolderName        string     `json:"folderName"`
	ExpiresAt         *time.Time `json:"expiresAt,omitempty"`
	MaxFileSize       int64      `json:"maxFileSize,omitempty"`
	AllowedExtensions string     `json:"allowedExtensions,omitempty"`
	UploadCount       int        `json:"uploadCount"`
	MaxAccess         *int       `json:"maxAccess,omitempty"`
	MaxTotalSize      int64      `json:"maxTotalSize,omitempty"`
	TotalUploadedSize int64      `json:"totalUploadedSize"`
	RemainingSize     int64      `json:"remainingSize,omitempty"`
	RemainingUploads  int        `json:"remainingUploads,omitempty"`
}

// NewUploadShareHandler creates a new UploadShareHandler
func NewUploadShareHandler(db *sql.DB, dataRoot string, auditHandler *AuditHandler, notificationService *NotificationService) (*UploadShareHandler, error) {
	// Create upload temp directory for share uploads
	uploadDir := filepath.Join(dataRoot, ".share-uploads")
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create share upload directory: %w", err)
	}

	// Create file store for tus
	store := filestore.New(uploadDir)

	// Create tus handler
	composer := tusd.NewStoreComposer()
	store.UseIn(composer)

	h := &UploadShareHandler{
		db:                  db,
		dataRoot:            dataRoot,
		auditHandler:        auditHandler,
		notificationService: notificationService,
	}

	// Create TUS handler with pre-upload validation
	handler, err := tusd.NewUnroutedHandler(tusd.Config{
		BasePath:                "/",
		StoreComposer:           composer,
		NotifyCompleteUploads:   true,
		RespectForwardedHeaders: true,
		PreUploadCreateCallback: h.preUploadValidation,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create share tus handler: %w", err)
	}

	h.tusHandler = handler

	// Start goroutine to handle completed uploads
	go h.handleCompletedUploads()

	return h, nil
}

// AccessUploadShare validates and returns upload share information
func (h *UploadShareHandler) AccessUploadShare(c echo.Context) error {
	token := c.Param("token")

	var share struct {
		ID                string
		Token             string
		Path              string
		ExpiresAt         sql.NullTime
		PasswordHash      sql.NullString
		AccessCount       int
		MaxAccess         sql.NullInt32
		IsActive          bool
		RequireLogin      bool
		ShareType         string
		MaxFileSize       int64
		AllowedExtensions sql.NullString
		UploadCount       int
		MaxTotalSize      int64
		TotalUploadedSize int64
	}

	err := h.db.QueryRow(`
		SELECT id, token, path, expires_at, password_hash, access_count, max_access,
		       is_active, require_login, share_type, max_file_size, allowed_extensions,
		       upload_count, max_total_size, total_uploaded_size
		FROM shares
		WHERE token = $1
	`, token).Scan(&share.ID, &share.Token, &share.Path, &share.ExpiresAt,
		&share.PasswordHash, &share.AccessCount, &share.MaxAccess, &share.IsActive,
		&share.RequireLogin, &share.ShareType, &share.MaxFileSize, &share.AllowedExtensions,
		&share.UploadCount, &share.MaxTotalSize, &share.TotalUploadedSize)

	if err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Share not found",
		})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Database error",
		})
	}

	// Verify this is an upload share
	if share.ShareType != "upload" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Not an upload share",
		})
	}

	// Check if active
	if !share.IsActive {
		return c.JSON(http.StatusGone, map[string]string{
			"error": "Share is no longer available",
		})
	}

	// Check expiry
	if share.ExpiresAt.Valid && time.Now().After(share.ExpiresAt.Time) {
		return c.JSON(http.StatusGone, map[string]string{
			"error": "Share has expired",
		})
	}

	// Check max upload count
	if share.MaxAccess.Valid && share.UploadCount >= int(share.MaxAccess.Int32) {
		return c.JSON(http.StatusGone, map[string]string{
			"error": "Upload limit reached",
		})
	}

	// Check if login is required
	if share.RequireLogin {
		claims, _ := c.Get("user").(*JWTClaims)
		if claims == nil {
			return c.JSON(http.StatusOK, map[string]interface{}{
				"requiresLogin": true,
				"token":         token,
			})
		}
	}

	// Check if password is required
	if share.PasswordHash.Valid {
		var req struct {
			Password string `json:"password"`
		}
		if err := c.Bind(&req); err != nil || req.Password == "" {
			return c.JSON(http.StatusOK, map[string]interface{}{
				"requiresPassword": true,
				"token":            token,
			})
		}

		// Verify password
		if err := bcrypt.CompareHashAndPassword([]byte(share.PasswordHash.String), []byte(req.Password)); err != nil {
			return c.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Invalid password",
			})
		}
	}

	// Build response
	info := UploadShareInfo{
		Token:             share.Token,
		FolderName:        filepath.Base(share.Path),
		MaxFileSize:       share.MaxFileSize,
		UploadCount:       share.UploadCount,
		MaxTotalSize:      share.MaxTotalSize,
		TotalUploadedSize: share.TotalUploadedSize,
	}

	if share.ExpiresAt.Valid {
		info.ExpiresAt = &share.ExpiresAt.Time
	}
	if share.AllowedExtensions.Valid {
		info.AllowedExtensions = share.AllowedExtensions.String
	}
	if share.MaxAccess.Valid {
		val := int(share.MaxAccess.Int32)
		info.MaxAccess = &val
		info.RemainingUploads = val - share.UploadCount
	}
	if share.MaxTotalSize > 0 {
		info.RemainingSize = share.MaxTotalSize - share.TotalUploadedSize
	}

	return c.JSON(http.StatusOK, info)
}

// preUploadValidation validates uploads before they start
func (h *UploadShareHandler) preUploadValidation(hook tusd.HookEvent) (tusd.HTTPResponse, tusd.FileInfoChanges, error) {
	resp := tusd.HTTPResponse{}
	changes := tusd.FileInfoChanges{}

	// Get metadata
	shareToken := hook.Upload.MetaData["shareToken"]
	filename := hook.Upload.MetaData["filename"]
	uploadSize := hook.Upload.Size

	if shareToken == "" {
		resp.StatusCode = 400
		resp.Body = `{"error":"Share token is required"}`
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	if filename == "" {
		resp.StatusCode = 400
		resp.Body = `{"error":"Filename is required"}`
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	// Validate filename
	if err := validateFilename(filename); err != nil {
		fmt.Printf("[UploadShare] Filename validation failed: %s (filename: %s)\n", err.Error(), filename)
		resp.StatusCode = 400
		resp.Body = fmt.Sprintf(`{"error":"%s"}`, err.Error())
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	// Get share info from database
	var share struct {
		ID                string
		Path              string
		ExpiresAt         sql.NullTime
		MaxAccess         sql.NullInt32
		IsActive          bool
		ShareType         string
		MaxFileSize       int64
		AllowedExtensions sql.NullString
		UploadCount       int
		MaxTotalSize      int64
		TotalUploadedSize int64
	}

	err := h.db.QueryRow(`
		SELECT id, path, expires_at, max_access, is_active, share_type,
		       max_file_size, allowed_extensions, upload_count, max_total_size, total_uploaded_size
		FROM shares
		WHERE token = $1
	`, shareToken).Scan(&share.ID, &share.Path, &share.ExpiresAt, &share.MaxAccess,
		&share.IsActive, &share.ShareType, &share.MaxFileSize, &share.AllowedExtensions,
		&share.UploadCount, &share.MaxTotalSize, &share.TotalUploadedSize)

	if err != nil {
		resp.StatusCode = 404
		resp.Body = `{"error":"Share not found"}`
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	// Validate share
	if share.ShareType != "upload" {
		resp.StatusCode = 400
		resp.Body = `{"error":"Not an upload share"}`
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	if !share.IsActive {
		resp.StatusCode = 410
		resp.Body = `{"error":"Share is no longer available"}`
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	if share.ExpiresAt.Valid && time.Now().After(share.ExpiresAt.Time) {
		resp.StatusCode = 410
		resp.Body = `{"error":"Share has expired"}`
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	if share.MaxAccess.Valid && share.UploadCount >= int(share.MaxAccess.Int32) {
		resp.StatusCode = 410
		resp.Body = `{"error":"Upload limit reached"}`
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	// Check file size
	if share.MaxFileSize > 0 && uploadSize > share.MaxFileSize {
		resp.StatusCode = 413
		resp.Body = fmt.Sprintf(`{"error":"File too large","maxSize":%d,"actualSize":%d}`, share.MaxFileSize, uploadSize)
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	// Check total size
	if share.MaxTotalSize > 0 && share.TotalUploadedSize+uploadSize > share.MaxTotalSize {
		remaining := share.MaxTotalSize - share.TotalUploadedSize
		resp.StatusCode = 413
		resp.Body = fmt.Sprintf(`{"error":"Total upload size limit exceeded","remaining":%d,"required":%d}`, remaining, uploadSize)
		return resp, changes, tusd.ErrUploadRejectedByServer
	}

	// Check allowed extensions
	if share.AllowedExtensions.Valid && share.AllowedExtensions.String != "" {
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filename), "."))
		allowed := strings.Split(share.AllowedExtensions.String, ",")
		isAllowed := false
		for _, a := range allowed {
			if strings.TrimSpace(strings.ToLower(a)) == ext {
				isAllowed = true
				break
			}
		}
		if !isAllowed {
			resp.StatusCode = 400
			resp.Body = fmt.Sprintf(`{"error":"File type not allowed","allowed":"%s"}`, share.AllowedExtensions.String)
			return resp, changes, tusd.ErrUploadRejectedByServer
		}
	}

	// Store share ID and path in metadata for completion handler
	// Preserve clientIP from the original request metadata
	clientIP := hook.Upload.MetaData["clientIP"]
	if hook.Upload.MetaData == nil {
		hook.Upload.MetaData = make(map[string]string)
	}
	changes.MetaData = map[string]string{
		"shareID":    share.ID,
		"destPath":   share.Path,
		"filename":   filename,
		"shareToken": shareToken,
		"clientIP":   clientIP,
	}

	fmt.Printf("Share upload pre-validation passed: token=%s, filename=%s, size=%d\n",
		shareToken, filename, uploadSize)

	return resp, changes, nil
}

// handleCompletedUploads processes completed uploads
func (h *UploadShareHandler) handleCompletedUploads() {
	for event := range h.tusHandler.CompleteUploads {
		shareID := event.Upload.MetaData["shareID"]
		destPath := event.Upload.MetaData["destPath"]
		filename := event.Upload.MetaData["filename"]
		shareToken := event.Upload.MetaData["shareToken"]
		// clientIP is already decoded by TUS library (no need for base64 decode)
		clientIP := event.Upload.MetaData["clientIP"]
		if clientIP == "" {
			clientIP = "0.0.0.0"
		}

		if shareID == "" || destPath == "" || filename == "" {
			fmt.Println("Share upload completion: missing metadata")
			continue
		}

		// Get share owner info for audit logging
		var ownerID, ownerUsername string
		_ = h.db.QueryRow(`
			SELECT s.created_by, u.username
			FROM shares s
			JOIN users u ON s.created_by = u.id
			WHERE s.id = $1
		`, shareID).Scan(&ownerID, &ownerUsername)

		// Build full destination path
		realPath := filepath.Join(h.dataRoot, destPath)
		finalPath := filepath.Join(realPath, filename)

		// Ensure destination directory exists
		if err := os.MkdirAll(realPath, 0755); err != nil {
			fmt.Printf("Failed to create directory: %v\n", err)
			continue
		}

		// Check if file already exists, generate unique name
		finalPath = h.getUniqueFilePath(finalPath)

		// Move file from temp to destination
		srcPath := filepath.Join(h.dataRoot, ".share-uploads", event.Upload.ID)
		if err := os.Rename(srcPath, finalPath); err != nil {
			fmt.Printf("Failed to move file: %v\n", err)
			continue
		}

		// Clean up .info file
		infoPath := srcPath + ".info"
		os.Remove(infoPath)

		// Update share statistics
		_, _ = h.db.Exec(`
			UPDATE shares
			SET upload_count = upload_count + 1,
			    total_uploaded_size = total_uploaded_size + $1
			WHERE id = $2
		`, event.Upload.Size, shareID)

		fmt.Printf("Share upload completed: token=%s, file=%s, size=%d\n",
			shareToken, filepath.Base(finalPath), event.Upload.Size)

		// Log audit event with share owner as actor
		var actorID *string
		if ownerID != "" {
			actorID = &ownerID
		}
		_ = h.auditHandler.LogEvent(actorID, clientIP, EventFileUpload, "/"+destPath+"/"+filepath.Base(finalPath), map[string]interface{}{
			"fileName":      filepath.Base(finalPath),
			"size":          event.Upload.Size,
			"source":        "share_upload",
			"shareToken":    shareToken,
			"shareOwner":    ownerUsername,
			"uploadedVia":   "공유 링크",
		})

		// Send notification to share owner
		if h.notificationService != nil && ownerID != "" {
			title := "업로드 링크로 파일이 업로드되었습니다"
			message := fmt.Sprintf("누군가가 '%s' 파일을 업로드했습니다 (%s)", filepath.Base(finalPath), formatFileSize(event.Upload.Size))
			link := "/" + destPath
			_, _ = h.notificationService.Create(
				ownerID,
				NotifUploadLinkReceived,
				title,
				message,
				link,
				nil,
				map[string]interface{}{
					"shareToken": shareToken,
					"filename":   filepath.Base(finalPath),
					"size":       event.Upload.Size,
					"clientIP":   clientIP,
				},
			)
		}
	}
}

// formatFileSize formats file size in human-readable format
func formatFileSize(size int64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
	)
	switch {
	case size >= GB:
		return fmt.Sprintf("%.1f GB", float64(size)/float64(GB))
	case size >= MB:
		return fmt.Sprintf("%.1f MB", float64(size)/float64(MB))
	case size >= KB:
		return fmt.Sprintf("%.1f KB", float64(size)/float64(KB))
	default:
		return fmt.Sprintf("%d bytes", size)
	}
}

// getUniqueFilePath returns a unique file path by adding [1], [2], etc. if file exists
func (h *UploadShareHandler) getUniqueFilePath(path string) string {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return path
	}

	dir := filepath.Dir(path)
	ext := filepath.Ext(path)
	base := strings.TrimSuffix(filepath.Base(path), ext)

	for i := 1; i < 1000; i++ {
		newPath := filepath.Join(dir, fmt.Sprintf("%s[%d]%s", base, i, ext))
		if _, err := os.Stat(newPath); os.IsNotExist(err) {
			return newPath
		}
	}

	timestamp := fmt.Sprintf("%d", time.Now().UnixNano())
	return filepath.Join(dir, fmt.Sprintf("%s_%s%s", base, timestamp, ext))
}

// TusHandler returns the TUS handler for upload shares
func (h *UploadShareHandler) TusHandler() *tusd.UnroutedHandler {
	return h.tusHandler
}

// HandleShareUpload routes TUS upload requests for share uploads
func (h *UploadShareHandler) HandleShareUpload(c echo.Context) error {
	req := c.Request()
	res := c.Response()
	token := c.Param("token")

	// Extract the upload ID from the path
	// Original path: /api/u/:token/upload/ or /api/u/:token/upload/{id}
	originalPath := req.URL.Path
	prefix := fmt.Sprintf("/api/u/%s/upload", token)
	tusPath := strings.TrimPrefix(originalPath, prefix)
	if tusPath == "" {
		tusPath = "/"
	}

	// Modify the request URL path for tusd
	req.URL.Path = tusPath

	// For POST requests, inject share token and client IP into metadata
	if req.Method == http.MethodPost {
		// Get existing metadata header and add share token
		metadata := req.Header.Get("Upload-Metadata")
		if metadata != "" {
			metadata += ", "
		}
		// Add share token (base64 encode it)
		encodedToken := EncodeBase64([]byte(token))
		metadata += "shareToken " + encodedToken

		// Add client IP
		clientIP := c.RealIP()
		encodedIP := EncodeBase64([]byte(clientIP))
		metadata += ", clientIP " + encodedIP

		req.Header.Set("Upload-Metadata", metadata)
	}

	switch req.Method {
	case http.MethodPost:
		// Wrap response writer to fix Location header
		wrappedRes := &locationRewriter{
			ResponseWriter: res.Writer,
			prefix:         fmt.Sprintf("/api/u/%s/upload/", token),
		}
		h.tusHandler.PostFile(wrappedRes, req)
	case http.MethodHead:
		h.tusHandler.HeadFile(res, req)
	case http.MethodPatch:
		h.tusHandler.PatchFile(res, req)
	case http.MethodDelete:
		h.tusHandler.DelFile(res, req)
	case http.MethodGet:
		h.tusHandler.GetFile(res, req)
	case http.MethodOptions:
		res.Header().Set("Tus-Resumable", "1.0.0")
		res.Header().Set("Tus-Version", "1.0.0")
		res.Header().Set("Tus-Extension", "creation,creation-with-upload,termination")
		res.Header().Set("Tus-Max-Size", "10737418240")
		res.WriteHeader(http.StatusNoContent)
	default:
		return c.String(http.StatusMethodNotAllowed, "Method not allowed")
	}

	// Restore original path
	req.URL.Path = originalPath
	return nil
}

// EncodeBase64 encodes bytes to base64 string
func EncodeBase64(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

// locationRewriter wraps http.ResponseWriter to rewrite Location header
type locationRewriter struct {
	http.ResponseWriter
	prefix string
}

func (l *locationRewriter) WriteHeader(code int) {
	// Rewrite Location header if present
	if loc := l.Header().Get("Location"); loc != "" {
		// Extract upload ID from URL (handles both http://host/id and /id formats)
		parts := strings.Split(loc, "/")
		if len(parts) > 0 {
			uploadID := parts[len(parts)-1]
			if uploadID != "" && !strings.Contains(uploadID, "upload") {
				l.Header().Set("Location", l.prefix+uploadID)
			}
		}
	}
	l.ResponseWriter.WriteHeader(code)
}
