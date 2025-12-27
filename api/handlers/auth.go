package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	db           *sql.DB
	jwtSecret    []byte
	dataRoot     string
	configPath   string
	auditHandler *AuditHandler
}

// Package-level JWT secret for shared access
var sharedJWTSecret []byte

func NewAuthHandler(db *sql.DB) *AuthHandler {
	secret := os.Getenv("JWT_SECRET")
	env := os.Getenv("SCV_ENV")

	if secret == "" {
		if env == "production" {
			log.Fatal("FATAL: JWT_SECRET environment variable is required in production mode")
		}
		// Development fallback with warning
		log.Println("WARNING: JWT_SECRET not set. Using default secret. Set JWT_SECRET in production!")
		secret = "scv-dev-secret-not-for-production-use"
	} else if len(secret) < 32 {
		log.Println("WARNING: JWT_SECRET should be at least 32 characters for security")
	}

	sharedJWTSecret = []byte(secret) // Set the shared secret
	return &AuthHandler{
		db:           db,
		jwtSecret:    []byte(secret),
		dataRoot:     "/data",
		configPath:   "/etc/scv",
		auditHandler: NewAuditHandler(db),
	}
}

// GenerateJWT generates a JWT token for a user (exported for use by other handlers)
func GenerateJWT(userID, username string, isAdmin bool) (string, error) {
	claims := &JWTClaims{
		UserID:   userID,
		Username: username,
		IsAdmin:  isAdmin,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "simplecloudvault",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(sharedJWTSecret)
}

// ValidateJWTToken validates a JWT token string (exported for use by other handlers)
func ValidateJWTToken(tokenString string) (*jwt.Token, error) {
	return jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		return sharedJWTSecret, nil
	})
}

// ensureUserHomeDir creates the home directory for a user
func (h *AuthHandler) ensureUserHomeDir(username string) error {
	userDir := h.dataRoot + "/users/" + username
	return os.MkdirAll(userDir, 0755)
}

// calculateStorageUsed calculates the total storage used by a user
// Uses cache for performance optimization
func (h *AuthHandler) calculateStorageUsed(username string) int64 {
	cache := GetStorageCache()

	// Try to get from cache first
	if data, ok := cache.GetUserUsage(username); ok {
		return data.HomeUsed
	}

	// Calculate fresh value
	userDir := h.dataRoot + "/users/" + username
	var totalSize int64

	filepath.Walk(userDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		// Skip .trash directory
		if info.IsDir() && info.Name() == ".trash" {
			return filepath.SkipDir
		}
		if !info.IsDir() {
			totalSize += info.Size()
		}
		return nil
	})

	// Cache the result
	cache.SetUserUsage(username, &StorageUsageData{
		HomeUsed:  totalSize,
		TotalUsed: totalSize,
	})

	return totalSize
}

// invalidateStorageCache invalidates the storage cache for a user
func (h *AuthHandler) invalidateStorageCache(username string) {
	cache := GetStorageCache()
	cache.InvalidateUserUsage(username)
}

// GetUserQuotaInfo returns quota info for a user by username
func (h *AuthHandler) GetUserQuotaInfo(username string) (quota int64, used int64, err error) {
	err = h.db.QueryRow("SELECT COALESCE(storage_quota, 0) FROM users WHERE username = $1", username).Scan(&quota)
	if err != nil {
		return 0, 0, err
	}
	used = h.calculateStorageUsed(username)
	return quota, used, nil
}

// CheckQuota checks if a user can upload a file of given size
// Returns true if upload is allowed, false if quota would be exceeded
func (h *AuthHandler) CheckQuota(username string, fileSize int64) (bool, int64, int64) {
	quota, used, err := h.GetUserQuotaInfo(username)
	if err != nil {
		// If we can't get quota info, allow the upload
		return true, 0, 0
	}
	// quota = 0 means unlimited
	if quota == 0 {
		return true, quota, used
	}
	return (used + fileSize) <= quota, quota, used
}

// GetMyStorageUsage returns the current user's storage usage
func (h *AuthHandler) GetMyStorageUsage(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)
	quota, used, err := h.GetUserQuotaInfo(claims.Username)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to get storage info",
		})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"quota": quota,
		"used":  used,
	})
}

