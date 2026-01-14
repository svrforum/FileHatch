package handlers

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// FileTestContext extends TestContext with file-specific helpers
type FileTestContext struct {
	*TestContext
	Handler  *Handler
	DataRoot string
}

// SetupFileTest creates a test context for file handler tests
func SetupFileTest(t *testing.T) *FileTestContext {
	t.Helper()

	tc := SetupTest(t)

	// Create temp data directory
	dataRoot := t.TempDir()

	handler := &Handler{
		db:           tc.DB,
		dataRoot:     dataRoot,
		auditHandler: &AuditHandler{db: tc.DB, baseStoragePath: dataRoot},
	}

	return &FileTestContext{
		TestContext: tc,
		Handler:     handler,
		DataRoot:    dataRoot,
	}
}

// CreateTestUser creates a test user directory structure (proper path: {dataRoot}/users/{username})
func (ftc *FileTestContext) CreateTestUser(t *testing.T, username string) string {
	t.Helper()
	userDir := filepath.Join(ftc.DataRoot, "users", username)
	if err := os.MkdirAll(userDir, 0755); err != nil {
		t.Fatalf("Failed to create user directory: %v", err)
	}
	return userDir
}

// CreateTestFile creates a test file with content
func (ftc *FileTestContext) CreateTestFile(t *testing.T, path string, content []byte) {
	t.Helper()
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("Failed to create directory: %v", err)
	}
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}
}

// CreateTestFolder creates a test folder
func (ftc *FileTestContext) CreateTestFolder(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0755); err != nil {
		t.Fatalf("Failed to create test folder: %v", err)
	}
}

// =============================================================================
// Folder Creation Tests
// =============================================================================

func TestCreateFolder_Success(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	// Create user directory
	userDir := ftc.CreateTestUser(t, "testuser")

	// Mock audit log insert
	ftc.Mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Create request - use /home path which maps to user's home directory
	body := CreateFolderRequest{
		Path: "/home",
		Name: "newfolder",
	}
	req, err := NewJSONRequest(http.MethodPost, "/api/folders", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	// Create authenticated context
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)

	// Execute
	err = ftc.Handler.CreateFolder(c)
	if err != nil {
		t.Fatalf("CreateFolder returned error: %v", err)
	}

	// Verify status
	AssertStatus(t, ftc.Recorder, http.StatusCreated)

	// Verify folder was created
	folderPath := filepath.Join(userDir, "newfolder")
	if _, err := os.Stat(folderPath); os.IsNotExist(err) {
		t.Errorf("Folder was not created at %s", folderPath)
	}
}

func TestCreateFolder_AlreadyExists(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	// Create user directory and existing folder
	userDir := ftc.CreateTestUser(t, "testuser")
	ftc.CreateTestFolder(t, filepath.Join(userDir, "existingfolder"))

	// Create request for same folder - use /home path
	body := CreateFolderRequest{
		Path: "/home",
		Name: "existingfolder",
	}
	req, err := NewJSONRequest(http.MethodPost, "/api/folders", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)

	// Execute
	err = ftc.Handler.CreateFolder(c)
	if err != nil {
		t.Fatalf("CreateFolder returned error: %v", err)
	}

	// Should return conflict or bad request
	if ftc.Recorder.Code != http.StatusConflict && ftc.Recorder.Code != http.StatusBadRequest {
		t.Errorf("Expected status 409 or 400, got %d", ftc.Recorder.Code)
	}
}

func TestCreateFolder_PathTraversal_Blocked(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	ftc.CreateTestUser(t, "testuser")

	// Try path traversal attack
	body := CreateFolderRequest{
		Path: "/../../../etc",
		Name: "evil",
	}
	req, err := NewJSONRequest(http.MethodPost, "/api/folders", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)

	// Execute
	err = ftc.Handler.CreateFolder(c)
	if err != nil {
		t.Fatalf("CreateFolder returned error: %v", err)
	}

	// Should be blocked
	if ftc.Recorder.Code == http.StatusCreated {
		t.Error("Path traversal attack was not blocked")
	}
}

