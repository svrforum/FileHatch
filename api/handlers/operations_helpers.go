package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// OperationPaths holds resolved source and destination paths for file operations
type OperationPaths struct {
	SrcRealPath       string
	SrcStorageType    string
	SrcDisplayPath    string
	SrcResult         *ResolveResult
	DestRealPath      string
	DestStorageType   string
	DestDisplayPath   string
	DestResult        *ResolveResult
	SrcInfo           os.FileInfo // nil for non-local backends
	SrcName           string      // source item name (works for all backends)
	SrcIsDir          bool        // whether source is directory (works for all backends)
	FinalDestPath     string      // local filesystem dest path (empty for non-local dest)
	Claims            *JWTClaims
	OverwriteExisting bool // true if overwrite was requested and target exists
}

// ResolveOperationPaths resolves and validates source and destination paths for copy/move operations
func (h *Handler) ResolveOperationPaths(c echo.Context, requestPath, destination string, allowSameFilename bool, overwrite bool) (*OperationPaths, error) {
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve source path
	srcResult, srcRealPath, err := h.resolveStorageForOperation("/"+requestPath, claims)
	if err != nil {
		return nil, ErrBadRequest(err.Error())
	}

	if srcResult.StorageType == "root" {
		return nil, ErrBadRequest("Cannot operate on root")
	}

	// Resolve destination path
	destResult, destRealPath, err := h.resolveStorageForOperation(destination, claims)
	if err != nil {
		return nil, ErrBadRequest(err.Error())
	}

	if destResult.StorageType == "root" {
		return nil, ErrBadRequest("Cannot operate to root")
	}

	// Check permissions
	if (srcResult.StorageType == StorageHome || destResult.StorageType == StorageHome) && claims == nil {
		return nil, ErrUnauthorized("Authentication required")
	}

	srcIsNonLocal := srcResult.StorageType == StorageExternal && srcRealPath == ""
	destIsNonLocal := destResult.StorageType == StorageExternal && destRealPath == ""

	var srcInfo os.FileInfo
	var srcName string
	var srcIsDir bool

	// Check if source exists
	if srcIsNonLocal {
		ctx := context.Background()
		info, err := srcResult.Backend.Stat(ctx, srcResult.RelPath)
		if err != nil {
			return nil, ErrNotFound("Source")
		}
		srcName = info.FileName
		srcIsDir = info.IsDirectory
	} else {
		srcInfo, err = os.Stat(srcRealPath)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, ErrNotFound("Source")
			}
			return nil, ErrInternal("Failed to access source")
		}
		srcName = srcInfo.Name()
		srcIsDir = srcInfo.IsDir()
	}

	// Check if destination is a directory
	if destIsNonLocal {
		if destResult.RelPath != "" {
			ctx := context.Background()
			destInfo, err := destResult.Backend.Stat(ctx, destResult.RelPath)
			if err != nil {
				return nil, ErrNotFound("Destination")
			}
			if !destInfo.IsDirectory {
				return nil, ErrBadRequest("Destination must be a directory")
			}
		}
	} else {
		destInfo, err := os.Stat(destRealPath)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, ErrNotFound("Destination")
			}
			return nil, ErrInternal("Failed to access destination")
		}
		if !destInfo.IsDir() {
			return nil, ErrBadRequest("Destination must be a directory")
		}
	}

	// Build final destination path with duplicate handling (only for local destinations)
	var finalDestPath string
	overwriteExisting := false
	if !destIsNonLocal {
		if overwrite {
			// Overwrite mode: use direct path, check if existing file is present
			finalDestPath = filepath.Join(destRealPath, srcName)
			if _, err := os.Stat(finalDestPath); err == nil {
				overwriteDisplayPath := filepath.Join(destination, srcName)
				// Check file lock before overwriting
				if claims != nil {
					if lockErr := h.CheckFileLockForOperation(overwriteDisplayPath, claims.UserID); lockErr != nil {
						return nil, lockErr
					}
				}
				overwriteExisting = true
			}
		} else {
			finalDestPath = GenerateUniquePath(destRealPath, srcName, srcIsDir, allowSameFilename)
		}
	}

	return &OperationPaths{
		SrcRealPath:       srcRealPath,
		SrcStorageType:    srcResult.StorageType,
		SrcDisplayPath:    srcResult.DisplayPath,
		SrcResult:         srcResult,
		DestRealPath:      destRealPath,
		DestStorageType:   destResult.StorageType,
		DestDisplayPath:   destResult.DisplayPath,
		DestResult:        destResult,
		SrcInfo:           srcInfo,
		SrcName:           srcName,
		SrcIsDir:          srcIsDir,
		FinalDestPath:     finalDestPath,
		Claims:            claims,
		OverwriteExisting: overwriteExisting,
	}, nil
}

