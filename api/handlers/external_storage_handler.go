package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

var encryptionKeyWarningOnce sync.Once

// ExternalStorage represents an external storage mount
type ExternalStorage struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	MountPath     string    `json:"mountPath"`
	BackendType   string    `json:"backendType"` // "s3", "local-mount"
	Status        string    `json:"status"`      // "active", "disabled", "error"
	StatusMessage string    `json:"statusMessage,omitempty"`
	LastCheckedAt *string   `json:"lastCheckedAt,omitempty"`
	StorageUsed   int64     `json:"storageUsed"`
	StorageQuota  int64     `json:"storageQuota"` // 0 = unlimited
	CreatedBy     string    `json:"createdBy"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
	IsReadonly    bool      `json:"isReadonly"`
}

// ExternalStorageAccess represents user access to external storage
type ExternalStorageAccess struct {
	ID                int64     `json:"id"`
	ExternalStorageID string    `json:"externalStorageId"`
	UserID            string    `json:"userId"`
	PermissionLevel   int       `json:"permissionLevel"` // 1=read, 2=read-write
	GrantedBy         string    `json:"grantedBy,omitempty"`
	CreatedAt         time.Time `json:"createdAt"`
	Username          string    `json:"username,omitempty"`
	GrantedByUsername string    `json:"grantedByUsername,omitempty"`
}

// ExternalStorageHandler handles external storage admin operations
type ExternalStorageHandler struct {
	db           *sql.DB
	auditHandler *AuditHandler
}

// NewExternalStorageHandler creates a new ExternalStorageHandler
func NewExternalStorageHandler(db *sql.DB, dataRoot string) *ExternalStorageHandler {
	return &ExternalStorageHandler{
		db:           db,
		auditHandler: NewAuditHandler(db, dataRoot),
	}
}

// reserved mount paths that cannot be used
var reservedMountPaths = map[string]bool{
	"home": true, "shared": true, "shared-with-me": true, "trash": true,
	"external": true, "root": true,
}

// getEncryptionKey returns the encryption key for config storage
func getStorageEncryptionKey() []byte {
	key := os.Getenv("STORAGE_ENCRYPTION_KEY")
	if key == "" {
		key = os.Getenv("SMB_ENCRYPTION_KEY")
	}
	if key == "" {
		encryptionKeyWarningOnce.Do(func() {
			log.Println("WARNING: STORAGE_ENCRYPTION_KEY not set. Using default key. Set STORAGE_ENCRYPTION_KEY in production!")
		})
		key = "filehatch-default-key-change-me!!" // 32 bytes
	}
	// Ensure key is 32 bytes
	keyBytes := []byte(key)
	if len(keyBytes) > 32 {
		keyBytes = keyBytes[:32]
	}
	for len(keyBytes) < 32 {
		keyBytes = append(keyBytes, '0')
	}
	return keyBytes
}

// CreateExternalStorage creates a new external storage
func (h *ExternalStorageHandler) CreateExternalStorage(c echo.Context) error {
	claims, err := RequireAdmin(c)
	if err != nil {
		return RespondError(c, ErrUnauthorized("Admin access required"))
	}

	var req struct {
		Name        string          `json:"name"`
		MountPath   string          `json:"mountPath"`
		BackendType string          `json:"backendType"`
		Config      json.RawMessage `json:"config"`
		IsReadonly  bool            `json:"isReadonly"`
		Quota       int64           `json:"storageQuota"`
	}
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	// Validate
	if req.Name == "" || req.MountPath == "" || req.BackendType == "" {
		return RespondError(c, ErrBadRequest("Name, mountPath, and backendType are required"))
	}

	// Validate mount path
	mountPath := strings.ToLower(strings.TrimSpace(req.MountPath))
	mountPath = strings.Trim(mountPath, "/")
	if reservedMountPaths[mountPath] {
		return RespondError(c, ErrBadRequest("Mount path is reserved"))
	}
	if strings.ContainsAny(mountPath, `/\:*?"<>| `) {
		return RespondError(c, ErrBadRequest("Mount path contains invalid characters"))
	}

	// Validate backend type
	if req.BackendType != "s3" && req.BackendType != "local-mount" {
		return RespondError(c, ErrBadRequest("Backend type must be 's3' or 'local-mount'"))
	}

	// Validate config
	if err := validateExternalStorageConfig(req.BackendType, req.Config); err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	// Encrypt config
	encryptedConfig, err := EncryptAESGCM(req.Config, getStorageEncryptionKey())
	if err != nil {
		return RespondError(c, ErrInternal("Failed to encrypt configuration"))
	}

	// Insert into database
	var id string
	err = h.db.QueryRow(`
		INSERT INTO external_storages (name, mount_path, backend_type, config_encrypted, is_readonly, storage_quota, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`, req.Name, mountPath, req.BackendType, encryptedConfig, req.IsReadonly, req.Quota, claims.UserID).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return RespondError(c, ErrAlreadyExists("Mount path already in use"))
		}
		return RespondError(c, ErrOperationFailed("create external storage", err))
	}

	// Audit log
	_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "external_storage.create", mountPath, map[string]interface{}{
		"name":        req.Name,
		"backendType": req.BackendType,
		"storageId":   id,
	})

	return RespondCreated(c, map[string]interface{}{
		"id":        id,
		"name":      req.Name,
		"mountPath": mountPath,
	})
}

