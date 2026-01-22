package handlers

import (
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

type ShareHandler struct {
	db                  *sql.DB
	dataRoot            string
	auditHandler        *AuditHandler
	notificationService *NotificationService
}

func NewShareHandler(db *sql.DB, dataRoot string, auditHandler *AuditHandler, notificationService *NotificationService) *ShareHandler {
	return &ShareHandler{
		db:                  db,
		dataRoot:            dataRoot,
		auditHandler:        auditHandler,
		notificationService: notificationService,
	}
}

// Share represents a shared link
type Share struct {
	ID           string     `json:"id"`
	Token        string     `json:"token"`
	Path         string     `json:"path"`
	DisplayPath  string     `json:"displayPath"`
	CreatedBy    string     `json:"createdBy"`
	CreatedAt    time.Time  `json:"createdAt"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
	HasPassword  bool       `json:"hasPassword"`
	AccessCount  int        `json:"accessCount"`
	MaxAccess    *int       `json:"maxAccess,omitempty"`
	IsActive     bool       `json:"isActive"`
	RequireLogin bool       `json:"requireLogin"`
	// File metadata fields
	Size  int64  `json:"size"`
	IsDir bool   `json:"isDir"`
	Name  string `json:"name"`
	// Upload share fields
	ShareType         string `json:"shareType"`                   // "download", "upload", or "edit"
	Editable          bool   `json:"editable"`                    // If true, allows document editing via OnlyOffice
	MaxFileSize       int64  `json:"maxFileSize,omitempty"`       // Max size per file in bytes (0 = unlimited)
	AllowedExtensions string `json:"allowedExtensions,omitempty"` // Comma-separated list (e.g., "pdf,docx,jpg")
	UploadCount       int    `json:"uploadCount"`                 // Number of files uploaded
	MaxTotalSize      int64  `json:"maxTotalSize,omitempty"`      // Max total upload size in bytes (0 = unlimited)
	TotalUploadedSize int64  `json:"totalUploadedSize"`           // Current total uploaded bytes
}

// CreateShareRequest represents share creation request
type CreateShareRequest struct {
	Path         string `json:"path"`
	Password     string `json:"password,omitempty"`
	ExpiresIn    int    `json:"expiresIn,omitempty"` // hours, 0 = never
	MaxAccess    int    `json:"maxAccess,omitempty"` // 0 = unlimited
	RequireLogin bool   `json:"requireLogin"`        // If true, only authenticated users can access
	// Share type and editing fields
	ShareType         string `json:"shareType,omitempty"`         // "download" (default), "upload", or "edit"
	Editable          bool   `json:"editable,omitempty"`          // If true, allows document editing via OnlyOffice
	MaxFileSize       int64  `json:"maxFileSize,omitempty"`       // Max size per file in bytes (0 = unlimited)
	AllowedExtensions string `json:"allowedExtensions,omitempty"` // Comma-separated list
	MaxTotalSize      int64  `json:"maxTotalSize,omitempty"`      // Max total upload size
}

// AccessShareRequest represents share access request
type AccessShareRequest struct {
	Password string `json:"password,omitempty"`
}

// resolvePath converts a virtual path to a real filesystem path for sharing
func (h *ShareHandler) resolvePath(virtualPath string, username string) (realPath string, storedPath string, err error) {
	cleanPath := filepath.Clean(virtualPath)
	if strings.Contains(cleanPath, "..") {
		return "", "", fmt.Errorf("invalid path")
	}

	parts := strings.Split(strings.TrimPrefix(cleanPath, "/"), "/")
	if len(parts) == 0 || (len(parts) == 1 && parts[0] == "") {
		return "", "", fmt.Errorf("path required")
	}

	root := parts[0]
	subPath := ""
	if len(parts) > 1 {
		subPath = filepath.Join(parts[1:]...)
	}

	switch root {
	case "home":
		realPath = filepath.Join(h.dataRoot, "users", username, subPath)
		storedPath = filepath.Join("users", username, subPath)
	case "shared":
		realPath = filepath.Join(h.dataRoot, "shared", subPath)
		storedPath = filepath.Join("shared", subPath)
	default:
		return "", "", fmt.Errorf("invalid storage type: %s", root)
	}

	return realPath, storedPath, nil
}

// CreateShare creates a new share link
// CreateShare godoc
// @Summary Create a share link
// @Description Create a public share link for a file or folder with optional password, expiration, and access limits
// @Tags Shares
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body object{path=string,shareType=string,password=string,expiresIn=int,maxAccess=int,requireLogin=bool,editable=bool} true "Share configuration"
// @Success 201 {object} map[string]interface{} "Created share with URL"
// @Failure 400 {object} map[string]string "Invalid request"
// @Failure 401 {object} map[string]string "Unauthorized"
// @Failure 404 {object} map[string]string "File not found"
// @Router /shares [post]

func (h *ShareHandler) CreateShare(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	var req CreateShareRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	if req.Path == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	// Default share type is download
	shareType := req.ShareType
	if shareType == "" {
		shareType = "download"
	}
	if shareType != "download" && shareType != "upload" && shareType != "edit" {
		return RespondError(c, ErrBadRequest("Invalid share type. Must be 'download', 'upload', or 'edit'"))
	}

	// Resolve virtual path to real filesystem path
	fullPath, storedPath, err := h.resolvePath(req.Path, claims.Username)
	if err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	fileInfo, err := os.Stat(fullPath)
	if os.IsNotExist(err) {
		return RespondError(c, ErrNotFound("Path not found"))
	}

	// Upload shares can only be created for folders
	if shareType == "upload" && !fileInfo.IsDir() {
		return RespondError(c, ErrBadRequest("Upload shares can only be created for folders"))
	}

	// Edit shares can only be created for single files (not folders)
	if shareType == "edit" && fileInfo.IsDir() {
		return RespondError(c, ErrBadRequest("Edit shares can only be created for files, not folders"))
	}

	// Editable flag is implicitly true for edit share type
	editable := req.Editable || shareType == "edit"

	// Generate token
	token := generateShareToken()

	// Hash password if provided
	var passwordHash *string
	if req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return RespondError(c, ErrInternal("Failed to hash password"))
		}
		hashStr := string(hash)
		passwordHash = &hashStr
	}

	// Calculate expiry
	var expiresAt *time.Time
	if req.ExpiresIn > 0 {
		t := time.Now().Add(time.Duration(req.ExpiresIn) * time.Hour)
		expiresAt = &t
	}

	// Set max access
	var maxAccess *int
	if req.MaxAccess > 0 {
		maxAccess = &req.MaxAccess
	}

	// Insert new share with editable and upload-specific fields
	var shareID string
	err = h.db.QueryRow(`
		INSERT INTO shares (token, path, created_by, password_hash, expires_at, max_access, require_login,
		                    share_type, editable, max_file_size, allowed_extensions, max_total_size)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id
	`, token, storedPath, claims.UserID, passwordHash, expiresAt, maxAccess, req.RequireLogin,
		shareType, editable, req.MaxFileSize, req.AllowedExtensions, req.MaxTotalSize).Scan(&shareID)

	if err != nil {
		return RespondError(c, ErrOperationFailed("create share", err))
	}

	// Use different URL prefix based on share type
	var shareURL string
	switch shareType {
	case "upload":
		shareURL = fmt.Sprintf("/u/%s", token)
	case "edit":
		shareURL = fmt.Sprintf("/e/%s", token) // New prefix for edit shares
	default:
		shareURL = fmt.Sprintf("/s/%s", token)
	}

	// Audit log for share creation
	h.auditHandler.LogEventFromContext(c, EventShareCreate, storedPath, map[string]interface{}{
		"shareId":        shareID,
		"shareType":      shareType,
		"hasPassword":    req.Password != "",
		"expiresInHours": req.ExpiresIn,
		"maxAccess":      req.MaxAccess,
		"requireLogin":   req.RequireLogin,
		"editable":       editable,
		"isDir":          fileInfo.IsDir(),
	})

	return RespondCreated(c, map[string]interface{}{
		"id":           shareID,
		"token":        token,
		"url":          shareURL,
		"path":         storedPath,
		"expiresAt":    expiresAt,
		"requireLogin": req.RequireLogin,
		"shareType":    shareType,
		"editable":     editable,
	})
}

// ListShares returns shares created by the current user
func (h *ShareHandler) ListShares(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	rows, err := h.db.Query(`
		SELECT id, token, path, created_at, expires_at,
		       CASE WHEN password_hash IS NOT NULL THEN true ELSE false END as has_password,
		       access_count, max_access, is_active, require_login,
		       share_type, COALESCE(editable, false) as editable, max_file_size, allowed_extensions, upload_count, max_total_size, total_uploaded_size
		FROM shares
		WHERE created_by = $1
		ORDER BY created_at DESC
	`, claims.UserID)

	if err != nil {
		return RespondError(c, ErrOperationFailed("list shares", err))
	}
	defer rows.Close()

	shares := []Share{}
	for rows.Next() {
		var share Share
		var expiresAt sql.NullTime
		var maxAccess sql.NullInt32
		var allowedExtensions sql.NullString

		err := rows.Scan(&share.ID, &share.Token, &share.Path, &share.CreatedAt,
			&expiresAt, &share.HasPassword, &share.AccessCount, &maxAccess, &share.IsActive, &share.RequireLogin,
			&share.ShareType, &share.Editable, &share.MaxFileSize, &allowedExtensions, &share.UploadCount, &share.MaxTotalSize, &share.TotalUploadedSize)
		if err != nil {
			continue
		}

		share.CreatedBy = claims.UserID
		if expiresAt.Valid {
			share.ExpiresAt = &expiresAt.Time
		}
		if maxAccess.Valid {
			val := int(maxAccess.Int32)
			share.MaxAccess = &val
		}
		if allowedExtensions.Valid {
			share.AllowedExtensions = allowedExtensions.String
		}

		// Get file metadata - share.Path is stored path like "users/admin/file.txt"
		realPath := filepath.Join(h.dataRoot, share.Path)
		if info, err := os.Stat(realPath); err == nil {
			share.Size = info.Size()
			share.IsDir = info.IsDir()
			share.Name = info.Name()
		} else {
			// File doesn't exist anymore, extract name from path
			pathParts := strings.Split(share.Path, "/")
			if len(pathParts) > 0 {
				share.Name = pathParts[len(pathParts)-1]
			}
		}

		// Convert stored path to display path
		// "users/admin/file.txt" -> "/home/file.txt"
		// "shared/file.txt" -> "/shared/file.txt"
		pathParts := strings.Split(share.Path, "/")
		if len(pathParts) >= 2 && pathParts[0] == "users" {
			// users/{username}/... -> /home/...
			share.DisplayPath = "/home/" + strings.Join(pathParts[2:], "/")
		} else if len(pathParts) >= 1 && pathParts[0] == "shared" {
			// shared/... -> /shared/...
			share.DisplayPath = "/" + share.Path
		} else {
			share.DisplayPath = "/" + share.Path
		}

		shares = append(shares, share)
	}

	return RespondSuccess(c, map[string]interface{}{
		"shares": shares,
		"total":  len(shares),
	})
}

// DeleteShare deletes a share
func (h *ShareHandler) DeleteShare(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}
	shareID := c.Param("id")

	// Get share details before deletion for audit
	var sharePath, shareType string
	err = h.db.QueryRow(`
		SELECT path, share_type FROM shares WHERE id = $1 AND created_by = $2
	`, shareID, claims.UserID).Scan(&sharePath, &shareType)
	if err != nil {
		if err == sql.ErrNoRows {
			return RespondError(c, ErrNotFound("Share not found"))
		}
		return RespondError(c, ErrOperationFailed("query share", err))
	}

	result, err := h.db.Exec(`
		DELETE FROM shares WHERE id = $1 AND created_by = $2
	`, shareID, claims.UserID)

	if err != nil {
		return RespondError(c, ErrOperationFailed("delete share", err))
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return RespondError(c, ErrNotFound("Share not found"))
	}

	// Audit log for share deletion
	h.auditHandler.LogEventFromContext(c, EventShareDelete, sharePath, map[string]interface{}{
		"shareId":   shareID,
		"shareType": shareType,
	})

	return RespondSuccess(c, map[string]interface{}{
		"message": "Share deleted",
	})
}

// AccessShare validates and returns share information for public access
func (h *ShareHandler) AccessShare(c echo.Context) error {
	token := c.Param("token")

	var share Share
	var passwordHash sql.NullString
	var expiresAt sql.NullTime
	var maxAccess sql.NullInt32

	err := h.db.QueryRow(`
		SELECT id, token, path, created_by, created_at, expires_at,
		       password_hash, access_count, max_access, is_active, require_login,
		       share_type, COALESCE(editable, false) as editable
		FROM shares
		WHERE token = $1
	`, token).Scan(&share.ID, &share.Token, &share.Path, &share.CreatedBy,
		&share.CreatedAt, &expiresAt, &passwordHash, &share.AccessCount,
		&maxAccess, &share.IsActive, &share.RequireLogin, &share.ShareType, &share.Editable)

	if err == sql.ErrNoRows {
		return RespondError(c, ErrNotFound("Share not found"))
	}
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}

	// Check if active
	if !share.IsActive {
		return c.JSON(http.StatusGone, map[string]string{"error": "Share is no longer available"})
	}

	// Check expiry
	if expiresAt.Valid && time.Now().After(expiresAt.Time) {
		return c.JSON(http.StatusGone, map[string]string{"error": "Share has expired"})
	}

	// Check max access
	if maxAccess.Valid && share.AccessCount >= int(maxAccess.Int32) {
		return c.JSON(http.StatusGone, map[string]string{"error": "Share access limit reached"})
	}

	// Check if login is required
	if share.RequireLogin {
		// Try to get user claims from context (may be nil if not authenticated)
		claims, _ := c.Get("user").(*JWTClaims)
		if claims == nil {
			return RespondSuccess(c, map[string]interface{}{
				"requiresLogin": true,
				"path":          share.Path,
			})
		}
	}

	share.HasPassword = passwordHash.Valid
	if expiresAt.Valid {
		share.ExpiresAt = &expiresAt.Time
	}
	if maxAccess.Valid {
		val := int(maxAccess.Int32)
		share.MaxAccess = &val
	}

	// Check if password is required
	if share.HasPassword {
		// Check if password is provided
		var req AccessShareRequest
		if err := c.Bind(&req); err != nil || req.Password == "" {
			return RespondSuccess(c, map[string]interface{}{
				"requiresPassword": true,
				"path":             share.Path,
			})
		}

		// Verify password
		if err := bcrypt.CompareHashAndPassword([]byte(passwordHash.String), []byte(req.Password)); err != nil {
			return RespondError(c, ErrUnauthorized("Invalid password"))
		}
	}

	// Increment access count
	_, _ = h.db.Exec("UPDATE shares SET access_count = access_count + 1 WHERE id = $1", share.ID)

	// Get file info
	fullPath := filepath.Join(h.dataRoot, share.Path)
	info, err := os.Stat(fullPath)
	if err != nil {
		return RespondError(c, ErrNotFound("File not found"))
	}

	return RespondSuccess(c, map[string]interface{}{
		"token":     share.Token,
		"path":      share.Path,
		"name":      filepath.Base(share.Path),
		"isDir":     info.IsDir(),
		"size":      info.Size(),
		"expiresAt": share.ExpiresAt,
		"shareType": share.ShareType,
		"editable":  share.Editable,
	})
}

// DownloadShare handles file download for shared link
func (h *ShareHandler) DownloadShare(c echo.Context) error {
	token := c.Param("token")

	var path string
	var passwordHash sql.NullString
	var expiresAt sql.NullTime
	var maxAccess sql.NullInt32
	var accessCount int
	var isActive bool
	var requireLogin bool
	var createdBy string

	err := h.db.QueryRow(`
		SELECT path, password_hash, expires_at, access_count, max_access, is_active, require_login, created_by
		FROM shares WHERE token = $1
	`, token).Scan(&path, &passwordHash, &expiresAt, &accessCount, &maxAccess, &isActive, &requireLogin, &createdBy)

	if err == sql.ErrNoRows {
		return RespondError(c, ErrNotFound("Share not found"))
	}
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}

	// Validate share
	if !isActive {
		return c.JSON(http.StatusGone, map[string]string{"error": "Share is no longer available"})
	}
	if expiresAt.Valid && time.Now().After(expiresAt.Time) {
		return c.JSON(http.StatusGone, map[string]string{"error": "Share has expired"})
	}
	if maxAccess.Valid && accessCount >= int(maxAccess.Int32) {
		return c.JSON(http.StatusGone, map[string]string{"error": "Access limit reached"})
	}

	// Check if login is required
	if requireLogin {
		claims, _ := c.Get("user").(*JWTClaims)
		if claims == nil {
			return RespondError(c, ErrUnauthorized("Login required"))
		}
	}

	// Check password if required
	if passwordHash.Valid {
		password := c.QueryParam("password")
		if password == "" {
			return RespondError(c, ErrUnauthorized("Password required"))
		}
		if err := bcrypt.CompareHashAndPassword([]byte(passwordHash.String), []byte(password)); err != nil {
			return RespondError(c, ErrUnauthorized("Invalid password"))
		}
	}

	fullPath := filepath.Join(h.dataRoot, path)
	info, err := os.Stat(fullPath)
	if err != nil {
		return RespondError(c, ErrNotFound("File not found"))
	}

	if info.IsDir() {
		return RespondError(c, ErrBadRequest("Cannot download a directory"))
	}

	// Log audit event for shared link download
	var userID *string
	var accessorUsername string
	if claims, ok := c.Get("user").(*JWTClaims); ok && claims != nil {
		userID = &claims.UserID
		accessorUsername = claims.Username
	}
	_ = h.auditHandler.LogEvent(userID, c.RealIP(), EventShareAccess, path, map[string]interface{}{
		"action":   "download",
		"token":    token,
		"filename": info.Name(),
		"size":     info.Size(),
	})

	// Send notification to the share owner
	if h.notificationService != nil {
		title := "공유 링크가 접속되었습니다"
		var message string
		if accessorUsername != "" {
			message = accessorUsername + "님이 '" + info.Name() + "' 파일을 다운로드했습니다"
		} else {
			message = "누군가가 '" + info.Name() + "' 파일을 다운로드했습니다 (IP: " + c.RealIP() + ")"
		}
		link := "/shared-by-me"
		_, _ = h.notificationService.Create(
			createdBy,
			NotifShareLinkAccessed,
			title,
			message,
			link,
			userID,
			map[string]interface{}{
				"token":    token,
				"filename": info.Name(),
				"size":     info.Size(),
				"clientIP": c.RealIP(),
			},
		)
	}

	setContentDisposition(c, info.Name())
	return c.File(fullPath)
}

// GetShareOnlyOfficeConfig returns OnlyOffice configuration for editable share links
func (h *ShareHandler) GetShareOnlyOfficeConfig(c echo.Context) error {
	shareToken := c.Param("token")

	var share Share
	var passwordHash sql.NullString
	var expiresAt sql.NullTime
	var maxAccess sql.NullInt32

	err := h.db.QueryRow(`
		SELECT id, token, path, created_by, created_at, expires_at,
		       password_hash, access_count, max_access, is_active, require_login,
		       share_type, COALESCE(editable, false) as editable
		FROM shares
		WHERE token = $1
	`, shareToken).Scan(&share.ID, &share.Token, &share.Path, &share.CreatedBy,
		&share.CreatedAt, &expiresAt, &passwordHash, &share.AccessCount,
		&maxAccess, &share.IsActive, &share.RequireLogin, &share.ShareType, &share.Editable)

	if err == sql.ErrNoRows {
		return RespondError(c, ErrNotFound("Share not found"))
	}
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}

	// Validate share status
	if !share.IsActive {
		return c.JSON(http.StatusGone, map[string]string{"error": "Share is no longer available"})
	}
	if expiresAt.Valid && time.Now().After(expiresAt.Time) {
		return c.JSON(http.StatusGone, map[string]string{"error": "Share has expired"})
	}
	if maxAccess.Valid && share.AccessCount >= int(maxAccess.Int32) {
		return c.JSON(http.StatusGone, map[string]string{"error": "Share access limit reached"})
	}

	// Must be an editable share
	if !share.Editable {
		return RespondError(c, ErrForbidden("This share link does not allow editing"))
	}

	// Check if login is required
	if share.RequireLogin {
		claims, _ := c.Get("user").(*JWTClaims)
		if claims == nil {
			return RespondError(c, ErrUnauthorized("Login required"))
		}
	}

	// Check password if required
	if passwordHash.Valid {
		password := c.QueryParam("password")
		if password == "" {
			return RespondError(c, ErrUnauthorized("Password required"))
		}
		if err := bcrypt.CompareHashAndPassword([]byte(passwordHash.String), []byte(password)); err != nil {
			return RespondError(c, ErrUnauthorized("Invalid password"))
		}
	}

	// Get file info
	fullPath := filepath.Join(h.dataRoot, share.Path)
	info, err := os.Stat(fullPath)
	if err != nil {
		return RespondError(c, ErrNotFound("File not found"))
	}

	if info.IsDir() {
		return RespondError(c, ErrBadRequest("Cannot edit directories"))
	}

	// Check if file type is supported by OnlyOffice
	ext := strings.ToLower(filepath.Ext(info.Name()))
	documentType := getShareOnlyOfficeDocumentType(ext)
	if documentType == "" {
		return RespondError(c, ErrBadRequest("Unsupported file type for OnlyOffice"))
	}

	// Generate unique key for this document (share token + path + modtime)
	documentKey := fmt.Sprintf("share_%s_%d", shareToken, info.ModTime().Unix())

	// Build URLs
	internalBaseURL := "http://api:8080"

	// Get owner info for display
	var ownerUsername string
	_ = h.db.QueryRow("SELECT username FROM users WHERE id = $1", share.CreatedBy).Scan(&ownerUsername)

	// Determine user info for OnlyOffice
	userId := "share_" + shareToken[:8]
	userName := "Guest"
	if claims, ok := c.Get("user").(*JWTClaims); ok && claims != nil {
		userId = claims.UserID
		userName = claims.Username
	}

	// Build file download URL with share token
	fileURL := fmt.Sprintf("%s/api/e/%s/file?password=%s", internalBaseURL, shareToken, c.QueryParam("password"))

	// Build callback URL with share token
	callbackURL := fmt.Sprintf("%s/api/e/%s/callback?password=%s", internalBaseURL, shareToken, c.QueryParam("password"))

	config := map[string]interface{}{
		"documentType": documentType,
		"document": map[string]interface{}{
			"fileType": strings.TrimPrefix(ext, "."),
			"key":      documentKey,
			"title":    info.Name(),
			"url":      fileURL,
		},
		"editorConfig": map[string]interface{}{
			"callbackUrl": callbackURL,
			"user": map[string]interface{}{
				"id":   userId,
				"name": userName,
			},
			"lang": "ko",
			"mode": "edit",
			"customization": map[string]interface{}{
				"autosave":  true,
				"forcesave": true,
			},
		},
	}

	return c.JSON(http.StatusOK, config)
}

// GetShareFile serves the file for OnlyOffice to download (for editable shares)
func (h *ShareHandler) GetShareFile(c echo.Context) error {
	shareToken := c.Param("token")

	var share Share
	var passwordHash sql.NullString
	var expiresAt sql.NullTime
	var maxAccess sql.NullInt32

	err := h.db.QueryRow(`
		SELECT id, token, path, is_active, expires_at, max_access, access_count,
		       password_hash, COALESCE(editable, false) as editable
		FROM shares WHERE token = $1
	`, shareToken).Scan(&share.ID, &share.Token, &share.Path, &share.IsActive,
		&expiresAt, &maxAccess, &share.AccessCount, &passwordHash, &share.Editable)

	if err == sql.ErrNoRows {
		return RespondError(c, ErrNotFound("Share not found"))
	}
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}

	// Validate
	if !share.IsActive {
		return c.JSON(http.StatusGone, map[string]string{"error": "Share is no longer available"})
	}
	if expiresAt.Valid && time.Now().After(expiresAt.Time) {
		return c.JSON(http.StatusGone, map[string]string{"error": "Share has expired"})
	}
	if maxAccess.Valid && share.AccessCount >= int(maxAccess.Int32) {
		return c.JSON(http.StatusGone, map[string]string{"error": "Access limit reached"})
	}
	if !share.Editable {
		return RespondError(c, ErrForbidden("This share link does not allow editing"))
	}

	// Check password
	if passwordHash.Valid {
		password := c.QueryParam("password")
		if password == "" {
			return RespondError(c, ErrUnauthorized("Password required"))
		}
		if err := bcrypt.CompareHashAndPassword([]byte(passwordHash.String), []byte(password)); err != nil {
			return RespondError(c, ErrUnauthorized("Invalid password"))
		}
	}

	fullPath := filepath.Join(h.dataRoot, share.Path)
	return c.File(fullPath)
}

// ShareOnlyOfficeCallback handles OnlyOffice save callbacks for editable shares
func (h *ShareHandler) ShareOnlyOfficeCallback(c echo.Context) error {
	shareToken := c.Param("token")

	var share Share
	var passwordHash sql.NullString
	var expiresAt sql.NullTime
	var maxAccess sql.NullInt32

	err := h.db.QueryRow(`
		SELECT id, token, path, created_by, is_active, expires_at, max_access, access_count,
		       password_hash, COALESCE(editable, false) as editable
		FROM shares WHERE token = $1
	`, shareToken).Scan(&share.ID, &share.Token, &share.Path, &share.CreatedBy, &share.IsActive,
		&expiresAt, &maxAccess, &share.AccessCount, &passwordHash, &share.Editable)

	if err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]int{"error": 1})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]int{"error": 1})
	}

	// Validate share
	if !share.IsActive || (expiresAt.Valid && time.Now().After(expiresAt.Time)) {
		return c.JSON(http.StatusGone, map[string]int{"error": 1})
	}
	if !share.Editable {
		return c.JSON(http.StatusForbidden, map[string]int{"error": 1})
	}

	// Check password
	if passwordHash.Valid {
		password := c.QueryParam("password")
		if password == "" || bcrypt.CompareHashAndPassword([]byte(passwordHash.String), []byte(password)) != nil {
			return c.JSON(http.StatusUnauthorized, map[string]int{"error": 1})
		}
	}

	// Parse OnlyOffice callback
	var req struct {
		Key    string `json:"key"`
		Status int    `json:"status"`
		URL    string `json:"url"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]int{"error": 1})
	}

	// Status 2 (ready for save) or 6 (force save)
	if req.Status == 2 || req.Status == 6 {
		if req.URL == "" {
			return c.JSON(http.StatusBadRequest, map[string]int{"error": 1})
		}

		// Convert external URL to internal Docker network URL
		downloadURL := convertShareURL(req.URL)

		// Download the document from OnlyOffice
		resp, err := http.Get(downloadURL)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]int{"error": 1})
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return c.JSON(http.StatusInternalServerError, map[string]int{"error": 1})
		}

		// Read document content
		content, err := io.ReadAll(resp.Body)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]int{"error": 1})
		}

		// Write to file
		fullPath := filepath.Join(h.dataRoot, share.Path)
		if err := writeShareFile(fullPath, content, 0644); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]int{"error": 1})
		}

		// Log audit event
		_ = h.auditHandler.LogEvent(&share.CreatedBy, c.RealIP(), EventFileEdit, share.Path, map[string]interface{}{
			"size":       len(content),
			"source":     "onlyoffice_share",
			"shareToken": shareToken,
		})

		// Send notification to owner about file modification
		if h.notificationService != nil {
			title := "공유 문서가 수정되었습니다"
			message := fmt.Sprintf("공유 링크를 통해 '%s' 파일이 수정되었습니다", filepath.Base(share.Path))
			_, _ = h.notificationService.Create(
				share.CreatedBy,
				NotifSharedFileModified,
				title,
				message,
				"/shared-by-me",
				nil,
				map[string]interface{}{
					"shareToken": shareToken,
					"filePath":   share.Path,
					"clientIP":   c.RealIP(),
				},
			)
		}
	}

	return c.JSON(http.StatusOK, map[string]int{"error": 0})
}

