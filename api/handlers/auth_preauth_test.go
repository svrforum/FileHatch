package handlers

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func init() {
	if len(sharedJWTSecret) == 0 {
		sharedJWTSecret = []byte("test-jwt-secret-for-testing-only-32chars")
	}
}

func TestPreAuthToken_RoundTrip(t *testing.T) {
	token, err := GeneratePreAuthToken("user-1", true)
	if err != nil {
		t.Fatalf("GeneratePreAuthToken: %v", err)
	}

	claims, err := ParsePreAuthToken(token)
	if err != nil {
		t.Fatalf("ParsePreAuthToken: %v", err)
	}
	if claims.UserID != "user-1" {
		t.Errorf("UserID = %q, want user-1", claims.UserID)
	}
	if !claims.RememberMe {
		t.Error("RememberMe was not carried through")
	}
}

// The whole point of the pre-auth token is that a session token cannot stand in
// for it — otherwise a stolen session token would let its holder skip the
// password step on any account.
func TestPreAuthToken_RejectsSessionToken(t *testing.T) {
	sessionToken, err := GenerateJWTWithExpiration("user-1", "bob", false, false, time.Hour)
	if err != nil {
		t.Fatalf("GenerateJWTWithExpiration: %v", err)
	}

	if _, err := ParsePreAuthToken(sessionToken); err == nil {
		t.Fatal("a session token was accepted as a pre-auth token")
	}
}

func TestPreAuthToken_RejectsExpired(t *testing.T) {
	claims := &PreAuthClaims{
		UserID:  "user-1",
		Purpose: preAuthPurpose,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-time.Hour)),
			Issuer:    "filehatch",
		},
	}
	expired, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(sharedJWTSecret)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if _, err := ParsePreAuthToken(expired); err == nil {
		t.Fatal("an expired pre-auth token was accepted")
	}
}

func TestPreAuthToken_RejectsWrongSecret(t *testing.T) {
	claims := &PreAuthClaims{
		UserID:  "user-1",
		Purpose: preAuthPurpose,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
			Issuer:    "filehatch",
		},
	}
	forged, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("a-different-secret-that-is-32-chars"))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if _, err := ParsePreAuthToken(forged); err == nil {
		t.Fatal("a token signed with another key was accepted")
	}
}

func TestPreAuthToken_RejectsGarbage(t *testing.T) {
	for _, bad := range []string{"", "not-a-token", "a.b.c"} {
		if _, err := ParsePreAuthToken(bad); err == nil {
			t.Errorf("ParsePreAuthToken(%q) accepted a malformed token", bad)
		}
	}
}
