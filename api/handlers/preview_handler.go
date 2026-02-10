package handlers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// GetPreview handles file preview requests with caching support
func (h *Handler) GetPreview(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "File path required",
		})
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	result, realPath, err := h.resolveStorageForOperation("/"+requestPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	displayPath := result.DisplayPath
	isNonLocal := result.StorageType == StorageExternal && realPath == ""

	var fileName string
	var fileSize int64
	var fileModTime time.Time

	if isNonLocal {
		bgCtx := context.Background()
		info, err := result.Backend.Stat(bgCtx, result.RelPath)
		if err != nil {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "File not found",
			})
		}
		if info.IsDirectory {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Path is a directory",
			})
		}
		fileName = info.FileName
		fileSize = info.FileSize
		fileModTime = info.FileModTime
	} else {
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
		fileName = info.Name()
		fileSize = info.Size()
		fileModTime = info.ModTime()
	}

	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(fileName), "."))
	mimeType := getMimeType(ext)

	// Generate ETag for cache validation
	etagKey := realPath
	if isNonLocal {
		etagKey = fmt.Sprintf("ext:%s:%s", result.MountID, result.RelPath)
	}
	etag := GenerateETag(etagKey, fileModTime, fileSize)

	// Check If-None-Match header for cache validation
	if !CheckETag(c.Request(), etag) {
		return c.NoContent(http.StatusNotModified)
	}

	// For images, return the file with caching headers
	if strings.HasPrefix(mimeType, "image/") {
		SetCacheHeaders(c.Response().Writer, etag, 86400) // 24 hour cache
		c.Response().Header().Set("Last-Modified", fileModTime.UTC().Format(http.TimeFormat))
		if isNonLocal {
			bgCtx := context.Background()
			reader, info, err := result.Backend.ReadFile(bgCtx, result.RelPath)
			if err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": "Failed to read file",
				})
			}
			defer reader.Close()
			c.Response().Header().Set("Content-Type", mimeType)
			c.Response().Header().Set("Content-Length", fmt.Sprintf("%d", info.FileSize))
			c.Response().WriteHeader(http.StatusOK)
			_, _ = io.Copy(c.Response(), reader)
			return nil
		}
		return c.File(realPath)
	}

	// For text files, return content with caching
	if strings.HasPrefix(mimeType, "text/") || ext == "json" || ext == "md" {
		var content string
		var truncated bool

		if isNonLocal {
			bgCtx := context.Background()
			reader, _, err := result.Backend.ReadFile(bgCtx, result.RelPath)
			if err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": "Failed to read file",
				})
			}
			defer reader.Close()
			buf := make([]byte, 100*1024)
			n, readErr := reader.Read(buf)
			if readErr != nil && readErr != io.EOF {
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": "Failed to read file",
				})
			}
			content = string(buf[:n])
			truncated = n == 100*1024
		} else {
			// Use preview cache for text content
			cache := GetPreviewCache()
			info, _ := os.Stat(realPath)
			if cache != nil && info != nil {
				content, truncated, err = cache.CachedTextPreview(realPath, info, DefaultTextPreviewOptions())
				if err != nil {
					return c.JSON(http.StatusInternalServerError, map[string]string{
						"error": "Failed to read file",
					})
				}
			} else {
				file, err := os.Open(realPath)
				if err != nil {
					return c.JSON(http.StatusInternalServerError, map[string]string{
						"error": "Failed to open file",
					})
				}
				defer file.Close()

				buf := make([]byte, 100*1024)
				n, readErr := file.Read(buf)
				if readErr != nil && readErr != io.EOF {
					return c.JSON(http.StatusInternalServerError, map[string]string{
						"error": "Failed to read file",
					})
				}
				content = string(buf[:n])
				truncated = n == 100*1024
			}
		}

		// Set cache headers for JSON response
		SetCacheHeaders(c.Response().Writer, etag, 300) // 5 minute cache for text previews
		return c.JSON(http.StatusOK, map[string]interface{}{
			"type":      "text",
			"mimeType":  mimeType,
			"content":   content,
			"truncated": truncated,
		})
	}

	// For videos and audio, return file info for streaming
	if strings.HasPrefix(mimeType, "video/") || strings.HasPrefix(mimeType, "audio/") {
		SetCacheHeaders(c.Response().Writer, etag, 3600) // 1 hour cache
		return c.JSON(http.StatusOK, map[string]interface{}{
			"type":     strings.Split(mimeType, "/")[0],
			"mimeType": mimeType,
			"url":      fmt.Sprintf("/api/files/%s", strings.TrimPrefix(displayPath, "/")),
			"size":     fileSize,
		})
	}

	// For PDFs
	if mimeType == "application/pdf" {
		SetCacheHeaders(c.Response().Writer, etag, 3600) // 1 hour cache
		return c.JSON(http.StatusOK, map[string]interface{}{
			"type":     "pdf",
			"mimeType": mimeType,
			"url":      fmt.Sprintf("/api/files/%s", strings.TrimPrefix(displayPath, "/")),
			"size":     fileSize,
		})
	}

	// For unsupported types
	SetCacheHeaders(c.Response().Writer, etag, 3600) // 1 hour cache
	return c.JSON(http.StatusOK, map[string]interface{}{
		"type":     "unsupported",
		"mimeType": mimeType,
		"size":     fileSize,
	})
}

