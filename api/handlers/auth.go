package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
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
		auditHandler: NewAuditHandler(db, "/data"),
	}
}

// GenerateJWT generates a JWT token for a user (exported for use by other handlers)
func GenerateJWT(userID, username string, isAdmin bool) (string, error) {
	return GenerateJWTWithExpiration(userID, username, isAdmin, false, 24*time.Hour)
}


// GenerateJWTWithExpiration generates a JWT token with custom expiration duration
func GenerateJWTWithExpiration(userID, username string, isAdmin, rememberMe bool, expiration time.Duration) (string, error) {
	claims := &JWTClaims{
		UserID:     userID,
		Username:   username,
		IsAdmin:    isAdmin,
		RememberMe: rememberMe,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiration)),
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
	UserID     string `json:"userId"`
	Username   string `json:"username"`
	IsAdmin    bool   `json:"isAdmin"`
	RememberMe bool   `json:"rememberMe,omitempty"`
	jwt.RegisteredClaims
}

// LoginRequest represents login request
type LoginRequest struct {
	Username   string `json:"username"`
	Password   string `json:"password"`
	RememberMe bool   `json:"rememberMe"`
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
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	// Validate input
	if len(req.Username) < 3 || len(req.Username) > 50 {
		return RespondError(c, ErrBadRequest("Username must be between 3 and 50 characters"))
	}

	// Validate password complexity
	if err := ValidatePassword(req.Password); err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	// Validate email format
	if err := ValidateEmail(req.Email); err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	// Check if username already exists
	var exists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)", req.Username).Scan(&exists)
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}
	if exists {
		return RespondError(c, ErrAlreadyExists("Username"))
	}

	// Hash password
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to hash password"))
	}

	// Create user
	var userID string
	err = h.db.QueryRow(`
		INSERT INTO users (username, email, password_hash, is_active)
		VALUES ($1, $2, $3, true)
		RETURNING id
	`, req.Username, req.Email, string(passwordHash)).Scan(&userID)

	if err != nil {
		return RespondError(c, ErrInternal("Failed to create user"))
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"success": true,
		"id":      userID,
		"message": "User registered successfully",
	})
}

// Login authenticates a user and returns a JWT token
// Login godoc
// @Summary User login
// @Description Authenticate user with username and password. If 2FA is enabled, returns requires2fa=true.
// @Tags Auth
// @Accept json
// @Produce json
// @Param request body LoginRequest true "Login credentials"
// @Success 200 {object} LoginResponse "Successful login or 2FA required"
// @Failure 400 {object} map[string]string "Invalid request"
// @Failure 401 {object} map[string]string "Invalid credentials"
// @Failure 403 {object} map[string]string "Account disabled"
// @Router /auth/login [post]

func (h *AuthHandler) Login(c echo.Context) error {
	var req LoginRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	if req.Username == "" || req.Password == "" {
		return RespondError(c, ErrBadRequest("Username and password are required"))
	}

	ctx := c.Request().Context()
	ip := c.RealIP()

	// Check brute force protection
	guard := GetBruteForceGuard()
	if guard != nil {
		allowed, reason, remaining := guard.CheckAndRecordAttempt(ctx, ip, req.Username)
		if !allowed {
			// Log blocked attempt
			h.auditHandler.LogEvent(nil, ip, EventLoginBlocked, req.Username, map[string]interface{}{
				"username": req.Username,
				"reason":   reason,
			})
			return c.JSON(http.StatusTooManyRequests, map[string]interface{}{
				"error":      reason,
				"retryAfter": guard.config.LockDuration.Seconds(),
			})
		}
		// Set remaining attempts header
		c.Response().Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", remaining))
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
		// Record failed attempt for non-existent user (still track by IP)
		if guard != nil {
			guard.RecordFailedAttempt(ctx, ip, "")
		}
		h.auditHandler.LogEvent(nil, ip, EventLoginFailed, req.Username, map[string]interface{}{
			"username": req.Username,
			"reason":   "user_not_found",
		})
		return RespondError(c, ErrUnauthorized("Invalid username or password"))
	}
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}

	// Check if user is active
	if !user.IsActive {
		return RespondError(c, ErrForbidden("Account is disabled"))
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		// Record failed attempt for existing user
		if guard != nil {
			guard.RecordFailedAttempt(ctx, ip, req.Username)
		}
		h.auditHandler.LogEvent(&user.ID, ip, EventLoginFailed, req.Username, map[string]interface{}{
			"username": req.Username,
			"reason":   "invalid_password",
		})
		return RespondError(c, ErrUnauthorized("Invalid username or password"))
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

	// Determine token expiration based on rememberMe
	// Default: 1 day, RememberMe: 30 days
	expiration := 24 * time.Hour
	if req.RememberMe {
		expiration = 30 * 24 * time.Hour
	}

	// Generate JWT token with appropriate expiration
	token, err := h.generateTokenWithExpiration(user.ID, user.Username, user.IsAdmin, req.RememberMe, expiration)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to generate token"))
	}

	// Reset brute force counters on successful login
	if guard != nil {
		guard.RecordSuccessfulLogin(ctx, ip, user.Username)
	}

	// Log login event
	h.auditHandler.LogEvent(&user.ID, ip, EventUserLogin, user.Username, map[string]interface{}{
		"username":   user.Username,
		"isAdmin":    user.IsAdmin,
		"rememberMe": req.RememberMe,
	})

	return c.JSON(http.StatusOK, LoginResponse{
		Token: token,
		User:  user,
	})
}