// ListExternalStorages returns all external storages (admin)
func (h *ExternalStorageHandler) ListExternalStorages(c echo.Context) error {
	_, err := RequireAdmin(c)
	if err != nil {
		return RespondError(c, ErrUnauthorized("Admin access required"))
	}

	rows, err := h.db.Query(`
		SELECT id, name, mount_path, backend_type, status, COALESCE(status_message, ''),
			   last_checked_at, storage_used, storage_quota, COALESCE(created_by::text, ''),
			   created_at, updated_at, is_readonly
		FROM external_storages
		ORDER BY name ASC
	`)
	if err != nil {
		return RespondError(c, ErrOperationFailed("list external storages", err))
	}
	defer rows.Close()

	storages := make([]ExternalStorage, 0)
	for rows.Next() {
		var s ExternalStorage
		var lastChecked sql.NullTime
		if err := rows.Scan(&s.ID, &s.Name, &s.MountPath, &s.BackendType, &s.Status,
			&s.StatusMessage, &lastChecked, &s.StorageUsed, &s.StorageQuota,
			&s.CreatedBy, &s.CreatedAt, &s.UpdatedAt, &s.IsReadonly); err != nil {
			continue
		}
		if lastChecked.Valid {
			t := lastChecked.Time.Format(time.RFC3339)
			s.LastCheckedAt = &t
		}
		storages = append(storages, s)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"storages": storages,
		"total":    len(storages),
	})
}

// GetExternalStorage returns a single external storage detail (admin)
func (h *ExternalStorageHandler) GetExternalStorage(c echo.Context) error {
	_, err := RequireAdmin(c)
	if err != nil {
		return RespondError(c, ErrUnauthorized("Admin access required"))
	}

	id := c.Param("id")
	if id == "" {
		return RespondError(c, ErrMissingParameter("id"))
	}

	var s ExternalStorage
	var lastChecked sql.NullTime
	var configEncrypted string

	err = h.db.QueryRow(`
		SELECT id, name, mount_path, backend_type, config_encrypted, status, COALESCE(status_message, ''),
			   last_checked_at, storage_used, storage_quota, COALESCE(created_by::text, ''),
			   created_at, updated_at, is_readonly
		FROM external_storages WHERE id = $1
	`, id).Scan(&s.ID, &s.Name, &s.MountPath, &s.BackendType, &configEncrypted,
		&s.Status, &s.StatusMessage, &lastChecked, &s.StorageUsed, &s.StorageQuota,
		&s.CreatedBy, &s.CreatedAt, &s.UpdatedAt, &s.IsReadonly)
	if err != nil {
		if err == sql.ErrNoRows {
			return RespondError(c, ErrNotFound("External storage"))
		}
		return RespondError(c, ErrOperationFailed("get external storage", err))
	}
	if lastChecked.Valid {
		t := lastChecked.Time.Format(time.RFC3339)
		s.LastCheckedAt = &t
	}

	// Decrypt config and mask sensitive fields
	maskedConfig := maskConfig(configEncrypted, s.BackendType)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"storage": s,
		"config":  maskedConfig,
	})
}

