package handlers

import (
	"database/sql"
	"net/http"
	"os"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/lib/pq"
)

// FileLock represents a file lock entry
type FileLock struct {
	ID        string     `json:"id"`
	FilePath  string     `json:"filePath"`
	LockedBy  string     `json:"lockedBy"`
	Username  string     `json:"username"`
	LockedAt  time.Time  `json:"lockedAt"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	LockType  string     `json:"lockType"`
	Reason    *string    `json:"reason,omitempty"`
}

// LockRequest represents a request to lock a file
type LockRequest struct {
	Path      string  `json:"path"`
	Duration  *int    `json:"duration,omitempty"`  // Lock duration in minutes (null = no expiration)
	Reason    *string `json:"reason,omitempty"`
}

// LockFile locks a file for exclusive editing
func (h *Handler) LockFile(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	var req LockRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}

	if req.Path == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	// Check if file exists
	realPath, _, _, err := h.resolvePath(req.Path, claims)
	if err != nil {
		return RespondError(c, ErrInvalidPath(err.Error()))
	}
	if _, err := os.Stat(realPath); os.IsNotExist(err) {
		return RespondError(c, ErrNotFound("File not found"))
	}

	// Clean up expired locks first
	h.cleanupExpiredLocks()

	// Check if already locked by someone else
	var existingLock FileLock
	var lockedByUsername string
	err = h.db.QueryRow(`
		SELECT fl.id, fl.file_path, fl.locked_by, u.username, fl.locked_at, fl.expires_at, fl.lock_type, fl.reason
		FROM file_locks fl
		JOIN users u ON fl.locked_by = u.id
		WHERE fl.file_path = $1
	`, req.Path).Scan(
		&existingLock.ID, &existingLock.FilePath, &existingLock.LockedBy,
		&lockedByUsername, &existingLock.LockedAt, &existingLock.ExpiresAt,
		&existingLock.LockType, &existingLock.Reason,
	)

	if err == nil {
		// File is already locked
		if existingLock.LockedBy == claims.UserID {
			// Same user, extend the lock
			var expiresAt *time.Time
			if req.Duration != nil {
				t := time.Now().Add(time.Duration(*req.Duration) * time.Minute)
				expiresAt = &t
			}
			_, err = h.db.Exec(`
				UPDATE file_locks SET expires_at = $1, reason = $2, locked_at = NOW()
				WHERE id = $3
			`, expiresAt, req.Reason, existingLock.ID)
			if err != nil {
				return RespondError(c, ErrInternal("Failed to extend lock"))
			}
			return c.JSON(http.StatusOK, map[string]interface{}{
				"locked":    true,
				"extended":  true,
				"path":      req.Path,
				"expiresAt": expiresAt,
			})
		}
		// Locked by someone else
		return c.JSON(http.StatusConflict, map[string]interface{}{
			"error":      "File is locked by another user",
			"lockedBy":   lockedByUsername,
			"lockedAt":   existingLock.LockedAt,
			"expiresAt":  existingLock.ExpiresAt,
		})
	} else if err != sql.ErrNoRows {
		return RespondError(c, ErrInternal("Database error"))
	}

	// Create new lock
	var expiresAt *time.Time
	if req.Duration != nil {
		t := time.Now().Add(time.Duration(*req.Duration) * time.Minute)
		expiresAt = &t
	}

	var lockID string
	err = h.db.QueryRow(`
		INSERT INTO file_locks (file_path, locked_by, expires_at, reason)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, req.Path, claims.UserID, expiresAt, req.Reason).Scan(&lockID)

	if err != nil {
		return RespondError(c, ErrInternal("Failed to lock file"))
	}

	// Log audit event
	h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file.lock", req.Path, map[string]interface{}{
		"duration": req.Duration,
		"reason":   req.Reason,
	})

	return c.JSON(http.StatusOK, map[string]interface{}{
		"locked":    true,
		"path":      req.Path,
		"lockId":    lockID,
		"expiresAt": expiresAt,
	})
}

