package handlers

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// Permission levels for shared folders
const (
	PermissionReadOnly  = 1
	PermissionReadWrite = 2
)

// SharedFolder represents a shared folder/team drive
type SharedFolder struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Description  string    `json:"description"`
	StorageQuota int64     `json:"storageQuota"` // 0 = unlimited
	CreatedBy    string    `json:"createdBy"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	IsActive     bool      `json:"isActive"`
	// Additional fields for display
	CreatorUsername string `json:"creatorUsername,omitempty"`
	UsedStorage     int64  `json:"usedStorage,omitempty"`
	MemberCount     int    `json:"memberCount,omitempty"`
}

// SharedFolderMember represents a user's access to a shared folder
type SharedFolderMember struct {
	ID              int64     `json:"id"`
	SharedFolderID  string    `json:"sharedFolderId"`
	UserID          string    `json:"userId"`
	PermissionLevel int       `json:"permissionLevel"` // 1=read, 2=read-write
	AddedBy         string    `json:"addedBy"`
	CreatedAt       time.Time `json:"createdAt"`
	// Additional fields for display
	Username         string `json:"username,omitempty"`
	AddedByUsername  string `json:"addedByUsername,omitempty"`
}

// SharedFolderWithPermission combines folder info with user's permission
type SharedFolderWithPermission struct {
	SharedFolder
	PermissionLevel int `json:"permissionLevel"`
}

// SharedFolderHandler handles shared folder operations
type SharedFolderHandler struct {
	db                  *sql.DB
	dataRoot            string
	auditHandler        *AuditHandler
	notificationService *NotificationService
}

// NewSharedFolderHandler creates a new SharedFolderHandler
func NewSharedFolderHandler(db *sql.DB, dataRoot string, notificationService *NotificationService) *SharedFolderHandler {
	return &SharedFolderHandler{
		db:                  db,
		dataRoot:            dataRoot,
		auditHandler:        NewAuditHandler(db, dataRoot),
		notificationService: notificationService,
	}
}

// GetSharedFoldersDir returns the directory for shared folders
func (h *SharedFolderHandler) GetSharedFoldersDir() string {
	return filepath.Join(h.dataRoot, "shared")
}

// EnsureSharedFolderDir creates the directory for a shared folder by name
// The directory is created with 0775 permissions and 'users' group ownership
// to allow SMB users in the 'users' group to write to it
func (h *SharedFolderHandler) EnsureSharedFolderDir(folderName string) error {
	// Sanitize folder name for filesystem
	safeName := sanitizeFolderName(folderName)
	dir := filepath.Join(h.GetSharedFoldersDir(), safeName)

	// Create directory with group-writable permissions (775)
	if err := os.MkdirAll(dir, 0775); err != nil {
		return err
	}

	// Set group ownership to 'users' (GID 100 on Alpine/Debian)
	// This allows SMB users in the 'users' group to write to the directory
	// Use 'users' group which is typically GID 100
	if err := os.Chown(dir, -1, 100); err != nil {
		// Log but don't fail - permissions might still work
		fmt.Printf("Warning: Failed to set group ownership for %s: %v\n", dir, err)
	}

	return nil
}

// GetFolderPath returns the filesystem path for a shared folder
func (h *SharedFolderHandler) GetFolderPath(folderName string) string {
	safeName := sanitizeFolderName(folderName)
	return filepath.Join(h.GetSharedFoldersDir(), safeName)
}

// GetFolderStorageUsage calculates storage usage for a shared folder by name
func (h *SharedFolderHandler) GetFolderStorageUsage(folderName string) (int64, error) {
	dir := h.GetFolderPath(folderName)
	var size int64
	err := filepath.Walk(dir, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}
		if !info.IsDir() {
			size += info.Size()
		}
		return nil
	})
	return size, err
}

// sanitizeFolderName makes a folder name safe for filesystem use
func sanitizeFolderName(name string) string {
	// Replace problematic characters
	replacer := strings.NewReplacer(
		"/", "_",
		"\\", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
	)
	return strings.TrimSpace(replacer.Replace(name))
}

// --- User API ---

// ListMySharedFolders returns shared folders the current user has access to
// @Summary		List my shared folders
// @Description	Get list of shared folders the current user has access to
// @Tags		SharedFolders
// @Accept		json
// @Produce		json
// @Success		200		{object}	docs.SuccessResponse{data=[]SharedFolderWithPermission}	"List of shared folders"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/shared-folders/my [get]
func (h *SharedFolderHandler) ListMySharedFolders(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	query := `
		SELECT sf.id, sf.name, sf.description, sf.storage_quota, sf.created_by,
		       sf.created_at, sf.updated_at, sf.is_active, sf.storage_used, sfm.permission_level
		FROM shared_folders sf
		INNER JOIN shared_folder_members sfm ON sf.id = sfm.shared_folder_id
		WHERE sfm.user_id = $1 AND sf.is_active = TRUE
		ORDER BY sf.name ASC
	`

	rows, err := h.db.Query(query, claims.UserID)
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}
	defer rows.Close()

	folders := []SharedFolderWithPermission{}
	for rows.Next() {
		var f SharedFolderWithPermission
		var createdBy sql.NullString
		if scanErr := rows.Scan(
			&f.ID, &f.Name, &f.Description, &f.StorageQuota, &createdBy,
			&f.CreatedAt, &f.UpdatedAt, &f.IsActive, &f.UsedStorage, &f.PermissionLevel,
		); scanErr != nil {
			continue
		}
		if createdBy.Valid {
			f.CreatedBy = createdBy.String
		}
		folders = append(folders, f)
	}

	return RespondSuccess(c, map[string]interface{}{
		"folders": folders,
		"total":   len(folders),
	})
}

// GetMyPermission returns the current user's permission level for a shared folder
func (h *SharedFolderHandler) GetMyPermission(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	folderID := c.Param("id")
	if folderID == "" {
		return RespondError(c, ErrMissingParameter("folder ID"))
	}

	var permissionLevel int
	queryErr := h.db.QueryRow(`
		SELECT sfm.permission_level
		FROM shared_folder_members sfm
		INNER JOIN shared_folders sf ON sf.id = sfm.shared_folder_id
		WHERE sfm.shared_folder_id = $1 AND sfm.user_id = $2 AND sf.is_active = TRUE
	`, folderID, claims.UserID).Scan(&permissionLevel)

	if queryErr == sql.ErrNoRows {
		return RespondError(c, ErrForbidden("No access to this folder"))
	}
	if queryErr != nil {
		return RespondError(c, ErrInternal("Database error"))
	}

	return RespondSuccess(c, map[string]interface{}{
		"permissionLevel": permissionLevel,
		"canWrite":        permissionLevel >= PermissionReadWrite,
	})
}

// --- Admin API ---

// ListAllSharedFolders returns all shared folders (admin only)
func (h *SharedFolderHandler) ListAllSharedFolders(c echo.Context) error {
	query := `
		SELECT sf.id, sf.name, sf.description, sf.storage_quota, sf.created_by,
		       sf.created_at, sf.updated_at, sf.is_active, sf.storage_used,
		       u.username as creator_username,
			   (SELECT COUNT(*) FROM shared_folder_members WHERE shared_folder_id = sf.id) as member_count
		FROM shared_folders sf
		LEFT JOIN users u ON sf.created_by = u.id
		ORDER BY sf.created_at DESC
	`

	rows, err := h.db.Query(query)
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}
	defer rows.Close()

	folders := []SharedFolder{}
	for rows.Next() {
		var f SharedFolder
		var createdBy, creatorUsername sql.NullString
		if scanErr := rows.Scan(
			&f.ID, &f.Name, &f.Description, &f.StorageQuota, &createdBy,
			&f.CreatedAt, &f.UpdatedAt, &f.IsActive, &f.UsedStorage,
			&creatorUsername, &f.MemberCount,
		); scanErr != nil {
			continue
		}
		if createdBy.Valid {
			f.CreatedBy = createdBy.String
		}
		if creatorUsername.Valid {
			f.CreatorUsername = creatorUsername.String
		}
		folders = append(folders, f)
	}

	return RespondSuccess(c, map[string]interface{}{
		"folders": folders,
		"total":   len(folders),
	})
}

// CreateSharedFolder creates a new shared folder (admin only)
func (h *SharedFolderHandler) CreateSharedFolder(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	var req struct {
		Name         string `json:"name"`
		Description  string `json:"description"`
		StorageQuota int64  `json:"storageQuota"` // bytes, 0 = unlimited
	}
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return RespondError(c, ErrBadRequest("Name is required"))
	}

	// Check if folder with same name already exists
	var existingCount int
	h.db.QueryRow("SELECT COUNT(*) FROM shared_folders WHERE name = $1", req.Name).Scan(&existingCount)
	if existingCount > 0 {
		return RespondError(c, ErrAlreadyExists("Folder with this name"))
	}

	// Create folder in database
	var folderID string
	insertErr := h.db.QueryRow(`
		INSERT INTO shared_folders (name, description, storage_quota, created_by)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, req.Name, req.Description, req.StorageQuota, claims.UserID).Scan(&folderID)

	if insertErr != nil {
		return RespondError(c, ErrOperationFailed("create shared folder", insertErr))
	}

	// Create directory on filesystem using folder name
	if dirErr := h.EnsureSharedFolderDir(req.Name); dirErr != nil {
		// Rollback database entry
		h.db.Exec("DELETE FROM shared_folders WHERE id = $1", folderID)
		return RespondError(c, ErrOperationFailed("create folder directory", dirErr))
	}

	// Audit log
	userID := claims.UserID
	h.auditHandler.LogEvent(&userID, c.RealIP(), "shared_folder_create",
		fmt.Sprintf("/shared/%s", sanitizeFolderName(req.Name)),
		map[string]interface{}{
			"name":         req.Name,
			"storageQuota": req.StorageQuota,
		})

	return RespondCreated(c, map[string]interface{}{
		"id":      folderID,
		"name":    req.Name,
		"message": "Shared folder created successfully",
	})
}

