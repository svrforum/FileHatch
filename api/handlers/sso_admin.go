package handlers

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

// ListAllProviders returns all SSO providers (admin only)
func (h *SSOHandler) ListAllProviders(c echo.Context) error {
	rows, err := h.db.Query(`
		SELECT id, name, provider_type, client_id, issuer_url,
			   authorization_url, token_url, userinfo_url, scopes, allowed_domains,
			   auto_create_user, default_admin, is_enabled, display_order, icon_url, button_color,
			   created_at, updated_at
		FROM sso_providers
		ORDER BY display_order, name
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch providers",
		})
	}
	defer rows.Close()

	var providers []SSOProvider
	for rows.Next() {
		var p SSOProvider
		var issuerURL, authURL, tokenURL, userinfoURL, allowedDomains, iconURL, buttonColor sql.NullString
		if err := rows.Scan(
			&p.ID, &p.Name, &p.ProviderType, &p.ClientID, &issuerURL,
			&authURL, &tokenURL, &userinfoURL, &p.Scopes, &allowedDomains,
			&p.AutoCreateUser, &p.DefaultAdmin, &p.IsEnabled, &p.DisplayOrder, &iconURL, &buttonColor,
			&p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			continue
		}
		if issuerURL.Valid {
			p.IssuerURL = issuerURL.String
		}
		if authURL.Valid {
			p.AuthorizationURL = authURL.String
		}
		if tokenURL.Valid {
			p.TokenURL = tokenURL.String
		}
		if userinfoURL.Valid {
			p.UserinfoURL = userinfoURL.String
		}
		if allowedDomains.Valid {
			p.AllowedDomains = allowedDomains.String
		}
		if iconURL.Valid {
			p.IconURL = iconURL.String
		}
		if buttonColor.Valid {
			p.ButtonColor = buttonColor.String
		}
		// Don't expose client secret in list
		p.ClientSecret = ""
		providers = append(providers, p)
	}

	return c.JSON(http.StatusOK, providers)
}

// CreateProvider creates a new SSO provider
func (h *SSOHandler) CreateProvider(c echo.Context) error {
	var req struct {
		Name             string `json:"name"`
		ProviderType     string `json:"providerType"`
		ClientID         string `json:"clientId"`
		ClientSecret     string `json:"clientSecret"`
		IssuerURL        string `json:"issuerUrl"`
		AuthorizationURL string `json:"authorizationUrl"`
		TokenURL         string `json:"tokenUrl"`
		UserinfoURL      string `json:"userinfoUrl"`
		Scopes           string `json:"scopes"`
		AllowedDomains   string `json:"allowedDomains"`
		AutoCreateUser   bool   `json:"autoCreateUser"`
		DefaultAdmin     bool   `json:"defaultAdmin"`
		IsEnabled        bool   `json:"isEnabled"`
		DisplayOrder     int    `json:"displayOrder"`
		IconURL          string `json:"iconUrl"`
		ButtonColor      string `json:"buttonColor"`
	}

	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if req.Name == "" || req.ProviderType == "" || req.ClientID == "" || req.ClientSecret == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Name, provider type, client ID, and client secret are required",
		})
	}

	// Set default scopes
	if req.Scopes == "" {
		req.Scopes = "openid email profile"
	}

	var id string
	err := h.db.QueryRow(`
		INSERT INTO sso_providers (name, provider_type, client_id, client_secret, issuer_url,
			authorization_url, token_url, userinfo_url, scopes, allowed_domains,
			auto_create_user, default_admin, is_enabled, display_order, icon_url, button_color)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		RETURNING id
	`, req.Name, req.ProviderType, req.ClientID, req.ClientSecret, nullIfEmpty(req.IssuerURL),
		nullIfEmpty(req.AuthorizationURL), nullIfEmpty(req.TokenURL), nullIfEmpty(req.UserinfoURL),
		req.Scopes, nullIfEmpty(req.AllowedDomains), req.AutoCreateUser, req.DefaultAdmin,
		req.IsEnabled, req.DisplayOrder, nullIfEmpty(req.IconURL), nullIfEmpty(req.ButtonColor),
	).Scan(&id)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create provider: " + err.Error(),
		})
	}

	return c.JSON(http.StatusCreated, map[string]string{
		"id":      id,
		"message": "SSO provider created successfully",
	})
}

// UpdateProvider updates an SSO provider
func (h *SSOHandler) UpdateProvider(c echo.Context) error {
	id := c.Param("id")
	if id == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Provider ID required",
		})
	}

	var req struct {
		Name             string `json:"name"`
		ProviderType     string `json:"providerType"`
		ClientID         string `json:"clientId"`
		ClientSecret     string `json:"clientSecret"` // Empty = don't update
		IssuerURL        string `json:"issuerUrl"`
		AuthorizationURL string `json:"authorizationUrl"`
		TokenURL         string `json:"tokenUrl"`
		UserinfoURL      string `json:"userinfoUrl"`
		Scopes           string `json:"scopes"`
		AllowedDomains   string `json:"allowedDomains"`
		AutoCreateUser   bool   `json:"autoCreateUser"`
		DefaultAdmin     bool   `json:"defaultAdmin"`
		IsEnabled        bool   `json:"isEnabled"`
		DisplayOrder     int    `json:"displayOrder"`
		IconURL          string `json:"iconUrl"`
		ButtonColor      string `json:"buttonColor"`
	}

	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	// Build update query
	if req.ClientSecret != "" {
		// Update with new secret
		_, err := h.db.Exec(`
			UPDATE sso_providers SET
				name = $1, provider_type = $2, client_id = $3, client_secret = $4,
				issuer_url = $5, authorization_url = $6, token_url = $7, userinfo_url = $8,
				scopes = $9, allowed_domains = $10, auto_create_user = $11, default_admin = $12,
				is_enabled = $13, display_order = $14, icon_url = $15, button_color = $16,
				updated_at = NOW()
			WHERE id = $17
		`, req.Name, req.ProviderType, req.ClientID, req.ClientSecret,
			nullIfEmpty(req.IssuerURL), nullIfEmpty(req.AuthorizationURL), nullIfEmpty(req.TokenURL),
			nullIfEmpty(req.UserinfoURL), req.Scopes, nullIfEmpty(req.AllowedDomains),
			req.AutoCreateUser, req.DefaultAdmin, req.IsEnabled, req.DisplayOrder,
			nullIfEmpty(req.IconURL), nullIfEmpty(req.ButtonColor), id)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to update provider",
			})
		}
	} else {
		// Update without changing secret
		_, err := h.db.Exec(`
			UPDATE sso_providers SET
				name = $1, provider_type = $2, client_id = $3,
				issuer_url = $4, authorization_url = $5, token_url = $6, userinfo_url = $7,
				scopes = $8, allowed_domains = $9, auto_create_user = $10, default_admin = $11,
				is_enabled = $12, display_order = $13, icon_url = $14, button_color = $15,
				updated_at = NOW()
			WHERE id = $16
		`, req.Name, req.ProviderType, req.ClientID,
			nullIfEmpty(req.IssuerURL), nullIfEmpty(req.AuthorizationURL), nullIfEmpty(req.TokenURL),
			nullIfEmpty(req.UserinfoURL), req.Scopes, nullIfEmpty(req.AllowedDomains),
			req.AutoCreateUser, req.DefaultAdmin, req.IsEnabled, req.DisplayOrder,
			nullIfEmpty(req.IconURL), nullIfEmpty(req.ButtonColor), id)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to update provider",
			})
		}
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": "SSO provider updated successfully",
	})
}

// DeleteProvider deletes an SSO provider
func (h *SSOHandler) DeleteProvider(c echo.Context) error {
	id := c.Param("id")
	if id == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Provider ID required",
		})
	}

	result, err := h.db.Exec("DELETE FROM sso_providers WHERE id = $1", id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to delete provider",
		})
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Provider not found",
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": "SSO provider deleted successfully",
	})
}

// GetSSOSettings returns SSO-related system settings
func (h *SSOHandler) GetSSOSettings(c echo.Context) error {
	settings := make(map[string]string)

	rows, err := h.db.Query(`
		SELECT key, value FROM system_settings
		WHERE key LIKE 'sso_%'
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch settings",
		})
	}
	defer rows.Close()

	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err == nil {
			settings[key] = value
		}
	}

	return c.JSON(http.StatusOK, settings)
}

// UpdateSSOSettings updates SSO-related system settings
func (h *SSOHandler) UpdateSSOSettings(c echo.Context) error {
	var req map[string]string
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	claims := c.Get("user").(*JWTClaims)

	for key, value := range req {
		if !strings.HasPrefix(key, "sso_") {
			continue
		}
		_, err := h.db.Exec(`
			INSERT INTO system_settings (key, value, updated_by, updated_at)
			VALUES ($1, $2, $3, NOW())
			ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()
		`, key, value, claims.UserID)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to update setting: " + key,
			})
		}
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": "SSO settings updated successfully",
	})
}
