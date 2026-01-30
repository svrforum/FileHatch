package handlers

import (
	"path/filepath"
	"strings"
)

// DefaultHiddenPatterns contains default hidden file patterns
// These are common system/thumbnail files that should be hidden from file listings
var DefaultHiddenPatterns = []string{
	"Thumbs.db",
	"desktop.ini",
	".DS_Store",
	"@eaDir",
	".@__thumb",
	".Spotlight-V100",
	".fseventsd",
	".Trashes",
	"$RECYCLE.BIN",
	"System Volume Information",
}

// IsHiddenFile checks if a filename matches any hidden pattern
// Returns true if the file should be hidden from listings
func IsHiddenFile(name string) bool {
	// Dotfiles are hidden
	if strings.HasPrefix(name, ".") {
		return true
	}

	// Check against default hidden patterns (case-insensitive)
	nameLower := strings.ToLower(name)
	for _, pattern := range DefaultHiddenPatterns {
		patternLower := strings.ToLower(pattern)
		// Exact match
		if nameLower == patternLower {
			return true
		}
		// Glob pattern match
		if matched, _ := filepath.Match(patternLower, nameLower); matched {
			return true
		}
	}

	return false
}
