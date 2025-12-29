package handlers

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/gif" // GIF decode support
	_ "image/png" // PNG decode support
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // WebP decode support
)

// ThumbnailSize represents predefined thumbnail sizes
type ThumbnailSize struct {
	Width  int
	Height int
	Name   string
}

var (
	// Predefined thumbnail sizes
	ThumbnailSizes = map[string]ThumbnailSize{
		"small":  {Width: 100, Height: 100, Name: "small"},
		"medium": {Width: 300, Height: 300, Name: "medium"},
		"large":  {Width: 800, Height: 600, Name: "large"},
	}

	// Supported image extensions
	supportedImageExts = map[string]bool{
		".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true, ".bmp": true,
	}

	// Supported video extensions
	supportedVideoExts = map[string]bool{
		".mp4": true, ".mkv": true, ".avi": true, ".mov": true, ".wmv": true, ".flv": true, ".webm": true,
	}

	// Thumbnail worker pool
	thumbnailWorkerPool *ThumbnailWorkerPool
	thumbnailPoolOnce   sync.Once
)

// ThumbnailWorkerPool manages background thumbnail generation
type ThumbnailWorkerPool struct {
	jobs    chan ThumbnailJob
	workers int
	wg      sync.WaitGroup
	cache   *PreviewCache
}

// ThumbnailJob represents a thumbnail generation job
type ThumbnailJob struct {
	FilePath    string
	CacheKey    string
	Size        ThumbnailSize
	IsVideo     bool
	ModTime     time.Time
	ResultChan  chan ThumbnailResult
}

// ThumbnailResult contains the result of thumbnail generation
type ThumbnailResult struct {
	Data  []byte
	Error error
}

// NewThumbnailWorkerPool creates a new worker pool
func NewThumbnailWorkerPool(workers int, cache *PreviewCache) *ThumbnailWorkerPool {
	pool := &ThumbnailWorkerPool{
		jobs:    make(chan ThumbnailJob, 100),
		workers: workers,
		cache:   cache,
	}

	// Start workers
	for i := 0; i < workers; i++ {
		pool.wg.Add(1)
		go pool.worker()
	}

	return pool
}

// worker processes thumbnail jobs
func (p *ThumbnailWorkerPool) worker() {
	defer p.wg.Done()

	for job := range p.jobs {
		var data []byte
		var err error

		if job.IsVideo {
			data, err = generateVideoThumbnail(job.FilePath, job.Size)
		} else {
			data, err = generateImageThumbnail(job.FilePath, job.Size)
		}

		// Cache the result
		if err == nil && len(data) > 0 && p.cache != nil {
			suffix := fmt.Sprintf("thumb:%s", job.Size.Name)
			p.cache.Set(job.FilePath, job.ModTime, suffix, data)
		}

		// Send result if channel provided
		if job.ResultChan != nil {
			job.ResultChan <- ThumbnailResult{Data: data, Error: err}
		}
	}
}

// Submit adds a job to the worker pool
func (p *ThumbnailWorkerPool) Submit(job ThumbnailJob) {
	select {
	case p.jobs <- job:
	default:
		// Queue is full, skip job
		if job.ResultChan != nil {
			job.ResultChan <- ThumbnailResult{Error: fmt.Errorf("worker queue full")}
		}
	}
}

// Close shuts down the worker pool
func (p *ThumbnailWorkerPool) Close() {
	close(p.jobs)
	p.wg.Wait()
}

// GetThumbnailWorkerPool returns the global thumbnail worker pool
func GetThumbnailWorkerPool() *ThumbnailWorkerPool {
	thumbnailPoolOnce.Do(func() {
		cache := GetPreviewCache()
		thumbnailWorkerPool = NewThumbnailWorkerPool(4, cache) // 4 workers
	})
	return thumbnailWorkerPool
}