func TestCreateFolder_InvalidName(t *testing.T) {
	testCases := []struct {
		name     string
		folder   string
		expected string
	}{
		{"Empty name", "", "empty"},
		{"Dot only", ".", "invalid"},
		{"Double dot", "..", "invalid"},
		{"Contains slash", "foo/bar", "invalid"},
		{"Contains backslash", "foo\\bar", "invalid"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			ftc := SetupFileTest(t)
			defer ftc.Cleanup()

			ftc.CreateTestUser(t, "testuser")

			body := CreateFolderRequest{
				Path: "/home",
				Name: tc.folder,
			}
			req, err := NewJSONRequest(http.MethodPost, "/api/folders", body)
			if err != nil {
				t.Fatalf("Failed to create request: %v", err)
			}

			c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)

			err = ftc.Handler.CreateFolder(c)
			if err != nil {
				t.Fatalf("CreateFolder returned error: %v", err)
			}

			// Should be rejected
			if ftc.Recorder.Code == http.StatusCreated {
				t.Errorf("Invalid folder name '%s' was accepted", tc.folder)
			}
		})
	}
}

// =============================================================================
// File Check Tests
// =============================================================================

func TestCheckFileExists_Exists(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	// Create user and test file
	userDir := ftc.CreateTestUser(t, "testuser")
	testFilePath := filepath.Join(userDir, "testfile.txt")
	ftc.CreateTestFile(t, testFilePath, []byte("test content"))

	// Create request with correct query params: path=/home and filename=testfile.txt
	req := httptest.NewRequest(http.MethodGet, "/api/files/check?path=/home&filename=testfile.txt", nil)
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)

	// Execute
	err := ftc.Handler.CheckFileExists(c)
	if err != nil {
		t.Fatalf("CheckFileExists returned error: %v", err)
	}

	// Verify
	AssertStatus(t, ftc.Recorder, http.StatusOK)

	var resp map[string]any
	if err := ParseJSONResponse(ftc.Recorder, &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	exists, ok := resp["exists"].(bool)
	if !ok || !exists {
		t.Error("Expected exists to be true")
	}
}

