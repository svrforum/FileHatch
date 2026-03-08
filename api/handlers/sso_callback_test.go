package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDiscoverOIDCEndpoints(t *testing.T) {
	// Create mock OIDC discovery server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/openid-configuration" {
			http.NotFound(w, r)
			return
		}
		resp := OIDCDiscoveryResponse{
			AuthorizationEndpoint: "https://example.com/authorize",
			TokenEndpoint:         "https://example.com/token",
			UserinfoEndpoint:      "https://example.com/userinfo",
			Issuer:                "https://example.com",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	// Clear cache before test
	discoveryMu.Lock()
	discoveryCache = make(map[string]*cachedDiscovery)
	discoveryMu.Unlock()

	result, err := discoverOIDCEndpoints(server.URL)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if result.AuthorizationEndpoint != "https://example.com/authorize" {
		t.Errorf("expected authorization_endpoint=https://example.com/authorize, got %s", result.AuthorizationEndpoint)
	}
	if result.TokenEndpoint != "https://example.com/token" {
		t.Errorf("expected token_endpoint=https://example.com/token, got %s", result.TokenEndpoint)
	}
	if result.UserinfoEndpoint != "https://example.com/userinfo" {
		t.Errorf("expected userinfo_endpoint=https://example.com/userinfo, got %s", result.UserinfoEndpoint)
	}
	if result.Issuer != "https://example.com" {
		t.Errorf("expected issuer=https://example.com, got %s", result.Issuer)
	}
}

func TestDiscoverOIDCEndpoints_Error(t *testing.T) {
	// Create server that returns 404
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer server.Close()

	// Clear cache before test
	discoveryMu.Lock()
	discoveryCache = make(map[string]*cachedDiscovery)
	discoveryMu.Unlock()

	_, err := discoverOIDCEndpoints(server.URL)
	if err == nil {
		t.Fatal("expected error for 404 response, got nil")
	}
}

func TestDiscoverOIDCEndpoints_Cache(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		if r.URL.Path != "/.well-known/openid-configuration" {
			http.NotFound(w, r)
			return
		}
		resp := OIDCDiscoveryResponse{
			AuthorizationEndpoint: "https://example.com/authorize",
			TokenEndpoint:         "https://example.com/token",
			UserinfoEndpoint:      "https://example.com/userinfo",
			Issuer:                "https://example.com",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	// Clear cache before test
	discoveryMu.Lock()
	discoveryCache = make(map[string]*cachedDiscovery)
	discoveryMu.Unlock()

	// First call - should hit server
	_, err := discoverOIDCEndpoints(server.URL)
	if err != nil {
		t.Fatalf("first call: expected no error, got %v", err)
	}

	// Second call - should use cache
	_, err = discoverOIDCEndpoints(server.URL)
	if err != nil {
		t.Fatalf("second call: expected no error, got %v", err)
	}

	if callCount != 1 {
		t.Errorf("expected server to be called once (cache hit), got %d calls", callCount)
	}
}

func TestDiscoverOIDCEndpoints_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	// Clear cache before test
	discoveryMu.Lock()
	discoveryCache = make(map[string]*cachedDiscovery)
	discoveryMu.Unlock()

	_, err := discoverOIDCEndpoints(server.URL)
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}