// Helper functions for share OnlyOffice
func getShareOnlyOfficeDocumentType(ext string) string {
	switch ext {
	case ".doc", ".docx", ".odt", ".rtf", ".txt":
		return "word"
	case ".xls", ".xlsx", ".ods", ".csv":
		return "cell"
	case ".ppt", ".pptx", ".odp":
		return "slide"
	case ".pdf":
		return "word"
	default:
		return ""
	}
}

func convertShareURL(externalURL string) string {
	// Similar to convertToInternalURL in onlyoffice.go
	internalURL := "http://onlyoffice"
	if url := os.Getenv("ONLYOFFICE_INTERNAL_URL"); url != "" {
		internalURL = strings.TrimSuffix(url, "/")
	}

	publicURL := os.Getenv("ONLYOFFICE_PUBLIC_URL")
	if publicURL != "" && strings.HasPrefix(externalURL, publicURL) {
		return strings.Replace(externalURL, publicURL, internalURL, 1)
	}

	return externalURL
}

func writeShareFile(path string, content []byte, perm os.FileMode) error {
	// Write to temp file first for atomic write
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, content, perm); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

// generateShareToken generates a unique share token using crypto-secure random
func generateShareToken() string {
	token, err := GenerateSecureToken(16)
	if err != nil {
		// Fallback should never happen in normal operation
		return MustGenerateSecureToken(16)
	}
	return token
}
