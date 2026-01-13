package handlers

import (
	"fmt"
	"mime"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"

	"github.com/labstack/echo/v4"
)

// ValidationError represents a validation error
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// ValidationResult holds validation results
type ValidationResult struct {
	Valid  bool              `json:"valid"`
	Errors []ValidationError `json:"errors,omitempty"`
}

// Username validation constants
const (
	UsernameMinLength = 3
	UsernameMaxLength = 50
	PasswordMinLength = 8
	PasswordMaxLength = 128
	FilenameMaxLength = 255
)

// Regex patterns for validation
var (
	usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	emailRegex    = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	pathRegex     = regexp.MustCompile(`^[^<>:"|?*\x00-\x1f]+$`)
)

// Dangerous filename patterns
var dangerousFilenames = []string{
	".", "..", "CON", "PRN", "AUX", "NUL",
	"COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
	"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
}

// Allowed file extensions for uploads (whitelist approach)
var allowedExtensions = map[string]bool{
	// Documents
	".txt": true, ".md": true, ".pdf": true, ".doc": true, ".docx": true,
	".xls": true, ".xlsx": true, ".ppt": true, ".pptx": true, ".odt": true,
	".ods": true, ".odp": true, ".rtf": true, ".csv": true, ".json": true,
	".xml": true, ".html": true, ".htm": true,
	// Images
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".bmp": true,
	".webp": true, ".svg": true, ".ico": true, ".tiff": true, ".tif": true,
	// Audio
	".mp3": true, ".wav": true, ".ogg": true, ".flac": true, ".aac": true,
	".m4a": true, ".wma": true,
	// Video
	".mp4": true, ".avi": true, ".mkv": true, ".mov": true, ".wmv": true,
	".webm": true, ".flv": true, ".m4v": true, ".mpeg": true, ".mpg": true,
	// Archives
	".zip": true, ".rar": true, ".7z": true, ".tar": true, ".gz": true,
	".bz2": true, ".xz": true,
	// Code (optional - can be disabled for security)
	".js": true, ".ts": true, ".py": true, ".go": true, ".java": true,
	".c": true, ".cpp": true, ".h": true, ".css": true, ".scss": true,
	".less": true, ".sql": true, ".sh": true, ".bat": true, ".ps1": true,
	".yml": true, ".yaml": true, ".toml": true, ".ini": true, ".conf": true,
	// Others
	".log": true, ".bak": true, ".tmp": true,
}

// Dangerous MIME types that should be blocked
var dangerousMimeTypes = map[string]bool{
	"application/x-executable":     true,
	"application/x-msdos-program":  true,
	"application/x-msdownload":     true,
	"application/x-sh":             true,
	"application/x-shellscript":    true,
	"application/x-php":            true,
	"application/x-httpd-php":      true,
	"application/x-perl":           true,
	"application/x-python":         true,
	"application/x-ruby":           true,
	"application/java-archive":     true,
	"application/x-java-class":     true,
	"application/x-dosexec":        true,
	"application/vnd.microsoft.portable-executable": true,
}

// ValidateUsername validates a username
func ValidateUsername(username string) error {
	if len(username) < UsernameMinLength {
		return fmt.Errorf("username must be at least %d characters", UsernameMinLength)
	}
	if len(username) > UsernameMaxLength {
		return fmt.Errorf("username must be at most %d characters", UsernameMaxLength)
	}
	if !usernameRegex.MatchString(username) {
		return fmt.Errorf("username can only contain letters, numbers, underscores, and hyphens")
	}
	// Check for reserved usernames
	reserved := []string{"admin", "root", "system", "null", "undefined", "api", "www", "mail", "ftp"}
	lowerUsername := strings.ToLower(username)
	for _, r := range reserved {
		if lowerUsername == r {
			return fmt.Errorf("username '%s' is reserved", username)
		}
	}
	return nil
}

// ValidateEmail validates an email address
func ValidateEmail(email string) error {
	if email == "" {
		return nil // Email is optional
	}
	if len(email) > 254 {
		return fmt.Errorf("email address is too long")
	}
	if !emailRegex.MatchString(email) {
		return fmt.Errorf("invalid email address format")
	}
	return nil
}

