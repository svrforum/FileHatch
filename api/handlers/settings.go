package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

// SettingsHandler handles system settings operations
type SettingsHandler struct {
	db    *sql.DB
	cache map[string]settingsCacheEntry
	mu    sync.RWMutex
}

type settingsCacheEntry struct {
	value     string
	expiresAt time.Time
}

// SystemSetting represents a system setting
type SystemSetting struct {
	Key         string     `json:"key"`
	Value       string     `json:"value"`
	Description string     `json:"description,omitempty"`
	UpdatedBy   *string    `json:"updatedBy,omitempty"`
	UpdatedAt   *time.Time `json:"updatedAt,omitempty"`
}

// NewSettingsHandler creates a new settings handler
func NewSettingsHandler(db *sql.DB) *SettingsHandler {
	return &SettingsHandler{
		db:    db,
		cache: make(map[string]settingsCacheEntry),
	}
}

// GetSetting retrieves a single setting value with caching
func (h *SettingsHandler) GetSetting(key string) (string, error) {
	// Check cache first
	h.mu.RLock()
	if entry, ok := h.cache[key]; ok && time.Now().Before(entry.expiresAt) {
		h.mu.RUnlock()
		return entry.value, nil
	}
	h.mu.RUnlock()

	// Query from database
	var value string
	err := h.db.QueryRow("SELECT value FROM system_settings WHERE key = $1", key).Scan(&value)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}

	// Update cache
	h.mu.Lock()
	h.cache[key] = settingsCacheEntry{
		value:     value,
		expiresAt: time.Now().Add(5 * time.Minute),
	}
	h.mu.Unlock()

	return value, nil
}

// GetSettingInt retrieves a setting as integer
func (h *SettingsHandler) GetSettingInt(key string, defaultValue int) int {
	value, err := h.GetSetting(key)
	if err != nil || value == "" {
		return defaultValue
	}

	intValue, err := strconv.Atoi(value)
	if err != nil {
		return defaultValue
	}
	return intValue
}

// GetSettingInt64 retrieves a setting as int64
func (h *SettingsHandler) GetSettingInt64(key string, defaultValue int64) int64 {
	value, err := h.GetSetting(key)
	if err != nil || value == "" {
		return defaultValue
	}

	intValue, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return defaultValue
	}
	return intValue
}

// GetSettingBool retrieves a setting as boolean
func (h *SettingsHandler) GetSettingBool(key string, defaultValue bool) bool {
	value, err := h.GetSetting(key)
	if err != nil || value == "" {
		return defaultValue
	}
	return value == "true" || value == "1" || value == "yes"
}

// Security Settings Helpers
func (h *SettingsHandler) IsRateLimitEnabled() bool {
	return h.GetSettingBool("rate_limit_enabled", true)
}

func (h *SettingsHandler) GetRateLimitRPS() int {
	return h.GetSettingInt("rate_limit_rps", 100)
}

func (h *SettingsHandler) IsSecurityHeadersEnabled() bool {
	return h.GetSettingBool("security_headers_enabled", true)
}

func (h *SettingsHandler) IsXSSProtectionEnabled() bool {
	return h.GetSettingBool("xss_protection_enabled", true)
}

func (h *SettingsHandler) IsHSTSEnabled() bool {
	return h.GetSettingBool("hsts_enabled", true)
}

func (h *SettingsHandler) IsCSPEnabled() bool {
	return h.GetSettingBool("csp_enabled", true)
}

func (h *SettingsHandler) GetXFrameOptions() string {
	value, err := h.GetSetting("x_frame_options")
	if err != nil || value == "" {
		return "SAMEORIGIN"
	}
	// Validate allowed values
	switch value {
	case "DENY", "SAMEORIGIN":
		return value
	default:
		return "SAMEORIGIN"
	}
}

// InvalidateCache removes a key from cache
func (h *SettingsHandler) InvalidateCache(key string) {
	h.mu.Lock()
	delete(h.cache, key)
	h.mu.Unlock()
}

// GetAllSettings returns all system settings (admin only)
func (h *SettingsHandler) GetAllSettings(c echo.Context) error {
	rows, err := h.db.Query(`
		SELECT key, value, COALESCE(description, ''), updated_at
		FROM system_settings
		ORDER BY key
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to load settings",
		})
	}
	defer rows.Close()

	settings := make([]SystemSetting, 0)
	for rows.Next() {
		var s SystemSetting
		if err := rows.Scan(&s.Key, &s.Value, &s.Description, &s.UpdatedAt); err != nil {
			continue
		}
		settings = append(settings, s)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"settings": settings,
	})
}

// UpdateSetting updates a single setting (admin only)
func (h *SettingsHandler) UpdateSetting(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	var req struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}

	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request body",
		})
	}

	if req.Key == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Key is required",
		})
	}

	// Update in database
	result, err := h.db.Exec(`
		UPDATE system_settings
		SET value = $1, updated_by = $2, updated_at = NOW()
		WHERE key = $3
	`, req.Value, claims.UserID, req.Key)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to update setting",
		})
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		// Insert if not exists
		_, err = h.db.Exec(`
			INSERT INTO system_settings (key, value, updated_by, updated_at)
			VALUES ($1, $2, $3, NOW())
		`, req.Key, req.Value, claims.UserID)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to create setting",
			})
		}
	}

	// Invalidate cache
	h.InvalidateCache(req.Key)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"key":     req.Key,
		"value":   req.Value,
	})
}

// UpdateSettings updates multiple settings at once (admin only)
func (h *SettingsHandler) UpdateSettings(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	var req struct {
		Settings map[string]string `json:"settings"`
	}

	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request body",
		})
	}

	if len(req.Settings) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "No settings provided",
		})
	}

	// Update each setting
	for key, value := range req.Settings {
		_, err := h.db.Exec(`
			INSERT INTO system_settings (key, value, updated_by, updated_at)
			VALUES ($1, $2, $3, NOW())
			ON CONFLICT (key) DO UPDATE
			SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
		`, key, value, claims.UserID)

		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to update settings",
			})
		}

		// Invalidate cache
		h.InvalidateCache(key)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"updated": len(req.Settings),
	})
}

// GetTrashSettings returns trash-related settings for the stats API
func (h *SettingsHandler) GetTrashRetentionDays() int {
	return h.GetSettingInt("trash_retention_days", 30)
}

// Global settings handler instance
var globalSettingsHandler *SettingsHandler

// GetGlobalSettingsHandler returns the global settings handler
func GetGlobalSettingsHandler() *SettingsHandler {
	return globalSettingsHandler
}

// SetGlobalSettingsHandler sets the global settings handler
func SetGlobalSettingsHandler(h *SettingsHandler) {
	globalSettingsHandler = h
}
