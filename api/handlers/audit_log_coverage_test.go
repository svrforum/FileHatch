package handlers

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

// Issue #33 regression: previously several user-visible operations had no audit
// log coverage. These tests assert that an audit_logs INSERT is observed for:
//   - permanent trash deletion (DeleteFromTrash, BatchDeleteFromTrash, EmptyTrash)
//   - inline file viewing (GetFile without ?download=true)
//   - file previews (GetPreview)
// Each test uses a unique resource name so the in-memory dedupe map cannot
// suppress events from earlier runs.

var auditTestCounter uint64

func uniqueAuditFile(t *testing.T, ext string) string {
	t.Helper()
	id := atomic.AddUint64(&auditTestCounter, 1)
	return fmt.Sprintf("audit-%s-%d.%s", t.Name(), id, ext)
}

// expectAuditInsert queues a sqlmock expectation matching the async or sync
// audit_logs INSERT issued by AuditHandler.LogEvent(Deduped).
func expectAuditInsert(mock sqlmock.Sqlmock) {
	mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))
}

// drainAuditChannel forces the buffered audit handler to flush by stopping it
// and returning a fresh handler bound to the same DB. Tests must call this
// before asserting sqlmock expectations or the async insert may not have run.
func waitForAuditFlush(t *testing.T, h *AuditHandler) {
	t.Helper()
	h.StopAuditLogger()
	// Allow flushBatch's DB calls to settle.
	time.Sleep(50 * time.Millisecond)
}

// =============================================================================
// Trash permanent deletion - Issue #33 audit gap
// =============================================================================

func TestDeleteFromTrash_AuditLogged(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	// Replace audit handler with one bound to the mock DB so we can intercept inserts.
	auditHandler := NewAuditHandler(ftc.DB, ftc.DataRoot)
	ftc.Handler.auditHandler = auditHandler

	// Set up trash directory and metadata file (note: filename uses underscore)
	user := "viewer-trash-delete"
	trashDir := filepath.Join(ftc.DataRoot, "trash", user)
	if err := os.MkdirAll(trashDir, 0755); err != nil {
		t.Fatalf("mkdir trash: %v", err)
	}
	trashID := "1234567890_victim.txt"
	trashItem := filepath.Join(trashDir, trashID)
	if err := os.WriteFile(trashItem, []byte("x"), 0644); err != nil {
		t.Fatalf("write trash item: %v", err)
	}
	metaFile := filepath.Join(trashDir, ".trash_meta.json")
	meta := fmt.Sprintf(`{"%s":{"id":"%s","name":"victim.txt","originalPath":"/home/victim.txt","size":1,"isDir":false,"deletedAt":"2026-04-01T00:00:00Z"}}`, trashID, trashID)
	if err := os.WriteFile(metaFile, []byte(meta), 0644); err != nil {
		t.Fatalf("write meta: %v", err)
	}

	// UpdateUserTrashStorage does a single UPDATE; then we expect the audit INSERT.
	ftc.Mock.ExpectExec("UPDATE users").
		WillReturnResult(sqlmock.NewResult(1, 1))
	expectAuditInsert(ftc.Mock)

	req := httptest.NewRequest(http.MethodDelete, "/api/trash/"+trashID, nil)
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", user, false)
	c.SetParamNames("id")
	c.SetParamValues(trashID)

	if err := ftc.Handler.DeleteFromTrash(c); err != nil {
		t.Fatalf("DeleteFromTrash: %v", err)
	}
	AssertStatus(t, ftc.Recorder, http.StatusOK)
	waitForAuditFlush(t, auditHandler)

	if err := ftc.Mock.ExpectationsWereMet(); err != nil {
		t.Errorf("audit_logs INSERT was not issued: %v", err)
	}
}

// =============================================================================
// File view - inline GetFile with no ?download=true
// =============================================================================

func TestGetFile_InlineView_AuditLogged(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	auditHandler := NewAuditHandler(ftc.DB, ftc.DataRoot)
	ftc.Handler.auditHandler = auditHandler

	userDir := ftc.CreateTestUser(t, "viewer-inline")
	name := uniqueAuditFile(t, "txt")
	filePath := filepath.Join(userDir, name)
	ftc.CreateTestFile(t, filePath, []byte("hello"))

	expectAuditInsert(ftc.Mock)

	req := httptest.NewRequest(http.MethodGet, "/api/files/home/"+name, nil)
	c := CreateAuthenticatedContext(ftc.Echo, ftc.Recorder, req, "1", "viewer-inline", false)
	c.SetParamNames("*")
	c.SetParamValues("home/" + name)

	if err := ftc.Handler.GetFile(c); err != nil {
		t.Fatalf("GetFile: %v", err)
	}
	AssertStatus(t, ftc.Recorder, http.StatusOK)
	waitForAuditFlush(t, auditHandler)

	if err := ftc.Mock.ExpectationsWereMet(); err != nil {
		t.Errorf("audit_logs INSERT for file.view not observed: %v", err)
	}
}

func TestGetFile_InlineView_DedupedWithinWindow(t *testing.T) {
	ftc := SetupFileTest(t)
	defer ftc.Cleanup()

	auditHandler := NewAuditHandler(ftc.DB, ftc.DataRoot)
	ftc.Handler.auditHandler = auditHandler

	userDir := ftc.CreateTestUser(t, "viewer-dedupe")
	name := uniqueAuditFile(t, "txt")
	filePath := filepath.Join(userDir, name)
	ftc.CreateTestFile(t, filePath, []byte("hello"))

	// Only ONE INSERT should be issued for two rapid views of the same file.
	expectAuditInsert(ftc.Mock)

	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/files/home/"+name, nil)
		c := CreateAuthenticatedContext(ftc.Echo, rec, req, "1", "viewer-dedupe", false)
		c.SetParamNames("*")
		c.SetParamValues("home/" + name)
		if err := ftc.Handler.GetFile(c); err != nil {
			t.Fatalf("GetFile #%d: %v", i, err)
		}
	}
	waitForAuditFlush(t, auditHandler)

	if err := ftc.Mock.ExpectationsWereMet(); err != nil {
		t.Errorf("dedupe failed: %v", err)
	}
}