// ValidatePassword validates a password
func ValidatePassword(password string) error {
	if len(password) < PasswordMinLength {
		return fmt.Errorf("password must be at least %d characters", PasswordMinLength)
	}
	if len(password) > PasswordMaxLength {
		return fmt.Errorf("password must be at most %d characters", PasswordMaxLength)
	}

	var (
		hasUpper   bool
		hasLower   bool
		hasNumber  bool
		hasSpecial bool
	)

	for _, char := range password {
		switch {
		case unicode.IsUpper(char):
			hasUpper = true
		case unicode.IsLower(char):
			hasLower = true
		case unicode.IsNumber(char):
			hasNumber = true
		case unicode.IsPunct(char) || unicode.IsSymbol(char):
			hasSpecial = true
		}
	}

	// Require at least 3 of 4 character types
	count := 0
	if hasUpper {
		count++
	}
	if hasLower {
		count++
	}
	if hasNumber {
		count++
	}
	if hasSpecial {
		count++
	}

	if count < 3 {
		return fmt.Errorf("password must contain at least 3 of: uppercase, lowercase, number, special character")
	}

	return nil
}

// ValidateFilename validates a filename
func ValidateFilename(filename string) error {
	if filename == "" {
		return fmt.Errorf("filename cannot be empty")
	}
	if len(filename) > FilenameMaxLength {
		return fmt.Errorf("filename is too long (max %d characters)", FilenameMaxLength)
	}

	// Check for null bytes
	if strings.ContainsRune(filename, '\x00') {
		return fmt.Errorf("filename contains invalid characters")
	}

	// Check for control characters
	for _, r := range filename {
		if r < 32 && r != '\t' {
			return fmt.Errorf("filename contains invalid control characters")
		}
	}

	// Check for invalid filesystem characters
	if strings.ContainsAny(filename, `<>:"|?*`) {
		return fmt.Errorf("filename contains invalid characters: < > : \" | ? *")
	}

	// Check for path separators
	if strings.ContainsAny(filename, `/\`) {
		return fmt.Errorf("filename cannot contain path separators")
	}

	// Check for dangerous filenames
	upperFilename := strings.ToUpper(strings.TrimSuffix(filename, filepath.Ext(filename)))
	for _, dangerous := range dangerousFilenames {
		if upperFilename == dangerous {
			return fmt.Errorf("filename '%s' is reserved", filename)
		}
	}

	// Check for leading/trailing whitespace or dots
	if strings.HasPrefix(filename, " ") || strings.HasSuffix(filename, " ") {
		return fmt.Errorf("filename cannot start or end with spaces")
	}
	if strings.HasSuffix(filename, ".") {
		return fmt.Errorf("filename cannot end with a period")
	}

	return nil
}

// ValidateFileExtension validates if file extension is allowed
func ValidateFileExtension(filename string, strictMode bool) error {
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" {
		if strictMode {
			return fmt.Errorf("file must have an extension")
		}
		return nil
	}

	if strictMode && !allowedExtensions[ext] {
		return fmt.Errorf("file extension '%s' is not allowed", ext)
	}

	return nil
}

// ValidateMimeType validates if MIME type is safe
func ValidateMimeType(mimeType string) error {
	if mimeType == "" {
		return nil
	}

	// Parse MIME type (ignore parameters)
	mediaType, _, err := mime.ParseMediaType(mimeType)
	if err != nil {
		return fmt.Errorf("invalid MIME type format")
	}

	if dangerousMimeTypes[mediaType] {
		return fmt.Errorf("file type '%s' is not allowed", mediaType)
	}

	return nil
}

// ValidatePath validates a file path
func ValidatePath(path string) error {
	if path == "" {
		return fmt.Errorf("path cannot be empty")
	}

	// Check for null bytes
	if strings.ContainsRune(path, '\x00') {
		return fmt.Errorf("path contains invalid characters")
	}

	// Check for URL-encoded traversal attempts (before any processing)
	lowerPath := strings.ToLower(path)
	if strings.Contains(lowerPath, "%2e") || strings.Contains(lowerPath, "%00") {
		return fmt.Errorf("encoded path traversal not allowed")
	}

	// Check for path traversal in original path (before Clean normalizes it away)
	// This catches cases like "folder/../secret.txt" which Clean() would normalize to "secret.txt"
	if strings.Contains(path, "..") {
		return fmt.Errorf("path traversal not allowed")
	}

	// Additional check: verify cleaned path doesn't escape
	cleanPath := filepath.Clean(path)
	if strings.HasPrefix(cleanPath, "..") {
		return fmt.Errorf("path traversal not allowed")
	}

	// Check path matches allowed pattern
	if !pathRegex.MatchString(path) {
		return fmt.Errorf("path contains invalid characters")
	}

	return nil
}

// ValidateFolderName validates a folder name
func ValidateFolderName(name string) error {
	if name == "" {
		return fmt.Errorf("folder name cannot be empty")
	}
	if len(name) > FilenameMaxLength {
		return fmt.Errorf("folder name is too long")
	}

	// Apply same rules as filename
	if err := ValidateFilename(name); err != nil {
		return fmt.Errorf("folder name: %w", err)
	}

	return nil
}

// ValidateSharePassword validates a share password
func ValidateSharePassword(password string) error {
	if password == "" {
		return nil // Password is optional for shares
	}
	if len(password) < 4 {
		return fmt.Errorf("share password must be at least 4 characters")
	}
	if len(password) > 64 {
		return fmt.Errorf("share password is too long")
	}
	return nil
}

// ValidateQuota validates storage quota value
func ValidateQuota(quota int64) error {
	if quota < 0 {
		return fmt.Errorf("quota cannot be negative")
	}
	// Max quota: 100TB
	if quota > 100*1024*1024*1024*1024 {
		return fmt.Errorf("quota exceeds maximum allowed value")
	}
	return nil
}

// SanitizeFilename sanitizes a filename by removing/replacing invalid characters
func SanitizeFilename(filename string) string {
	// Remove null bytes and control characters
	var result strings.Builder
	for _, r := range filename {
		if r >= 32 && r != 127 {
			result.WriteRune(r)
		}
	}
	filename = result.String()

	// Replace invalid characters with underscore
	invalidChars := regexp.MustCompile(`[<>:"|?*\\/]`)
	filename = invalidChars.ReplaceAllString(filename, "_")

	// Trim whitespace and dots
	filename = strings.TrimSpace(filename)
	filename = strings.TrimRight(filename, ".")

	// Limit length
	if len(filename) > FilenameMaxLength {
		ext := filepath.Ext(filename)
		name := strings.TrimSuffix(filename, ext)
		maxNameLen := FilenameMaxLength - len(ext)
		if maxNameLen > 0 {
			if len(name) > maxNameLen {
				name = name[:maxNameLen]
			}
			filename = name + ext
		}
	}

	// If filename is empty or just dots, use default
	if filename == "" || strings.Trim(filename, ".") == "" {
		filename = "unnamed"
	}

	return filename
}

// ValidationMiddleware creates a middleware that validates request body
func ValidationMiddleware(validator func(c echo.Context) error) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if err := validator(c); err != nil {
				return RespondError(c, ErrBadRequest(err.Error()))
			}
			return next(c)
		}
	}
}