// UpdateExternalStorage updates an external storage
func (h *ExternalStorageHandler) UpdateExternalStorage(c echo.Context) error {
	claims, err := RequireAdmin(c)
	if err != nil {
		return RespondError(c, ErrUnauthorized("Admin access required"))
	}

	id := c.Param("id")
	if id == "" {
		return RespondError(c, ErrMissingParameter("id"))
	}

	var req struct {
		Name       *string          `json:"name"`
		Config     *json.RawMessage `json:"config"`
		IsReadonly *bool            `json:"isReadonly"`
		Quota      *int64           `json:"storageQuota"`
		Status     *string          `json:"status"`
	}
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	// Get existing record
	var backendType string
	err = h.db.QueryRow(`SELECT backend_type FROM external_storages WHERE id = $1`, id).Scan(&backendType)
	if err != nil {
		if err == sql.ErrNoRows {
			return RespondError(c, ErrNotFound("External storage"))
		}
		return RespondError(c, ErrOperationFailed("get external storage", err))
	}

	// Build update query dynamically
	updates := []string{"updated_at = NOW()"}
	args := []interface{}{}
	argIdx := 1

	if req.Name != nil {
		updates = append(updates, fmt.Sprintf("name = $%d", argIdx))
		args = append(args, *req.Name)
		argIdx++
	}
	if req.IsReadonly != nil {
		updates = append(updates, fmt.Sprintf("is_readonly = $%d", argIdx))
		args = append(args, *req.IsReadonly)
		argIdx++
	}
	if req.Quota != nil {
		updates = append(updates, fmt.Sprintf("storage_quota = $%d", argIdx))
		args = append(args, *req.Quota)
		argIdx++
	}
	if req.Status != nil {
		updates = append(updates, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, *req.Status)
		argIdx++
	}
	if req.Config != nil {
		if err := validateExternalStorageConfig(backendType, *req.Config); err != nil {
			return RespondError(c, ErrBadRequest(err.Error()))
		}
		encrypted, err := EncryptAESGCM(*req.Config, getStorageEncryptionKey())
		if err != nil {
			return RespondError(c, ErrInternal("Failed to encrypt configuration"))
		}
		updates = append(updates, fmt.Sprintf("config_encrypted = $%d", argIdx))
		args = append(args, encrypted)
		argIdx++
	}

	args = append(args, id)
	query := fmt.Sprintf("UPDATE external_storages SET %s WHERE id = $%d", strings.Join(updates, ", "), argIdx)
	_, err = h.db.Exec(query, args...)
	if err != nil {
		return RespondError(c, ErrOperationFailed("update external storage", err))
	}

	_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "external_storage.update", id, nil)

	return RespondSuccess(c, map[string]string{"id": id})
}

// DeleteExternalStorage deletes an external storage
func (h *ExternalStorageHandler) DeleteExternalStorage(c echo.Context) error {
	claims, err := RequireAdmin(c)
	if err != nil {
		return RespondError(c, ErrUnauthorized("Admin access required"))
	}

	id := c.Param("id")
	if id == "" {
		return RespondError(c, ErrMissingParameter("id"))
	}

	var mountPath string
	err = h.db.QueryRow(`SELECT mount_path FROM external_storages WHERE id = $1`, id).Scan(&mountPath)
	if err != nil {
		if err == sql.ErrNoRows {
			return RespondError(c, ErrNotFound("External storage"))
		}
		return RespondError(c, ErrOperationFailed("get external storage", err))
	}

	_, err = h.db.Exec(`DELETE FROM external_storages WHERE id = $1`, id)
	if err != nil {
		return RespondError(c, ErrOperationFailed("delete external storage", err))
	}

	_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "external_storage.delete", mountPath, nil)

	return RespondSuccess(c, map[string]string{"id": id})
}

// TestExternalStorage tests the connection to an external storage
func (h *ExternalStorageHandler) TestExternalStorage(c echo.Context) error {
	_, err := RequireAdmin(c)
	if err != nil {
		return RespondError(c, ErrUnauthorized("Admin access required"))
	}

	id := c.Param("id")
	if id == "" {
		return RespondError(c, ErrMissingParameter("id"))
	}

	var backendType, configEncrypted string
	err = h.db.QueryRow(`SELECT backend_type, config_encrypted FROM external_storages WHERE id = $1`, id).
		Scan(&backendType, &configEncrypted)
	if err != nil {
		if err == sql.ErrNoRows {
			return RespondError(c, ErrNotFound("External storage"))
		}
		return RespondError(c, ErrOperationFailed("get external storage", err))
	}

	// Decrypt config
	configJSON, err := DecryptAESGCM(configEncrypted, getStorageEncryptionKey())
	if err != nil {
		return RespondError(c, ErrInternal("Failed to decrypt configuration"))
	}

	// Test connection
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	start := time.Now()
	var testErr error

	switch backendType {
	case "s3":
		var cfg S3Config
		if err := json.Unmarshal(configJSON, &cfg); err != nil {
			testErr = fmt.Errorf("invalid config: %w", err)
			break
		}
		backend, err := NewS3Backend(cfg)
		if err != nil {
			testErr = err
			break
		}
		testErr = backend.TestConnection(ctx)

	case "local-mount":
		var cfg struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(configJSON, &cfg); err != nil {
			testErr = fmt.Errorf("invalid config: %w", err)
			break
		}
		info, err := os.Stat(cfg.Path)
		if err != nil {
			testErr = fmt.Errorf("path not accessible: %w", err)
			break
		}
		if !info.IsDir() {
			testErr = fmt.Errorf("path is not a directory")
			break
		}
		// Try reading the directory
		_, err = os.ReadDir(cfg.Path)
		if err != nil {
			testErr = fmt.Errorf("cannot read directory: %w", err)
		}

	default:
		testErr = fmt.Errorf("unknown backend type: %s", backendType)
	}

	latency := time.Since(start).Milliseconds()

	// Update status in DB
	status := "active"
	statusMsg := ""
	if testErr != nil {
		status = "error"
		statusMsg = testErr.Error()
	}
	_, _ = h.db.Exec(`
		UPDATE external_storages SET status = $1, status_message = $2, last_checked_at = NOW()
		WHERE id = $3
	`, status, statusMsg, id)

	if testErr != nil {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"success":   false,
			"error":     testErr.Error(),
			"latencyMs": latency,
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":   true,
		"latencyMs": latency,
	})
}