// UpdateSharedFolder updates a shared folder (admin only)
func (h *SharedFolderHandler) UpdateSharedFolder(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	folderID := c.Param("id")
	if folderID == "" {
		return RespondError(c, ErrMissingParameter("folder ID"))
	}

	var req struct {
		Name         string `json:"name"`
		Description  string `json:"description"`
		StorageQuota int64  `json:"storageQuota"`
		IsActive     *bool  `json:"isActive"`
	}
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return RespondError(c, ErrBadRequest("Name is required"))
	}

	query := `
		UPDATE shared_folders
		SET name = $1, description = $2, storage_quota = $3, updated_at = NOW()
	`
	args := []interface{}{req.Name, req.Description, req.StorageQuota}

	if req.IsActive != nil {
		query += ", is_active = $4 WHERE id = $5"
		args = append(args, *req.IsActive, folderID)
	} else {
		query += " WHERE id = $4"
		args = append(args, folderID)
	}

	result, updateErr := h.db.Exec(query, args...)
	if updateErr != nil {
		return RespondError(c, ErrOperationFailed("update shared folder", updateErr))
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return RespondError(c, ErrNotFound("Shared folder"))
	}

	// Audit log
	userID := claims.UserID
	h.auditHandler.LogEvent(&userID, c.RealIP(), "shared_folder_update",
		fmt.Sprintf("/shared/%s", sanitizeFolderName(req.Name)),
		map[string]interface{}{
			"name":         req.Name,
			"storageQuota": req.StorageQuota,
		})

	return RespondSuccess(c, map[string]string{"message": "Shared folder updated successfully"})
}