// BindAndValidate binds request body and validates it
func BindAndValidate(c echo.Context, v interface{}, validators ...func(interface{}) error) error {
	if err := c.Bind(v); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}

	for _, validate := range validators {
		if err := validate(v); err != nil {
			return RespondError(c, ErrBadRequest(err.Error()))
		}
	}

	return nil
}

// RespondSuccess sends a successful JSON response
func RespondSuccess(c echo.Context, data interface{}) error {
	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"data":    data,
	})
}

// RespondCreated sends a 201 Created response
func RespondCreated(c echo.Context, data interface{}) error {
	return c.JSON(http.StatusCreated, map[string]interface{}{
		"success": true,
		"data":    data,
	})
}

// RespondMessage sends a success response with a message
func RespondMessage(c echo.Context, message string) error {
	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": message,
	})
}

// RespondDeleted sends a success response for delete operations
func RespondDeleted(c echo.Context, message string) error {
	if message == "" {
		message = "Successfully deleted"
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": message,
	})
}

// RespondList sends a list response with pagination info
func RespondList(c echo.Context, items interface{}, total int, page, pageSize int) error {
	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"data":    items,
		"pagination": map[string]interface{}{
			"total":    total,
			"page":     page,
			"pageSize": pageSize,
			"pages":    (total + pageSize - 1) / pageSize,
		},
	})
}
