package handlers

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// ErrCompressionCancelled is returned when compression is cancelled by the client
var ErrCompressionCancelled = errors.New("compression cancelled")

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
	parentResult, parentRealPath, err := h.resolveStorageForOperation(parentPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}
	parentDisplayPath := parentResult.DisplayPath

	// Generate output filename
	outputName := req.OutputName
	if outputName == "" {
		if len(req.Paths) == 1 {
			outputName = filepath.Base(req.Paths[0])
		} else {
			outputName = fmt.Sprintf("archive_%s", time.Now().Format("20060102_150405"))
		}
	}

	// Ensure .zip extension
	if !strings.HasSuffix(strings.ToLower(outputName), ".zip") {
		outputName += ".zip"
	}

	parentIsNonLocal := parentResult.StorageType == StorageExternal && parentRealPath == ""

	// For non-local output: write to temp, then upload
	var outputPath string
	var useTempOutput bool
	if parentIsNonLocal {
		tmpDir := filepath.Join(h.dataRoot, ".tmp")
		os.MkdirAll(tmpDir, 0755)
		outputPath = filepath.Join(tmpDir, fmt.Sprintf("compress_%d_%s", time.Now().UnixNano(), outputName))
		useTempOutput = true
	} else {
		// Check if output file already exists, add suffix if needed
		outputPath = filepath.Join(parentRealPath, outputName)
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
	}

	// Create zip file
	zipFile, err := os.Create(outputPath)
	if err != nil {
		return RespondError(c, ErrOperationFailed("create zip file", err))
	}
	defer zipFile.Close()

	zipWriter := zip.NewWriter(zipFile)
	defer zipWriter.Close()

	bgCtx := context.Background()

	// Add each path to the zip
	for _, path := range req.Paths {
		result, realPath, err := h.resolveStorageForOperation(path, claims)
		if err != nil {
			continue
		}

		itemBaseName := filepath.Base(path)
		isNonLocal := result.StorageType == StorageExternal && realPath == ""

		var addErr error
		if isNonLocal {
			// Add from backend
			info, statErr := result.Backend.Stat(bgCtx, result.RelPath)
			if statErr != nil {
				continue
			}
			if info.IsDirectory {
				addErr = addBackendDirToZip(bgCtx, zipWriter, result.Backend, result.RelPath, itemBaseName)
			} else {
				addErr = addBackendFileToZip(bgCtx, zipWriter, result.Backend, result.RelPath, itemBaseName)
			}
		} else {
			info, statErr := os.Stat(realPath)
			if statErr != nil {
				continue
			}
			if info.IsDir() {
				addErr = h.addDirToZip(zipWriter, realPath, itemBaseName)
			} else {
				addErr = h.addFileToZip(zipWriter, realPath, itemBaseName)
			}
		}

		if addErr != nil {
			fmt.Printf("[Compress] Error adding %s: %v\n", path, addErr)
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

	// Upload temp zip to non-local backend
	if useTempOutput {
		defer os.Remove(outputPath)
		destRelPath := filepath.Join(parentResult.RelPath, outputName)
		if err := uploadFileToBackend(bgCtx, outputPath, parentResult.Backend, destRelPath); err != nil {
			return RespondError(c, ErrOperationFailed("upload zip to external storage", err))
		}
	}

	// Log audit event
	_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file.compress", parentDisplayPath+"/"+outputName, map[string]interface{}{
		"sourceCount": len(req.Paths),
		"sources":     req.Paths,
		"outputSize":  finalSize,
	})

	// Update storage tracking: add compressed file size (skip for external)
	if finalSize > 0 && !parentIsNonLocal {
		_ = h.UpdateUserStorage(claims.UserID, finalSize)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":    true,
		"outputPath": parentDisplayPath + "/" + outputName,
		"outputName": outputName,
		"size":       finalSize,
	})
}

// addBackendFileToZip adds a single file from a StorageBackend to the zip archive
func addBackendFileToZip(ctx context.Context, zipWriter *zip.Writer, backend StorageBackend, relPath, zipPath string) error {
	reader, info, err := backend.ReadFile(ctx, relPath)
	if err != nil {
		return err
	}
	defer reader.Close()

	header := &zip.FileHeader{
		Name:     zipPath,
		Method:   zip.Deflate,
		Modified: info.FileModTime,
	}
	header.SetMode(os.FileMode(info.FileMode))

	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		return err
	}

	_, err = io.Copy(writer, reader)
	return err
}

