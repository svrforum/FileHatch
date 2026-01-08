package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/base32"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"
)

// TOTPHandler handles 2FA TOTP operations
type TOTPHandler struct {
	db           *sql.DB
	encryptKey   []byte
	auditHandler *AuditHandler
}

// NewTOTPHandler creates a new TOTP handler
func NewTOTPHandler(db *sql.DB, auditHandler *AuditHandler) *TOTPHandler {
	keyStr := os.Getenv("TOTP_ENCRYPTION_KEY")
	if keyStr == "" {
		keyStr = os.Getenv("SMB_ENCRYPTION_KEY")
	}
	if keyStr == "" {
		env := os.Getenv("SCV_ENV")
		if env == "production" {
			// In production, fall back to JWT secret if no specific key
			keyStr = os.Getenv("JWT_SECRET")
		}
		if keyStr == "" {
			// Development fallback
			keyStr = "scv-dev-totp-key-not-for-prod-32"
		}
	}

	// Ensure key is exactly 32 bytes for AES-256
	key := make([]byte, 32)
	copy(key, []byte(keyStr))

	return &TOTPHandler{
		db:           db,
		encryptKey:   key,
		auditHandler: auditHandler,
	}
}

// Setup2FAResponse represents the response for 2FA setup
type Setup2FAResponse struct {
	Secret      string `json:"secret"`
	QRCodeURL   string `json:"qrCodeUrl"`
	AccountName string `json:"accountName"`
	Issuer      string `json:"issuer"`
}

// Setup2FA generates a new TOTP secret for the user
func (h *TOTPHandler) Setup2FA(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	// Check if 2FA is already enabled
	var totpEnabled bool
	err := h.db.QueryRow("SELECT COALESCE(totp_enabled, false) FROM users WHERE id = $1", claims.UserID).Scan(&totpEnabled)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to check 2FA status",
		})
	}

	if totpEnabled {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "2FA is already enabled. Disable it first to set up again.",
		})
	}

	// Generate new TOTP key
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "FileHatch",
		AccountName: claims.Username,
		Period:      30,
		Digits:      otp.DigitsSix,
		Algorithm:   otp.AlgorithmSHA1,
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to generate 2FA secret",
		})
	}

	// Encrypt and store the secret temporarily (not enabled yet)
	encryptedSecret, err := EncryptAESGCM([]byte(key.Secret()), h.encryptKey)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to encrypt 2FA secret",
		})
	}

	// Store encrypted secret (but keep totp_enabled = false until verified)
	_, err = h.db.Exec(`
		UPDATE users SET totp_secret = $1, totp_enabled = false, updated_at = NOW()
		WHERE id = $2
	`, encryptedSecret, claims.UserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to save 2FA secret",
		})
	}

	return c.JSON(http.StatusOK, Setup2FAResponse{
		Secret:      key.Secret(),
		QRCodeURL:   key.URL(),
		AccountName: claims.Username,
		Issuer:      "FileHatch",
	})
}

// Enable2FARequest represents the request to enable 2FA
type Enable2FARequest struct {
	Code string `json:"code"`
}

// Enable2FA validates the OTP code and enables 2FA
func (h *TOTPHandler) Enable2FA(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	var req Enable2FARequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if req.Code == "" || len(req.Code) != 6 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Please enter a 6-digit code",
		})
	}

	// Get the stored secret
	var encryptedSecret sql.NullString
	var totpEnabled bool
	err := h.db.QueryRow(`
		SELECT totp_secret, COALESCE(totp_enabled, false)
		FROM users WHERE id = $1
	`, claims.UserID).Scan(&encryptedSecret, &totpEnabled)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to get 2FA status",
		})
	}

	if totpEnabled {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "2FA is already enabled",
		})
	}

	if !encryptedSecret.Valid || encryptedSecret.String == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Please set up 2FA first",
		})
	}

	// Decrypt the secret
	secretBytes, err := DecryptAESGCM(encryptedSecret.String, h.encryptKey)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to decrypt 2FA secret",
		})
	}

	// Validate the code
	valid := totp.Validate(req.Code, string(secretBytes))
	if !valid {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid verification code",
		})
	}

	// Generate backup codes
	backupCodes, hashedCodes, err := h.generateBackupCodes()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to generate backup codes",
		})
	}

	// Store hashed backup codes as JSON
	hashedCodesJSON, _ := json.Marshal(hashedCodes)

	// Enable 2FA
	_, err = h.db.Exec(`
		UPDATE users SET totp_enabled = true, totp_backup_codes = $1, updated_at = NOW()
		WHERE id = $2
	`, string(hashedCodesJSON), claims.UserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to enable 2FA",
		})
	}

	// Audit log
	h.auditHandler.LogEventFromContext(c, "user.2fa.enable", claims.Username, nil)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":     true,
		"message":     "2FA enabled successfully",
		"backupCodes": backupCodes,
	})
}

