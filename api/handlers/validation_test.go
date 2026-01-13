package handlers

import (
	"strings"
	"testing"
)

// =============================================================================
// ValidatePath Tests - Path Traversal Security
// =============================================================================

func TestValidatePath_ValidPaths(t *testing.T) {
	validPaths := []string{
		"file.txt",
		"folder/file.txt",
		"folder/subfolder/file.txt",
		"my-document.pdf",
		"My Document.pdf",
		"file_with_underscore.txt",
		"folder123/file456.txt",
	}

	for _, path := range validPaths {
		t.Run(path, func(t *testing.T) {
			err := ValidatePath(path)
			if err != nil {
				t.Errorf("ValidatePath(%q) should be valid, got error: %v", path, err)
			}
		})
	}
}

func TestValidatePath_EmptyPath(t *testing.T) {
	err := ValidatePath("")
	if err == nil {
		t.Error("ValidatePath should reject empty path")
	}
}

func TestValidatePath_PathTraversal(t *testing.T) {
	traversalPaths := []struct {
		name string
		path string
	}{
		{"simple parent dir", ".."},
		{"parent with file", "../file.txt"},
		{"deep traversal", "../../etc/passwd"},
		{"hidden traversal", "folder/../../../etc/passwd"},
		{"mid-path traversal", "folder/../secret.txt"},
		{"multiple traversals", "a/b/../../c/../../../etc/passwd"},
		{"Windows style", "..\\..\\windows\\system32"},
		{"mixed separators", "../folder\\..\\secret"},
	}

	for _, tc := range traversalPaths {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePath(tc.path)
			if err == nil {
				t.Errorf("ValidatePath(%q) should reject path traversal", tc.path)
			}
		})
	}
}

func TestValidatePath_EncodedTraversal(t *testing.T) {
	encodedPaths := []struct {
		name string
		path string
	}{
		{"URL encoded dot lowercase", "%2e%2e/etc/passwd"},
		{"URL encoded dot uppercase", "%2E%2E/etc/passwd"},
		{"URL encoded mixed case", "%2e%2E/etc/passwd"},
		{"URL encoded with slash", "%2e%2e%2fetc%2fpasswd"},
		{"partial encoding", "..%2f..%2fetc/passwd"},
	}

	for _, tc := range encodedPaths {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePath(tc.path)
			if err == nil {
				t.Errorf("ValidatePath(%q) should reject encoded traversal", tc.path)
			}
		})
	}
}

func TestValidatePath_NullBytes(t *testing.T) {
	nullBytePaths := []struct {
		name string
		path string
	}{
		{"null at end", "file.txt\x00"},
		{"null in middle", "file\x00.txt"},
		{"null at start", "\x00file.txt"},
		{"null with traversal", "../\x00etc/passwd"},
	}

	for _, tc := range nullBytePaths {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePath(tc.path)
			if err == nil {
				t.Errorf("ValidatePath(%q) should reject null bytes", tc.path)
			}
		})
	}
}

func TestValidatePath_InvalidCharacters(t *testing.T) {
	invalidPaths := []struct {
		name string
		path string
	}{
		{"less than", "file<name.txt"},
		{"greater than", "file>name.txt"},
		{"colon", "file:name.txt"},
		{"double quote", "file\"name.txt"},
		{"pipe", "file|name.txt"},
		{"question mark", "file?name.txt"},
		{"asterisk", "file*name.txt"},
		{"control char", "file\x01name.txt"},
	}

	for _, tc := range invalidPaths {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePath(tc.path)
			if err == nil {
				t.Errorf("ValidatePath(%q) should reject invalid characters", tc.path)
			}
		})
	}
}

// =============================================================================
// ValidateFilename Tests - Filename Security
// =============================================================================

func TestValidateFilename_ValidNames(t *testing.T) {
	validNames := []string{
		"document.pdf",
		"my-file_123.txt",
		"Report 2024.xlsx",
		"image.jpeg",
		".hidden",
		"file.tar.gz",
	}

	for _, name := range validNames {
		t.Run(name, func(t *testing.T) {
			err := ValidateFilename(name)
			if err != nil {
				t.Errorf("ValidateFilename(%q) should be valid, got error: %v", name, err)
			}
		})
	}
}

