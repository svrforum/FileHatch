package handlers

import (
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"
)

// getOnlyOfficeInternalURL returns the internal Docker network URL for OnlyOffice
func getOnlyOfficeInternalURL() string {
	if url := os.Getenv("ONLYOFFICE_INTERNAL_URL"); url != "" {
		return strings.TrimSuffix(url, "/")
	}
	return "http://onlyoffice"
}

// getOnlyOfficePublicURL returns the public URL for OnlyOffice (for browser access)
// If not set, returns empty string and the frontend will use default behavior
func getOnlyOfficePublicURL() string {
	if url := os.Getenv("ONLYOFFICE_PUBLIC_URL"); url != "" {
		return strings.TrimSuffix(url, "/")
	}
	return ""
}

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

		// The key format is: base64EncodedPath_timestamp
		// e.g., "L2hvbWUvdGVzdC5kb2N4_1766418834" -> path="/home/test.docx"
		lastUnderscore := strings.LastIndex(req.Key, "_")
		if lastUnderscore == -1 || lastUnderscore == 0 {
			log.Printf("[OnlyOffice] Invalid key format (no underscore): %s", req.Key)
			return c.JSON(http.StatusBadRequest, map[string]int{"error": 1})
		}

		// Extract encoded path (everything before the last underscore)
		encodedPath := req.Key[:lastUnderscore]

		// Decode the path
		decodedPath := decodeOnlyOfficePath(encodedPath)
		if decodedPath == "" {
			log.Printf("[OnlyOffice] Failed to decode path from key: %s", req.Key)
			return c.JSON(http.StatusBadRequest, map[string]int{"error": 1})
		}
		log.Printf("[OnlyOffice] Callback for path: %s, status: %d", decodedPath, req.Status)

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
		isSharedFile := false
		if err != nil || realPath == "" {
			// Check if this is a shared file
			if claims != nil {
				sharedRealPath, _, shareErr := h.GetSharedFileOwnerPath(claims.UserID, decodedPath)
				if shareErr == nil && h.CanWriteSharedFile(claims.UserID, decodedPath) {
					realPath = sharedRealPath
					storageType = "shared-with-me"
					isSharedFile = true
				} else {
					log.Printf("[OnlyOffice] No write permission for shared file: %s, user: %s", decodedPath, claims.UserID)
					return c.JSON(http.StatusForbidden, map[string]int{"error": 1})
				}
			} else {
				return c.JSON(http.StatusBadRequest, map[string]int{"error": 1})
			}
		}

		// For shared files, verify write permission
		if isSharedFile && claims != nil {
			if !h.CanWriteSharedFile(claims.UserID, decodedPath) {
				log.Printf("[OnlyOffice] Write permission denied for shared file: %s", decodedPath)
				return c.JSON(http.StatusForbidden, map[string]int{"error": 1})
			}
		}

		// Convert external URL to internal Docker network URL
		// OnlyOffice sends URLs with its public address, but API needs internal Docker network address
		downloadURL := convertToInternalURL(req.URL)
		log.Printf("[OnlyOffice] Downloading from: %s (original: %s)", downloadURL, req.URL)

		// Download the document from OnlyOffice
		resp, err := http.Get(downloadURL)
		if err != nil {
			log.Printf("[OnlyOffice] Download failed: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]int{"error": 1})
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			log.Printf("[OnlyOffice] Download returned status: %d", resp.StatusCode)
			return c.JSON(http.StatusInternalServerError, map[string]int{"error": 1})
		}

		// Read document content
		content, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("[OnlyOffice] Failed to read response body: %v", err)
			return c.JSON(http.StatusInternalServerError, map[string]int{"error": 1})
		}

		// Write to file
		if err := writeFileAtomic(realPath, content, 0644); err != nil {
			log.Printf("[OnlyOffice] Failed to write file %s: %v", realPath, err)
			return c.JSON(http.StatusInternalServerError, map[string]int{"error": 1})
		}
		log.Printf("[OnlyOffice] Successfully saved file: %s (%d bytes)", realPath, len(content))

		// Log the action
		var userID *string
		if claims != nil {
			userID = &claims.UserID
		}
		clientIP := c.RealIP()
		_ = h.auditHandler.LogEvent(userID, clientIP, EventFileEdit, decodedPath, map[string]interface{}{
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

	virtualPath := "/" + requestPath
	isSharedFile := false
	canEdit := true // By default, owner can edit

	// Resolve path
	realPath, _, _, err := h.resolvePath(virtualPath, claims)
	if err != nil || realPath == "" {
		// Check if this is a shared file
		sharedRealPath, _, shareErr := h.GetSharedFileOwnerPath(claims.UserID, virtualPath)
		if shareErr == nil {
			realPath = sharedRealPath
			isSharedFile = true
			// Check if user has write permission for shared file
			canEdit = h.CanWriteSharedFile(claims.UserID, virtualPath)
		} else {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "File not found or no access",
			})
		}
	}

	// Check if file exists
	info, err := statFile(realPath)
	if err != nil {
		// Try shared file path again if not found
		if !isSharedFile {
			sharedRealPath, _, shareErr := h.GetSharedFileOwnerPath(claims.UserID, virtualPath)
			if shareErr == nil {
				realPath = sharedRealPath
				canEdit = h.CanWriteSharedFile(claims.UserID, virtualPath)
				info, err = statFile(realPath)
			}
		}
		if err != nil {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "File not found",
			})
		}
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
	documentKey := encodeOnlyOfficePath(virtualPath) + "_" + fmt.Sprintf("%d", info.ModTime().Unix())

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

	// Determine editor mode based on permissions
	editorMode := "edit"
	if !canEdit {
		editorMode = "view"
	}

	editorConfig := map[string]interface{}{
		"user": map[string]interface{}{
			"id":   claims.UserID,
			"name": claims.Username,
		},
		"lang": "ko",
		"mode": editorMode,
		"customization": map[string]interface{}{
			"autosave":  canEdit,
			"forcesave": canEdit,
		},
	}

	// Only add callback URL if user can edit
	if canEdit {
		editorConfig["callbackUrl"] = fmt.Sprintf("%s/api/onlyoffice/callback?token=%s", internalBaseURL, token)
	}

	config := map[string]interface{}{
		"documentType": documentType,
		"document": map[string]interface{}{
			"fileType": strings.TrimPrefix(ext, "."),
			"key":      documentKey,
			"title":    info.Name(),
			"url":      fmt.Sprintf("%s/api/files/%s?token=%s", internalBaseURL, requestPath, token),
		},
		"editorConfig": editorConfig,
	}

	return c.JSON(http.StatusOK, config)
}