// ListExternalStorageAccess returns access list for an external storage
func (h *ExternalStorageHandler) ListExternalStorageAccess(c echo.Context) error {
	_, err := RequireAdmin(c)
	if err != nil {
		return RespondError(c, ErrUnauthorized("Admin access required"))
	}

	id := c.Param("id")
	rows, err := h.db.Query(`
		SELECT esa.id, esa.external_storage_id, esa.user_id, esa.permission_level,
			   COALESCE(esa.granted_by::text, ''), esa.created_at,
			   u.username, COALESCE(g.username, '')
		FROM external_storage_access esa
		JOIN users u ON u.id = esa.user_id
		LEFT JOIN users g ON g.id = esa.granted_by
		WHERE esa.external_storage_id = $1
		ORDER BY u.username
	`, id)
	if err != nil {
		return RespondError(c, ErrOperationFailed("list access", err))
	}
	defer rows.Close()

	access := make([]ExternalStorageAccess, 0)
	for rows.Next() {
		var a ExternalStorageAccess
		if err := rows.Scan(&a.ID, &a.ExternalStorageID, &a.UserID, &a.PermissionLevel,
			&a.GrantedBy, &a.CreatedAt, &a.Username, &a.GrantedByUsername); err != nil {
			continue
		}
		access = append(access, a)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"access": access,
		"total":  len(access),
	})
}

// GrantExternalStorageAccess grants access to an external storage
func (h *ExternalStorageHandler) GrantExternalStorageAccess(c echo.Context) error {
	claims, err := RequireAdmin(c)
	if err != nil {
		return RespondError(c, ErrUnauthorized("Admin access required"))
	}

	id := c.Param("id")
	var req struct {
		UserID          string `json:"userId"`
		PermissionLevel int    `json:"permissionLevel"`
	}
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}
	if req.UserID == "" {
		return RespondError(c, ErrMissingParameter("userId"))
	}
	if req.PermissionLevel < 1 || req.PermissionLevel > 2 {
		req.PermissionLevel = 1
	}

	_, err = h.db.Exec(`
		INSERT INTO external_storage_access (external_storage_id, user_id, permission_level, granted_by)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (external_storage_id, user_id) DO UPDATE SET permission_level = $3
	`, id, req.UserID, req.PermissionLevel, claims.UserID)
	if err != nil {
		return RespondError(c, ErrOperationFailed("grant access", err))
	}

	return RespondSuccess(c, map[string]string{"userId": req.UserID})
}

// UpdateExternalStorageAccess updates user permission
func (h *ExternalStorageHandler) UpdateExternalStorageAccess(c echo.Context) error {
	_, err := RequireAdmin(c)
	if err != nil {
		return RespondError(c, ErrUnauthorized("Admin access required"))
	}

	id := c.Param("id")
	userID := c.Param("userId")

	var req struct {
		PermissionLevel int `json:"permissionLevel"`
	}
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}
	if req.PermissionLevel < 1 || req.PermissionLevel > 2 {
		return RespondError(c, ErrBadRequest("Permission level must be 1 or 2"))
	}

	result, err := h.db.Exec(`
		UPDATE external_storage_access SET permission_level = $1
		WHERE external_storage_id = $2 AND user_id = $3
	`, req.PermissionLevel, id, userID)
	if err != nil {
		return RespondError(c, ErrOperationFailed("update access", err))
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return RespondError(c, ErrNotFound("Access entry"))
	}

	return RespondSuccess(c, nil)
}

