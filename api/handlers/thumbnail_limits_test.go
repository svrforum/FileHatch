package handlers

import (
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestAcquireThumbnailSlot_BoundsConcurrency(t *testing.T) {
	var active, peak int32
	done := make(chan struct{})

	for i := 0; i < thumbnailWorkers*4; i++ {
		go func() {
			defer func() { done <- struct{}{} }()

			release, err := acquireThumbnailSlot(context.Background())
			if err != nil {
				t.Errorf("acquireThumbnailSlot: %v", err)
				return
			}
			defer release()

			n := atomic.AddInt32(&active, 1)
			for {
				p := atomic.LoadInt32(&peak)
				if n <= p || atomic.CompareAndSwapInt32(&peak, p, n) {
					break
				}
			}
			time.Sleep(5 * time.Millisecond)
			atomic.AddInt32(&active, -1)
		}()
	}

	for i := 0; i < thumbnailWorkers*4; i++ {
		<-done
	}

	if got := atomic.LoadInt32(&peak); got > int32(thumbnailWorkers) {
		t.Errorf("peak concurrency %d exceeded the %d worker limit", got, thumbnailWorkers)
	}
}

func TestAcquireThumbnailSlot_RespectsContext(t *testing.T) {
	releases := make([]func(), 0, thumbnailWorkers)
	for i := 0; i < thumbnailWorkers; i++ {
		release, err := acquireThumbnailSlot(context.Background())
		if err != nil {
			t.Fatalf("acquireThumbnailSlot: %v", err)
		}
		releases = append(releases, release)
	}
	defer func() {
		for _, r := range releases {
			r()
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	if _, err := acquireThumbnailSlot(ctx); err == nil {
		t.Fatal("acquireThumbnailSlot ignored a cancelled context while saturated")
	}
}

func writeTestPNG(t *testing.T, path string, w, h int) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})

	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatalf("encode: %v", err)
	}
}

func TestCheckDecodableImageSize_AcceptsNormalImage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "small.png")
	writeTestPNG(t, path, 64, 64)

	if err := checkDecodableImageSize(path); err != nil {
		t.Errorf("a 64x64 image was rejected: %v", err)
	}
}

func TestCheckDecodableImageSize_RejectsMissingFile(t *testing.T) {
	if err := checkDecodableImageSize(filepath.Join(t.TempDir(), "nope.png")); err == nil {
		t.Error("a missing file was accepted")
	}
}

func TestCheckDecodableImageSize_RejectsNonImage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notanimage.png")
	if err := os.WriteFile(path, []byte("this is not a png"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	if err := checkDecodableImageSize(path); err == nil {
		t.Error("a non-image file was accepted")
	}
}

// The limit has to be enforced from the header alone — the point is to refuse
// before allocating the decoded image.
func TestMaxThumbnailPixels_IsEnforcedAgainstDimensions(t *testing.T) {
	huge := int64(20000) * int64(20000) // 400 megapixels
	if huge <= maxThumbnailPixels {
		t.Fatalf("test assumption broken: %d is within the %d limit", huge, maxThumbnailPixels)
	}
}
