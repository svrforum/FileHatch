package handlers

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// GetFile handles file download requests
// @Summary		Download file
// @Description	Download a file by path. Supports both inline viewing and forced download.
// @Tags		Download
// @Produce		octet-stream
// @Param		path		path		string	true	"File path"
// @Param		download	query		bool	false	"Force download with Content-Disposition attachment"
// @Success		200		{file}		binary	"File content"
// @Failure		400		{object}	map[string]string	"Bad request"
// @Failure		401		{object}	map[string]string	"Unauthorized"
// @Failure		403		{object}	map[string]string	"Forbidden"
// @Failure		404		{object}	map[string]string	"File not found"
// @Failure		500		{object}	map[string]string	"Internal server error"
// @Security	BearerAuth
// @Router		/files/{path} [get]
func (h *Handler) GetFile(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	// URL decode the path for proper handling of special characters
	decodedPath, err := url.PathUnescape(requestPath)
	if err != nil {
		decodedPath = requestPath // fallback to original if decode fails
	}

	// Get user claims if available
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	virtualPath := "/" + decodedPath
	result, realPath, err := h.resolveStorageForOperation(virtualPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}

	storageType := result.StorageType

	// Check shared permission
	if storageType == StorageShared {
		if claims == nil {
			return RespondError(c, ErrUnauthorized(""))
		}
		if !h.CanReadSharedDrive(claims.UserID, virtualPath) {
			return RespondError(c, ErrForbidden("No permission to access this file"))
		}
	}

	// Check if download is requested
	isDownload := c.QueryParam("download") == "true"

	// Handle non-local external storage backend
	if storageType == StorageExternal && realPath == "" {
		if result.Backend == nil {
			return RespondError(c, ErrOperationFailed("access file", fmt.Errorf("no backend available")))
		}
		ctx := c.Request().Context()
		reader, info, err := result.Backend.ReadFile(ctx, result.RelPath)
		if err != nil {
			return RespondError(c, ErrNotFound("File"))
		}
		defer reader.Close()

		if info.IsDirectory {
			return RespondError(c, ErrBadRequest("Path is a directory"))
		}

		fileName := info.FileName
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(fileName), "."))
		contentType := getMimeType(ext)

		// Log audit event for downloads
		if isDownload {
			var userID *string
			if claims != nil {
				userID = &claims.UserID
			}
			_ = h.auditHandler.LogEvent(userID, c.RealIP(), EventFileDownload, virtualPath, map[string]any{
				"filename":    fileName,
				"size":        info.FileSize,
				"storageType": storageType,
			})
		}

		// For Range request support: buffer to temp file, then use http.ServeContent.
		// This enables video seeking, download resume, and partial content (206) responses.
		tmpDir := filepath.Join(h.dataRoot, ".tmp")
		if err := os.MkdirAll(tmpDir, 0755); err != nil {
			log.Printf("[Download] Failed to create temp dir: %v", err)
		}
		tmpFile, err := os.CreateTemp(tmpDir, "ext_download_*")
		if err != nil {
			// Fallback: stream directly without Range support
			c.Response().Header().Set("Content-Type", contentType)
			if info.FileSize > 0 {
				c.Response().Header().Set("Content-Length", strconv.FormatInt(info.FileSize, 10))
			}
			if isDownload {
				setContentDisposition(c, fileName)
			}
			c.Response().WriteHeader(http.StatusOK)
			_, copyErr := io.Copy(c.Response().Writer, reader)
			return copyErr
		}
		defer os.Remove(tmpFile.Name())
		defer tmpFile.Close()

		if _, err := io.Copy(tmpFile, reader); err != nil {
			return RespondError(c, ErrInternal("Failed to read from external storage"))
		}

		// Seek back to beginning for ServeContent
		if _, err := tmpFile.Seek(0, io.SeekStart); err != nil {
			return RespondError(c, ErrInternal("Failed to prepare file for serving"))
		}

		// Set content type and disposition headers
		c.Response().Header().Set("Content-Type", contentType)
		if isDownload {
			setContentDisposition(c, fileName)
		}

		// Use FileModTime from backend if available, otherwise fall back to current time
		modTime := info.FileModTime
		if modTime.IsZero() {
			modTime = time.Now()
		}

		// http.ServeContent handles Range requests, Content-Length, and Last-Modified automatically
		http.ServeContent(c.Response(), c.Request(), fileName, modTime, tmpFile)
		return nil
	}

	// For home folder files accessed by the owner, no additional check needed
	// Shared file access is handled in the block below

	// If realPath doesn't exist but user is authenticated, check if it's a shared file
	if realPath == "" || (storageType == StorageSharedWithMe && claims != nil) {
		// Handle shared-with-me file access
		sharedRealPath, _, err := h.GetSharedFileOwnerPath(claims.UserID, virtualPath)
		if err == nil && h.CanReadSharedFile(claims.UserID, virtualPath) {
			realPath = sharedRealPath
		}
	}

	info, err := os.Stat(realPath)
	if err != nil {
		// File not found in direct path - check if it's a shared file
		if claims != nil && os.IsNotExist(err) {
			sharedRealPath, _, shareErr := h.GetSharedFileOwnerPath(claims.UserID, virtualPath)
			if shareErr == nil && h.CanReadSharedFile(claims.UserID, virtualPath) {
				realPath = sharedRealPath
				info, err = os.Stat(realPath)
			}
		}
		if err != nil {
			if os.IsNotExist(err) {
				return RespondError(c, ErrNotFound("File"))
			}
			return RespondError(c, ErrOperationFailed("access file", err))
		}
	}

	if info.IsDir() {
		return RespondError(c, ErrBadRequest("Path is a directory"))
	}

	if isDownload {
		setContentDisposition(c, info.Name())
	}

	// Log audit event for downloads
	if isDownload {
		var userID *string
		if claims != nil {
			userID = &claims.UserID
		}
		_ = h.auditHandler.LogEvent(userID, c.RealIP(), EventFileDownload, virtualPath, map[string]any{
			"filename":    info.Name(),
			"size":        info.Size(),
			"storageType": storageType,
		})
	}

	return c.File(realPath)
}