// GetThumbnail handles thumbnail requests
func (h *Handler) GetThumbnail(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "File path required",
		})
	}

	// Get size parameter (default: medium)
	sizeName := c.QueryParam("size")
	if sizeName == "" {
		sizeName = "medium"
	}

	size, ok := ThumbnailSizes[sizeName]
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid size. Use: small, medium, or large",
		})
	}

	// Get format parameter (default: jpeg, can be webp)
	format := c.QueryParam("format")
	if format == "" {
		format = "jpeg"
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	realPath, _, _, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	info, err := os.Stat(realPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "File not found",
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to access file",
		})
	}

	if info.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Path is a directory",
		})
	}

	ext := strings.ToLower(filepath.Ext(info.Name()))
	isImage := supportedImageExts[ext]
	isVideo := supportedVideoExts[ext]

	if !isImage && !isVideo {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Unsupported file type for thumbnail",
		})
	}

	// Generate ETag
	etag := GenerateETag(realPath+sizeName+format, info.ModTime(), info.Size())

	// Check If-None-Match
	if !CheckETag(c.Request(), etag) {
		return c.NoContent(http.StatusNotModified)
	}

	// Try to get from cache
	cache := GetPreviewCache()
	suffix := fmt.Sprintf("thumb:%s:%s", sizeName, format)
	if cache != nil {
		if data, ok := cache.Get(realPath, info.ModTime(), suffix); ok {
			SetCacheHeaders(c.Response().Writer, etag, 604800) // 7 days
			contentType := "image/jpeg"
			if format == "webp" {
				contentType = "image/webp"
			}
			c.Response().Header().Set("Content-Type", contentType)
			c.Response().Header().Set("X-Thumbnail-Cached", "true")
			return c.Blob(http.StatusOK, contentType, data)
		}
	}

	// Generate thumbnail
	var thumbData []byte
	if isVideo {
		thumbData, err = generateVideoThumbnail(realPath, size)
	} else {
		thumbData, err = generateImageThumbnail(realPath, size)
	}

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": fmt.Sprintf("Failed to generate thumbnail: %v", err),
		})
	}

	// Convert to WebP if requested
	if format == "webp" && len(thumbData) > 0 {
		webpData, webpErr := convertToWebP(thumbData)
		if webpErr == nil {
			thumbData = webpData
		}
	}

	// Cache the result
	if cache != nil && len(thumbData) > 0 {
		cache.Set(realPath, info.ModTime(), suffix, thumbData)
	}

	SetCacheHeaders(c.Response().Writer, etag, 604800) // 7 days
	contentType := "image/jpeg"
	if format == "webp" {
		contentType = "image/webp"
	}
	return c.Blob(http.StatusOK, contentType, thumbData)
}

// generateImageThumbnail creates a thumbnail from an image file
func generateImageThumbnail(filePath string, size ThumbnailSize) ([]byte, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	// Decode image
	img, _, err := image.Decode(file)
	if err != nil {
		return nil, fmt.Errorf("failed to decode image: %w", err)
	}

	// Calculate new dimensions maintaining aspect ratio
	bounds := img.Bounds()
	origWidth := bounds.Dx()
	origHeight := bounds.Dy()

	newWidth, newHeight := calculateThumbnailSize(origWidth, origHeight, size.Width, size.Height)

	// Create thumbnail
	thumb := image.NewRGBA(image.Rect(0, 0, newWidth, newHeight))
	draw.CatmullRom.Scale(thumb, thumb.Bounds(), img, bounds, draw.Over, nil)

	// Encode as JPEG
	var buf bytes.Buffer
	err = jpeg.Encode(&buf, thumb, &jpeg.Options{Quality: 85})
	if err != nil {
		return nil, fmt.Errorf("failed to encode thumbnail: %w", err)
	}

	return buf.Bytes(), nil
}

// generateVideoThumbnail creates a thumbnail from a video file using FFmpeg
func generateVideoThumbnail(filePath string, size ThumbnailSize) ([]byte, error) {
	// Check if FFmpeg is available
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return nil, fmt.Errorf("ffmpeg not found: %w", err)
	}

	// Create temporary file for output
	tmpFile, err := os.CreateTemp("", "thumb_*.jpg")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpPath)

	// FFmpeg command to extract frame at 10% of video duration
	// -ss 00:00:05 seeks to 5 seconds (or use -vf "thumbnail" for smart selection)
	args := []string{
		"-i", filePath,
		"-ss", "00:00:05",
		"-vframes", "1",
		"-vf", fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease", size.Width, size.Height),
		"-q:v", "2",
		"-y",
		tmpPath,
	}

	cmd := exec.Command("ffmpeg", args...)
	if err := cmd.Run(); err != nil {
		// Try at beginning of video if seek fails
		args[2] = "00:00:01"
		cmd = exec.Command("ffmpeg", args...)
		if err := cmd.Run(); err != nil {
			return nil, fmt.Errorf("ffmpeg failed: %w", err)
		}
	}

	// Read the generated thumbnail
	data, err := os.ReadFile(tmpPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read thumbnail: %w", err)
	}

	return data, nil
}

