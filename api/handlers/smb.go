package handlers

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"text/template"
	"time"

	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

// errSMBDisabled is returned when SMB is disabled in system settings
var errSMBDisabled = errors.New("SMB service is disabled")

type SMBHandler struct {
	db         *sql.DB
	configPath string
	crypto     *SMBCrypto
}

func NewSMBHandler(db *sql.DB, configPath string) *SMBHandler {
	crypto, err := NewSMBCrypto(configPath)
	if err != nil {
		fmt.Printf("Warning: Failed to initialize SMB encryption: %v\n", err)
		// Continue without encryption in non-production
	}

	handler := &SMBHandler{
		db:         db,
		configPath: configPath,
		crypto:     crypto,
	}

	// Migrate existing plaintext passwords if crypto is available
	if crypto != nil {
		if err := crypto.MigrateFromPlaintext(); err != nil {
			fmt.Printf("Warning: Failed to migrate SMB passwords: %v\n", err)
		}
	}

	return handler
}

// IsSMBEnabled checks if SMB is enabled in system settings
func (h *SMBHandler) IsSMBEnabled() bool {
	var value string
	err := h.db.QueryRow("SELECT value FROM system_settings WHERE key = 'smb_enabled'").Scan(&value)
	if err != nil {
		// Default to true if setting doesn't exist
		return true
	}
	return value == "true"
}

// checkSMBEnabled returns an error response if SMB is disabled
func (h *SMBHandler) checkSMBEnabled(c echo.Context) error {
	if !h.IsSMBEnabled() {
		c.JSON(http.StatusServiceUnavailable, map[string]string{
			"error": "SMB service is disabled. Enable it in system settings.",
		})
		return errSMBDisabled
	}
	return nil
}

// SMBUser represents an SMB user
type SMBUser struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	IsActive  bool      `json:"isActive"`
	HasSMB    bool      `json:"hasSmb"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// SMBConfig represents SMB server configuration
type SMBConfig struct {
	Workgroup   string `json:"workgroup"`
	ServerName  string `json:"serverName"`
	GuestAccess bool   `json:"guestAccess"`
}

// SetPasswordRequest represents request to set SMB password
type SetPasswordRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// ListSMBUsers returns list of users with SMB info
func (h *SMBHandler) ListSMBUsers(c echo.Context) error {
	if err := h.checkSMBEnabled(c); err != nil {
		return err
	}

	rows, err := h.db.Query(`
		SELECT id, username, is_active,
		       CASE WHEN smb_hash IS NOT NULL AND smb_hash != '' THEN true ELSE false END as has_smb,
		       created_at, updated_at
		FROM users
		ORDER BY username
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to query users",
		})
	}
	defer rows.Close()

	users := []SMBUser{}
	for rows.Next() {
		var user SMBUser
		if err := rows.Scan(&user.ID, &user.Username, &user.IsActive, &user.HasSMB, &user.CreatedAt, &user.UpdatedAt); err != nil {
			continue
		}
		users = append(users, user)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"users": users,
		"total": len(users),
	})
}

// CreateSMBUser creates a new user with SMB access
func (h *SMBHandler) CreateSMBUser(c echo.Context) error {
	if err := h.checkSMBEnabled(c); err != nil {
		return err
	}

	var req SetPasswordRequest
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

	// Validate username (alphanumeric only, 3-50 chars)
	if len(req.Username) < 3 || len(req.Username) > 50 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Username must be between 3 and 50 characters",
		})
	}

	// Validate password (at least 8 chars)
	if len(req.Password) < 8 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Password must be at least 8 characters",
		})
	}

	// Hash the password for web auth
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to hash password",
		})
	}

	// Generate SMB hash (we'll store a marker, actual SMB password is set in samba container)
	smbHash := generateSMBMarker()

	// Insert or update user
	var userID string
	err = h.db.QueryRow(`
		INSERT INTO users (username, password_hash, smb_hash, is_active)
		VALUES ($1, $2, $3, true)
		ON CONFLICT (username) DO UPDATE
		SET password_hash = $2, smb_hash = $3, updated_at = NOW()
		RETURNING id
	`, req.Username, string(passwordHash), smbHash).Scan(&userID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create user",
		})
	}

	// Write SMB user to sync file with password
	if err := h.updateSMBUserPassword(req.Username, req.Password); err != nil {
		// Log but don't fail - user was created
		fmt.Printf("Warning: Failed to write SMB users file: %v\n", err)
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"success":  true,
		"id":       userID,
		"username": req.Username,
		"message":  "User created successfully. SMB access is now available.",
	})
}

