package handlers

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
)

// ShareTestContext extends TestContext with share-specific helpers
type ShareTestContext struct {
	*TestContext
	Handler  *ShareHandler
	DataRoot string
}

// SetupShareTest creates a test context for share handler tests
func SetupShareTest(t *testing.T) *ShareTestContext {
	t.Helper()

	tc := SetupTest(t)
	dataRoot := t.TempDir()

	handler := &ShareHandler{
		db:           tc.DB,
		dataRoot:     dataRoot,
		auditHandler: &AuditHandler{db: tc.DB, baseStoragePath: dataRoot},
	}

	return &ShareTestContext{
		TestContext: tc,
		Handler:     handler,
		DataRoot:    dataRoot,
	}
}

// CreateShareTestUser creates a test user directory
func (stc *ShareTestContext) CreateShareTestUser(t *testing.T, username string) string {
	t.Helper()
	userDir := filepath.Join(stc.DataRoot, username)
	if err := os.MkdirAll(userDir, 0755); err != nil {
		t.Fatalf("Failed to create user directory: %v", err)
	}
	return userDir
}

// CreateShareTestFile creates a test file
func (stc *ShareTestContext) CreateShareTestFile(t *testing.T, path string, content []byte) {
	t.Helper()
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("Failed to create directory: %v", err)
	}
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}
}

// =============================================================================
// Create Share Tests
// =============================================================================

