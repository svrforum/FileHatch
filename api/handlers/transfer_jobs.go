package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

// TransferJob represents a server-side transfer job
type TransferJob struct {
	ID              string     `json:"id"`
	UserID          string     `json:"userId"`
	Type            string     `json:"type"`            // copy, move, compress, delete
	Status          string     `json:"status"`          // pending, running, completed, error, cancelled
	SourcePath      string     `json:"sourcePath"`
	DestinationPath string     `json:"destinationPath"`
	TotalBytes      int64      `json:"totalBytes"`
	CopiedBytes     int64      `json:"copiedBytes"`
	TotalFiles      int        `json:"totalFiles"`
	CopiedFiles     int        `json:"copiedFiles"`
	CurrentFile     string     `json:"currentFile,omitempty"`
	BytesPerSec     int64      `json:"bytesPerSec"`
	ErrorMessage    string     `json:"errorMessage,omitempty"`
	Mode            string     `json:"mode,omitempty"`         // merge, overwrite, etc.
	FileConflict    string     `json:"fileConflict,omitempty"` // for merge: overwrite, skip, rename
	DeletePaths     []string   `json:"deletePaths,omitempty"`  // paths to delete (for type=delete)
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	CompletedAt     *time.Time `json:"completedAt,omitempty"`
}

// CreateTransferRequest is the request body for creating a transfer job
type CreateTransferRequest struct {
	Type            string   `json:"type"`            // copy, move, delete
	SourcePath      string   `json:"sourcePath"`
	DestinationPath string   `json:"destinationPath"`
	Overwrite       bool     `json:"overwrite,omitempty"`
	Mode            string   `json:"mode,omitempty"`         // merge
	FileConflict    string   `json:"fileConflict,omitempty"` // overwrite, skip, rename
	Paths           []string `json:"paths,omitempty"`        // paths for bulk operations (delete, copy, move)
}

// TransferProgressEvent is sent via WebSocket for real-time progress
type TransferProgressEvent struct {
	Type        string `json:"type"`        // "transfer_progress"
	JobID       string `json:"jobId"`
	Status      string `json:"status"`
	Progress    int    `json:"progress"`
	TotalFiles  int    `json:"totalFiles"`
	CopiedFiles int    `json:"copiedFiles"`
	TotalBytes  int64  `json:"totalBytes"`
	CopiedBytes int64  `json:"copiedBytes"`
	CurrentFile string `json:"currentFile,omitempty"`
	BytesPerSec int64  `json:"bytesPerSec"`
	ErrorMsg    string `json:"errorMessage,omitempty"`
	NewPath     string `json:"newPath,omitempty"`
	FailedPaths []FailedPathInfo `json:"failedPaths,omitempty"`
}

// FailedPathInfo represents a failed path during a bulk operation (delete, copy, move)
type FailedPathInfo struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

// cancelMap stores cancel functions for running jobs
var (
	transferCancelMap sync.Map // jobID -> context.CancelFunc
)

// BroadcastTransferProgress sends transfer progress to a specific user via WebSocket
func BroadcastTransferProgress(userID string, event TransferProgressEvent) {
	data := mustMarshal(event)

	hub.mu.RLock()
	defer hub.mu.RUnlock()

	for client := range hub.clients {
		if client.userID == userID {
			select {
			case client.send <- data:
			default:
				// Buffer full, skip
			}
		}
	}
}

// ListTransferJobs returns the user's active and recent transfer jobs
func (h *Handler) ListTransferJobs(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	rows, err := h.db.Query(`
		SELECT id, user_id, type, status, source_path, COALESCE(destination_path, ''),
			total_bytes, copied_bytes, total_files, copied_files, COALESCE(current_file, ''),
			bytes_per_sec, COALESCE(error_message, ''), COALESCE(mode, ''), COALESCE(file_conflict, ''),
			created_at, updated_at, completed_at, delete_paths
		FROM transfer_jobs
		WHERE user_id = $1
			AND (status IN ('pending', 'running') OR completed_at > NOW() - INTERVAL '7 days')
		ORDER BY created_at DESC
		LIMIT 50
	`, claims.UserID)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to query transfer jobs"))
	}
	defer rows.Close()

	var jobs []TransferJob
	for rows.Next() {
		var job TransferJob
		var completedAt sql.NullTime
		var deletePathsJSON sql.NullString
		if err := rows.Scan(
			&job.ID, &job.UserID, &job.Type, &job.Status, &job.SourcePath, &job.DestinationPath,
			&job.TotalBytes, &job.CopiedBytes, &job.TotalFiles, &job.CopiedFiles, &job.CurrentFile,
			&job.BytesPerSec, &job.ErrorMessage, &job.Mode, &job.FileConflict,
			&job.CreatedAt, &job.UpdatedAt, &completedAt, &deletePathsJSON,
		); err != nil {
			log.Printf("[TransferJobs] Failed to scan row: %v", err)
			continue
		}
		if completedAt.Valid {
			job.CompletedAt = &completedAt.Time
		}
		if deletePathsJSON.Valid {
			if err := json.Unmarshal([]byte(deletePathsJSON.String), &job.DeletePaths); err != nil {
				log.Printf("[TransferJobs] Failed to unmarshal delete_paths for job %s: %v", job.ID, err)
			}
		}
		jobs = append(jobs, job)
	}

	if jobs == nil {
		jobs = []TransferJob{}
	}
	return RespondSuccess(c, jobs)
}