// UnlockFile removes a file lock
func (h *Handler) UnlockFile(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	var req struct {
		Path  string `json:"path"`
		Force bool   `json:"force,omitempty"`  // Admin only: force unlock
	}
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}

	if req.Path == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	// Check if locked
	var lockID, lockedBy string
	err := h.db.QueryRow(`
		SELECT id, locked_by FROM file_locks WHERE file_path = $1
	`, req.Path).Scan(&lockID, &lockedBy)

	if err == sql.ErrNoRows {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"unlocked": true,
			"path":     req.Path,
			"message":  "File was not locked",
		})
	} else if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}

	// Check permission
	if lockedBy != claims.UserID {
		if !claims.IsAdmin || !req.Force {
			return c.JSON(http.StatusForbidden, map[string]interface{}{
				"error": "You can only unlock files you locked",
			})
		}
	}

	// Delete lock
	_, err = h.db.Exec(`DELETE FROM file_locks WHERE id = $1`, lockID)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to unlock file"))
	}

	// Log audit event
	h.auditHandler.LogEvent(&claims.UserID, c.RealIP(), "file.unlock", req.Path, map[string]interface{}{
		"force": req.Force && lockedBy != claims.UserID,
	})

	return c.JSON(http.StatusOK, map[string]interface{}{
		"unlocked": true,
		"path":     req.Path,
	})
}

// GetFileLock checks if a file is locked
func (h *Handler) GetFileLock(c echo.Context) error {
	path := c.QueryParam("path")
	if path == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	// Clean up expired locks first
	h.cleanupExpiredLocks()

	var lock FileLock
	var username string
	err := h.db.QueryRow(`
		SELECT fl.id, fl.file_path, fl.locked_by, u.username, fl.locked_at, fl.expires_at, fl.lock_type, fl.reason
		FROM file_locks fl
		JOIN users u ON fl.locked_by = u.id
		WHERE fl.file_path = $1
	`, path).Scan(
		&lock.ID, &lock.FilePath, &lock.LockedBy, &username,
		&lock.LockedAt, &lock.ExpiresAt, &lock.LockType, &lock.Reason,
	)

	if err == sql.ErrNoRows {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"locked": false,
			"path":   path,
		})
	} else if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}

	lock.Username = username
	return c.JSON(http.StatusOK, map[string]interface{}{
		"locked": true,
		"path":   path,
		"lock":   lock,
	})
}

// CheckFileLocks checks lock status for multiple files (batch)
func (h *Handler) CheckFileLocks(c echo.Context) error {
	var req struct {
		Paths []string `json:"paths"`
	}
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}

	if len(req.Paths) == 0 {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"locks": map[string]interface{}{},
		})
	}

	// Clean up expired locks first
	h.cleanupExpiredLocks()

	rows, err := h.db.Query(`
		SELECT fl.file_path, fl.locked_by, u.username, fl.locked_at, fl.expires_at
		FROM file_locks fl
		JOIN users u ON fl.locked_by = u.id
		WHERE fl.file_path = ANY($1)
	`, pq.Array(req.Paths))
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}
	defer rows.Close()

	locks := make(map[string]interface{})
	for rows.Next() {
		var filePath, lockedBy, username string
		var lockedAt time.Time
		var expiresAt *time.Time
		if err := rows.Scan(&filePath, &lockedBy, &username, &lockedAt, &expiresAt); err != nil {
			continue
		}
		locks[filePath] = map[string]interface{}{
			"lockedBy":  lockedBy,
			"username":  username,
			"lockedAt":  lockedAt,
			"expiresAt": expiresAt,
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"locks": locks,
	})
}

// GetMyLocks returns all files locked by the current user
func (h *Handler) GetMyLocks(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	rows, err := h.db.Query(`
		SELECT id, file_path, locked_at, expires_at, lock_type, reason
		FROM file_locks
		WHERE locked_by = $1
		ORDER BY locked_at DESC
	`, claims.UserID)
	if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}
	defer rows.Close()

	locks := []FileLock{}
	for rows.Next() {
		var lock FileLock
		if err := rows.Scan(&lock.ID, &lock.FilePath, &lock.LockedAt, &lock.ExpiresAt, &lock.LockType, &lock.Reason); err != nil {
			continue
		}
		lock.LockedBy = claims.UserID
		lock.Username = claims.Username
		locks = append(locks, lock)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"locks": locks,
		"total": len(locks),
	})
}

// cleanupExpiredLocks removes expired file locks
func (h *Handler) cleanupExpiredLocks() {
	h.db.Exec(`
		DELETE FROM file_locks WHERE expires_at IS NOT NULL AND expires_at < NOW()
	`)
}

// RemoveLockByPath removes lock when file is deleted
func (h *Handler) RemoveLockByPath(path string) error {
	_, err := h.db.Exec(`DELETE FROM file_locks WHERE file_path = $1`, path)
	return err
}

// UpdateLockPath updates lock path when file is renamed/moved
func (h *Handler) UpdateLockPath(oldPath, newPath string) error {
	_, err := h.db.Exec(`
		UPDATE file_locks SET file_path = $1 WHERE file_path = $2
	`, newPath, oldPath)
	return err
}