// User represents a user account
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email,omitempty"`
	Provider     string    `json:"provider"`
	IsAdmin      bool      `json:"isAdmin"`
	IsActive     bool      `json:"isActive"`
	HasSMB       bool      `json:"hasSmb"`
	Has2FA       bool      `json:"has2fa"`
	StorageQuota int64     `json:"storageQuota"` // 0 = unlimited
	StorageUsed  int64     `json:"storageUsed"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// JWTClaims represents JWT claims
type JWTClaims struct {
	UserID   string `json:"userId"`
	Username string `json:"username"`
	IsAdmin  bool   `json:"isAdmin"`
	jwt.RegisteredClaims
}

// LoginRequest represents login request
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// RegisterRequest represents registration request
type RegisterRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

// LoginResponse represents login response
type LoginResponse struct {
	Token       string `json:"token,omitempty"`
	User        User   `json:"user,omitempty"`
	Requires2FA bool   `json:"requires2fa,omitempty"`
	UserID      string `json:"userId,omitempty"` // Only sent when 2FA is required
}

// Register creates a new user account
func (h *AuthHandler) Register(c echo.Context) error {
	var req RegisterRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	// Validate input
	if len(req.Username) < 3 || len(req.Username) > 50 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Username must be between 3 and 50 characters",
		})
	}

	if len(req.Password) < 8 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Password must be at least 8 characters",
		})
	}

	// Check if username already exists
	var exists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)", req.Username).Scan(&exists)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Database error",
		})
	}
	if exists {
		return c.JSON(http.StatusConflict, map[string]string{
			"error": "Username already exists",
		})
	}

	// Hash password
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to hash password",
		})
	}

	// Create user
	var userID string
	err = h.db.QueryRow(`
		INSERT INTO users (username, email, password_hash, is_active)
		VALUES ($1, $2, $3, true)
		RETURNING id
	`, req.Username, req.Email, string(passwordHash)).Scan(&userID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create user",
		})
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"success": true,
		"id":      userID,
		"message": "User registered successfully",
	})
}

// Login authenticates a user and returns a JWT token
func (h *AuthHandler) Login(c echo.Context) error {
	var req LoginRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if req.Username == "" || req.Password == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Username and password are required",
		})
	}

	// Get user from database
	var user User
	var passwordHash string
	var email sql.NullString
	var smbHash sql.NullString
	var provider sql.NullString
	var totpEnabled sql.NullBool

	err := h.db.QueryRow(`
		SELECT id, username, email, password_hash, smb_hash, provider, is_admin, is_active,
		       COALESCE(totp_enabled, false), created_at, updated_at
		FROM users WHERE username = $1
	`, req.Username).Scan(&user.ID, &user.Username, &email, &passwordHash, &smbHash, &provider,
		&user.IsAdmin, &user.IsActive, &totpEnabled, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Invalid username or password",
		})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Database error",
		})
	}

	// Check if user is active
	if !user.IsActive {
		return c.JSON(http.StatusForbidden, map[string]string{
			"error": "Account is disabled",
		})
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Invalid username or password",
		})
	}

	// Set optional fields
	if email.Valid {
		user.Email = email.String
	}
	if provider.Valid {
		user.Provider = provider.String
	} else {
		user.Provider = "local"
	}
	user.HasSMB = smbHash.Valid && smbHash.String != ""
	user.Has2FA = totpEnabled.Valid && totpEnabled.Bool

	// Check if 2FA is enabled
	if user.Has2FA {
		// Return requires_2fa response - user needs to verify OTP
		return c.JSON(http.StatusOK, LoginResponse{
			Requires2FA: true,
			UserID:      user.ID,
		})
	}

	// Generate JWT token
	token, err := h.generateToken(user.ID, user.Username, user.IsAdmin)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to generate token",
		})
	}

	// Log login event
	h.auditHandler.LogEvent(&user.ID, c.RealIP(), EventUserLogin, user.Username, map[string]interface{}{
		"username": user.Username,
		"isAdmin":  user.IsAdmin,
	})

	return c.JSON(http.StatusOK, LoginResponse{
		Token: token,
		User:  user,
	})
}

// GetProfile returns the current user's profile
func (h *AuthHandler) GetProfile(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	var user User
	var email sql.NullString
	var smbHash sql.NullString
	var provider sql.NullString
	var totpEnabled sql.NullBool

	err := h.db.QueryRow(`
		SELECT id, username, email, smb_hash, provider, is_admin, is_active,
		       COALESCE(totp_enabled, false), created_at, updated_at
		FROM users WHERE id = $1
	`, claims.UserID).Scan(&user.ID, &user.Username, &email, &smbHash, &provider,
		&user.IsAdmin, &user.IsActive, &totpEnabled, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "User not found",
		})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Database error",
		})
	}

	if email.Valid {
		user.Email = email.String
	}
	if provider.Valid {
		user.Provider = provider.String
	} else {
		user.Provider = "local"
	}
	user.HasSMB = smbHash.Valid && smbHash.String != ""
	user.Has2FA = totpEnabled.Valid && totpEnabled.Bool

	return c.JSON(http.StatusOK, map[string]interface{}{
		"user": user,
	})
}

// UpdateProfileRequest represents profile update request
type UpdateProfileRequest struct {
	Email       string `json:"email"`
	NewPassword string `json:"newPassword"`
	OldPassword string `json:"oldPassword"`
}

// UpdateProfile updates the current user's profile
func (h *AuthHandler) UpdateProfile(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	var req UpdateProfileRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	// Build update query dynamically
	updates := []string{}
	args := []interface{}{}
	argCount := 1

	if req.Email != "" {
		updates = append(updates, fmt.Sprintf("email = $%d", argCount))
		args = append(args, req.Email)
		argCount++
	}

	if req.NewPassword != "" {
		if len(req.NewPassword) < 8 {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Password must be at least 8 characters",
			})
		}

		// Verify old password
		var currentHash string
		err := h.db.QueryRow("SELECT password_hash FROM users WHERE id = $1", claims.UserID).Scan(&currentHash)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Database error",
			})
		}

		if err := bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(req.OldPassword)); err != nil {
			return c.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Current password is incorrect",
			})
		}

		// Hash new password
		newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to hash password",
			})
		}

		updates = append(updates, fmt.Sprintf("password_hash = $%d", argCount))
		args = append(args, string(newHash))
		argCount++
	}

	if len(updates) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "No updates provided",
		})
	}

	updates = append(updates, "updated_at = NOW()")
	args = append(args, claims.UserID)

	query := "UPDATE users SET " + strings.Join(updates, ", ") + fmt.Sprintf(" WHERE id = $%d", argCount)

	_, err := h.db.Exec(query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to update profile",
		})
	}

	// Fetch updated user
	var user User
	var emailVal sql.NullString
	var smbHash sql.NullString
	var providerVal sql.NullString

	h.db.QueryRow(`
		SELECT id, username, email, smb_hash, provider, is_admin, is_active, created_at, updated_at
		FROM users WHERE id = $1
	`, claims.UserID).Scan(&user.ID, &user.Username, &emailVal, &smbHash, &providerVal, &user.IsAdmin, &user.IsActive, &user.CreatedAt, &user.UpdatedAt)

	if emailVal.Valid {
		user.Email = emailVal.String
	}
	if providerVal.Valid {
		user.Provider = providerVal.String
	} else {
		user.Provider = "local"
	}
	user.HasSMB = smbHash.Valid && smbHash.String != ""

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Profile updated successfully",
		"user":    user,
	})
}

// SetSMBPasswordRequest represents SMB password setting request
type SetSMBPasswordRequest struct {
	Password string `json:"password"`
}

// SetMySMBPassword sets the current user's SMB password
func (h *AuthHandler) SetMySMBPassword(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	var req SetSMBPasswordRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if len(req.Password) < 8 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Password must be at least 8 characters",
		})
	}

	// Generate SMB marker
	smbHash := generateSMBMarker()

	_, err := h.db.Exec(`
		UPDATE users SET smb_hash = $1, updated_at = NOW() WHERE id = $2
	`, smbHash, claims.UserID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to set SMB password",
		})
	}

	// Update SMB sync file with password
	var warnings []string
	if err := h.updateSMBUserPassword(claims.Username, req.Password); err != nil {
		log.Printf("WARNING: Failed to update SMB sync file for user %s: %v", claims.Username, err)
		warnings = append(warnings, "SMB sync file update failed - password may need manual sync")
	}

	response := map[string]interface{}{
		"success": true,
		"message": "SMB password set successfully.",
	}
	if len(warnings) > 0 {
		response["warnings"] = warnings
	}
	return c.JSON(http.StatusOK, response)
}

// updateSMBUserPassword adds or updates a user's password in the sync file
func (h *AuthHandler) updateSMBUserPassword(username, password string) error {
	usersFile := h.configPath + "/smb_users.txt"

	// Read existing entries
	existingUsers := make(map[string]string)
	if content, err := os.ReadFile(usersFile); err == nil {
		lines := strings.Split(string(content), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				existingUsers[parts[0]] = parts[1]
			}
		}
	}

	// Update or add user
	existingUsers[username] = password

	// Write back all users
	var lines []string
	for user, pass := range existingUsers {
		lines = append(lines, user+":"+pass)
	}

	return os.WriteFile(usersFile, []byte(strings.Join(lines, "\n")+"\n"), 0600)
}

// generateToken generates a JWT token for a user
// This is a wrapper around GenerateJWT for backward compatibility
func (h *AuthHandler) generateToken(userID, username string, isAdmin bool) (string, error) {
	return GenerateJWT(userID, username, isAdmin)
}

// JWTMiddleware validates JWT tokens
func (h *AuthHandler) JWTMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		var tokenString string

		// First check Authorization header
		authHeader := c.Request().Header.Get("Authorization")
		if authHeader != "" {
			// Extract token from "Bearer <token>"
			parts := strings.Split(authHeader, " ")
			if len(parts) == 2 && parts[0] == "Bearer" {
				tokenString = parts[1]
			}
		}

		// Fallback to query parameter for streaming support (video/audio)
		if tokenString == "" {
			tokenString = c.QueryParam("token")
		}

		if tokenString == "" {
			return c.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Authorization required",
			})
		}

		// Parse and validate token
		token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
			return h.jwtSecret, nil
		})

		if err != nil || !token.Valid {
			return c.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Invalid or expired token",
			})
		}

		claims, ok := token.Claims.(*JWTClaims)
		if !ok {
			return c.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Invalid token claims",
			})
		}

		// Set user in context
		c.Set("user", claims)

		return next(c)
	}
}

// OptionalJWTMiddleware validates JWT tokens if present, but doesn't require them
func (h *AuthHandler) OptionalJWTMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		var tokenString string

		// First check Authorization header
		authHeader := c.Request().Header.Get("Authorization")
		if authHeader != "" {
			parts := strings.Split(authHeader, " ")
			if len(parts) == 2 && parts[0] == "Bearer" {
				tokenString = parts[1]
			}
		}

		// Fallback to query parameter for streaming support (video/audio)
		if tokenString == "" {
			tokenString = c.QueryParam("token")
		}

		// If no token found, continue without authentication
		if tokenString == "" {
			return next(c)
		}

		token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
			return h.jwtSecret, nil
		})

		if err == nil && token.Valid {
			if claims, ok := token.Claims.(*JWTClaims); ok {
				c.Set("user", claims)
			}
		}

		return next(c)
	}
}

// AdminMiddleware ensures the user is an admin
func (h *AuthHandler) AdminMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		claims := c.Get("user").(*JWTClaims)
		if !claims.IsAdmin {
			return c.JSON(http.StatusForbidden, map[string]string{
				"error": "Admin access required",
			})
		}
		return next(c)
	}
}

// CreateUserRequest represents admin user creation request
type CreateUserRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
	IsAdmin  bool   `json:"isAdmin"`
}

// ListUsers returns all users (admin only)
func (h *AuthHandler) ListUsers(c echo.Context) error {
	rows, err := h.db.Query(`
		SELECT id, username, email, provider, is_admin, is_active, smb_hash,
		       COALESCE(totp_enabled, false), storage_quota, created_at, updated_at
		FROM users
		ORDER BY created_at DESC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Database error",
		})
	}
	defer rows.Close()

	users := []User{}
	for rows.Next() {
		var user User
		var email sql.NullString
		var provider sql.NullString
		var smbHash sql.NullString
		var totpEnabled bool
		var storageQuota sql.NullInt64

		err := rows.Scan(&user.ID, &user.Username, &email, &provider, &user.IsAdmin,
			&user.IsActive, &smbHash, &totpEnabled, &storageQuota, &user.CreatedAt, &user.UpdatedAt)
		if err != nil {
			continue
		}

		if email.Valid {
			user.Email = email.String
		}
		if provider.Valid {
			user.Provider = provider.String
		} else {
			user.Provider = "local"
		}
		user.HasSMB = smbHash.Valid && smbHash.String != ""
		user.Has2FA = totpEnabled
		if storageQuota.Valid {
			user.StorageQuota = storageQuota.Int64
		}
		// Calculate storage used
		user.StorageUsed = h.calculateStorageUsed(user.Username)

		users = append(users, user)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"users": users,
		"total": len(users),
	})
}