// RefreshToken refreshes the JWT token if it's still valid
// The new token preserves the original session type (remember me or not)
func (h *AuthHandler) RefreshToken(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized("Invalid token"))
	}

	// Check if the user is still active
	var isActive bool
	err := h.db.QueryRow("SELECT is_active FROM users WHERE id = $1", claims.UserID).Scan(&isActive)
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}
	if !isActive {
		return RespondError(c, ErrForbidden("Account is disabled"))
	}

	// Determine expiration based on rememberMe flag stored in claims
	// Default: 1 day, RememberMe: 30 days
	expiration := 24 * time.Hour
	if claims.RememberMe {
		expiration = 30 * 24 * time.Hour
	}

	// Generate new token with same session type
	token, err := h.generateTokenWithExpiration(claims.UserID, claims.Username, claims.IsAdmin, claims.RememberMe, expiration)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to generate token"))
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"token": token,
	})
}

// GetProfile returns the current user's profile
// GetProfile godoc
// @Summary Get current user profile
// @Description Returns the authenticated user's profile information including storage usage
// @Tags Auth
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} map[string]interface{} "User profile"
// @Failure 401 {object} map[string]string "Unauthorized"
// @Router /auth/profile [get]

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
		return RespondError(c, ErrNotFound("User"))
	}
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
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
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	// Build update query dynamically
	updates := []string{}
	args := []interface{}{}
	argCount := 1

	if req.Email != "" {
		// Validate email format
		if err := ValidateEmail(req.Email); err != nil {
			return RespondError(c, ErrBadRequest(err.Error()))
		}
		updates = append(updates, fmt.Sprintf("email = $%d", argCount))
		args = append(args, req.Email)
		argCount++
	}

	if req.NewPassword != "" {
		// Validate password complexity
		if err := ValidatePassword(req.NewPassword); err != nil {
			return RespondError(c, ErrBadRequest(err.Error()))
		}

		// Verify old password
		var currentHash string
		err := h.db.QueryRow("SELECT password_hash FROM users WHERE id = $1", claims.UserID).Scan(&currentHash)
		if err != nil {
			return RespondError(c, ErrInternal("Database error"))
		}

		if err := bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(req.OldPassword)); err != nil {
			return RespondError(c, ErrUnauthorized("Current password is incorrect"))
		}

		// Hash new password
		newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			return RespondError(c, ErrInternal("Failed to hash password"))
		}

		updates = append(updates, fmt.Sprintf("password_hash = $%d", argCount))
		args = append(args, string(newHash))
		argCount++
	}

	if len(updates) == 0 {
		return RespondError(c, ErrBadRequest("No updates provided"))
	}

	updates = append(updates, "updated_at = NOW()")
	args = append(args, claims.UserID)

	query := "UPDATE users SET " + strings.Join(updates, ", ") + fmt.Sprintf(" WHERE id = $%d", argCount)

	_, err := h.db.Exec(query, args...)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to update profile"))
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

// SetMySMBPassword sets the current user's SMB/WebDAV password
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

	// Generate bcrypt hash for WebDAV authentication
	smbHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to hash password",
		})
	}

	_, err = h.db.Exec(`
		UPDATE users SET smb_hash = $1, updated_at = NOW() WHERE id = $2
	`, string(smbHash), claims.UserID)

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
	return GenerateJWTWithExpiration(userID, username, isAdmin, false, 24*time.Hour)
}

// generateTokenWithExpiration generates a JWT token with custom expiration
func (h *AuthHandler) generateTokenWithExpiration(userID, username string, isAdmin, rememberMe bool, expiration time.Duration) (string, error) {
	return GenerateJWTWithExpiration(userID, username, isAdmin, rememberMe, expiration)
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