// calculateThumbnailSize calculates new dimensions maintaining aspect ratio
func calculateThumbnailSize(origWidth, origHeight, maxWidth, maxHeight int) (int, int) {
	if origWidth <= maxWidth && origHeight <= maxHeight {
		return origWidth, origHeight
	}

	ratio := float64(origWidth) / float64(origHeight)
	targetRatio := float64(maxWidth) / float64(maxHeight)

	var newWidth, newHeight int
	if ratio > targetRatio {
		// Width is the limiting factor
		newWidth = maxWidth
		newHeight = int(float64(maxWidth) / ratio)
	} else {
		// Height is the limiting factor
		newHeight = maxHeight
		newWidth = int(float64(maxHeight) * ratio)
	}

	if newWidth < 1 {
		newWidth = 1
	}
	if newHeight < 1 {
		newHeight = 1
	}

	return newWidth, newHeight
}

// convertToWebP converts JPEG data to WebP format using cwebp
func convertToWebP(jpegData []byte) ([]byte, error) {
	// Check if cwebp is available
	if _, err := exec.LookPath("cwebp"); err != nil {
		return nil, fmt.Errorf("cwebp not found: %w", err)
	}

	// Create temp files
	inputFile, err := os.CreateTemp("", "input_*.jpg")
	if err != nil {
		return nil, err
	}
	defer os.Remove(inputFile.Name())

	outputFile, err := os.CreateTemp("", "output_*.webp")
	if err != nil {
		return nil, err
	}
	outputPath := outputFile.Name()
	outputFile.Close()
	defer os.Remove(outputPath)

	// Write input
	if _, err := inputFile.Write(jpegData); err != nil {
		return nil, err
	}
	inputFile.Close()

	// Convert
	cmd := exec.Command("cwebp", "-q", "80", inputFile.Name(), "-o", outputPath)
	if err := cmd.Run(); err != nil {
		return nil, err
	}

	return os.ReadFile(outputPath)
}

// PreloadThumbnails generates thumbnails for files in a directory in background
func (h *Handler) PreloadThumbnails(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		requestPath = "/"
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	realPath, _, _, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	info, err := os.Stat(realPath)
	if err != nil || !info.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid directory",
		})
	}

	// Get limit (default 50)
	limit := 50
	if l := c.QueryParam("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 200 {
			limit = parsed
		}
	}

	pool := GetThumbnailWorkerPool()
	cache := GetPreviewCache()
	queued := 0

	entries, err := os.ReadDir(realPath)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to read directory",
		})
	}

	for _, entry := range entries {
		if entry.IsDir() || queued >= limit {
			continue
		}

		ext := strings.ToLower(filepath.Ext(entry.Name()))
		isImage := supportedImageExts[ext]
		isVideo := supportedVideoExts[ext]

		if !isImage && !isVideo {
			continue
		}

		filePath := filepath.Join(realPath, entry.Name())
		fileInfo, err := entry.Info()
		if err != nil {
			continue
		}

		// Check if already cached
		suffix := fmt.Sprintf("thumb:%s:jpeg", "medium")
		if cache != nil {
			if _, ok := cache.Get(filePath, fileInfo.ModTime(), suffix); ok {
				continue // Already cached
			}
		}

		// Queue for generation
		pool.Submit(ThumbnailJob{
			FilePath: filePath,
			Size:     ThumbnailSizes["medium"],
			IsVideo:  isVideo,
			ModTime:  fileInfo.ModTime(),
		})
		queued++
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"queued": queued,
		"path":   requestPath,
	})
}

// BatchThumbnailRequest represents a request for multiple thumbnails
type BatchThumbnailRequest struct {
	Paths []string `json:"paths"`
	Size  string   `json:"size"`
}

