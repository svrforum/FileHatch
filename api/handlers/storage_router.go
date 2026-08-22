package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Storage type constants
const (
	StorageExternal = "external"
)

// ResolveResult holds the result of resolving a virtual path to a backend + relative path
type ResolveResult struct {
	Backend     StorageBackend
	RelPath     string
	StorageType string // "home", "shared", "shared-with-me", "external", "root"
	DisplayPath string
	MountID     string // external storage ID (empty for built-in)
	IsReadonly  bool   // read-only mount
}

// UserExternalStorage represents an external storage accessible by a user (for root listing)
type UserExternalStorage struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	MountPath   string `json:"mountPath"`
	BackendType string `json:"backendType"`
	Status      string `json:"status"`
	IsReadonly  bool   `json:"isReadonly"`
}

// externalBackendEntry caches a backend instance with its config hash
type externalBackendEntry struct {
	backend   StorageBackend
	createdAt time.Time
}

// StorageRouter maps virtual paths to StorageBackend instances
type StorageRouter struct {
	dataRoot         string
	db               *sql.DB
	homeBackends     map[string]*LocalBackend // username -> backend (cached)
	homeMu           sync.RWMutex
	sharedBackend    *LocalBackend
	externalBackends map[string]*externalBackendEntry // storageID -> cached backend
	externalMu       sync.RWMutex
}

// NewStorageRouter creates a new StorageRouter
func NewStorageRouter(dataRoot string, db *sql.DB) *StorageRouter {
	return &StorageRouter{
		dataRoot:         dataRoot,
		db:               db,
		homeBackends:     make(map[string]*LocalBackend),
		sharedBackend:    NewLocalBackend(filepath.Join(dataRoot, "shared"), true),
		externalBackends: make(map[string]*externalBackendEntry),
	}
}

// GetHomeBackend returns (or creates) a LocalBackend for a user's home directory
func (r *StorageRouter) GetHomeBackend(username string) *LocalBackend {
	r.homeMu.RLock()
	if b, ok := r.homeBackends[username]; ok {
		r.homeMu.RUnlock()
		return b
	}
	r.homeMu.RUnlock()

	r.homeMu.Lock()
	defer r.homeMu.Unlock()
	// Double-check after acquiring write lock
	if b, ok := r.homeBackends[username]; ok {
		return b
	}
	b := NewLocalBackend(filepath.Join(r.dataRoot, "users", username), false)
	r.homeBackends[username] = b
	return b
}

// GetSharedBackend returns the shared folder backend
func (r *StorageRouter) GetSharedBackend() *LocalBackend {
	return r.sharedBackend
}

// Resolve maps a virtual path + claims to a ResolveResult containing the appropriate backend
func (r *StorageRouter) Resolve(virtualPath string, claims *JWTClaims) (*ResolveResult, error) {
	// Clean path
	cleanPath, err := validateAndCleanPath(virtualPath)
	if err != nil {
		return nil, err
	}

	// Parse path parts
	pathParts := strings.Split(strings.TrimPrefix(cleanPath, "/"), "/")
	if len(pathParts) == 0 || (len(pathParts) == 1 && pathParts[0] == "") {
		return &ResolveResult{
			StorageType: "root",
			DisplayPath: "/",
		}, nil
	}

	root := pathParts[0]
	subPath := ""
	if len(pathParts) > 1 {
		subPath = filepath.Join(pathParts[1:]...)
	}

	// Validate subPath
	if subPath != "" {
		if _, err := validateAndCleanPath(subPath); err != nil {
			return nil, err
		}
	}

	switch root {
	case "home":
		if claims == nil {
			return nil, fmt.Errorf("authentication required for home folder")
		}
		backend := r.GetHomeBackend(claims.Username)
		return &ResolveResult{
			Backend:     backend,
			RelPath:     subPath,
			StorageType: StorageHome,
			DisplayPath: "/" + filepath.Join("home", subPath),
		}, nil

	case "shared":
		if claims == nil {
			return nil, fmt.Errorf("authentication required for shared drives")
		}
		return &ResolveResult{
			Backend:     r.sharedBackend,
			RelPath:     subPath,
			StorageType: StorageShared,
			DisplayPath: "/" + filepath.Join("shared", subPath),
		}, nil

	case "shared-with-me":
		if claims == nil {
			return nil, fmt.Errorf("authentication required for shared files")
		}
		return &ResolveResult{
			StorageType: StorageSharedWithMe,
			DisplayPath: "/shared-with-me",
		}, nil

	case "external":
		if claims == nil {
			return nil, fmt.Errorf("authentication required for external storage")
		}
		if len(pathParts) < 2 {
			return nil, fmt.Errorf("external storage mount path required")
		}
		mountPath := pathParts[1]
		relPath := ""
		if len(pathParts) > 2 {
			relPath = filepath.Join(pathParts[2:]...)
		}
		return r.resolveExternal(mountPath, relPath, claims)

	default:
		return nil, fmt.Errorf("invalid storage type: %s", root)
	}
}

// ResolveToRealPath is a convenience method that resolves and returns the real path,
// storage type, and display path - matching the signature of the old resolvePath()
func (r *StorageRouter) ResolveToRealPath(virtualPath string, claims *JWTClaims) (realPath string, storageType string, displayPath string, err error) {
	result, err := r.Resolve(virtualPath, claims)
	if err != nil {
		return "", "", "", err
	}

	if result.StorageType == "root" {
		return "", "root", "/", nil
	}

	if result.StorageType == StorageSharedWithMe {
		return "", StorageSharedWithMe, "/shared-with-me", nil
	}

	if result.Backend == nil {
		return "", result.StorageType, result.DisplayPath, nil
	}

	if result.Backend.IsLocal() {
		rp, err := result.Backend.GetRealPath(result.RelPath)
		if err != nil {
			return "", "", "", err
		}
		return rp, result.StorageType, result.DisplayPath, nil
	}

	// Non-local backends don't have a real path
	return "", result.StorageType, result.DisplayPath, nil
}

