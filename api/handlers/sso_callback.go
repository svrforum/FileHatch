package handlers

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"crypto/rand"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

// GetAuthURL returns the authorization URL for an SSO provider
func (h *SSOHandler) GetAuthURL(c echo.Context) error {
	providerID := c.Param("providerId")
	if providerID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Provider ID required",
		})
	}

	// Get provider configuration
	var provider SSOProvider
	var issuerURL, authURL, tokenURL, userinfoURL, iconURL, buttonColor, allowedDomains sql.NullString
	err := h.db.QueryRow(`
		SELECT id, name, provider_type, client_id, client_secret, issuer_url,
			   authorization_url, token_url, userinfo_url, scopes, allowed_domains,
			   auto_create_user, default_admin, is_enabled, display_order, icon_url, button_color
		FROM sso_providers WHERE id = $1 AND is_enabled = true
	`, providerID).Scan(
		&provider.ID, &provider.Name, &provider.ProviderType, &provider.ClientID, &provider.ClientSecret,
		&issuerURL, &authURL, &tokenURL, &userinfoURL, &provider.Scopes, &allowedDomains,
		&provider.AutoCreateUser, &provider.DefaultAdmin, &provider.IsEnabled, &provider.DisplayOrder,
		&iconURL, &buttonColor,
	)
	if err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Provider not found or disabled",
		})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch provider",
		})
	}

	if issuerURL.Valid {
		provider.IssuerURL = issuerURL.String
	}
	if authURL.Valid {
		provider.AuthorizationURL = authURL.String
	}
	if tokenURL.Valid {
		provider.TokenURL = tokenURL.String
	}
	if userinfoURL.Valid {
		provider.UserinfoURL = userinfoURL.String
	}
	if allowedDomains.Valid {
		provider.AllowedDomains = allowedDomains.String
	}

	// Determine authorization URL
	authorizationURL := provider.AuthorizationURL
	if authorizationURL == "" {
		switch provider.ProviderType {
		case "google":
			authorizationURL = "https://accounts.google.com/o/oauth2/v2/auth"
		case "github":
			authorizationURL = "https://github.com/login/oauth/authorize"
		case "azure":
			authorizationURL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
		case "oidc":
			if provider.IssuerURL != "" {
				authorizationURL = strings.TrimSuffix(provider.IssuerURL, "/") + "/protocol/openid-connect/auth"
			}
		}
	}

	if authorizationURL == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Authorization URL not configured",
		})
	}

	// Generate state
	state, err := generateState()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to generate state",
		})
	}

	// Build redirect URI using external URL configuration
	scheme := getExternalScheme(c)
	host := getExternalHost(c)
	redirectURI := fmt.Sprintf("%s://%s/api/auth/sso/callback/%s", scheme, host, providerID)

	// Build authorization URL
	params := url.Values{}
	params.Set("client_id", provider.ClientID)
	params.Set("response_type", "code")
	params.Set("redirect_uri", redirectURI)
	params.Set("scope", provider.Scopes)
	params.Set("state", state)
	if provider.ProviderType == "google" {
		params.Set("access_type", "offline")
		params.Set("prompt", "select_account")
	}

	fullAuthURL := authorizationURL + "?" + params.Encode()

	return c.JSON(http.StatusOK, map[string]string{
		"authUrl": fullAuthURL,
		"state":   state,
	})
}

