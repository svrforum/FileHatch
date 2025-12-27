package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"time"

	"github.com/labstack/echo/v4"
)

type FileMetadataHandler struct {
	db *sql.DB
}

func NewFileMetadataHandler(db *sql.DB) *FileMetadataHandler {
	return &FileMetadataHandler{db: db}
}

// FileMetadata represents file description and tags
type FileMetadata struct {
	ID          int64     `json:"id"`
	FilePath    string    `json:"filePath"`
	Description string    `json:"description"`
	Tags        []string  `json:"tags"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// GetFileMetadataRequest for getting metadata
type UpdateFileMetadataRequest struct {
	Description *string  `json:"description,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

// GetFileMetadata returns metadata for a specific file
func (h *FileMetadataHandler) GetFileMetadata(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	filePath := c.Param("*")
	if filePath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "File path required",
		})
	}

	// URL decode the path
	if decoded, err := url.QueryUnescape(filePath); err == nil {
		filePath = decoded
	}

	// Normalize path to start with /
	if filePath[0] != '/' {
		filePath = "/" + filePath
	}

	var metadata FileMetadata
	var tagsJSON []byte

	err := h.db.QueryRow(`
		SELECT id, file_path, description, tags, created_at, updated_at
		FROM file_metadata
		WHERE user_id = $1 AND file_path = $2
	`, claims.UserID, filePath).Scan(
		&metadata.ID, &metadata.FilePath, &metadata.Description,
		&tagsJSON, &metadata.CreatedAt, &metadata.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		// Return empty metadata if not found
		return c.JSON(http.StatusOK, FileMetadata{
			FilePath:    filePath,
			Description: "",
			Tags:        []string{},
		})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to get file metadata",
		})
	}

	// Parse tags JSON
	if tagsJSON != nil {
		json.Unmarshal(tagsJSON, &metadata.Tags)
	}
	if metadata.Tags == nil {
		metadata.Tags = []string{}
	}

	return c.JSON(http.StatusOK, metadata)
}

// UpdateFileMetadata updates or creates metadata for a file
func (h *FileMetadataHandler) UpdateFileMetadata(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	filePath := c.Param("*")
	if filePath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "File path required",
		})
	}

	// URL decode the path
	if decoded, err := url.QueryUnescape(filePath); err == nil {
		filePath = decoded
	}

	// Normalize path to start with /
	if filePath[0] != '/' {
		filePath = "/" + filePath
	}

	var req UpdateFileMetadataRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	// Prepare tags JSON
	tags := req.Tags
	if tags == nil {
		tags = []string{}
	}
	tagsJSON, _ := json.Marshal(tags)

	// Upsert metadata
	var id int64
	var createdAt, updatedAt time.Time

	err := h.db.QueryRow(`
		INSERT INTO file_metadata (user_id, file_path, description, tags, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (user_id, file_path) DO UPDATE SET
			description = COALESCE($3, file_metadata.description),
			tags = $4,
			updated_at = NOW()
		RETURNING id, created_at, updated_at
	`, claims.UserID, filePath, req.Description, tagsJSON).Scan(&id, &createdAt, &updatedAt)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to update file metadata",
		})
	}

	description := ""
	if req.Description != nil {
		description = *req.Description
	}

	return c.JSON(http.StatusOK, FileMetadata{
		ID:          id,
		FilePath:    filePath,
		Description: description,
		Tags:        tags,
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
	})
}

// DeleteFileMetadata removes metadata for a file
func (h *FileMetadataHandler) DeleteFileMetadata(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	filePath := c.Param("*")
	if filePath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "File path required",
		})
	}

	// URL decode the path
	if decoded, err := url.QueryUnescape(filePath); err == nil {
		filePath = decoded
	}

	// Normalize path
	if filePath[0] != '/' {
		filePath = "/" + filePath
	}

	_, err := h.db.Exec(`
		DELETE FROM file_metadata WHERE user_id = $1 AND file_path = $2
	`, claims.UserID, filePath)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to delete file metadata",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
	})
}

// ListUserTags returns all unique tags used by the user (for autocomplete)
func (h *FileMetadataHandler) ListUserTags(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	rows, err := h.db.Query(`
		SELECT DISTINCT jsonb_array_elements_text(tags) as tag
		FROM file_metadata
		WHERE user_id = $1
		ORDER BY tag
	`, claims.UserID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to list tags",
		})
	}
	defer rows.Close()

	tags := []string{}
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err == nil {
			tags = append(tags, tag)
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"tags":  tags,
		"total": len(tags),
	})
}

// SearchByTag finds files with a specific tag
func (h *FileMetadataHandler) SearchByTag(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	tag := c.QueryParam("tag")
	if tag == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Tag parameter required",
		})
	}

	rows, err := h.db.Query(`
		SELECT id, file_path, description, tags, created_at, updated_at
		FROM file_metadata
		WHERE user_id = $1 AND tags ? $2
		ORDER BY file_path
	`, claims.UserID, tag)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to search by tag",
		})
	}
	defer rows.Close()

	files := []FileMetadata{}
	for rows.Next() {
		var metadata FileMetadata
		var tagsJSON []byte
		if err := rows.Scan(&metadata.ID, &metadata.FilePath, &metadata.Description,
			&tagsJSON, &metadata.CreatedAt, &metadata.UpdatedAt); err == nil {
			json.Unmarshal(tagsJSON, &metadata.Tags)
			if metadata.Tags == nil {
				metadata.Tags = []string{}
			}
			files = append(files, metadata)
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"files": files,
		"total": len(files),
		"tag":   tag,
	})
}

// GetBatchMetadata returns metadata for multiple files at once
func (h *FileMetadataHandler) GetBatchMetadata(c echo.Context) error {
	claims := c.Get("user").(*JWTClaims)

	var req struct {
		Paths []string `json:"paths"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if len(req.Paths) == 0 {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"metadata": map[string]FileMetadata{},
		})
	}

	// Build query for multiple paths
	result := make(map[string]FileMetadata)

	for _, path := range req.Paths {
		// Normalize path
		if path != "" && path[0] != '/' {
			path = "/" + path
		}

		var metadata FileMetadata
		var tagsJSON []byte

		err := h.db.QueryRow(`
			SELECT id, file_path, description, tags, created_at, updated_at
			FROM file_metadata
			WHERE user_id = $1 AND file_path = $2
		`, claims.UserID, path).Scan(
			&metadata.ID, &metadata.FilePath, &metadata.Description,
			&tagsJSON, &metadata.CreatedAt, &metadata.UpdatedAt,
		)

		if err == nil {
			json.Unmarshal(tagsJSON, &metadata.Tags)
			if metadata.Tags == nil {
				metadata.Tags = []string{}
			}
			result[path] = metadata
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"metadata": result,
	})
}
