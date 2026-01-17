package handlers

import (
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
	SrcRealPath     string
	SrcStorageType  string
	SrcDisplayPath  string
	DestRealPath    string
	DestStorageType string
	DestDisplayPath string
	SrcInfo         os.FileInfo
	FinalDestPath   string
	Claims          *JWTClaims
}

// ResolveOperationPaths resolves and validates source and destination paths for copy/move operations
func (h *Handler) ResolveOperationPaths(c echo.Context, requestPath, destination string, allowSameFilename bool) (*OperationPaths, error) {
	var claims *JWTClaims
	if user, ok := c.Get("user").(*JWTClaims); ok {
		claims = user
	}

	// Resolve source path
	srcRealPath, srcStorageType, srcDisplayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return nil, ErrBadRequest(err.Error())
	}

	if srcStorageType == "root" {
		return nil, ErrBadRequest("Cannot operate on root")
	}

	// Resolve destination path
	destRealPath, destStorageType, destDisplayPath, err := h.resolvePath(destination, claims)
	if err != nil {
		return nil, ErrBadRequest(err.Error())
	}

	if destStorageType == "root" {
		return nil, ErrBadRequest("Cannot operate to root")
	}

	// Check permissions
	if (srcStorageType == StorageHome || destStorageType == StorageHome) && claims == nil {
		return nil, ErrUnauthorized("Authentication required")
	}

	// Check if source exists
	srcInfo, err := os.Stat(srcRealPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNotFound("Source")
		}
		return nil, ErrInternal("Failed to access source")
	}

	// Check if destination is a directory
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

	// Build final destination path with duplicate handling
	finalDestPath := GenerateUniquePath(destRealPath, srcInfo.Name(), srcInfo.IsDir(), allowSameFilename)

	return &OperationPaths{
		SrcRealPath:     srcRealPath,
		SrcStorageType:  srcStorageType,
		SrcDisplayPath:  srcDisplayPath,
		DestRealPath:    destRealPath,
		DestStorageType: destStorageType,
		DestDisplayPath: destDisplayPath,
		SrcInfo:         srcInfo,
		FinalDestPath:   finalDestPath,
		Claims:          claims,
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
		data, _ := json.Marshal(progress)
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

// CopyContext holds the state for a copy operation with progress tracking
type CopyContext struct {
	TotalBytes       int64
	TotalFiles       int
	CopiedBytes      int64
	CopiedFiles      int
	StartTime        time.Time
	LastProgressTime time.Time
	SendProgress     ProgressSender
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

// CopyFileWithProgress copies a single file with progress tracking
func (ctx *CopyContext) CopyFileWithProgress(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	srcStat, _ := sourceFile.Stat()

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