// DeleteFile handles file deletion requests
// @Summary		Delete file
// @Description	Permanently delete a file by path
// @Tags		Files
// @Accept		json
// @Produce		json
// @Param		path	path		string	true	"File path"
// @Success		200		{object}	docs.SuccessResponse	"File deleted successfully"
// @Failure		400		{object}	map[string]string	"Bad request"
// @Failure		401		{object}	map[string]string	"Unauthorized"
// @Failure		403		{object}	map[string]string	"Forbidden"
// @Failure		404		{object}	map[string]string	"File not found"
// @Failure		500		{object}	map[string]string	"Internal server error"
// @Security	BearerAuth
// @Router		/file/{path} [delete]
func (h *Handler) DeleteFile(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	// URL decode the path for proper handling of special characters
	decodedPath, err := url.PathUnescape(requestPath)
	if err != nil {
		decodedPath = requestPath // fallback to original if decode fails
	}
	requestPath = decodedPath

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	virtualPath := "/" + requestPath
	result, realPath, err := h.resolveStorageForOperation(virtualPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}

	storageType := result.StorageType
	displayPath := result.DisplayPath

	// Check readonly
	if err := checkReadonly(result); err != nil {
		return RespondError(c, ErrForbidden(err.Error()))
	}

	// Check permissions for home folder
	if storageType == StorageHome && claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	// Check shared write permission
	if storageType == StorageShared {
		if claims == nil {
			return RespondError(c, ErrUnauthorized(""))
		}
		if !h.CanWriteSharedDrive(claims.UserID, virtualPath) {
			return RespondError(c, ErrForbidden("No permission to delete files in this folder"))
		}
	}

	// Check file lock (only for authenticated users on local storage)
	if claims != nil {
		if lockErr := h.CheckFileLockForOperation(displayPath, claims.UserID); lockErr != nil {
			return RespondError(c, lockErr)
		}
	}

	// Handle non-local external storage
	if storageType == StorageExternal && realPath == "" {
		if result.Backend == nil {
			return RespondError(c, ErrOperationFailed("delete file", fmt.Errorf("no backend available")))
		}
		ctx := c.Request().Context()

		// Check if it exists and is not a directory
		info, err := result.Backend.Stat(ctx, result.RelPath)
		if err != nil {
			return RespondError(c, ErrNotFound("File"))
		}
		if info.IsDirectory {
			return RespondError(c, ErrBadRequest("Path is a directory, use DELETE /api/folders instead"))
		}

		if err := result.Backend.Delete(ctx, result.RelPath); err != nil {
			return RespondError(c, ErrOperationFailed("delete file", err))
		}

		// Clean up lock after successful deletion
		_ = h.RemoveLockByPath(displayPath)

		return c.JSON(http.StatusOK, map[string]any{
			"success": true,
			"path":    displayPath,
		})
	}

	info, err := os.Stat(realPath)
	if err != nil {
		if os.IsNotExist(err) {
			return RespondError(c, ErrNotFound("File"))
		}
		return RespondError(c, ErrOperationFailed("access file", err))
	}

	if info.IsDir() {
		return RespondError(c, ErrBadRequest("Path is a directory, use DELETE /api/folders instead"))
	}

	// Get file size before deleting (for storage tracking)
	fileSize := info.Size()

	if err := os.Remove(realPath); err != nil {
		return RespondError(c, ErrOperationFailed("delete file", err))
	}

	// Clean up lock after successful deletion
	_ = h.RemoveLockByPath(displayPath)

	// Update storage tracking
	if storageType == StorageShared {
		folderName := ExtractSharedDriveFolderName(virtualPath)
		if err := h.UpdateSharedFolderStorage(folderName, -fileSize); err != nil {
			fmt.Printf("[Storage] Failed to update shared folder storage: %v\n", err)
		}
	} else if storageType == StorageHome && claims != nil {
		if err := h.UpdateUserStorage(claims.UserID, -fileSize); err != nil {
			fmt.Printf("[Storage] Failed to update user storage: %v\n", err)
		}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"success": true,
		"path":    displayPath,
	})
}

