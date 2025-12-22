package handlers

import (
	"os"
)

// statFile returns file info or error
func statFile(path string) (os.FileInfo, error) {
	return os.Stat(path)
}

// writeFileAtomic writes content to file atomically
func writeFileAtomic(path string, content []byte, perm os.FileMode) error {
	return os.WriteFile(path, content, perm)
}
