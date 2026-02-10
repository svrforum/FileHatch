package handlers

import (
	"context"
	"io"
	"path"
	"sync"
	"time"
)

// cacheEntry holds a cached value with expiration
type cacheEntry struct {
	value     interface{}
	expiresAt time.Time
}

// CachedBackend wraps a StorageBackend with in-memory caching for Stat and List operations
type CachedBackend struct {
	backend  StorageBackend
	mountID  string
	cacheTTL time.Duration
	mu       sync.RWMutex
	cache    map[string]cacheEntry
}

// NewCachedBackend creates a new CachedBackend wrapping the given backend
func NewCachedBackend(backend StorageBackend, mountID string) *CachedBackend {
	return &CachedBackend{
		backend:  backend,
		mountID:  mountID,
		cacheTTL: 30 * time.Second,
		cache:    make(map[string]cacheEntry),
	}
}

func (c *CachedBackend) get(key string) (interface{}, bool) {
	c.mu.RLock()
	entry, ok := c.cache[key]
	if !ok {
		c.mu.RUnlock()
		return nil, false
	}
	if time.Now().After(entry.expiresAt) {
		c.mu.RUnlock()
		// Upgrade to write lock to delete expired entry
		c.mu.Lock()
		// Re-check under write lock (another goroutine may have already deleted it)
		if entry, ok := c.cache[key]; ok && time.Now().After(entry.expiresAt) {
			delete(c.cache, key)
		}
		c.mu.Unlock()
		return nil, false
	}
	c.mu.RUnlock()
	return entry.value, true
}

func (c *CachedBackend) set(key string, value interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cache[key] = cacheEntry{
		value:     value,
		expiresAt: time.Now().Add(c.cacheTTL),
	}
}

// invalidate removes cache entries for a path and its parent
func (c *CachedBackend) invalidate(relPath string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Invalidate exact path
	delete(c.cache, "stat:"+relPath)
	delete(c.cache, "list:"+relPath)

	// Invalidate parent
	parent := path.Dir(relPath)
	delete(c.cache, "stat:"+parent)
	delete(c.cache, "list:"+parent)

	// Invalidate root
	delete(c.cache, "stat:")
	delete(c.cache, "list:")
}

// Type delegates to the wrapped backend
func (c *CachedBackend) Type() string { return c.backend.Type() }

// IsLocal delegates to the wrapped backend
func (c *CachedBackend) IsLocal() bool { return c.backend.IsLocal() }

// Stat returns cached stat info or fetches from backend
func (c *CachedBackend) Stat(ctx context.Context, relPath string) (*StorageFileInfo, error) {
	key := "stat:" + relPath
	if cached, ok := c.get(key); ok {
		return cached.(*StorageFileInfo), nil
	}
	info, err := c.backend.Stat(ctx, relPath)
	if err != nil {
		return nil, err
	}
	c.set(key, info)
	return info, nil
}

// List returns cached directory listing or fetches from backend
func (c *CachedBackend) List(ctx context.Context, relPath string) ([]StorageDirEntry, error) {
	key := "list:" + relPath
	if cached, ok := c.get(key); ok {
		return cached.([]StorageDirEntry), nil
	}
	entries, err := c.backend.List(ctx, relPath)
	if err != nil {
		return nil, err
	}
	c.set(key, entries)
	return entries, nil
}

// ReadDir returns cached directory listing or fetches from backend
func (c *CachedBackend) ReadDir(ctx context.Context, relPath string) ([]StorageDirEntry, error) {
	return c.List(ctx, relPath)
}

// ReadFile delegates to backend (not cached)
func (c *CachedBackend) ReadFile(ctx context.Context, relPath string) (io.ReadCloser, *StorageFileInfo, error) {
	return c.backend.ReadFile(ctx, relPath)
}

// WriteFile delegates to backend and invalidates cache
func (c *CachedBackend) WriteFile(ctx context.Context, relPath string, reader io.Reader, size int64) error {
	err := c.backend.WriteFile(ctx, relPath, reader, size)
	if err == nil {
		c.invalidate(relPath)
	}
	return err
}

// Delete delegates to backend and invalidates cache
func (c *CachedBackend) Delete(ctx context.Context, relPath string) error {
	err := c.backend.Delete(ctx, relPath)
	if err == nil {
		c.invalidate(relPath)
	}
	return err
}

// DeleteAll delegates to backend and invalidates cache
func (c *CachedBackend) DeleteAll(ctx context.Context, relPath string) error {
	err := c.backend.DeleteAll(ctx, relPath)
	if err == nil {
		c.invalidate(relPath)
	}
	return err
}

// Mkdir delegates to backend and invalidates cache
func (c *CachedBackend) Mkdir(ctx context.Context, relPath string) error {
	err := c.backend.Mkdir(ctx, relPath)
	if err == nil {
		c.invalidate(relPath)
	}
	return err
}

// Rename delegates to backend and invalidates cache
func (c *CachedBackend) Rename(ctx context.Context, oldPath, newPath string) error {
	err := c.backend.Rename(ctx, oldPath, newPath)
	if err == nil {
		c.invalidate(oldPath)
		c.invalidate(newPath)
	}
	return err
}

// Copy delegates to backend and invalidates cache
func (c *CachedBackend) Copy(ctx context.Context, srcPath, dstPath string) error {
	err := c.backend.Copy(ctx, srcPath, dstPath)
	if err == nil {
		c.invalidate(dstPath)
	}
	return err
}

// Walk delegates to backend (not cached)
func (c *CachedBackend) Walk(ctx context.Context, root string, walkFn StorageWalkFunc) error {
	return c.backend.Walk(ctx, root, walkFn)
}

// Exists delegates to backend
func (c *CachedBackend) Exists(ctx context.Context, relPath string) (bool, error) {
	return c.backend.Exists(ctx, relPath)
}

// GetRealPath delegates to backend
func (c *CachedBackend) GetRealPath(relPath string) (string, error) {
	return c.backend.GetRealPath(relPath)
}

// SetPermissions delegates to backend
func (c *CachedBackend) SetPermissions(ctx context.Context, relPath string, isDir bool) error {
	return c.backend.SetPermissions(ctx, relPath, isDir)
}

// CalculateSize delegates to backend
func (c *CachedBackend) CalculateSize(ctx context.Context, relPath string) (int64, error) {
	return c.backend.CalculateSize(ctx, relPath)
}

// ClearCache clears all cached entries
func (c *CachedBackend) ClearCache() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cache = make(map[string]cacheEntry)
}