// GetSubtitle finds and returns subtitle for a video file in WebVTT format
func (h *Handler) GetSubtitle(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "File path required",
		})
	}

	// URL decode the path
	decodedPath, err := url.PathUnescape(requestPath)
	if err != nil {
		decodedPath = requestPath
	}

	// Get user claims if available
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	result, realPath, err := h.resolveStorageForOperation("/"+decodedPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	isNonLocal := result.StorageType == StorageExternal && realPath == ""
	baseName := strings.TrimSuffix(filepath.Base(decodedPath), filepath.Ext(decodedPath))
	subtitleExts := []string{".srt", ".smi", ".sami", ".vtt"}

	if isNonLocal {
		bgCtx := context.Background()
		dir := filepath.Dir(result.RelPath)

		// Search for subtitle in backend
		for _, ext := range subtitleExts {
			subRelPath := filepath.Join(dir, baseName+ext)
			exists, _ := result.Backend.Exists(bgCtx, subRelPath)
			if !exists {
				subRelPath = filepath.Join(dir, baseName+strings.ToUpper(ext))
				exists, _ = result.Backend.Exists(bgCtx, subRelPath)
			}
			if exists {
				reader, _, err := result.Backend.ReadFile(bgCtx, subRelPath)
				if err != nil {
					continue
				}
				content, err := io.ReadAll(reader)
				reader.Close()
				if err != nil {
					continue
				}

				var vttContent string
				switch strings.ToLower(ext) {
				case ".vtt":
					vttContent = string(content)
				case ".srt":
					vttContent = convertSRTtoVTT(string(content))
				case ".smi", ".sami":
					vttContent = convertSMItoVTT(string(content))
				default:
					vttContent = string(content)
				}
				c.Response().Header().Set("Content-Type", "text/vtt; charset=utf-8")
				return c.String(http.StatusOK, vttContent)
			}
		}
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "No subtitle found",
		})
	}

	// Local path
	dir := filepath.Dir(realPath)
	var subtitlePath string
	var subtitleExt string

	for _, ext := range subtitleExts {
		path := filepath.Join(dir, baseName+ext)
		if _, err := os.Stat(path); err == nil {
			subtitlePath = path
			subtitleExt = ext
			break
		}
		path = filepath.Join(dir, baseName+strings.ToUpper(ext))
		if _, err := os.Stat(path); err == nil {
			subtitlePath = path
			subtitleExt = strings.ToLower(ext)
			break
		}
	}

	if subtitlePath == "" {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "No subtitle found",
		})
	}

	content, err := os.ReadFile(subtitlePath)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to read subtitle file",
		})
	}

	var vttContent string
	switch subtitleExt {
	case ".vtt":
		vttContent = string(content)
	case ".srt":
		vttContent = convertSRTtoVTT(string(content))
	case ".smi", ".sami":
		vttContent = convertSMItoVTT(string(content))
	default:
		vttContent = string(content)
	}

	c.Response().Header().Set("Content-Type", "text/vtt; charset=utf-8")
	return c.String(http.StatusOK, vttContent)
}

