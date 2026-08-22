package handlers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// Serving a file from a remote backend used to mean downloading all of it to
// /data/.tmp and handing the temp file to http.ServeContent, purely so that
// Range requests would work. Seeking once in a 10 GB video therefore
// transferred 10 GB and wrote 10 GB to disk, and a few concurrent viewers could
// fill the volume — at which point every write in the product fails.
//
// RangeReader lets a backend answer for a byte range directly. It is an
// optional interface rather than a StorageBackend method so backends that
// cannot do it (and test doubles) need no changes; callers fall back to the
// old path.
type RangeReader interface {
	// ReadFileRange returns a reader over [offset, offset+length). A length of
	// -1 means "to the end of the file".
	ReadFileRange(ctx context.Context, relPath string, offset, length int64) (io.ReadCloser, *StorageFileInfo, error)
}

// httpRange is a single byte range from a Range header.
type httpRange struct {
	start  int64
	length int64 // -1 means to end of file
}

// contentRange renders the Content-Range header value for a 206 response.
func (r httpRange) contentRange(size int64) string {
	end := size - 1
	if r.length >= 0 {
		end = r.start + r.length - 1
	}
	return fmt.Sprintf("bytes %d-%d/%d", r.start, end, size)
}

// parseSingleRange understands the one form that matters in practice: a single
// range, as sent by browsers seeking in media and by download managers
// resuming. Multi-range requests return false so the caller serves the whole
// file, which is a valid response.
func parseSingleRange(header string, size int64) (httpRange, bool) {
	if header == "" || size <= 0 {
		return httpRange{}, false
	}
	const prefix = "bytes="
	if !strings.HasPrefix(header, prefix) {
		return httpRange{}, false
	}
	spec := strings.TrimPrefix(header, prefix)
	if strings.Contains(spec, ",") {
		return httpRange{}, false
	}

	dash := strings.Index(spec, "-")
	if dash < 0 {
		return httpRange{}, false
	}
	startStr := strings.TrimSpace(spec[:dash])
	endStr := strings.TrimSpace(spec[dash+1:])

	// "-N": the final N bytes.
	if startStr == "" {
		if endStr == "" {
			return httpRange{}, false
		}
		n, err := strconv.ParseInt(endStr, 10, 64)
		if err != nil || n <= 0 {
			return httpRange{}, false
		}
		if n > size {
			n = size
		}
		return httpRange{start: size - n, length: n}, true
	}

	start, err := strconv.ParseInt(startStr, 10, 64)
	if err != nil || start < 0 || start >= size {
		return httpRange{}, false
	}

	// "N-": from N to the end.
	if endStr == "" {
		return httpRange{start: start, length: size - start}, true
	}

	end, err := strconv.ParseInt(endStr, 10, 64)
	if err != nil || end < start {
		return httpRange{}, false
	}
	if end >= size {
		end = size - 1
	}
	return httpRange{start: start, length: end - start + 1}, true
}

// rangeStatus reports the status code a range response should carry.
func rangeStatus(hasRange bool) int {
	if hasRange {
		return http.StatusPartialContent
	}
	return http.StatusOK
}
