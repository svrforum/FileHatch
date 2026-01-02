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

// UpdateUserRequest represents admin user update request
type UpdateUserRequest struct {
	Email        string `json:"email"`
	Password     string `json:"password"`
	IsAdmin      bool   `json:"isAdmin"`
	IsActive     bool   `json:"isActive"`
	StorageQuota *int64 `json:"storageQuota,omitempty"` // nil = don't change, 0 = unlimited
}

// ListUsers returns all users (admin only)
func (h *AuthHandler) ListUsers(c echo.Context) error {
	rows, err := h.db.Query(`
		SELECT id, username, email, provider, is_admin, is_active, smb_hash,
		       COALESCE(totp_enabled, false), storage_quota, created_at, updated_at
		FROM users
		ORDER BY created_at DESC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Database error",
		})
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

		err := rows.Scan(&user.ID, &user.Username, &email, &provider, &user.IsAdmin,
			&user.IsActive, &smbHash, &totpEnabled, &storageQuota, &user.CreatedAt, &user.UpdatedAt)
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
		// Calculate storage used
		user.StorageUsed = h.calculateStorageUsed(user.Username)

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
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	// Validate input
	if len(req.Username) < 3 || len(req.Username) > 50 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Username must be between 3 and 50 characters",
		})
	}

	if len(req.Password) < 8 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Password must be at least 8 characters",
		})
	}

	// Check if username already exists
	var exists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)", req.Username).Scan(&exists)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Database error",
		})
	}
	if exists {
		return c.JSON(http.StatusConflict, map[string]string{
			"error": "Username already exists",
		})
	}

	// Hash password
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to hash password",
		})
	}

	// Create user
	var userID string
	err = h.db.QueryRow(`
		INSERT INTO users (username, email, password_hash, is_admin, is_active)
		VALUES ($1, $2, $3, $4, true)
		RETURNING id
	`, req.Username, req.Email, string(passwordHash), req.IsAdmin).Scan(&userID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create user",
		})
	}

	// Create user's home directory
	var warnings []string
	if err := h.ensureUserHomeDir(req.Username); err != nil {
		log.Printf("WARNING: Failed to create home directory for user %s: %v", req.Username, err)
		warnings = append(warnings, "Home directory creation failed - will be created on first access")
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

	var req UpdateUserRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	// Build update query
	updates := []string{"is_admin = $1", "is_active = $2", "updated_at = NOW()"}
	args := []interface{}{req.IsAdmin, req.IsActive}
	argCount := 3

	if req.Email != "" {
		updates = append(updates, fmt.Sprintf("email = $%d", argCount))
		args = append(args, req.Email)
		argCount++
	}

	if req.Password != "" {
		if len(req.Password) < 8 {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Password must be at least 8 characters",
			})
		}
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to hash password",
			})
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

	args = append(args, userID)
	query := "UPDATE users SET " + strings.Join(updates, ", ") + fmt.Sprintf(" WHERE id = $%d", argCount)

	result, err := h.db.Exec(query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to update user",
		})
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "User not found",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "User updated successfully",
	})
}

// DeleteUser deletes a user (admin only)
func (h *AuthHandler) DeleteUser(c echo.Context) error {
	userID := c.Param("id")
	claims := c.Get("user").(*JWTClaims)

	// Prevent self-deletion
	if userID == claims.UserID {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Cannot delete your own account",
		})
	}

	result, err := h.db.Exec("DELETE FROM users WHERE id = $1", userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to delete user",
		})
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "User not found",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "User deleted successfully",
	})
}
