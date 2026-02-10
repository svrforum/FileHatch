package handlers

import (
	"context"
	"errors"
	"io"
	"time"
)

// ErrNotLocalBackend is returned when GetRealPath() is called on a non-local backend
var ErrNotLocalBackend = errors.New("operation not supported: not a local backend")

// ErrStorageNotFound is returned when a storage path does not exist
var ErrStorageNotFound = errors.New("storage: path not found")

// StorageFileInfo represents file metadata, replacing os.FileInfo for backend abstraction
type StorageFileInfo struct {
	FileName    string
	FileSize    int64
	IsDirectory bool
	FileModTime time.Time
	FileMode    uint32
}

// Name returns the file name
func (fi *StorageFileInfo) Name() string { return fi.FileName }

// Size returns the file size
func (fi *StorageFileInfo) Size() int64 { return fi.FileSize }

// IsDir returns true if the entry is a directory
func (fi *StorageFileInfo) IsDir() bool { return fi.IsDirectory }

// ModTime returns the modification time
func (fi *StorageFileInfo) ModTime() time.Time { return fi.FileModTime }

// Mode returns the file mode
func (fi *StorageFileInfo) Mode() uint32 { return fi.FileMode }

// StorageDirEntry represents a directory entry
type StorageDirEntry struct {
	EntryName string
	IsDir     bool
	Info      *StorageFileInfo
}

// StorageWalkFunc is the walk callback function type
type StorageWalkFunc func(path string, info *StorageFileInfo, err error) error

// ErrSkipDir is used as a return value from StorageWalkFunc to skip a directory
var ErrSkipDir = errors.New("skip this directory")

// ErrSkipAll is used as a return value from StorageWalkFunc to skip all remaining entries
var ErrSkipAll = errors.New("skip all remaining")

// StorageBackend is the interface for all storage backends
type StorageBackend interface {
	// Type returns the backend type identifier ("local", "s3")
	Type() string

	// IsLocal returns true if the backend supports GetRealPath()
	IsLocal() bool

	// Stat returns file/directory info
	Stat(ctx context.Context, path string) (*StorageFileInfo, error)

	// List returns directory entries
	List(ctx context.Context, path string) ([]StorageDirEntry, error)

	// ReadFile opens a file for reading, returning a reader, file info, and any error
	ReadFile(ctx context.Context, path string) (io.ReadCloser, *StorageFileInfo, error)

	// WriteFile writes content from reader to a file
	WriteFile(ctx context.Context, path string, reader io.Reader, size int64) error

	// Delete removes a single file
	Delete(ctx context.Context, path string) error

	// DeleteAll removes a file or directory recursively
	DeleteAll(ctx context.Context, path string) error

	// Mkdir creates a directory (and parents if needed)
	Mkdir(ctx context.Context, path string) error

	// Rename renames/moves a file or directory
	Rename(ctx context.Context, oldPath, newPath string) error

	// Copy copies a file or directory
	Copy(ctx context.Context, srcPath, dstPath string) error

	// Walk walks a directory tree calling walkFn for each entry
	Walk(ctx context.Context, root string, walkFn StorageWalkFunc) error

	// Exists checks if a path exists
	Exists(ctx context.Context, path string) (bool, error)

	// GetRealPath returns the real filesystem path for local backends.
	// Returns ErrNotLocalBackend for remote backends.
	GetRealPath(path string) (string, error)

	// SetPermissions sets appropriate permissions for shared folder access.
	// For local shared backends, sets 0775/0664 + GID 100.
	// For other backends, this is a no-op.
	SetPermissions(ctx context.Context, path string, isDir bool) error

	// CalculateSize calculates the total size of a path (recursive for directories)
	CalculateSize(ctx context.Context, path string) (int64, error)

	// ReadDir returns directory entries (similar to os.ReadDir)
	ReadDir(ctx context.Context, path string) ([]StorageDirEntry, error)
}