// SaveFileContent saves text content to a file
// @Summary		Save file content
// @Description	Save text content to an existing file (for text editor)
// @Tags		Files
// @Accept		text/plain
// @Produce		json
// @Param		path	path		string	true	"File path"
// @Param		content	body		string	true	"File content"
// @Success		200		{object}	docs.SuccessResponse	"File saved successfully"
// @Failure		400		{object}	map[string]string	"Bad request"
// @Failure		401		{object}	map[string]string	"Unauthorized"
// @Failure		403		{object}	map[string]string	"Forbidden"
// @Failure		404		{object}	map[string]string	"File not found"
// @Failure		500		{object}	map[string]string	"Internal server error"
// @Security	BearerAuth
// @Router		/file/{path} [put]
func (h *Handler) SaveFileContent(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	virtualPath := "/" + requestPath
	result, realPath, err := h.resolveStorageForOperation(virtualPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}

	storageType := result.StorageType

	// Check readonly
	if err := checkReadonly(result); err != nil {
		return RespondError(c, ErrForbidden(err.Error()))
	}

	// Check shared write permission
	if storageType == StorageShared {
		if claims == nil {
			return RespondError(c, ErrUnauthorized(""))
		}
		if !h.CanWriteSharedDrive(claims.UserID, virtualPath) {
			return RespondError(c, ErrForbidden("No permission to edit files in this folder"))
		}
	}

	// Check file lock
	if claims != nil {
		displayPath := result.DisplayPath
		if lockErr := h.CheckFileLockForOperation(displayPath, claims.UserID); lockErr != nil {
			return RespondError(c, lockErr)
		}
	}

	// Handle non-local external storage
	if storageType == StorageExternal && realPath == "" {
		if result.Backend == nil {
			return RespondError(c, ErrOperationFailed("save file", fmt.Errorf("no backend available")))
		}
		ctx := c.Request().Context()

		// Check if the file exists (but allow saving to existing files)
		info, err := result.Backend.Stat(ctx, result.RelPath)
		if err != nil {
			return RespondError(c, ErrNotFound("File"))
		}
		if info.IsDirectory {
			return RespondError(c, ErrBadRequest("Path is a directory"))
		}

		// Get content length from header
		size := c.Request().ContentLength

		// Write file content directly via backend
		if err := result.Backend.WriteFile(ctx, result.RelPath, c.Request().Body, size); err != nil {
			return RespondError(c, ErrOperationFailed("save file", err))
		}

		// Log the action
		var userID *string
		if claims != nil {
			userID = &claims.UserID
		}
		_ = h.auditHandler.LogEvent(userID, c.RealIP(), EventFileEdit, virtualPath, map[string]any{
			"size":        size,
			"storageType": storageType,
		})

		return c.JSON(http.StatusOK, map[string]any{
			"success": true,
			"message": "File saved successfully",
			"size":    size,
		})
	}

	// Handle shared file editing
	isSharedFile := false
	if realPath == "" || storageType == StorageSharedWithMe {
		if claims == nil {
			return RespondError(c, ErrUnauthorized(""))
		}
		// Check if user has write permission for this shared file
		if !h.CanWriteSharedFile(claims.UserID, virtualPath) {
			return RespondError(c, ErrForbidden("No permission to edit this shared file"))
		}
		sharedRealPath, _, err := h.GetSharedFileOwnerPath(claims.UserID, virtualPath)
		if err != nil {
			return RespondError(c, ErrNotFound("Shared file"))
		}
		realPath = sharedRealPath
		isSharedFile = true
	}

	// Check if file exists
	info, err := os.Stat(realPath)
	if err != nil {
		// If not found at direct path, check if it's a shared file
		if claims != nil && os.IsNotExist(err) && !isSharedFile {
			if h.CanWriteSharedFile(claims.UserID, virtualPath) {
				sharedRealPath, _, shareErr := h.GetSharedFileOwnerPath(claims.UserID, virtualPath)
				if shareErr == nil {
					realPath = sharedRealPath
					info, err = os.Stat(realPath)
					isSharedFile = true
				}
			}
		}
		if err != nil {
			if os.IsNotExist(err) {
				return RespondError(c, ErrNotFound("File"))
			}
			return RespondError(c, ErrOperationFailed("access file", err))
		}
	}

	if info.IsDir() {
		return RespondError(c, ErrBadRequest("Path is a directory"))
	}

	// Stream request body to temp file to avoid buffering entire content in memory
	dir := filepath.Dir(realPath)
	tmpFile, err := os.CreateTemp(dir, ".fh-save-*")
	if err != nil {
		return RespondError(c, ErrOperationFailed("create temp file", err))
	}
	tmpPath := tmpFile.Name()

	// Clean up temp file on any failure
	defer func() {
		if tmpPath != "" {
			os.Remove(tmpPath)
		}
	}()

	written, err := io.Copy(tmpFile, c.Request().Body)
	if closeErr := tmpFile.Close(); closeErr != nil && err == nil {
		err = closeErr
	}
	if err != nil {
		return RespondError(c, ErrOperationFailed("write file content", err))
	}

	// Preserve original file permissions
	if perm := info.Mode().Perm(); perm != 0 {
		_ = os.Chmod(tmpPath, perm)
	}

	// Atomic rename
	if err := os.Rename(tmpPath, realPath); err != nil {
		return RespondError(c, ErrOperationFailed("save file", err))
	}
	tmpPath = "" // prevent deferred cleanup

	// Log the action
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	clientIP := c.RealIP()
	_ = h.auditHandler.LogEvent(userID, clientIP, EventFileEdit, "/"+requestPath, map[string]any{
		"size":        written,
		"storageType": storageType,
		"isShared":    isSharedFile,
	})

	return c.JSON(http.StatusOK, map[string]any{
		"success": true,
		"message": "File saved successfully",
		"size":    written,
	})
}

