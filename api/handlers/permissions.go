package handlers

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"
)

// PermissionNone represents no access (extending shared_folder_handler.go constants)
const PermissionNone = 0

// PermissionRead is an alias for PermissionReadOnly for semantic clarity
const PermissionRead = PermissionReadOnly

// ACLResult represents the result of an ACL check
type ACLResult struct {
	Allowed         bool
	PermissionLevel int
	FolderID        string
	FolderName      string
	Reason          string
}

// PermissionChecker provides ACL verification for file access
type PermissionChecker struct {
	db *sql.DB
}

// NewPermissionChecker creates a new PermissionChecker
func NewPermissionChecker(db *sql.DB) *PermissionChecker {
	return &PermissionChecker{db: db}
}

// CheckSharedFolderAccess checks if a user has access to a shared folder
// folderName is the name of the shared folder (first component after /shared/)
// Returns ACL result with permission level
// Results are cached for 5 minutes to reduce database load
func (p *PermissionChecker) CheckSharedFolderAccess(userID string, folderName string) (*ACLResult, error) {
	if userID == "" {
		return &ACLResult{
			Allowed: false,
			Reason:  "authentication required",
		}, nil
	}

	if folderName == "" {
		// Listing /shared root - allowed for all authenticated users
		return &ACLResult{
			Allowed:         true,
			PermissionLevel: PermissionRead,
			Reason:          "shared root listing",
		}, nil
	}

	// Check cache first
	cache := GetPermissionCache()
	if cache != nil {
		if cached, ok := cache.GetFolderAccess(userID, folderName); ok {
			return &ACLResult{
				Allowed:         cached.Allowed,
				PermissionLevel: cached.PermissionLevel,
				FolderID:        cached.FolderID,
				FolderName:      cached.FolderName,
				Reason:          cached.Reason,
			}, nil
		}
	}

	// Query for user's permission on the shared folder
	var folderID string
	var permissionLevel int
	err := p.db.QueryRow(`
		SELECT sf.id, sfm.permission_level
		FROM shared_folders sf
		INNER JOIN shared_folder_members sfm ON sf.id = sfm.shared_folder_id
		WHERE sf.name = $1 AND sfm.user_id = $2 AND sf.is_active = TRUE
	`, folderName, userID).Scan(&folderID, &permissionLevel)

	var result *ACLResult
	if err == sql.ErrNoRows {
		result = &ACLResult{
			Allowed:    false,
			FolderName: folderName,
			Reason:     fmt.Sprintf("no access to shared folder: %s", folderName),
		}
	} else if err != nil {
		return nil, fmt.Errorf("failed to check folder access: %w", err)
	} else {
		result = &ACLResult{
			Allowed:         true,
			PermissionLevel: permissionLevel,
			FolderID:        folderID,
			FolderName:      folderName,
			Reason:          "member of shared folder",
		}
	}

	// Cache the result
	if cache != nil {
		cache.SetFolderAccess(userID, folderName, result)
	}

	return result, nil
}

// CheckSharedFolderWriteAccess checks if user has write permission to shared folder
func (p *PermissionChecker) CheckSharedFolderWriteAccess(userID string, folderName string) (*ACLResult, error) {
	result, err := p.CheckSharedFolderAccess(userID, folderName)
	if err != nil {
		return nil, err
	}

	if !result.Allowed {
		return result, nil
	}

	if result.PermissionLevel < PermissionReadWrite {
		return &ACLResult{
			Allowed:         false,
			PermissionLevel: result.PermissionLevel,
			FolderID:        result.FolderID,
			FolderName:      result.FolderName,
			Reason:          "read-only access to shared folder",
		}, nil
	}

	return result, nil
}

// ExtractSharedFolderName extracts the shared folder name from a path
// e.g., "/shared/TeamDocs/subfolder/file.txt" -> "TeamDocs"
func ExtractSharedFolderName(virtualPath string) string {
	cleanPath := strings.TrimPrefix(virtualPath, "/")
	parts := strings.SplitN(cleanPath, "/", 3)
	if len(parts) < 2 || parts[0] != "shared" {
		return ""
	}
	return parts[1]
}

