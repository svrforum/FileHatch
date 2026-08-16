package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

// CreateUserRequest represents admin user creation request
type CreateUserRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
	IsAdmin  bool   `json:"isAdmin"`
}

// UpdateUserRequest represents admin user update request.
//
// Every field is optional: an omitted field leaves the corresponding column
// untouched. IsAdmin and IsActive must be pointers for that to work — as plain
// bools they bound to false whenever the client omitted them, so a request that
// only toggled isActive silently cleared is_admin as well.
type UpdateUserRequest struct {
	Email        string `json:"email"`
	Password     string `json:"password"`
	IsAdmin      *bool  `json:"isAdmin,omitempty"`      // nil = don't change
	IsActive     *bool  `json:"isActive,omitempty"`     // nil = don't change
	StorageQuota *int64 `json:"storageQuota,omitempty"` // nil = don't change, 0 = unlimited
}

// ListUsers returns all users (admin only)
func (h *AuthHandler) ListUsers(c echo.Context) error {
	// storage_used comes from the column the upload/delete paths already
	// maintain. It used to be recomputed per user with a full filepath.Walk of
	// their home directory, inside the rows.Next() loop — so listing N users
	// walked N home trees while holding the cursor (and one of 25 pooled
	// connections) open.
	rows, err := h.db.Query(`
		SELECT id, username, email, provider, is_admin, is_active, smb_hash,
		       COALESCE(totp_enabled, false), storage_quota,
		       COALESCE(storage_used, 0), created_at, updated_at
		FROM users
		ORDER BY created_at DESC
	`)
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}
	defer rows.Close()

	users := []User{}
	for rows.Next() {
		var user User
		var email sql.NullString
		var provider sql.NullString
		var smbHash sql.NullString
		var totpEnabled bool
		var storageQuota sql.NullInt64
		var storageUsed int64

		err := rows.Scan(&user.ID, &user.Username, &email, &provider, &user.IsAdmin,
			&user.IsActive, &smbHash, &totpEnabled, &storageQuota, &storageUsed,
			&user.CreatedAt, &user.UpdatedAt)
		if err != nil {
			continue
		}

		if email.Valid {
			user.Email = email.String
		}
		if provider.Valid {
			user.Provider = provider.String
		} else {
			user.Provider = "local"
		}
		user.HasSMB = smbHash.Valid && smbHash.String != ""
		user.Has2FA = totpEnabled
		if storageQuota.Valid {
			user.StorageQuota = storageQuota.Int64
		}
		user.StorageUsed = storageUsed

		users = append(users, user)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"users": users,
		"total": len(users),
	})
}

// CreateUser creates a new user (admin only)
func (h *AuthHandler) CreateUser(c echo.Context) error {
	var req CreateUserRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	// The username becomes a path segment under /data/users, so it needs the
	// character and reserved-word checks, not just a length check: a length
	// check alone accepts "../../etc", which filepath.Join then normalises out
	// of the home root entirely.
	if err := ValidateUsername(req.Username); err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	// Validate password complexity
	if err := ValidatePassword(req.Password); err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	// Validate email format
	if err := ValidateEmail(req.Email); err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}

	// Check if username already exists
	var exists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)", req.Username).Scan(&exists)
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}
	if exists {
		return RespondError(c, ErrAlreadyExists("Username"))
	}

	// Hash password
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to hash password"))
	}

	// Create user
	var userID string
	err = h.db.QueryRow(`
		INSERT INTO users (username, email, password_hash, is_admin, is_active)
		VALUES ($1, $2, $3, $4, true)
		RETURNING id
	`, req.Username, req.Email, string(passwordHash), req.IsAdmin).Scan(&userID)

	if err != nil {
		return RespondError(c, ErrInternal("Failed to create user"))
	}

	// Create user's home directory
	var warnings []string
	if err := h.ensureUserHomeDir(req.Username); err != nil {
		log.Printf("WARNING: Failed to create home directory for user %s: %v", req.Username, err)
		warnings = append(warnings, "Home directory creation failed - will be created on first access")
	}

	if h.auditHandler != nil {
		h.auditHandler.LogEventFromContext(c, EventAdminUserCreate, req.Username, map[string]interface{}{
			"userId":  userID,
			"isAdmin": req.IsAdmin,
		})
	}

	response := map[string]interface{}{
		"success": true,
		"id":      userID,
		"message": "User created successfully",
	}
	if len(warnings) > 0 {
		response["warnings"] = warnings
	}
	return c.JSON(http.StatusCreated, response)
}

