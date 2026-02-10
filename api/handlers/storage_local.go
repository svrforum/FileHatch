package handlers

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// LocalBackend implements StorageBackend for local filesystem storage
type LocalBackend struct {
	basePath string
	isShared bool // true for shared folders (uses special permissions)
}

// NewLocalBackend creates a new LocalBackend
func NewLocalBackend(basePath string, isShared bool) *LocalBackend {
	return &LocalBackend{
		basePath: basePath,
		isShared: isShared,
	}
}

// Type returns "local"
func (b *LocalBackend) Type() string { return "local" }

// IsLocal returns true
func (b *LocalBackend) IsLocal() bool { return true }

// resolve joins the relative path with the base path and validates it
func (b *LocalBackend) resolve(relPath string) (string, error) {
	if relPath == "" || relPath == "." || relPath == "/" {
		return b.basePath, nil
	}
	full := filepath.Join(b.basePath, filepath.Clean(relPath))
	// Ensure the resolved path is within basePath
	if !isPathWithinRoot(full, b.basePath) {
		return "", fmt.Errorf("access denied: path escapes allowed directory")
	}
	return full, nil
}

// Stat returns file info for the given path
func (b *LocalBackend) Stat(_ context.Context, path string) (*StorageFileInfo, error) {
	full, err := b.resolve(path)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return nil, err
	}
	return osFileInfoToStorageInfo(info), nil
}

// List returns directory entries at the given path
func (b *LocalBackend) List(_ context.Context, path string) ([]StorageDirEntry, error) {
	return b.ReadDir(context.Background(), path)
}

// ReadDir returns directory entries at the given path
func (b *LocalBackend) ReadDir(_ context.Context, path string) ([]StorageDirEntry, error) {
	full, err := b.resolve(path)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(full)
	if err != nil {
		return nil, err
	}
	result := make([]StorageDirEntry, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		result = append(result, StorageDirEntry{
			EntryName: entry.Name(),
			IsDir:     entry.IsDir(),
			Info:      osFileInfoToStorageInfo(info),
		})
	}
	return result, nil
}

// ReadFile opens a file for reading
func (b *LocalBackend) ReadFile(_ context.Context, path string) (io.ReadCloser, *StorageFileInfo, error) {
	full, err := b.resolve(path)
	if err != nil {
		return nil, nil, err
	}
	f, err := os.Open(full)
	if err != nil {
		return nil, nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, nil, err
	}
	return f, osFileInfoToStorageInfo(info), nil
}

// WriteFile writes content to a file
func (b *LocalBackend) WriteFile(_ context.Context, path string, reader io.Reader, _ int64) error {
	full, err := b.resolve(path)
	if err != nil {
		return err
	}

	// Ensure parent directory exists
	dir := filepath.Dir(full)
	if b.isShared {
		if err := MkdirAllShared(dir); err != nil {
			return err
		}
	} else {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}

	f, err := os.Create(full)
	if err != nil {
		return err
	}
	defer f.Close()

	if _, err := io.Copy(f, reader); err != nil {
		return err
	}

	// Set permissions for shared folders
	if b.isShared {
		return SetSharedPermissions(full, false)
	}
	return nil
}

// Delete removes a single file
func (b *LocalBackend) Delete(_ context.Context, path string) error {
	full, err := b.resolve(path)
	if err != nil {
		return err
	}
	return os.Remove(full)
}

// DeleteAll removes a file or directory recursively
func (b *LocalBackend) DeleteAll(_ context.Context, path string) error {
	full, err := b.resolve(path)
	if err != nil {
		return err
	}
	return os.RemoveAll(full)
}

// Mkdir creates a directory
func (b *LocalBackend) Mkdir(_ context.Context, path string) error {
	full, err := b.resolve(path)
	if err != nil {
		return err
	}
	if b.isShared {
		return MkdirAllShared(full)
	}
	return os.MkdirAll(full, 0755)
}

// Rename renames/moves a file or directory
func (b *LocalBackend) Rename(_ context.Context, oldPath, newPath string) error {
	oldFull, err := b.resolve(oldPath)
	if err != nil {
		return err
	}
	newFull, err := b.resolve(newPath)
	if err != nil {
		return err
	}
	return os.Rename(oldFull, newFull)
}

// Copy copies a file or directory
func (b *LocalBackend) Copy(_ context.Context, srcPath, dstPath string) error {
	srcFull, err := b.resolve(srcPath)
	if err != nil {
		return err
	}
	dstFull, err := b.resolve(dstPath)
	if err != nil {
		return err
	}

	info, err := os.Stat(srcFull)
	if err != nil {
		return err
	}

	if info.IsDir() {
		return copyDir(srcFull, dstFull)
	}
	return copyFile(srcFull, dstFull)
}

// Walk walks a directory tree
func (b *LocalBackend) Walk(_ context.Context, root string, walkFn StorageWalkFunc) error {
	rootFull, err := b.resolve(root)
	if err != nil {
		return err
	}
	return filepath.Walk(rootFull, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return walkFn(p, nil, err)
		}
		relPath, relErr := filepath.Rel(rootFull, p)
		if relErr != nil {
			relPath = p
		}
		// Return root-prefixed paths so callers can use filepath.Rel(root, path)
		// and backend.ReadFile(ctx, path) correctly
		var walkPath string
		if relPath == "." {
			walkPath = root
			if walkPath == "" {
				walkPath = "."
			}
		} else {
			walkPath = filepath.Join(root, relPath)
		}
		sErr := walkFn(walkPath, osFileInfoToStorageInfo(info), nil)
		if sErr == ErrSkipDir {
			return filepath.SkipDir
		}
		if sErr == ErrSkipAll {
			return filepath.SkipAll
		}
		return sErr
	})
}

// Exists checks if a path exists
func (b *LocalBackend) Exists(_ context.Context, path string) (bool, error) {
	full, err := b.resolve(path)
	if err != nil {
		return false, err
	}
	_, err = os.Stat(full)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

// GetRealPath returns the actual filesystem path
func (b *LocalBackend) GetRealPath(path string) (string, error) {
	return b.resolve(path)
}

// SetPermissions sets shared folder permissions if applicable
func (b *LocalBackend) SetPermissions(_ context.Context, path string, isDir bool) error {
	if !b.isShared {
		return nil // no-op for non-shared backends
	}
	full, err := b.resolve(path)
	if err != nil {
		return err
	}
	return SetSharedPermissions(full, isDir)
}

// CalculateSize calculates the total size of a path
func (b *LocalBackend) CalculateSize(_ context.Context, path string) (int64, error) {
	full, err := b.resolve(path)
	if err != nil {
		return 0, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return 0, err
	}
	if !info.IsDir() {
		return info.Size(), nil
	}

	var totalSize int64
	err = filepath.Walk(full, func(_ string, fi os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !fi.IsDir() {
			totalSize += fi.Size()
		}
		return nil
	})
	return totalSize, err
}

// BasePath returns the base path of this backend (used by StorageRouter)
func (b *LocalBackend) BasePath() string {
	return b.basePath
}

// IsShared returns whether this backend uses shared folder permissions
func (b *LocalBackend) IsShared() bool {
	return b.isShared
}

// osFileInfoToStorageInfo converts os.FileInfo to StorageFileInfo
func osFileInfoToStorageInfo(info os.FileInfo) *StorageFileInfo {
	return &StorageFileInfo{
		FileName:    info.Name(),
		FileSize:    info.Size(),
		IsDirectory: info.IsDir(),
		FileModTime: info.ModTime(),
		FileMode:    uint32(info.Mode()),
	}
}
