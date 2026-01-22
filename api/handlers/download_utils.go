package handlers

import (
	"net/url"
	"regexp"
	"strings"

	"github.com/labstack/echo/v4"
)

// setContentDisposition sets the Content-Disposition header with proper encoding
// for non-ASCII characters (RFC 5987).
// This ensures Korean/Chinese/Japanese and other non-ASCII filenames are properly handled.
func setContentDisposition(c echo.Context, filename string) {
	// Sanitize to ASCII for the basic filename parameter (fallback for old browsers)
	asciiName := sanitizeToASCII(filename)

	// URL-encode the filename for filename* parameter (RFC 5987)
	// Use PathEscape instead of QueryEscape to encode spaces as %20 (not +)
	// RFC 5987 requires percent-encoding, not application/x-www-form-urlencoded
	encoded := url.PathEscape(filename)

	// Set both filename (ASCII fallback) and filename* (UTF-8 encoded)
	// Modern browsers will use filename*, older ones will use filename
	c.Response().Header().Set("Content-Disposition",
		`attachment; filename="`+asciiName+`"; filename*=UTF-8''`+encoded)
}

// sanitizeToASCII converts a filename to ASCII-safe characters.
// Non-ASCII characters are replaced with underscores.
func sanitizeToASCII(filename string) string {
	// Replace non-ASCII characters with underscores
	re := regexp.MustCompile(`[^\x00-\x7F]`)
	ascii := re.ReplaceAllString(filename, "_")

	// Also escape double quotes to prevent header injection
	ascii = strings.ReplaceAll(ascii, `"`, `_`)

	// If the result is empty, use a default name
	if ascii == "" || ascii == "_" {
		ascii = "download"
	}

	return ascii
}
