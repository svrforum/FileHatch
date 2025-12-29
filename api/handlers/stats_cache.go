package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// StatsCache handles caching of folder statistics
type StatsCache struct {
	client     *redis.Client
	prefix     string
	defaultTTL time.Duration
	localCache sync.Map // In-memory cache for frequently accessed stats
}

// CachedFolderStats represents cached folder statistics
type CachedFolderStats struct {
	FileCount  int64     `json:"fileCount"`
	FolderCount int64    `json:"folderCount"`
	TotalSize  int64     `json:"totalSize"`
	LastUpdate time.Time `json:"lastUpdate"`
	DirModTime time.Time `json:"dirModTime"` // Directory modification time for cache invalidation
}

// StatsCacheConfig holds cache configuration
type StatsCacheConfig struct {
	RedisAddr    string
	RedisPass    string
	RedisDB      int
	KeyPrefix    string
	DefaultTTL   time.Duration
	LocalCacheTTL time.Duration
}

// DefaultStatsCacheConfig returns default configuration
func DefaultStatsCacheConfig() StatsCacheConfig {
	redisAddr := os.Getenv("VALKEY_HOST")
	if redisAddr == "" {
		redisAddr = "valkey"
	}
	redisPort := os.Getenv("VALKEY_PORT")
	if redisPort == "" {
		redisPort = "6379"
	}

	return StatsCacheConfig{
		RedisAddr:     fmt.Sprintf("%s:%s", redisAddr, redisPort),
		RedisPass:     os.Getenv("VALKEY_PASSWORD"),
		RedisDB:       0,
		KeyPrefix:     "scv:stats:",
		DefaultTTL:    30 * time.Minute,
		LocalCacheTTL: 5 * time.Minute,
	}
}

// Global stats cache instance
var (
	globalStatsCache *StatsCache
	statsCacheOnce   sync.Once
)

// GetStatsCache returns the global stats cache instance
func GetStatsCache() *StatsCache {
	statsCacheOnce.Do(func() {
		config := DefaultStatsCacheConfig()
		cache, err := NewStatsCache(config)
		if err != nil {
			LogError("Failed to create stats cache", err)
			return
		}
		globalStatsCache = cache
	})
	return globalStatsCache
}

// NewStatsCache creates a new stats cache
func NewStatsCache(config StatsCacheConfig) (*StatsCache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     config.RedisAddr,
		Password: config.RedisPass,
		DB:       config.RedisDB,
	})

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		LogWarn("Stats cache: Redis connection failed, using local cache only", "error", err)
		// Continue without Redis, use local cache only
	}

	cache := &StatsCache{
		client:     client,
		prefix:     config.KeyPrefix,
		defaultTTL: config.DefaultTTL,
	}

	return cache, nil
}

// getCacheKey generates a cache key for a path
func (c *StatsCache) getCacheKey(path string) string {
	return c.prefix + path
}

// Get retrieves folder stats from cache
func (c *StatsCache) Get(path string) (*CachedFolderStats, bool) {
	// Check local cache first
	if cached, ok := c.localCache.Load(path); ok {
		stats := cached.(*CachedFolderStats)
		// Check if local cache is still valid (5 minutes)
		if time.Since(stats.LastUpdate) < 5*time.Minute {
			return stats, true
		}
		c.localCache.Delete(path)
	}

	// Try Redis
	if c.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		key := c.getCacheKey(path)
		data, err := c.client.Get(ctx, key).Bytes()
		if err == nil {
			var stats CachedFolderStats
			if err := json.Unmarshal(data, &stats); err == nil {
				// Store in local cache
				c.localCache.Store(path, &stats)
				return &stats, true
			}
		}
	}

	return nil, false
}

// Set stores folder stats in cache
func (c *StatsCache) Set(path string, stats *CachedFolderStats) error {
	stats.LastUpdate = time.Now()

	// Store in local cache
	c.localCache.Store(path, stats)

	// Store in Redis
	if c.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		data, err := json.Marshal(stats)
		if err != nil {
			return err
		}

		key := c.getCacheKey(path)
		return c.client.Set(ctx, key, data, c.defaultTTL).Err()
	}

	return nil
}

// Invalidate removes stats for a path and its parents from cache
func (c *StatsCache) Invalidate(path string) {
	// Invalidate local cache
	c.localCache.Delete(path)

	// Invalidate parent paths
	for p := filepath.Dir(path); p != "/" && p != "."; p = filepath.Dir(p) {
		c.localCache.Delete(p)
	}

	// Invalidate Redis
	if c.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		key := c.getCacheKey(path)
		c.client.Del(ctx, key)

		// Invalidate parent paths
		for p := filepath.Dir(path); p != "/" && p != "."; p = filepath.Dir(p) {
			c.client.Del(ctx, c.getCacheKey(p))
		}
	}
}

