package handlers

import (
	"fmt"
	"io"
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

	// Note: Move operation doesn't change total storage size, no update needed

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

	// Update storage tracking: add copied file size to user's storage
	if claims != nil && destStorageType == StorageHome {
		copiedSize, _ := GetFileSize(finalDestPath)
		if copiedSize > 0 {
			h.UpdateUserStorage(claims.UserID, copiedSize)
		}
	}

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

	// Resolve and validate paths
	paths, err := h.ResolveOperationPaths(c, requestPath, destination, false)
	if err != nil {
		if apiErr, ok := err.(*APIError); ok {
			return RespondError(c, apiErr)
		}
		return RespondError(c, ErrInternal(err.Error()))
	}

	// Set up SSE and calculate stats
	sendProgress := SetupSSE(c)
	stats := CalculateTotalSize(paths.SrcRealPath, paths.SrcInfo)

	// Send started event
	sendProgress(CopyProgress{
		Status:     "started",
		TotalBytes: stats.TotalBytes,
		TotalFiles: stats.TotalFiles,
	})

	// Create copy context and perform copy
	ctx := NewCopyContext(stats, sendProgress)
	copyErr := ctx.CopyWithProgress(paths.SrcRealPath, paths.FinalDestPath, paths.SrcInfo.IsDir())

	newDisplayPath := filepath.Join(paths.DestDisplayPath, filepath.Base(paths.FinalDestPath))

	if copyErr != nil {
		ctx.SendError(copyErr)
		return nil
	}

	// Log audit event
	var userID *string
	if paths.Claims != nil {
		userID = &paths.Claims.UserID
	}
	h.auditHandler.LogEvent(userID, c.RealIP(), EventFileCopy, paths.SrcDisplayPath, map[string]interface{}{
		"destination": newDisplayPath,
		"isDir":       paths.SrcInfo.IsDir(),
	})

	// Update storage tracking
	if paths.Claims != nil && paths.DestStorageType == StorageHome {
		h.UpdateUserStorage(paths.Claims.UserID, ctx.CopiedBytes)
	}

	ctx.SendCompleted(newDisplayPath)
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

	// Resolve and validate paths (allowSameFilename=false to generate unique names)
	paths, err := h.ResolveOperationPaths(c, requestPath, destination, false)
	if err != nil {
		if apiErr, ok := err.(*APIError); ok {
			return RespondError(c, apiErr)
		}
		return RespondError(c, ErrInternal(err.Error()))
	}

	// Prevent moving a directory into itself
	if strings.HasPrefix(paths.FinalDestPath, paths.SrcRealPath+string(os.PathSeparator)) {
		return RespondError(c, ErrBadRequest("Cannot move directory into itself"))
	}

	// Set up SSE and calculate stats
	sendProgress := SetupSSE(c)
	stats := CalculateTotalSize(paths.SrcRealPath, paths.SrcInfo)

	sendProgress(CopyProgress{
		Status:     "started",
		TotalBytes: stats.TotalBytes,
		TotalFiles: stats.TotalFiles,
	})

	startTime := time.Now()
	newDisplayPath := filepath.Join(paths.DestDisplayPath, filepath.Base(paths.FinalDestPath))

	// Try simple rename first (instant for same filesystem)
	err = os.Rename(paths.SrcRealPath, paths.FinalDestPath)

	if err != nil {
		// Cross-device move: copy then delete
		sendProgress(CopyProgress{
			Status:      "progress",
			TotalBytes:  stats.TotalBytes,
			CopiedBytes: 0,
			CurrentFile: "Cross-device move in progress...",
		})

		ctx := NewCopyContext(stats, sendProgress)
		copyErr := ctx.CopyWithProgress(paths.SrcRealPath, paths.FinalDestPath, paths.SrcInfo.IsDir())

		if copyErr != nil {
			ctx.SendError(copyErr)
			return nil
		}

		// Delete source after successful copy
		if paths.SrcInfo.IsDir() {
			os.RemoveAll(paths.SrcRealPath)
		} else {
			os.Remove(paths.SrcRealPath)
		}
	}

	// Log audit event
	var userID *string
	if paths.Claims != nil {
		userID = &paths.Claims.UserID
	}
	h.auditHandler.LogEvent(userID, c.RealIP(), EventFileMove, paths.SrcDisplayPath, map[string]interface{}{
		"destination": newDisplayPath,
	})

	// Send completed event
	elapsed := time.Since(startTime).Seconds()
	var finalSpeed int64
	if elapsed > 0 && stats.TotalBytes > 0 {
		finalSpeed = int64(float64(stats.TotalBytes) / elapsed)
	}
	sendProgress(CopyProgress{
		Status:      "completed",
		TotalBytes:  stats.TotalBytes,
		CopiedBytes: stats.TotalBytes,
		TotalFiles:  stats.TotalFiles,
		CopiedFiles: stats.TotalFiles,
		NewPath:     newDisplayPath,
		BytesPerSec: finalSpeed,
	})

	return nil
}
