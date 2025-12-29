package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

type ShareHandler struct {
	db           *sql.DB
	dataRoot     string
	auditHandler *AuditHandler
}

func NewShareHandler(db *sql.DB, dataRoot string, auditHandler *AuditHandler) *ShareHandler {
	return &ShareHandler{
		db:           db,
		dataRoot:     dataRoot,
		auditHandler: auditHandler,
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
	ShareType         string `json:"shareType"`                   // "download" or "upload"
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
	// Upload share specific fields
	ShareType         string `json:"shareType,omitempty"`         // "download" (default) or "upload"
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
func (h *ShareHandler) CreateShare(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	var req CreateShareRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if req.Path == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Path is required",
		})
	}

	// Default share type is download
	shareType := req.ShareType
	if shareType == "" {
		shareType = "download"
	}
	if shareType != "download" && shareType != "upload" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid share type. Must be 'download' or 'upload'",
		})
	}

	// Resolve virtual path to real filesystem path
	fullPath, storedPath, err := h.resolvePath(req.Path, claims.Username)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	fileInfo, err := os.Stat(fullPath)
	if os.IsNotExist(err) {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Path not found",
		})
	}

	// Upload shares can only be created for folders
	if shareType == "upload" && !fileInfo.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Upload shares can only be created for folders",
		})
	}

	// Generate token
	token := generateShareToken()

	// Hash password if provided
	var passwordHash *string
	if req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to hash password",
			})
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

	// Insert new share with upload-specific fields
	var shareID string
	err = h.db.QueryRow(`
		INSERT INTO shares (token, path, created_by, password_hash, expires_at, max_access, require_login,
		                    share_type, max_file_size, allowed_extensions, max_total_size)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id
	`, token, storedPath, claims.UserID, passwordHash, expiresAt, maxAccess, req.RequireLogin,
		shareType, req.MaxFileSize, req.AllowedExtensions, req.MaxTotalSize).Scan(&shareID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create share",
		})
	}

	// Use different URL prefix for upload shares
	var shareURL string
	if shareType == "upload" {
		shareURL = fmt.Sprintf("/u/%s", token)
	} else {
		shareURL = fmt.Sprintf("/s/%s", token)
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"success":      true,
		"id":           shareID,
		"token":        token,
		"url":          shareURL,
		"path":         storedPath,
		"expiresAt":    expiresAt,
		"requireLogin": req.RequireLogin,
		"shareType":    shareType,
	})
}

// ListShares returns shares created by the current user
func (h *ShareHandler) ListShares(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	rows, err := h.db.Query(`
		SELECT id, token, path, created_at, expires_at,
		       CASE WHEN password_hash IS NOT NULL THEN true ELSE false END as has_password,
		       access_count, max_access, is_active, require_login,
		       share_type, max_file_size, allowed_extensions, upload_count, max_total_size, total_uploaded_size
		FROM shares
		WHERE created_by = $1
		ORDER BY created_at DESC
	`, claims.UserID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to list shares",
		})
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
			&share.ShareType, &share.MaxFileSize, &allowedExtensions, &share.UploadCount, &share.MaxTotalSize, &share.TotalUploadedSize)
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

	return c.JSON(http.StatusOK, map[string]interface{}{
		"shares": shares,
		"total":  len(shares),
	})
}

// DeleteShare deletes a share
func (h *ShareHandler) DeleteShare(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)
	shareID := c.Param("id")

	result, err := h.db.Exec(`
		DELETE FROM shares WHERE id = $1 AND created_by = $2
	`, shareID, claims.UserID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to delete share",
		})
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Share not found",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
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
		       password_hash, access_count, max_access, is_active, require_login
		FROM shares
		WHERE token = $1
	`, token).Scan(&share.ID, &share.Token, &share.Path, &share.CreatedBy,
		&share.CreatedAt, &expiresAt, &passwordHash, &share.AccessCount,
		&maxAccess, &share.IsActive, &share.RequireLogin)

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

	// Check if active
	if !share.IsActive {
		return c.JSON(http.StatusGone, map[string]string{
			"error": "Share is no longer available",
		})
	}

	// Check expiry
	if expiresAt.Valid && time.Now().After(expiresAt.Time) {
		return c.JSON(http.StatusGone, map[string]string{
			"error": "Share has expired",
		})
	}

	// Check max access
	if maxAccess.Valid && share.AccessCount >= int(maxAccess.Int32) {
		return c.JSON(http.StatusGone, map[string]string{
			"error": "Share access limit reached",
		})
	}

	// Check if login is required
	if share.RequireLogin {
		// Try to get user claims from context (may be nil if not authenticated)
		claims, _ := c.Get("user").(*JWTClaims)
		if claims == nil {
			return c.JSON(http.StatusOK, map[string]interface{}{
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
			return c.JSON(http.StatusOK, map[string]interface{}{
				"requiresPassword": true,
				"path":             share.Path,
			})
		}

		// Verify password
		if err := bcrypt.CompareHashAndPassword([]byte(passwordHash.String), []byte(req.Password)); err != nil {
			return c.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Invalid password",
			})
		}
	}

	// Increment access count
	h.db.Exec("UPDATE shares SET access_count = access_count + 1 WHERE id = $1", share.ID)

	// Get file info
	fullPath := filepath.Join(h.dataRoot, share.Path)
	info, err := os.Stat(fullPath)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "File not found",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"token":    share.Token,
		"path":     share.Path,
		"name":     filepath.Base(share.Path),
		"isDir":    info.IsDir(),
		"size":     info.Size(),
		"expiresAt": share.ExpiresAt,
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

	err := h.db.QueryRow(`
		SELECT path, password_hash, expires_at, access_count, max_access, is_active, require_login
		FROM shares WHERE token = $1
	`, token).Scan(&path, &passwordHash, &expiresAt, &accessCount, &maxAccess, &isActive, &requireLogin)

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
			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Login required"})
		}
	}

	// Check password if required
	if passwordHash.Valid {
		password := c.QueryParam("password")
		if password == "" {
			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Password required"})
		}
		if err := bcrypt.CompareHashAndPassword([]byte(passwordHash.String), []byte(password)); err != nil {
			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid password"})
		}
	}

	fullPath := filepath.Join(h.dataRoot, path)
	info, err := os.Stat(fullPath)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "File not found"})
	}

	if info.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Cannot download a directory"})
	}

	// Log audit event for shared link download
	var userID *string
	if claims, ok := c.Get("user").(*JWTClaims); ok && claims != nil {
		userID = &claims.UserID
	}
	h.auditHandler.LogEvent(userID, c.RealIP(), EventShareAccess, path, map[string]interface{}{
		"action":   "download",
		"token":    token,
		"filename": info.Name(),
		"size":     info.Size(),
	})

	c.Response().Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, info.Name()))
	return c.File(fullPath)
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
