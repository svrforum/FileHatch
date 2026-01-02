package handlers

import (
	"archive/zip"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// CompressRequest is the request body for compressing files
type CompressRequest struct {
	Paths      []string `json:"paths"`      // List of file/folder paths to compress
	OutputName string   `json:"outputName"` // Optional: output zip file name (without .zip)
}

// CompressFiles creates a zip archive from selected files/folders
func (h *Handler) CompressFiles(c echo.Context) error {
	var req CompressRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}

	fmt.Printf("[Compress] Request: paths=%v, outputName=%s\n", req.Paths, req.OutputName)

	if len(req.Paths) == 0 {
		return RespondError(c, ErrMissingParameter("paths"))
	}

	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	// Determine output directory (parent of first item)
	firstPath := req.Paths[0]
	parentPath := filepath.Dir(firstPath)
	if parentPath == "." {
		parentPath = "/"
	}

	// Resolve parent path to get real path
	parentRealPath, _, parentDisplayPath, err := h.resolvePath(parentPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}

	// Generate output filename
	outputName := req.OutputName
	if outputName == "" {
		if len(req.Paths) == 1 {
			// Use the first item's name
			outputName = filepath.Base(req.Paths[0])
		} else {
			// Use timestamp
			outputName = fmt.Sprintf("archive_%s", time.Now().Format("20060102_150405"))
		}
	}

	// Ensure .zip extension
	if !strings.HasSuffix(strings.ToLower(outputName), ".zip") {
		outputName += ".zip"
	}

	// Check if output file already exists, add suffix if needed
	outputPath := filepath.Join(parentRealPath, outputName)
	baseName := strings.TrimSuffix(outputName, ".zip")
	counter := 1
	for {
		if _, err := os.Stat(outputPath); os.IsNotExist(err) {
			break
		}
		outputName = fmt.Sprintf("%s (%d).zip", baseName, counter)
		outputPath = filepath.Join(parentRealPath, outputName)
		counter++
	}

	// Create zip file
	zipFile, err := os.Create(outputPath)
	if err != nil {
		return RespondError(c, ErrOperationFailed("create zip file", err))
	}
	defer zipFile.Close()

	zipWriter := zip.NewWriter(zipFile)
	defer zipWriter.Close()

	// Add each path to the zip
	for _, path := range req.Paths {
		realPath, _, _, err := h.resolvePath(path, claims)
		if err != nil {
			continue // Skip invalid paths
		}

		info, err := os.Stat(realPath)
		if err != nil {
			continue // Skip non-existent paths
		}

		baseName := filepath.Base(path)

		if info.IsDir() {
			// Add directory recursively
			err = h.addDirToZip(zipWriter, realPath, baseName)
		} else {
			// Add single file
			err = h.addFileToZip(zipWriter, realPath, baseName)
		}

		if err != nil {
			// Log error but continue with other files
			fmt.Printf("[Compress] Error adding %s: %v\n", path, err)
		}
	}

	// Close zip writer to flush
	zipWriter.Close()
	zipFile.Close()

	// Get final file info
	finalInfo, _ := os.Stat(outputPath)
	var finalSize int64
	if finalInfo != nil {
		finalSize = finalInfo.Size()
	}

	// Log audit event
	h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file.compress", parentDisplayPath+"/"+outputName, map[string]interface{}{
		"sourceCount": len(req.Paths),
		"sources":     req.Paths,
		"outputSize":  finalSize,
	})

	// Invalidate storage cache
	InvalidateStorageCache(claims.Username)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":    true,
		"outputPath": parentDisplayPath + "/" + outputName,
		"outputName": outputName,
		"size":       finalSize,
	})
}

// addFileToZip adds a single file to the zip archive
func (h *Handler) addFileToZip(zipWriter *zip.Writer, filePath, zipPath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return err
	}

	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	header.Name = zipPath
	header.Method = zip.Deflate

	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		return err
	}

	_, err = io.Copy(writer, file)
	return err
}