// GetBatchThumbnails returns multiple thumbnails at once
func (h *Handler) GetBatchThumbnails(c echo.Context) error {
	var req BatchThumbnailRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request body",
		})
	}

	if len(req.Paths) == 0 || len(req.Paths) > 50 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Paths must contain 1-50 items",
		})
	}

	sizeName := req.Size
	if sizeName == "" {
		sizeName = "small"
	}

	size, ok := ThumbnailSizes[sizeName]
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid size",
		})
	}

	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	cache := GetPreviewCache()
	results := make(map[string]interface{})

	for _, path := range req.Paths {
		realPath, _, _, err := h.resolvePath(path, claims)
		if err != nil {
			results[path] = map[string]string{"error": "access denied"}
			continue
		}

		info, err := os.Stat(realPath)
		if err != nil {
			results[path] = map[string]string{"error": "not found"}
			continue
		}

		ext := strings.ToLower(filepath.Ext(info.Name()))
		isImage := supportedImageExts[ext]
		isVideo := supportedVideoExts[ext]

		if !isImage && !isVideo {
			results[path] = map[string]string{"error": "unsupported"}
			continue
		}

		// Try cache
		suffix := fmt.Sprintf("thumb:%s:jpeg", sizeName)
		if cache != nil {
			if _, ok := cache.Get(realPath, info.ModTime(), suffix); ok {
				results[path] = map[string]interface{}{
					"status": "cached",
					"url":    fmt.Sprintf("/api/thumbnail/%s?size=%s", strings.TrimPrefix(path, "/"), sizeName),
				}
				continue
			}
		}

		// Queue for generation
		pool := GetThumbnailWorkerPool()
		pool.Submit(ThumbnailJob{
			FilePath: realPath,
			Size:     size,
			IsVideo:  isVideo,
			ModTime:  info.ModTime(),
		})

		results[path] = map[string]interface{}{
			"status": "queued",
			"url":    fmt.Sprintf("/api/thumbnail/%s?size=%s", strings.TrimPrefix(path, "/"), sizeName),
		}
	}

	return c.JSON(http.StatusOK, results)
}

// ThumbnailStats returns thumbnail cache statistics
func (h *Handler) ThumbnailStats(c echo.Context) error {
	cache := GetPreviewCache()
	if cache == nil {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"enabled": false,
		})
	}

	files, size, oldest := cache.GetStats()
	return c.JSON(http.StatusOK, map[string]interface{}{
		"enabled":     true,
		"totalFiles":  files,
		"totalSize":   size,
		"oldestEntry": oldest,
	})
}

// ClearThumbnailCache clears the thumbnail cache (admin only)
func (h *Handler) ClearThumbnailCache(c echo.Context) error {
	cache := GetPreviewCache()
	if cache == nil {
		return c.JSON(http.StatusOK, map[string]string{
			"message": "Cache not enabled",
		})
	}

	if err := cache.Clear(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to clear cache",
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": "Cache cleared",
	})
}

// EncodeImageAsBase64 helper for batch responses
func EncodeImageAsBase64(data []byte) string {
	// For efficiency, just return URL instead of base64
	return ""
}

// GetResponsiveThumbnail returns thumbnails in multiple sizes
func (h *Handler) GetResponsiveThumbnail(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "File path required",
		})
	}

	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	realPath, _, displayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	info, err := os.Stat(realPath)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "File not found",
		})
	}

	ext := strings.ToLower(filepath.Ext(info.Name()))
	if !supportedImageExts[ext] && !supportedVideoExts[ext] {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Unsupported file type",
		})
	}

	basePath := strings.TrimPrefix(displayPath, "/")

	return c.JSON(http.StatusOK, map[string]interface{}{
		"srcset": map[string]string{
			"small":  fmt.Sprintf("/api/thumbnail/%s?size=small", basePath),
			"medium": fmt.Sprintf("/api/thumbnail/%s?size=medium", basePath),
			"large":  fmt.Sprintf("/api/thumbnail/%s?size=large", basePath),
		},
		"webp": map[string]string{
			"small":  fmt.Sprintf("/api/thumbnail/%s?size=small&format=webp", basePath),
			"medium": fmt.Sprintf("/api/thumbnail/%s?size=medium&format=webp", basePath),
			"large":  fmt.Sprintf("/api/thumbnail/%s?size=large&format=webp", basePath),
		},
	})
}

// IsThumbnailSupported checks if a file type supports thumbnails
func IsThumbnailSupported(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	return supportedImageExts[ext] || supportedVideoExts[ext]
}
