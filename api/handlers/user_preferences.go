package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

// UserPreferencesHandler handles user preferences operations
type UserPreferencesHandler struct {
	db *sql.DB
}

// NewUserPreferencesHandler creates a new user preferences handler
func NewUserPreferencesHandler(db *sql.DB) *UserPreferencesHandler {
	return &UserPreferencesHandler{db: db}
}

// UserPreferences represents user preferences
type UserPreferences struct {
	SidebarOrder   []string `json:"sidebarOrder,omitempty"`
	SidebarHidden  []string `json:"sidebarHidden,omitempty"`
	DefaultLanding string   `json:"defaultLanding,omitempty"`
}

// GetPreferences returns the current user's preferences
func (h *UserPreferencesHandler) GetPreferences(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return RespondError(c, ErrUnauthorized("Authentication required"))
	}

	var prefsJSON sql.NullString
	err = h.db.QueryRow("SELECT preferences FROM users WHERE id = $1", claims.UserID).Scan(&prefsJSON)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to fetch preferences"))
	}

	prefs := UserPreferences{}
	if prefsJSON.Valid && prefsJSON.String != "" && prefsJSON.String != "{}" {
		if err := json.Unmarshal([]byte(prefsJSON.String), &prefs); err != nil {
			return RespondError(c, ErrInternal("Failed to parse preferences"))
		}
	}

	return c.JSON(http.StatusOK, prefs)
}

// UpdatePreferences updates the current user's preferences
func (h *UserPreferencesHandler) UpdatePreferences(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return RespondError(c, ErrUnauthorized("Authentication required"))
	}

	var prefs UserPreferences
	if err := c.Bind(&prefs); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}

	// Validate sidebar order values
	validSections := map[string]bool{
		"files": true, "recent": true, "shared-drives": true,
		"external-storages": true, "sharing": true, "trash": true,
	}
	if len(prefs.SidebarOrder) > len(validSections) {
		return RespondError(c, ErrBadRequest("Duplicate entries in sidebar order"))
	}
	seen := make(map[string]bool)
	for _, section := range prefs.SidebarOrder {
		if !validSections[section] {
			return RespondError(c, ErrBadRequest("Invalid sidebar section: "+section))
		}
		if seen[section] {
			return RespondError(c, ErrBadRequest("Duplicate sidebar section: "+section))
		}
		seen[section] = true
	}
	for _, section := range prefs.SidebarHidden {
		if !validSections[section] {
			return RespondError(c, ErrBadRequest("Invalid sidebar section: "+section))
		}
	}

	// Validate default landing
	validLandings := map[string]bool{
		"": true, "/files": true, "/recent": true, "/shared-drive": true,
		"/shared-with-me": true, "/trash": true, "/my-activity": true,
	}
	if !validLandings[prefs.DefaultLanding] {
		// Allow /external/{mountPath} pattern
		if !strings.HasPrefix(prefs.DefaultLanding, "/external/") ||
			strings.Contains(prefs.DefaultLanding[len("/external/"):], "/") ||
			len(prefs.DefaultLanding) <= len("/external/") {
			return RespondError(c, ErrBadRequest("Invalid default landing page"))
		}
	}

	prefsJSON, err := json.Marshal(prefs)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to serialize preferences"))
	}

	_, err = h.db.Exec("UPDATE users SET preferences = $1 WHERE id = $2", string(prefsJSON), claims.UserID)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to save preferences"))
	}

	return c.JSON(http.StatusOK, prefs)
}
