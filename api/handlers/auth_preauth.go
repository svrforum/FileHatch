package handlers

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// A password check and a 2FA check are two halves of one login. Verify2FA used
// to accept a bare userId, so the second half stood on its own: anyone who
// learned a user ID could sit on /auth/2fa/verify and try codes without ever
// knowing the password. User IDs are not secret — they appear in audit records
// and admin listings.
//
// Login now hands out a pre-auth token instead of a raw userId. It proves the
// password was accepted, it is short-lived, and it is only good for finishing
// this one login.

// preAuthTokenTTL is deliberately short: it covers reading a code off a phone,
// not leaving a tab open.
const preAuthTokenTTL = 5 * time.Minute

// preAuthPurpose distinguishes these tokens from session tokens signed with the
// same key. Without it, a pre-auth token would be a valid Bearer token.
const preAuthPurpose = "2fa"

// PreAuthClaims is the payload of a pre-auth token.
type PreAuthClaims struct {
	UserID     string `json:"userId"`
	Purpose    string `json:"purpose"`
	RememberMe bool   `json:"rememberMe,omitempty"`
	jwt.RegisteredClaims
}

// GeneratePreAuthToken issues a token proving the first factor succeeded.
func GeneratePreAuthToken(userID string, rememberMe bool) (string, error) {
	claims := &PreAuthClaims{
		UserID:     userID,
		Purpose:    preAuthPurpose,
		RememberMe: rememberMe,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(preAuthTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "filehatch",
			Subject:   preAuthPurpose,
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(sharedJWTSecret)
}

// ParsePreAuthToken validates a pre-auth token and returns its claims.
func ParsePreAuthToken(tokenString string) (*PreAuthClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &PreAuthClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method %v", t.Header["alg"])
		}
		return sharedJWTSecret, nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*PreAuthClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid pre-auth token")
	}
	// A session token deserialises into PreAuthClaims just fine — every field
	// it lacks simply comes back empty. The purpose check is what stops a
	// stolen session token from standing in for the password step.
	if claims.Purpose != preAuthPurpose {
		return nil, fmt.Errorf("token is not a pre-auth token")
	}
	if claims.UserID == "" {
		return nil, fmt.Errorf("pre-auth token has no subject")
	}

	return claims, nil
}