// HandleCallback handles the OAuth2 callback
func (h *SSOHandler) HandleCallback(c echo.Context) error {
	providerID := c.Param("providerId")
	code := c.QueryParam("code")
	// state := c.QueryParam("state") // Could verify state here

	if code == "" {
		errorMsg := c.QueryParam("error")
		errorDesc := c.QueryParam("error_description")
		return c.Redirect(http.StatusFound, fmt.Sprintf("/login?error=sso_failed&message=%s", url.QueryEscape(errorMsg+": "+errorDesc)))
	}

	// Get provider configuration
	var provider SSOProvider
	var issuerURL, authURL, tokenURL, userinfoURL, allowedDomains sql.NullString
	err := h.db.QueryRow(`
		SELECT id, name, provider_type, client_id, client_secret, issuer_url,
			   authorization_url, token_url, userinfo_url, scopes, allowed_domains,
			   auto_create_user, default_admin
		FROM sso_providers WHERE id = $1 AND is_enabled = true
	`, providerID).Scan(
		&provider.ID, &provider.Name, &provider.ProviderType, &provider.ClientID, &provider.ClientSecret,
		&issuerURL, &authURL, &tokenURL, &userinfoURL, &provider.Scopes, &allowedDomains,
		&provider.AutoCreateUser, &provider.DefaultAdmin,
	)
	if err != nil {
		return c.Redirect(http.StatusFound, "/login?error=provider_not_found")
	}

	if issuerURL.Valid {
		provider.IssuerURL = issuerURL.String
	}
	if tokenURL.Valid {
		provider.TokenURL = tokenURL.String
	}
	if userinfoURL.Valid {
		provider.UserinfoURL = userinfoURL.String
	}
	if allowedDomains.Valid {
		provider.AllowedDomains = allowedDomains.String
	}

	// Determine token URL
	tokenURLStr := provider.TokenURL
	if tokenURLStr == "" {
		switch provider.ProviderType {
		case "google":
			tokenURLStr = "https://oauth2.googleapis.com/token"
		case "github":
			tokenURLStr = "https://github.com/login/oauth/access_token"
		case "azure":
			tokenURLStr = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
		case "oidc":
			if provider.IssuerURL != "" {
				tokenURLStr = strings.TrimSuffix(provider.IssuerURL, "/") + "/protocol/openid-connect/token"
			}
		}
	}

	// Build redirect URI using external URL configuration
	scheme := getExternalScheme(c)
	host := getExternalHost(c)
	redirectURI := fmt.Sprintf("%s://%s/api/auth/sso/callback/%s", scheme, host, providerID)

	// Exchange code for token
	tokenResp, err := h.exchangeCodeForToken(tokenURLStr, code, provider.ClientID, provider.ClientSecret, redirectURI)
	if err != nil {
		return c.Redirect(http.StatusFound, "/login?error=token_exchange_failed&message="+url.QueryEscape(err.Error()))
	}

	// Get user info
	userInfo, err := h.getUserInfo(provider, tokenResp.AccessToken)
	if err != nil {
		return c.Redirect(http.StatusFound, "/login?error=userinfo_failed&message="+url.QueryEscape(err.Error()))
	}

	// Validate email domain
	if provider.AllowedDomains != "" {
		emailDomain := ""
		if parts := strings.Split(userInfo.Email, "@"); len(parts) == 2 {
			emailDomain = strings.ToLower(parts[1])
		}
		allowed := false
		for _, domain := range strings.Split(provider.AllowedDomains, ",") {
			if strings.TrimSpace(strings.ToLower(domain)) == emailDomain {
				allowed = true
				break
			}
		}
		if !allowed {
			return c.Redirect(http.StatusFound, "/login?error=domain_not_allowed&message="+url.QueryEscape(fmt.Sprintf("Email domain %s is not allowed", emailDomain)))
		}
	}

	// Also check global allowed domains
	var globalAllowedDomains string
	h.db.QueryRow("SELECT value FROM system_settings WHERE key = 'sso_allowed_domains'").Scan(&globalAllowedDomains)
	if globalAllowedDomains != "" {
		emailDomain := ""
		if parts := strings.Split(userInfo.Email, "@"); len(parts) == 2 {
			emailDomain = strings.ToLower(parts[1])
		}
		allowed := false
		for _, domain := range strings.Split(globalAllowedDomains, ",") {
			if strings.TrimSpace(strings.ToLower(domain)) == emailDomain {
				allowed = true
				break
			}
		}
		if !allowed {
			return c.Redirect(http.StatusFound, "/login?error=domain_not_allowed&message="+url.QueryEscape(fmt.Sprintf("Email domain %s is not allowed", emailDomain)))
		}
	}

	// Find or create user
	user, err := h.findOrCreateUser(userInfo, provider)
	if err != nil {
		return c.Redirect(http.StatusFound, "/login?error=user_creation_failed&message="+url.QueryEscape(err.Error()))
	}

	// Generate JWT token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"userId":   user.ID,
		"username": user.Username,
		"isAdmin":  user.IsAdmin,
		"iss":      "simplecloudvault",
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
		"iat":      time.Now().Unix(),
	})

	tokenString, err := token.SignedString([]byte(h.jwtSecret))
	if err != nil {
		return c.Redirect(http.StatusFound, "/login?error=token_generation_failed")
	}

	// Log the SSO login
	h.db.Exec(`
		INSERT INTO audit_logs (actor_id, ip_addr, event_type, target_resource, details)
		VALUES ($1, $2, 'sso_login', $3, $4)
	`, user.ID, c.RealIP(), provider.Name, fmt.Sprintf(`{"provider": "%s", "email": "%s"}`, provider.Name, userInfo.Email))

	// Redirect to frontend with token
	return c.Redirect(http.StatusFound, fmt.Sprintf("/login?sso_token=%s", tokenString))
}

