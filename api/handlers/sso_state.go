package handlers

import (
	"sync"
	"time"
)

// OAuth2 `state` exists to tie the callback back to an authorization request
// this server actually started. GetAuthURL generated one and returned it, but
// HandleCallback never looked at it — the parameter was read into a commented
// out line. Any callback with a valid `code` was accepted, so an attacker could
// complete their own authorization at the provider and then feed the resulting
// code to a victim's browser, logging the victim into the attacker's account
// (login CSRF).
//
// States are held in memory: they live for minutes, a restart during a login
// only costs that login, and this avoids a schema change on the hot path.

// ssoStateTTL bounds how long an authorization request stays valid.
const ssoStateTTL = 10 * time.Minute

// maxTrackedSSOStates caps memory use if states are generated but never
// redeemed (a crawler hitting the auth URL, say). Oldest entries are dropped.
const maxTrackedSSOStates = 4096

type ssoStateEntry struct {
	providerID string
	expiresAt  time.Time
}

type ssoStateStore struct {
	mu     sync.Mutex
	states map[string]ssoStateEntry
}

var globalSSOStates = &ssoStateStore{states: make(map[string]ssoStateEntry)}

// Issue records a freshly generated state for the given provider.
func (s *ssoStateStore) Issue(state, providerID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.sweepLocked()
	if len(s.states) >= maxTrackedSSOStates {
		s.dropOldestLocked()
	}
	s.states[state] = ssoStateEntry{
		providerID: providerID,
		expiresAt:  time.Now().Add(ssoStateTTL),
	}
}

// Redeem consumes a state and reports whether it was valid for providerID.
// A state is single-use: replaying a callback fails the second time.
func (s *ssoStateStore) Redeem(state, providerID string) bool {
	if state == "" {
		return false
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	entry, ok := s.states[state]
	if !ok {
		return false
	}
	delete(s.states, state)

	if time.Now().After(entry.expiresAt) {
		return false
	}
	return entry.providerID == providerID
}

func (s *ssoStateStore) sweepLocked() {
	now := time.Now()
	for k, v := range s.states {
		if now.After(v.expiresAt) {
			delete(s.states, k)
		}
	}
}

func (s *ssoStateStore) dropOldestLocked() {
	var oldestKey string
	var oldest time.Time
	for k, v := range s.states {
		if oldestKey == "" || v.expiresAt.Before(oldest) {
			oldestKey, oldest = k, v.expiresAt
		}
	}
	if oldestKey != "" {
		delete(s.states, oldestKey)
	}
}
