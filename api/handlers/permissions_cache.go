package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// PermissionCache handles caching of permission check results
type PermissionCache struct {
	client     *redis.Client
	prefix     string
	defaultTTL time.Duration
	localCache sync.Map // In-memory cache for fast access
}

// CachedPermission represents a cached permission check result
type CachedPermission struct {
	Allowed         bool      `json:"allowed"`
	PermissionLevel int       `json:"permissionLevel"`
	FolderID        string    `json:"folderId,omitempty"`
	FolderName      string    `json:"folderName,omitempty"`
	Reason          string    `json:"reason,omitempty"`
	CachedAt        time.Time `json:"cachedAt"`
}

// CachedFolderList represents cached list of accessible folders
type CachedFolderList struct {
	Folders  []string  `json:"folders"`
	CachedAt time.Time `json:"cachedAt"`
}

// PermissionCacheConfig holds cache configuration
type PermissionCacheConfig struct {
	RedisAddr  string
	RedisPass  string
	RedisDB    int
	KeyPrefix  string
	DefaultTTL time.Duration
}

// DefaultPermissionCacheConfig returns default configuration
func DefaultPermissionCacheConfig() PermissionCacheConfig {
	redisAddr := os.Getenv("VALKEY_HOST")
	if redisAddr == "" {
		redisAddr = "valkey"
	}
	redisPort := os.Getenv("VALKEY_PORT")
	if redisPort == "" {
		redisPort = "6379"
	}

	return PermissionCacheConfig{
		RedisAddr:  fmt.Sprintf("%s:%s", redisAddr, redisPort),
		RedisPass:  os.Getenv("VALKEY_PASSWORD"),
		RedisDB:    0,
		KeyPrefix:  "fh:perm:",
		DefaultTTL: 5 * time.Minute,
	}
}

// Global permission cache instance
var (
	globalPermCache *PermissionCache
	permCacheOnce   sync.Once
)

// GetPermissionCache returns the global permission cache instance
func GetPermissionCache() *PermissionCache {
	permCacheOnce.Do(func() {
		config := DefaultPermissionCacheConfig()
		cache, err := NewPermissionCache(config)
		if err != nil {
			LogError("Failed to create permission cache", err)
			return
		}
		globalPermCache = cache
	})
	return globalPermCache
}

// NewPermissionCache creates a new permission cache
func NewPermissionCache(config PermissionCacheConfig) (*PermissionCache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     config.RedisAddr,
		Password: config.RedisPass,
		DB:       config.RedisDB,
	})

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		LogWarn("Permission cache: Redis connection failed, using local cache only", "error", err)
	}

	cache := &PermissionCache{
		client:     client,
		prefix:     config.KeyPrefix,
		defaultTTL: config.DefaultTTL,
	}

	return cache, nil
}

// folderAccessKey generates cache key for folder access check
func (c *PermissionCache) folderAccessKey(userID, folderName string) string {
	return c.prefix + "folder:" + userID + ":" + folderName
}

// folderListKey generates cache key for accessible folder list
func (c *PermissionCache) folderListKey(userID string) string {
	return c.prefix + "list:" + userID
}

// GetFolderAccess retrieves cached folder access result
func (c *PermissionCache) GetFolderAccess(userID, folderName string) (*CachedPermission, bool) {
	key := c.folderAccessKey(userID, folderName)

	// Check local cache first
	if cached, ok := c.localCache.Load(key); ok {
		perm := cached.(*CachedPermission)
		if time.Since(perm.CachedAt) < c.defaultTTL {
			return perm, true
		}
		c.localCache.Delete(key)
	}

	// Try Redis
	if c.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		data, err := c.client.Get(ctx, key).Bytes()
		if err == nil {
			var perm CachedPermission
			if err := json.Unmarshal(data, &perm); err == nil {
				c.localCache.Store(key, &perm)
				return &perm, true
			}
		}
	}

	return nil, false
}

// SetFolderAccess stores folder access result in cache
func (c *PermissionCache) SetFolderAccess(userID, folderName string, result *ACLResult) {
	perm := &CachedPermission{
		Allowed:         result.Allowed,
		PermissionLevel: result.PermissionLevel,
		FolderID:        result.FolderID,
		FolderName:      result.FolderName,
		Reason:          result.Reason,
		CachedAt:        time.Now(),
	}

	key := c.folderAccessKey(userID, folderName)

	// Store in local cache
	c.localCache.Store(key, perm)

	// Store in Redis
	if c.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		data, err := json.Marshal(perm)
		if err == nil {
			c.client.Set(ctx, key, data, c.defaultTTL)
		}
	}
}

