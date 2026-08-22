package handlers

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCachedComputation_ServesFromCacheWithinTTL(t *testing.T) {
	var c cachedComputation[int]
	var calls int32

	compute := func() int {
		atomic.AddInt32(&calls, 1)
		return 42
	}

	for i := 0; i < 5; i++ {
		if got := c.Get(time.Minute, compute); got != 42 {
			t.Fatalf("Get() = %d, want 42", got)
		}
	}

	if n := atomic.LoadInt32(&calls); n != 1 {
		t.Errorf("compute ran %d times, want 1", n)
	}
}

func TestCachedComputation_RecomputesAfterTTL(t *testing.T) {
	var c cachedComputation[int]
	var calls int32

	compute := func() int { return int(atomic.AddInt32(&calls, 1)) }

	if got := c.Get(time.Millisecond, compute); got != 1 {
		t.Fatalf("first Get = %d", got)
	}
	time.Sleep(5 * time.Millisecond)
	if got := c.Get(time.Millisecond, compute); got != 2 {
		t.Fatalf("Get after TTL = %d, want a recomputed 2", got)
	}
}

// The behaviour that actually matters here: a dashboard polling from several
// tabs must not start several walks of the data volume.
func TestCachedComputation_CollapsesConcurrentCallers(t *testing.T) {
	var c cachedComputation[int]
	var calls int32
	release := make(chan struct{})

	compute := func() int {
		atomic.AddInt32(&calls, 1)
		<-release // hold the computation open while the others pile up
		return 7
	}

	var wg sync.WaitGroup
	results := make([]int, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i] = c.Get(time.Minute, compute)
		}(i)
	}

	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()

	if n := atomic.LoadInt32(&calls); n != 1 {
		t.Errorf("compute ran %d times for 20 concurrent callers, want 1", n)
	}
	for i, got := range results {
		if got != 7 {
			t.Errorf("caller %d got %d, want 7", i, got)
		}
	}
}

func TestCachedComputation_InvalidateForcesRecompute(t *testing.T) {
	var c cachedComputation[int]
	var calls int32

	compute := func() int { return int(atomic.AddInt32(&calls, 1)) }

	_ = c.Get(time.Minute, compute)
	c.Invalidate()
	if got := c.Get(time.Minute, compute); got != 2 {
		t.Errorf("Get after Invalidate = %d, want 2", got)
	}
}