// resolveExternal resolves an external storage path to a ResolveResult
func (r *StorageRouter) resolveExternal(mountPath, relPath string, claims *JWTClaims) (*ResolveResult, error) {
	// Look up the external storage by mount_path
	var storageID, backendType, configEncrypted, status string
	var isReadonly bool
	err := r.db.QueryRow(`
		SELECT id, backend_type, config_encrypted, status, is_readonly
		FROM external_storages
		WHERE mount_path = $1
	`, mountPath).Scan(&storageID, &backendType, &configEncrypted, &status, &isReadonly)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("external storage not found: %s", mountPath)
		}
		return nil, fmt.Errorf("failed to look up external storage: %w", err)
	}

	if status != "active" {
		return nil, fmt.Errorf("external storage '%s' is currently unavailable (status: %s)", mountPath, status)
	}

	// Check user access
	var permissionLevel int
	err = r.db.QueryRow(`
		SELECT permission_level FROM external_storage_access
		WHERE external_storage_id = $1 AND user_id = $2
	`, storageID, claims.UserID).Scan(&permissionLevel)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("no access to external storage: %s", mountPath)
		}
		return nil, fmt.Errorf("failed to check access: %w", err)
	}

	// If storage is readonly or user only has read permission, mark as readonly
	effectiveReadonly := isReadonly || permissionLevel < 2

	// Get or create the backend instance
	backend, err := r.getOrCreateExternalBackend(storageID, backendType, configEncrypted)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize external storage backend: %w", err)
	}

	displayPath := "/external/" + mountPath
	if relPath != "" {
		displayPath = displayPath + "/" + relPath
	}

	return &ResolveResult{
		Backend:     backend,
		RelPath:     relPath,
		StorageType: StorageExternal,
		DisplayPath: displayPath,
		MountID:     storageID,
		IsReadonly:  effectiveReadonly,
	}, nil
}

// getOrCreateExternalBackend returns a cached backend instance or creates a new one
func (r *StorageRouter) getOrCreateExternalBackend(storageID, backendType, configEncrypted string) (StorageBackend, error) {
	// Check cache first
	r.externalMu.RLock()
	entry, ok := r.externalBackends[storageID]
	r.externalMu.RUnlock()

	// Use cached backend if less than 5 minutes old
	if ok && time.Since(entry.createdAt) < 5*time.Minute {
		return entry.backend, nil
	}

	// Decrypt config
	configJSON, err := decryptStorageConfig(configEncrypted)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt config: %w", err)
	}

	var backend StorageBackend

	switch backendType {
	case "s3":
		var cfg S3Config
		if err := json.Unmarshal(configJSON, &cfg); err != nil {
			return nil, fmt.Errorf("invalid S3 config: %w", err)
		}
		s3Backend, err := NewS3Backend(cfg)
		if err != nil {
			return nil, fmt.Errorf("failed to create S3 backend: %w", err)
		}
		// Wrap with cache for better performance
		backend = NewCachedBackend(s3Backend, storageID)

	case "local-mount":
		var cfg struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(configJSON, &cfg); err != nil {
			return nil, fmt.Errorf("invalid local-mount config: %w", err)
		}
		// Verify path exists
		if _, err := os.Stat(cfg.Path); err != nil {
			return nil, fmt.Errorf("mount path not accessible: %w", err)
		}
		backend = NewLocalBackend(cfg.Path, false)

	default:
		return nil, fmt.Errorf("unsupported backend type: %s", backendType)
	}

	// Cache the backend
	r.externalMu.Lock()
	r.externalBackends[storageID] = &externalBackendEntry{
		backend:   backend,
		createdAt: time.Now(),
	}
	r.externalMu.Unlock()

	return backend, nil
}

// GetUserExternalStorages returns external storages accessible by the given user
func (r *StorageRouter) GetUserExternalStorages(userID string) []UserExternalStorage {
	rows, err := r.db.Query(`
		SELECT es.id, es.name, es.mount_path, es.backend_type, es.status, es.is_readonly
		FROM external_storages es
		JOIN external_storage_access esa ON esa.external_storage_id = es.id
		WHERE esa.user_id = $1 AND es.status = 'active'
		ORDER BY es.name
	`, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var storages []UserExternalStorage
	for rows.Next() {
		var s UserExternalStorage
		if err := rows.Scan(&s.ID, &s.Name, &s.MountPath, &s.BackendType, &s.Status, &s.IsReadonly); err != nil {
			continue
		}
		storages = append(storages, s)
	}
	return storages
}

// InvalidateExternalBackend removes a cached backend instance (e.g., after config update)
func (r *StorageRouter) InvalidateExternalBackend(storageID string) {
	r.externalMu.Lock()
	delete(r.externalBackends, storageID)
	r.externalMu.Unlock()
}

// ListExternalDirectory lists files in an external storage using the StorageBackend
func (r *StorageRouter) ListExternalDirectory(ctx context.Context, result *ResolveResult) ([]StorageDirEntry, error) {
	if result.Backend == nil {
		return nil, fmt.Errorf("no backend available")
	}
	return result.Backend.List(ctx, result.RelPath)
}
