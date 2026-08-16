package handlers

import (
	"archive/zip"
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"

	"github.com/labstack/echo/v4"
)

// buildShareTree lays out a directory that exercises every branch the ZIP walk
// has to make a decision about.
func buildShareTree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	shared := filepath.Join(root, "shared")

	mustMkdir(t, filepath.Join(shared, "sub"))
	mustWrite(t, filepath.Join(shared, "a.txt"), "alpha")
	mustWrite(t, filepath.Join(shared, "sub", "b.txt"), "bravo")

	// Must never appear in the archive: ListShareContents hides these, so the
	// ZIP would be handing out files the visitor was never shown.
	mustWrite(t, filepath.Join(shared, ".env"), "SECRET=leak")
	mustMkdir(t, filepath.Join(shared, ".git"))
	mustWrite(t, filepath.Join(shared, ".git", "config"), "[core]")

	// A symlink pointing outside the share must not be followed.
	if runtime.GOOS != "windows" {
		outside := filepath.Join(root, "outside.txt")
		mustWrite(t, outside, "should not be readable")
		if err := os.Symlink(outside, filepath.Join(shared, "link.txt")); err != nil {
			t.Fatalf("symlink: %v", err)
		}
	}

	return shared
}

func mustMkdir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// runLocalShareZip streams the directory and parses whatever came back.
func runLocalShareZip(t *testing.T, dir, name string) (*zip.Reader, *httptest.ResponseRecorder, *shareZipResult) {
	t.Helper()

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/s/tok/download", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	result, err := streamLocalShareDirectory(c, dir, name)
	if err != nil {
		t.Fatalf("streamLocalShareDirectory: %v", err)
	}

	body := rec.Body.Bytes()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("response is not a parseable zip: %v", err)
	}
	return zr, rec, result
}

func zipNames(zr *zip.Reader) []string {
	names := make([]string, 0, len(zr.File))
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	sort.Strings(names)
	return names
}

// Regression test for Issue #39: a shared folder used to answer 400
// "Cannot download a directory".
func TestStreamLocalShareDirectory_ProducesZip(t *testing.T) {
	shared := buildShareTree(t)
	zr, rec, result := runLocalShareZip(t, shared, "shared")

	if ct := rec.Header().Get(echo.HeaderContentType); ct != "application/zip" {
		t.Errorf("Content-Type = %q, want application/zip", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); cd == "" {
		t.Error("Content-Disposition not set")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}

	names := zipNames(zr)
	want := map[string]bool{
		"shared/":          true,
		"shared/a.txt":     true,
		"shared/sub/":      true,
		"shared/sub/b.txt": true,
	}
	for _, n := range names {
		if !want[n] {
			t.Errorf("unexpected entry in archive: %q (all: %v)", n, names)
		}
	}
	for n := range want {
		if !containsName(names, n) {
			t.Errorf("missing entry %q (all: %v)", n, names)
		}
	}

	if result.Files != 2 {
		t.Errorf("result.Files = %d, want 2", result.Files)
	}
	if result.Bytes != int64(len("alpha")+len("bravo")) {
		t.Errorf("result.Bytes = %d, want %d", result.Bytes, len("alpha")+len("bravo"))
	}

	// Spot-check that content really is in there.
	for _, f := range zr.File {
		if f.Name != "shared/a.txt" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open entry: %v", err)
		}
		defer rc.Close()
		var buf bytes.Buffer
		if _, err := buf.ReadFrom(rc); err != nil {
			t.Fatalf("read entry: %v", err)
		}
		if buf.String() != "alpha" {
			t.Errorf("shared/a.txt = %q, want %q", buf.String(), "alpha")
		}
	}
}

// Dotfiles are filtered out of the browsable listing, so they must not ride
// along in the archive.
func TestStreamLocalShareDirectory_ExcludesDotfiles(t *testing.T) {
	shared := buildShareTree(t)
	zr, _, _ := runLocalShareZip(t, shared, "shared")

	for _, n := range zipNames(zr) {
		base := filepath.Base(n)
		if base == ".env" || base == ".git" || base == "config" {
			t.Errorf("hidden entry leaked into archive: %q", n)
		}
	}
}

func TestStreamLocalShareDirectory_SkipsSymlinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink semantics differ on windows")
	}
	shared := buildShareTree(t)
	zr, _, _ := runLocalShareZip(t, shared, "shared")

	for _, n := range zipNames(zr) {
		if filepath.Base(n) == "link.txt" {
			t.Errorf("symlink was followed into the archive: %q", n)
		}
	}
}

// An unreadable file should cost that file, not the whole download, and the
// visitor must be told something was left out.
func TestStreamLocalShareDirectory_ReportsUnreadableEntries(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: permission bits are not enforced")
	}

	shared := buildShareTree(t)
	locked := filepath.Join(shared, "locked.txt")
	mustWrite(t, locked, "nope")
	if err := os.Chmod(locked, 0o000); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(locked, 0o644) })

	zr, _, result := runLocalShareZip(t, shared, "shared")

	if len(result.Failures) == 0 {
		t.Fatal("expected the unreadable file to be recorded as a failure")
	}
	if !containsName(zipNames(zr), shareZipFailureManifest) {
		t.Errorf("archive is missing %s; the visitor cannot tell files were dropped", shareZipFailureManifest)
	}
	// The readable files must still be present.
	if !containsName(zipNames(zr), "shared/a.txt") {
		t.Error("a readable file was dropped because a sibling was unreadable")
	}
}

func TestValidateSharedDirectoryPath(t *testing.T) {
	root := t.TempDir()
	inside := filepath.Join(root, "shared")
	mustMkdir(t, inside)

	if err := validateSharedDirectoryPath(root, inside); err != nil {
		t.Errorf("a directory inside the root was rejected: %v", err)
	}

	// Sibling directory whose name merely starts with the root's name.
	sibling := root + "-evil"
	mustMkdir(t, sibling)
	t.Cleanup(func() { _ = os.RemoveAll(sibling) })
	if err := validateSharedDirectoryPath(root, sibling); err == nil {
		t.Error("a sibling directory sharing the root's name prefix was accepted")
	}

	if runtime.GOOS != "windows" {
		outsideTarget := t.TempDir()
		linked := filepath.Join(root, "escape")
		if err := os.Symlink(outsideTarget, linked); err != nil {
			t.Fatalf("symlink: %v", err)
		}
		if err := validateSharedDirectoryPath(root, linked); err == nil {
			t.Error("a symlink pointing outside the root was accepted")
		}
	}
}

func containsName(haystack []string, needle string) bool {
	for _, h := range haystack {
		if h == needle {
			return true
		}
	}
	return false
}
