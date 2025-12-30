package handlers

import (
	"database/sql"
	"net/http"
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
func (h *FileShareHandler) CreateFileShare(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	var req CreateFileShareRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	// Validate request
	if req.ItemPath == "" || req.ItemName == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Item path and name are required"})
	}
	if req.SharedWithID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Shared with user ID is required"})
	}
	if req.SharedWithID == claims.UserID {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Cannot share with yourself"})
	}

	// Validate permission level
	if req.PermissionLevel < 1 || req.PermissionLevel > 2 {
		req.PermissionLevel = FileShareReadOnly
	}

	// Check if target user exists
	var userExists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)", req.SharedWithID).Scan(&userExists)
	if err != nil || !userExists {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}

	// Verify owner has access to the file (must be in their home folder or they have write access)
	// Virtual paths use /home/... (without username) for current user's home directory
	// Also accept /home/{username}/... format for backwards compatibility
	isHomeFolder := strings.HasPrefix(req.ItemPath, "/home/") || req.ItemPath == "/home"
	isSharedFolder := strings.HasPrefix(req.ItemPath, "/shared/")

	if !isHomeFolder && !isSharedFolder {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "You can only share files from your home folder or shared drives"})
	}

	// Insert the share
	var shareID int64
	err = h.db.QueryRow(`
		INSERT INTO file_shares (item_path, item_name, is_folder, owner_id, shared_with_id, permission_level, message)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (item_path, owner_id, shared_with_id)
		DO UPDATE SET permission_level = EXCLUDED.permission_level, message = EXCLUDED.message, updated_at = NOW()
		RETURNING id
	`, req.ItemPath, req.ItemName, req.IsFolder, claims.UserID, req.SharedWithID, req.PermissionLevel, req.Message).Scan(&shareID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create share"})
	}

	// Audit log
	h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file_share_create", req.ItemPath, map[string]interface{}{
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
		h.notificationService.Create(
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

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"id":      shareID,
		"message": "File shared successfully",
	})
}

// ListSharedByMe returns files shared by the current user
func (h *FileShareHandler) ListSharedByMe(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
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
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Database error"})
	}
	defer rows.Close()

	shares := []FileShare{}
	for rows.Next() {
		var s FileShare
		var message sql.NullString
		err := rows.Scan(
			&s.ID, &s.ItemPath, &s.ItemName, &s.IsFolder, &s.OwnerID, &s.SharedWithID,
			&s.PermissionLevel, &message, &s.CreatedAt, &s.UpdatedAt, &s.SharedWithUsername,
		)
		if err != nil {
			continue
		}
		if message.Valid {
			s.Message = message.String
		}
		shares = append(shares, s)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"shares": shares,
		"total":  len(shares),
	})
}

// ListSharedWithMe returns files shared with the current user
func (h *FileShareHandler) ListSharedWithMe(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
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
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Database error"})
	}
	defer rows.Close()

	shares := []FileShare{}
	for rows.Next() {
		var s FileShare
		var message sql.NullString
		err := rows.Scan(
			&s.ID, &s.ItemPath, &s.ItemName, &s.IsFolder, &s.OwnerID, &s.SharedWithID,
			&s.PermissionLevel, &message, &s.CreatedAt, &s.UpdatedAt, &s.OwnerUsername,
		)
		if err != nil {
			continue
		}
		if message.Valid {
			s.Message = message.String
		}
		shares = append(shares, s)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"shares": shares,
		"total":  len(shares),
	})
}

// UpdateFileShare updates a file share's permission level
func (h *FileShareHandler) UpdateFileShare(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	shareID := c.Param("id")
	if shareID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Share ID required"})
	}

	var req struct {
		PermissionLevel int `json:"permissionLevel"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	if req.PermissionLevel < 1 || req.PermissionLevel > 2 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid permission level"})
	}

	// Get share info before updating for notification
	var sharedWithID, itemName string
	var isFolder bool
	err := h.db.QueryRow(`
		SELECT shared_with_id, item_name, is_folder FROM file_shares
		WHERE id = $1 AND owner_id = $2
	`, shareID, claims.UserID).Scan(&sharedWithID, &itemName, &isFolder)
	if err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Share not found or not owned by you"})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Database error"})
	}

	// Update the share (only owner can update)
	_, err = h.db.Exec(`
		UPDATE file_shares
		SET permission_level = $1, updated_at = NOW()
		WHERE id = $2 AND owner_id = $3
	`, req.PermissionLevel, shareID, claims.UserID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update share"})
	}

	// Audit log
	h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file_share_update", shareID, map[string]interface{}{
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
		h.notificationService.Create(
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

	return c.JSON(http.StatusOK, map[string]string{"message": "Share updated successfully"})
}

// DeleteFileShare removes a file share
func (h *FileShareHandler) DeleteFileShare(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	shareID := c.Param("id")
	if shareID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Share ID required"})
	}

	// Get share info before deleting for audit log and notification
	var itemPath, itemName, sharedWithID string
	var isFolder bool
	err := h.db.QueryRow(`
		SELECT item_path, item_name, shared_with_id, is_folder
		FROM file_shares WHERE id = $1 AND owner_id = $2
	`, shareID, claims.UserID).Scan(&itemPath, &itemName, &sharedWithID, &isFolder)
	if err == sql.ErrNoRows {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Share not found or not owned by you"})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Database error"})
	}

	// Delete the share
	_, err = h.db.Exec("DELETE FROM file_shares WHERE id = $1 AND owner_id = $2", shareID, claims.UserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete share"})
	}

	// Audit log
	h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file_share_delete", itemPath, nil)

	// Send notification to the shared-with user
	if h.notificationService != nil {
		itemType := "파일"
		if isFolder {
			itemType = "폴더"
		}
		title := "공유가 취소되었습니다"
		message := claims.Username + "님이 '" + itemName + "' " + itemType + " 공유를 취소했습니다"
		h.notificationService.Create(
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

	return c.JSON(http.StatusOK, map[string]string{"message": "Share deleted successfully"})
}

// GetFileShareInfo returns sharing information for a specific file
func (h *FileShareHandler) GetFileShareInfo(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	paramPath := c.Param("*")
	// URL-decode the path parameter
	decodedPath, err := url.QueryUnescape(paramPath)
	if err != nil {
		decodedPath = paramPath
	}
	// Handle paths - ensure it starts with /
	itemPath := decodedPath
	if !strings.HasPrefix(itemPath, "/") {
		itemPath = "/" + decodedPath
	}
	if itemPath == "/" || itemPath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Item path required"})
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
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Database error"})
	}
	defer rows.Close()

	shares := []FileShare{}
	for rows.Next() {
		var s FileShare
		var message sql.NullString
		err := rows.Scan(
			&s.ID, &s.ItemPath, &s.ItemName, &s.IsFolder, &s.OwnerID, &s.SharedWithID,
			&s.PermissionLevel, &message, &s.CreatedAt, &s.UpdatedAt, &s.SharedWithUsername,
		)
		if err != nil {
			continue
		}
		if message.Valid {
			s.Message = message.String
		}
		shares = append(shares, s)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"itemPath": itemPath,
		"shares":   shares,
		"total":    len(shares),
	})
}

// SearchUsers searches for users by username or email (for sharing UI)
func (h *FileShareHandler) SearchUsers(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	query := c.QueryParam("q")
	if len(query) < 2 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Search query must be at least 2 characters"})
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
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Database error"})
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
		if err := rows.Scan(&u.ID, &u.Username, &email); err != nil {
			continue
		}
		if email.Valid {
			u.Email = email.String
		}
		users = append(users, u)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
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