// RevokeExternalStorageAccess removes user access
func (h *ExternalStorageHandler) RevokeExternalStorageAccess(c echo.Context) error {
	_, err := RequireAdmin(c)
	if err != nil {
		return RespondError(c, ErrUnauthorized("Admin access required"))
	}

	id := c.Param("id")
	userID := c.Param("userId")

	_, err = h.db.Exec(`
		DELETE FROM external_storage_access WHERE external_storage_id = $1 AND user_id = $2
	`, id, userID)
	if err != nil {
		return RespondError(c, ErrOperationFailed("revoke access", err))
	}

	return RespondSuccess(c, nil)
}

// ListMyExternalStorages returns external storages accessible by the current user
func (h *ExternalStorageHandler) ListMyExternalStorages(c echo.Context) error {
	claims := GetClaims(c)
	if claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	rows, err := h.db.Query(`
		SELECT es.id, es.name, es.mount_path, es.backend_type, es.status,
			   COALESCE(es.status_message, ''), es.storage_used, es.storage_quota,
			   es.is_readonly, esa.permission_level
		FROM external_storages es
		JOIN external_storage_access esa ON esa.external_storage_id = es.id
		WHERE esa.user_id = $1 AND es.status = 'active'
		ORDER BY es.name
	`, claims.UserID)
	if err != nil {
		return RespondError(c, ErrOperationFailed("list storages", err))
	}
	defer rows.Close()

	type UserExternalStorage struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		MountPath       string `json:"mountPath"`
		BackendType     string `json:"backendType"`
		Status          string `json:"status"`
		StatusMessage   string `json:"statusMessage,omitempty"`
		StorageUsed     int64  `json:"storageUsed"`
		StorageQuota    int64  `json:"storageQuota"`
		IsReadonly      bool   `json:"isReadonly"`
		PermissionLevel int    `json:"permissionLevel"`
	}

	storages := make([]UserExternalStorage, 0)
	for rows.Next() {
		var s UserExternalStorage
		if err := rows.Scan(&s.ID, &s.Name, &s.MountPath, &s.BackendType, &s.Status,
			&s.StatusMessage, &s.StorageUsed, &s.StorageQuota, &s.IsReadonly,
			&s.PermissionLevel); err != nil {
			continue
		}
		storages = append(storages, s)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"storages": storages,
		"total":    len(storages),
	})
}

// validateExternalStorageConfig validates config JSON by backend type
func validateExternalStorageConfig(backendType string, config json.RawMessage) error {
	switch backendType {
	case "s3":
		var cfg S3Config
		if err := json.Unmarshal(config, &cfg); err != nil {
			return fmt.Errorf("invalid S3 config: %w", err)
		}
		if cfg.Bucket == "" {
			return fmt.Errorf("S3 bucket is required")
		}
		if cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" {
			return fmt.Errorf("S3 access key and secret key are required")
		}
	case "local-mount":
		var cfg struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(config, &cfg); err != nil {
			return fmt.Errorf("invalid local-mount config: %w", err)
		}
		if cfg.Path == "" {
			return fmt.Errorf("local mount path is required")
		}
		if strings.Contains(cfg.Path, "..") {
			return fmt.Errorf("path must not contain '..'")
		}
	default:
		return fmt.Errorf("unknown backend type: %s", backendType)
	}
	return nil
}

// maskConfig decrypts config and masks sensitive fields
func maskConfig(configEncrypted, backendType string) map[string]interface{} {
	result := make(map[string]interface{})

	configJSON, err := DecryptAESGCM(configEncrypted, getStorageEncryptionKey())
	if err != nil {
		result["error"] = "Failed to decrypt"
		return result
	}

	if err := json.Unmarshal(configJSON, &result); err != nil {
		result["error"] = "Failed to parse"
		return result
	}

	// Mask sensitive fields for S3
	if backendType == "s3" {
		if _, ok := result["secret_access_key"]; ok {
			val := fmt.Sprintf("%v", result["secret_access_key"])
			if len(val) > 4 {
				result["secret_access_key"] = "****" + val[len(val)-4:]
			} else {
				result["secret_access_key"] = "****"
			}
		}
		if _, ok := result["access_key_id"]; ok {
			val := fmt.Sprintf("%v", result["access_key_id"])
			if len(val) > 4 {
				result["access_key_id"] = val[:4] + "****"
			}
		}
	}

	return result
}