// Disable2FARequest represents the request to disable 2FA
type Disable2FARequest struct {
	Password string `json:"password"`
}

// Disable2FA disables 2FA for the user
func (h *TOTPHandler) Disable2FA(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	var req Disable2FARequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if req.Password == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Password is required",
		})
	}

	// Verify password
	var passwordHash string
	err := h.db.QueryRow("SELECT password_hash FROM users WHERE id = $1", claims.UserID).Scan(&passwordHash)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to verify user",
		})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Invalid password",
		})
	}

	// Disable 2FA
	_, err = h.db.Exec(`
		UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_backup_codes = NULL, updated_at = NOW()
		WHERE id = $1
	`, claims.UserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to disable 2FA",
		})
	}

	// Audit log
	h.auditHandler.LogEventFromContext(c, "user.2fa.disable", claims.Username, nil)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "2FA disabled successfully",
	})
}

// Verify2FARequest represents the request to verify 2FA during login
type Verify2FARequest struct {
	UserID     string `json:"userId"`
	Code       string `json:"code"`
	RememberMe bool   `json:"rememberMe"`
}

// Verify2FA verifies the 2FA code during login and returns JWT token
func (h *TOTPHandler) Verify2FA(c echo.Context) error {
	var req Verify2FARequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if req.UserID == "" || req.Code == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "User ID and code are required",
		})
	}

	// Get user info
	var user User
	var encryptedSecret sql.NullString
	var backupCodesJSON sql.NullString
	var email sql.NullString
	var smbHash sql.NullString
	var provider sql.NullString

	err := h.db.QueryRow(`
		SELECT id, username, email, smb_hash, provider, is_admin, is_active, totp_secret, totp_backup_codes, created_at, updated_at
		FROM users WHERE id = $1 AND COALESCE(totp_enabled, false) = true
	`, req.UserID).Scan(&user.ID, &user.Username, &email, &smbHash, &provider, &user.IsAdmin, &user.IsActive, &encryptedSecret, &backupCodesJSON, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Invalid user or 2FA not enabled",
		})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Database error",
		})
	}

	if !user.IsActive {
		return c.JSON(http.StatusForbidden, map[string]string{
			"error": "Account is disabled",
		})
	}

	// Check if it's a backup code (8 characters)
	isBackupCode := len(req.Code) == 8

	if isBackupCode {
		// Verify backup code
		if !backupCodesJSON.Valid || backupCodesJSON.String == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "No backup codes available",
			})
		}

		var hashedCodes []string
		if err := json.Unmarshal([]byte(backupCodesJSON.String), &hashedCodes); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to parse backup codes",
			})
		}

		// Find and remove the used backup code
		codeFound := false
		var remainingCodes []string
		for _, hashedCode := range hashedCodes {
			if bcrypt.CompareHashAndPassword([]byte(hashedCode), []byte(req.Code)) == nil {
				codeFound = true
				// Don't add this code to remaining (it's been used)
			} else {
				remainingCodes = append(remainingCodes, hashedCode)
			}
		}

		if !codeFound {
			return c.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Invalid backup code",
			})
		}

		// Update remaining backup codes
		remainingJSON, _ := json.Marshal(remainingCodes)
		h.db.Exec(`UPDATE users SET totp_backup_codes = $1, updated_at = NOW() WHERE id = $2`, string(remainingJSON), user.ID)

		// Audit log
		h.auditHandler.LogEvent(&user.ID, c.RealIP(), "user.2fa.backup_used", user.Username, map[string]interface{}{
			"remaining_codes": len(remainingCodes),
		})
	} else {
		// Verify TOTP code
		if !encryptedSecret.Valid || encryptedSecret.String == "" {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "2FA configuration error",
			})
		}

		secretBytes, err := DecryptAESGCM(encryptedSecret.String, h.encryptKey)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to decrypt 2FA secret",
			})
		}

		valid := totp.Validate(req.Code, string(secretBytes))
		if !valid {
			return c.JSON(http.StatusUnauthorized, map[string]string{
				"error": "Invalid verification code",
			})
		}
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

	// Determine token expiration based on rememberMe
	// Default: 1 day, RememberMe: 30 days
	expiration := 24 * time.Hour
	if req.RememberMe {
		expiration = 30 * 24 * time.Hour
	}

	// Generate JWT token with appropriate expiration
	token, err := GenerateJWTWithExpiration(user.ID, user.Username, user.IsAdmin, req.RememberMe, expiration)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to generate token",
		})
	}

	// Audit log
	h.auditHandler.LogEvent(&user.ID, c.RealIP(), EventUserLogin, user.Username, map[string]interface{}{
		"username":   user.Username,
		"isAdmin":    user.IsAdmin,
		"via_2fa":    true,
		"rememberMe": req.RememberMe,
	})

	return c.JSON(http.StatusOK, LoginResponse{
		Token: token,
		User:  user,
	})
}

