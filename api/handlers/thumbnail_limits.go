package handlers

import (
	"context"
	"fmt"
	"image"
	"os"
	"runtime"
	"time"
)

// Thumbnail generation shells out to ffmpeg and cwebp, and those calls had no
// concurrency limit and (mostly) no timeout. Opening a grid view on a folder of
// a hundred videos started a hundred ffmpeg processes at once; a file ffmpeg
// could not make sense of left one hanging for the life of the container.
// Neither the container nor the code capped anything, so this was an
// out-of-memory risk for the whole host.

// thumbnailWorkers bounds how many external conversions run at once. Encoders
// are CPU-bound, so one per core is the useful ceiling — beyond that they only
// contend.
var thumbnailWorkers = func() int {
	n := runtime.NumCPU()
	if n < 2 {
		return 1
	}
	return n
}()

// thumbnailSlots is the semaphore behind that limit.
var thumbnailSlots = make(chan struct{}, thumbnailWorkers)

// thumbnailCommandTimeout bounds a single external conversion. A thumbnail that
// takes longer than this is not worth waiting for, and the process must not
// outlive the attempt.
const thumbnailCommandTimeout = 30 * time.Second

// acquireThumbnailSlot blocks until a conversion slot is free, or the context
// is done. The returned function releases the slot.
func acquireThumbnailSlot(ctx context.Context) (release func(), err error) {
	select {
	case thumbnailSlots <- struct{}{}:
		return func() { <-thumbnailSlots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// withThumbnailCommandContext returns a context carrying the per-conversion
// timeout.
func withThumbnailCommandContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), thumbnailCommandTimeout)
}

// maxThumbnailPixels caps the decoded size of a source image. A 100-megapixel
// JPEG is a few tens of kilobytes on disk but allocates hundreds of megabytes
// once decoded, so the file size limit upstream does not protect against it.
const maxThumbnailPixels = 64 << 20 // 64 megapixels

// checkDecodableImageSize reads only the image header and rejects sources whose
// decoded form would be too large to hold in memory.
func checkDecodableImageSize(filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	cfg, _, err := image.DecodeConfig(file)
	if err != nil {
		return fmt.Errorf("failed to read image header: %w", err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return fmt.Errorf("image reports a non-positive size")
	}
	if int64(cfg.Width)*int64(cfg.Height) > maxThumbnailPixels {
		return fmt.Errorf("image is %dx%d, above the %d pixel thumbnail limit",
			cfg.Width, cfg.Height, maxThumbnailPixels)
	}
	return nil
}
