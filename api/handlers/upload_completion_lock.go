package handlers

import "sync"

// completionPathLocks ensures that completion events targeting the same
// final destination path are serialized. Without this, two tus completions
// that race for the same file path can each be assigned a different "[N]"
// suffix by getUniqueFilePath, producing duplicate uploads such as
// "samples/foo[1].txt" and "samples/foo[2].txt" (Issue #36).
var completionPathLocks = struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}{
	locks: make(map[string]*sync.Mutex),
}

// LockCompletionPath acquires a per-path mutex and returns the unlock
// function. The caller must invoke the returned function exactly once.
// The map entry is intentionally never deleted: completion paths reuse a
// stable name space (the final destination), the per-path mutex memory
// footprint is negligible, and removing entries while another goroutine
// is waiting on the same key would race with map writes.
func LockCompletionPath(path string) func() {
	completionPathLocks.mu.Lock()
	l, ok := completionPathLocks.locks[path]
	if !ok {
		l = &sync.Mutex{}
		completionPathLocks.locks[path] = l
	}
	completionPathLocks.mu.Unlock()
	l.Lock()
	return l.Unlock
}
