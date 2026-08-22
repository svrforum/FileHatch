package handlers

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
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

// Issue #33: ensure freshDirInfo masks the underlying directory mtime so that
// WebDAV PROPFIND responses get a fresh ETag/Last-Modified on every request.
// Without this, clients (Windows redirector, macOS Finder) keep cached listings
// for minutes after a new file appears in a nested subdirectory.
func TestFreshDirInfo_ReportsCurrentTime(t *testing.T) {
	tmp := t.TempDir()
	info, err := os.Stat(tmp)
	if err != nil {
		t.Fatalf("stat tmp: %v", err)
	}

	fresh := &freshDirInfo{FileInfo: info}

	// Underlying ModTime should be old (immediately after directory creation),
	// but freshDirInfo.ModTime() must always reflect ~now to defeat ETag caching.
	t1 := fresh.ModTime()
	time.Sleep(2 * time.Millisecond)
	t2 := fresh.ModTime()

	if !t2.After(t1) {
		t.Errorf("freshDirInfo.ModTime() should advance between calls; got t1=%v t2=%v", t1, t2)
	}

	// Other FileInfo methods should pass through to the wrapped value.
	if fresh.Name() != info.Name() {
		t.Errorf("Name passthrough failed: got %q want %q", fresh.Name(), info.Name())
	}
	if !fresh.IsDir() {
		t.Errorf("IsDir should be true for a wrapped directory")
	}
}

func TestVirtualDirInfo_ModTime(t *testing.T) {
	// With explicit modTime set, should return that time
	fixedTime := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	info := &virtualDirInfo{name: "test", isDir: true, modTime: fixedTime}
	if !info.ModTime().Equal(fixedTime) {
		t.Errorf("ModTime() with explicit time should return %v, got %v", fixedTime, info.ModTime())
	}

	// Without modTime (zero value), should return current time (not a frozen epoch)
	before := time.Now()
	infoNoTime := &virtualDirInfo{name: "test2", isDir: true}
	mt := infoNoTime.ModTime()
	after := time.Now()

	if mt.Before(before) || mt.After(after) {
		t.Errorf("ModTime() without explicit time should return ~now, got %v (expected between %v and %v)", mt, before, after)
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

			// Issue #38: Windows' WebDAV redirector goes through WinINET, which
			// only honours the HTTP/1.0 directives. Cache-Control alone left
			// Explorer showing stale listings, so all three must travel together.
			pragma := rec.Header().Get("Pragma")
			expires := rec.Header().Get("Expires")
			if tt.expectNoCache {
				if pragma != "no-cache" {
					t.Errorf("Expected Pragma: no-cache for %s, got %q", tt.method, pragma)
				}
				if expires != "0" {
					t.Errorf("Expected Expires: 0 for %s, got %q", tt.method, expires)
				}
			} else {
				if pragma != "" {
					t.Errorf("Expected no Pragma header for %s, got %q", tt.method, pragma)
				}
				if expires != "" {
					t.Errorf("Expected no Expires header for %s, got %q", tt.method, expires)
				}
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

func TestDestinationHeaderRewrite(t *testing.T) {
	// Simulate what ServeHTTP does: rewrite Destination header
	// when the host doesn't match r.Host (reverse proxy scenario)
	tests := []struct {
		name        string
		reqHost     string
		destination string
		expected    string
	}{
		{
			"Mismatched host - proxy scenario",
			"api:8080",
			"http://external.example.com:3080/webdav/home/newname.txt",
			"http://api:8080/webdav/home/newname.txt",
		},
		{
			"Matching host - no rewrite needed",
			"localhost:8080",
			"http://localhost:8080/webdav/home/newname.txt",
			"http://localhost:8080/webdav/home/newname.txt",
		},
		{
			"Empty host in destination - relative URL",
			"api:8080",
			"/webdav/home/newname.txt",
			"/webdav/home/newname.txt",
		},
		{
			"HTTPS destination with mismatched host",
			"api:8080",
			"https://files.company.com/webdav/home/renamed.docx",
			"https://api:8080/webdav/home/renamed.docx",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("MOVE", "/webdav/home/oldname.txt", nil)
			req.Host = tt.reqHost
			req.Header.Set("Destination", tt.destination)

			// Apply the same logic as ServeHTTP
			if dst := req.Header.Get("Destination"); dst != "" {
				if dstURL, parseErr := url.Parse(dst); parseErr == nil && dstURL.Host != "" && dstURL.Host != req.Host {
					dstURL.Host = req.Host
					req.Header.Set("Destination", dstURL.String())
				}
			}

			got := req.Header.Get("Destination")
			if got != tt.expected {
				t.Errorf("Destination = %q, want %q", got, tt.expected)
			}
		})
	}
}
