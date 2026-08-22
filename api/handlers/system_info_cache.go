package handlers

import (
	"sync"
	"time"
)

// GetSystemInfo walked the entire data volume on every request — once for the
// project totals and again, per top-level directory, for the folder tree. The
// admin page polls it every 30 seconds, so on a large volume a single open
// browser tab could keep a walk running continuously, and requests piled up
// because each one started its own.
//
// The walk now runs at most once per TTL, and concurrent callers share the
// result of one in-flight computation instead of each starting their own.

// systemInfoTTL is how long a computed snapshot is served. Storage totals move
// slowly; five minutes of staleness on an admin dashboard is not a problem,
// and it turns "every poll walks the disk" into "the disk is walked at most
// every five minutes no matter how many tabs are open".
const systemInfoTTL = 5 * time.Minute

// adminDataUsageTTL bounds how often the admin storage widget walks the data
// volume. The number it produces is a rough total on a sidebar; it does not
// need to be exact to the second.
const adminDataUsageTTL = 2 * time.Minute

// cachedComputation memoises one expensive value with a TTL, collapsing
// concurrent callers onto a single computation.
type cachedComputation[T any] struct {
	mu        sync.Mutex
	value     T
	expiresAt time.Time
	inFlight  *sync.WaitGroup
}

// Get returns the cached value, computing it if absent or stale. While a
// computation is running, other callers wait for it rather than starting
// another.
func (c *cachedComputation[T]) Get(ttl time.Duration, compute func() T) T {
	for {
		c.mu.Lock()

		if time.Now().Before(c.expiresAt) {
			value := c.value
			c.mu.Unlock()
			return value
		}

		if c.inFlight != nil {
			wg := c.inFlight
			c.mu.Unlock()
			wg.Wait()
			// Loop rather than returning: the computation that just finished
			// has refreshed expiresAt, so the next pass takes the fast path.
			continue
		}

		wg := &sync.WaitGroup{}
		wg.Add(1)
		c.inFlight = wg
		c.mu.Unlock()

		value := compute()

		c.mu.Lock()
		c.value = value
		c.expiresAt = time.Now().Add(ttl)
		c.inFlight = nil
		c.mu.Unlock()
		wg.Done()

		return value
	}
}

// Invalidate drops the cached value so the next Get recomputes.
func (c *cachedComputation[T]) Invalidate() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.expiresAt = time.Time{}
}

var (
	projectInfoCache    cachedComputation[ProjectInfo]
	folderTreeCache     cachedComputation[[]FolderStat]
	adminDataUsageCache cachedComputation[int64]
)

// InvalidateSystemInfoCache forces the next system-info request to recompute.
func InvalidateSystemInfoCache() {
	projectInfoCache.Invalidate()
	folderTreeCache.Invalidate()
	adminDataUsageCache.Invalidate()
}