// GetTransferJob returns details for a specific transfer job
func (h *Handler) GetTransferJob(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	jobID := c.Param("id")
	if jobID == "" {
		return RespondError(c, ErrMissingParameter("id"))
	}

	var job TransferJob
	var completedAt sql.NullTime
	var deletePathsJSON sql.NullString
	err = h.db.QueryRow(`
		SELECT id, user_id, type, status, source_path, COALESCE(destination_path, ''),
			total_bytes, copied_bytes, total_files, copied_files, COALESCE(current_file, ''),
			bytes_per_sec, COALESCE(error_message, ''), COALESCE(mode, ''), COALESCE(file_conflict, ''),
			created_at, updated_at, completed_at, delete_paths
		FROM transfer_jobs
		WHERE id = $1 AND user_id = $2
	`, jobID, claims.UserID).Scan(
		&job.ID, &job.UserID, &job.Type, &job.Status, &job.SourcePath, &job.DestinationPath,
		&job.TotalBytes, &job.CopiedBytes, &job.TotalFiles, &job.CopiedFiles, &job.CurrentFile,
		&job.BytesPerSec, &job.ErrorMessage, &job.Mode, &job.FileConflict,
		&job.CreatedAt, &job.UpdatedAt, &completedAt, &deletePathsJSON,
	)
	if err != nil {
		return RespondError(c, ErrNotFound("Transfer job not found"))
	}
	if completedAt.Valid {
		job.CompletedAt = &completedAt.Time
	}
	if deletePathsJSON.Valid {
		if err := json.Unmarshal([]byte(deletePathsJSON.String), &job.DeletePaths); err != nil {
				log.Printf("[TransferJobs] Failed to unmarshal delete_paths for job %s: %v", job.ID, err)
			}
	}

	return RespondSuccess(c, job)
}

// CreateTransferJob creates a new server-side transfer job
func (h *Handler) CreateTransferJob(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	var req CreateTransferRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrBadRequest("Invalid request"))
	}

	if req.Type == "" {
		return RespondError(c, ErrMissingParameter("type"))
	}
	switch req.Type {
	case "delete":
		if len(req.Paths) == 0 {
			return RespondError(c, ErrMissingParameter("paths"))
		}
		if len(req.Paths) > 10000 {
			return RespondError(c, ErrBadRequest("Too many paths in single request"))
		}
		for _, p := range req.Paths {
			if p == "" {
				return RespondError(c, ErrBadRequest("Empty path in paths array"))
			}
		}
	case "copy", "move":
		// Support both single sourcePath and multiple paths
		if len(req.Paths) > 0 {
			// Bulk mode: validate paths
			if len(req.Paths) > 10000 {
				return RespondError(c, ErrBadRequest("Too many paths: maximum 10000 paths"))
			}
			for _, p := range req.Paths {
				if p == "" {
					return RespondError(c, ErrBadRequest("Empty path in paths array"))
				}
			}
			if req.SourcePath == "" {
				req.SourcePath = req.Paths[0] // Use first path for display/tracking
			}
		} else if req.SourcePath == "" {
			return RespondError(c, ErrMissingParameter("sourcePath or paths"))
		}
		if req.DestinationPath == "" {
			return RespondError(c, ErrMissingParameter("destinationPath"))
		}
	default:
		if req.SourcePath == "" {
			return RespondError(c, ErrMissingParameter("sourcePath"))
		}
	}

	// Serialize paths for bulk operations (delete, copy, move)
	var deletePathsJSON *string
	if len(req.Paths) > 0 {
		data, _ := json.Marshal(req.Paths)
		s := string(data)
		deletePathsJSON = &s
		if req.SourcePath == "" {
			req.SourcePath = req.Paths[0]
		}
	}

	var jobID string
	err = h.db.QueryRow(`
		INSERT INTO transfer_jobs (user_id, type, status, source_path, destination_path, mode, file_conflict, delete_paths)
		VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7)
		RETURNING id
	`, claims.UserID, req.Type, req.SourcePath, req.DestinationPath, req.Mode, req.FileConflict, deletePathsJSON).Scan(&jobID)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to create transfer job"))
	}

	// Execute the transfer in a goroutine
	go h.executeTransferJob(jobID, claims.UserID, claims.Username, c.RealIP(), req)

	return RespondCreated(c, map[string]string{"id": jobID})
}