// GetOnlyOfficeSettings returns OnlyOffice configuration settings for the frontend
func (h *Handler) GetOnlyOfficeSettings(c echo.Context) error {
	publicURL := getOnlyOfficePublicURL()

	return c.JSON(http.StatusOK, map[string]interface{}{
		"publicUrl": publicURL,
		"available": publicURL != "",
	})
}

// encodeOnlyOfficePath encodes path for OnlyOffice document key using URL-safe base64
func encodeOnlyOfficePath(path string) string {
	return base64.URLEncoding.EncodeToString([]byte(path))
}

// decodeOnlyOfficePath decodes path from OnlyOffice document key
func decodeOnlyOfficePath(encoded string) string {
	decoded, err := base64.URLEncoding.DecodeString(encoded)
	if err != nil {
		log.Printf("[OnlyOffice] Failed to decode path: %v", err)
		return ""
	}
	return string(decoded)
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

// convertToInternalURL converts an external OnlyOffice URL to internal Docker network URL
// This is needed because OnlyOffice sends callback URLs with its public address,
// but the API server needs to access them via the internal Docker network
func convertToInternalURL(externalURL string) string {
	internalURL := getOnlyOfficeInternalURL()
	publicURL := getOnlyOfficePublicURL()

	// If public URL is configured, replace it with internal URL
	if publicURL != "" && strings.HasPrefix(externalURL, publicURL) {
		return strings.Replace(externalURL, publicURL, internalURL, 1)
	}

	// Fallback: try common localhost patterns
	parsed, err := url.Parse(externalURL)
	if err != nil {
		return externalURL
	}

	// Check for localhost or 127.0.0.1 patterns (common in development)
	host := parsed.Hostname()
	if host == "localhost" || host == "127.0.0.1" {
		// Replace the host:port with internal URL
		parsed.Host = strings.TrimPrefix(internalURL, "http://")
		parsed.Host = strings.TrimPrefix(parsed.Host, "https://")
		return parsed.String()
	}

	return externalURL
}
