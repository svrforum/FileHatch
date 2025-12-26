package handlers

import (
	"archive/zip"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// ZipDownloadRequest represents a request to download multiple files as ZIP
type ZipDownloadRequest struct {
	Paths []string `json:"paths"`
}

// DownloadAsZip handles downloading multiple files/folders as a ZIP archive
func (h *Handler) DownloadAsZip(c echo.Context) error {
	var req ZipDownloadRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}

	if len(req.Paths) == 0 {
		return RespondError(c, ErrMissingParameter("paths"))
	}

	// Get user claims
	claims := GetClaims(c)

	// Validate all paths and collect real paths
	type pathInfo struct {
		realPath    string
		displayPath string
		isDir       bool
	}
	validPaths := make([]pathInfo, 0, len(req.Paths))

	for _, path := range req.Paths {
		realPath, _, displayPath, err := h.resolvePath(path, claims)
		if err != nil {
			return RespondError(c, ErrInvalidPath(fmt.Sprintf("Invalid path: %s", path)))
		}

		info, err := os.Stat(realPath)
		if err != nil {
			if os.IsNotExist(err) {
				return RespondError(c, ErrNotFound(fmt.Sprintf("Path not found: %s", path)))
			}
			return RespondError(c, ErrOperationFailed("access path", err))
		}

		validPaths = append(validPaths, pathInfo{
			realPath:    realPath,
			displayPath: displayPath,
			isDir:       info.IsDir(),
		})
	}

	// Generate ZIP filename
	var zipName string
	if len(validPaths) == 1 {
		baseName := filepath.Base(validPaths[0].displayPath)
		if validPaths[0].isDir {
			zipName = baseName + ".zip"
		} else {
			zipName = strings.TrimSuffix(baseName, filepath.Ext(baseName)) + ".zip"
		}
	} else {
		zipName = fmt.Sprintf("download_%s.zip", time.Now().Format("20060102_150405"))
	}

	// Set response headers
	c.Response().Header().Set("Content-Type", "application/zip")
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, zipName))
	c.Response().WriteHeader(http.StatusOK)

	// Create ZIP writer
	zipWriter := zip.NewWriter(c.Response())
	defer zipWriter.Close()

	// Add files to ZIP
	for _, pi := range validPaths {
		if pi.isDir {
			// Walk directory and add all files
			basePath := filepath.Dir(pi.realPath)
			err := filepath.Walk(pi.realPath, func(path string, info os.FileInfo, err error) error {
				if err != nil {
					return err
				}

				// Create relative path for ZIP
				relPath, err := filepath.Rel(basePath, path)
				if err != nil {
					return err
				}

				// Skip the root directory itself
				if relPath == "." {
					return nil
				}

				if info.IsDir() {
					// Add directory entry
					_, err := zipWriter.Create(relPath + "/")
					return err
				}

				// Add file
				if err := zipAddFile(zipWriter, path, relPath); err != nil {
					return err
				}
				return nil
			})
			if err != nil {
				LogError("Failed to add directory to ZIP", err, "path", pi.displayPath)
				continue
			}
		} else {
			// Add single file
			fileName := filepath.Base(pi.realPath)
			if err := zipAddFile(zipWriter, pi.realPath, fileName); err != nil {
				LogError("Failed to add file to ZIP", err, "path", pi.displayPath)
				continue
			}
		}
	}

	return nil
}

// zipAddFile adds a single file to the ZIP archive
func zipAddFile(zipWriter *zip.Writer, filePath, zipPath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return err
	}

	// Create ZIP header
	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	header.Name = zipPath
	header.Method = zip.Deflate

	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		return err
	}

	_, err = io.Copy(writer, file)
	return err
}

// DownloadFolderAsZip handles downloading a single folder as ZIP
func (h *Handler) DownloadFolderAsZip(c echo.Context) error {
	requestPath := c.Param("*")
	if requestPath == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	claims := GetClaims(c)

	realPath, _, displayPath, err := h.resolvePath("/"+requestPath, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}

	info, err := os.Stat(realPath)
	if err != nil {
		if os.IsNotExist(err) {
			return RespondError(c, ErrNotFound("Folder"))
		}
		return RespondError(c, ErrOperationFailed("access folder", err))
	}

	if !info.IsDir() {
		return RespondError(c, ErrBadRequest("Path is not a folder"))
	}

	// Generate ZIP filename
	zipName := filepath.Base(displayPath) + ".zip"

	// Set response headers
	c.Response().Header().Set("Content-Type", "application/zip")
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, zipName))
	c.Response().WriteHeader(http.StatusOK)

	// Create ZIP writer
	zipWriter := zip.NewWriter(c.Response())
	defer zipWriter.Close()

	// Walk directory and add all files
	basePath := filepath.Dir(realPath)
	baseName := filepath.Base(realPath)

	return filepath.Walk(realPath, func(path string, fileInfo os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Create relative path for ZIP (include the folder name)
		relPath, err := filepath.Rel(basePath, path)
		if err != nil {
			return err
		}

		// Skip if it's the base directory entry point
		if relPath == baseName && fileInfo.IsDir() {
			return nil
		}

		if fileInfo.IsDir() {
			// Add directory entry
			_, err := zipWriter.Create(relPath + "/")
			return err
		}

		// Add file
		return zipAddFile(zipWriter, path, relPath)
	})
}
