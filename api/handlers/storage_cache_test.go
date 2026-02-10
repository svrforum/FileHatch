package handlers

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCachedBackend_CachesStat(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "test.txt"), []byte("hello"), 0644)

	local := NewLocalBackend(dir, false)
	cached := NewCachedBackend(local, "test-mount")
	ctx := context.Background()

	// First call should populate cache
	info1, err := cached.Stat(ctx, "test.txt")
	if err != nil {
		t.Fatal(err)
	}
	if info1.FileSize != 5 {
		t.Errorf("expected size 5, got %d", info1.FileSize)
	}

	// Modify file directly (bypassing cache)
	os.WriteFile(filepath.Join(dir, "test.txt"), []byte("hello world"), 0644)

	// Should still return cached value
	info2, err := cached.Stat(ctx, "test.txt")
	if err != nil {
		t.Fatal(err)
	}
	if info2.FileSize != 5 {
		t.Errorf("expected cached size 5, got %d", info2.FileSize)
	}
}

func TestCachedBackend_InvalidatesOnWrite(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "test.txt"), []byte("hello"), 0644)

	local := NewLocalBackend(dir, false)
	cached := NewCachedBackend(local, "test-mount")
	ctx := context.Background()

	// Populate cache
	_, _ = cached.Stat(ctx, "test.txt")

	// Write via cached backend using a real reader to invalidate cache
	err := cached.WriteFile(ctx, "test.txt", strings.NewReader("hello world!"), 12)
	if err != nil {
		t.Fatal(err)
	}

	// Should now return fresh value since cache was invalidated
	info, err := cached.Stat(ctx, "test.txt")
	if err != nil {
		t.Fatal(err)
	}
	if info.FileSize != 12 {
		t.Errorf("expected size 12 after invalidation, got %d", info.FileSize)
	}
}

func TestCachedBackend_CachesReadDir(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a"), 0644)

	local := NewLocalBackend(dir, false)
	cached := NewCachedBackend(local, "test-mount")
	ctx := context.Background()

	entries1, err := cached.ReadDir(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries1) != 1 {
		t.Errorf("expected 1 entry, got %d", len(entries1))
	}

	// Add file directly
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte("b"), 0644)

	// Should return cached 1 entry
	entries2, err := cached.ReadDir(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries2) != 1 {
		t.Errorf("expected cached 1 entry, got %d", len(entries2))
	}
}

func TestCachedBackend_ClearCache(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a"), 0644)

	local := NewLocalBackend(dir, false)
	cached := NewCachedBackend(local, "test-mount")
	ctx := context.Background()

	// Populate cache
	_, _ = cached.Stat(ctx, "a.txt")

	// Add file
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte("b"), 0644)

	// Clear cache
	cached.ClearCache()

	// ReadDir should now show both files
	entries, err := cached.ReadDir(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Errorf("expected 2 entries after clear, got %d", len(entries))
	}
}

func TestCachedBackend_DelegateMethods(t *testing.T) {
	dir := t.TempDir()
	local := NewLocalBackend(dir, false)
	cached := NewCachedBackend(local, "test-mount")

	if cached.Type() != "local" {
		t.Errorf("expected type 'local', got '%s'", cached.Type())
	}
	if !cached.IsLocal() {
		t.Error("expected IsLocal to be true")
	}
}

func TestCachedBackend_InvalidatesOnDelete(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "del.txt"), []byte("delete me"), 0644)

	local := NewLocalBackend(dir, false)
	cached := NewCachedBackend(local, "test-mount")
	ctx := context.Background()

	// Populate cache
	_, _ = cached.Stat(ctx, "del.txt")

	// Delete via cached backend
	err := cached.Delete(ctx, "del.txt")
	if err != nil {
		t.Fatal(err)
	}

	// Stat should now fail
	_, err = cached.Stat(ctx, "del.txt")
	if err == nil {
		t.Error("expected error after deletion")
	}
}