func TestValidateFilename_EmptyName(t *testing.T) {
	err := ValidateFilename("")
	if err == nil {
		t.Error("ValidateFilename should reject empty filename")
	}
}

func TestValidateFilename_PathSeparators(t *testing.T) {
	pathSeparators := []struct {
		name     string
		filename string
	}{
		{"forward slash", "folder/file.txt"},
		{"backslash", "folder\\file.txt"},
		{"multiple forward", "a/b/c.txt"},
		{"mixed separators", "folder/sub\\file.txt"},
	}

	for _, tc := range pathSeparators {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateFilename(tc.filename)
			if err == nil {
				t.Errorf("ValidateFilename(%q) should reject path separators", tc.filename)
			}
		})
	}
}

func TestValidateFilename_DangerousNames(t *testing.T) {
	dangerousNames := []struct {
		name     string
		filename string
	}{
		{"dot", "."},
		{"double dot", ".."},
		{"CON", "CON"},
		{"CON.txt", "CON.txt"},
		{"PRN", "PRN"},
		{"AUX", "AUX"},
		{"NUL", "NUL"},
		{"COM1", "COM1"},
		{"COM1.txt", "COM1.txt"},
		{"LPT1", "LPT1"},
		{"case insensitive con", "con"},
		{"case insensitive nul", "nul.txt"},
	}

	for _, tc := range dangerousNames {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateFilename(tc.filename)
			if err == nil {
				t.Errorf("ValidateFilename(%q) should reject dangerous filename", tc.filename)
			}
		})
	}
}

func TestValidateFilename_InvalidCharacters(t *testing.T) {
	invalidNames := []struct {
		name     string
		filename string
	}{
		{"less than", "file<name.txt"},
		{"greater than", "file>name.txt"},
		{"colon", "file:name.txt"},
		{"double quote", "file\"name.txt"},
		{"pipe", "file|name.txt"},
		{"question mark", "file?name.txt"},
		{"asterisk", "file*.txt"},
		{"null byte", "file\x00.txt"},
		{"control char", "file\x1f.txt"},
	}

	for _, tc := range invalidNames {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateFilename(tc.filename)
			if err == nil {
				t.Errorf("ValidateFilename(%q) should reject invalid characters", tc.filename)
			}
		})
	}
}

func TestValidateFilename_SpacesAndDots(t *testing.T) {
	invalidNames := []struct {
		name     string
		filename string
	}{
		{"leading space", " file.txt"},
		{"trailing space", "file.txt "},
		{"trailing dot", "file."},
	}

	for _, tc := range invalidNames {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateFilename(tc.filename)
			if err == nil {
				t.Errorf("ValidateFilename(%q) should reject whitespace/dot issues", tc.filename)
			}
		})
	}
}

func TestValidateFilename_TooLong(t *testing.T) {
	// Create a filename longer than FilenameMaxLength (255)
	longName := strings.Repeat("a", 256) + ".txt"

	err := ValidateFilename(longName)
	if err == nil {
		t.Error("ValidateFilename should reject overly long filenames")
	}
}

// =============================================================================
// ValidateFolderName Tests
// =============================================================================

func TestValidateFolderName_ValidNames(t *testing.T) {
	validNames := []string{
		"Documents",
		"my-folder",
		"folder_123",
		"New Folder",
		".hidden_folder",
	}

	for _, name := range validNames {
		t.Run(name, func(t *testing.T) {
			err := ValidateFolderName(name)
			if err != nil {
				t.Errorf("ValidateFolderName(%q) should be valid, got error: %v", name, err)
			}
		})
	}
}

func TestValidateFolderName_Invalid(t *testing.T) {
	invalidNames := []struct {
		name       string
		folderName string
	}{
		{"empty", ""},
		{"dot", "."},
		{"double dot", ".."},
		{"with slash", "folder/name"},
		{"with backslash", "folder\\name"},
	}

	for _, tc := range invalidNames {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateFolderName(tc.folderName)
			if err == nil {
				t.Errorf("ValidateFolderName(%q) should be invalid", tc.folderName)
			}
		})
	}
}