// CancelTransferJob cancels a running transfer job
func (h *Handler) CancelTransferJob(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	jobID := c.Param("id")
	if jobID == "" {
		return RespondError(c, ErrMissingParameter("id"))
	}

	// Check ownership
	var userID string
	err = h.db.QueryRow(`SELECT user_id FROM transfer_jobs WHERE id = $1`, jobID).Scan(&userID)
	if err != nil {
		return RespondError(c, ErrNotFound("Transfer job not found"))
	}
	if userID != claims.UserID {
		return RespondError(c, ErrForbidden("Not your transfer job"))
	}

	// Cancel the context
	if cancelFn, ok := transferCancelMap.Load(jobID); ok {
		cancelFn.(context.CancelFunc)()
	}

	// Update DB
	_, err = h.db.Exec(`
		UPDATE transfer_jobs SET status = 'cancelled', updated_at = NOW(), completed_at = NOW()
		WHERE id = $1 AND status IN ('pending', 'running')
	`, jobID)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to cancel transfer job"))
	}

	// Broadcast cancellation
	BroadcastTransferProgress(claims.UserID, TransferProgressEvent{
		Type:   "transfer_progress",
		JobID:  jobID,
		Status: "cancelled",
	})

	return RespondSuccess(c, map[string]string{"status": "cancelled"})
}

