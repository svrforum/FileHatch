package handlers

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// Issue #32 regression: read-only viewers must NOT be able to mutate shared drives.
// These tests verify that rename, move, copy, and trash operations all enforce
// CanWriteSharedDrive for shared folder paths.

var sharedTestCounter uint64

// uniqueSharedFolder returns a folder name unique to this test run, so the
// in-process permission cache (sync.Map) does not bleed state between tests.
func uniqueSharedFolder(t *testing.T) string {
	t.Helper()
	id := atomic.AddUint64(&sharedTestCounter, 1)
	return fmt.Sprintf("test-shared-%s-%d", t.Name(), id)
}

// expectViewerPermissionLookup queues a sqlmock expectation that returns
// permission_level=1 (read-only) for the shared folder permission query.
// CheckSharedDrivePermission will issue this query on cache miss.
func expectViewerPermissionLookup(mock sqlmock.Sqlmock, folderName, userID string) {
	mock.ExpectQuery("SELECT sfm.permission_level, sf.id").
		WithArgs(folderName, userID).
		WillReturnRows(sqlmock.NewRows([]string{"permission_level", "id"}).
			AddRow(PermissionReadOnly, "folder-id-1"))
}

// setupSharedFolder creates the on-disk shared folder and (optionally) a file in it.
func setupSharedFolder(t *testing.T, ftc *FileTestContext, folderName, fileName, content string) string {
	t.Helper()
	dir := filepath.Join(ftc.DataRoot, "shared", folderName)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("Failed to create shared folder: %v", err)
	}
	if fileName == "" {
		return dir
	}
	filePath := filepath.Join(dir, fileName)
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to create shared file: %v", err)
	}
	return filePath
}

// =============================================================================
// RenameItem - viewer must be denied (Issue #32)
// =============================================================================

func TestRenameItem_SharedDrive_ViewerDenied(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	folder := uniqueSharedFolder(t)
	srcPath := setupSharedFolder(t, ftc, folder, "old.txt", "x")

	expectViewerPermissionLookup(ftc.Mock, folder, "1")

	body := RenameRequest{NewName: "new.txt"}
	req, err := NewJSONRequest(http.MethodPut, "/api/files/rename/shared/"+folder+"/old.txt", body)
	if err != nil {
		t.Fatalf("NewJSONRequest: %v", err)
	}
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "viewer", false)
	c.SetParamNames("*")
	c.SetParamValues("shared/" + folder + "/old.txt")

	if err := ftc.Handler.RenameItem(c); err != nil {
		t.Fatalf("RenameItem returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusForbidden)

	if _, err := os.Stat(srcPath); os.IsNotExist(err) {
		t.Error("Source file was renamed despite viewer-only permission")
	}
}

// =============================================================================
// MoveToTrash / BatchMoveToTrash - viewer must be denied (Issue #32)
// =============================================================================

func TestMoveToTrash_SharedDrive_ViewerDenied(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	folder := uniqueSharedFolder(t)
	filePath := setupSharedFolder(t, ftc, folder, "victim.txt", "x")

	expectViewerPermissionLookup(ftc.Mock, folder, "1")

	req := httptest.NewRequest(http.MethodPost, "/api/trash/shared/"+folder+"/victim.txt", nil)
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "viewer", false)
	c.SetParamNames("*")
	c.SetParamValues("shared/" + folder + "/victim.txt")

	if err := ftc.Handler.MoveToTrash(c); err != nil {
		t.Fatalf("MoveToTrash returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusForbidden)

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		t.Error("File was moved to trash despite viewer-only permission")
	}
}

func TestBatchMoveToTrash_SharedDrive_ViewerDenied(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	folder := uniqueSharedFolder(t)
	filePath := setupSharedFolder(t, ftc, folder, "victim.txt", "x")

	expectViewerPermissionLookup(ftc.Mock, folder, "1")

	body := BatchMoveToTrashRequest{Paths: []string{"/shared/" + folder + "/victim.txt"}}
	req, err := NewJSONRequest(http.MethodPost, "/api/trash/batch", body)
	if err != nil {
		t.Fatalf("NewJSONRequest: %v", err)
	}
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "viewer", false)

	if err := ftc.Handler.BatchMoveToTrash(c); err != nil {
		t.Fatalf("BatchMoveToTrash returned error: %v", err)
	}

	// Batch endpoint returns 200 OK with per-item failure entries
	AssertStatus(t, ftc.Recorder, http.StatusOK)

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		t.Error("File was moved to trash despite viewer-only permission")
	}

	var resp map[string]any
	if err := ParseJSONResponse(ftc.Recorder, &resp); err != nil {
		t.Fatalf("ParseJSONResponse: %v", err)
	}
	failed, ok := resp["failed"].([]any)
	if !ok || len(failed) == 0 {
		t.Errorf("Expected failed entries in response, got: %v", resp)
	}
}