// =============================================================================
// SanitizeFilename Tests
// =============================================================================

func TestSanitizeFilename_Basic(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		expected string
	}{
		{"normal filename", "document.pdf", "document.pdf"},
		{"spaces", "my document.pdf", "my document.pdf"},
		{"underscore", "my_document.pdf", "my_document.pdf"},
		{"hyphen", "my-document.pdf", "my-document.pdf"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := SanitizeFilename(tc.input)
			if result != tc.expected {
				t.Errorf("SanitizeFilename(%q) = %q, expected %q", tc.input, result, tc.expected)
			}
		})
	}
}

func TestSanitizeFilename_RemovesDangerousChars(t *testing.T) {
	testCases := []struct {
		name  string
		input string
	}{
		{"removes slash", "folder/file.txt"},
		{"removes backslash", "folder\\file.txt"},
		{"removes colon", "file:name.txt"},
		{"removes less than", "file<name.txt"},
		{"removes greater than", "file>name.txt"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := SanitizeFilename(tc.input)
			// Result should not contain dangerous characters
			if result == tc.input {
				t.Errorf("SanitizeFilename(%q) should sanitize dangerous characters", tc.input)
			}
		})
	}
}

// =============================================================================
// ValidateEmail Tests
// =============================================================================

func TestValidateEmail_ValidEmails(t *testing.T) {
	validEmails := []string{
		"",  // Empty is allowed (optional)
		"user@example.com",
		"user.name@example.com",
		"user+tag@example.com",
		"user@subdomain.example.com",
		"user123@example.co.kr",
	}

	for _, email := range validEmails {
		t.Run(email, func(t *testing.T) {
			err := ValidateEmail(email)
			if err != nil {
				t.Errorf("ValidateEmail(%q) should be valid, got error: %v", email, err)
			}
		})
	}
}

func TestValidateEmail_InvalidEmails(t *testing.T) {
	invalidEmails := []struct {
		name  string
		email string
	}{
		{"no at sign", "userexample.com"},
		{"no domain", "user@"},
		{"no user", "@example.com"},
		{"invalid domain", "user@example"},
		{"spaces", "user @example.com"},
		{"double at", "user@@example.com"},
	}

	for _, tc := range invalidEmails {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateEmail(tc.email)
			if err == nil {
				t.Errorf("ValidateEmail(%q) should be invalid", tc.email)
			}
		})
	}
}

// =============================================================================
// ValidatePassword Tests
// =============================================================================

func TestValidatePassword_ValidPasswords(t *testing.T) {
	validPasswords := []string{
		"Password123!",
		"MyP@ssw0rd",
		"Abcdef1!",
		"UPPER123lower!",
		"Pass1234!@#$",
	}

	for i, password := range validPasswords {
		t.Run(string(rune('A'+i)), func(t *testing.T) {
			err := ValidatePassword(password)
			if err != nil {
				t.Errorf("ValidatePassword(%q) should be valid, got error: %v", password, err)
			}
		})
	}
}

func TestValidatePassword_TooShort(t *testing.T) {
	err := ValidatePassword("Pass1!")
	if err == nil {
		t.Error("ValidatePassword should reject passwords shorter than 8 characters")
	}
}

func TestValidatePassword_TooLong(t *testing.T) {
	// Create a password longer than 128 characters
	longPassword := strings.Repeat("a", 130) + "A1!"

	err := ValidatePassword(longPassword)
	if err == nil {
		t.Error("ValidatePassword should reject passwords longer than 128 characters")
	}
}

func TestValidatePassword_InsufficientComplexity(t *testing.T) {
	insufficientPasswords := []struct {
		name     string
		password string
	}{
		{"only lowercase", "abcdefghij"},
		{"only uppercase", "ABCDEFGHIJ"},
		{"only numbers", "1234567890"},
		{"only lowercase+numbers", "abcd1234"},
		{"only uppercase+numbers", "ABCD1234"},
	}

	for _, tc := range insufficientPasswords {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePassword(tc.password)
			if err == nil {
				t.Errorf("ValidatePassword(%q) should reject insufficient complexity", tc.password)
			}
		})
	}
}
