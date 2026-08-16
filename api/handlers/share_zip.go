package handlers

import (
	"archive/zip"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/labstack/echo/v4"
)

// Directory downloads through a share link stream a ZIP built on the fly, so
// the response is committed before the walk finishes. Everything below is
// written with that in mind: nothing that can fail is allowed to run after the
// header goes out, and a walk that fails midway must not produce an archive
// that looks complete.

// shareZipFailureManifest is added to the archive when some entries could not
// be read. Without it a visitor has no way to notice the gap: the ZIP still
// parses, it is just missing files.
const shareZipFailureManifest = "_FAILED_FILES.txt"

// shareZipResult reports what actually made it into the archive.
type shareZipResult struct {
	Files    int
	Bytes    int64
	Failures []string
}

// validateSharedDirectoryPath confirms directoryPath resolves inside root even
// after symlinks are followed. The lexical prefix checks used elsewhere accept
// "/data/share-evil" for root "/data/share", and they cannot see through a
// symlink at all.
func validateSharedDirectoryPath(root, directoryPath string) error {
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return err
	}

	resolvedDirectory, err := filepath.EvalSymlinks(directoryPath)
	if err != nil {
		return err
	}

	relPath, err := filepath.Rel(resolvedRoot, resolvedDirectory)
	if err != nil {
		return err
	}
	if relPath == ".." || strings.HasPrefix(relPath, ".."+string(os.PathSeparator)) {
		return fmt.Errorf("shared directory escapes allowed root")
	}

	return nil
}

// isHiddenShareEntry mirrors the filter ListShareContents applies when it
// builds the browsable listing. Including dotfiles in the ZIP would hand out
// .env, .git and friends that the visitor was never shown.
func isHiddenShareEntry(name string) bool {
	return strings.HasPrefix(name, ".")
}

// beginShareZip commits the response and returns a writer for the archive.
func beginShareZip(c echo.Context, directoryName string) (*zip.Writer, error) {
	c.Response().Header().Set(echo.HeaderContentType, "application/zip")
	setContentDisposition(c, directoryName+".zip")
	c.Response().WriteHeader(200)

	zipWriter := zip.NewWriter(c.Response())
	if _, err := zipWriter.Create(filepath.ToSlash(directoryName) + "/"); err != nil {
		_ = zipWriter.Close()
		return nil, err
	}
	return zipWriter, nil
}

// finishShareZip appends the failure manifest, if any, and closes the archive.
//
// A closed archive is a well-formed archive, so it is only closed when the walk
// completed. When the walk itself was aborted — a cancelled request, a writer
// that stopped accepting bytes — the central directory is deliberately left
// unwritten so the client sees a truncated file instead of a plausible one.
func finishShareZip(zipWriter *zip.Writer, result *shareZipResult, walkErr error) error {
	if walkErr != nil {
		return walkErr
	}

	if len(result.Failures) > 0 {
		sort.Strings(result.Failures)
		if w, err := zipWriter.Create(shareZipFailureManifest); err == nil {
			_, _ = fmt.Fprintf(w, "%d entries could not be included in this archive:\n\n", len(result.Failures))
			for _, f := range result.Failures {
				_, _ = fmt.Fprintf(w, "%s\n", f)
			}
		}
	}

	return zipWriter.Close()
}

// recordShareZipFailure notes an unreadable entry and keeps the walk going. A
// single permission-denied file should not cost the visitor the whole download.
func recordShareZipFailure(result *shareZipResult, relPath string, err error) {
	if len(result.Failures) < 100 {
		result.Failures = append(result.Failures, fmt.Sprintf("%s: %v", relPath, err))
	}
}

// streamLocalShareDirectory streams a local directory as a ZIP.
func streamLocalShareDirectory(c echo.Context, directoryPath, directoryName string) (*shareZipResult, error) {
	ctx := c.Request().Context()
	result := &shareZipResult{}

	zipWriter, err := beginShareZip(c, directoryName)
	if err != nil {
		return result, err
	}

	walkErr := filepath.Walk(directoryPath, func(path string, info os.FileInfo, walkErr error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if walkErr != nil {
			// The entry could not even be stat'ed. Skip it rather than aborting.
			rel, _ := filepath.Rel(directoryPath, path)
			recordShareZipFailure(result, rel, walkErr)
			if info != nil && info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if path == directoryPath {
			return nil
		}

		// filepath.Walk uses Lstat, so a symlink arrives as a symlink. Following
		// one would let a link inside the shared folder publish anything the
		// server process can read.
		if info.Mode()&os.ModeSymlink != 0 {
			return nil
		}

		if isHiddenShareEntry(info.Name()) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		relPath, err := filepath.Rel(directoryPath, path)
		if err != nil {
			return err
		}
		zipPath := filepath.ToSlash(filepath.Join(directoryName, relPath))

		if info.IsDir() {
			_, err := zipWriter.Create(zipPath + "/")
			return err
		}

		if err := zipAddFile(zipWriter, path, zipPath); err != nil {
			recordShareZipFailure(result, relPath, err)
			return nil
		}
		result.Files++
		result.Bytes += info.Size()
		return nil
	})

	return result, finishShareZip(zipWriter, result, walkErr)
}

// streamBackendShareDirectory streams a directory held on an external storage
// backend (S3 or a non-local mount) as a ZIP.
func streamBackendShareDirectory(
	c echo.Context,
	ctx context.Context,
	backend StorageBackend,
	relRoot string,
	directoryName string,
) (*shareZipResult, error) {
	result := &shareZipResult{}

	zipWriter, err := beginShareZip(c, directoryName)
	if err != nil {
		return result, err
	}

	walkErr := backend.Walk(ctx, relRoot, func(path string, info *StorageFileInfo, walkErr error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if walkErr != nil {
			recordShareZipFailure(result, path, walkErr)
			return nil
		}
		if path == relRoot {
			return nil
		}
		if os.FileMode(info.FileMode)&os.ModeSymlink != 0 {
			return nil
		}

		if isHiddenShareEntry(info.FileName) {
			if info.IsDirectory {
				return ErrSkipDir
			}
			return nil
		}

		relFromRoot, err := filepath.Rel(relRoot, path)
		if err != nil {
			return err
		}
		zipPath := filepath.ToSlash(filepath.Join(directoryName, relFromRoot))

		if info.IsDirectory {
			_, err := zipWriter.Create(zipPath + "/")
			return err
		}

		if err := addBackendFileToZip(ctx, zipWriter, backend, path, zipPath); err != nil {
			recordShareZipFailure(result, relFromRoot, err)
			return nil
		}
		result.Files++
		result.Bytes += info.FileSize
		return nil
	})

	return result, finishShareZip(zipWriter, result, walkErr)
}