// exchangeCodeForToken exchanges the authorization code for an access token
func (h *SSOHandler) exchangeCodeForToken(tokenURL, code, clientID, clientSecret, redirectURI string) (*OIDCTokenResponse, error) {
	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("code", code)
	data.Set("client_id", clientID)
	data.Set("client_secret", clientSecret)
	data.Set("redirect_uri", redirectURI)

	req, err := http.NewRequestWithContext(context.Background(), "POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token exchange failed: %s", string(body))
	}

	var tokenResp OIDCTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, err
	}

	// Debug: log token issuer
	if tokenResp.AccessToken != "" {
		parts := strings.Split(tokenResp.AccessToken, ".")
		if len(parts) >= 2 {
			if payload, err := base64.RawURLEncoding.DecodeString(parts[1]); err == nil {
				fmt.Printf("[SSO DEBUG] Token payload: %s\n", string(payload))
			}
		}
	}

	return &tokenResp, nil
}

// getUserInfo fetches user info from the provider
func (h *SSOHandler) getUserInfo(provider SSOProvider, accessToken string) (*OIDCUserInfo, error) {
	userinfoURL := provider.UserinfoURL
	if userinfoURL == "" {
		switch provider.ProviderType {
		case "google":
			userinfoURL = "https://www.googleapis.com/oauth2/v3/userinfo"
		case "github":
			userinfoURL = "https://api.github.com/user"
		case "azure":
			userinfoURL = "https://graph.microsoft.com/v1.0/me"
		case "oidc":
			if provider.IssuerURL != "" {
				userinfoURL = strings.TrimSuffix(provider.IssuerURL, "/") + "/protocol/openid-connect/userinfo"
			}
		}
	}

	req, err := http.NewRequestWithContext(context.Background(), "GET", userinfoURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("userinfo fetch failed: %s", string(body))
	}

	var userInfo OIDCUserInfo
	if err := json.Unmarshal(body, &userInfo); err != nil {
		return nil, err
	}

	// GitHub uses different field names
	if provider.ProviderType == "github" {
		var githubUser struct {
			ID    int    `json:"id"`
			Login string `json:"login"`
			Email string `json:"email"`
			Name  string `json:"name"`
		}
		json.Unmarshal(body, &githubUser)
		userInfo.Sub = fmt.Sprintf("%d", githubUser.ID)
		userInfo.Name = githubUser.Name
		if userInfo.Name == "" {
			userInfo.Name = githubUser.Login
		}
		// GitHub might not return email in userinfo, need to fetch from /user/emails
		if userInfo.Email == "" && githubUser.Email != "" {
			userInfo.Email = githubUser.Email
		}
	}

	return &userInfo, nil
}