// UpdateUser updates a user (admin only)
func (h *AuthHandler) UpdateUser(c echo.Context) error {
	userID := c.Param("id")

	claims, err := RequireAdmin(c)
	if err != nil {
		return err
	}

	var req UpdateUserRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	// Load the current state before deciding what the request is allowed to change.
	var target struct {
		Username string
		IsAdmin  bool
		IsActive bool
	}
	err = h.db.QueryRow(
		"SELECT username, is_admin, is_active FROM users WHERE id = $1", userID,
	).Scan(&target.Username, &target.IsAdmin, &target.IsActive)
	if err == sql.ErrNoRows {
		return RespondError(c, ErrNotFound("User"))
	}
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}

	demoting := req.IsAdmin != nil && !*req.IsAdmin && target.IsAdmin
	deactivating := req.IsActive != nil && !*req.IsActive && target.IsActive

	// An admin must not be able to lock themselves out. DeleteUser already
	// guards self-deletion; the same reasoning applies to demotion and
	// deactivation.
	if userID == claims.UserID {
		if demoting {
			return RespondError(c, ErrBadRequest("Cannot remove your own admin privileges"))
		}
		if deactivating {
			return RespondError(c, ErrBadRequest("Cannot deactivate your own account"))
		}
	}

	// Refuse changes that would leave the instance with no usable admin.
	if target.IsAdmin && target.IsActive && (demoting || deactivating) {
		var remainingAdmins int
		if err := h.db.QueryRow(
			"SELECT COUNT(*) FROM users WHERE is_admin = true AND is_active = true AND id <> $1", userID,
		).Scan(&remainingAdmins); err != nil {
			return RespondError(c, ErrInternal("Database error"))
		}
		if remainingAdmins == 0 {
			return RespondError(c, ErrBadRequest("Cannot remove the last active administrator"))
		}
	}

	// Build update query — only the fields the client actually sent.
	updates := []string{"updated_at = NOW()"}
	args := []interface{}{}
	argCount := 1

	if req.IsAdmin != nil {
		updates = append(updates, fmt.Sprintf("is_admin = $%d", argCount))
		args = append(args, *req.IsAdmin)
		argCount++
	}

	if req.IsActive != nil {
		updates = append(updates, fmt.Sprintf("is_active = $%d", argCount))
		args = append(args, *req.IsActive)
		argCount++
	}

	if req.Email != "" {
		// Validate email format
		if err := ValidateEmail(req.Email); err != nil {
			return RespondError(c, ErrBadRequest(err.Error()))
		}
		updates = append(updates, fmt.Sprintf("email = $%d", argCount))
		args = append(args, req.Email)
		argCount++
	}

	if req.Password != "" {
		// Validate password complexity
		if err := ValidatePassword(req.Password); err != nil {
			return RespondError(c, ErrBadRequest(err.Error()))
		}
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return RespondError(c, ErrInternal("Failed to hash password"))
		}
		updates = append(updates, fmt.Sprintf("password_hash = $%d", argCount))
		args = append(args, string(passwordHash))
		argCount++
	}

	if req.StorageQuota != nil {
		updates = append(updates, fmt.Sprintf("storage_quota = $%d", argCount))
		args = append(args, *req.StorageQuota)
		argCount++
	}

	// Only "updated_at = NOW()" means the client sent nothing actionable.
	if len(updates) == 1 {
		return RespondError(c, ErrBadRequest("No fields to update"))
	}

	args = append(args, userID)
	query := "UPDATE users SET " + strings.Join(updates, ", ") + fmt.Sprintf(" WHERE id = $%d", argCount)

	result, err := h.db.Exec(query, args...)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to update user"))
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return RespondError(c, ErrNotFound("User"))
	}

	h.logUserUpdate(c, userID, target.Username, target.IsAdmin, target.IsActive, &req)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "User updated successfully",
	})
}

// logUserUpdate records an admin.user.* audit entry describing what actually
// changed. Privilege and activation changes are logged as their own event types
// so they can be filtered without parsing details.
func (h *AuthHandler) logUserUpdate(c echo.Context, userID, username string, wasAdmin, wasActive bool, req *UpdateUserRequest) {
	if h.auditHandler == nil {
		return
	}

	changed := map[string]interface{}{}
	if req.IsAdmin != nil && *req.IsAdmin != wasAdmin {
		changed["isAdmin"] = map[string]bool{"from": wasAdmin, "to": *req.IsAdmin}
	}
	if req.IsActive != nil && *req.IsActive != wasActive {
		changed["isActive"] = map[string]bool{"from": wasActive, "to": *req.IsActive}
	}
	if req.Email != "" {
		changed["email"] = "updated"
	}
	if req.Password != "" {
		changed["password"] = "reset"
	}
	if req.StorageQuota != nil {
		changed["storageQuota"] = *req.StorageQuota
	}

	details := map[string]interface{}{
		"userId":  userID,
		"changes": changed,
	}

	eventType := EventAdminUserUpdate
	if req.IsActive != nil && *req.IsActive != wasActive {
		if *req.IsActive {
			eventType = EventAdminUserActivate
		} else {
			eventType = EventAdminUserDeactivate
		}
	}

	h.auditHandler.LogEventFromContext(c, eventType, username, details)
}

// DeleteUser deletes a user (admin only)
func (h *AuthHandler) DeleteUser(c echo.Context) error {
	userID := c.Param("id")

	claims, err := RequireAdmin(c)
	if err != nil {
		return err
	}

	// Prevent self-deletion
	if userID == claims.UserID {
		return RespondError(c, ErrBadRequest("Cannot delete your own account"))
	}

	// Capture the username for the audit trail before the row disappears, and
	// refuse to delete the last remaining administrator.
	var username string
	var wasAdmin, wasActive bool
	err = h.db.QueryRow(
		"SELECT username, is_admin, is_active FROM users WHERE id = $1", userID,
	).Scan(&username, &wasAdmin, &wasActive)
	if err == sql.ErrNoRows {
		return RespondError(c, ErrNotFound("User"))
	}
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}

	if wasAdmin && wasActive {
		var remainingAdmins int
		if err := h.db.QueryRow(
			"SELECT COUNT(*) FROM users WHERE is_admin = true AND is_active = true AND id <> $1", userID,
		).Scan(&remainingAdmins); err != nil {
			return RespondError(c, ErrInternal("Database error"))
		}
		if remainingAdmins == 0 {
			return RespondError(c, ErrBadRequest("Cannot delete the last active administrator"))
		}
	}

	result, err := h.db.Exec("DELETE FROM users WHERE id = $1", userID)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to delete user"))
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return RespondError(c, ErrNotFound("User"))
	}

	if h.auditHandler != nil {
		h.auditHandler.LogEventFromContext(c, EventAdminUserDelete, username, map[string]interface{}{
			"userId":  userID,
			"isAdmin": wasAdmin,
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "User deleted successfully",
	})
}