// executeTransferJob runs the actual transfer operation in a background goroutine
func (h *Handler) executeTransferJob(jobID, userID, username, clientIP string, req CreateTransferRequest) {
	ctx, cancel := context.WithCancel(context.Background())
	transferCancelMap.Store(jobID, cancel)
	defer func() {
		transferCancelMap.Delete(jobID)
		cancel()
	}()

	// Update status to running
	_, _ = h.db.Exec(`UPDATE transfer_jobs SET status = 'running', updated_at = NOW() WHERE id = $1`, jobID)

	// Broadcast running status
	BroadcastTransferProgress(userID, TransferProgressEvent{
		Type:   "transfer_progress",
		JobID:  jobID,
		Status: "running",
	})

	// Resolve paths using a minimal echo context (for ResolveOperationPaths)
	// Since we're in a goroutine, we can't use the original echo context
	// Instead, we use the source and destination directly with the existing copy/move helpers

	cleanSourcePath := req.SourcePath
	if len(cleanSourcePath) > 0 && cleanSourcePath[0] == '/' {
		cleanSourcePath = cleanSourcePath[1:]
	}

	overwrite := req.Overwrite
	isMerge := req.Mode == "merge"
	if isMerge {
		overwrite = false
	}

	// Create a progress sender that updates DB + broadcasts via WebSocket
	lastBroadcast := time.Now()
	isDeleteOp := req.Type == "delete"
	var lastProgress CopyProgress
	progressSender := func(progress CopyProgress) {
		lastProgress = progress
		// Update DB periodically (not every progress event)
		if time.Since(lastBroadcast) > 500*time.Millisecond || progress.Status == "completed" || progress.Status == "error" {
			_, _ = h.db.Exec(`
				UPDATE transfer_jobs SET
					total_bytes = $2, copied_bytes = $3, total_files = $4, copied_files = $5,
					current_file = $6, bytes_per_sec = $7, updated_at = NOW()
				WHERE id = $1
			`, jobID, progress.TotalBytes, progress.CopiedBytes, progress.TotalFiles, progress.CopiedFiles,
				progress.CurrentFile, progress.BytesPerSec)
			lastBroadcast = time.Now()
		}

		// Calculate progress percentage: use file count for delete ops (no bytes), bytes otherwise
		progressPercent := 0
		if isDeleteOp || progress.TotalBytes == 0 {
			if progress.TotalFiles > 0 {
				progressPercent = int(progress.CopiedFiles * 100 / progress.TotalFiles)
			}
		} else if progress.TotalBytes > 0 {
			progressPercent = int(progress.CopiedBytes * 100 / progress.TotalBytes)
		}

		// Always broadcast via WebSocket for real-time UI
		BroadcastTransferProgress(userID, TransferProgressEvent{
			Type:        "transfer_progress",
			JobID:       jobID,
			Status:      progress.Status,
			Progress:    progressPercent,
			TotalFiles:  progress.TotalFiles,
			CopiedFiles: progress.CopiedFiles,
			TotalBytes:  progress.TotalBytes,
			CopiedBytes: progress.CopiedBytes,
			CurrentFile: progress.CurrentFile,
			BytesPerSec: progress.BytesPerSec,
			NewPath:     progress.NewPath,
		})
	}

	// Execute the actual operation using a simulated echo context approach
	// We'll use the handler's internal methods directly
	var jobErr error
	var newDisplayPath string
	var deleteFailedPaths []FailedPathInfo

	// We need to build a JWTClaims for the resolveStorageForOperation
	claims := &JWTClaims{
		UserID:   userID,
		Username: username,
	}

	switch req.Type {
	case "copy", "move":
		if len(req.Paths) > 1 {
			// Bulk copy/move: multiple source paths
			newDisplayPath, deleteFailedPaths, jobErr = h.executeTransferBulkCopyMove(ctx, claims, req.Paths, req.DestinationPath, req.Type, overwrite, isMerge, req.FileConflict, progressSender)
		} else {
			newDisplayPath, jobErr = h.executeTransferCopyMove(ctx, claims, cleanSourcePath, req.DestinationPath, req.Type, overwrite, isMerge, req.FileConflict, progressSender)
		}
	case "delete":
		deleteFailedPaths, jobErr = h.executeTransferDelete(ctx, claims, clientIP, req.Paths, progressSender)
	default:
		jobErr = ErrBadRequest("Unsupported transfer type for server-side job: " + req.Type)
	}

	// Update final status
	if jobErr != nil {
		// Check if context was cancelled
		if ctx.Err() != nil {
			_, _ = h.db.Exec(`
				UPDATE transfer_jobs SET status = 'cancelled', error_message = 'Cancelled by user', updated_at = NOW(), completed_at = NOW()
				WHERE id = $1
			`, jobID)
			BroadcastTransferProgress(userID, TransferProgressEvent{
				Type:   "transfer_progress",
				JobID:  jobID,
				Status: "cancelled",
			})
		} else {
			errMsg := jobErr.Error()
			_, _ = h.db.Exec(`
				UPDATE transfer_jobs SET status = 'error', error_message = $2,
					total_files = $3, copied_files = $4, total_bytes = $5, copied_bytes = $6,
					updated_at = NOW(), completed_at = NOW()
				WHERE id = $1
			`, jobID, errMsg, lastProgress.TotalFiles, lastProgress.CopiedFiles, lastProgress.TotalBytes, lastProgress.CopiedBytes)
			BroadcastTransferProgress(userID, TransferProgressEvent{
				Type:        "transfer_progress",
				JobID:       jobID,
				Status:      "error",
				ErrorMsg:    errMsg,
				FailedPaths: deleteFailedPaths,
			})
		}
		return
	}

	// Success — flush final progress to DB and broadcast with complete info
	_, _ = h.db.Exec(`
		UPDATE transfer_jobs SET status = 'completed',
			total_bytes = $2, copied_bytes = $3, total_files = $4, copied_files = $5,
			bytes_per_sec = $6, updated_at = NOW(), completed_at = NOW()
		WHERE id = $1
	`, jobID, lastProgress.TotalBytes, lastProgress.CopiedBytes, lastProgress.TotalFiles, lastProgress.CopiedFiles, lastProgress.BytesPerSec)

	finalProgress := 100
	if lastProgress.TotalFiles == 0 && lastProgress.TotalBytes == 0 {
		finalProgress = 0
	}
	BroadcastTransferProgress(userID, TransferProgressEvent{
		Type:        "transfer_progress",
		JobID:       jobID,
		Status:      "completed",
		Progress:    finalProgress,
		TotalFiles:  lastProgress.TotalFiles,
		CopiedFiles: lastProgress.TotalFiles,
		TotalBytes:  lastProgress.TotalBytes,
		CopiedBytes: lastProgress.TotalBytes,
		BytesPerSec: lastProgress.BytesPerSec,
		NewPath:     newDisplayPath,
	})

	// Log audit event (delete audit is handled inside executeTransferDelete)
	if req.Type != "delete" {
		eventType := EventFileCopy
		if req.Type == "move" {
			eventType = EventFileMove
		}
		if len(req.Paths) > 1 {
			// Bulk copy/move: log each path
			for _, p := range req.Paths {
				_ = h.auditHandler.LogEvent(&userID, clientIP, eventType, p, map[string]interface{}{
					"destination": newDisplayPath,
					"serverSide":  true,
					"bulk":        true,
					"totalPaths":  len(req.Paths),
				})
			}
		} else {
			_ = h.auditHandler.LogEvent(&userID, clientIP, eventType, req.SourcePath, map[string]interface{}{
				"destination": newDisplayPath,
				"serverSide":  true,
			})
		}
	}
}