// GenerateUniquePath generates a unique path for the destination, handling duplicates
func GenerateUniquePath(destDir, baseName string, isDir, allowSameFilename bool) string {
	finalPath := filepath.Join(destDir, baseName)

	if allowSameFilename {
		// For move operations that fail on duplicate
		return finalPath
	}

	// Generate unique name for copies
	ext := filepath.Ext(baseName)
	nameWithoutExt := strings.TrimSuffix(baseName, ext)
	counter := 1

	for {
		if _, err := os.Stat(finalPath); os.IsNotExist(err) {
			break
		}
		if isDir {
			finalPath = filepath.Join(destDir, fmt.Sprintf("%s (%d)", baseName, counter))
		} else {
			finalPath = filepath.Join(destDir, fmt.Sprintf("%s (%d)%s", nameWithoutExt, counter, ext))
		}
		counter++
	}

	return finalPath
}

// SafeOverwrite safely replaces an existing file/directory at destPath using rename-to-temp.
// It renames the existing target to a temp name, executes the operation, and restores on failure.
// Returns a cleanup function that must be called after successful operation to remove the backup.
func SafeOverwrite(destPath string, isDir bool, operation func() error) error {
	backupPath := destPath + ".filehatch-overwrite-backup"
	if err := os.Rename(destPath, backupPath); err != nil {
		return fmt.Errorf("failed to prepare overwrite: %w", err)
	}

	if err := operation(); err != nil {
		// Restore the original on failure
		_ = os.Rename(backupPath, destPath)
		return err
	}

	// Operation succeeded, remove the backup
	if isDir {
		_ = os.RemoveAll(backupPath)
	} else {
		_ = os.Remove(backupPath)
	}
	return nil
}

// ProgressSender is a function type for sending progress updates
type ProgressSender func(CopyProgress)

// SetupSSE sets up Server-Sent Events headers and returns a progress sender function
func SetupSSE(c echo.Context) ProgressSender {
	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().Header().Set("X-Accel-Buffering", "no")
	c.Response().WriteHeader(200)

	return func(progress CopyProgress) {
		data, err := json.Marshal(progress)
		if err != nil {
			fmt.Fprintf(c.Response(), "data: {\"status\":\"error\",\"error\":\"Failed to serialize progress\"}\n\n")
			c.Response().Flush()
			return
		}
		fmt.Fprintf(c.Response(), "data: %s\n\n", data)
		c.Response().Flush()
	}
}

// FileStats holds file statistics for operations
type FileStats struct {
	TotalBytes int64
	TotalFiles int
}

// CalculateTotalSize calculates total bytes and file count for a path
func CalculateTotalSize(path string, info os.FileInfo) FileStats {
	stats := FileStats{}

	if info.IsDir() {
		_ = filepath.Walk(path, func(_ string, fi os.FileInfo, _ error) error {
			if fi != nil && !fi.IsDir() {
				stats.TotalBytes += fi.Size()
				stats.TotalFiles++
			}
			return nil
		})
	} else {
		stats.TotalBytes = info.Size()
		stats.TotalFiles = 1
	}

	return stats
}

// CalculateTotalSizeBackend calculates total bytes and file count using a StorageBackend
func CalculateTotalSizeBackend(ctx context.Context, backend StorageBackend, relPath string, isDir bool) FileStats {
	stats := FileStats{}

	if isDir {
		_ = backend.Walk(ctx, relPath, func(_ string, info *StorageFileInfo, _ error) error {
			if info != nil && !info.IsDirectory {
				stats.TotalBytes += info.FileSize
				stats.TotalFiles++
			}
			return nil
		})
	} else {
		info, err := backend.Stat(ctx, relPath)
		if err == nil {
			stats.TotalBytes = info.FileSize
			stats.TotalFiles = 1
		}
	}

	return stats
}

// CopyContext holds the state for a copy operation with progress tracking
type CopyContext struct {
	TotalBytes       int64
	TotalFiles       int
	CopiedBytes      int64
	CopiedFiles      int
	StartTime        time.Time
	LastProgressTime time.Time
	SendProgress     ProgressSender
	RetryMode        bool // When true, skip files that already exist with same size
	Ctx              context.Context // Optional context for cancellation support
}

// NewCopyContext creates a new CopyContext
func NewCopyContext(stats FileStats, sender ProgressSender) *CopyContext {
	return &CopyContext{
		TotalBytes:   stats.TotalBytes,
		TotalFiles:   stats.TotalFiles,
		StartTime:    time.Now(),
		SendProgress: sender,
	}
}

// NewCopyContextWithCancel creates a new CopyContext with cancellation support
func NewCopyContextWithCancel(stats FileStats, sender ProgressSender, ctx context.Context) *CopyContext {
	return &CopyContext{
		TotalBytes:   stats.TotalBytes,
		TotalFiles:   stats.TotalFiles,
		StartTime:    time.Now(),
		SendProgress: sender,
		Ctx:          ctx,
	}
}