// addBackendDirToZip adds a directory recursively from a StorageBackend to the zip archive
func addBackendDirToZip(ctx context.Context, zipWriter *zip.Writer, backend StorageBackend, relPath, zipBasePath string) error {
	return backend.Walk(ctx, relPath, func(path string, info *StorageFileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}

		// Skip hidden files
		if strings.HasPrefix(info.FileName, ".") && path != relPath {
			if info.IsDirectory {
				return ErrSkipDir
			}
			return nil
		}

		// Calculate relative path within zip
		rel, err := filepath.Rel(relPath, path)
		if err != nil {
			return nil
		}

		zp := filepath.Join(zipBasePath, rel)
		zp = filepath.ToSlash(zp)

		if info.IsDirectory {
			_, err := zipWriter.Create(zp + "/")
			return err
		}

		return addBackendFileToZip(ctx, zipWriter, backend, path, zp)
	})
}

// addBackendFileToZipWithProgress adds a single file from a StorageBackend to the zip with progress tracking
func addBackendFileToZipWithProgress(ctx context.Context, zipWriter *zip.Writer, backend StorageBackend, relPath, zipPath string, compCtx *CompressionContext) error {
	reader, info, err := backend.ReadFile(ctx, relPath)
	if err != nil {
		return err
	}
	defer reader.Close()

	header := &zip.FileHeader{
		Name:     zipPath,
		Method:   zip.Deflate,
		Modified: info.FileModTime,
	}
	header.SetMode(os.FileMode(info.FileMode))

	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		return err
	}

	buf := make([]byte, 1024*1024)
	for {
		if compCtx.IsCancelled() {
			return ErrCompressionCancelled
		}

		n, readErr := reader.Read(buf)
		if n > 0 {
			_, writeErr := writer.Write(buf[:n])
			if writeErr != nil {
				return writeErr
			}
			compCtx.CompressedBytes += int64(n)
			compCtx.SendCompressionProgress(filepath.Base(relPath))
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}

	compCtx.ProcessedFiles++
	return nil
}