// findOrCreateUser finds an existing user or creates a new one
func (h *SSOHandler) findOrCreateUser(userInfo *OIDCUserInfo, provider SSOProvider) (*User, error) {
	// Try to find existing user by provider ID
	var user User
	err := h.db.QueryRow(`
		SELECT id, username, email, is_admin, is_active
		FROM users
		WHERE provider = $1 AND provider_id = $2
	`, provider.ProviderType, userInfo.Sub).Scan(&user.ID, &user.Username, &user.Email, &user.IsAdmin, &user.IsActive)

	if err == nil {
		// User exists
		if !user.IsActive {
			return nil, fmt.Errorf("user account is disabled")
		}
		// Update user info
		h.db.Exec(`
			UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2
		`, userInfo.Email, user.ID)
		return &user, nil
	}

	if err != sql.ErrNoRows {
		return nil, err
	}

	// Check if auto-create is allowed
	if !provider.AutoCreateUser {
		var autoRegister string
		h.db.QueryRow("SELECT value FROM system_settings WHERE key = 'sso_auto_register'").Scan(&autoRegister)
		if autoRegister != "true" {
			return nil, fmt.Errorf("user not found and auto-registration is disabled")
		}
	}

	// Try to find by email first
	err = h.db.QueryRow(`
		SELECT id, username, email, is_admin, is_active
		FROM users WHERE email = $1
	`, userInfo.Email).Scan(&user.ID, &user.Username, &user.Email, &user.IsAdmin, &user.IsActive)

	if err == nil {
		// User exists with this email, link the SSO account
		h.db.Exec(`
			UPDATE users SET provider = $1, provider_id = $2, updated_at = NOW() WHERE id = $3
		`, provider.ProviderType, userInfo.Sub, user.ID)
		return &user, nil
	}

	// Create new user
	username := h.generateUsername(userInfo.Email, userInfo.Name)
	isAdmin := provider.DefaultAdmin

	// Generate a random password for the SSO user (they won't use it)
	randomPass := make([]byte, 32)
	rand.Read(randomPass)
	passwordHash, _ := bcrypt.GenerateFromPassword(randomPass, bcrypt.DefaultCost)

	err = h.db.QueryRow(`
		INSERT INTO users (username, email, password_hash, provider, provider_id, is_admin, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, true)
		RETURNING id
	`, username, userInfo.Email, string(passwordHash), provider.ProviderType, userInfo.Sub, isAdmin).Scan(&user.ID)

	if err != nil {
		return nil, fmt.Errorf("failed to create user: %v", err)
	}

	user.Username = username
	user.Email = userInfo.Email
	user.IsAdmin = isAdmin
	user.IsActive = true

	// Create user's home directory
	userDir := filepath.Join(h.dataRoot, "users", username)
	os.MkdirAll(userDir, 0755)

	return &user, nil
}

// generateUsername generates a unique username from email or name
func (h *SSOHandler) generateUsername(email, name string) string {
	// Try email prefix first
	base := strings.Split(email, "@")[0]
	base = strings.ToLower(base)
	base = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			return r
		}
		return '_'
	}, base)

	if len(base) < 3 {
		base = "user"
	}
	if len(base) > 20 {
		base = base[:20]
	}

	// Check if username exists
	var exists bool
	h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)", base).Scan(&exists)
	if !exists {
		return base
	}

	// Add suffix
	for i := 1; i < 1000; i++ {
		candidate := fmt.Sprintf("%s%d", base, i)
		h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)", candidate).Scan(&exists)
		if !exists {
			return candidate
		}
	}

	return fmt.Sprintf("%s_%d", base, time.Now().Unix())
}