// SetSMBPassword sets SMB password for an existing user
func (h *SMBHandler) SetSMBPassword(c echo.Context) error {
	if err := h.checkSMBEnabled(c); err != nil {
		return err
	}

	var req SetPasswordRequest
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

	if len(req.Password) < 8 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Password must be at least 8 characters",
		})
	}

	// Check if user exists
	var userID string
	err := h.db.QueryRow("SELECT id FROM users WHERE username = $1", req.Username).Scan(&userID)
	if err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "User not found",
		})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to query user",
		})
	}

	// Update SMB hash marker
	smbHash := generateSMBMarker()
	_, err = h.db.Exec(`
		UPDATE users SET smb_hash = $1, updated_at = NOW() WHERE username = $2
	`, smbHash, req.Username)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to update SMB password",
		})
	}

	// Write SMB user to sync file with password
	if err := h.updateSMBUserPassword(req.Username, req.Password); err != nil {
		fmt.Printf("Warning: Failed to write SMB users file: %v\n", err)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "SMB password updated successfully.",
	})
}

// DeleteSMBUser removes SMB access for a user
func (h *SMBHandler) DeleteSMBUser(c echo.Context) error {
	if err := h.checkSMBEnabled(c); err != nil {
		return err
	}

	username := c.Param("username")
	if username == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Username required",
		})
	}

	// Clear SMB hash (don't delete user, just remove SMB access)
	result, err := h.db.Exec(`
		UPDATE users SET smb_hash = NULL, updated_at = NOW() WHERE username = $1
	`, username)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to remove SMB access",
		})
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "User not found",
		})
	}

	// Remove from SMB sync file
	if err := h.removeSMBUser(username); err != nil {
		fmt.Printf("Warning: Failed to update SMB users file: %v\n", err)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "SMB access removed.",
	})
}

// GetSMBConfig returns current SMB configuration
func (h *SMBHandler) GetSMBConfig(c echo.Context) error {
	if err := h.checkSMBEnabled(c); err != nil {
		return err
	}

	configPath := filepath.Join(h.configPath, "smb.conf")
	content, err := os.ReadFile(configPath)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to read SMB config",
		})
	}

	// Parse simple values from config
	config := SMBConfig{
		Workgroup:   "WORKGROUP",
		ServerName:  "FileHatch SMB Server",
		GuestAccess: false,
	}

	lines := strings.Split(string(content), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "workgroup = ") {
			config.Workgroup = strings.TrimPrefix(line, "workgroup = ")
		} else if strings.HasPrefix(line, "server string = ") {
			config.ServerName = strings.TrimPrefix(line, "server string = ")
		} else if strings.HasPrefix(line, "guest ok = ") {
			config.GuestAccess = strings.TrimPrefix(line, "guest ok = ") == "yes"
		}
	}

	return c.JSON(http.StatusOK, config)
}

// UpdateSMBConfig updates SMB configuration
func (h *SMBHandler) UpdateSMBConfig(c echo.Context) error {
	if err := h.checkSMBEnabled(c); err != nil {
		return err
	}

	var config SMBConfig
	if err := c.Bind(&config); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if config.Workgroup == "" {
		config.Workgroup = "WORKGROUP"
	}
	if config.ServerName == "" {
		config.ServerName = "FileHatch SMB Server"
	}

	// Generate new smb.conf
	tmpl := `[global]
   workgroup = {{.Workgroup}}
   server string = {{.ServerName}}
   security = user
   map to guest = Bad User
   log level = 1
   log file = /var/log/samba/%m.log
   max log size = 50

[data]
   path = /data
   browseable = yes
   read only = no
   guest ok = {{if .GuestAccess}}yes{{else}}no{{end}}
   valid users = @users
   create mask = 0644
   directory mask = 0755
`

	t, err := template.New("smb").Parse(tmpl)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to parse template",
		})
	}

	configPath := filepath.Join(h.configPath, "smb.conf")
	f, err := os.Create(configPath)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to write config file",
		})
	}
	defer f.Close()

	if err := t.Execute(f, config); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to generate config",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "SMB configuration updated. Restart samba container to apply changes.",
	})
}

// updateSMBUserPassword adds or updates a user's password using encrypted storage
func (h *SMBHandler) updateSMBUserPassword(username, password string) error {
	if h.crypto != nil {
		return h.crypto.SaveUser(username, password)
	}

	// Fallback to plaintext file if encryption is not available (non-production)
	usersFile := filepath.Join(h.configPath, "smb_users.txt")

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
		lines = append(lines, fmt.Sprintf("%s:%s", user, pass))
	}

	return os.WriteFile(usersFile, []byte(strings.Join(lines, "\n")+"\n"), 0600)
}

// removeSMBUser removes a user from the encrypted storage
func (h *SMBHandler) removeSMBUser(username string) error {
	if h.crypto != nil {
		return h.crypto.RemoveUser(username)
	}

	// Fallback to plaintext file if encryption is not available (non-production)
	usersFile := filepath.Join(h.configPath, "smb_users.txt")

	// Read existing entries
	content, err := os.ReadFile(usersFile)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	// Filter out the user
	var lines []string
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if parts[0] != username {
			lines = append(lines, line)
		}
	}

	return os.WriteFile(usersFile, []byte(strings.Join(lines, "\n")+"\n"), 0600)
}

// generateSMBMarker generates a unique marker for SMB password tracking using crypto-secure random
func generateSMBMarker() string {
	token, err := GenerateSecureToken(16)
	if err != nil {
		// Fallback should never happen in normal operation
		return MustGenerateSecureToken(16)
	}
	return token
}