// addBackendDirToZipWithProgress adds a directory from a StorageBackend to the zip with progress tracking
func addBackendDirToZipWithProgress(ctx context.Context, zipWriter *zip.Writer, backend StorageBackend, relPath, zipBasePath string, compCtx *CompressionContext) error {
	return backend.Walk(ctx, relPath, func(path string, info *StorageFileInfo, err error) error {
		if err != nil {
			return nil
		}

		if compCtx.IsCancelled() {
			return ErrCompressionCancelled
		}

		if strings.HasPrefix(info.FileName, ".") && path != relPath {
			if info.IsDirectory {
				return ErrSkipDir
			}
			return nil
		}

		rel, err := filepath.Rel(relPath, path)
		if err != nil {
			return nil
		}

		zp := filepath.Join(zipBasePath, rel)
		zp = filepath.ToSlash(zp)

		if info.IsDirectory {
			_, err := zipWriter.Create(zp + "/")
			return err
		}

		return addBackendFileToZipWithProgress(ctx, zipWriter, backend, path, zp, compCtx)
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

	// Check if it's a zip file
	if !strings.HasSuffix(strings.ToLower(req.Path), ".zip") {
		return RespondError(c, ErrBadRequest("Only .zip files can be extracted"))
	}

	bgCtx := context.Background()

	// Resolve the zip file path
	srcResult, srcRealPath, err := h.resolveStorageForOperation(req.Path, claims)
	if err != nil {
		return RespondError(c, ErrForbidden(err.Error()))
	}
	displayPath := srcResult.DisplayPath
	srcIsNonLocal := srcResult.StorageType == StorageExternal && srcRealPath == ""

	// Determine output directory
	var outputResult *ResolveResult
	var outputRealPath string
	var outputDisplayPath string
	if req.OutputPath != "" {
		outputResult, outputRealPath, err = h.resolveStorageForOperation(req.OutputPath, claims)
		if err != nil {
			return RespondError(c, ErrForbidden(err.Error()))
		}
		outputDisplayPath = outputResult.DisplayPath
	} else {
		// Extract to the same directory as the zip file
		parentPath := filepath.Dir(req.Path)
		if parentPath == "." {
			parentPath = "/"
		}
		outputResult, outputRealPath, err = h.resolveStorageForOperation(parentPath, claims)
		if err != nil {
			return RespondError(c, ErrForbidden(err.Error()))
		}
		outputDisplayPath = filepath.Dir(displayPath)
	}

	// Check readonly on output
	if err := checkReadonly(outputResult); err != nil {
		return RespondError(c, ErrForbidden("Storage is read-only"))
	}

	outputIsNonLocal := outputResult.StorageType == StorageExternal && outputRealPath == ""

	// For non-local source: download ZIP to temp first
	var localZipPath string
	var cleanupZip bool
	if srcIsNonLocal {
		tmpDir := filepath.Join(h.dataRoot, ".tmp")
		_ = os.MkdirAll(tmpDir, 0755)
		localZipPath = filepath.Join(tmpDir, fmt.Sprintf("extract_%d.zip", time.Now().UnixNano()))
		cleanupZip = true
		if err := downloadFileToLocal(bgCtx, srcResult.Backend, srcResult.RelPath, localZipPath); err != nil {
			return RespondError(c, ErrOperationFailed("download zip from external storage", err))
		}
	} else {
		localZipPath = srcRealPath
		// Check if file exists
		if _, err := os.Stat(localZipPath); os.IsNotExist(err) {
			return RespondError(c, ErrNotFound("Zip file not found"))
		}
	}
	if cleanupZip {
		defer os.Remove(localZipPath)
	}

	// Create a folder with the zip file name (without extension)
	zipBaseName := strings.TrimSuffix(filepath.Base(req.Path), ".zip")

	// Extract to local temp dir first (will upload later for non-local output)
	var extractDir string
	var cleanupExtractDir bool
	if outputIsNonLocal {
		tmpDir := filepath.Join(h.dataRoot, ".tmp")
		_ = os.MkdirAll(tmpDir, 0755)
		extractDir = filepath.Join(tmpDir, fmt.Sprintf("extracted_%d_%s", time.Now().UnixNano(), zipBaseName))
		cleanupExtractDir = true
	} else {
		extractDir = filepath.Join(outputRealPath, zipBaseName)
		// If folder already exists, add a number suffix
		originalExtractDir := extractDir
		counter := 1
		for {
			if _, err := os.Stat(extractDir); os.IsNotExist(err) {
				break
			}
			extractDir = fmt.Sprintf("%s_%d", originalExtractDir, counter)
			counter++
		}
	}
	if cleanupExtractDir {
		defer os.RemoveAll(extractDir)
	}

	extractDisplayPath := filepath.Join(outputDisplayPath, zipBaseName)

	// Create extract directory
	if err := os.MkdirAll(extractDir, 0755); err != nil {
		return RespondError(c, ErrInternal("Failed to create extraction directory"))
	}

	// Open the zip file
	reader, err := zip.OpenReader(localZipPath)
	if err != nil {
		if !cleanupExtractDir {
			os.RemoveAll(extractDir)
		}
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
			_ = os.MkdirAll(destPath, file.Mode())
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

	// Upload extracted files to non-local backend
	if outputIsNonLocal {
		destRelPath := filepath.Join(outputResult.RelPath, zipBaseName)
		if err := uploadDirToBackend(bgCtx, extractDir, outputResult.Backend, destRelPath); err != nil {
			return RespondError(c, ErrOperationFailed("upload extracted files to external storage", err))
		}
	}

	// Calculate extracted size for storage tracking
	extractedSize, _ := GetFileSize(extractDir)

	// Log audit event
	_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file.extract", displayPath, map[string]interface{}{
		"extractedTo":    extractDisplayPath,
		"extractedCount": extractedCount,
		"extractedSize":  extractedSize,
	})

	// Update storage tracking: add extracted files size (skip for external)
	if extractedSize > 0 && !outputIsNonLocal {
		_ = h.UpdateUserStorage(claims.UserID, extractedSize)
	}

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

// CompressionProgress represents the progress of a compression operation
type CompressionProgress struct {
	Status          string `json:"status"`                     // "started", "progress", "completed", "error"
	TotalBytes      int64  `json:"totalBytes"`                 // Total bytes to compress
	CompressedBytes int64  `json:"compressedBytes"`            // Bytes processed so far
	CurrentFile     string `json:"currentFile,omitempty"`      // Current file being compressed
	TotalFiles      int    `json:"totalFiles,omitempty"`       // Total number of files
	ProcessedFiles  int    `json:"processedFiles,omitempty"`   // Number of files processed
	Error           string `json:"error,omitempty"`            // Error message if any
	OutputPath      string `json:"outputPath,omitempty"`       // Output file path
	OutputName      string `json:"outputName,omitempty"`       // Output file name
	OutputSize      int64  `json:"outputSize,omitempty"`       // Final compressed file size
	BytesPerSec     int64  `json:"bytesPerSec,omitempty"`      // Compression speed
}

// CompressionProgressSender is a function type for sending compression progress updates
type CompressionProgressSender func(CompressionProgress)

// SetupCompressionSSE sets up Server-Sent Events headers and returns a progress sender function
func SetupCompressionSSE(c echo.Context) CompressionProgressSender {
	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().Header().Set("X-Accel-Buffering", "no")
	c.Response().WriteHeader(200)

	return func(progress CompressionProgress) {
		data, _ := json.Marshal(progress)
		fmt.Fprintf(c.Response(), "data: %s\n\n", data)
		c.Response().Flush()
	}
}

// CompressionContext holds the state for a compression operation with progress tracking
type CompressionContext struct {
	Ctx              context.Context
	TotalBytes       int64
	TotalFiles       int
	CompressedBytes  int64
	ProcessedFiles   int
	StartTime        time.Time
	LastProgressTime time.Time
	SendProgress     CompressionProgressSender
}

// NewCompressionContext creates a new CompressionContext
func NewCompressionContext(ctx context.Context, totalBytes int64, totalFiles int, sender CompressionProgressSender) *CompressionContext {
	return &CompressionContext{
		Ctx:          ctx,
		TotalBytes:   totalBytes,
		TotalFiles:   totalFiles,
		StartTime:    time.Now(),
		SendProgress: sender,
	}
}

// IsCancelled checks if the compression has been cancelled
func (ctx *CompressionContext) IsCancelled() bool {
	select {
	case <-ctx.Ctx.Done():
		return true
	default:
		return false
	}
}

// SendCompressionProgress sends a progress update with throttling (200ms interval)
func (ctx *CompressionContext) SendCompressionProgress(currentFile string) {
	if time.Since(ctx.LastProgressTime) < 200*time.Millisecond {
		return
	}

	elapsed := time.Since(ctx.StartTime).Seconds()
	var bytesPerSec int64
	if elapsed > 0 {
		bytesPerSec = int64(float64(ctx.CompressedBytes) / elapsed)
	}

	ctx.SendProgress(CompressionProgress{
		Status:          "progress",
		TotalBytes:      ctx.TotalBytes,
		CompressedBytes: ctx.CompressedBytes,
		CurrentFile:     currentFile,
		TotalFiles:      ctx.TotalFiles,
		ProcessedFiles:  ctx.ProcessedFiles,
		BytesPerSec:     bytesPerSec,
	})
	ctx.LastProgressTime = time.Now()
}

// SendCompressionCompleted sends the completed progress event
func (ctx *CompressionContext) SendCompressionCompleted(outputPath, outputName string, outputSize int64) {
	elapsed := time.Since(ctx.StartTime).Seconds()
	var finalSpeed int64
	if elapsed > 0 && ctx.CompressedBytes > 0 {
		finalSpeed = int64(float64(ctx.CompressedBytes) / elapsed)
	}
	ctx.SendProgress(CompressionProgress{
		Status:          "completed",
		TotalBytes:      ctx.TotalBytes,
		CompressedBytes: ctx.CompressedBytes,
		TotalFiles:      ctx.TotalFiles,
		ProcessedFiles:  ctx.ProcessedFiles,
		OutputPath:      outputPath,
		OutputName:      outputName,
		OutputSize:      outputSize,
		BytesPerSec:     finalSpeed,
	})
}

// SendCompressionError sends an error progress event
func (ctx *CompressionContext) SendCompressionError(err error) {
	ctx.SendProgress(CompressionProgress{
		Status: "error",
		Error:  err.Error(),
	})
}

// addFileToZipWithProgress adds a single file to the zip archive with progress tracking
func (h *Handler) addFileToZipWithProgress(zipWriter *zip.Writer, filePath, zipPath string, ctx *CompressionContext) error {
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

	// Copy with progress tracking using 1MB buffer
	buf := make([]byte, 1024*1024)
	for {
		// Check for cancellation
		if ctx.IsCancelled() {
			return ErrCompressionCancelled
		}

		n, readErr := file.Read(buf)
		if n > 0 {
			_, writeErr := writer.Write(buf[:n])
			if writeErr != nil {
				return writeErr
			}
			ctx.CompressedBytes += int64(n)
			ctx.SendCompressionProgress(filepath.Base(filePath))
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}

	ctx.ProcessedFiles++
	return nil
}

// addDirToZipWithProgress adds a directory recursively to the zip archive with progress tracking
func (h *Handler) addDirToZipWithProgress(zipWriter *zip.Writer, dirPath, zipBasePath string, ctx *CompressionContext) error {
	return filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}

		// Check for cancellation
		if ctx.IsCancelled() {
			return ErrCompressionCancelled
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

		// Add file with progress tracking
		return h.addFileToZipWithProgress(zipWriter, path, zipPath, ctx)
	})
}

// CompressFilesStream creates a zip archive with streaming progress via SSE
// @Summary		Compress files with progress
// @Description	Compress files/folders into a zip archive with real-time progress updates via Server-Sent Events
// @Tags		Files
// @Produce		text/event-stream
// @Param		paths		query		string	true	"Comma-separated list of paths to compress"
// @Param		outputName	query		string	false	"Output zip file name (without .zip extension)"
// @Success		200			{object}	CompressionProgress	"SSE stream with progress updates"
// @Failure		400			{object}	docs.ErrorResponse	"Bad request"
// @Failure		401			{object}	docs.ErrorResponse	"Unauthorized"
// @Security	BearerAuth
// @Router		/files/compress-stream [get]
func (h *Handler) CompressFilesStream(c echo.Context) error {
	// Parse paths from query parameter (comma-separated)
	pathsParam := c.QueryParam("paths")
	if pathsParam == "" {
		return RespondError(c, ErrMissingParameter("paths"))
	}

	paths := strings.Split(pathsParam, ",")
	if len(paths) == 0 {
		return RespondError(c, ErrMissingParameter("paths"))
	}

	outputName := c.QueryParam("outputName")

	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	bgCtx := context.Background()

	// Determine output directory (parent of first item)
	firstPath := paths[0]
	parentPath := filepath.Dir(firstPath)
	if parentPath == "." {
		parentPath = "/"
	}

	// Resolve parent path
	parentResult, parentRealPath, err := h.resolveStorageForOperation(parentPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}
	parentDisplayPath := parentResult.DisplayPath
	parentIsNonLocal := parentResult.StorageType == StorageExternal && parentRealPath == ""

	// Generate output filename
	if outputName == "" {
		if len(paths) == 1 {
			outputName = filepath.Base(paths[0])
		} else {
			outputName = fmt.Sprintf("archive_%s", time.Now().Format("20060102_150405"))
		}
	}

	// Ensure .zip extension
	if !strings.HasSuffix(strings.ToLower(outputName), ".zip") {
		outputName += ".zip"
	}

	// Determine output path
	var outputPath string
	var useTempOutput bool
	if parentIsNonLocal {
		tmpDir := filepath.Join(h.dataRoot, ".tmp")
		_ = os.MkdirAll(tmpDir, 0755)
		outputPath = filepath.Join(tmpDir, fmt.Sprintf("compress_stream_%d_%s", time.Now().UnixNano(), outputName))
		useTempOutput = true
	} else {
		outputPath = filepath.Join(parentRealPath, outputName)
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
	}

	// Calculate total size and file count
	var totalBytes int64
	var totalFiles int
	for _, path := range paths {
		result, realPath, err := h.resolveStorageForOperation(path, claims)
		if err != nil {
			continue
		}

		isNonLocal := result.StorageType == StorageExternal && realPath == ""
		if isNonLocal {
			info, err := result.Backend.Stat(bgCtx, result.RelPath)
			if err != nil {
				continue
			}
			if info.IsDirectory {
				_ = result.Backend.Walk(bgCtx, result.RelPath, func(_ string, fi *StorageFileInfo, _ error) error {
					if fi != nil && !fi.IsDirectory && !strings.HasPrefix(fi.FileName, ".") {
						totalBytes += fi.FileSize
						totalFiles++
					}
					return nil
				})
			} else {
				totalBytes += info.FileSize
				totalFiles++
			}
		} else {
			info, err := os.Stat(realPath)
			if err != nil {
				continue
			}
			if info.IsDir() {
				_ = filepath.Walk(realPath, func(_ string, fi os.FileInfo, _ error) error {
					if fi != nil && !fi.IsDir() && !strings.HasPrefix(fi.Name(), ".") {
						totalBytes += fi.Size()
						totalFiles++
					}
					return nil
				})
			} else {
				totalBytes += info.Size()
				totalFiles++
			}
		}
	}

	// Set up SSE
	sendProgress := SetupCompressionSSE(c)

	// Send started event
	sendProgress(CompressionProgress{
		Status:     "started",
		TotalBytes: totalBytes,
		TotalFiles: totalFiles,
	})

	// Create compression context with request context for cancellation
	compCtx := NewCompressionContext(c.Request().Context(), totalBytes, totalFiles, sendProgress)

	// Create zip file
	zipFile, err := os.Create(outputPath)
	if err != nil {
		compCtx.SendCompressionError(fmt.Errorf("failed to create zip file: %w", err))
		return nil
	}

	zipWriter := zip.NewWriter(zipFile)

	// Track if compression was cancelled
	var compressionErr error

	// Add each path to the zip
	for _, path := range paths {
		if compCtx.IsCancelled() {
			compressionErr = ErrCompressionCancelled
			break
		}

		result, realPath, err := h.resolveStorageForOperation(path, claims)
		if err != nil {
			continue
		}

		itemBaseName := filepath.Base(path)
		isNonLocal := result.StorageType == StorageExternal && realPath == ""

		var addErr error
		if isNonLocal {
			info, statErr := result.Backend.Stat(bgCtx, result.RelPath)
			if statErr != nil {
				continue
			}
			if info.IsDirectory {
				addErr = addBackendDirToZipWithProgress(bgCtx, zipWriter, result.Backend, result.RelPath, itemBaseName, compCtx)
			} else {
				addErr = addBackendFileToZipWithProgress(bgCtx, zipWriter, result.Backend, result.RelPath, itemBaseName, compCtx)
			}
		} else {
			info, statErr := os.Stat(realPath)
			if statErr != nil {
				continue
			}
			if info.IsDir() {
				addErr = h.addDirToZipWithProgress(zipWriter, realPath, itemBaseName, compCtx)
			} else {
				addErr = h.addFileToZipWithProgress(zipWriter, realPath, itemBaseName, compCtx)
			}
		}

		if addErr != nil {
			if errors.Is(addErr, ErrCompressionCancelled) {
				compressionErr = addErr
				break
			}
			if strings.Contains(addErr.Error(), "no space left") ||
				strings.Contains(addErr.Error(), "permission denied") ||
				strings.Contains(addErr.Error(), "disk quota exceeded") {
				compressionErr = addErr
				break
			}
			fmt.Printf("[CompressStream] Error adding %s: %v\n", path, addErr)
		}
	}

	// Close zip writer and file
	zipWriter.Close()
	zipFile.Close()

	// Handle cancellation or error - delete partial zip file
	if compressionErr != nil {
		os.Remove(outputPath)
		errorMsg := "압축이 취소되었습니다"
		if !errors.Is(compressionErr, ErrCompressionCancelled) {
			errorMsg = fmt.Sprintf("압축 실패: %v", compressionErr)
		}
		compCtx.SendProgress(CompressionProgress{
			Status: "error",
			Error:  errorMsg,
		})
		return nil
	}

	// Get final file info
	finalInfo, _ := os.Stat(outputPath)
	var finalSize int64
	if finalInfo != nil {
		finalSize = finalInfo.Size()
	}

	// Upload temp zip to non-local backend
	if useTempOutput {
		defer os.Remove(outputPath)
		destRelPath := filepath.Join(parentResult.RelPath, outputName)
		if err := uploadFileToBackend(bgCtx, outputPath, parentResult.Backend, destRelPath); err != nil {
			compCtx.SendCompressionError(fmt.Errorf("failed to upload zip to external storage: %w", err))
			return nil
		}
	}

	outputDisplayPath := parentDisplayPath + "/" + outputName

	// Log audit event
	_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file.compress", outputDisplayPath, map[string]interface{}{
		"sourceCount": len(paths),
		"sources":     paths,
		"outputSize":  finalSize,
	})

	// Update storage tracking: add compressed file size (skip for external)
	if finalSize > 0 && !parentIsNonLocal {
		_ = h.UpdateUserStorage(claims.UserID, finalSize)
	}

	// Send completed event
	compCtx.SendCompressionCompleted(outputDisplayPath, outputName, finalSize)

	return nil
}
