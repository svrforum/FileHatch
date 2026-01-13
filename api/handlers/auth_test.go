package handlers

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

func TestLogin_Success(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := CreateTestAuthHandler(tc.DB)

	// Create password hash
	passwordHash, _ := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.DefaultCost)

	// Mock database query
	rows := sqlmock.NewRows([]string{
		"id", "username", "email", "password_hash", "smb_hash", "provider",
		"is_admin", "is_active", "totp_enabled", "created_at", "updated_at",
	}).AddRow(
		"user-123", "testuser", "test@example.com", string(passwordHash), nil, "local",
		false, true, false, time.Now(), time.Now(),
	)

	tc.Mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, username, email, password_hash, smb_hash, provider, is_admin, is_active`)).
		WithArgs("testuser").
		WillReturnRows(rows)

	// Create request
	req, _ := NewJSONRequest(http.MethodPost, "/api/auth/login", map[string]string{
		"username": "testuser",
		"password": "password123",
	})

	c := tc.Echo.NewContext(req, tc.Recorder)

	// Call handler
	err := handler.Login(c)
	if err != nil {
		t.Fatalf("Login handler returned error: %v", err)
	}

	AssertStatus(t, tc.Recorder, http.StatusOK)

	// Verify response contains token
	var resp LoginResponse
	if err := ParseJSONResponse(tc.Recorder, &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if resp.Token == "" {
		t.Error("Expected token in response, got empty string")
	}

	if resp.User.Username != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", resp.User.Username)
	}
}

func TestLogin_InvalidPassword(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := CreateTestAuthHandler(tc.DB)

	// Create password hash for different password
	passwordHash, _ := bcrypt.GenerateFromPassword([]byte("correctpassword"), bcrypt.DefaultCost)

	rows := sqlmock.NewRows([]string{
		"id", "username", "email", "password_hash", "smb_hash", "provider",
		"is_admin", "is_active", "totp_enabled", "created_at", "updated_at",
	}).AddRow(
		"user-123", "testuser", "test@example.com", string(passwordHash), nil, "local",
		false, true, false, time.Now(), time.Now(),
	)

	tc.Mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, username, email, password_hash, smb_hash, provider, is_admin, is_active`)).
		WithArgs("testuser").
		WillReturnRows(rows)

	req, _ := NewJSONRequest(http.MethodPost, "/api/auth/login", map[string]string{
		"username": "testuser",
		"password": "wrongpassword",
	})

	c := tc.Echo.NewContext(req, tc.Recorder)

	handler.Login(c)

	AssertStatus(t, tc.Recorder, http.StatusUnauthorized)
	AssertJSONError(t, tc.Recorder, "Invalid username or password")
}

func TestLogin_UserNotFound(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := CreateTestAuthHandler(tc.DB)

	tc.Mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, username, email, password_hash, smb_hash, provider, is_admin, is_active`)).
		WithArgs("nonexistent").
		WillReturnError(sql.ErrNoRows)

	req, _ := NewJSONRequest(http.MethodPost, "/api/auth/login", map[string]string{
		"username": "nonexistent",
		"password": "password123",
	})

	c := tc.Echo.NewContext(req, tc.Recorder)

	handler.Login(c)

	AssertStatus(t, tc.Recorder, http.StatusUnauthorized)
	AssertJSONError(t, tc.Recorder, "Invalid username or password")
}

func TestLogin_EmptyCredentials(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := CreateTestAuthHandler(tc.DB)

	req, _ := NewJSONRequest(http.MethodPost, "/api/auth/login", map[string]string{
		"username": "",
		"password": "",
	})

	c := tc.Echo.NewContext(req, tc.Recorder)

	handler.Login(c)

	AssertStatus(t, tc.Recorder, http.StatusBadRequest)
	AssertJSONError(t, tc.Recorder, "Username and password are required")
}

func TestLogin_DisabledAccount(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := CreateTestAuthHandler(tc.DB)

	passwordHash, _ := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.DefaultCost)

	rows := sqlmock.NewRows([]string{
		"id", "username", "email", "password_hash", "smb_hash", "provider",
		"is_admin", "is_active", "totp_enabled", "created_at", "updated_at",
	}).AddRow(
		"user-123", "testuser", "test@example.com", string(passwordHash), nil, "local",
		false, false, false, time.Now(), time.Now(), // is_active = false
	)

	tc.Mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, username, email, password_hash, smb_hash, provider, is_admin, is_active`)).
		WithArgs("testuser").
		WillReturnRows(rows)

	req, _ := NewJSONRequest(http.MethodPost, "/api/auth/login", map[string]string{
		"username": "testuser",
		"password": "password123",
	})

	c := tc.Echo.NewContext(req, tc.Recorder)

	handler.Login(c)

	AssertStatus(t, tc.Recorder, http.StatusForbidden)
	AssertJSONError(t, tc.Recorder, "Account is disabled")
}

func TestRegister_Success(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := CreateTestAuthHandler(tc.DB)

	// Mock: check username doesn't exist
	tc.Mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)`)).
		WithArgs("newuser").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	// Mock: insert user
	tc.Mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO users`)).
		WithArgs("newuser", "new@example.com", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("new-user-id"))

	req, _ := NewJSONRequest(http.MethodPost, "/api/auth/register", map[string]string{
		"username": "newuser",
		"email":    "new@example.com",
		"password": "Password123!",
	})

	c := tc.Echo.NewContext(req, tc.Recorder)

	handler.Register(c)

	AssertStatus(t, tc.Recorder, http.StatusCreated)

	var resp map[string]interface{}
	ParseJSONResponse(tc.Recorder, &resp)

	if resp["success"] != true {
		t.Error("Expected success: true")
	}
}

