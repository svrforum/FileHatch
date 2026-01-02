package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

// SSOProvider represents an SSO provider configuration
type SSOProvider struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	ProviderType     string    `json:"providerType"`
	ClientID         string    `json:"clientId"`
	ClientSecret     string    `json:"clientSecret,omitempty"` // Hidden in responses
	IssuerURL        string    `json:"issuerUrl,omitempty"`
	AuthorizationURL string    `json:"authorizationUrl,omitempty"`
	TokenURL         string    `json:"tokenUrl,omitempty"`
	UserinfoURL      string    `json:"userinfoUrl,omitempty"`
	Scopes           string    `json:"scopes"`
	AllowedDomains   string    `json:"allowedDomains,omitempty"`
	AutoCreateUser   bool      `json:"autoCreateUser"`
	DefaultAdmin     bool      `json:"defaultAdmin"`
	IsEnabled        bool      `json:"isEnabled"`
	DisplayOrder     int       `json:"displayOrder"`
	IconURL          string    `json:"iconUrl,omitempty"`
	ButtonColor      string    `json:"buttonColor,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

// SSOProviderPublic is the public version without sensitive data
type SSOProviderPublic struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ProviderType string `json:"providerType"`
	IconURL      string `json:"iconUrl,omitempty"`
	ButtonColor  string `json:"buttonColor,omitempty"`
}

// OIDCTokenResponse represents the token response from OIDC provider
type OIDCTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
	IDToken      string `json:"id_token,omitempty"`
}

// OIDCUserInfo represents user info from OIDC provider
type OIDCUserInfo struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	Picture       string `json:"picture"`
}

// SSOHandler handles SSO-related operations
type SSOHandler struct {
	db        *sql.DB
	jwtSecret string
	dataRoot  string
}

// NewSSOHandler creates a new SSOHandler
func NewSSOHandler(db *sql.DB, jwtSecret, dataRoot string) *SSOHandler {
	return &SSOHandler{
		db:        db,
		jwtSecret: jwtSecret,
		dataRoot:  dataRoot,
	}
}

// generateState generates a random state for OAuth2 flow
func generateState() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

// getExternalHost returns the external host from X-Forwarded-Host or falls back to request Host
func getExternalHost(c echo.Context) string {
	// Check X-Forwarded-Host first (set by reverse proxy)
	if forwardedHost := c.Request().Header.Get("X-Forwarded-Host"); forwardedHost != "" {
		return forwardedHost
	}
	// Fall back to Host header
	return c.Request().Host
}

// GetProviders returns all enabled SSO providers (public info only)
func (h *SSOHandler) GetProviders(c echo.Context) error {
	// Check if SSO is enabled
	var ssoEnabled string
	h.db.QueryRow("SELECT value FROM system_settings WHERE key = 'sso_enabled'").Scan(&ssoEnabled)
	if ssoEnabled != "true" {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"enabled":   false,
			"providers": []SSOProviderPublic{},
		})
	}

	rows, err := h.db.Query(`
		SELECT id, name, provider_type, icon_url, button_color
		FROM sso_providers
		WHERE is_enabled = true
		ORDER BY display_order, name
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch SSO providers",
		})
	}
	defer rows.Close()

	var providers []SSOProviderPublic
	for rows.Next() {
		var p SSOProviderPublic
		var iconURL, buttonColor sql.NullString
		if err := rows.Scan(&p.ID, &p.Name, &p.ProviderType, &iconURL, &buttonColor); err != nil {
			continue
		}
		if iconURL.Valid {
			p.IconURL = iconURL.String
		}
		if buttonColor.Valid {
			p.ButtonColor = buttonColor.String
		}
		providers = append(providers, p)
	}

	// Check SSO-only mode
	var ssoOnlyMode string
	h.db.QueryRow("SELECT value FROM system_settings WHERE key = 'sso_only_mode'").Scan(&ssoOnlyMode)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"enabled":     true,
		"ssoOnlyMode": ssoOnlyMode == "true",
		"providers":   providers,
	})
}

// nullIfEmpty returns nil if string is empty
func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
