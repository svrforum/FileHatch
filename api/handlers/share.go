package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
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
	db       *sql.DB
	dataRoot string
}

func NewShareHandler(db *sql.DB, dataRoot string) *ShareHandler {
	return &ShareHandler{
		db:       db,
		dataRoot: dataRoot,
	}
}

// Share represents a shared link
type Share struct {
	ID          string     `json:"id"`
	Token       string     `json:"token"`
	Path        string     `json:"path"`
	CreatedBy   string     `json:"createdBy"`
	CreatedAt   time.Time  `json:"createdAt"`
	ExpiresAt   *time.Time `json:"expiresAt,omitempty"`
	HasPassword bool       `json:"hasPassword"`
	AccessCount int        `json:"accessCount"`
	MaxAccess   *int       `json:"maxAccess,omitempty"`
	IsActive    bool       `json:"isActive"`
}

// CreateShareRequest represents share creation request
type CreateShareRequest struct {
	Path      string `json:"path"`
	Password  string `json:"password,omitempty"`
	ExpiresIn int    `json:"expiresIn,omitempty"` // hours, 0 = never
	MaxAccess int    `json:"maxAccess,omitempty"` // 0 = unlimited
}

// AccessShareRequest represents share access request
type AccessShareRequest struct {
	Password string `json:"password,omitempty"`
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

	// Validate path exists
	cleanPath := filepath.Clean(req.Path)
	if strings.Contains(cleanPath, "..") {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid path",
		})
	}

	fullPath := filepath.Join(h.dataRoot, cleanPath)
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Path not found",
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

	// Insert share
	var shareID string
	err := h.db.QueryRow(`
		INSERT INTO shares (token, path, created_by, password_hash, expires_at, max_access)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, token, cleanPath, claims.UserID, passwordHash, expiresAt, maxAccess).Scan(&shareID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create share",
		})
	}

	shareURL := fmt.Sprintf("/s/%s", token)

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"success":  true,
		"id":       shareID,
		"token":    token,
		"url":      shareURL,
		"path":     cleanPath,
		"expiresAt": expiresAt,
	})
}

// ListShares returns shares created by the current user
func (h *ShareHandler) ListShares(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	rows, err := h.db.Query(`
		SELECT id, token, path, created_at, expires_at,
		       CASE WHEN password_hash IS NOT NULL THEN true ELSE false END as has_password,
		       access_count, max_access, is_active
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

		err := rows.Scan(&share.ID, &share.Token, &share.Path, &share.CreatedAt,
			&expiresAt, &share.HasPassword, &share.AccessCount, &maxAccess, &share.IsActive)
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
		       password_hash, access_count, max_access, is_active
		FROM shares
		WHERE token = $1
	`, token).Scan(&share.ID, &share.Token, &share.Path, &share.CreatedBy,
		&share.CreatedAt, &expiresAt, &passwordHash, &share.AccessCount,
		&maxAccess, &share.IsActive)

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

	err := h.db.QueryRow(`
		SELECT path, password_hash, expires_at, access_count, max_access, is_active
		FROM shares WHERE token = $1
	`, token).Scan(&path, &passwordHash, &expiresAt, &accessCount, &maxAccess, &isActive)

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

	c.Response().Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, info.Name()))
	return c.File(fullPath)
}

// generateShareToken generates a unique share token
func generateShareToken() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}