// InvalidatePattern removes all stats matching a pattern
func (c *StatsCache) InvalidatePattern(pattern string) {
	// Clear local cache entries matching pattern
	c.localCache.Range(func(key, _ interface{}) bool {
		if matched, _ := filepath.Match(pattern, key.(string)); matched {
			c.localCache.Delete(key)
		}
		return true
	})

	// Clear Redis entries
	if c.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		redisPattern := c.prefix + pattern
		iter := c.client.Scan(ctx, 0, redisPattern, 100).Iterator()
		for iter.Next(ctx) {
			c.client.Del(ctx, iter.Val())
		}
	}
}

// GetOrCompute gets stats from cache or computes them if not cached
func (c *StatsCache) GetOrCompute(path string, computeFn func() (*CachedFolderStats, error)) (*CachedFolderStats, error) {
	// Check directory modification time for cache invalidation
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}

	// Try cache first
	if cached, ok := c.Get(path); ok {
		// Validate cache by checking if directory was modified
		if !info.ModTime().After(cached.DirModTime) {
			return cached, nil
		}
		// Cache is stale, compute new stats
	}

	// Compute stats
	stats, err := computeFn()
	if err != nil {
		return nil, err
	}

	// Store directory mod time for cache invalidation
	stats.DirModTime = info.ModTime()

	// Cache the result
	c.Set(path, stats)

	return stats, nil
}

// BatchGet retrieves multiple folder stats
func (c *StatsCache) BatchGet(paths []string) map[string]*CachedFolderStats {
	results := make(map[string]*CachedFolderStats)

	// First, check local cache
	var uncached []string
	for _, path := range paths {
		if cached, ok := c.localCache.Load(path); ok {
			stats := cached.(*CachedFolderStats)
			if time.Since(stats.LastUpdate) < 5*time.Minute {
				results[path] = stats
				continue
			}
		}
		uncached = append(uncached, path)
	}

	// Then, try Redis for uncached paths
	if c.client != nil && len(uncached) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		keys := make([]string, len(uncached))
		for i, path := range uncached {
			keys[i] = c.getCacheKey(path)
		}

		values, err := c.client.MGet(ctx, keys...).Result()
		if err == nil {
			for i, val := range values {
				if val != nil {
					var stats CachedFolderStats
					if data, ok := val.(string); ok {
						if err := json.Unmarshal([]byte(data), &stats); err == nil {
							path := uncached[i]
							results[path] = &stats
							c.localCache.Store(path, &stats)
						}
					}
				}
			}
		}
	}

	return results
}

// Close closes the cache connection
func (c *StatsCache) Close() error {
	if c.client != nil {
		return c.client.Close()
	}
	return nil
}

// GetCacheStats returns statistics about the cache
func (c *StatsCache) GetCacheStats() map[string]interface{} {
	var localCount int
	c.localCache.Range(func(_, _ interface{}) bool {
		localCount++
		return true
	})

	stats := map[string]interface{}{
		"localCacheSize": localCount,
		"redisConnected": false,
	}

	if c.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		if err := c.client.Ping(ctx).Err(); err == nil {
			stats["redisConnected"] = true

			// Get Redis memory info
			info, err := c.client.Info(ctx, "memory").Result()
			if err == nil {
				stats["redisInfo"] = info
			}
		}
	}

	return stats
}

// Warmup preloads stats for common paths
func (c *StatsCache) Warmup(basePath string, depth int) {
	if depth <= 0 {
		return
	}

	entries, err := os.ReadDir(basePath)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if entry.IsDir() {
			path := filepath.Join(basePath, entry.Name())

			// Compute and cache stats for this directory
			go func(p string) {
				stats, err := computeFolderStats(p)
				if err == nil {
					c.Set(p, stats)
				}
			}(path)

			// Recurse into subdirectories
			if depth > 1 {
				c.Warmup(path, depth-1)
			}
		}
	}
}

// computeFolderStats calculates folder statistics
func computeFolderStats(path string) (*CachedFolderStats, error) {
	var fileCount, folderCount, totalSize int64

	err := filepath.Walk(path, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors, continue walking
		}
		if p == path {
			return nil // Skip root
		}
		if info.IsDir() {
			folderCount++
		} else {
			fileCount++
			totalSize += info.Size()
		}
		return nil
	})

	if err != nil {
		return nil, err
	}

	return &CachedFolderStats{
		FileCount:   fileCount,
		FolderCount: folderCount,
		TotalSize:   totalSize,
	}, nil
}
