package handlers

import (
	"fmt"
	"sync"
	"testing"
)

func TestStorageRouter_ResolveRoot(t *testing.T) {
	r := NewStorageRouter("/data", nil)

	result, err := r.Resolve("/", nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.StorageType != "root" {
		t.Errorf("expected 'root', got '%s'", result.StorageType)
	}
	if result.DisplayPath != "/" {
		t.Errorf("expected '/', got '%s'", result.DisplayPath)
	}
}

func TestStorageRouter_ResolveHome(t *testing.T) {
	r := NewStorageRouter("/data", nil)
	claims := &JWTClaims{Username: "testuser", UserID: "123"}

	result, err := r.Resolve("/home/documents", claims)
	if err != nil {
		t.Fatal(err)
	}
	if result.StorageType != StorageHome {
		t.Errorf("expected '%s', got '%s'", StorageHome, result.StorageType)
	}
	if result.RelPath != "documents" {
		t.Errorf("expected relPath 'documents', got '%s'", result.RelPath)
	}
	if result.Backend == nil {
		t.Fatal("expected non-nil backend")
	}
	if result.Backend.Type() != "local" {
		t.Errorf("expected backend type 'local', got '%s'", result.Backend.Type())
	}
}

func TestStorageRouter_ResolveHomeRequiresAuth(t *testing.T) {
	r := NewStorageRouter("/data", nil)

	_, err := r.Resolve("/home", nil)
	if err == nil {
		t.Error("expected error for unauthenticated home access")
	}
}

func TestStorageRouter_ResolveShared(t *testing.T) {
	r := NewStorageRouter("/data", nil)
	claims := &JWTClaims{Username: "testuser", UserID: "123"}

	result, err := r.Resolve("/shared/team-docs", claims)
	if err != nil {
		t.Fatal(err)
	}
	if result.StorageType != StorageShared {
		t.Errorf("expected '%s', got '%s'", StorageShared, result.StorageType)
	}
	if result.RelPath != "team-docs" {
		t.Errorf("expected relPath 'team-docs', got '%s'", result.RelPath)
	}
}

func TestStorageRouter_ResolveSharedWithMe(t *testing.T) {
	r := NewStorageRouter("/data", nil)
	claims := &JWTClaims{Username: "testuser", UserID: "123"}

	result, err := r.Resolve("/shared-with-me", claims)
	if err != nil {
		t.Fatal(err)
	}
	if result.StorageType != StorageSharedWithMe {
		t.Errorf("expected '%s', got '%s'", StorageSharedWithMe, result.StorageType)
	}
	if result.Backend != nil {
		t.Error("expected nil backend for shared-with-me")
	}
}

func TestStorageRouter_ResolveInvalid(t *testing.T) {
	r := NewStorageRouter("/data", nil)
	claims := &JWTClaims{Username: "testuser", UserID: "123"}

	_, err := r.Resolve("/invalid/path", claims)
	if err == nil {
		t.Error("expected error for invalid storage type")
	}
}

func TestStorageRouter_ResolveToRealPath(t *testing.T) {
	r := NewStorageRouter("/data", nil)
	claims := &JWTClaims{Username: "testuser", UserID: "123"}

	realPath, storageType, displayPath, err := r.ResolveToRealPath("/home/test.txt", claims)
	if err != nil {
		t.Fatal(err)
	}
	if storageType != StorageHome {
		t.Errorf("expected '%s', got '%s'", StorageHome, storageType)
	}
	if realPath != "/data/users/testuser/test.txt" {
		t.Errorf("expected '/data/users/testuser/test.txt', got '%s'", realPath)
	}
	if displayPath != "/home/test.txt" {
		t.Errorf("expected '/home/test.txt', got '%s'", displayPath)
	}
}

func TestStorageRouter_ResolveToRealPathShared(t *testing.T) {
	r := NewStorageRouter("/data", nil)
	claims := &JWTClaims{Username: "testuser", UserID: "123"}

	realPath, storageType, _, err := r.ResolveToRealPath("/shared/team/file.txt", claims)
	if err != nil {
		t.Fatal(err)
	}
	if storageType != StorageShared {
		t.Errorf("expected '%s', got '%s'", StorageShared, storageType)
	}
	if realPath != "/data/shared/team/file.txt" {
		t.Errorf("expected '/data/shared/team/file.txt', got '%s'", realPath)
	}
}

func TestStorageRouter_ResolveToRealPathRoot(t *testing.T) {
	r := NewStorageRouter("/data", nil)

	realPath, storageType, _, err := r.ResolveToRealPath("/", nil)
	if err != nil {
		t.Fatal(err)
	}
	if storageType != "root" {
		t.Errorf("expected 'root', got '%s'", storageType)
	}
	if realPath != "" {
		t.Errorf("expected empty real path for root, got '%s'", realPath)
	}
}

func TestStorageRouter_PathTraversal(t *testing.T) {
	r := NewStorageRouter("/data", nil)
	claims := &JWTClaims{Username: "testuser", UserID: "123"}

	_, err := r.Resolve("/home/../../../etc/passwd", claims)
	if err == nil {
		t.Error("expected error for path traversal")
	}
}

func TestStorageRouter_GetHomeBackendCaching(t *testing.T) {
	r := NewStorageRouter("/data", nil)

	b1 := r.GetHomeBackend("alice")
	b2 := r.GetHomeBackend("alice")
	b3 := r.GetHomeBackend("bob")

	if b1 != b2 {
		t.Error("expected same backend instance for same user")
	}
	if b1 == b3 {
		t.Error("expected different backend instances for different users")
	}
}

func TestStorageRouter_GetHomeBackendConcurrency(t *testing.T) {
	r := NewStorageRouter("/data", nil)
	const goroutines = 100

	var wg sync.WaitGroup
	wg.Add(goroutines)

	backends := make([]*LocalBackend, goroutines)
	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			// Mix of same and different usernames to stress both paths
			username := fmt.Sprintf("user-%d", idx%10)
			backends[idx] = r.GetHomeBackend(username)
		}(i)
	}
	wg.Wait()

	// All goroutines requesting the same username should get the same instance
	for i := 0; i < goroutines; i++ {
		for j := i + 1; j < goroutines; j++ {
			if i%10 == j%10 && backends[i] != backends[j] {
				t.Errorf("goroutines %d and %d got different backends for same user", i, j)
			}
		}
	}
}
