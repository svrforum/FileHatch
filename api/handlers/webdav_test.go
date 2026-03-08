package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestIsTempFile(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected bool
	}{
		{"Office lock file", "~$document.docx", true},
		{"LibreOffice lock file", ".~lock.document.docx#", true},
		{"Tmp extension lowercase", "tempfile.tmp", true},
		{"Tmp extension uppercase", "TEMPFILE.TMP", true},
		{"Tmp extension mixed case", "file.Tmp", true},
		{"Normal docx", "document.docx", false},
		{"Normal txt", "readme.txt", false},
		{"Tilde without dollar", "~document.docx", false},
		{"Nested path tmp", "/home/docs/~$file.docx", true},
		{"Nested path normal", "/home/docs/file.pdf", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isTempFile(tt.input)
			if result != tt.expected {
				t.Errorf("isTempFile(%q) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestVirtualDirInfo_ModTime(t *testing.T) {
	before := time.Now()
	info1 := &virtualDirInfo{name: "test", isDir: true}
	time.Sleep(10 * time.Millisecond)
	info2 := &virtualDirInfo{name: "test2", isDir: true}

	t1 := info1.ModTime()
	t2 := info2.ModTime()

	// Both should return the same fixed time (webdavEpoch)
	if !t1.Equal(t2) {
		t.Errorf("ModTime() should return fixed time, got %v and %v", t1, t2)
	}

	// The fixed time should be before or equal to the test start
	if t1.After(before) {
		t.Errorf("ModTime() should return time <= test start, got %v (test started at %v)", t1, before)
	}
}

func TestStatusCapturingWriter_CacheHeaders(t *testing.T) {
	tests := []struct {
		name          string
		method        string
		expectNoCache bool
	}{
		{"GET should not have no-cache", "GET", false},
		{"HEAD should not have no-cache", "HEAD", false},
		{"PROPFIND should have no-cache", "PROPFIND", true},
		{"PUT should have no-cache", "PUT", true},
		{"DELETE should have no-cache", "DELETE", true},
		{"MKCOL should have no-cache", "MKCOL", true},
		{"MOVE should have no-cache", "MOVE", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tt.method, "/webdav/test", nil)

			sw := newStatusCapturingWriter(rec, req)
			sw.WriteHeader(http.StatusOK)

			cc := rec.Header().Get("Cache-Control")
			if tt.expectNoCache && cc != "no-cache, no-store, must-revalidate" {
				t.Errorf("Expected Cache-Control header for %s, got %q", tt.method, cc)
			}
			if !tt.expectNoCache && cc != "" {
				t.Errorf("Expected no Cache-Control header for %s, got %q", tt.method, cc)
			}
		})
	}
}

func TestStatusCapturingWriter_StatusCode(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("PUT", "/webdav/test", nil)

	sw := newStatusCapturingWriter(rec, req)

	// Before writing, statusCode should be 0
	if sw.statusCode != 0 {
		t.Errorf("Initial statusCode should be 0, got %d", sw.statusCode)
	}

	sw.WriteHeader(http.StatusCreated)

	if sw.statusCode != http.StatusCreated {
		t.Errorf("statusCode should be %d, got %d", http.StatusCreated, sw.statusCode)
	}

	// Double WriteHeader should be ignored
	sw.WriteHeader(http.StatusInternalServerError)
	if sw.statusCode != http.StatusCreated {
		t.Errorf("statusCode should still be %d after double WriteHeader, got %d", http.StatusCreated, sw.statusCode)
	}
}

func TestStatusCapturingWriter_ImplicitOK(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("PUT", "/webdav/test", nil)

	sw := newStatusCapturingWriter(rec, req)

	// Write without explicit WriteHeader should trigger implicit 200
	_, err := sw.Write([]byte("hello"))
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	if sw.statusCode != http.StatusOK {
		t.Errorf("Implicit statusCode should be %d, got %d", http.StatusOK, sw.statusCode)
	}
}
