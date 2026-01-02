package handlers

import (
	"encoding/json"
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

// RenameRequest is the request body for renaming files or folders
type RenameRequest struct {
	NewName string `json:"newName"`
}

// RenameItem renames a file or folder
// @Summary		Rename item
// @Description	Rename a file or folder
// @Tags		Files
// @Accept		json
// @Produce		json
// @Param		path	path		string			true	"Item path"
// @Param		request	body		RenameRequest	true	"New name"
// @Success		200		{object}	docs.SuccessResponse	"Item renamed successfully"
// @Failure		400		{object}	docs.ErrorResponse	"Bad request"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		404		{object}	docs.ErrorResponse	"Item not found"
// @Failure		409		{object}	docs.ErrorResponse	"Item already exists"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/rename/{path} [post]
func (h *Handler) RenameItem(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	// URL decode the path in case browser didn't encode special characters
	if decodedPath, err := url.QueryUnescape(requestPath); err == nil {
		requestPath = decodedPath
	}

	var req RenameRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	if req.NewName == "" {
		return RespondError(c, ErrMissingParameter("newName"))
	}

	// Validate new name
	if strings.ContainsAny(req.NewName, `/\:*?"<>|`) {
		return RespondError(c, ErrBadRequest("Invalid name"))
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	realPath, storageType, displayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	if storageType == "root" || displayPath == "/home" || displayPath == "/shared" {
		return RespondError(c, ErrBadRequest("Cannot rename root folders"))
	}

	// Check permissions for home folder
	if storageType == StorageHome && claims == nil {
		return RespondError(c, ErrUnauthorized("Authentication required"))
	}

	// Check if source exists
	if _, err := os.Stat(realPath); err != nil {
		if os.IsNotExist(err) {
			return RespondError(c, ErrNotFound("Item not found"))
		}
		return RespondError(c, ErrInternal("Failed to access item"))
	}

	// Build new path
	parentDir := filepath.Dir(realPath)
	newRealPath := filepath.Join(parentDir, req.NewName)

	// Check if destination already exists
	if _, err := os.Stat(newRealPath); err == nil {
		return RespondError(c, ErrAlreadyExists("An item with that name already exists"))
	}

	// Rename
	if err := os.Rename(realPath, newRealPath); err != nil {
		return RespondError(c, ErrOperationFailed("rename item", err))
	}

	newDisplayPath := filepath.Join(filepath.Dir(displayPath), req.NewName)

	// Log audit event
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	// Get file info for isDir check
	fileInfo, _ := os.Stat(newRealPath)
	isDir := fileInfo != nil && fileInfo.IsDir()
	h.auditHandler.LogEvent(userID, c.RealIP(), EventFileRename, displayPath, map[string]interface{}{
		"newName": req.NewName,
		"newPath": newDisplayPath,
		"isDir":   isDir,
	})

	return RespondSuccess(c, map[string]interface{}{
		"oldPath": displayPath,
		"newPath": newDisplayPath,
		"newName": req.NewName,
	})
}

// MoveRequest is the request body for moving files or folders
type MoveRequest struct {
	Destination string `json:"destination"`
}

// MoveItem moves a file or folder to a new location
// @Summary		Move item
// @Description	Move a file or folder to a new location
// @Tags		Files
// @Accept		json
// @Produce		json
// @Param		path	path		string		true	"Source item path"
// @Param		request	body		MoveRequest	true	"Destination path"
// @Success		200		{object}	docs.SuccessResponse	"Item moved successfully"
// @Failure		400		{object}	docs.ErrorResponse	"Bad request"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		404		{object}	docs.ErrorResponse	"Item not found"
// @Failure		409		{object}	docs.ErrorResponse	"Item already exists"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/move/{path} [post]
func (h *Handler) MoveItem(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	// URL decode the path in case browser didn't encode special characters
	decodedPath, err := url.QueryUnescape(requestPath)
	if err == nil {
		requestPath = decodedPath
	}

	var req MoveRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	if req.Destination == "" {
		return RespondError(c, ErrMissingParameter("destination"))
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve source path
	srcRealPath, srcStorageType, srcDisplayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	if srcStorageType == "root" || srcDisplayPath == "/home" || srcDisplayPath == "/shared" {
		return RespondError(c, ErrBadRequest("Cannot move root folders"))
	}

	// Resolve destination path
	destRealPath, destStorageType, destDisplayPath, err := h.resolvePath(req.Destination, claims)
	if err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	if destStorageType == "root" {
		return RespondError(c, ErrBadRequest("Cannot move to root"))
	}

	// Check permissions
	if (srcStorageType == StorageHome || destStorageType == StorageHome) && claims == nil {
		return RespondError(c, ErrUnauthorized("Authentication required"))
	}

	// Check if source exists
	srcInfo, err := os.Stat(srcRealPath)
	if err != nil {
		if os.IsNotExist(err) {
			return RespondError(c, ErrNotFound("Source not found"))
		}
		return RespondError(c, ErrInternal("Failed to access source"))
	}

	// Check if destination is a directory
	destInfo, err := os.Stat(destRealPath)
	if err != nil {
		if os.IsNotExist(err) {
			return RespondError(c, ErrNotFound("Destination not found"))
		}
		return RespondError(c, ErrInternal("Failed to access destination"))
	}

	if !destInfo.IsDir() {
		return RespondError(c, ErrBadRequest("Destination must be a directory"))
	}

	// Build final destination path
	finalDestPath := filepath.Join(destRealPath, srcInfo.Name())

	// Check if destination already exists
	if _, err := os.Stat(finalDestPath); err == nil {
		return RespondError(c, ErrAlreadyExists("An item with that name already exists at destination"))
	}

	// Move (rename)
	if err := os.Rename(srcRealPath, finalDestPath); err != nil {
		return RespondError(c, ErrOperationFailed("move item", err))
	}

	newDisplayPath := filepath.Join(destDisplayPath, srcInfo.Name())

	// Log audit event
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	h.auditHandler.LogEvent(userID, c.RealIP(), EventFileMove, srcDisplayPath, map[string]interface{}{
		"destination": newDisplayPath,
		"isDir":       srcInfo.IsDir(),
	})

	return RespondSuccess(c, map[string]interface{}{
		"oldPath": srcDisplayPath,
		"newPath": newDisplayPath,
	})
}

// CopyRequest is the request body for copying files or folders
type CopyRequest struct {
	Destination string `json:"destination"`
}

// CopyItem copies a file or folder to a new location
// @Summary		Copy item
// @Description	Copy a file or folder to a new location
// @Tags		Files
// @Accept		json
// @Produce		json
// @Param		path	path		string		true	"Source item path"
// @Param		request	body		CopyRequest	true	"Destination path"
// @Success		200		{object}	docs.SuccessResponse	"Item copied successfully"
// @Failure		400		{object}	docs.ErrorResponse	"Bad request"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		404		{object}	docs.ErrorResponse	"Item not found"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/copy/{path} [post]
func (h *Handler) CopyItem(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	// URL decode the path in case browser didn't encode special characters
	if decodedPath, err := url.QueryUnescape(requestPath); err == nil {
		requestPath = decodedPath
	}

	var req CopyRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	if req.Destination == "" {
		return RespondError(c, ErrMissingParameter("destination"))
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve source path
	srcRealPath, srcStorageType, srcDisplayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	if srcStorageType == "root" {
		return RespondError(c, ErrBadRequest("Cannot copy root"))
	}

	// Resolve destination path
	destRealPath, destStorageType, destDisplayPath, err := h.resolvePath(req.Destination, claims)
	if err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	if destStorageType == "root" {
		return RespondError(c, ErrBadRequest("Cannot copy to root"))
	}

	// Check permissions
	if (srcStorageType == StorageHome || destStorageType == StorageHome) && claims == nil {
		return RespondError(c, ErrUnauthorized("Authentication required"))
	}

	// Check if source exists
	srcInfo, err := os.Stat(srcRealPath)
	if err != nil {
		if os.IsNotExist(err) {
			return RespondError(c, ErrNotFound("Source not found"))
		}
		return RespondError(c, ErrInternal("Failed to access source"))
	}

	// Check if destination is a directory
	destInfo, err := os.Stat(destRealPath)
	if err != nil {
		if os.IsNotExist(err) {
			return RespondError(c, ErrNotFound("Destination not found"))
		}
		return RespondError(c, ErrInternal("Failed to access destination"))
	}

	if !destInfo.IsDir() {
		return RespondError(c, ErrBadRequest("Destination must be a directory"))
	}

	// Build final destination path
	finalDestPath := filepath.Join(destRealPath, srcInfo.Name())

	// Check if destination already exists - if so, create a copy with a number
	baseName := srcInfo.Name()
	ext := filepath.Ext(baseName)
	nameWithoutExt := strings.TrimSuffix(baseName, ext)
	counter := 1
	for {
		if _, err := os.Stat(finalDestPath); os.IsNotExist(err) {
			break
		}
		if srcInfo.IsDir() {
			finalDestPath = filepath.Join(destRealPath, fmt.Sprintf("%s (%d)", baseName, counter))
		} else {
			finalDestPath = filepath.Join(destRealPath, fmt.Sprintf("%s (%d)%s", nameWithoutExt, counter, ext))
		}
		counter++
	}

	// Perform copy
	if srcInfo.IsDir() {
		err = copyDir(srcRealPath, finalDestPath)
	} else {
		err = copyFile(srcRealPath, finalDestPath)
	}

	if err != nil {
		return RespondError(c, ErrOperationFailed("copy item", err))
	}

	newDisplayPath := filepath.Join(destDisplayPath, filepath.Base(finalDestPath))

	// Log audit event
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	h.auditHandler.LogEvent(userID, c.RealIP(), EventFileCopy, srcDisplayPath, map[string]interface{}{
		"destination": newDisplayPath,
		"isDir":       srcInfo.IsDir(),
	})

	return RespondSuccess(c, map[string]interface{}{
		"oldPath": srcDisplayPath,
		"newPath": newDisplayPath,
	})
}

// copyFile copies a single file
func copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	destFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, sourceFile)
	if err != nil {
		return err
	}

	// Copy file permissions
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}
	return os.Chmod(dst, srcInfo.Mode())
}

// copyDir recursively copies a directory
func copyDir(src, dst string) error {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dst, srcInfo.Mode()); err != nil {
		return err
	}

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if entry.IsDir() {
			if err := copyDir(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}

	return nil
}

// CopyProgress represents the progress of a copy operation
type CopyProgress struct {
	Status      string `json:"status"` // "started", "progress", "completed", "error"
	TotalBytes  int64  `json:"totalBytes"`
	CopiedBytes int64  `json:"copiedBytes"`
	CurrentFile string `json:"currentFile,omitempty"`
	TotalFiles  int    `json:"totalFiles,omitempty"`
	CopiedFiles int    `json:"copiedFiles,omitempty"`
	Error       string `json:"error,omitempty"`
	NewPath     string `json:"newPath,omitempty"`
	BytesPerSec int64  `json:"bytesPerSec,omitempty"`
}

// CopyItemStream copies a file or folder with streaming progress via SSE
// @Summary		Copy item with progress
// @Description	Copy a file or folder with real-time progress updates via Server-Sent Events
// @Tags		Files
// @Produce		text/event-stream
// @Param		path		path		string	true	"Source item path"
// @Param		destination	query		string	true	"Destination folder path"
// @Success		200		{object}	CopyProgress	"SSE stream with progress updates"
// @Failure		400		{object}	docs.ErrorResponse	"Bad request"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		404		{object}	docs.ErrorResponse	"Item not found"
// @Security	BearerAuth
// @Router		/copy-stream/{path} [get]
func (h *Handler) CopyItemStream(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	if decodedPath, err := url.QueryUnescape(requestPath); err == nil {
		requestPath = decodedPath
	}

	destination := c.QueryParam("destination")
	if destination == "" {
		return RespondError(c, ErrMissingParameter("destination"))
	}

	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve source path
	srcRealPath, srcStorageType, srcDisplayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	if srcStorageType == "root" {
		return RespondError(c, ErrBadRequest("Cannot copy root"))
	}

	// Resolve destination path
	destRealPath, destStorageType, destDisplayPath, err := h.resolvePath(destination, claims)
	if err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	if destStorageType == "root" {
		return RespondError(c, ErrBadRequest("Cannot copy to root"))
	}

	// Check permissions
	if (srcStorageType == StorageHome || destStorageType == StorageHome) && claims == nil {
		return RespondError(c, ErrUnauthorized("Authentication required"))
	}

	// Check if source exists
	srcInfo, err := os.Stat(srcRealPath)
	if err != nil {
		if os.IsNotExist(err) {
			return RespondError(c, ErrNotFound("Source not found"))
		}
		return RespondError(c, ErrInternal("Failed to access source"))
	}

	// Check if destination is a directory
	destInfo, err := os.Stat(destRealPath)
	if err != nil {
		return RespondError(c, ErrNotFound("Destination not found"))
	}
	if !destInfo.IsDir() {
		return RespondError(c, ErrBadRequest("Destination must be a directory"))
	}

	// Build final destination path with duplicate handling
	finalDestPath := filepath.Join(destRealPath, srcInfo.Name())
	baseName := srcInfo.Name()
	ext := filepath.Ext(baseName)
	nameWithoutExt := strings.TrimSuffix(baseName, ext)
	counter := 1
	for {
		if _, err := os.Stat(finalDestPath); os.IsNotExist(err) {
			break
		}
		if srcInfo.IsDir() {
			finalDestPath = filepath.Join(destRealPath, fmt.Sprintf("%s (%d)", baseName, counter))
		} else {
			finalDestPath = filepath.Join(destRealPath, fmt.Sprintf("%s (%d)%s", nameWithoutExt, counter, ext))
		}
		counter++
	}

	// Set up SSE
	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().Header().Set("X-Accel-Buffering", "no")
	c.Response().WriteHeader(http.StatusOK)

	// Helper to send progress
	sendProgress := func(progress CopyProgress) {
		data, _ := json.Marshal(progress)
		fmt.Fprintf(c.Response(), "data: %s\n\n", data)
		c.Response().Flush()
	}

	// Calculate total size
	var totalBytes int64
	var totalFiles int
	if srcInfo.IsDir() {
		filepath.Walk(srcRealPath, func(_ string, info os.FileInfo, _ error) error {
			if info != nil && !info.IsDir() {
				totalBytes += info.Size()
				totalFiles++
			}
			return nil
		})
	} else {
		totalBytes = srcInfo.Size()
		totalFiles = 1
	}

	// Send started event
	sendProgress(CopyProgress{
		Status:     "started",
		TotalBytes: totalBytes,
		TotalFiles: totalFiles,
	})

	// Copy with progress tracking
	var copiedBytes int64
	var copiedFiles int
	var copyErr error
	startTime := time.Now()
	var lastProgressTime time.Time

	copyFileWithProgress := func(src, dst string) error {
		sourceFile, err := os.Open(src)
		if err != nil {
			return err
		}
		defer sourceFile.Close()

		srcStat, _ := sourceFile.Stat()
		sendProgress(CopyProgress{
			Status:      "progress",
			TotalBytes:  totalBytes,
			CopiedBytes: copiedBytes,
			CurrentFile: filepath.Base(src),
			TotalFiles:  totalFiles,
			CopiedFiles: copiedFiles,
		})

		destFile, err := os.Create(dst)
		if err != nil {
			return err
		}
		defer destFile.Close()

		buf := make([]byte, 1024*1024) // 1MB buffer
		for {
			n, readErr := sourceFile.Read(buf)
			if n > 0 {
				_, writeErr := destFile.Write(buf[:n])
				if writeErr != nil {
					return writeErr
				}
				copiedBytes += int64(n)

				// Send progress every 200ms or at least every 500KB
				if time.Since(lastProgressTime) > 200*time.Millisecond {
					elapsed := time.Since(startTime).Seconds()
					var bytesPerSec int64
					if elapsed > 0 {
						bytesPerSec = int64(float64(copiedBytes) / elapsed)
					}
					sendProgress(CopyProgress{
						Status:      "progress",
						TotalBytes:  totalBytes,
						CopiedBytes: copiedBytes,
						CurrentFile: filepath.Base(src),
						TotalFiles:  totalFiles,
						CopiedFiles: copiedFiles,
						BytesPerSec: bytesPerSec,
					})
					lastProgressTime = time.Now()
				}
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				return readErr
			}
		}

		copiedFiles++
		os.Chmod(dst, srcStat.Mode())
		return nil
	}

	var copyDirWithProgress func(src, dst string) error
	copyDirWithProgress = func(src, dst string) error {
		srcInfo, err := os.Stat(src)
		if err != nil {
			return err
		}

		if err := os.MkdirAll(dst, srcInfo.Mode()); err != nil {
			return err
		}

		entries, err := os.ReadDir(src)
		if err != nil {
			return err
		}

		for _, entry := range entries {
			srcPath := filepath.Join(src, entry.Name())
			dstPath := filepath.Join(dst, entry.Name())

			if entry.IsDir() {
				if err := copyDirWithProgress(srcPath, dstPath); err != nil {
					return err
				}
			} else {
				if err := copyFileWithProgress(srcPath, dstPath); err != nil {
					return err
				}
			}
		}
		return nil
	}

	// Perform copy
	if srcInfo.IsDir() {
		copyErr = copyDirWithProgress(srcRealPath, finalDestPath)
	} else {
		copyErr = copyFileWithProgress(srcRealPath, finalDestPath)
	}

	newDisplayPath := filepath.Join(destDisplayPath, filepath.Base(finalDestPath))

	if copyErr != nil {
		sendProgress(CopyProgress{
			Status: "error",
			Error:  copyErr.Error(),
		})
		return nil
	}

	// Log audit event
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	h.auditHandler.LogEvent(userID, c.RealIP(), EventFileCopy, srcDisplayPath, map[string]interface{}{
		"destination": newDisplayPath,
		"isDir":       srcInfo.IsDir(),
	})

	// Send completed event
	elapsed := time.Since(startTime).Seconds()
	var finalSpeed int64
	if elapsed > 0 {
		finalSpeed = int64(float64(copiedBytes) / elapsed)
	}
	sendProgress(CopyProgress{
		Status:      "completed",
		TotalBytes:  totalBytes,
		CopiedBytes: copiedBytes,
		TotalFiles:  totalFiles,
		CopiedFiles: copiedFiles,
		NewPath:     newDisplayPath,
		BytesPerSec: finalSpeed,
	})

	return nil
}

// MoveItemStream moves a file or folder with streaming progress via SSE
// @Summary		Move item with progress
// @Description	Move a file or folder with real-time progress updates via Server-Sent Events
// @Tags		Files
// @Produce		text/event-stream
// @Param		path		path		string	true	"Source item path"
// @Param		destination	query		string	true	"Destination folder path"
// @Success		200		{object}	CopyProgress	"SSE stream with progress updates"
// @Failure		400		{object}	docs.ErrorResponse	"Bad request"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		404		{object}	docs.ErrorResponse	"Item not found"
// @Security	BearerAuth
// @Router		/move-stream/{path} [get]
func (h *Handler) MoveItemStream(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	if decodedPath, err := url.QueryUnescape(requestPath); err == nil {
		requestPath = decodedPath
	}

	destination := c.QueryParam("destination")
	if destination == "" {
		return RespondError(c, ErrMissingParameter("destination"))
	}

	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve source path
	srcRealPath, srcStorageType, srcDisplayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	if srcStorageType == "root" {
		return RespondError(c, ErrBadRequest("Cannot move root"))
	}

	// Resolve destination path
	destRealPath, destStorageType, destDisplayPath, err := h.resolvePath(destination, claims)
	if err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	if destStorageType == "root" {
		return RespondError(c, ErrBadRequest("Cannot move to root"))
	}

	// Check permissions
	if (srcStorageType == StorageHome || destStorageType == StorageHome) && claims == nil {
		return RespondError(c, ErrUnauthorized("Authentication required"))
	}

	// Check if source exists
	srcInfo, err := os.Stat(srcRealPath)
	if err != nil {
		if os.IsNotExist(err) {
			return RespondError(c, ErrNotFound("Source not found"))
		}
		return RespondError(c, ErrInternal("Failed to access source"))
	}

	// Check if destination is a directory
	destInfo, err := os.Stat(destRealPath)
	if err != nil {
		return RespondError(c, ErrNotFound("Destination not found"))
	}
	if !destInfo.IsDir() {
		return RespondError(c, ErrBadRequest("Destination must be a directory"))
	}

	// Build final destination path
	finalDestPath := filepath.Join(destRealPath, srcInfo.Name())
	baseName := srcInfo.Name()
	ext := filepath.Ext(baseName)
	nameWithoutExt := strings.TrimSuffix(baseName, ext)
	counter := 1
	for {
		if _, err := os.Stat(finalDestPath); os.IsNotExist(err) {
			break
		}
		if srcInfo.IsDir() {
			finalDestPath = filepath.Join(destRealPath, fmt.Sprintf("%s (%d)", baseName, counter))
		} else {
			finalDestPath = filepath.Join(destRealPath, fmt.Sprintf("%s (%d)%s", nameWithoutExt, counter, ext))
		}
		counter++
	}

	// Prevent moving a directory into itself
	if strings.HasPrefix(finalDestPath, srcRealPath+string(os.PathSeparator)) {
		return RespondError(c, ErrBadRequest("Cannot move directory into itself"))
	}

	// Set up SSE
	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().Header().Set("X-Accel-Buffering", "no")
	c.Response().WriteHeader(http.StatusOK)

	sendProgress := func(progress CopyProgress) {
		data, _ := json.Marshal(progress)
		fmt.Fprintf(c.Response(), "data: %s\n\n", data)
		c.Response().Flush()
	}

	// Calculate total size
	var totalBytes int64
	var totalFiles int
	if srcInfo.IsDir() {
		filepath.Walk(srcRealPath, func(_ string, info os.FileInfo, _ error) error {
			if info != nil && !info.IsDir() {
				totalBytes += info.Size()
				totalFiles++
			}
			return nil
		})
	} else {
		totalBytes = srcInfo.Size()
		totalFiles = 1
	}

	sendProgress(CopyProgress{
		Status:     "started",
		TotalBytes: totalBytes,
		TotalFiles: totalFiles,
	})

	startTime := time.Now()

	// Try simple rename first (instant for same filesystem)
	err = os.Rename(srcRealPath, finalDestPath)

	newDisplayPath := filepath.Join(destDisplayPath, filepath.Base(finalDestPath))

	if err != nil {
		// Cross-device move: copy then delete
		sendProgress(CopyProgress{
			Status:      "progress",
			TotalBytes:  totalBytes,
			CopiedBytes: 0,
			CurrentFile: "크로스 디바이스 이동 중...",
		})

		// Copy with progress
		var copiedBytes int64
		var copiedFiles int
		var lastProgressTime time.Time

		copyFileWithProgress := func(src, dst string) error {
			sourceFile, err := os.Open(src)
			if err != nil {
				return err
			}
			defer sourceFile.Close()

			srcStat, _ := sourceFile.Stat()

			destFile, err := os.Create(dst)
			if err != nil {
				return err
			}
			defer destFile.Close()

			buf := make([]byte, 1024*1024)
			for {
				n, readErr := sourceFile.Read(buf)
				if n > 0 {
					_, writeErr := destFile.Write(buf[:n])
					if writeErr != nil {
						return writeErr
					}
					copiedBytes += int64(n)

					if time.Since(lastProgressTime) > 200*time.Millisecond {
						elapsed := time.Since(startTime).Seconds()
						var bytesPerSec int64
						if elapsed > 0 {
							bytesPerSec = int64(float64(copiedBytes) / elapsed)
						}
						sendProgress(CopyProgress{
							Status:      "progress",
							TotalBytes:  totalBytes,
							CopiedBytes: copiedBytes,
							CurrentFile: filepath.Base(src),
							TotalFiles:  totalFiles,
							CopiedFiles: copiedFiles,
							BytesPerSec: bytesPerSec,
						})
						lastProgressTime = time.Now()
					}
				}
				if readErr == io.EOF {
					break
				}
				if readErr != nil {
					return readErr
				}
			}

			copiedFiles++
			os.Chmod(dst, srcStat.Mode())
			return nil
		}

		var copyDirWithProgress func(src, dst string) error
		copyDirWithProgress = func(src, dst string) error {
			srcInfo, err := os.Stat(src)
			if err != nil {
				return err
			}

			if err := os.MkdirAll(dst, srcInfo.Mode()); err != nil {
				return err
			}

			entries, err := os.ReadDir(src)
			if err != nil {
				return err
			}

			for _, entry := range entries {
				srcPath := filepath.Join(src, entry.Name())
				dstPath := filepath.Join(dst, entry.Name())

				if entry.IsDir() {
					if err := copyDirWithProgress(srcPath, dstPath); err != nil {
						return err
					}
				} else {
					if err := copyFileWithProgress(srcPath, dstPath); err != nil {
						return err
					}
				}
			}
			return nil
		}

		var copyErr error
		if srcInfo.IsDir() {
			copyErr = copyDirWithProgress(srcRealPath, finalDestPath)
		} else {
			copyErr = copyFileWithProgress(srcRealPath, finalDestPath)
		}

		if copyErr != nil {
			sendProgress(CopyProgress{
				Status: "error",
				Error:  copyErr.Error(),
			})
			return nil
		}

		// Delete source after successful copy
		if srcInfo.IsDir() {
			os.RemoveAll(srcRealPath)
		} else {
			os.Remove(srcRealPath)
		}
	}

	// Log audit event
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	h.auditHandler.LogEvent(userID, c.RealIP(), EventFileMove, srcDisplayPath, map[string]interface{}{
		"destination": newDisplayPath,
	})

	// Send completed event
	elapsed := time.Since(startTime).Seconds()
	var finalSpeed int64
	if elapsed > 0 && totalBytes > 0 {
		finalSpeed = int64(float64(totalBytes) / elapsed)
	}
	sendProgress(CopyProgress{
		Status:      "completed",
		TotalBytes:  totalBytes,
		CopiedBytes: totalBytes,
		TotalFiles:  totalFiles,
		CopiedFiles: totalFiles,
		NewPath:     newDisplayPath,
		BytesPerSec: finalSpeed,
	})

	return nil
}