// addDirToZip adds a directory recursively to the zip archive
func (h *Handler) addDirToZip(zipWriter *zip.Writer, dirPath, zipBasePath string) error {
	return filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}

		// Skip hidden files
		if strings.HasPrefix(info.Name(), ".") && path != dirPath {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		// Calculate relative path within zip
		relPath, err := filepath.Rel(dirPath, path)
		if err != nil {
			return nil
		}

		zipPath := filepath.Join(zipBasePath, relPath)
		zipPath = filepath.ToSlash(zipPath) // Use forward slashes in zip

		if info.IsDir() {
			// Add directory entry
			_, err := zipWriter.Create(zipPath + "/")
			return err
		}

		// Add file
		return h.addFileToZip(zipWriter, path, zipPath)
	})
}

// ExtractRequest is the request body for extracting zip files
type ExtractRequest struct {
	Path       string `json:"path"`       // Path to the zip file
	OutputPath string `json:"outputPath"` // Optional: where to extract (defaults to same directory as zip)
}

// ExtractZip extracts a zip archive
func (h *Handler) ExtractZip(c echo.Context) error {
	var req ExtractRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}

	if req.Path == "" {
		return RespondError(c, ErrBadRequest("Path is required"))
	}

	// Get user claims
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	// Resolve the zip file path
	realZipPath, _, displayPath, err := h.resolvePath(req.Path, claims)
	if err != nil {
		return RespondError(c, ErrForbidden(err.Error()))
	}

	// Check if it's a zip file
	if !strings.HasSuffix(strings.ToLower(req.Path), ".zip") {
		return RespondError(c, ErrBadRequest("Only .zip files can be extracted"))
	}

	// Check if file exists
	if _, err := os.Stat(realZipPath); os.IsNotExist(err) {
		return RespondError(c, ErrNotFound("Zip file not found"))
	}

	// Determine output directory
	var outputDir string
	var outputDisplayPath string
	if req.OutputPath != "" {
		outputDir, _, outputDisplayPath, err = h.resolvePath(req.OutputPath, claims)
		if err != nil {
			return RespondError(c, ErrForbidden(err.Error()))
		}
	} else {
		// Extract to the same directory as the zip file
		outputDir = filepath.Dir(realZipPath)
		outputDisplayPath = filepath.Dir(displayPath)
	}

	// Create a folder with the zip file name (without extension)
	zipBaseName := strings.TrimSuffix(filepath.Base(req.Path), ".zip")
	extractDir := filepath.Join(outputDir, zipBaseName)
	extractDisplayPath := filepath.Join(outputDisplayPath, zipBaseName)

	// If folder already exists, add a number suffix
	originalExtractDir := extractDir
	originalExtractDisplayPath := extractDisplayPath
	counter := 1
	for {
		if _, err := os.Stat(extractDir); os.IsNotExist(err) {
			break
		}
		extractDir = fmt.Sprintf("%s_%d", originalExtractDir, counter)
		extractDisplayPath = fmt.Sprintf("%s_%d", originalExtractDisplayPath, counter)
		counter++
	}

	// Create extract directory
	if err := os.MkdirAll(extractDir, 0755); err != nil {
		return RespondError(c, ErrInternal("Failed to create extraction directory"))
	}

	// Open the zip file
	reader, err := zip.OpenReader(realZipPath)
	if err != nil {
		os.RemoveAll(extractDir) // Cleanup on error
		return RespondError(c, ErrInternal("Failed to open zip file"))
	}
	defer reader.Close()

	// Extract files
	var extractedCount int
	for _, file := range reader.File {
		// Sanitize the file path to prevent zip slip attacks
		destPath := filepath.Join(extractDir, file.Name)
		if !strings.HasPrefix(destPath, filepath.Clean(extractDir)+string(os.PathSeparator)) {
			continue // Skip files that would extract outside the target directory
		}

		if file.FileInfo().IsDir() {
			os.MkdirAll(destPath, file.Mode())
			continue
		}

		// Create parent directories
		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			continue
		}

		// Extract file
		if err := h.extractZipFile(file, destPath); err != nil {
			continue
		}
		extractedCount++
	}

	// Log audit event
	h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file.extract", displayPath, map[string]interface{}{
		"extractedTo":    extractDisplayPath,
		"extractedCount": extractedCount,
	})

	// Invalidate storage cache
	InvalidateStorageCache(claims.Username)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":        true,
		"extractedPath":  extractDisplayPath,
		"extractedCount": extractedCount,
	})
}

// extractZipFile extracts a single file from the zip archive
func (h *Handler) extractZipFile(file *zip.File, destPath string) error {
	rc, err := file.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	destFile, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.Mode())
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, rc)
	return err
}
