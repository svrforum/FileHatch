package handlers

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// PreviewCache handles caching of file previews
type PreviewCache struct {
	cacheDir    string
	maxAge      time.Duration
	mu          sync.RWMutex
	cleanupOnce sync.Once
}

// PreviewCacheConfig holds configuration for preview cache
type PreviewCacheConfig struct {
	CacheDir string
	MaxAge   time.Duration
}

// DefaultPreviewCacheConfig returns default cache configuration
func DefaultPreviewCacheConfig() PreviewCacheConfig {
	return PreviewCacheConfig{
		CacheDir: "/data/.cache/previews",
		MaxAge:   24 * time.Hour,
	}
}

// NewPreviewCache creates a new preview cache
func NewPreviewCache(config PreviewCacheConfig) (*PreviewCache, error) {
	if config.CacheDir == "" {
		config.CacheDir = DefaultPreviewCacheConfig().CacheDir
	}
	if config.MaxAge == 0 {
		config.MaxAge = DefaultPreviewCacheConfig().MaxAge
	}

	// Create cache directory
	if err := os.MkdirAll(config.CacheDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create cache directory: %w", err)
	}

	cache := &PreviewCache{
		cacheDir: config.CacheDir,
		maxAge:   config.MaxAge,
	}

	return cache, nil
}

// generateCacheKey generates a unique cache key for a file
func (c *PreviewCache) generateCacheKey(filePath string, modTime time.Time, suffix string) string {
	// Hash the file path + modification time for uniqueness
	data := fmt.Sprintf("%s:%d:%s", filePath, modTime.UnixNano(), suffix)
	hash := md5.Sum([]byte(data))
	return hex.EncodeToString(hash[:])
}

// GetCachePath returns the cache file path for a given key
func (c *PreviewCache) GetCachePath(key string) string {
	// Use first 2 characters as subdirectory for better distribution
	subDir := key[:2]
	return filepath.Join(c.cacheDir, subDir, key)
}

// Get retrieves a cached preview if it exists and is valid
func (c *PreviewCache) Get(filePath string, modTime time.Time, suffix string) ([]byte, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	key := c.generateCacheKey(filePath, modTime, suffix)
	cachePath := c.GetCachePath(key)

	info, err := os.Stat(cachePath)
	if err != nil {
		return nil, false
	}

	// Check if cache is still valid
	if time.Since(info.ModTime()) > c.maxAge {
		return nil, false
	}

	data, err := os.ReadFile(cachePath)
	if err != nil {
		return nil, false
	}

	return data, true
}

// Set stores a preview in the cache
func (c *PreviewCache) Set(filePath string, modTime time.Time, suffix string, data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := c.generateCacheKey(filePath, modTime, suffix)
	cachePath := c.GetCachePath(key)

	// Ensure directory exists
	dir := filepath.Dir(cachePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create cache subdirectory: %w", err)
	}

	// Write cache file
	if err := os.WriteFile(cachePath, data, 0644); err != nil {
		return fmt.Errorf("failed to write cache file: %w", err)
	}

	return nil
}

// GenerateETag generates an ETag for a file based on path and modification time
func GenerateETag(filePath string, modTime time.Time, size int64) string {
	data := fmt.Sprintf("%s:%d:%d", filePath, modTime.UnixNano(), size)
	hash := md5.Sum([]byte(data))
	return fmt.Sprintf(`"%s"`, hex.EncodeToString(hash[:16]))
}

// CheckETag checks if the client's If-None-Match header matches the current ETag
// Returns true if content should be returned (no match), false if 304 should be sent
func CheckETag(r *http.Request, etag string) bool {
	clientETag := r.Header.Get("If-None-Match")
	if clientETag == "" {
		return true
	}

	// Handle multiple ETags and weak ETags
	clientETag = strings.TrimPrefix(clientETag, "W/")
	etag = strings.TrimPrefix(etag, "W/")

	return clientETag != etag
}

// SetCacheHeaders sets appropriate cache headers for preview responses
func SetCacheHeaders(w http.ResponseWriter, etag string, maxAge int) {
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d", maxAge))
	w.Header().Set("Vary", "Accept-Encoding")
}

// SetNoCacheHeaders sets headers to prevent caching
func SetNoCacheHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
}

// StartCleanup starts a background goroutine to clean up old cache entries
func (c *PreviewCache) StartCleanup(interval time.Duration) {
	c.cleanupOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(interval)
			defer ticker.Stop()

			for range ticker.C {
				c.cleanup()
			}
		}()
	})
}

// cleanup removes expired cache entries
func (c *PreviewCache) cleanup() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	removed := 0

	_ = filepath.Walk(c.cacheDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if info.IsDir() {
			return nil
		}

		if now.Sub(info.ModTime()) > c.maxAge {
			os.Remove(path)
			removed++
		}

		return nil
	})

	if removed > 0 {
		LogInfo("Preview cache cleanup", "removed", removed)
	}
}

