package handlers

import (
	"encoding/base64"
	"sync"
	"time"
)

// DecodeBase64 decodes a base64 encoded string
func DecodeBase64(s string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(s)
}

// WebUploadTracker tracks files being uploaded via web to distinguish from SMB
type WebUploadTracker struct {
	mu      sync.RWMutex
	uploads map[string]time.Time
}

// TusUploadInfo stores information about a tus upload
type TusUploadInfo struct {
	ClientIP  string
	CreatedAt time.Time
}

// TusIPTracker tracks client IPs for tus uploads
type TusIPTracker struct {
	mu      sync.RWMutex
	uploads map[string]*TusUploadInfo
}

var webUploadTracker = &WebUploadTracker{
	uploads: make(map[string]time.Time),
}

var tusIPTracker = &TusIPTracker{
	uploads: make(map[string]*TusUploadInfo),
}

// GetWebUploadTracker returns the global tracker instance
func GetWebUploadTracker() *WebUploadTracker {
	return webUploadTracker
}

// GetTusIPTracker returns the global tus IP tracker instance
func GetTusIPTracker() *TusIPTracker {
	return tusIPTracker
}

// StoreIP stores the client IP for an upload ID
func (t *TusIPTracker) StoreIP(uploadID, clientIP string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.uploads[uploadID] = &TusUploadInfo{
		ClientIP:  clientIP,
		CreatedAt: time.Now(),
	}
}

// GetIP retrieves and removes the client IP for an upload ID
func (t *TusIPTracker) GetIP(uploadID string) string {
	t.mu.Lock()
	defer t.mu.Unlock()
	if info, exists := t.uploads[uploadID]; exists {
		delete(t.uploads, uploadID)
		return info.ClientIP
	}
	return ""
}

// Cleanup removes old entries
func (t *TusIPTracker) Cleanup() {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now()
	for id, info := range t.uploads {
		if now.Sub(info.CreatedAt) > 24*time.Hour {
			delete(t.uploads, id)
		}
	}
}

// StartCleanupRoutine starts the cleanup routine for TusIPTracker
func (t *TusIPTracker) StartCleanupRoutine() {
	go func() {
		ticker := time.NewTicker(time.Hour)
		for range ticker.C {
			t.Cleanup()
		}
	}()
}

// MarkUploading marks a file path as being uploaded via web
func (t *WebUploadTracker) MarkUploading(path string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.uploads[path] = time.Now()
}

// UnmarkUploading removes the upload mark
func (t *WebUploadTracker) UnmarkUploading(path string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.uploads, path)
}

// IsWebUpload checks if a file was recently uploaded via web
func (t *WebUploadTracker) IsWebUpload(path string) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()

	if uploadTime, exists := t.uploads[path]; exists {
		// Consider it a web upload if it was marked within the last 30 seconds
		if time.Since(uploadTime) < 30*time.Second {
			return true
		}
	}
	return false
}

// Cleanup removes old entries periodically
func (t *WebUploadTracker) Cleanup() {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now()
	for path, uploadTime := range t.uploads {
		if now.Sub(uploadTime) > 60*time.Second {
			delete(t.uploads, path)
		}
	}
}

// StartCleanupRoutine starts a goroutine to clean up old entries
func (t *WebUploadTracker) StartCleanupRoutine() {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		for range ticker.C {
			t.Cleanup()
		}
	}()
}