// DeleteSharedFolder deletes a shared folder (admin only)
func (h *SharedFolderHandler) DeleteSharedFolder(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	folderID := c.Param("id")
	if folderID == "" {
		return RespondError(c, ErrMissingParameter("folder ID"))
	}

	// Get folder name before deleting
	var folderName string
	queryErr := h.db.QueryRow("SELECT name FROM shared_folders WHERE id = $1", folderID).Scan(&folderName)
	if queryErr != nil {
		return RespondError(c, ErrNotFound("Shared folder"))
	}

	// Delete from database (cascades to members)
	_, deleteErr := h.db.Exec("DELETE FROM shared_folders WHERE id = $1", folderID)
	if deleteErr != nil {
		return RespondError(c, ErrOperationFailed("delete shared folder", deleteErr))
	}

	// Delete directory from filesystem using folder name
	folderPath := h.GetFolderPath(folderName)
	os.RemoveAll(folderPath)

	// Invalidate permission cache for this folder (all users)
	if cache := GetPermissionCache(); cache != nil {
		cache.InvalidateFolder(folderName)
	}

	// Audit log
	userID := claims.UserID
	h.auditHandler.LogEvent(&userID, c.RealIP(), "shared_folder_delete",
		fmt.Sprintf("/shared/%s", sanitizeFolderName(folderName)), nil)

	return RespondSuccess(c, map[string]string{"message": "Shared folder deleted successfully"})
}

// --- Member Management ---