// executeTransferCopyMove performs the actual copy/move operation
func (h *Handler) executeTransferCopyMove(
	ctx context.Context,
	claims *JWTClaims,
	sourcePath, destination, opType string,
	overwrite, isMerge bool,
	fileConflict string,
	sendProgress ProgressSender,
) (string, error) {
	// Resolve source path
	srcResult, srcRealPath, err := h.resolveStorageForOperation("/"+sourcePath, claims)
	if err != nil {
		return "", ErrBadRequest(err.Error())
	}
	if srcResult.StorageType == "root" {
		return "", ErrBadRequest("Cannot operate on root")
	}

	// Resolve destination path
	destResult, destRealPath, err := h.resolveStorageForOperation(destination, claims)
	if err != nil {
		return "", ErrBadRequest(err.Error())
	}
	if destResult.StorageType == "root" {
		return "", ErrBadRequest("Cannot operate to root")
	}

	// Check readonly
	if err := checkReadonly(destResult); err != nil {
		return "", ErrForbidden(err.Error())
	}

	srcIsNonLocal := srcResult.StorageType == StorageExternal && srcRealPath == ""
	destIsNonLocal := destResult.StorageType == StorageExternal && destRealPath == ""

	// Get source info
	var srcName string
	var srcIsDir bool
	var srcInfo interface{} // placeholder

	if srcIsNonLocal {
		bgCtx := context.Background()
		info, err := srcResult.Backend.Stat(bgCtx, srcResult.RelPath)
		if err != nil {
			return "", ErrNotFound("Source not found")
		}
		srcName = info.FileName
		srcIsDir = info.IsDirectory
	} else {
		sInfo, err := os.Stat(srcRealPath)
		if err != nil {
			return "", err
		}
		srcName = sInfo.Name()
		srcIsDir = sInfo.IsDir()
		srcInfo = sInfo
	}
	_ = srcInfo

	// Calculate stats
	var stats FileStats
	if srcIsNonLocal {
		stats = CalculateTotalSizeBackend(context.Background(), srcResult.Backend, srcResult.RelPath, srcIsDir)
	} else {
		osInfo, _ := os.Stat(srcRealPath)
		if osInfo != nil {
			stats = CalculateTotalSize(srcRealPath, osInfo)
		}
	}

	sendProgress(CopyProgress{
		Status:     "started",
		TotalBytes: stats.TotalBytes,
		TotalFiles: stats.TotalFiles,
	})

	var newDisplayPath string

	if srcIsNonLocal || destIsNonLocal {
		// Cross-backend operations — use the passed context for cancellation
		destItemRelPath := filepath.Join(destResult.RelPath, srcName)

		if opType == "copy" {
			if srcIsDir {
				err = crossBackendCopyDir(ctx, srcResult.Backend, srcResult.RelPath, destResult.Backend, destItemRelPath)
			} else {
				err = crossBackendCopyFile(ctx, srcResult.Backend, srcResult.RelPath, destResult.Backend, destItemRelPath)
			}
		} else {
			// Move = copy + delete source
			if srcIsDir {
				err = crossBackendCopyDir(ctx, srcResult.Backend, srcResult.RelPath, destResult.Backend, destItemRelPath)
			} else {
				err = crossBackendCopyFile(ctx, srcResult.Backend, srcResult.RelPath, destResult.Backend, destItemRelPath)
			}
			if err == nil {
				if srcIsNonLocal {
					_ = srcResult.Backend.DeleteAll(ctx, srcResult.RelPath)
				}
			}
		}
		if err != nil {
			return "", err
		}
		newDisplayPath = filepath.Join(destResult.DisplayPath, srcName)
	} else {
		// Both local — use context for cancellation support
		copyCtx := NewCopyContextWithCancel(stats, sendProgress, ctx)

		if isMerge && srcIsDir {
			mergeDst := filepath.Join(destRealPath, srcName)
			if fileConflict == "" {
				fileConflict = "rename"
			}
			err = copyCtx.CopyDirWithMerge(srcRealPath, mergeDst, fileConflict)
			newDisplayPath = filepath.Join(destResult.DisplayPath, srcName)
		} else {
			var finalDestPath string
			if overwrite {
				finalDestPath = filepath.Join(destRealPath, srcName)
			} else {
				finalDestPath = GenerateUniquePath(destRealPath, srcName, srcIsDir, false)
			}

			doCopy := func() error {
				return copyCtx.CopyWithProgress(srcRealPath, finalDestPath, srcIsDir)
			}

			if overwrite {
				if _, statErr := os.Stat(finalDestPath); statErr == nil {
					err = SafeOverwrite(finalDestPath, srcIsDir, doCopy)
				} else {
					err = doCopy()
				}
			} else {
				err = doCopy()
			}

			newDisplayPath = filepath.Join(destResult.DisplayPath, filepath.Base(finalDestPath))

			// For move: delete source after successful copy
			if err == nil && opType == "move" {
				if srcIsDir {
					_ = os.RemoveAll(srcRealPath)
				} else {
					_ = os.Remove(srcRealPath)
				}
			}
		}

		if err != nil {
			return "", err
		}

		// Update storage tracking
		if claims != nil && destResult.StorageType == StorageHome {
			_ = h.UpdateUserStorage(claims.UserID, copyCtx.CopiedBytes)
		}
	}

	return newDisplayPath, nil
}