func TestCreateShare_Download_Success(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	// Create user and test file
	userDir := stc.CreateShareTestUser(t, "testuser")
	testFilePath := filepath.Join(userDir, "sharefile.txt")
	stc.CreateShareTestFile(t, testFilePath, []byte("shareable content"))

	// Mock share insert
	stc.Mock.ExpectExec("INSERT INTO shares").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Mock audit log
	stc.Mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))

	body := CreateShareRequest{
		Path:      "/sharefile.txt",
		ShareType: "download",
	}
	req, err := NewJSONRequest(http.MethodPost, "/api/shares", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(stc.Echo, stc.Recorder, req, "1", "testuser", false)

	err = stc.Handler.CreateShare(c)
	if err != nil {
		t.Fatalf("CreateShare returned error: %v", err)
	}

	AssertStatus(t, stc.Recorder, http.StatusCreated)

	var resp map[string]interface{}
	if err := ParseJSONResponse(stc.Recorder, &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	// Verify token was generated
	token, ok := resp["token"].(string)
	if !ok || token == "" {
		t.Error("Share token was not generated")
	}
}

func TestCreateShare_WithPassword(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	userDir := stc.CreateShareTestUser(t, "testuser")
	testFilePath := filepath.Join(userDir, "protected.txt")
	stc.CreateShareTestFile(t, testFilePath, []byte("protected content"))

	// Mock share insert
	stc.Mock.ExpectExec("INSERT INTO shares").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Mock audit log
	stc.Mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))

	body := CreateShareRequest{
		Path:      "/protected.txt",
		Password:  "secretpassword",
		ShareType: "download",
	}
	req, err := NewJSONRequest(http.MethodPost, "/api/shares", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(stc.Echo, stc.Recorder, req, "1", "testuser", false)

	err = stc.Handler.CreateShare(c)
	if err != nil {
		t.Fatalf("CreateShare returned error: %v", err)
	}

	AssertStatus(t, stc.Recorder, http.StatusCreated)

	var resp map[string]interface{}
	if err := ParseJSONResponse(stc.Recorder, &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	// Verify has_password flag
	hasPassword, ok := resp["hasPassword"].(bool)
	if !ok || !hasPassword {
		t.Error("hasPassword should be true for password-protected share")
	}
}

func TestCreateShare_WithExpiration(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	userDir := stc.CreateShareTestUser(t, "testuser")
	testFilePath := filepath.Join(userDir, "expiring.txt")
	stc.CreateShareTestFile(t, testFilePath, []byte("expiring content"))

	// Mock share insert
	stc.Mock.ExpectExec("INSERT INTO shares").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Mock audit log
	stc.Mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))

	body := CreateShareRequest{
		Path:      "/expiring.txt",
		ExpiresIn: 3600, // 1 hour
		ShareType: "download",
	}
	req, err := NewJSONRequest(http.MethodPost, "/api/shares", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(stc.Echo, stc.Recorder, req, "1", "testuser", false)

	err = stc.Handler.CreateShare(c)
	if err != nil {
		t.Fatalf("CreateShare returned error: %v", err)
	}

	AssertStatus(t, stc.Recorder, http.StatusCreated)

	var resp map[string]interface{}
	if err := ParseJSONResponse(stc.Recorder, &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	// Verify expiration is set
	expiresAt, ok := resp["expiresAt"].(string)
	if !ok || expiresAt == "" {
		t.Error("expiresAt should be set for expiring share")
	}
}

func TestCreateShare_WithMaxAccess(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	userDir := stc.CreateShareTestUser(t, "testuser")
	testFilePath := filepath.Join(userDir, "limited.txt")
	stc.CreateShareTestFile(t, testFilePath, []byte("limited access content"))

	// Mock share insert
	stc.Mock.ExpectExec("INSERT INTO shares").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Mock audit log
	stc.Mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))

	body := CreateShareRequest{
		Path:      "/limited.txt",
		MaxAccess: 5,
		ShareType: "download",
	}
	req, err := NewJSONRequest(http.MethodPost, "/api/shares", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(stc.Echo, stc.Recorder, req, "1", "testuser", false)

	err = stc.Handler.CreateShare(c)
	if err != nil {
		t.Fatalf("CreateShare returned error: %v", err)
	}

	AssertStatus(t, stc.Recorder, http.StatusCreated)

	var resp map[string]interface{}
	if err := ParseJSONResponse(stc.Recorder, &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	// Verify max access is set
	maxAccess, ok := resp["maxAccess"].(float64)
	if !ok || int(maxAccess) != 5 {
		t.Errorf("maxAccess should be 5, got %v", resp["maxAccess"])
	}
}

func TestCreateShare_FileNotFound(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	stc.CreateShareTestUser(t, "testuser")

	body := CreateShareRequest{
		Path:      "/nonexistent.txt",
		ShareType: "download",
	}
	req, err := NewJSONRequest(http.MethodPost, "/api/shares", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(stc.Echo, stc.Recorder, req, "1", "testuser", false)

	err = stc.Handler.CreateShare(c)
	if err != nil {
		t.Fatalf("CreateShare returned error: %v", err)
	}

	AssertStatus(t, stc.Recorder, http.StatusNotFound)
}

func TestCreateShare_PathTraversal_Blocked(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	stc.CreateShareTestUser(t, "testuser")

	body := CreateShareRequest{
		Path:      "/../../../etc/passwd",
		ShareType: "download",
	}
	req, err := NewJSONRequest(http.MethodPost, "/api/shares", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(stc.Echo, stc.Recorder, req, "1", "testuser", false)

	err = stc.Handler.CreateShare(c)
	if err != nil {
		t.Fatalf("CreateShare returned error: %v", err)
	}

	// Should be blocked (not 201 Created)
	if stc.Recorder.Code == http.StatusCreated {
		t.Error("Path traversal attack was not blocked")
	}
}

// =============================================================================
// Access Share Tests
// =============================================================================

func TestAccessShare_Valid(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	// Create test file
	userDir := stc.CreateShareTestUser(t, "testuser")
	testFilePath := filepath.Join(userDir, "shared.txt")
	stc.CreateShareTestFile(t, testFilePath, []byte("shared content"))

	token := "valid-share-token"

	// Mock share query
	rows := sqlmock.NewRows([]string{
		"id", "token", "path", "created_by", "created_at", "expires_at",
		"password_hash", "access_count", "max_access", "is_active",
		"require_login", "share_type", "editable", "max_file_size",
		"allowed_extensions", "upload_count", "max_total_size", "total_uploaded_size",
	}).AddRow(
		1, token, "/shared.txt", "testuser", time.Now(), nil,
		nil, 0, nil, true,
		false, "download", false, nil,
		nil, 0, nil, 0,
	)
	stc.Mock.ExpectQuery("SELECT .* FROM shares WHERE token").
		WithArgs(token).
		WillReturnRows(rows)

	// Mock access count update
	stc.Mock.ExpectExec("UPDATE shares SET access_count").
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := httptest.NewRequest(http.MethodGet, "/api/s/"+token, nil)
	rec := httptest.NewRecorder()
	c := stc.Echo.NewContext(req, rec)
	c.SetParamNames("token")
	c.SetParamValues(token)

	err := stc.Handler.AccessShare(c)
	if err != nil {
		t.Fatalf("AccessShare returned error: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}
}

func TestAccessShare_Expired(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	userDir := stc.CreateShareTestUser(t, "testuser")
	testFilePath := filepath.Join(userDir, "expired.txt")
	stc.CreateShareTestFile(t, testFilePath, []byte("expired content"))

	token := "expired-share-token"
	expiredTime := time.Now().Add(-24 * time.Hour) // Expired yesterday

	// Mock share query with expired timestamp
	rows := sqlmock.NewRows([]string{
		"id", "token", "path", "created_by", "created_at", "expires_at",
		"password_hash", "access_count", "max_access", "is_active",
		"require_login", "share_type", "editable", "max_file_size",
		"allowed_extensions", "upload_count", "max_total_size", "total_uploaded_size",
	}).AddRow(
		1, token, "/expired.txt", "testuser", time.Now().Add(-48*time.Hour), expiredTime,
		nil, 5, nil, true,
		false, "download", false, nil,
		nil, 0, nil, 0,
	)
	stc.Mock.ExpectQuery("SELECT .* FROM shares WHERE token").
		WithArgs(token).
		WillReturnRows(rows)

	req := httptest.NewRequest(http.MethodGet, "/api/s/"+token, nil)
	rec := httptest.NewRecorder()
	c := stc.Echo.NewContext(req, rec)
	c.SetParamNames("token")
	c.SetParamValues(token)

	err := stc.Handler.AccessShare(c)
	if err != nil {
		t.Fatalf("AccessShare returned error: %v", err)
	}

	// Should return 410 Gone or 403 Forbidden for expired share
	if rec.Code != http.StatusGone && rec.Code != http.StatusForbidden {
		t.Errorf("Expected status 410 or 403 for expired share, got %d", rec.Code)
	}
}

func TestAccessShare_MaxAccessReached(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	userDir := stc.CreateShareTestUser(t, "testuser")
	testFilePath := filepath.Join(userDir, "limited.txt")
	stc.CreateShareTestFile(t, testFilePath, []byte("limited content"))

	token := "limited-share-token"

	// Mock share query with max access reached
	rows := sqlmock.NewRows([]string{
		"id", "token", "path", "created_by", "created_at", "expires_at",
		"password_hash", "access_count", "max_access", "is_active",
		"require_login", "share_type", "editable", "max_file_size",
		"allowed_extensions", "upload_count", "max_total_size", "total_uploaded_size",
	}).AddRow(
		1, token, "/limited.txt", "testuser", time.Now(), nil,
		nil, 5, 5, true, // access_count == max_access
		false, "download", false, nil,
		nil, 0, nil, 0,
	)
	stc.Mock.ExpectQuery("SELECT .* FROM shares WHERE token").
		WithArgs(token).
		WillReturnRows(rows)

	req := httptest.NewRequest(http.MethodGet, "/api/s/"+token, nil)
	rec := httptest.NewRecorder()
	c := stc.Echo.NewContext(req, rec)
	c.SetParamNames("token")
	c.SetParamValues(token)

	err := stc.Handler.AccessShare(c)
	if err != nil {
		t.Fatalf("AccessShare returned error: %v", err)
	}

	// Should return 410 Gone or 403 Forbidden
	if rec.Code != http.StatusGone && rec.Code != http.StatusForbidden {
		t.Errorf("Expected status 410 or 403 for max access reached, got %d", rec.Code)
	}
}

func TestAccessShare_NotFound(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	token := "nonexistent-token"

	// Mock share query returning no rows
	stc.Mock.ExpectQuery("SELECT .* FROM shares WHERE token").
		WithArgs(token).
		WillReturnError(sql.ErrNoRows)

	req := httptest.NewRequest(http.MethodGet, "/api/s/"+token, nil)
	rec := httptest.NewRecorder()
	c := stc.Echo.NewContext(req, rec)
	c.SetParamNames("token")
	c.SetParamValues(token)

	err := stc.Handler.AccessShare(c)
	if err != nil {
		t.Fatalf("AccessShare returned error: %v", err)
	}

	AssertStatus(t, rec, http.StatusNotFound)
}

func TestAccessShare_PasswordRequired(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	userDir := stc.CreateShareTestUser(t, "testuser")
	testFilePath := filepath.Join(userDir, "protected.txt")
	stc.CreateShareTestFile(t, testFilePath, []byte("protected content"))

	token := "protected-share-token"
	// bcrypt hash of "secretpassword"
	passwordHash := "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZRGdjGj/n3.aL4RtILN7K2CTXyVWi"

	// Mock share query with password
	rows := sqlmock.NewRows([]string{
		"id", "token", "path", "created_by", "created_at", "expires_at",
		"password_hash", "access_count", "max_access", "is_active",
		"require_login", "share_type", "editable", "max_file_size",
		"allowed_extensions", "upload_count", "max_total_size", "total_uploaded_size",
	}).AddRow(
		1, token, "/protected.txt", "testuser", time.Now(), nil,
		passwordHash, 0, nil, true,
		false, "download", false, nil,
		nil, 0, nil, 0,
	)
	stc.Mock.ExpectQuery("SELECT .* FROM shares WHERE token").
		WithArgs(token).
		WillReturnRows(rows)

	// Access without password
	req := httptest.NewRequest(http.MethodGet, "/api/s/"+token, nil)
	rec := httptest.NewRecorder()
	c := stc.Echo.NewContext(req, rec)
	c.SetParamNames("token")
	c.SetParamValues(token)

	err := stc.Handler.AccessShare(c)
	if err != nil {
		t.Fatalf("AccessShare returned error: %v", err)
	}

	var resp map[string]interface{}
	if err := ParseJSONResponse(rec, &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	// Should indicate password is required
	requiresPassword, _ := resp["requiresPassword"].(bool)
	if !requiresPassword {
		t.Error("Expected requiresPassword to be true")
	}
}

// =============================================================================
// List Shares Tests
// =============================================================================

func TestListShares_Success(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	// Mock shares query
	rows := sqlmock.NewRows([]string{
		"id", "token", "path", "created_by", "created_at", "expires_at",
		"password_hash", "access_count", "max_access", "is_active",
		"require_login", "share_type", "editable", "max_file_size",
		"allowed_extensions", "upload_count", "max_total_size", "total_uploaded_size",
	}).
		AddRow(1, "token1", "/file1.txt", "testuser", time.Now(), nil, nil, 5, nil, true, false, "download", false, nil, nil, 0, nil, 0).
		AddRow(2, "token2", "/file2.txt", "testuser", time.Now(), nil, nil, 10, nil, true, false, "download", false, nil, nil, 0, nil, 0)

	stc.Mock.ExpectQuery("SELECT .* FROM shares WHERE created_by").
		WithArgs("testuser").
		WillReturnRows(rows)

	req := httptest.NewRequest(http.MethodGet, "/api/shares", nil)
	c := CreateAuthenticatedContext(stc.Echo, stc.Recorder, req, "1", "testuser", false)

	err := stc.Handler.ListShares(c)
	if err != nil {
		t.Fatalf("ListShares returned error: %v", err)
	}

	AssertStatus(t, stc.Recorder, http.StatusOK)

	var resp []map[string]interface{}
	if err := ParseJSONResponse(stc.Recorder, &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if len(resp) != 2 {
		t.Errorf("Expected 2 shares, got %d", len(resp))
	}
}

func TestListShares_Empty(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	// Mock empty shares query
	rows := sqlmock.NewRows([]string{
		"id", "token", "path", "created_by", "created_at", "expires_at",
		"password_hash", "access_count", "max_access", "is_active",
		"require_login", "share_type", "editable", "max_file_size",
		"allowed_extensions", "upload_count", "max_total_size", "total_uploaded_size",
	})

	stc.Mock.ExpectQuery("SELECT .* FROM shares WHERE created_by").
		WithArgs("testuser").
		WillReturnRows(rows)

	req := httptest.NewRequest(http.MethodGet, "/api/shares", nil)
	c := CreateAuthenticatedContext(stc.Echo, stc.Recorder, req, "1", "testuser", false)

	err := stc.Handler.ListShares(c)
	if err != nil {
		t.Fatalf("ListShares returned error: %v", err)
	}

	AssertStatus(t, stc.Recorder, http.StatusOK)

	var resp []map[string]interface{}
	if err := ParseJSONResponse(stc.Recorder, &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if len(resp) != 0 {
		t.Errorf("Expected 0 shares, got %d", len(resp))
	}
}

// =============================================================================
// Delete Share Tests
// =============================================================================

func TestDeleteShare_Success(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	shareID := "1"

	// Mock share existence check
	stc.Mock.ExpectQuery("SELECT id FROM shares WHERE id").
		WithArgs(shareID, "testuser").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))

	// Mock delete
	stc.Mock.ExpectExec("DELETE FROM shares WHERE id").
		WithArgs(shareID).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Mock audit log
	stc.Mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := httptest.NewRequest(http.MethodDelete, "/api/shares/"+shareID, nil)
	c := CreateAuthenticatedContext(stc.Echo, stc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("id")
	c.SetParamValues(shareID)

	err := stc.Handler.DeleteShare(c)
	if err != nil {
		t.Fatalf("DeleteShare returned error: %v", err)
	}

	AssertStatus(t, stc.Recorder, http.StatusOK)
}

func TestDeleteShare_NotFound(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	shareID := "999"

	// Mock share not found
	stc.Mock.ExpectQuery("SELECT id FROM shares WHERE id").
		WithArgs(shareID, "testuser").
		WillReturnError(sql.ErrNoRows)

	req := httptest.NewRequest(http.MethodDelete, "/api/shares/"+shareID, nil)
	c := CreateAuthenticatedContext(stc.Echo, stc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("id")
	c.SetParamValues(shareID)

	err := stc.Handler.DeleteShare(c)
	if err != nil {
		t.Fatalf("DeleteShare returned error: %v", err)
	}

	AssertStatus(t, stc.Recorder, http.StatusNotFound)
}

func TestDeleteShare_NotOwner(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	shareID := "1"

	// Mock share exists but belongs to different user
	stc.Mock.ExpectQuery("SELECT id FROM shares WHERE id").
		WithArgs(shareID, "testuser").
		WillReturnError(sql.ErrNoRows)

	req := httptest.NewRequest(http.MethodDelete, "/api/shares/"+shareID, nil)
	c := CreateAuthenticatedContext(stc.Echo, stc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("id")
	c.SetParamValues(shareID)

	err := stc.Handler.DeleteShare(c)
	if err != nil {
		t.Fatalf("DeleteShare returned error: %v", err)
	}

	// Should return 404 (not revealing that share exists but belongs to someone else)
	AssertStatus(t, stc.Recorder, http.StatusNotFound)
}

// =============================================================================
// Upload Share Tests
// =============================================================================

func TestCreateShare_Upload_Success(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	// Create user and folder for uploads
	userDir := stc.CreateShareTestUser(t, "testuser")
	uploadFolder := filepath.Join(userDir, "uploads")
	if err := os.MkdirAll(uploadFolder, 0755); err != nil {
		t.Fatalf("Failed to create upload folder: %v", err)
	}

	// Mock share insert
	stc.Mock.ExpectExec("INSERT INTO shares").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Mock audit log
	stc.Mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))

	body := CreateShareRequest{
		Path:              "/uploads",
		ShareType:         "upload",
		MaxFileSize:       10485760, // 10MB
		AllowedExtensions: "pdf,doc,docx",
		MaxTotalSize:      104857600, // 100MB
	}
	req, err := NewJSONRequest(http.MethodPost, "/api/shares", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(stc.Echo, stc.Recorder, req, "1", "testuser", false)

	err = stc.Handler.CreateShare(c)
	if err != nil {
		t.Fatalf("CreateShare returned error: %v", err)
	}

	AssertStatus(t, stc.Recorder, http.StatusCreated)

	var resp map[string]interface{}
	if err := ParseJSONResponse(stc.Recorder, &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	// Verify share type
	shareType, ok := resp["shareType"].(string)
	if !ok || shareType != "upload" {
		t.Errorf("Expected shareType 'upload', got '%v'", resp["shareType"])
	}
}

// =============================================================================
// Editable Share Tests (OnlyOffice)
// =============================================================================

func TestCreateShare_Editable_Success(t *testing.T) {
	stc := SetupShareTest(t)
	defer stc.Cleanup()

	// Create user and office document
	userDir := stc.CreateShareTestUser(t, "testuser")
	docPath := filepath.Join(userDir, "document.docx")
	stc.CreateShareTestFile(t, docPath, []byte("office document content"))

	// Mock share insert
	stc.Mock.ExpectExec("INSERT INTO shares").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Mock audit log
	stc.Mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))

	body := CreateShareRequest{
		Path:      "/document.docx",
		ShareType: "download",
		Editable:  true,
	}
	req, err := NewJSONRequest(http.MethodPost, "/api/shares", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(stc.Echo, stc.Recorder, req, "1", "testuser", false)

	err = stc.Handler.CreateShare(c)
	if err != nil {
		t.Fatalf("CreateShare returned error: %v", err)
	}

	AssertStatus(t, stc.Recorder, http.StatusCreated)

	var resp map[string]interface{}
	if err := ParseJSONResponse(stc.Recorder, &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	// Verify editable flag
	editable, ok := resp["editable"].(bool)
	if !ok || !editable {
		t.Error("Expected editable to be true")
	}
}