// Get2FAStatus returns the 2FA status for the current user
func (h *TOTPHandler) Get2FAStatus(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	var totpEnabled bool
	var backupCodesJSON sql.NullString
	err := h.db.QueryRow(`
		SELECT COALESCE(totp_enabled, false), totp_backup_codes
		FROM users WHERE id = $1
	`, claims.UserID).Scan(&totpEnabled, &backupCodesJSON)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to get 2FA status",
		})
	}

	backupCodesCount := 0
	if backupCodesJSON.Valid && backupCodesJSON.String != "" {
		var codes []string
		if json.Unmarshal([]byte(backupCodesJSON.String), &codes) == nil {
			backupCodesCount = len(codes)
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"enabled":          totpEnabled,
		"backupCodesCount": backupCodesCount,
	})
}

// RegenerateBackupCodes generates new backup codes
func (h *TOTPHandler) RegenerateBackupCodes(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	// Check if 2FA is enabled
	var totpEnabled bool
	err := h.db.QueryRow("SELECT COALESCE(totp_enabled, false) FROM users WHERE id = $1", claims.UserID).Scan(&totpEnabled)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to check 2FA status",
		})
	}

	if !totpEnabled {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "2FA is not enabled",
		})
	}

	// Generate new backup codes
	backupCodes, hashedCodes, err := h.generateBackupCodes()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to generate backup codes",
		})
	}

	// Store hashed backup codes
	hashedCodesJSON, _ := json.Marshal(hashedCodes)
	_, err = h.db.Exec(`
		UPDATE users SET totp_backup_codes = $1, updated_at = NOW()
		WHERE id = $2
	`, string(hashedCodesJSON), claims.UserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to save backup codes",
		})
	}

	// Audit log
	h.auditHandler.LogEventFromContext(c, "user.2fa.backup_regenerate", claims.Username, nil)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":     true,
		"backupCodes": backupCodes,
	})
}

// AdminReset2FA resets 2FA for a user (admin only)
func (h *TOTPHandler) AdminReset2FA(c echo.Context) error {
	adminClaims := c.Get("user").(*JWTClaims)
	userID := c.Param("id")

	// Get username for audit log
	var username string
	var totpEnabled bool
	err := h.db.QueryRow("SELECT username, COALESCE(totp_enabled, false) FROM users WHERE id = $1", userID).Scan(&username, &totpEnabled)
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

	if !totpEnabled {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "2FA is not enabled for this user",
		})
	}

	// Reset 2FA
	_, err = h.db.Exec(`
		UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_backup_codes = NULL, updated_at = NOW()
		WHERE id = $1
	`, userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to reset 2FA",
		})
	}

	// Audit log
	h.auditHandler.LogEventFromContext(c, "admin.2fa.reset", username, map[string]interface{}{
		"admin": adminClaims.Username,
	})

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("2FA reset for user %s", username),
	})
}

// generateBackupCodes generates 10 backup codes and their hashes
func (h *TOTPHandler) generateBackupCodes() (plainCodes []string, hashedCodes []string, err error) {
	plainCodes = make([]string, 10)
	hashedCodes = make([]string, 10)

	for i := 0; i < 10; i++ {
		// Generate 4 random bytes (8 hex characters)
		bytes := make([]byte, 4)
		if _, err := rand.Read(bytes); err != nil {
			return nil, nil, err
		}
		code := strings.ToUpper(base32.StdEncoding.EncodeToString(bytes)[:8])
		plainCodes[i] = code

		// Hash the code for storage
		hash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
		if err != nil {
			return nil, nil, err
		}
		hashedCodes[i] = string(hash)
	}

	return plainCodes, hashedCodes, nil
}

// Check2FARequired checks if a user requires 2FA (for login flow)
func (h *TOTPHandler) Check2FARequired(userID string) bool {
	var totpEnabled bool
	err := h.db.QueryRow("SELECT COALESCE(totp_enabled, false) FROM users WHERE id = $1", userID).Scan(&totpEnabled)
	if err != nil {
		return false
	}
	return totpEnabled
}