// executeTransferBulkCopyMove performs bulk copy/move for multiple source paths.
// It iterates over each source path, executing copy/move individually, and continues on error.
// Returns the destination display path, any failed paths, and an overall error summary.
func (h *Handler) executeTransferBulkCopyMove(
	ctx context.Context,
	claims *JWTClaims,
	paths []string,
	destination, opType string,
	overwrite, isMerge bool,
	fileConflict string,
	sendProgress ProgressSender,
) (string, []FailedPathInfo, error) {
	totalPaths := len(paths)

	sendProgress(CopyProgress{
		Status:     "started",
		TotalFiles: totalPaths,
	})

	processedFiles := 0
	var failures []FailedPathInfo
	var lastNewPath string

	for i, srcPath := range paths {
		// Check for cancellation
		if ctx.Err() != nil {
			return lastNewPath, failures, ctx.Err()
		}

		cleanSrc := srcPath
		if len(cleanSrc) > 0 && cleanSrc[0] == '/' {
			cleanSrc = cleanSrc[1:]
		}

		// Send progress with current file before starting
		sendProgress(CopyProgress{
			Status:      "progress",
			TotalFiles:  totalPaths,
			CopiedFiles: processedFiles,
			CurrentFile: fmt.Sprintf("%d/%d: %s", i+1, totalPaths, filepath.Base(srcPath)),
		})

		// Create a sub-progress sender that maps the inner copy/move progress
		// but keeps the outer file count progress
		innerProgress := func(p CopyProgress) {
			// Forward inner progress but override the file counts with bulk counts
			p.TotalFiles = totalPaths
			p.CopiedFiles = processedFiles
			p.CurrentFile = fmt.Sprintf("%d/%d: %s", i+1, totalPaths, filepath.Base(srcPath))
			if p.Status == "completed" {
				p.Status = "progress" // inner completion is just progress for the outer loop
			}
			sendProgress(p)
		}

		newPath, err := h.executeTransferCopyMove(ctx, claims, cleanSrc, destination, opType, overwrite, isMerge, fileConflict, innerProgress)
		if err != nil {
			// Check if context was cancelled during the inner operation
			if ctx.Err() != nil {
				return lastNewPath, failures, ctx.Err()
			}
			log.Printf("[Transfer] Bulk %s error for %s: %v", opType, srcPath, err)
			failures = append(failures, FailedPathInfo{Path: srcPath, Error: err.Error()})
		} else {
			lastNewPath = newPath
		}

		processedFiles++

		// Send progress after each item
		sendProgress(CopyProgress{
			Status:      "progress",
			TotalFiles:  totalPaths,
			CopiedFiles: processedFiles,
			CurrentFile: filepath.Base(srcPath),
		})
	}

	if len(failures) > 0 {
		successCount := totalPaths - len(failures)
		if successCount == 0 {
			return lastNewPath, failures, fmt.Errorf("all %d items failed to %s", len(failures), opType)
		}
		return lastNewPath, failures, fmt.Errorf("%d succeeded, %d failed", successCount, len(failures))
	}

	return lastNewPath, nil, nil
}

