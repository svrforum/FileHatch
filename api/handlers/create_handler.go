package handlers

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// CreateFileRequest is the request body for creating new files
type CreateFileRequest struct {
	Path     string `json:"path"`
	Filename string `json:"filename"`
	FileType string `json:"fileType"` // text, docx, xlsx, pptx
}

// CreateFile creates a new empty file
func (h *Handler) CreateFile(c echo.Context) error {
	var req CreateFileRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if req.Filename == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Filename required",
		})
	}

	// Validate filename
	if strings.ContainsAny(req.Filename, `/\:*?"<>|`) {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid filename",
		})
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	targetPath := req.Path
	if targetPath == "" {
		targetPath = "/shared"
	}

	realPath, storageType, _, err := h.resolvePath(targetPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	if storageType == "root" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot create file in root",
		})
	}

	// Check permissions for home folder
	if storageType == StorageHome && claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	// Ensure target directory exists
	if err := os.MkdirAll(realPath, 0755); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create target directory",
		})
	}

	// Build full file path
	filePath := filepath.Join(realPath, req.Filename)

	// Check if file already exists
	if _, err := os.Stat(filePath); err == nil {
		return c.JSON(http.StatusConflict, map[string]string{
			"error": "File already exists",
		})
	}

	// Get template content based on file type
	content := getTemplateContent(req.FileType)

	// Create the file
	if err := os.WriteFile(filePath, content, 0644); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create file",
		})
	}

	// Log audit event
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	_ = h.auditHandler.LogEvent(userID, c.RealIP(), EventFileUpload, targetPath+"/"+req.Filename, map[string]interface{}{
		"fileName": req.Filename,
		"fileType": req.FileType,
		"source":   "create",
	})

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"success":  true,
		"filename": req.Filename,
		"path":     targetPath + "/" + req.Filename,
	})
}

// getTemplateContent returns template content for different file types
func getTemplateContent(fileType string) []byte {
	switch fileType {
	case "txt", "text":
		return []byte("")
	case "html":
		return []byte(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>New Document</title>
</head>
<body>

</body>
</html>`)
	case "json":
		return []byte("{\n  \n}")
	case "md":
		return []byte("# New Document\n\n")
	case "docx":
		return createDocxTemplate()
	case "xlsx":
		return createXlsxTemplate()
	case "pptx":
		return createPptxTemplate()
	default:
		return []byte("")
	}
}

// SimpleUpload handles simple non-resumable uploads
func (h *Handler) SimpleUpload(c echo.Context) error {
	// Get the file from the request
	file, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "No file uploaded",
		})
	}

	targetPath := c.FormValue("path")
	if targetPath == "" {
		targetPath = "/shared"
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	realPath, storageType, _, err := h.resolvePath(targetPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	if storageType == "root" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot upload to root",
		})
	}

	// Check permissions for home folder
	if storageType == StorageHome && claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	// Ensure target directory exists
	if err := os.MkdirAll(realPath, 0755); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create target directory",
		})
	}

	// Open the uploaded file
	src, err := file.Open()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to open uploaded file",
		})
	}
	defer src.Close()

	// Create the destination file
	destPath := filepath.Join(realPath, file.Filename)

	// Mark this as a web upload to prevent SMB audit logging
	tracker := GetWebUploadTracker()
	tracker.MarkUploading(destPath)

	dst, err := os.Create(destPath)
	if err != nil {
		tracker.UnmarkUploading(destPath)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create destination file",
		})
	}
	defer dst.Close()

	// Copy the file
	if _, err = io.Copy(dst, src); err != nil {
		tracker.UnmarkUploading(destPath)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to save file",
		})
	}

	// Keep the mark for 10 seconds then remove it
	go func() {
		time.Sleep(10 * time.Second)
		tracker.UnmarkUploading(destPath)
	}()

	// Log audit event for file upload
	h.auditHandler.LogEventFromContext(c, EventFileUpload, targetPath+"/"+file.Filename, map[string]interface{}{
		"fileName": file.Filename,
		"size":     file.Size,
		"source":   "web",
	})

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"success":  true,
		"filename": file.Filename,
		"size":     file.Size,
	})
}