// CheckFileExists checks if a file exists at the given path
// @Summary		Check file exists
// @Description	Check if a file exists at the given path
// @Tags		Files
// @Accept		json
// @Produce		json
// @Param		path		query		string	false	"Parent folder path"
// @Param		filename	query		string	true	"Filename to check"
// @Success		200		{object}	map[string]interface{}	"File existence status"
// @Failure		400		{object}	map[string]string	"Bad request"
// @Security	BearerAuth
// @Router		/files/exists [get]
func (h *Handler) CheckFileExists(c echo.Context) error {
	requestPath := c.QueryParam("path")
	filename := c.QueryParam("filename")

	if filename == "" {
		return RespondError(c, ErrMissingParameter("filename"))
	}

	if requestPath == "" {
		requestPath = "/"
	}

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	result, realPath, err := h.resolveStorageForOperation(requestPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}

	if result.StorageType == "root" {
		return RespondError(c, ErrBadRequest("Cannot check file at root"))
	}

	// Handle non-local external storage
	if result.StorageType == StorageExternal && realPath == "" {
		if result.Backend == nil {
			return RespondError(c, ErrBadRequest("No backend available"))
		}
		ctx := c.Request().Context()
		checkPath := result.RelPath
		if checkPath != "" {
			checkPath = filepath.Join(checkPath, filename)
		} else {
			checkPath = filename
		}
		exists, _ := result.Backend.Exists(ctx, checkPath)
		return c.JSON(http.StatusOK, map[string]any{
			"exists":   exists,
			"path":     filepath.Join(result.DisplayPath, filename),
			"filename": filename,
		})
	}

	fullPath := filepath.Join(realPath, filename)

	_, err = os.Stat(fullPath)
	exists := !os.IsNotExist(err)

	return c.JSON(http.StatusOK, map[string]any{
		"exists":   exists,
		"path":     filepath.Join(result.DisplayPath, filename),
		"filename": filename,
	})
}