// executeTransferDelete performs server-side batch delete (move to trash)
// Returns failed paths and error (if any)
func (h *Handler) executeTransferDelete(
	ctx context.Context,
	claims *JWTClaims,
	clientIP string,
	paths []string,
	sendProgress ProgressSender,
) ([]FailedPathInfo, error) {
	// Use path count for progress (each path = 1 unit for smooth progress)
	totalFiles := len(paths)

	sendProgress(CopyProgress{
		Status:     "started",
		TotalFiles: totalFiles,
	})

	processedFiles := 0
	var failures []FailedPathInfo

	for _, p := range paths {
		// Check for cancellation
		if ctx.Err() != nil {
			return failures, ctx.Err()
		}

		// Resolve path
		result, realPath, err := h.resolveStorageForOperation(p, claims)
		if err != nil {
			failures = append(failures, FailedPathInfo{Path: p, Error: err.Error()})
			processedFiles++
			sendProgress(CopyProgress{Status: "progress", TotalFiles: totalFiles, CopiedFiles: processedFiles})
			continue
		}

		storageType := result.StorageType
		displayPath := result.DisplayPath

		if storageType == "root" || displayPath == "/home" || displayPath == "/shared" {
			failures = append(failures, FailedPathInfo{Path: p, Error: "cannot delete root folders"})
			processedFiles++
			sendProgress(CopyProgress{Status: "progress", TotalFiles: totalFiles, CopiedFiles: processedFiles})
			continue
		}

		// Check readonly
		if err := checkReadonly(result); err != nil {
			failures = append(failures, FailedPathInfo{Path: p, Error: err.Error()})
			processedFiles++
			sendProgress(CopyProgress{Status: "progress", TotalFiles: totalFiles, CopiedFiles: processedFiles})
			continue
		}

		// Check file lock
		if lockErr := h.CheckFileLockForOperation(displayPath, claims.UserID); lockErr != nil {
			failures = append(failures, FailedPathInfo{Path: p, Error: lockErr.Message})
			processedFiles++
			sendProgress(CopyProgress{Status: "progress", TotalFiles: totalFiles, CopiedFiles: processedFiles})
			continue
		}
		if lockErr := h.CheckFolderLocksForOperation(displayPath, claims.UserID); lockErr != nil {
			failures = append(failures, FailedPathInfo{Path: p, Error: lockErr.Message})
			processedFiles++
			sendProgress(CopyProgress{Status: "progress", TotalFiles: totalFiles, CopiedFiles: processedFiles})
			continue
		}

		// Create trash directory
		trashPath := h.getTrashPath(claims.Username)
		if err := os.MkdirAll(trashPath, 0755); err != nil {
			failures = append(failures, FailedPathInfo{Path: p, Error: "failed to create trash directory"})
			processedFiles++
			sendProgress(CopyProgress{Status: "progress", TotalFiles: totalFiles, CopiedFiles: processedFiles})
			continue
		}

		// Determine item info
		var itemName string
		var isDir bool
		var size int64

		isNonLocal := storageType == StorageExternal && realPath == ""
		if isNonLocal {
			bgCtx := context.Background()
			info, err := result.Backend.Stat(bgCtx, result.RelPath)
			if err != nil {
				failures = append(failures, FailedPathInfo{Path: p, Error: "item not found"})
				processedFiles++
				sendProgress(CopyProgress{Status: "progress", TotalFiles: totalFiles, CopiedFiles: processedFiles})
				continue
			}
			itemName = info.FileName
			isDir = info.IsDirectory
			size = info.FileSize
			if isDir {
				stats := CalculateTotalSizeBackend(bgCtx, result.Backend, result.RelPath, true)
				size = stats.TotalBytes
			}
		} else {
			info, err := os.Stat(realPath)
			if err != nil {
				failures = append(failures, FailedPathInfo{Path: p, Error: "item not found"})
				processedFiles++
				sendProgress(CopyProgress{Status: "progress", TotalFiles: totalFiles, CopiedFiles: processedFiles})
				continue
			}
			itemName = info.Name()
			isDir = info.IsDir()
			size = info.Size()
			if isDir {
				stats := CalculateTotalSize(realPath, info)
				size = stats.TotalBytes
			}
		}

		// Send progress with current file
		sendProgress(CopyProgress{
			Status:      "progress",
			TotalFiles:  totalFiles,
			CopiedFiles: processedFiles,
			CurrentFile: itemName,
		})

		// Perform the actual move to trash
		trashID := fmt.Sprintf("%d_%s", time.Now().UnixNano(), itemName)
		trashItemPath := filepath.Join(trashPath, trashID)

		if isNonLocal {
			bgCtx := context.Background()
			if isDir {
				if err := downloadDirToLocal(bgCtx, result.Backend, result.RelPath, trashItemPath); err != nil {
					failures = append(failures, FailedPathInfo{Path: p, Error: err.Error()})
					processedFiles++
					sendProgress(CopyProgress{Status: "progress", TotalFiles: totalFiles, CopiedFiles: processedFiles})
					continue
				}
			} else {
				if err := downloadFileToLocal(bgCtx, result.Backend, result.RelPath, trashItemPath); err != nil {
					failures = append(failures, FailedPathInfo{Path: p, Error: err.Error()})
					processedFiles++
					sendProgress(CopyProgress{Status: "progress", TotalFiles: totalFiles, CopiedFiles: processedFiles})
					continue
				}
			}
			if err := result.Backend.DeleteAll(bgCtx, result.RelPath); err != nil {
				failures = append(failures, FailedPathInfo{Path: p, Error: err.Error()})
				processedFiles++
				sendProgress(CopyProgress{Status: "progress", TotalFiles: totalFiles, CopiedFiles: processedFiles})
				continue
			}
			if isDir {
				dirSize, _ := h.calculateDirSize(trashItemPath)
				size = dirSize
			}

			meta, _ := h.loadTrashMeta(claims.Username)
			meta[trashID] = TrashItem{
				ID:           trashID,
				Name:         itemName,
				OriginalPath: displayPath,
				Size:         size,
				IsDir:        isDir,
				DeletedAt:    time.Now(),
				StorageType:  StorageExternal,
				MountID:      result.MountID,
			}
			_ = h.saveTrashMeta(claims.Username, meta)
		} else {
			if err := moveOrCopy(realPath, trashItemPath); err != nil {
				failures = append(failures, FailedPathInfo{Path: p, Error: err.Error()})
				processedFiles++
				sendProgress(CopyProgress{Status: "progress", TotalFiles: totalFiles, CopiedFiles: processedFiles})
				continue
			}
			if isDir {
				dirSize, _ := h.calculateDirSize(trashItemPath)
				size = dirSize
			}

			meta, _ := h.loadTrashMeta(claims.Username)
			trashItem := TrashItem{
				ID:           trashID,
				Name:         itemName,
				OriginalPath: displayPath,
				Size:         size,
				IsDir:        isDir,
				DeletedAt:    time.Now(),
				StorageType:  storageType,
			}
			if storageType == StorageExternal && result.MountID != "" {
				trashItem.MountID = result.MountID
			}
			meta[trashID] = trashItem
			_ = h.saveTrashMeta(claims.Username, meta)

			// Update storage tracking for non-external items
			if storageType != StorageExternal {
				_ = h.UpdateStorageForMove(claims.UserID, size, true)
			}
		}

		// Clean up locks
		_ = h.RemoveLockByPath(displayPath)
		if isDir {
			_ = h.RemoveLocksUnderPath(displayPath)
		}

		// Log audit event for each item
		_ = h.auditHandler.LogEvent(&claims.UserID, clientIP, EventFileDelete, displayPath, map[string]interface{}{
			"isDir":      isDir,
			"size":       size,
			"trashId":    trashID,
			"serverSide": true,
		})

		processedFiles++

		// Send progress after each item
		sendProgress(CopyProgress{
			Status:      "progress",
			TotalFiles:  totalFiles,
			CopiedFiles: processedFiles,
			CurrentFile: itemName,
		})
	}

	if len(failures) > 0 {
		successCount := len(paths) - len(failures)
		if successCount == 0 {
			return failures, fmt.Errorf("all %d items failed to delete", len(failures))
		}
		return failures, fmt.Errorf("%d succeeded, %d failed", successCount, len(failures))
	}

	return nil, nil
}

// ClearCompletedTransferJobs deletes all completed/error/cancelled transfer jobs for the current user
func (h *Handler) ClearCompletedTransferJobs(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	_, err = h.db.Exec(`
		DELETE FROM transfer_jobs
		WHERE user_id = $1 AND status IN ('completed', 'error', 'cancelled')
	`, claims.UserID)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to clear completed jobs"))
	}

	return RespondSuccess(c, map[string]bool{"success": true})
}

// Cleanup goroutine to remove old completed jobs
func (h *Handler) StartTransferJobCleanup() {
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			_, err := h.db.Exec(`
				DELETE FROM transfer_jobs
				WHERE status IN ('completed', 'error', 'cancelled')
				AND completed_at < NOW() - INTERVAL '14 days'
			`)
			if err != nil {
				log.Printf("[TransferJobs] Cleanup error: %v", err)
			}
		}
	}()
}