func TestCheckFileExists_NotExists(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	ftc.CreateTestUser(t, "testuser")

	req := httptest.NewRequest(http.MethodGet, "/api/files/check?path=/home&filename=nonexistent.txt", nil)
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)

	err := ftc.Handler.CheckFileExists(c)
	if err != nil {
		t.Fatalf("CheckFileExists returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusOK)

	var resp map[string]any
	if err := ParseJSONResponse(ftc.Recorder, &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	exists, ok := resp["exists"].(bool)
	if !ok || exists {
		t.Error("Expected exists to be false")
	}
}

// =============================================================================
// File Delete Tests
// =============================================================================

func TestDeleteFile_Success(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	// Create user and test file
	userDir := ftc.CreateTestUser(t, "testuser")
	testFilePath := filepath.Join(userDir, "todelete.txt")
	ftc.CreateTestFile(t, testFilePath, []byte("delete me"))

	// Mock storage update query
	ftc.Mock.ExpectQuery("SELECT storage_used FROM users").
		WithArgs("1").
		WillReturnRows(sqlmock.NewRows([]string{"storage_used"}).AddRow(1000))
	ftc.Mock.ExpectExec("UPDATE users SET storage_used").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Mock audit log
	ftc.Mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Create request - use "*" param with "home/filename" format
	req := httptest.NewRequest(http.MethodDelete, "/api/files/home/todelete.txt", nil)
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("*")
	c.SetParamValues("home/todelete.txt")

	// Execute
	err := ftc.Handler.DeleteFile(c)
	if err != nil {
		t.Fatalf("DeleteFile returned error: %v", err)
	}

	// Verify status
	AssertStatus(t, ftc.Recorder, http.StatusOK)

	// Verify file was deleted
	if _, err := os.Stat(testFilePath); !os.IsNotExist(err) {
		t.Error("File was not deleted")
	}
}

func TestDeleteFile_NotFound(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	ftc.CreateTestUser(t, "testuser")

	req := httptest.NewRequest(http.MethodDelete, "/api/files/home/nonexistent.txt", nil)
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("*")
	c.SetParamValues("home/nonexistent.txt")

	err := ftc.Handler.DeleteFile(c)
	if err != nil {
		t.Fatalf("DeleteFile returned error: %v", err)
	}

	// Should return 404
	AssertStatus(t, ftc.Recorder, http.StatusNotFound)
}

func TestDeleteFile_PathTraversal_Blocked(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	ftc.CreateTestUser(t, "testuser")

	// Try to delete file outside user directory
	req := httptest.NewRequest(http.MethodDelete, "/api/files/../../../etc/passwd", nil)
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("*")
	c.SetParamValues("../../../etc/passwd")

	err := ftc.Handler.DeleteFile(c)
	if err != nil {
		t.Fatalf("DeleteFile returned error: %v", err)
	}

	// Should be blocked (not 200 OK)
	if ftc.Recorder.Code == http.StatusOK {
		t.Error("Path traversal attack was not blocked")
	}
}

// =============================================================================
// Folder Delete Tests
// =============================================================================

func TestDeleteFolder_Success(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	// Create user and test folder with files
	userDir := ftc.CreateTestUser(t, "testuser")
	folderPath := filepath.Join(userDir, "todelete")
	ftc.CreateTestFolder(t, folderPath)
	ftc.CreateTestFile(t, filepath.Join(folderPath, "file1.txt"), []byte("content1"))
	ftc.CreateTestFile(t, filepath.Join(folderPath, "file2.txt"), []byte("content2"))

	// Mock storage update query
	ftc.Mock.ExpectQuery("SELECT storage_used FROM users").
		WithArgs("1").
		WillReturnRows(sqlmock.NewRows([]string{"storage_used"}).AddRow(1000))
	ftc.Mock.ExpectExec("UPDATE users SET storage_used").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Mock audit log
	ftc.Mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := httptest.NewRequest(http.MethodDelete, "/api/folders/home/todelete?force=true", nil)
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("*")
	c.SetParamValues("home/todelete")

	err := ftc.Handler.DeleteFolder(c)
	if err != nil {
		t.Fatalf("DeleteFolder returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusOK)

	// Verify folder was deleted
	if _, err := os.Stat(folderPath); !os.IsNotExist(err) {
		t.Error("Folder was not deleted")
	}
}

func TestDeleteFolder_NotFound(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	ftc.CreateTestUser(t, "testuser")

	req := httptest.NewRequest(http.MethodDelete, "/api/folders/home/nonexistent", nil)
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("*")
	c.SetParamValues("home/nonexistent")

	err := ftc.Handler.DeleteFolder(c)
	if err != nil {
		t.Fatalf("DeleteFolder returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusNotFound)
}

// =============================================================================
// Folder Stats Tests
// =============================================================================

func TestGetFolderStats_Success(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	// Create user and test folder structure
	userDir := ftc.CreateTestUser(t, "testuser")
	folderPath := filepath.Join(userDir, "testfolder")
	ftc.CreateTestFolder(t, folderPath)
	ftc.CreateTestFile(t, filepath.Join(folderPath, "file1.txt"), []byte("content1"))
	ftc.CreateTestFile(t, filepath.Join(folderPath, "file2.txt"), []byte("content2content2"))
	subFolder := filepath.Join(folderPath, "subfolder")
	ftc.CreateTestFolder(t, subFolder)
	ftc.CreateTestFile(t, filepath.Join(subFolder, "file3.txt"), []byte("sub"))

	req := httptest.NewRequest(http.MethodGet, "/api/folders/stats/home/testfolder", nil)
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("*")
	c.SetParamValues("home/testfolder")

	err := ftc.Handler.GetFolderStats(c)
	if err != nil {
		t.Fatalf("GetFolderStats returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusOK)

	var stats FolderStats
	if err := ParseJSONResponse(ftc.Recorder, &stats); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	// Verify stats
	if stats.FileCount != 3 {
		t.Errorf("Expected 3 files, got %d", stats.FileCount)
	}
	if stats.FolderCount != 1 {
		t.Errorf("Expected 1 subfolder, got %d", stats.FolderCount)
	}
	expectedSize := int64(len("content1") + len("content2content2") + len("sub"))
	if stats.TotalSize != expectedSize {
		t.Errorf("Expected total size %d, got %d", expectedSize, stats.TotalSize)
	}
}

// =============================================================================
// Rename Tests
// =============================================================================

func TestRenameItem_Success(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	// Create user and test file
	userDir := ftc.CreateTestUser(t, "testuser")
	oldPath := filepath.Join(userDir, "oldname.txt")
	ftc.CreateTestFile(t, oldPath, []byte("test content"))

	// Mock audit log
	ftc.Mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))

	body := RenameRequest{
		NewName: "newname.txt",
	}
	req, err := NewJSONRequest(http.MethodPut, "/api/files/rename/home/oldname.txt", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("*")
	c.SetParamValues("home/oldname.txt")

	err = ftc.Handler.RenameItem(c)
	if err != nil {
		t.Fatalf("RenameItem returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusOK)

	// Verify rename
	newPath := filepath.Join(userDir, "newname.txt")
	if _, err := os.Stat(newPath); os.IsNotExist(err) {
		t.Error("File was not renamed to new name")
	}
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Error("Old file still exists")
	}
}

func TestRenameItem_DestinationExists(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	userDir := ftc.CreateTestUser(t, "testuser")
	ftc.CreateTestFile(t, filepath.Join(userDir, "source.txt"), []byte("source"))
	ftc.CreateTestFile(t, filepath.Join(userDir, "existing.txt"), []byte("existing"))

	body := RenameRequest{
		NewName: "existing.txt",
	}
	req, err := NewJSONRequest(http.MethodPut, "/api/files/rename/home/source.txt", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("*")
	c.SetParamValues("home/source.txt")

	err = ftc.Handler.RenameItem(c)
	if err != nil {
		t.Fatalf("RenameItem returned error: %v", err)
	}

	// Should fail because destination exists
	if ftc.Recorder.Code == http.StatusOK {
		t.Error("Rename to existing file should fail")
	}
}

// =============================================================================
// Move Tests
// =============================================================================

func TestMoveItem_Success(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	userDir := ftc.CreateTestUser(t, "testuser")
	sourcePath := filepath.Join(userDir, "source.txt")
	ftc.CreateTestFile(t, sourcePath, []byte("move me"))
	destFolder := filepath.Join(userDir, "destination")
	ftc.CreateTestFolder(t, destFolder)

	// Mock audit log
	ftc.Mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))

	body := MoveRequest{
		Destination: "/home/destination",
	}
	req, err := NewJSONRequest(http.MethodPut, "/api/files/move/home/source.txt", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("*")
	c.SetParamValues("home/source.txt")

	err = ftc.Handler.MoveItem(c)
	if err != nil {
		t.Fatalf("MoveItem returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusOK)

	// Verify move
	newPath := filepath.Join(destFolder, "source.txt")
	if _, err := os.Stat(newPath); os.IsNotExist(err) {
		t.Error("File was not moved to destination")
	}
	if _, err := os.Stat(sourcePath); !os.IsNotExist(err) {
		t.Error("Source file still exists")
	}
}

func TestMoveItem_SourceNotFound(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	userDir := ftc.CreateTestUser(t, "testuser")
	ftc.CreateTestFolder(t, filepath.Join(userDir, "destination"))

	body := MoveRequest{
		Destination: "/home/destination",
	}
	req, err := NewJSONRequest(http.MethodPut, "/api/files/move/home/nonexistent.txt", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("*")
	c.SetParamValues("home/nonexistent.txt")

	err = ftc.Handler.MoveItem(c)
	if err != nil {
		t.Fatalf("MoveItem returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusNotFound)
}

// =============================================================================
// Copy Tests
// =============================================================================

func TestCopyItem_Success(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	userDir := ftc.CreateTestUser(t, "testuser")
	sourcePath := filepath.Join(userDir, "source.txt")
	content := []byte("copy me")
	ftc.CreateTestFile(t, sourcePath, content)
	destFolder := filepath.Join(userDir, "destination")
	ftc.CreateTestFolder(t, destFolder)

	// Mock storage queries
	ftc.Mock.ExpectQuery("SELECT storage_quota, storage_used FROM users").
		WithArgs("1").
		WillReturnRows(sqlmock.NewRows([]string{"storage_quota", "storage_used"}).AddRow(1073741824, 0))
	ftc.Mock.ExpectExec("UPDATE users SET storage_used").
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Mock audit log
	ftc.Mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))

	body := CopyRequest{
		Destination: "/home/destination",
	}
	req, err := NewJSONRequest(http.MethodPost, "/api/files/copy/home/source.txt", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("*")
	c.SetParamValues("home/source.txt")

	err = ftc.Handler.CopyItem(c)
	if err != nil {
		t.Fatalf("CopyItem returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusOK)

	// Verify copy
	copyPath := filepath.Join(destFolder, "source.txt")
	if _, err := os.Stat(copyPath); os.IsNotExist(err) {
		t.Error("File was not copied to destination")
	}
	// Source should still exist
	if _, err := os.Stat(sourcePath); os.IsNotExist(err) {
		t.Error("Source file was deleted (should remain)")
	}

	// Verify content
	copiedContent, err := os.ReadFile(copyPath)
	if err != nil {
		t.Fatalf("Failed to read copied file: %v", err)
	}
	if string(copiedContent) != string(content) {
		t.Error("Copied file content does not match original")
	}
}

func TestCopyItem_SourceNotFound(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	userDir := ftc.CreateTestUser(t, "testuser")
	ftc.CreateTestFolder(t, filepath.Join(userDir, "destination"))

	body := CopyRequest{
		Destination: "/home/destination",
	}
	req, err := NewJSONRequest(http.MethodPost, "/api/files/copy/home/nonexistent.txt", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("*")
	c.SetParamValues("home/nonexistent.txt")

	err = ftc.Handler.CopyItem(c)
	if err != nil {
		t.Fatalf("CopyItem returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusNotFound)
}

// =============================================================================
// Save File Content Tests
// =============================================================================

func TestSaveFileContent_Success(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	userDir := ftc.CreateTestUser(t, "testuser")
	filePath := filepath.Join(userDir, "editable.txt")
	ftc.CreateTestFile(t, filePath, []byte("original content"))

	// Mock audit log
	ftc.Mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))

	newContent := "updated content here"
	// SaveFileContent reads raw body, not JSON
	req := httptest.NewRequest(http.MethodPut, "/api/files/content/home/editable.txt", strings.NewReader(newContent))
	req.Header.Set("Content-Type", "text/plain")

	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("*")
	c.SetParamValues("home/editable.txt")

	err := ftc.Handler.SaveFileContent(c)
	if err != nil {
		t.Fatalf("SaveFileContent returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusOK)

	// Verify content was saved
	savedContent, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("Failed to read saved file: %v", err)
	}
	if string(savedContent) != newContent {
		t.Errorf("Content mismatch: expected '%s', got '%s'", newContent, string(savedContent))
	}
}

func TestSaveFileContent_FileNotFound(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	ftc.CreateTestUser(t, "testuser")

	body := map[string]string{
		"content": "new content",
	}
	req, err := NewJSONRequest(http.MethodPut, "/api/files/content/home/nonexistent.txt", body)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "testuser", false)
	c.SetParamNames("*")
	c.SetParamValues("home/nonexistent.txt")

	err = ftc.Handler.SaveFileContent(c)
	if err != nil {
		t.Fatalf("SaveFileContent returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusNotFound)
}