// ListMembers lists all members of a shared folder (admin only)
func (h *SharedFolderHandler) ListMembers(c echo.Context) error {
	folderID := c.Param("id")
	if folderID == "" {
		return RespondError(c, ErrMissingParameter("folder ID"))
	}

	query := `
		SELECT sfm.id, sfm.shared_folder_id, sfm.user_id, sfm.permission_level,
		       sfm.added_by, sfm.created_at, u.username, au.username as added_by_username
		FROM shared_folder_members sfm
		INNER JOIN users u ON sfm.user_id = u.id
		LEFT JOIN users au ON sfm.added_by = au.id
		WHERE sfm.shared_folder_id = $1
		ORDER BY u.username ASC
	`

	rows, err := h.db.Query(query, folderID)
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}
	defer rows.Close()

	members := []SharedFolderMember{}
	for rows.Next() {
		var m SharedFolderMember
		var addedBy, addedByUsername sql.NullString
		if scanErr := rows.Scan(
			&m.ID, &m.SharedFolderID, &m.UserID, &m.PermissionLevel,
			&addedBy, &m.CreatedAt, &m.Username, &addedByUsername,
		); scanErr != nil {
			continue
		}
		if addedBy.Valid {
			m.AddedBy = addedBy.String
		}
		if addedByUsername.Valid {
			m.AddedByUsername = addedByUsername.String
		}
		members = append(members, m)
	}

	return RespondSuccess(c, map[string]interface{}{
		"members": members,
		"total":   len(members),
	})
}

// AddMember adds a user to a shared folder (admin only)
func (h *SharedFolderHandler) AddMember(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	folderID := c.Param("id")
	if folderID == "" {
		return RespondError(c, ErrMissingParameter("folder ID"))
	}

	var req struct {
		UserID          string `json:"userId"`
		PermissionLevel int    `json:"permissionLevel"` // 1=read, 2=read-write
	}
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	if req.UserID == "" {
		return RespondError(c, ErrBadRequest("User ID is required"))
	}
	if req.PermissionLevel < 1 || req.PermissionLevel > 2 {
		req.PermissionLevel = PermissionReadOnly
	}

	// Check if folder exists
	var folderExists bool
	h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM shared_folders WHERE id = $1)", folderID).Scan(&folderExists)
	if !folderExists {
		return RespondError(c, ErrNotFound("Shared folder"))
	}

	// Check if user exists
	var userExists bool
	h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)", req.UserID).Scan(&userExists)
	if !userExists {
		return RespondError(c, ErrNotFound("User"))
	}

	// Insert or update member
	_, insertErr := h.db.Exec(`
		INSERT INTO shared_folder_members (shared_folder_id, user_id, permission_level, added_by)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (shared_folder_id, user_id)
		DO UPDATE SET permission_level = EXCLUDED.permission_level
	`, folderID, req.UserID, req.PermissionLevel, claims.UserID)

	if insertErr != nil {
		return RespondError(c, ErrOperationFailed("add member", insertErr))
	}

	// Audit log - get folder name for path
	var folderName string
	h.db.QueryRow("SELECT name FROM shared_folders WHERE id = $1", folderID).Scan(&folderName)
	actorID := claims.UserID
	h.auditHandler.LogEvent(&actorID, c.RealIP(), "shared_folder_member_add",
		fmt.Sprintf("/shared/%s", sanitizeFolderName(folderName)),
		map[string]interface{}{
			"memberUserId":    req.UserID,
			"permissionLevel": req.PermissionLevel,
		})

	// Invalidate permission cache for the user
	if cache := GetPermissionCache(); cache != nil {
		cache.InvalidateUser(req.UserID)
	}

	// Send notification to the invited user
	if h.notificationService != nil {
		permLabel := "읽기"
		if req.PermissionLevel == PermissionReadWrite {
			permLabel = "읽기/쓰기"
		}
		title := "공유 폴더에 초대되었습니다"
		message := claims.Username + "님이 '" + folderName + "' 폴더에 초대했습니다 (" + permLabel + " 권한)"
		link := "/shared/" + folderID
		h.notificationService.Create(
			req.UserID,
			NotifSharedFolderInvited,
			title,
			message,
			link,
			&claims.UserID,
			map[string]interface{}{
				"folderId":        folderID,
				"folderName":      folderName,
				"permissionLevel": req.PermissionLevel,
			},
		)
	}

	return RespondSuccess(c, map[string]string{"message": "Member added successfully"})
}