// CreateUser creates a new user (admin only)
func (h *AuthHandler) CreateUser(c echo.Context) error {
	var req CreateUserRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	// Validate input
	if len(req.Username) < 3 || len(req.Username) > 50 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Username must be between 3 and 50 characters",
		})
	}

	if len(req.Password) < 8 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Password must be at least 8 characters",
		})
	}

	// Check if username already exists
	var exists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)", req.Username).Scan(&exists)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Database error",
		})
	}
	if exists {
		return c.JSON(http.StatusConflict, map[string]string{
			"error": "Username already exists",
		})
	}

	// Hash password
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to hash password",
		})
	}

	// Create user
	var userID string
	err = h.db.QueryRow(`
		INSERT INTO users (username, email, password_hash, is_admin, is_active)
		VALUES ($1, $2, $3, $4, true)
		RETURNING id
	`, req.Username, req.Email, string(passwordHash), req.IsAdmin).Scan(&userID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create user",
		})
	}

	// Create user's home directory
	var warnings []string
	if err := h.ensureUserHomeDir(req.Username); err != nil {
		log.Printf("WARNING: Failed to create home directory for user %s: %v", req.Username, err)
		warnings = append(warnings, "Home directory creation failed - will be created on first access")
	}

	response := map[string]interface{}{
		"success": true,
		"id":      userID,
		"message": "User created successfully",
	}
	if len(warnings) > 0 {
		response["warnings"] = warnings
	}
	return c.JSON(http.StatusCreated, response)
}