// Clear removes all cached previews
func (c *PreviewCache) Clear() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Remove all files in cache directory
	return filepath.Walk(c.cacheDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if path == c.cacheDir {
			return nil
		}

		if info.IsDir() {
			os.RemoveAll(path)
			return filepath.SkipDir
		}

		return os.Remove(path)
	})
}

// GetStats returns cache statistics
func (c *PreviewCache) GetStats() (totalFiles int, totalSize int64, oldestEntry time.Time) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	oldestEntry = time.Now()

	_ = filepath.Walk(c.cacheDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		totalFiles++
		totalSize += info.Size()

		if info.ModTime().Before(oldestEntry) {
			oldestEntry = info.ModTime()
		}

		return nil
	})

	return
}

// ImagePreviewOptions holds options for image preview generation
type ImagePreviewOptions struct {
	MaxWidth  int
	MaxHeight int
	Quality   int
}

// DefaultImagePreviewOptions returns default options for image previews
func DefaultImagePreviewOptions() ImagePreviewOptions {
	return ImagePreviewOptions{
		MaxWidth:  800,
		MaxHeight: 600,
		Quality:   85,
	}
}

// TextPreviewOptions holds options for text preview generation
type TextPreviewOptions struct {
	MaxBytes int
	Encoding string
}

// DefaultTextPreviewOptions returns default options for text previews
func DefaultTextPreviewOptions() TextPreviewOptions {
	return TextPreviewOptions{
		MaxBytes: 100 * 1024, // 100KB
		Encoding: "utf-8",
	}
}

// CachedTextPreview reads and caches text file preview
func (c *PreviewCache) CachedTextPreview(filePath string, info os.FileInfo, opts TextPreviewOptions) (string, bool, error) {
	suffix := fmt.Sprintf("text:%d", opts.MaxBytes)

	// Try to get from cache
	if data, ok := c.Get(filePath, info.ModTime(), suffix); ok {
		// Check if content was truncated (last byte is 1 for truncated, 0 for not)
		if len(data) > 0 {
			truncated := data[len(data)-1] == 1
			return string(data[:len(data)-1]), truncated, nil
		}
	}

	// Read from file
	file, err := os.Open(filePath)
	if err != nil {
		return "", false, err
	}
	defer file.Close()

	content := make([]byte, opts.MaxBytes)
	n, err := file.Read(content)
	if err != nil && err != io.EOF {
		return "", false, err
	}

	truncated := n == opts.MaxBytes

	// Cache the content with truncation flag
	cacheData := make([]byte, n+1)
	copy(cacheData, content[:n])
	if truncated {
		cacheData[n] = 1
	} else {
		cacheData[n] = 0
	}
	_ = c.Set(filePath, info.ModTime(), suffix, cacheData)

	return string(content[:n]), truncated, nil
}

// PreviewResponse represents a cached preview response
type PreviewResponse struct {
	ETag         string
	LastModified time.Time
	ContentType  string
	Data         []byte
	IsCached     bool
}

// ServeWithCache serves a file with proper caching headers
func ServeFileWithCache(w http.ResponseWriter, r *http.Request, filePath string, info os.FileInfo) error {
	etag := GenerateETag(filePath, info.ModTime(), info.Size())

	// Check If-None-Match
	if !CheckETag(r, etag) {
		w.WriteHeader(http.StatusNotModified)
		return nil
	}

	// Check If-Modified-Since
	if ims := r.Header.Get("If-Modified-Since"); ims != "" {
		if t, err := http.ParseTime(ims); err == nil {
			if !info.ModTime().After(t) {
				w.WriteHeader(http.StatusNotModified)
				return nil
			}
		}
	}

	// Set cache headers
	SetCacheHeaders(w, etag, 86400) // 24 hours
	w.Header().Set("Last-Modified", info.ModTime().UTC().Format(http.TimeFormat))

	// Determine content type
	ext := strings.ToLower(filepath.Ext(filePath))
	contentType := getMimeType(strings.TrimPrefix(ext, "."))
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))

	// Serve file
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	_, err = io.Copy(w, file)
	return err
}

// Global preview cache instance
var globalPreviewCache *PreviewCache
var previewCacheOnce sync.Once

// GetPreviewCache returns the global preview cache instance
func GetPreviewCache() *PreviewCache {
	previewCacheOnce.Do(func() {
		var err error
		globalPreviewCache, err = NewPreviewCache(DefaultPreviewCacheConfig())
		if err != nil {
			LogError("Failed to create preview cache", err)
			return
		}
		// Start cleanup every hour
		globalPreviewCache.StartCleanup(time.Hour)
	})
	return globalPreviewCache
}
