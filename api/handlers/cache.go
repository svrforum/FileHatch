package handlers

import (
	"sync"
	"time"
)

// CacheEntry represents a cached value with expiration
type CacheEntry struct {
	Value     interface{}
	ExpiresAt time.Time
}

// MemoryCache is a simple in-memory cache with TTL support
type MemoryCache struct {
	mu      sync.RWMutex
	entries map[string]CacheEntry
	ttl     time.Duration
}

// NewMemoryCache creates a new memory cache with the specified TTL
func NewMemoryCache(ttl time.Duration) *MemoryCache {
	cache := &MemoryCache{
		entries: make(map[string]CacheEntry),
		ttl:     ttl,
	}

	// Start background cleanup goroutine
	go cache.cleanup()

	return cache
}

// Get retrieves a value from the cache
func (c *MemoryCache) Get(key string) (interface{}, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, exists := c.entries[key]
	if !exists {
		return nil, false
	}

	if time.Now().After(entry.ExpiresAt) {
		return nil, false
	}

	return entry.Value, true
}

// Set stores a value in the cache with the default TTL
func (c *MemoryCache) Set(key string, value interface{}) {
	c.SetWithTTL(key, value, c.ttl)
}

// SetWithTTL stores a value in the cache with a custom TTL
func (c *MemoryCache) SetWithTTL(key string, value interface{}, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries[key] = CacheEntry{
		Value:     value,
		ExpiresAt: time.Now().Add(ttl),
	}
}

// Delete removes a value from the cache
func (c *MemoryCache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	delete(c.entries, key)
}

// DeletePrefix removes all values with keys starting with the given prefix
func (c *MemoryCache) DeletePrefix(prefix string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	for key := range c.entries {
		if len(key) >= len(prefix) && key[:len(prefix)] == prefix {
			delete(c.entries, key)
		}
	}
}

// cleanup removes expired entries periodically
func (c *MemoryCache) cleanup() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		c.mu.Lock()
		now := time.Now()
		for key, entry := range c.entries {
			if now.After(entry.ExpiresAt) {
				delete(c.entries, key)
			}
		}
		c.mu.Unlock()
	}
}

// StorageUsageCache is a specialized cache for storage usage data
type StorageUsageCache struct {
	cache *MemoryCache
}

// StorageUsageData represents cached storage usage
type StorageUsageData struct {
	HomeUsed   int64 `json:"homeUsed"`
	SharedUsed int64 `json:"sharedUsed"`
	TrashUsed  int64 `json:"trashUsed"`
	TotalUsed  int64 `json:"totalUsed"`
	Quota      int64 `json:"quota"`
	CachedAt   int64 `json:"cachedAt"`
}

var (
	storageCache     *StorageUsageCache
	storageCacheOnce sync.Once
)

// GetStorageCache returns the global storage cache instance
func GetStorageCache() *StorageUsageCache {
	storageCacheOnce.Do(func() {
		// Cache storage usage for 30 seconds
		storageCache = &StorageUsageCache{
			cache: NewMemoryCache(30 * time.Second),
		}
	})
	return storageCache
}

// GetUserUsage retrieves cached storage usage for a user
func (s *StorageUsageCache) GetUserUsage(username string) (*StorageUsageData, bool) {
	key := "storage:" + username
	if value, ok := s.cache.Get(key); ok {
		if data, ok := value.(*StorageUsageData); ok {
			return data, true
		}
	}
	return nil, false
}

// SetUserUsage caches storage usage for a user
func (s *StorageUsageCache) SetUserUsage(username string, data *StorageUsageData) {
	key := "storage:" + username
	data.CachedAt = time.Now().Unix()
	s.cache.Set(key, data)
}

// InvalidateUserUsage removes cached storage usage for a user
func (s *StorageUsageCache) InvalidateUserUsage(username string) {
	key := "storage:" + username
	s.cache.Delete(key)
}

// InvalidateAllUsage removes all cached storage usage
func (s *StorageUsageCache) InvalidateAllUsage() {
	s.cache.DeletePrefix("storage:")
}

// GetSharedUsage retrieves cached shared storage usage
func (s *StorageUsageCache) GetSharedUsage() (int64, bool) {
	if value, ok := s.cache.Get("shared_storage"); ok {
		if size, ok := value.(int64); ok {
			return size, true
		}
	}
	return 0, false
}

// SetSharedUsage caches shared storage usage (longer TTL - 5 minutes)
func (s *StorageUsageCache) SetSharedUsage(size int64) {
	s.cache.SetWithTTL("shared_storage", size, 5*time.Minute)
}

// InvalidateSharedUsage removes cached shared storage usage
func (s *StorageUsageCache) InvalidateSharedUsage() {
	s.cache.Delete("shared_storage")
}