func TestRegister_ShortUsername(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := CreateTestAuthHandler(tc.DB)

	req, _ := NewJSONRequest(http.MethodPost, "/api/auth/register", map[string]string{
		"username": "ab",
		"email":    "test@example.com",
		"password": "Password123!",
	})

	c := tc.Echo.NewContext(req, tc.Recorder)

	handler.Register(c)

	AssertStatus(t, tc.Recorder, http.StatusBadRequest)
	AssertJSONError(t, tc.Recorder, "Username must be between 3 and 50 characters")
}

func TestRegister_ShortPassword(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := CreateTestAuthHandler(tc.DB)

	req, _ := NewJSONRequest(http.MethodPost, "/api/auth/register", map[string]string{
		"username": "validuser",
		"email":    "test@example.com",
		"password": "short",
	})

	c := tc.Echo.NewContext(req, tc.Recorder)

	handler.Register(c)

	AssertStatus(t, tc.Recorder, http.StatusBadRequest)
	AssertJSONError(t, tc.Recorder, "password must be at least 8 characters")
}

func TestRegister_DuplicateUsername(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := CreateTestAuthHandler(tc.DB)

	// Mock: username already exists
	tc.Mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)`)).
		WithArgs("existinguser").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	req, _ := NewJSONRequest(http.MethodPost, "/api/auth/register", map[string]string{
		"username": "existinguser",
		"email":    "test@example.com",
		"password": "Password123!",
	})

	c := tc.Echo.NewContext(req, tc.Recorder)

	handler.Register(c)

	AssertStatus(t, tc.Recorder, http.StatusConflict)
	AssertJSONError(t, tc.Recorder, "Username already exists")
}

func TestGetProfile_Success(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := CreateTestAuthHandler(tc.DB)

	// Mock database query for user profile (matching auth.go GetProfile query)
	rows := sqlmock.NewRows([]string{
		"id", "username", "email", "smb_hash", "provider", "is_admin", "is_active",
		"totp_enabled", "created_at", "updated_at",
	}).AddRow(
		"user-123", "testuser", "test@example.com", nil, "local", false, true,
		false, time.Now(), time.Now(),
	)

	tc.Mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, username, email, smb_hash, provider, is_admin, is_active`)).
		WithArgs("user-123").
		WillReturnRows(rows)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/profile", nil)
	rec := httptest.NewRecorder()

	c := CreateAuthenticatedContext(tc.Echo, rec, req, "user-123", "testuser", false)

	handler.GetProfile(c)

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}
}

func TestGenerateJWT(t *testing.T) {
	// Ensure shared secret is set
	sharedJWTSecret = []byte("test-jwt-secret-for-testing-only-32chars")

	token, err := GenerateJWT("user-123", "testuser", true)
	if err != nil {
		t.Fatalf("GenerateJWT failed: %v", err)
	}

	if token == "" {
		t.Error("Expected non-empty token")
	}

	// Validate the token
	parsedToken, err := ValidateJWTToken(token)
	if err != nil {
		t.Fatalf("ValidateJWTToken failed: %v", err)
	}

	claims, ok := parsedToken.Claims.(*JWTClaims)
	if !ok {
		t.Fatal("Failed to get claims from token")
	}

	if claims.UserID != "user-123" {
		t.Errorf("Expected userID 'user-123', got '%s'", claims.UserID)
	}

	if claims.Username != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", claims.Username)
	}

	if !claims.IsAdmin {
		t.Error("Expected isAdmin to be true")
	}
}

func TestJWTMiddleware_ValidToken(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := CreateTestAuthHandler(tc.DB)

	// Generate a valid token
	token, _ := GenerateJWT("user-123", "testuser", false)

	// Create a test handler that checks if user is set
	testHandler := func(c echo.Context) error {
		claims := c.Get("user").(*JWTClaims)
		if claims.UserID != "user-123" {
			return c.JSON(http.StatusInternalServerError, "wrong user")
		}
		return c.JSON(http.StatusOK, "ok")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	c := tc.Echo.NewContext(req, rec)

	// Apply middleware and call handler
	middlewareFunc := handler.JWTMiddleware(testHandler)
	middlewareFunc(c)

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}
}

func TestJWTMiddleware_NoToken(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := CreateTestAuthHandler(tc.DB)

	testHandler := func(c echo.Context) error {
		return c.JSON(http.StatusOK, "ok")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	rec := httptest.NewRecorder()

	c := tc.Echo.NewContext(req, rec)

	middlewareFunc := handler.JWTMiddleware(testHandler)
	middlewareFunc(c)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", rec.Code)
	}
}

func TestJWTMiddleware_InvalidToken(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := CreateTestAuthHandler(tc.DB)

	testHandler := func(c echo.Context) error {
		return c.JSON(http.StatusOK, "ok")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")
	rec := httptest.NewRecorder()

	c := tc.Echo.NewContext(req, rec)

	middlewareFunc := handler.JWTMiddleware(testHandler)
	middlewareFunc(c)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", rec.Code)
	}
}