// CheckFileShareAccess checks if a user has access to a file shared with them
func (p *PermissionChecker) CheckFileShareAccess(userID string, filePath string) (*ACLResult, error) {
	if userID == "" {
		return &ACLResult{
			Allowed: false,
			Reason:  "authentication required",
		}, nil
	}

	var shareID string
	var permissionLevel int
	err := p.db.QueryRow(`
		SELECT id, permission_level
		FROM file_shares
		WHERE shared_with_id = $1
		AND file_path = $2
		AND (expires_at IS NULL OR expires_at > NOW())
	`, userID, filePath).Scan(&shareID, &permissionLevel)

	if err == sql.ErrNoRows {
		return &ACLResult{
			Allowed: false,
			Reason:  "no file share access",
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to check file share: %w", err)
	}

	return &ACLResult{
		Allowed:         true,
		PermissionLevel: permissionLevel,
		FolderID:        shareID,
		Reason:          "file shared with user",
	}, nil
}

// RequireSharedFolderAccess middleware ensures user has access to shared folder
func (p *PermissionChecker) RequireSharedFolderAccess(readOnly bool) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			claims := GetClaims(c)
			if claims == nil {
				return RespondError(c, ErrUnauthorized("authentication required"))
			}

			// Get path from query param or URL param
			requestPath := c.QueryParam("path")
			if requestPath == "" {
				requestPath = c.Param("*")
			}
			if requestPath == "" {
				return next(c)
			}

			// Only check for shared folder paths
			if !strings.HasPrefix(requestPath, "/shared/") && !strings.HasPrefix(requestPath, "shared/") {
				return next(c)
			}

			folderName := ExtractSharedFolderName(requestPath)
			if folderName == "" {
				return next(c)
			}

			var result *ACLResult
			var err error

			if readOnly {
				result, err = p.CheckSharedFolderAccess(claims.UserID, folderName)
			} else {
				result, err = p.CheckSharedFolderWriteAccess(claims.UserID, folderName)
			}

			if err != nil {
				LogError("ACL check failed", err, "path", requestPath, "user", claims.Username)
				return RespondError(c, ErrOperationFailed("check permissions", err))
			}

			if !result.Allowed {
				LogWarn("ACL denied", "path", requestPath, "user", claims.Username, "reason", result.Reason)
				return RespondError(c, ErrForbidden(result.Reason))
			}

			// Store ACL result in context for later use
			c.Set("aclResult", result)
			return next(c)
		}
	}
}

// GetACLResult retrieves the ACL result from context
func GetACLResult(c echo.Context) *ACLResult {
	if result, ok := c.Get("aclResult").(*ACLResult); ok {
		return result
	}
	return nil
}

// resolvePathWithACL extends resolvePath with ACL checks
func (h *Handler) resolvePathWithACL(virtualPath string, claims *JWTClaims, requireWrite bool) (realPath string, storageType string, displayPath string, acl *ACLResult, err error) {
	// First, resolve the path normally
	realPath, storageType, displayPath, err = h.resolvePath(virtualPath, claims)
	if err != nil {
		return "", "", "", nil, err
	}

	// If it's a shared folder, check ACL
	if storageType == StorageShared {
		folderName := ExtractSharedFolderName(virtualPath)
		if folderName != "" && claims != nil {
			checker := NewPermissionChecker(h.db)
			if requireWrite {
				acl, err = checker.CheckSharedFolderWriteAccess(claims.UserID, folderName)
			} else {
				acl, err = checker.CheckSharedFolderAccess(claims.UserID, folderName)
			}
			if err != nil {
				return "", "", "", nil, err
			}
			if !acl.Allowed {
				return "", "", "", acl, fmt.Errorf("access denied: %s", acl.Reason)
			}
		}
	}

	return realPath, storageType, displayPath, acl, nil
}

// CanAccessPath checks if user can access a given path (read-only)
func (h *Handler) CanAccessPath(virtualPath string, claims *JWTClaims) bool {
	_, _, _, _, err := h.resolvePathWithACL(virtualPath, claims, false)
	return err == nil
}

// CanWritePath checks if user can write to a given path
func (h *Handler) CanWritePath(virtualPath string, claims *JWTClaims) bool {
	_, _, _, _, err := h.resolvePathWithACL(virtualPath, claims, true)
	return err == nil
}

