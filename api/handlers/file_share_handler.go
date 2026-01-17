package handlers

import (
	"database/sql"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// Permission levels for file shares
const (
	FileShareReadOnly  = 1
	FileShareReadWrite = 2
)

// FileShare represents a user-to-user file/folder share
type FileShare struct {
	ID              int64     `json:"id"`
	ItemPath        string    `json:"itemPath"`
	ItemName        string    `json:"itemName"`
	IsFolder        bool      `json:"isFolder"`
	OwnerID         string    `json:"ownerId"`
	SharedWithID    string    `json:"sharedWithId"`
	PermissionLevel int       `json:"permissionLevel"`
	Message         string    `json:"message,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
	// Additional fields for display
	OwnerUsername      string `json:"ownerUsername,omitempty"`
	SharedWithUsername string `json:"sharedWithUsername,omitempty"`
}

// FileShareHandler handles file sharing operations
type FileShareHandler struct {
	db                  *sql.DB
	auditHandler        *AuditHandler
	notificationService *NotificationService
}

// NewFileShareHandler creates a new FileShareHandler
func NewFileShareHandler(db *sql.DB, notificationService *NotificationService) *FileShareHandler {
	return &FileShareHandler{
		db:                  db,
		auditHandler:        NewAuditHandler(db, "/data"),
		notificationService: notificationService,
	}
}

// CreateFileShareRequest represents the request to create a file share
type CreateFileShareRequest struct {
	ItemPath        string `json:"itemPath"`
	ItemName        string `json:"itemName"`
	IsFolder        bool   `json:"isFolder"`
	SharedWithID    string `json:"sharedWithId"`
	PermissionLevel int    `json:"permissionLevel"`
	Message         string `json:"message"`
}

// CreateFileShare creates a new file share
// @Summary		Create file share
// @Description	Share a file or folder with another user
// @Tags		FileShares
// @Accept		json
// @Produce		json
// @Param		request	body		CreateFileShareRequest	true	"File share request"
// @Success		200		{object}	docs.SuccessResponse{data=FileShare}	"File share created"
// @Failure		400		{object}	docs.ErrorResponse	"Bad request"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		404		{object}	docs.ErrorResponse	"User not found"
// @Failure		409		{object}	docs.ErrorResponse	"Share already exists"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/file-shares [post]
func (h *FileShareHandler) CreateFileShare(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	var req CreateFileShareRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	// Validate request
	if req.ItemPath == "" || req.ItemName == "" {
		return RespondError(c, ErrBadRequest("Item path and name are required"))
	}
	if req.SharedWithID == "" {
		return RespondError(c, ErrBadRequest("Shared with user ID is required"))
	}
	if req.SharedWithID == claims.UserID {
		return RespondError(c, ErrBadRequest("Cannot share with yourself"))
	}

	// Validate permission level
	if req.PermissionLevel < 1 || req.PermissionLevel > 2 {
		req.PermissionLevel = FileShareReadOnly
	}

	// Check if target user exists
	var userExists bool
	dbErr := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)", req.SharedWithID).Scan(&userExists)
	if dbErr != nil || !userExists {
		return RespondError(c, ErrNotFound("User"))
	}

	// Verify owner has access to the file (must be in their home folder or they have write access)
	// Virtual paths use /home/... (without username) for current user's home directory
	// Also accept /home/{username}/... format for backwards compatibility
	isHomeFolder := strings.HasPrefix(req.ItemPath, "/home/") || req.ItemPath == "/home"
	isSharedFolder := strings.HasPrefix(req.ItemPath, "/shared/")

	if !isHomeFolder && !isSharedFolder {
		return RespondError(c, ErrForbidden("You can only share files from your home folder or shared drives"))
	}

	// Insert the share
	var shareID int64
	insertErr := h.db.QueryRow(`
		INSERT INTO file_shares (item_path, item_name, is_folder, owner_id, shared_with_id, permission_level, message)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (item_path, owner_id, shared_with_id)
		DO UPDATE SET permission_level = EXCLUDED.permission_level, message = EXCLUDED.message, updated_at = NOW()
		RETURNING id
	`, req.ItemPath, req.ItemName, req.IsFolder, claims.UserID, req.SharedWithID, req.PermissionLevel, req.Message).Scan(&shareID)

	if insertErr != nil {
		return RespondError(c, ErrOperationFailed("create share", insertErr))
	}

	// Audit log
	_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file_share_create", req.ItemPath, map[string]interface{}{
		"sharedWithId":    req.SharedWithID,
		"permissionLevel": req.PermissionLevel,
		"isFolder":        req.IsFolder,
	})

	// Send notification to the shared-with user
	if h.notificationService != nil {
		itemType := "파일"
		if req.IsFolder {
			itemType = "폴더"
		}
		permLabel := "읽기"
		if req.PermissionLevel == FileShareReadWrite {
			permLabel = "읽기/쓰기"
		}
		title := claims.Username + "님이 " + itemType + "을 공유했습니다"
		message := "'" + req.ItemName + "' (" + permLabel + " 권한)"
		link := "/shared-with-me"
		_, _ = h.notificationService.Create(
			req.SharedWithID,
			NotifShareReceived,
			title,
			message,
			link,
			&claims.UserID,
			map[string]interface{}{
				"itemPath":        req.ItemPath,
				"itemName":        req.ItemName,
				"isFolder":        req.IsFolder,
				"permissionLevel": req.PermissionLevel,
			},
		)
	}

	return RespondCreated(c, map[string]interface{}{
		"id":      shareID,
		"message": "File shared successfully",
	})
}

// ListSharedByMe returns files shared by the current user
func (h *FileShareHandler) ListSharedByMe(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	query := `
		SELECT fs.id, fs.item_path, fs.item_name, fs.is_folder, fs.owner_id, fs.shared_with_id,
		       fs.permission_level, fs.message, fs.created_at, fs.updated_at, u.username as shared_with_username
		FROM file_shares fs
		INNER JOIN users u ON fs.shared_with_id = u.id
		WHERE fs.owner_id = $1
		ORDER BY fs.created_at DESC
	`

	rows, err := h.db.Query(query, claims.UserID)
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}
	defer rows.Close()

	shares := []FileShare{}
	for rows.Next() {
		var s FileShare
		var message sql.NullString
		if scanErr := rows.Scan(
			&s.ID, &s.ItemPath, &s.ItemName, &s.IsFolder, &s.OwnerID, &s.SharedWithID,
			&s.PermissionLevel, &message, &s.CreatedAt, &s.UpdatedAt, &s.SharedWithUsername,
		); scanErr != nil {
			continue
		}
		if message.Valid {
			s.Message = message.String
		}
		shares = append(shares, s)
	}

	return RespondSuccess(c, map[string]interface{}{
		"shares": shares,
		"total":  len(shares),
	})
}

// ListSharedWithMe returns files shared with the current user
func (h *FileShareHandler) ListSharedWithMe(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	query := `
		SELECT fs.id, fs.item_path, fs.item_name, fs.is_folder, fs.owner_id, fs.shared_with_id,
		       fs.permission_level, fs.message, fs.created_at, fs.updated_at, u.username as owner_username
		FROM file_shares fs
		INNER JOIN users u ON fs.owner_id = u.id
		WHERE fs.shared_with_id = $1
		ORDER BY fs.created_at DESC
	`

	rows, err := h.db.Query(query, claims.UserID)
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}
	defer rows.Close()

	shares := []FileShare{}
	for rows.Next() {
		var s FileShare
		var message sql.NullString
		if scanErr := rows.Scan(
			&s.ID, &s.ItemPath, &s.ItemName, &s.IsFolder, &s.OwnerID, &s.SharedWithID,
			&s.PermissionLevel, &message, &s.CreatedAt, &s.UpdatedAt, &s.OwnerUsername,
		); scanErr != nil {
			continue
		}
		if message.Valid {
			s.Message = message.String
		}
		shares = append(shares, s)
	}

	return RespondSuccess(c, map[string]interface{}{
		"shares": shares,
		"total":  len(shares),
	})
}

// UpdateFileShare updates a file share's permission level
func (h *FileShareHandler) UpdateFileShare(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	shareID := c.Param("id")
	if shareID == "" {
		return RespondError(c, ErrMissingParameter("share ID"))
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

	// Get share info before updating for notification
	var sharedWithID, itemName string
	var isFolder bool
	queryErr := h.db.QueryRow(`
		SELECT shared_with_id, item_name, is_folder FROM file_shares
		WHERE id = $1 AND owner_id = $2
	`, shareID, claims.UserID).Scan(&sharedWithID, &itemName, &isFolder)
	if queryErr == sql.ErrNoRows {
		return RespondError(c, ErrNotFound("Share"))
	}
	if queryErr != nil {
		return RespondError(c, ErrInternal("Database error"))
	}

	// Update the share (only owner can update)
	_, updateErr := h.db.Exec(`
		UPDATE file_shares
		SET permission_level = $1, updated_at = NOW()
		WHERE id = $2 AND owner_id = $3
	`, req.PermissionLevel, shareID, claims.UserID)

	if updateErr != nil {
		return RespondError(c, ErrOperationFailed("update share", updateErr))
	}

	// Audit log
	_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file_share_update", shareID, map[string]interface{}{
		"permissionLevel": req.PermissionLevel,
	})

	// Send notification to the shared-with user
	if h.notificationService != nil {
		permLabel := "읽기"
		if req.PermissionLevel == FileShareReadWrite {
			permLabel = "읽기/쓰기"
		}
		title := "공유 권한이 변경되었습니다"
		message := claims.Username + "님이 '" + itemName + "' 권한을 " + permLabel + "(으)로 변경했습니다"
		link := "/shared-with-me"
		_, _ = h.notificationService.Create(
			sharedWithID,
			NotifSharePermissionChanged,
			title,
			message,
			link,
			&claims.UserID,
			map[string]interface{}{
				"itemName":           itemName,
				"isFolder":           isFolder,
				"newPermissionLevel": req.PermissionLevel,
			},
		)
	}

	return RespondSuccess(c, map[string]string{"message": "Share updated successfully"})
}

// DeleteFileShare removes a file share
func (h *FileShareHandler) DeleteFileShare(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	shareID := c.Param("id")
	if shareID == "" {
		return RespondError(c, ErrMissingParameter("share ID"))
	}

	// Get share info before deleting for audit log and notification
	var itemPath, itemName, sharedWithID string
	var isFolder bool
	queryErr := h.db.QueryRow(`
		SELECT item_path, item_name, shared_with_id, is_folder
		FROM file_shares WHERE id = $1 AND owner_id = $2
	`, shareID, claims.UserID).Scan(&itemPath, &itemName, &sharedWithID, &isFolder)
	if queryErr == sql.ErrNoRows {
		return RespondError(c, ErrNotFound("Share"))
	}
	if queryErr != nil {
		return RespondError(c, ErrInternal("Database error"))
	}

	// Delete the share
	_, deleteErr := h.db.Exec("DELETE FROM file_shares WHERE id = $1 AND owner_id = $2", shareID, claims.UserID)
	if deleteErr != nil {
		return RespondError(c, ErrOperationFailed("delete share", deleteErr))
	}

	// Audit log
	_ = h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file_share_delete", itemPath, nil)

	// Send notification to the shared-with user
	if h.notificationService != nil {
		itemType := "파일"
		if isFolder {
			itemType = "폴더"
		}
		title := "공유가 취소되었습니다"
		message := claims.Username + "님이 '" + itemName + "' " + itemType + " 공유를 취소했습니다"
		_, _ = h.notificationService.Create(
			sharedWithID,
			NotifShareRemoved,
			title,
			message,
			"",
			&claims.UserID,
			map[string]interface{}{
				"itemName": itemName,
				"isFolder": isFolder,
			},
		)
	}

	return RespondSuccess(c, map[string]string{"message": "Share deleted successfully"})
}

// GetFileShareInfo returns sharing information for a specific file
func (h *FileShareHandler) GetFileShareInfo(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	paramPath := c.Param("*")
	// URL-decode the path parameter
	decodedPath, decodeErr := url.QueryUnescape(paramPath)
	if decodeErr != nil {
		decodedPath = paramPath
	}
	// Handle paths - ensure it starts with /
	itemPath := decodedPath
	if !strings.HasPrefix(itemPath, "/") {
		itemPath = "/" + decodedPath
	}
	if itemPath == "/" || itemPath == "" {
		return RespondError(c, ErrMissingParameter("item path"))
	}

	query := `
		SELECT fs.id, fs.item_path, fs.item_name, fs.is_folder, fs.owner_id, fs.shared_with_id,
		       fs.permission_level, fs.message, fs.created_at, fs.updated_at, u.username as shared_with_username
		FROM file_shares fs
		INNER JOIN users u ON fs.shared_with_id = u.id
		WHERE fs.item_path = $1 AND fs.owner_id = $2
		ORDER BY fs.created_at DESC
	`

	rows, err := h.db.Query(query, itemPath, claims.UserID)
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}
	defer rows.Close()

	shares := []FileShare{}
	for rows.Next() {
		var s FileShare
		var message sql.NullString
		if scanErr := rows.Scan(
			&s.ID, &s.ItemPath, &s.ItemName, &s.IsFolder, &s.OwnerID, &s.SharedWithID,
			&s.PermissionLevel, &message, &s.CreatedAt, &s.UpdatedAt, &s.SharedWithUsername,
		); scanErr != nil {
			continue
		}
		if message.Valid {
			s.Message = message.String
		}
		shares = append(shares, s)
	}

	return RespondSuccess(c, map[string]interface{}{
		"itemPath": itemPath,
		"shares":   shares,
		"total":    len(shares),
	})
}

// SearchUsers searches for users by username or email (for sharing UI)
func (h *FileShareHandler) SearchUsers(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	query := c.QueryParam("q")
	if len(query) < 2 {
		return RespondError(c, ErrBadRequest("Search query must be at least 2 characters"))
	}

	limitStr := c.QueryParam("limit")
	limit := 10
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 50 {
			limit = l
		}
	}

	// Search for users (exclude current user)
	searchQuery := `
		SELECT id, username, email
		FROM users
		WHERE id != $1 AND is_active = TRUE
		  AND (username ILIKE $2 OR email ILIKE $2)
		ORDER BY username ASC
		LIMIT $3
	`

	rows, err := h.db.Query(searchQuery, claims.UserID, "%"+query+"%", limit)
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}
	defer rows.Close()

	type UserResult struct {
		ID       string `json:"id"`
		Username string `json:"username"`
		Email    string `json:"email,omitempty"`
	}

	users := []UserResult{}
	for rows.Next() {
		var u UserResult
		var email sql.NullString
		if scanErr := rows.Scan(&u.ID, &u.Username, &email); scanErr != nil {
			continue
		}
		if email.Valid {
			u.Email = email.String
		}
		users = append(users, u)
	}

	return RespondSuccess(c, map[string]interface{}{
		"users": users,
		"total": len(users),
	})
}

// CheckFileSharePermission checks if a user has permission to access a shared file
func (h *FileShareHandler) CheckFileSharePermission(userID, itemPath string, requiredLevel int) bool {
	var permissionLevel int
	err := h.db.QueryRow(`
		SELECT permission_level FROM file_shares
		WHERE item_path = $1 AND shared_with_id = $2
	`, itemPath, userID).Scan(&permissionLevel)

	if err != nil {
		// Also check if the path is under a shared folder
		// For example, if /home/admin/folder is shared, /home/admin/folder/file.txt should also be accessible
		rows, err := h.db.Query(`
			SELECT item_path, permission_level FROM file_shares
			WHERE shared_with_id = $1 AND is_folder = TRUE
		`, userID)
		if err != nil {
			return false
		}
		defer rows.Close()

		for rows.Next() {
			var sharedPath string
			var perm int
			if err := rows.Scan(&sharedPath, &perm); err != nil {
				continue
			}
			// Check if itemPath is under sharedPath
			if strings.HasPrefix(itemPath, sharedPath+"/") || itemPath == sharedPath {
				if perm >= requiredLevel {
					return true
				}
			}
		}
		return false
	}

	return permissionLevel >= requiredLevel
}

// CanReadSharedFile checks if user can read a shared file
func (h *FileShareHandler) CanReadSharedFile(userID, itemPath string) bool {
	return h.CheckFileSharePermission(userID, itemPath, FileShareReadOnly)
}

// CanWriteSharedFile checks if user can write to a shared file
func (h *FileShareHandler) CanWriteSharedFile(userID, itemPath string) bool {
	return h.CheckFileSharePermission(userID, itemPath, FileShareReadWrite)
}
