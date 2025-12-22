package handlers

import (
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"
)

// OnlyOffice callback request structure
type OnlyOfficeCallbackRequest struct {
	Key     string   `json:"key"`
	Status  int      `json:"status"`
	URL     string   `json:"url"`
	Users   []string `json:"users,omitempty"`
	Actions []struct {
		Type   int    `json:"type"`
		UserID string `json:"userid"`
	} `json:"actions,omitempty"`
}

// OnlyOfficeCallback handles document save callbacks from OnlyOffice
// Status codes: 0 - no document with given key, 1 - editing, 2 - ready for saving,
// 3 - save error, 4 - no changes, 6 - force save, 7 - force save error
func (h *Handler) OnlyOfficeCallback(c echo.Context) error {
	var req OnlyOfficeCallbackRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]int{"error": 1})
	}

	// Status 2 (ready for save) or 6 (force save) - download and save the document
	if req.Status == 2 || req.Status == 6 {
		if req.URL == "" {
			return c.JSON(http.StatusBadRequest, map[string]int{"error": 1})
		}

		// The key format is: encodedPath_timestamp
		// Extract the path from the key
		keyParts := strings.Split(req.Key, "_")
		if len(keyParts) < 2 {
			return c.JSON(http.StatusBadRequest, map[string]int{"error": 1})
		}

		// Decode the path
		decodedPath := decodeOnlyOfficePath(keyParts[0])

		// Get user claims from query param if available
		var claims *JWTClaims
		tokenString := c.QueryParam("token")
		if tokenString != "" {
			token, err := ValidateJWTToken(tokenString)
			if err == nil && token.Valid {
				if tokenClaims, ok := token.Claims.(*JWTClaims); ok {
					claims = tokenClaims
				}
			}
		}

		// Resolve the virtual path to real path
		realPath, storageType, _, err := h.resolvePath(decodedPath, claims)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]int{"error": 1})
		}

		// Download the document from OnlyOffice
		resp, err := http.Get(req.URL)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]int{"error": 1})
		}
		defer resp.Body.Close()

		// Read document content
		content, err := io.ReadAll(resp.Body)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]int{"error": 1})
		}

		// Write to file
		if err := writeFileAtomic(realPath, content, 0644); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]int{"error": 1})
		}

		// Log the action
		var userID *string
		if claims != nil {
			userID = &claims.UserID
		}
		clientIP := c.RealIP()
		h.auditHandler.LogEvent(userID, clientIP, EventFileEdit, decodedPath, map[string]interface{}{
			"size":        len(content),
			"storageType": storageType,
			"source":      "onlyoffice",
		})
	}

	// Return success to OnlyOffice
	return c.JSON(http.StatusOK, map[string]int{"error": 0})
}

// GetOnlyOfficeConfig returns configuration for OnlyOffice editor
func (h *Handler) GetOnlyOfficeConfig(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "File path required",
		})
	}

	// Get user claims
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	// Resolve path
	realPath, _, _, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	// Check if file exists
	info, err := statFile(realPath)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "File not found",
		})
	}

	if info.IsDir() {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Path is a directory",
		})
	}

	// Get file extension to determine document type
	ext := strings.ToLower(filepath.Ext(info.Name()))
	documentType := getOnlyOfficeDocumentType(ext)
	if documentType == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Unsupported file type for OnlyOffice",
		})
	}

	// Generate unique key for this document (path + modtime for version control)
	documentKey := encodeOnlyOfficePath("/"+requestPath) + "_" + fmt.Sprintf("%d", info.ModTime().Unix())

	// Build the host URL - use internal Docker network address for OnlyOffice to access
	// OnlyOffice container needs to reach API via Docker internal network
	internalBaseURL := "http://api:8080"

	// Also build external URL for browser access (callback display only)
	scheme := "http"
	if c.Request().TLS != nil {
		scheme = "https"
	}
	host := c.Request().Host
	_ = fmt.Sprintf("%s://%s", scheme, host) // external URL not used currently

	// Generate a token for OnlyOffice to access the document
	token, err := GenerateJWT(claims.UserID, claims.Username, claims.IsAdmin)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to generate token",
		})
	}

	config := map[string]interface{}{
		"documentType": documentType,
		"document": map[string]interface{}{
			"fileType": strings.TrimPrefix(ext, "."),
			"key":      documentKey,
			"title":    info.Name(),
			"url":      fmt.Sprintf("%s/api/files/%s?token=%s", internalBaseURL, requestPath, token),
		},
		"editorConfig": map[string]interface{}{
			"callbackUrl": fmt.Sprintf("%s/api/onlyoffice/callback?token=%s", internalBaseURL, token),
			"user": map[string]interface{}{
				"id":   claims.UserID,
				"name": claims.Username,
			},
			"lang": "ko",
			"customization": map[string]interface{}{
				"autosave":  true,
				"forcesave": true,
			},
		},
	}

	return c.JSON(http.StatusOK, config)
}

// encodeOnlyOfficePath encodes path for OnlyOffice document key
func encodeOnlyOfficePath(path string) string {
	return strings.ReplaceAll(path, "/", "_")
}

// decodeOnlyOfficePath decodes path from OnlyOffice document key
func decodeOnlyOfficePath(encoded string) string {
	return strings.ReplaceAll(encoded, "_", "/")
}

// getOnlyOfficeDocumentType returns document type for OnlyOffice
func getOnlyOfficeDocumentType(ext string) string {
	switch ext {
	case ".doc", ".docx", ".odt", ".rtf", ".txt":
		return "word"
	case ".xls", ".xlsx", ".ods", ".csv":
		return "cell"
	case ".ppt", ".pptx", ".odp":
		return "slide"
	case ".pdf":
		return "word" // OnlyOffice can open PDFs in word mode
	default:
		return ""
	}
}

// IsOnlyOfficeSupported checks if the file extension is supported by OnlyOffice
func IsOnlyOfficeSupported(ext string) bool {
	return getOnlyOfficeDocumentType(strings.ToLower(ext)) != ""
}
