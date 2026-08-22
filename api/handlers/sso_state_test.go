package handlers

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func newStateStore() *ssoStateStore {
	return &ssoStateStore{states: make(map[string]ssoStateEntry)}
}

func TestSSOState_IssueThenRedeem(t *testing.T) {
	s := newStateStore()
	s.Issue("state-1", "provider-a")

	if !s.Redeem("state-1", "provider-a") {
		t.Fatal("a state that was just issued was rejected")
	}
}

// A callback may only be redeemed once; otherwise a captured callback URL
// could be replayed.
func TestSSOState_IsSingleUse(t *testing.T) {
	s := newStateStore()
	s.Issue("state-1", "provider-a")

	if !s.Redeem("state-1", "provider-a") {
		t.Fatal("first redeem failed")
	}
	if s.Redeem("state-1", "provider-a") {
		t.Fatal("the same state was redeemed twice")
	}
}

func TestSSOState_RejectsUnknownAndEmpty(t *testing.T) {
	s := newStateStore()
	if s.Redeem("never-issued", "provider-a") {
		t.Error("a state that was never issued was accepted")
	}
	if s.Redeem("", "provider-a") {
		t.Error("an empty state was accepted")
	}
}

// The state must be bound to the provider it was issued for, so a state from
// one provider cannot complete a login through another.
func TestSSOState_RejectsProviderMismatch(t *testing.T) {
	s := newStateStore()
	s.Issue("state-1", "provider-a")

	if s.Redeem("state-1", "provider-b") {
		t.Fatal("a state was accepted for a different provider")
	}
}

func TestSSOState_RejectsExpired(t *testing.T) {
	s := newStateStore()
	s.states["state-1"] = ssoStateEntry{
		providerID: "provider-a",
		expiresAt:  time.Now().Add(-time.Second),
	}

	if s.Redeem("state-1", "provider-a") {
		t.Fatal("an expired state was accepted")
	}
}

func TestSSOState_BoundsMemory(t *testing.T) {
	s := newStateStore()
	for i := 0; i < maxTrackedSSOStates+50; i++ {
		s.Issue(fmt.Sprintf("state-%d", i), "provider-a")
	}

	s.mu.Lock()
	n := len(s.states)
	s.mu.Unlock()

	if n > maxTrackedSSOStates {
		t.Errorf("store grew to %d entries, cap is %d", n, maxTrackedSSOStates)
	}
}

func TestSSOState_ConcurrentAccess(t *testing.T) {
	s := newStateStore()
	var wg sync.WaitGroup

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := fmt.Sprintf("state-%d", i)
			s.Issue(key, "provider-a")
			if !s.Redeem(key, "provider-a") {
				t.Errorf("state %s could not be redeemed", key)
			}
		}(i)
	}
	wg.Wait()
}