// UpdateUserRequest represents admin user update request
type UpdateUserRequest struct {
	Email        string `json:"email"`
	Password     string `json:"password"`
	IsAdmin      bool   `json:"isAdmin"`
	IsActive     bool   `json:"isActive"`
	StorageQuota *int64 `json:"storageQuota,omitempty"` // nil = don't change, 0 = unlimited
}

// UpdateUser updates a user (admin only)
func (h *AuthHandler) UpdateUser(c echo.Context) error {
	userID := c.Param("id")

	var req UpdateUserRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	// Build update query
	updates := []string{"is_admin = $1", "is_active = $2", "updated_at = NOW()"}
	args := []interface{}{req.IsAdmin, req.IsActive}
	argCount := 3

	if req.Email != "" {
		updates = append(updates, fmt.Sprintf("email = $%d", argCount))
		args = append(args, req.Email)
		argCount++
	}

	if req.Password != "" {
		if len(req.Password) < 8 {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Password must be at least 8 characters",
			})
		}
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to hash password",
			})
		}
		updates = append(updates, fmt.Sprintf("password_hash = $%d", argCount))
		args = append(args, string(passwordHash))
		argCount++
	}

	if req.StorageQuota != nil {
		updates = append(updates, fmt.Sprintf("storage_quota = $%d", argCount))
		args = append(args, *req.StorageQuota)
		argCount++
	}

	args = append(args, userID)
	query := "UPDATE users SET " + strings.Join(updates, ", ") + fmt.Sprintf(" WHERE id = $%d", argCount)

	result, err := h.db.Exec(query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to update user",
		})
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "User not found",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "User updated successfully",
	})
}

// DeleteUser deletes a user (admin only)
func (h *AuthHandler) DeleteUser(c echo.Context) error {
	userID := c.Param("id")
	claims := c.Get("user").(*JWTClaims)

	// Prevent self-deletion
	if userID == claims.UserID {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot delete your own account",
		})
	}

	result, err := h.db.Exec("DELETE FROM users WHERE id = $1", userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to delete user",
		})
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "User not found",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "User deleted successfully",
	})
}