// CopyFileWithProgress copies a single file with progress tracking
func (ctx *CopyContext) CopyFileWithProgress(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	srcStat, _ := sourceFile.Stat()

	// In retry mode, skip files that already exist with the same size
	if ctx.RetryMode {
		if dstInfo, err := os.Stat(dst); err == nil && !dstInfo.IsDir() && dstInfo.Size() == srcStat.Size() {
			// File exists with same size, skip it
			ctx.CopiedBytes += srcStat.Size()
			ctx.CopiedFiles++
			return nil
		}
	}

	// Send progress for current file
	ctx.SendProgress(CopyProgress{
		Status:      "progress",
		TotalBytes:  ctx.TotalBytes,
		CopiedBytes: ctx.CopiedBytes,
		CurrentFile: filepath.Base(src),
		TotalFiles:  ctx.TotalFiles,
		CopiedFiles: ctx.CopiedFiles,
	})

	destFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destFile.Close()

	buf := make([]byte, 1024*1024) // 1MB buffer
	for {
		// Check for cancellation
		if ctx.Ctx != nil {
			if err := ctx.Ctx.Err(); err != nil {
				return err
			}
		}

		n, readErr := sourceFile.Read(buf)
		if n > 0 {
			_, writeErr := destFile.Write(buf[:n])
			if writeErr != nil {
				return writeErr
			}
			ctx.CopiedBytes += int64(n)

			// Send progress every 200ms
			if time.Since(ctx.LastProgressTime) > 200*time.Millisecond {
				elapsed := time.Since(ctx.StartTime).Seconds()
				var bytesPerSec int64
				if elapsed > 0 {
					bytesPerSec = int64(float64(ctx.CopiedBytes) / elapsed)
				}
				ctx.SendProgress(CopyProgress{
					Status:      "progress",
					TotalBytes:  ctx.TotalBytes,
					CopiedBytes: ctx.CopiedBytes,
					CurrentFile: filepath.Base(src),
					TotalFiles:  ctx.TotalFiles,
					CopiedFiles: ctx.CopiedFiles,
					BytesPerSec: bytesPerSec,
				})
				ctx.LastProgressTime = time.Now()
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}

	ctx.CopiedFiles++
	return os.Chmod(dst, srcStat.Mode())
}

// CopyDirWithProgress recursively copies a directory with progress tracking
func (ctx *CopyContext) CopyDirWithProgress(src, dst string) error {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dst, srcInfo.Mode()); err != nil {
		return err
	}

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		// Check for cancellation
		if ctx.Ctx != nil {
			if err := ctx.Ctx.Err(); err != nil {
				return err
			}
		}

		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if entry.IsDir() {
			if err := ctx.CopyDirWithProgress(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			if err := ctx.CopyFileWithProgress(srcPath, dstPath); err != nil {
				return err
			}
		}
	}

	return nil
}

// CopyDirWithMerge recursively copies a directory with merge support.
// If dst already exists, it merges contents instead of failing.
// fileConflict controls behavior when a file already exists at dst: "overwrite", "skip", or "rename".
func (ctx *CopyContext) CopyDirWithMerge(src, dst, fileConflict string) error {
	if _, err := os.Stat(dst); os.IsNotExist(err) {
		// Destination doesn't exist, regular copy
		return ctx.CopyDirWithProgress(src, dst)
	}

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		// Check for cancellation
		if ctx.Ctx != nil {
			if err := ctx.Ctx.Err(); err != nil {
				return err
			}
		}
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if entry.IsDir() {
			// Recurse: merge subdirectories
			if err := ctx.CopyDirWithMerge(srcPath, dstPath, fileConflict); err != nil {
				return err
			}
		} else {
			if _, err := os.Stat(dstPath); err == nil {
				// File exists at destination
				switch fileConflict {
				case "overwrite":
					if err := SafeOverwrite(dstPath, false, func() error {
						return ctx.CopyFileWithProgress(srcPath, dstPath)
					}); err != nil {
						return err
					}
				case "skip":
					ctx.CopiedFiles++
					continue
				default: // "rename"
					unique := GenerateUniquePath(dst, entry.Name(), false, false)
					if err := ctx.CopyFileWithProgress(srcPath, unique); err != nil {
						return err
					}
				}
			} else {
				// No conflict, just copy
				if err := ctx.CopyFileWithProgress(srcPath, dstPath); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

// CopyWithProgress copies a file or directory with progress tracking
func (ctx *CopyContext) CopyWithProgress(src, dst string, isDir bool) error {
	if isDir {
		return ctx.CopyDirWithProgress(src, dst)
	}
	return ctx.CopyFileWithProgress(src, dst)
}

// SendCompleted sends the completed progress event
func (ctx *CopyContext) SendCompleted(newPath string) {
	elapsed := time.Since(ctx.StartTime).Seconds()
	var finalSpeed int64
	if elapsed > 0 && ctx.CopiedBytes > 0 {
		finalSpeed = int64(float64(ctx.CopiedBytes) / elapsed)
	}
	ctx.SendProgress(CopyProgress{
		Status:      "completed",
		TotalBytes:  ctx.TotalBytes,
		CopiedBytes: ctx.CopiedBytes,
		TotalFiles:  ctx.TotalFiles,
		CopiedFiles: ctx.CopiedFiles,
		NewPath:     newPath,
		BytesPerSec: finalSpeed,
	})
}

// SendError sends an error progress event
func (ctx *CopyContext) SendError(err error) {
	ctx.SendProgress(CopyProgress{
		Status: "error",
		Error:  err.Error(),
	})
}