// UpdateMemberPermission updates a member's permission level (admin only)
func (h *SharedFolderHandler) UpdateMemberPermission(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	folderID := c.Param("id")
	userID := c.Param("userId")
	if folderID == "" || userID == "" {
		return RespondError(c, ErrBadRequest("Folder ID and User ID required"))
	}

	var req struct {
		PermissionLevel int `json:"permissionLevel"`
	}
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	if req.PermissionLevel < 1 || req.PermissionLevel > 2 {
		return RespondError(c, ErrBadRequest("Invalid permission level"))
	}

	result, updateErr := h.db.Exec(`
		UPDATE shared_folder_members
		SET permission_level = $1
		WHERE shared_folder_id = $2 AND user_id = $3
	`, req.PermissionLevel, folderID, userID)

	if updateErr != nil {
		return RespondError(c, ErrOperationFailed("update permission", updateErr))
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return RespondError(c, ErrNotFound("Member"))
	}

	// Audit log - get folder name for path
	var folderName string
	h.db.QueryRow("SELECT name FROM shared_folders WHERE id = $1", folderID).Scan(&folderName)
	actorID := claims.UserID
	h.auditHandler.LogEvent(&actorID, c.RealIP(), "shared_folder_member_update",
		fmt.Sprintf("/shared/%s", sanitizeFolderName(folderName)),
		map[string]interface{}{
			"memberUserId":    userID,
			"permissionLevel": req.PermissionLevel,
		})

	// Invalidate permission cache for the user
	if cache := GetPermissionCache(); cache != nil {
		cache.InvalidateUser(userID)
	}

	return RespondSuccess(c, map[string]string{"message": "Permission updated successfully"})
}

// RemoveMember removes a user from a shared folder (admin only)
func (h *SharedFolderHandler) RemoveMember(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	folderID := c.Param("id")
	userID := c.Param("userId")
	if folderID == "" || userID == "" {
		return RespondError(c, ErrBadRequest("Folder ID and User ID required"))
	}

	result, deleteErr := h.db.Exec(`
		DELETE FROM shared_folder_members
		WHERE shared_folder_id = $1 AND user_id = $2
	`, folderID, userID)

	if deleteErr != nil {
		return RespondError(c, ErrOperationFailed("remove member", deleteErr))
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return RespondError(c, ErrNotFound("Member"))
	}

	// Audit log - get folder name for path
	var folderName string
	h.db.QueryRow("SELECT name FROM shared_folders WHERE id = $1", folderID).Scan(&folderName)
	actorID := claims.UserID
	h.auditHandler.LogEvent(&actorID, c.RealIP(), "shared_folder_member_remove",
		fmt.Sprintf("/shared/%s", sanitizeFolderName(folderName)),
		map[string]interface{}{
			"memberUserId": userID,
		})

	// Invalidate permission cache for the user
	if cache := GetPermissionCache(); cache != nil {
		cache.InvalidateUser(userID)
	}

	// Send notification to the removed user
	if h.notificationService != nil {
		title := "공유 폴더에서 제외되었습니다"
		message := "'" + folderName + "' 폴더에서 제외되었습니다"
		h.notificationService.Create(
			userID,
			NotifSharedFolderRemoved,
			title,
			message,
			"",
			&claims.UserID,
			map[string]interface{}{
				"folderId":   folderID,
				"folderName": folderName,
			},
		)
	}

	return RespondSuccess(c, map[string]string{"message": "Member removed successfully"})
}

// --- Permission Checking Helpers ---

// CheckUserPermission checks if a user has access to a shared folder and returns their permission level
func (h *SharedFolderHandler) CheckUserPermission(userID, folderID string) (int, error) {
	var permissionLevel int
	err := h.db.QueryRow(`
		SELECT sfm.permission_level
		FROM shared_folder_members sfm
		INNER JOIN shared_folders sf ON sf.id = sfm.shared_folder_id
		WHERE sfm.shared_folder_id = $1 AND sfm.user_id = $2 AND sf.is_active = TRUE
	`, folderID, userID).Scan(&permissionLevel)

	if err == sql.ErrNoRows {
		return 0, fmt.Errorf("no access")
	}
	if err != nil {
		return 0, err
	}

	return permissionLevel, nil
}

// CanRead checks if a user can read from a shared folder
func (h *SharedFolderHandler) CanRead(userID, folderID string) bool {
	perm, err := h.CheckUserPermission(userID, folderID)
	return err == nil && perm >= PermissionReadOnly
}

// CanWrite checks if a user can write to a shared folder
func (h *SharedFolderHandler) CanWrite(userID, folderID string) bool {
	perm, err := h.CheckUserPermission(userID, folderID)
	return err == nil && perm >= PermissionReadWrite
}

// CheckQuota checks if an upload would exceed the folder's storage quota
func (h *SharedFolderHandler) CheckQuota(folderID string, uploadSize int64) (allowed bool, quota int64, used int64) {
	// Get quota
	err := h.db.QueryRow(`
		SELECT storage_quota FROM shared_folders WHERE id = $1 AND is_active = TRUE
	`, folderID).Scan(&quota)
	if err != nil {
		return false, 0, 0
	}

	// 0 = unlimited
	if quota == 0 {
		return true, 0, 0
	}

	// Get current usage
	used, _ = h.GetFolderStorageUsage(folderID)

	return (used + uploadSize) <= quota, quota, used
}
