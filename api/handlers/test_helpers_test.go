package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
)

// TestContext holds common test dependencies
type TestContext struct {
	DB       *sql.DB
	Mock     sqlmock.Sqlmock
	Echo     *echo.Echo
	Recorder *httptest.ResponseRecorder
}

// SetupTest creates a new test context with mocked database
func SetupTest(t *testing.T) *TestContext {
	t.Helper()

	// Set JWT secret for tests
	os.Setenv("JWT_SECRET", "test-jwt-secret-for-testing-only-32chars")

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("Failed to create sqlmock: %v", err)
	}

	e := echo.New()
	rec := httptest.NewRecorder()

	return &TestContext{
		DB:       db,
		Mock:     mock,
		Echo:     e,
		Recorder: rec,
	}
}

// Cleanup closes the database connection
func (tc *TestContext) Cleanup() {
	tc.DB.Close()
}

// NewJSONRequest creates a new HTTP request with JSON body
func NewJSONRequest(method, path string, body interface{}) (*http.Request, error) {
	var bodyReader *bytes.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(jsonBody)
	} else {
		bodyReader = bytes.NewReader([]byte{})
	}

	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	return req, nil
}

// ParseJSONResponse parses the response body as JSON
func ParseJSONResponse(rec *httptest.ResponseRecorder, v interface{}) error {
	return json.Unmarshal(rec.Body.Bytes(), v)
}

// AssertStatus checks if the response status code matches expected
func AssertStatus(t *testing.T, rec *httptest.ResponseRecorder, expected int) {
	t.Helper()
	if rec.Code != expected {
		t.Errorf("Expected status %d, got %d. Body: %s", expected, rec.Code, rec.Body.String())
	}
}

// AssertJSONError checks if the response contains an error field with expected message
func AssertJSONError(t *testing.T, rec *httptest.ResponseRecorder, expectedError string) {
	t.Helper()
	var resp map[string]interface{}
	if err := ParseJSONResponse(rec, &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	errMsg, ok := resp["error"].(string)
	if !ok {
		t.Errorf("Response does not contain 'error' field. Response: %v", resp)
		return
	}

	if errMsg != expectedError {
		t.Errorf("Expected error '%s', got '%s'", expectedError, errMsg)
	}
}

// CreateTestAuthHandler creates an AuthHandler with mocked database
func CreateTestAuthHandler(db *sql.DB) *AuthHandler {
	// Ensure shared secret is set
	if sharedJWTSecret == nil {
		sharedJWTSecret = []byte("test-jwt-secret-for-testing-only-32chars")
	}

	return &AuthHandler{
		db:           db,
		jwtSecret:    []byte("test-jwt-secret-for-testing-only-32chars"),
		dataRoot:     "/tmp/test-data",
		configPath:   "/tmp/test-config",
		auditHandler: &AuditHandler{db: db, baseStoragePath: "/tmp/test-data"},
	}
}

// CreateAuthenticatedContext creates an echo.Context with JWT claims set
func CreateAuthenticatedContext(e *echo.Echo, rec *httptest.ResponseRecorder, req *http.Request, userID, username string, isAdmin bool) echo.Context {
	c := e.NewContext(req, rec)
	claims := &JWTClaims{
		UserID:   userID,
		Username: username,
		IsAdmin:  isAdmin,
	}
	c.Set("user", claims)
	return c
}