// convertSRTtoVTT converts SRT subtitle format to WebVTT
func convertSRTtoVTT(srt string) string {
	// Replace CRLF with LF
	srt = strings.ReplaceAll(srt, "\r\n", "\n")

	var result strings.Builder
	result.WriteString("WEBVTT\n\n")

	lines := strings.Split(srt, "\n")
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])

		// Skip empty lines and sequence numbers
		if line == "" {
			result.WriteString("\n")
			continue
		}

		// Check if this is a timestamp line (contains " --> ")
		if strings.Contains(line, " --> ") {
			// Convert comma to period in timestamps (SRT uses comma, VTT uses period)
			line = strings.ReplaceAll(line, ",", ".")
			result.WriteString(line + "\n")
		} else if _, err := fmt.Sscanf(line, "%d", new(int)); err == nil && !strings.Contains(line, " ") {
			// This is a sequence number, skip it
			continue
		} else {
			// This is subtitle text
			result.WriteString(line + "\n")
		}
	}

	return result.String()
}

// convertSMItoVTT converts SMI/SAMI subtitle format to WebVTT
func convertSMItoVTT(smi string) string {
	var result strings.Builder
	result.WriteString("WEBVTT\n\n")

	// Replace CRLF with LF
	smi = strings.ReplaceAll(smi, "\r\n", "\n")

	// Find all SYNC tags with timestamps and content
	type syncBlock struct {
		startMs int
		text    string
	}
	var blocks []syncBlock

	lines := strings.Split(smi, "\n")
	var currentText strings.Builder
	currentStart := -1

	for _, line := range lines {
		line = strings.TrimSpace(line)
		upperLine := strings.ToUpper(line)

		// Check for SYNC tag
		if strings.Contains(upperLine, "<SYNC") {
			// Save previous block if exists
			if currentStart >= 0 {
				text := strings.TrimSpace(currentText.String())
				text = stripHTMLTags(text)
				text = strings.ReplaceAll(text, "&nbsp;", " ")
				if text != "" && text != " " {
					blocks = append(blocks, syncBlock{startMs: currentStart, text: text})
				}
			}

			// Parse new timestamp
			startIdx := strings.Index(upperLine, "START=")
			if startIdx != -1 {
				var ms int
				remaining := line[startIdx+6:]
				// Handle both START=1234 and START="1234"
				remaining = strings.TrimPrefix(remaining, "\"")
				_, _ = fmt.Sscanf(remaining, "%d", &ms)
				currentStart = ms
				currentText.Reset()

				// Get content after the > if on same line
				closeIdx := strings.Index(line, ">")
				if closeIdx != -1 && closeIdx+1 < len(line) {
					currentText.WriteString(line[closeIdx+1:])
				}
			}
		} else if currentStart >= 0 && !strings.HasPrefix(upperLine, "<BODY") && !strings.HasPrefix(upperLine, "</BODY") && !strings.HasPrefix(upperLine, "<SAMI") && !strings.HasPrefix(upperLine, "</SAMI") {
			currentText.WriteString(line + " ")
		}
	}

	// Save last block
	if currentStart >= 0 {
		text := strings.TrimSpace(currentText.String())
		text = stripHTMLTags(text)
		text = strings.ReplaceAll(text, "&nbsp;", " ")
		if text != "" && text != " " {
			blocks = append(blocks, syncBlock{startMs: currentStart, text: text})
		}
	}

	// Convert blocks to VTT cues
	for i := 0; i < len(blocks); i++ {
		startTime := formatVTTTime(blocks[i].startMs)
		var endTime string
		if i+1 < len(blocks) {
			endTime = formatVTTTime(blocks[i+1].startMs)
		} else {
			endTime = formatVTTTime(blocks[i].startMs + 5000) // Default 5 second duration
		}

		if blocks[i].text != "" {
			result.WriteString(fmt.Sprintf("%s --> %s\n%s\n\n", startTime, endTime, blocks[i].text))
		}
	}

	return result.String()
}

// stripHTMLTags removes HTML tags from a string
func stripHTMLTags(s string) string {
	var result strings.Builder
	inTag := false
	for _, r := range s {
		if r == '<' {
			inTag = true
		} else if r == '>' {
			inTag = false
		} else if !inTag {
			result.WriteRune(r)
		}
	}
	return result.String()
}

// formatVTTTime formats milliseconds to VTT timestamp format (HH:MM:SS.mmm)
func formatVTTTime(ms int) string {
	hours := ms / 3600000
	ms %= 3600000
	minutes := ms / 60000
	ms %= 60000
	seconds := ms / 1000
	millis := ms % 1000
	return fmt.Sprintf("%02d:%02d:%02d.%03d", hours, minutes, seconds, millis)
}
