package handlers

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestLockCompletionPath_Serialization verifies that completion handlers
// targeting the same final path are serialized — the core guarantee that
// prevents concurrent tus completions from each picking a different
// "[N]" suffix in getUniqueFilePath (Issue #36).
func TestLockCompletionPath_Serialization(t *testing.T) {
	const path = "/tmp/lock-test-serialize.txt"
	var inFlight int32
	var maxConcurrent int32
	var wg sync.WaitGroup

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			unlock := LockCompletionPath(path)
			cur := atomic.AddInt32(&inFlight, 1)
			for {
				prev := atomic.LoadInt32(&maxConcurrent)
				if cur <= prev || atomic.CompareAndSwapInt32(&maxConcurrent, prev, cur) {
					break
				}
			}
			time.Sleep(2 * time.Millisecond)
			atomic.AddInt32(&inFlight, -1)
			unlock()
		}()
	}
	wg.Wait()

	if got := atomic.LoadInt32(&maxConcurrent); got != 1 {
		t.Fatalf("expected serialized access (max=1), got max concurrent = %d", got)
	}
}

// TestLockCompletionPath_DifferentPathsParallel ensures the per-path lock
// does not block unrelated paths — completions for different files must
// be able to proceed concurrently.
func TestLockCompletionPath_DifferentPathsParallel(t *testing.T) {
	const N = 8
	start := make(chan struct{})
	gotLock := make(chan struct{}, N)
	release := make(chan struct{})

	for i := 0; i < N; i++ {
		go func(i int) {
			path := "/tmp/lock-test-parallel-" + string(rune('a'+i)) + ".txt"
			<-start
			unlock := LockCompletionPath(path)
			gotLock <- struct{}{}
			<-release
			unlock()
		}(i)
	}

	close(start)

	// Each goroutine targets a distinct path, so they should all acquire
	// their respective locks concurrently within a small grace period.
	deadline := time.After(500 * time.Millisecond)
	for i := 0; i < N; i++ {
		select {
		case <-gotLock:
		case <-deadline:
			t.Fatalf("only %d/%d goroutines acquired their distinct-path locks before deadline", i, N)
		}
	}
	close(release)
}

// TestLockCompletionPath_SamePathReentrantBlocks documents that the lock
// is NOT reentrant — if the same goroutine attempts to lock the same path
// twice without unlocking, the second attempt will block. This is the
// expected behavior; the test ensures we notice if it ever changes.
func TestLockCompletionPath_SamePathReentrantBlocks(t *testing.T) {
	const path = "/tmp/lock-test-reentrant.txt"
	unlock := LockCompletionPath(path)
	defer unlock()

	done := make(chan struct{})
	go func() {
		u2 := LockCompletionPath(path)
		u2()
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("expected second LockCompletionPath on the same path to block while first is held")
	case <-time.After(100 * time.Millisecond):
		// expected — second lock is blocked
	}
}