// GetFolderList retrieves cached list of accessible folders
func (c *PermissionCache) GetFolderList(userID string) ([]string, bool) {
	key := c.folderListKey(userID)

	// Check local cache first
	if cached, ok := c.localCache.Load(key); ok {
		list := cached.(*CachedFolderList)
		if time.Since(list.CachedAt) < c.defaultTTL {
			return list.Folders, true
		}
		c.localCache.Delete(key)
	}

	// Try Redis
	if c.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		data, err := c.client.Get(ctx, key).Bytes()
		if err == nil {
			var list CachedFolderList
			if err := json.Unmarshal(data, &list); err == nil {
				c.localCache.Store(key, &list)
				return list.Folders, true
			}
		}
	}

	return nil, false
}

// SetFolderList stores list of accessible folders in cache
func (c *PermissionCache) SetFolderList(userID string, folders []string) {
	list := &CachedFolderList{
		Folders:  folders,
		CachedAt: time.Now(),
	}

	key := c.folderListKey(userID)

	// Store in local cache
	c.localCache.Store(key, list)

	// Store in Redis
	if c.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		data, err := json.Marshal(list)
		if err == nil {
			c.client.Set(ctx, key, data, c.defaultTTL)
		}
	}
}

// InvalidateUser invalidates all permission cache for a user
func (c *PermissionCache) InvalidateUser(userID string) {
	// Clear local cache entries for user
	prefix := c.prefix
	c.localCache.Range(func(key, _ any) bool {
		if k, ok := key.(string); ok {
			if len(k) > len(prefix) && k[len(prefix):len(prefix)+5] != "list:" {
				// Check if key contains userID
				if contains(k, userID) {
					c.localCache.Delete(key)
				}
			}
		}
		return true
	})

	// Clear folder list
	c.localCache.Delete(c.folderListKey(userID))

	// Clear Redis entries
	if c.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		// Delete folder list
		c.client.Del(ctx, c.folderListKey(userID))

		// Delete folder access entries
		pattern := c.prefix + "folder:" + userID + ":*"
		iter := c.client.Scan(ctx, 0, pattern, 100).Iterator()
		for iter.Next(ctx) {
			c.client.Del(ctx, iter.Val())
		}

		// Delete file share entries
		pattern = c.prefix + "share:" + userID + ":*"
		iter = c.client.Scan(ctx, 0, pattern, 100).Iterator()
		for iter.Next(ctx) {
			c.client.Del(ctx, iter.Val())
		}
	}
}

// InvalidateFolder invalidates all permission cache for a shared folder
func (c *PermissionCache) InvalidateFolder(folderName string) {
	// Clear local cache entries for folder
	c.localCache.Range(func(key, _ any) bool {
		if k, ok := key.(string); ok {
			if contains(k, folderName) {
				c.localCache.Delete(key)
			}
		}
		return true
	})

	// Clear Redis entries
	if c.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		pattern := c.prefix + "folder:*:" + folderName
		iter := c.client.Scan(ctx, 0, pattern, 100).Iterator()
		for iter.Next(ctx) {
			c.client.Del(ctx, iter.Val())
		}

		// Also clear all user folder lists (they might include this folder)
		pattern = c.prefix + "list:*"
		iter = c.client.Scan(ctx, 0, pattern, 100).Iterator()
		for iter.Next(ctx) {
			c.client.Del(ctx, iter.Val())
		}
	}
}

// InvalidateAll clears all permission cache
func (c *PermissionCache) InvalidateAll() {
	// Clear local cache
	c.localCache.Range(func(key, _ any) bool {
		c.localCache.Delete(key)
		return true
	})

	// Clear Redis
	if c.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		pattern := c.prefix + "*"
		iter := c.client.Scan(ctx, 0, pattern, 100).Iterator()
		for iter.Next(ctx) {
			c.client.Del(ctx, iter.Val())
		}
	}
}

// GetCacheStats returns statistics about the permission cache
func (c *PermissionCache) GetCacheStats() map[string]any {
	var localCount int
	c.localCache.Range(func(_, _ any) bool {
		localCount++
		return true
	})

	stats := map[string]any{
		"localCacheSize": localCount,
		"ttlMinutes":     c.defaultTTL.Minutes(),
		"redisConnected": false,
	}

	if c.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		if err := c.client.Ping(ctx).Err(); err == nil {
			stats["redisConnected"] = true
		}
	}

	return stats
}

// contains checks if a string contains a substring
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsRune(s, substr))
}

func containsRune(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// Close closes the cache connection
func (c *PermissionCache) Close() error {
	if c.client != nil {
		return c.client.Close()
	}
	return nil
}