// =============================================================================
// MoveItem - viewer must be denied on src or dest shared folder
// =============================================================================

func TestMoveItem_SharedSource_ViewerDenied(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	folder := uniqueSharedFolder(t)
	srcPath := setupSharedFolder(t, ftc, folder, "moveme.txt", "x")

	userDir := ftc.CreateTestUser(t, "viewer")
	if err := os.MkdirAll(userDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	expectViewerPermissionLookup(ftc.Mock, folder, "1")

	body := MoveRequest{Destination: "/home"}
	req, err := NewJSONRequest(http.MethodPut, "/api/files/move/shared/"+folder+"/moveme.txt", body)
	if err != nil {
		t.Fatalf("NewJSONRequest: %v", err)
	}
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "viewer", false)
	c.SetParamNames("*")
	c.SetParamValues("shared/" + folder + "/moveme.txt")

	if err := ftc.Handler.MoveItem(c); err != nil {
		t.Fatalf("MoveItem returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusForbidden)

	if _, err := os.Stat(srcPath); os.IsNotExist(err) {
		t.Error("Source file was moved despite viewer-only permission")
	}
}

func TestMoveItem_SharedDestination_ViewerDenied(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	folder := uniqueSharedFolder(t)
	setupSharedFolder(t, ftc, folder, "", "")

	userDir := ftc.CreateTestUser(t, "viewer")
	srcPath := filepath.Join(userDir, "intruder.txt")
	ftc.CreateTestFile(t, srcPath, []byte("x"))

	expectViewerPermissionLookup(ftc.Mock, folder, "1")

	body := MoveRequest{Destination: "/shared/" + folder}
	req, err := NewJSONRequest(http.MethodPut, "/api/files/move/home/intruder.txt", body)
	if err != nil {
		t.Fatalf("NewJSONRequest: %v", err)
	}
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "viewer", false)
	c.SetParamNames("*")
	c.SetParamValues("home/intruder.txt")

	if err := ftc.Handler.MoveItem(c); err != nil {
		t.Fatalf("MoveItem returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusForbidden)

	if _, err := os.Stat(srcPath); os.IsNotExist(err) {
		t.Error("Source file disappeared despite viewer-only destination permission")
	}
}

// =============================================================================
// CopyItem - viewer must be denied when destination is a shared folder
// =============================================================================

func TestCopyItem_SharedDestination_ViewerDenied(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	folder := uniqueSharedFolder(t)
	sharedDir := setupSharedFolder(t, ftc, folder, "", "")

	userDir := ftc.CreateTestUser(t, "viewer")
	srcPath := filepath.Join(userDir, "copy.txt")
	ftc.CreateTestFile(t, srcPath, []byte("x"))

	expectViewerPermissionLookup(ftc.Mock, folder, "1")

	body := CopyRequest{Destination: "/shared/" + folder}
	req, err := NewJSONRequest(http.MethodPost, "/api/files/copy/home/copy.txt", body)
	if err != nil {
		t.Fatalf("NewJSONRequest: %v", err)
	}
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "viewer", false)
	c.SetParamNames("*")
	c.SetParamValues("home/copy.txt")

	if err := ftc.Handler.CopyItem(c); err != nil {
		t.Fatalf("CopyItem returned error: %v", err)
	}

	AssertStatus(t, ftc.Recorder, http.StatusForbidden)

	if _, err := os.Stat(filepath.Join(sharedDir, "copy.txt")); err == nil {
		t.Error("Copy succeeded into shared folder despite viewer-only permission")
	}
}
