package handlers

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalBackend_Type(t *testing.T) {
	b := NewLocalBackend(t.TempDir(), false)
	if b.Type() != "local" {
		t.Errorf("expected type 'local', got '%s'", b.Type())
	}
}

func TestLocalBackend_IsLocal(t *testing.T) {
	b := NewLocalBackend(t.TempDir(), false)
	if !b.IsLocal() {
		t.Error("expected IsLocal() to be true")
	}
}

func TestLocalBackend_Stat(t *testing.T) {
	dir := t.TempDir()
	b := NewLocalBackend(dir, false)
	ctx := context.Background()

	// Create a test file
	testFile := filepath.Join(dir, "test.txt")
	if err := os.WriteFile(testFile, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	info, err := b.Stat(ctx, "test.txt")
	if err != nil {
		t.Fatal(err)
	}
	if info.FileName != "test.txt" {
		t.Errorf("expected name 'test.txt', got '%s'", info.FileName)
	}
	if info.FileSize != 5 {
		t.Errorf("expected size 5, got %d", info.FileSize)
	}
	if info.IsDirectory {
		t.Error("expected IsDirectory to be false")
	}

	// Test stat on non-existent file
	_, err = b.Stat(ctx, "nonexistent.txt")
	if err == nil {
		t.Error("expected error for non-existent file")
	}
}

func TestLocalBackend_Mkdir(t *testing.T) {
	dir := t.TempDir()
	b := NewLocalBackend(dir, false)
	ctx := context.Background()

	if err := b.Mkdir(ctx, "subdir/nested"); err != nil {
		t.Fatal(err)
	}

	info, err := b.Stat(ctx, "subdir/nested")
	if err != nil {
		t.Fatal(err)
	}
	if !info.IsDirectory {
		t.Error("expected directory")
	}
}

func TestLocalBackend_WriteAndReadFile(t *testing.T) {
	dir := t.TempDir()
	b := NewLocalBackend(dir, false)
	ctx := context.Background()

	content := "hello world"
	err := b.WriteFile(ctx, "test.txt", strings.NewReader(content), int64(len(content)))
	if err != nil {
		t.Fatal(err)
	}

	reader, info, err := b.ReadFile(ctx, "test.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()

	if info.FileSize != int64(len(content)) {
		t.Errorf("expected size %d, got %d", len(content), info.FileSize)
	}

	data, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != content {
		t.Errorf("expected content '%s', got '%s'", content, string(data))
	}
}

func TestLocalBackend_Delete(t *testing.T) {
	dir := t.TempDir()
	b := NewLocalBackend(dir, false)
	ctx := context.Background()

	// Create and delete a file
	if err := os.WriteFile(filepath.Join(dir, "todelete.txt"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := b.Delete(ctx, "todelete.txt"); err != nil {
		t.Fatal(err)
	}

	exists, err := b.Exists(ctx, "todelete.txt")
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Error("file should not exist after deletion")
	}
}

func TestLocalBackend_DeleteAll(t *testing.T) {
	dir := t.TempDir()
	b := NewLocalBackend(dir, false)
	ctx := context.Background()

	// Create nested structure
	if err := os.MkdirAll(filepath.Join(dir, "parent", "child"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "parent", "child", "file.txt"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := b.DeleteAll(ctx, "parent"); err != nil {
		t.Fatal(err)
	}

	exists, err := b.Exists(ctx, "parent")
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Error("directory should not exist after DeleteAll")
	}
}

func TestLocalBackend_Rename(t *testing.T) {
	dir := t.TempDir()
	b := NewLocalBackend(dir, false)
	ctx := context.Background()

	if err := os.WriteFile(filepath.Join(dir, "old.txt"), []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := b.Rename(ctx, "old.txt", "new.txt"); err != nil {
		t.Fatal(err)
	}

	exists, _ := b.Exists(ctx, "old.txt")
	if exists {
		t.Error("old file should not exist")
	}
	exists, _ = b.Exists(ctx, "new.txt")
	if !exists {
		t.Error("new file should exist")
	}
}

func TestLocalBackend_Copy(t *testing.T) {
	dir := t.TempDir()
	b := NewLocalBackend(dir, false)
	ctx := context.Background()

	if err := os.WriteFile(filepath.Join(dir, "src.txt"), []byte("copy me"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := b.Copy(ctx, "src.txt", "dst.txt"); err != nil {
		t.Fatal(err)
	}

	// Both should exist
	exists, _ := b.Exists(ctx, "src.txt")
	if !exists {
		t.Error("source should still exist")
	}
	exists, _ = b.Exists(ctx, "dst.txt")
	if !exists {
		t.Error("destination should exist")
	}

	// Content should match
	data, _ := os.ReadFile(filepath.Join(dir, "dst.txt"))
	if string(data) != "copy me" {
		t.Errorf("expected content 'copy me', got '%s'", string(data))
	}
}

func TestLocalBackend_ReadDir(t *testing.T) {
	dir := t.TempDir()
	b := NewLocalBackend(dir, false)
	ctx := context.Background()

	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a"), 0644)
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte("bb"), 0644)
	os.MkdirAll(filepath.Join(dir, "subdir"), 0755)

	entries, err := b.ReadDir(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Errorf("expected 3 entries, got %d", len(entries))
	}
}

func TestLocalBackend_Walk(t *testing.T) {
	dir := t.TempDir()
	b := NewLocalBackend(dir, false)
	ctx := context.Background()

	os.MkdirAll(filepath.Join(dir, "sub"), 0755)
	os.WriteFile(filepath.Join(dir, "root.txt"), []byte("r"), 0644)
	os.WriteFile(filepath.Join(dir, "sub", "nested.txt"), []byte("n"), 0644)

	var paths []string
	err := b.Walk(ctx, "", func(path string, info *StorageFileInfo, err error) error {
		if err != nil {
			return nil
		}
		paths = append(paths, path)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// With root="", should have ".", "root.txt", "sub", "sub/nested.txt" (or similar)
	if len(paths) < 3 {
		t.Errorf("expected at least 3 paths, got %d: %v", len(paths), paths)
	}
}

func TestLocalBackend_Exists(t *testing.T) {
	dir := t.TempDir()
	b := NewLocalBackend(dir, false)
	ctx := context.Background()

	os.WriteFile(filepath.Join(dir, "exists.txt"), []byte("x"), 0644)

	exists, err := b.Exists(ctx, "exists.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Error("file should exist")
	}

	exists, err = b.Exists(ctx, "nope.txt")
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Error("file should not exist")
	}
}

func TestLocalBackend_GetRealPath(t *testing.T) {
	dir := t.TempDir()
	b := NewLocalBackend(dir, false)

	rp, err := b.GetRealPath("sub/file.txt")
	if err != nil {
		t.Fatal(err)
	}
	expected := filepath.Join(dir, "sub", "file.txt")
	if rp != expected {
		t.Errorf("expected '%s', got '%s'", expected, rp)
	}
}

func TestLocalBackend_GetRealPath_PathTraversal(t *testing.T) {
	dir := t.TempDir()
	b := NewLocalBackend(dir, false)

	_, err := b.GetRealPath("../../etc/passwd")
	if err == nil {
		t.Error("expected error for path traversal")
	}
}

func TestLocalBackend_CalculateSize(t *testing.T) {
	dir := t.TempDir()
	b := NewLocalBackend(dir, false)
	ctx := context.Background()

	os.MkdirAll(filepath.Join(dir, "calcdir"), 0755)
	os.WriteFile(filepath.Join(dir, "calcdir", "a.txt"), []byte("aaa"), 0644)
	os.WriteFile(filepath.Join(dir, "calcdir", "b.txt"), []byte("bbbbb"), 0644)

	size, err := b.CalculateSize(ctx, "calcdir")
	if err != nil {
		t.Fatal(err)
	}
	if size != 8 {
		t.Errorf("expected size 8, got %d", size)
	}
}

func TestLocalBackend_SharedPermissions(t *testing.T) {
	b := NewLocalBackend(t.TempDir(), true)
	if !b.IsShared() {
		t.Error("expected IsShared to be true")
	}

	b2 := NewLocalBackend(t.TempDir(), false)
	if b2.IsShared() {
		t.Error("expected IsShared to be false")
	}
}

func TestEncodeCopySource(t *testing.T) {
	tests := []struct {
		name     string
		bucket   string
		key      string
		expected string
	}{
		{
			name:     "simple key",
			bucket:   "mybucket",
			key:      "folder/file.txt",
			expected: "mybucket/folder/file.txt",
		},
		{
			name:     "key with spaces",
			bucket:   "mybucket",
			key:      "my folder/my file.txt",
			expected: "mybucket/my%20folder/my%20file.txt",
		},
		{
			name:     "key with special characters",
			bucket:   "mybucket",
			key:      "docs/report (2024).pdf",
			expected: "mybucket/docs/report%20%282024%29.pdf",
		},
		{
			name:     "key with unicode",
			bucket:   "mybucket",
			key:      "문서/파일.txt",
			expected: "mybucket/%EB%AC%B8%EC%84%9C/%ED%8C%8C%EC%9D%BC.txt",
		},
		{
			name:     "key with plus sign",
			bucket:   "mybucket",
			key:      "data/file+v2.txt",
			expected: "mybucket/data/file+v2.txt", // + is valid in URL path segments
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := encodeCopySource(tt.bucket, tt.key)
			if result != tt.expected {
				t.Errorf("encodeCopySource(%q, %q) = %q, want %q", tt.bucket, tt.key, result, tt.expected)
			}
		})
	}
}

func TestErrStorageNotFound(t *testing.T) {
	if ErrStorageNotFound == nil {
		t.Error("ErrStorageNotFound should not be nil")
	}
	if ErrStorageNotFound.Error() != "storage: path not found" {
		t.Errorf("unexpected error message: %s", ErrStorageNotFound.Error())
	}
}
