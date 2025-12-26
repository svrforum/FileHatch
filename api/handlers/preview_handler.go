package handlers

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

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
	realPath, _, displayPath, err := h.resolvePath("/"+requestPath, claims)
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

	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(info.Name()), "."))
	mimeType := getMimeType(ext)

	// Generate ETag for cache validation
	etag := GenerateETag(realPath, info.ModTime(), info.Size())

	// Check If-None-Match header for cache validation
	if !CheckETag(c.Request(), etag) {
		return c.NoContent(http.StatusNotModified)
	}

	// For images, return the file with caching headers
	if strings.HasPrefix(mimeType, "image/") {
		SetCacheHeaders(c.Response().Writer, etag, 86400) // 24 hour cache
		c.Response().Header().Set("Last-Modified", info.ModTime().UTC().Format(http.TimeFormat))
		return c.File(realPath)
	}

	// For text files, return content with caching
	if strings.HasPrefix(mimeType, "text/") || ext == "json" || ext == "md" {
		// Use preview cache for text content
		cache := GetPreviewCache()
		var content string
		var truncated bool

		if cache != nil {
			content, truncated, err = cache.CachedTextPreview(realPath, info, DefaultTextPreviewOptions())
			if err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": "Failed to read file",
				})
			}
		} else {
			// Fallback to direct read if cache not available
			file, err := os.Open(realPath)
			if err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": "Failed to open file",
				})
			}
			defer file.Close()

			buf := make([]byte, 100*1024)
			n, err := file.Read(buf)
			if err != nil && err != io.EOF {
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": "Failed to read file",
				})
			}
			content = string(buf[:n])
			truncated = n == 100*1024
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
			"size":     info.Size(),
		})
	}

	// For PDFs
	if mimeType == "application/pdf" {
		SetCacheHeaders(c.Response().Writer, etag, 3600) // 1 hour cache
		return c.JSON(http.StatusOK, map[string]interface{}{
			"type":     "pdf",
			"mimeType": mimeType,
			"url":      fmt.Sprintf("/api/files/%s", strings.TrimPrefix(displayPath, "/")),
			"size":     info.Size(),
		})
	}

	// For unsupported types
	SetCacheHeaders(c.Response().Writer, etag, 3600) // 1 hour cache
	return c.JSON(http.StatusOK, map[string]interface{}{
		"type":     "unsupported",
		"mimeType": mimeType,
		"size":     info.Size(),
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

	// Resolve path to get the video file directory
	realPath, _, _, err := h.resolvePath("/"+decodedPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	// Get base name without extension
	dir := filepath.Dir(realPath)
	baseName := strings.TrimSuffix(filepath.Base(realPath), filepath.Ext(realPath))

	// Look for subtitle files (.srt, .smi, .vtt)
	subtitleExts := []string{".srt", ".smi", ".sami", ".vtt"}
	var subtitlePath string
	var subtitleExt string

	for _, ext := range subtitleExts {
		path := filepath.Join(dir, baseName+ext)
		if _, err := os.Stat(path); err == nil {
			subtitlePath = path
			subtitleExt = ext
			break
		}
		// Also check uppercase extensions
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

	// Read subtitle file
	content, err := os.ReadFile(subtitlePath)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to read subtitle file",
		})
	}

	// Convert to WebVTT if needed
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
				fmt.Sscanf(remaining, "%d", &ms)
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
