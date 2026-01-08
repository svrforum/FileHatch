package handlers

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/lib/pq"
)

// StarredFile represents a starred file entry
type StarredFile struct {
	ID        string    `json:"id"`
	FilePath  string    `json:"filePath"`
	StarredAt time.Time `json:"starredAt"`
}

// StarRequest represents a request to star/unstar a file
type StarRequest struct {
	Path string `json:"path"`
}

// ToggleStar adds or removes a file from starred list
func (h *Handler) ToggleStar(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	var req StarRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}

	if req.Path == "" {
		return RespondError(c, ErrMissingParameter("path"))
	}

	// Check if already starred
	var existingID string
	err := h.db.QueryRow(`
		SELECT id FROM starred_files WHERE user_id = $1 AND file_path = $2
	`, claims.UserID, req.Path).Scan(&existingID)

	if err == sql.ErrNoRows {
		// Not starred, add it
		_, err = h.db.Exec(`
			INSERT INTO starred_files (user_id, file_path) VALUES ($1, $2)
		`, claims.UserID, req.Path)
		if err != nil {
			return RespondError(c, ErrInternal("Failed to star file"))
		}
		return c.JSON(http.StatusOK, map[string]interface{}{
			"starred": true,
			"path":    req.Path,
		})
	} else if err != nil {
		return RespondError(c, ErrInternal("Database error"))
	}

	// Already starred, remove it
	_, err = h.db.Exec(`
		DELETE FROM starred_files WHERE id = $1
	`, existingID)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to unstar file"))
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"starred": false,
		"path":    req.Path,
	})
}

// GetStarredFiles returns list of starred files for the user
func (h *Handler) GetStarredFiles(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	rows, err := h.db.Query(`
		SELECT id, file_path, starred_at
		FROM starred_files
		WHERE user_id = $1
		ORDER BY starred_at DESC
	`, claims.UserID)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to fetch starred files"))
	}
	defer rows.Close()

	starred := []StarredFile{}
	for rows.Next() {
		var s StarredFile
		if err := rows.Scan(&s.ID, &s.FilePath, &s.StarredAt); err != nil {
			continue
		}
		starred = append(starred, s)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"starred": starred,
		"total":   len(starred),
	})
}

// CheckStarred checks if files are starred (batch)
func (h *Handler) CheckStarred(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return RespondError(c, ErrUnauthorized(""))
	}

	var req struct {
		Paths []string `json:"paths"`
	}
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request body"))
	}

	if len(req.Paths) == 0 {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"starred": map[string]bool{},
		})
	}

	// Query starred status for all paths
	rows, err := h.db.Query(`
		SELECT file_path FROM starred_files
		WHERE user_id = $1 AND file_path = ANY($2)
	`, claims.UserID, pq.Array(req.Paths))
	if err != nil {
		return RespondError(c, ErrInternal("Failed to check starred status"))
	}
	defer rows.Close()

	starredMap := make(map[string]bool)
	for _, path := range req.Paths {
		starredMap[path] = false
	}
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			continue
		}
		starredMap[path] = true
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"starred": starredMap,
	})
}

// RemoveStarredByPath removes starred entries when files are deleted/moved
func (h *Handler) RemoveStarredByPath(userID, path string) error {
	_, err := h.db.Exec(`
		DELETE FROM starred_files WHERE user_id = $1 AND file_path = $2
	`, userID, path)
	return err
}

// UpdateStarredPath updates starred file paths when files are renamed/moved
func (h *Handler) UpdateStarredPath(userID, oldPath, newPath string) error {
	_, err := h.db.Exec(`
		UPDATE starred_files SET file_path = $1 WHERE user_id = $2 AND file_path = $3
	`, newPath, userID, oldPath)
	return err
}