func TestCachedBackend_InvalidatesOnRename(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "old.txt"), []byte("data"), 0644)

	local := NewLocalBackend(dir, false)
	cached := NewCachedBackend(local, "test-mount")
	ctx := context.Background()

	// Populate cache for old path
	_, _ = cached.Stat(ctx, "old.txt")

	// Rename
	err := cached.Rename(ctx, "old.txt", "new.txt")
	if err != nil {
		t.Fatal(err)
	}

	// Old path should fail
	_, err = cached.Stat(ctx, "old.txt")
	if err == nil {
		t.Error("expected error for old path after rename")
	}
	// New path should succeed
	info, err := cached.Stat(ctx, "new.txt")
	if err != nil {
		t.Fatal(err)
	}
	if info.FileName != "new.txt" {
		t.Errorf("expected 'new.txt', got '%s'", info.FileName)
	}
}

func TestCachedBackend_InvalidatesOnCopy(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "src.txt"), []byte("data"), 0644)

	local := NewLocalBackend(dir, false)
	cached := NewCachedBackend(local, "test-mount")
	ctx := context.Background()

	// Populate list cache for root
	entries1, _ := cached.List(ctx, "")

	// Copy
	err := cached.Copy(ctx, "src.txt", "dst.txt")
	if err != nil {
		t.Fatal(err)
	}

	// List should now reflect the new file (cache was invalidated)
	entries2, err := cached.List(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries2) <= len(entries1) {
		t.Errorf("expected more entries after copy, got %d (was %d)", len(entries2), len(entries1))
	}
}

func TestCachedBackend_InvalidatesOnMkdir(t *testing.T) {
	dir := t.TempDir()

	local := NewLocalBackend(dir, false)
	cached := NewCachedBackend(local, "test-mount")
	ctx := context.Background()

	// Populate list cache for root
	entries1, _ := cached.List(ctx, "")

	// Mkdir
	err := cached.Mkdir(ctx, "newdir")
	if err != nil {
		t.Fatal(err)
	}

	// List should now show the new directory
	entries2, err := cached.List(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries2) <= len(entries1) {
		t.Errorf("expected more entries after mkdir, got %d (was %d)", len(entries2), len(entries1))
	}
}

func TestCachedBackend_InvalidatesOnDeleteAll(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "subdir"), 0755)
	os.WriteFile(filepath.Join(dir, "subdir", "file.txt"), []byte("x"), 0644)

	local := NewLocalBackend(dir, false)
	cached := NewCachedBackend(local, "test-mount")
	ctx := context.Background()

	// Populate cache
	_, _ = cached.Stat(ctx, "subdir")

	// DeleteAll
	err := cached.DeleteAll(ctx, "subdir")
	if err != nil {
		t.Fatal(err)
	}

	// Stat should fail
	_, err = cached.Stat(ctx, "subdir")
	if err == nil {
		t.Error("expected error after DeleteAll")
	}
}

func TestCachedBackend_ExpiredEntryCleanup(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "test.txt"), []byte("hello"), 0644)

	local := NewLocalBackend(dir, false)
	cached := NewCachedBackend(local, "test-mount")
	cached.cacheTTL = 10 * time.Millisecond // Very short TTL
	ctx := context.Background()

	// Populate cache
	_, _ = cached.Stat(ctx, "test.txt")

	// Verify cache has the entry
	cached.mu.RLock()
	initialCount := len(cached.cache)
	cached.mu.RUnlock()
	if initialCount == 0 {
		t.Fatal("expected cache to have entries")
	}

	// Wait for expiry
	time.Sleep(20 * time.Millisecond)

	// Access the expired entry - this should trigger cleanup
	_, ok := cached.get("stat:test.txt")
	if ok {
		t.Error("expected expired entry to not be returned")
	}

	// Verify the expired entry was actually deleted from the map
	cached.mu.RLock()
	_, stillExists := cached.cache["stat:test.txt"]
	cached.mu.RUnlock()
	if stillExists {
		t.Error("expired entry should have been deleted from cache map")
	}
}
