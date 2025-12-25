package handlers

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tus/tusd/v2/pkg/filestore"
	tusd "github.com/tus/tusd/v2/pkg/handler"
)

type UploadHandler struct {
	tusHandler   *tusd.UnroutedHandler
	dataRoot     string
	auditHandler *AuditHandler
}

func NewUploadHandler(dataRoot string, db *sql.DB) (*UploadHandler, error) {
	// Create upload temp directory
	uploadDir := filepath.Join(dataRoot, ".uploads")
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create upload directory: %w", err)
	}

	// Create file store for tus
	store := filestore.New(uploadDir)

	// Create tus handler with unrouted handler for more control
	composer := tusd.NewStoreComposer()
	store.UseIn(composer)

	handler, err := tusd.NewUnroutedHandler(tusd.Config{
		BasePath:                "/",
		StoreComposer:           composer,
		NotifyCompleteUploads:   true,
		RespectForwardedHeaders: true,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create tus handler: %w", err)
	}

	h := &UploadHandler{
		tusHandler:   handler,
		dataRoot:     dataRoot,
		auditHandler: NewAuditHandler(db),
	}

	// Start goroutine to handle completed uploads
	go h.handleCompletedUploads()

	return h, nil
}

// resolveVirtualPath converts a virtual path to a real filesystem path for uploads
// Virtual paths:
//   - /home/... -> /data/users/{username}/...
//   - /shared/... -> /data/shared/...
func (h *UploadHandler) resolveVirtualPath(virtualPath string, username string) (string, error) {
	cleanPath := filepath.Clean(virtualPath)
	if strings.Contains(cleanPath, "..") {
		return "", fmt.Errorf("invalid path")
	}

	// Parse path parts
	pathParts := strings.Split(strings.TrimPrefix(cleanPath, "/"), "/")
	if len(pathParts) == 0 || (len(pathParts) == 1 && pathParts[0] == "") {
		return "", fmt.Errorf("cannot upload to root")
	}

	root := pathParts[0]
	subPath := ""
	if len(pathParts) > 1 {
		subPath = filepath.Join(pathParts[1:]...)
	}

	switch root {
	case "home":
		if username == "" {
			return "", fmt.Errorf("username required for home folder")
		}
		return filepath.Join(h.dataRoot, "users", username, subPath), nil
	case "shared":
		// shared uses folder name as subdirectory
		return filepath.Join(h.dataRoot, "shared", subPath), nil
	default:
		return "", fmt.Errorf("invalid storage type: %s", root)
	}
}

func (h *UploadHandler) handleCompletedUploads() {
	for event := range h.tusHandler.CompleteUploads {
		// Get destination path from metadata
		destPath := event.Upload.MetaData["path"]
		filename := event.Upload.MetaData["filename"]
		username := event.Upload.MetaData["username"] // Added for virtual path resolution
		overwrite := event.Upload.MetaData["overwrite"] == "true"

		if destPath == "" {
			destPath = "/shared" // Default to shared folder
		}
		if filename == "" {
			filename = event.Upload.ID
		}

		// Resolve virtual path to real path
		realDestPath, err := h.resolveVirtualPath(destPath, username)
		if err != nil {
			fmt.Printf("Failed to resolve virtual path %s: %v\n", destPath, err)
			continue
		}

		// Move file to destination
		srcPath := filepath.Join(h.dataRoot, ".uploads", event.Upload.ID)
		finalPath := filepath.Join(realDestPath, filename)

		// Ensure destination directory exists
		if err := os.MkdirAll(filepath.Dir(finalPath), 0755); err != nil {
			fmt.Printf("Failed to create directory: %v\n", err)
			continue
		}

		// Check if file already exists
		if !overwrite {
			// Generate unique name if file exists and overwrite is not requested
			finalPath = h.getUniqueFilePath(finalPath)
		}
		// If overwrite is true, the existing file will be replaced by os.Rename

		// Mark this file as a web upload before moving
		tracker := GetWebUploadTracker()
		tracker.MarkUploading(finalPath)

		// Move file (will overwrite if exists)
		if err := os.Rename(srcPath, finalPath); err != nil {
			fmt.Printf("Failed to move file: %v\n", err)
			tracker.UnmarkUploading(finalPath)
			continue
		}

		// Clean up .info file
		infoPath := srcPath + ".info"
		os.Remove(infoPath)

		fmt.Printf("Upload completed: %s -> %s (overwrite: %v)\n", filename, finalPath, overwrite)

		// Log audit event for file upload
		// Get client IP from the tracker (stored when upload was created)
		ipAddr := GetTusIPTracker().GetIP(event.Upload.ID)
		if ipAddr == "" {
			ipAddr = "0.0.0.0"
		}
		var userID *string
		if username != "" {
			userID = h.getUserIDByUsername(username)
		}
		h.auditHandler.LogEvent(userID, ipAddr, EventFileUpload, destPath+"/"+filename, map[string]interface{}{
			"fileName": filename,
			"size":     event.Upload.Size,
			"source":   "web",
		})

		// Keep the mark for 10 seconds then remove it
		go func(path string) {
			time.Sleep(10 * time.Second)
			tracker.UnmarkUploading(path)
		}(finalPath)
	}
}

// getUserIDByUsername looks up user ID by username
func (h *UploadHandler) getUserIDByUsername(username string) *string {
	if h.auditHandler == nil || h.auditHandler.db == nil {
		return nil
	}
	var userID string
	err := h.auditHandler.db.QueryRow("SELECT id FROM users WHERE username = $1", username).Scan(&userID)
	if err != nil {
		return nil
	}
	return &userID
}

// getUniqueFilePath returns a unique file path by adding [1], [2], etc. if file exists
func (h *UploadHandler) getUniqueFilePath(path string) string {
	// Check if file exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return path
	}

	// File exists, need to generate unique name
	dir := filepath.Dir(path)
	ext := filepath.Ext(path)
	base := strings.TrimSuffix(filepath.Base(path), ext)

	// Try adding [1], [2], etc.
	for i := 1; i < 1000; i++ {
		newPath := filepath.Join(dir, fmt.Sprintf("%s[%d]%s", base, i, ext))
		if _, err := os.Stat(newPath); os.IsNotExist(err) {
			return newPath
		}
	}

	// Fallback: use timestamp (very unlikely to reach here)
	timestamp := fmt.Sprintf("%d", os.Getpid())
	return filepath.Join(dir, fmt.Sprintf("%s_%s%s", base, timestamp, ext))
}

// TusHandler returns the UnroutedHandler for tus uploads
func (h *UploadHandler) TusHandler() *tusd.UnroutedHandler {
	return h.tusHandler
}
