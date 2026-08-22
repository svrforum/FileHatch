package handlers

import (
	"net/http"
	"testing"
)

func TestParseSingleRange(t *testing.T) {
	const size = 1000

	for _, tc := range []struct {
		name       string
		header     string
		wantOK     bool
		wantStart  int64
		wantLength int64
	}{
		{"first 100 bytes", "bytes=0-99", true, 0, 100},
		{"middle", "bytes=500-599", true, 500, 100},
		{"open ended", "bytes=500-", true, 500, 500},
		{"suffix", "bytes=-200", true, 800, 200},
		{"suffix longer than file", "bytes=-5000", true, 0, 1000},
		{"end past EOF is clamped", "bytes=900-5000", true, 900, 100},
		{"whole file", "bytes=0-999", true, 0, 1000},

		{"empty header", "", false, 0, 0},
		{"unsupported unit", "items=0-99", false, 0, 0},
		{"multi-range is declined", "bytes=0-99,200-299", false, 0, 0},
		{"start past EOF", "bytes=1000-1099", false, 0, 0},
		{"reversed", "bytes=500-100", false, 0, 0},
		{"garbage", "bytes=abc-def", false, 0, 0},
		{"no dash", "bytes=100", false, 0, 0},
		{"empty spec", "bytes=-", false, 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseSingleRange(tc.header, size)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if !ok {
				return
			}
			if got.start != tc.wantStart {
				t.Errorf("start = %d, want %d", got.start, tc.wantStart)
			}
			if got.length != tc.wantLength {
				t.Errorf("length = %d, want %d", got.length, tc.wantLength)
			}
		})
	}
}

func TestParseSingleRange_ZeroSizeFile(t *testing.T) {
	if _, ok := parseSingleRange("bytes=0-10", 0); ok {
		t.Error("a range was accepted against an empty file")
	}
}

func TestHTTPRange_ContentRange(t *testing.T) {
	for _, tc := range []struct {
		name string
		r    httpRange
		size int64
		want string
	}{
		{"bounded", httpRange{start: 0, length: 100}, 1000, "bytes 0-99/1000"},
		{"middle", httpRange{start: 500, length: 100}, 1000, "bytes 500-599/1000"},
		{"open ended", httpRange{start: 500, length: -1}, 1000, "bytes 500-999/1000"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.r.contentRange(tc.size); got != tc.want {
				t.Errorf("contentRange() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestRangeStatus(t *testing.T) {
	if got := rangeStatus(true); got != http.StatusPartialContent {
		t.Errorf("rangeStatus(true) = %d, want 206", got)
	}
	if got := rangeStatus(false); got != http.StatusOK {
		t.Errorf("rangeStatus(false) = %d, want 200", got)
	}
}
