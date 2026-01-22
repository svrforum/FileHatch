package handlers

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"

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
	realPath, storageType, _, err := h.resolvePath(virtualPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}

	// Check shared permission
	if storageType == StorageShared {
		if claims == nil {
			return RespondError(c, ErrUnauthorized(""))
		}
		if !h.CanReadSharedDrive(claims.UserID, virtualPath) {
			return RespondError(c, ErrForbidden("No permission to access this file"))
		}
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

	// Check if download is requested
	isDownload := c.QueryParam("download") == "true"
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

	// Get user claims
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve path
	realPath, storageType, displayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}

	// Check permissions for home folder
	if storageType == StorageHome && claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	// Check shared write permission
	virtualPath := "/" + requestPath
	if storageType == StorageShared {
		if claims == nil {
			return RespondError(c, ErrUnauthorized(""))
		}
		if !h.CanWriteSharedDrive(claims.UserID, virtualPath) {
			return RespondError(c, ErrForbidden("No permission to delete files in this folder"))
		}
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
	realPath, storageType, _, err := h.resolvePath(virtualPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
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

	// Read request body
	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return RespondError(c, ErrBadRequest("Failed to read request body"))
	}

	// Write to file
	if err := os.WriteFile(realPath, body, 0644); err != nil {
		return RespondError(c, ErrOperationFailed("save file", err))
	}

	// Log the action
	var userID *string
	if claims != nil {
		userID = &claims.UserID
	}
	clientIP := c.RealIP()
	_ = h.auditHandler.LogEvent(userID, clientIP, EventFileEdit, "/"+requestPath, map[string]any{
		"size":        len(body),
		"storageType": storageType,
		"isShared":    isSharedFile,
	})

	return c.JSON(http.StatusOK, map[string]any{
		"success": true,
		"message": "File saved successfully",
		"size":    len(body),
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
	realPath, storageType, displayPath, err := h.resolvePath(requestPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}

	if storageType == "root" {
		return RespondError(c, ErrBadRequest("Cannot check file at root"))
	}

	fullPath := filepath.Join(realPath, filename)

	_, err = os.Stat(fullPath)
	exists := !os.IsNotExist(err)

	return c.JSON(http.StatusOK, map[string]any{
		"exists":   exists,
		"path":     filepath.Join(displayPath, filename),
		"filename": filename,
	})
}