// ListAccessibleSharedFolders returns list of shared folders user can access
// Results are cached for 5 minutes to reduce database load
func (p *PermissionChecker) ListAccessibleSharedFolders(userID string) ([]string, error) {
	if userID == "" {
		return nil, nil
	}

	// Check cache first
	cache := GetPermissionCache()
	if cache != nil {
		if folders, ok := cache.GetFolderList(userID); ok {
			return folders, nil
		}
	}

	rows, err := p.db.Query(`
		SELECT sf.name
		FROM shared_folders sf
		INNER JOIN shared_folder_members sfm ON sf.id = sfm.shared_folder_id
		WHERE sfm.user_id = $1 AND sf.is_active = TRUE
		ORDER BY sf.name
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to list shared folders: %w", err)
	}
	defer rows.Close()

	var folders []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		folders = append(folders, name)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Cache the result
	if cache != nil {
		cache.SetFolderList(userID, folders)
	}

	return folders, nil
}

// FilterAccessiblePaths filters a list of paths to only those user can access
func (h *Handler) FilterAccessiblePaths(paths []string, claims *JWTClaims) []string {
	if claims == nil {
		return nil
	}

	// Cache accessible shared folders
	checker := NewPermissionChecker(h.db)
	accessibleFolders, _ := checker.ListAccessibleSharedFolders(claims.UserID)
	folderSet := make(map[string]bool)
	for _, f := range accessibleFolders {
		folderSet[f] = true
	}

	var accessible []string
	for _, path := range paths {
		// Check if it's a shared folder path
		if strings.HasPrefix(path, "/shared/") {
			folderName := ExtractSharedFolderName(path)
			if folderName != "" && !folderSet[folderName] {
				continue // Skip inaccessible shared folder
			}
		}
		accessible = append(accessible, path)
	}

	return accessible
}

// AuditAccessAttempt logs an access attempt for security auditing
func (p *PermissionChecker) AuditAccessAttempt(userID, username, path string, allowed bool, reason string, ipAddr string) {
	details := map[string]interface{}{
		"path":    path,
		"allowed": allowed,
		"reason":  reason,
	}

	eventType := "file.access"
	if !allowed {
		eventType = "file.access_denied"
	}

	// Use the logger instead of direct DB insert for efficiency
	if allowed {
		LogInfo("File access", "user", username, "path", path)
	} else {
		LogWarn("Access denied", "user", username, "path", path, "reason", reason)
	}

	// For denied access, also log to audit table
	if !allowed {
		query := `
			INSERT INTO audit_logs (actor_id, event_type, target_resource, ip_addr, details)
			VALUES ($1, $2, $3, $4::inet, $5)
		`
		_, _ = p.db.Exec(query, userID, eventType, path, ipAddr, details)
	}
}

// ValidatePathOwnership checks if the user owns or has access to a path
func (h *Handler) ValidatePathOwnership(virtualPath string, claims *JWTClaims) error {
	if claims == nil {
		return fmt.Errorf("authentication required")
	}

	cleanPath := strings.TrimPrefix(virtualPath, "/")
	parts := strings.SplitN(cleanPath, "/", 3)
	if len(parts) == 0 {
		return fmt.Errorf("invalid path")
	}

	switch parts[0] {
	case "home":
		// Home folder - user can only access their own
		if len(parts) > 1 {
			// Check if accessing own home folder
			expectedUser := claims.Username
			if !strings.HasPrefix(cleanPath, "home/"+expectedUser+"/") && cleanPath != "home/"+expectedUser {
				// Check if admin and accessing other user's folder
				if !claims.IsAdmin {
					return fmt.Errorf("cannot access other user's home folder")
				}
			}
		}
		return nil

	case "shared":
		if len(parts) > 1 {
			folderName := parts[1]
			checker := NewPermissionChecker(h.db)
			result, err := checker.CheckSharedFolderAccess(claims.UserID, folderName)
			if err != nil {
				return err
			}
			if !result.Allowed {
				return fmt.Errorf("no access to shared folder: %s", folderName)
			}
		}
		return nil

	default:
		return fmt.Errorf("invalid storage type: %s", parts[0])
	}
}

// GetEffectivePermission returns the effective permission level for a path
func (h *Handler) GetEffectivePermission(virtualPath string, claims *JWTClaims) int {
	if claims == nil {
		return PermissionNone
	}

	cleanPath := strings.TrimPrefix(virtualPath, "/")
	parts := strings.SplitN(cleanPath, "/", 3)
	if len(parts) == 0 {
		return PermissionNone
	}

	switch parts[0] {
	case "home":
		// Full access to own home folder
		if len(parts) == 1 || strings.HasPrefix(cleanPath, "home/"+claims.Username) {
			return PermissionReadWrite
		}
		// Admin has full access to all home folders
		if claims.IsAdmin {
			return PermissionReadWrite
		}
		return PermissionNone

	case "shared":
		if len(parts) > 1 {
			folderName := parts[1]
			checker := NewPermissionChecker(h.db)
			result, err := checker.CheckSharedFolderAccess(claims.UserID, folderName)
			if err != nil || !result.Allowed {
				return PermissionNone
			}
			return result.PermissionLevel
		}
		return PermissionRead // Can list shared folders root

	default:
		return PermissionNone
	}
}

// BuildSharedFolderPath constructs a safe filesystem path for shared folder access
func BuildSharedFolderPath(dataRoot, folderName, subPath string) (string, error) {
	// Sanitize folder name
	safeFolderName := filepath.Clean(folderName)
	if strings.Contains(safeFolderName, "..") || strings.ContainsRune(safeFolderName, filepath.Separator) {
		return "", fmt.Errorf("invalid folder name")
	}

	basePath := filepath.Join(dataRoot, "shared", safeFolderName)

	if subPath == "" {
		return basePath, nil
	}

	// Clean and validate subpath
	cleanSubPath := filepath.Clean(subPath)
	if strings.HasPrefix(cleanSubPath, "..") {
		return "", fmt.Errorf("path traversal not allowed")
	}

	fullPath := filepath.Join(basePath, cleanSubPath)

	// Final validation - ensure path is within shared folder
	if !strings.HasPrefix(fullPath, basePath) {
		return "", fmt.Errorf("path escapes shared folder")
	}

	return fullPath, nil
}
