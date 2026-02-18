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
	Paths           []string `json:"paths,omitempty"`        // paths for delete operation
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
			AND (status IN ('pending', 'running') OR completed_at > NOW() - INTERVAL '1 hour')
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
	if req.Type == "delete" {
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
	} else {
		if req.SourcePath == "" {
			return RespondError(c, ErrMissingParameter("sourcePath"))
		}
		if (req.Type == "copy" || req.Type == "move") && req.DestinationPath == "" {
			return RespondError(c, ErrMissingParameter("destinationPath"))
		}
	}

	var deletePathsJSON *string
	if req.Type == "delete" {
		data, _ := json.Marshal(req.Paths)
		s := string(data)
		deletePathsJSON = &s
		// Use first path as source_path for display
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
	progressSender := func(progress CopyProgress) {
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

		// Always broadcast via WebSocket for real-time UI
		progressPercent := 0
		if progress.TotalBytes > 0 {
			progressPercent = int(progress.CopiedBytes * 100 / progress.TotalBytes)
		}
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

	// We need to build a JWTClaims for the resolveStorageForOperation
	claims := &JWTClaims{
		UserID:   userID,
		Username: username,
	}

	switch req.Type {
	case "copy", "move":
		newDisplayPath, jobErr = h.executeTransferCopyMove(ctx, claims, cleanSourcePath, req.DestinationPath, req.Type, overwrite, isMerge, req.FileConflict, progressSender)
	case "delete":
		jobErr = h.executeTransferDelete(ctx, claims, clientIP, req.Paths, progressSender)
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
				UPDATE transfer_jobs SET status = 'error', error_message = $2, updated_at = NOW(), completed_at = NOW()
				WHERE id = $1
			`, jobID, errMsg)
			BroadcastTransferProgress(userID, TransferProgressEvent{
				Type:     "transfer_progress",
				JobID:    jobID,
				Status:   "error",
				ErrorMsg: errMsg,
			})
		}
		return
	}

	// Success
	_, _ = h.db.Exec(`
		UPDATE transfer_jobs SET status = 'completed', updated_at = NOW(), completed_at = NOW()
		WHERE id = $1
	`, jobID)

	BroadcastTransferProgress(userID, TransferProgressEvent{
		Type:    "transfer_progress",
		JobID:   jobID,
		Status:  "completed",
		NewPath: newDisplayPath,
	})

	// Log audit event (delete audit is handled inside executeTransferDelete)
	if req.Type != "delete" {
		eventType := EventFileCopy
		if req.Type == "move" {
			eventType = EventFileMove
		}
		_ = h.auditHandler.LogEvent(&userID, clientIP, eventType, req.SourcePath, map[string]interface{}{
			"destination": newDisplayPath,
			"serverSide":  true,
		})
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

// countFilesForDelete counts the total number of files to be deleted.
// Folders are counted as the number of files they contain (recursively), not as 1.
func (h *Handler) countFilesForDelete(claims *JWTClaims, paths []string) int {
	total := 0
	for _, p := range paths {
		result, realPath, err := h.resolveStorageForOperation(p, claims)
		if err != nil {
			total++ // count as 1 if we can't resolve
			continue
		}

		isNonLocal := result.StorageType == StorageExternal && realPath == ""
		if isNonLocal {
			bgCtx := context.Background()
			info, err := result.Backend.Stat(bgCtx, result.RelPath)
			if err != nil {
				total++
				continue
			}
			if info.IsDirectory {
				stats := CalculateTotalSizeBackend(bgCtx, result.Backend, result.RelPath, true)
				if stats.TotalFiles > 0 {
					total += stats.TotalFiles
				} else {
					total++ // empty folder counts as 1
				}
			} else {
				total++
			}
		} else {
			info, err := os.Stat(realPath)
			if err != nil {
				total++
				continue
			}
			if info.IsDir() {
				stats := CalculateTotalSize(realPath, info)
				if stats.TotalFiles > 0 {
					total += stats.TotalFiles
				} else {
					total++ // empty folder counts as 1
				}
			} else {
				total++
			}
		}
	}
	return total
}

// executeTransferDelete performs server-side batch delete (move to trash)
func (h *Handler) executeTransferDelete(
	ctx context.Context,
	claims *JWTClaims,
	clientIP string,
	paths []string,
	sendProgress ProgressSender,
) error {
	// Count total files for accurate progress
	totalFiles := h.countFilesForDelete(claims, paths)
	if totalFiles == 0 {
		totalFiles = len(paths)
	}

	sendProgress(CopyProgress{
		Status:     "started",
		TotalFiles: totalFiles,
	})

	processedFiles := 0
	var failures []string

	for _, p := range paths {
		// Check for cancellation
		if ctx.Err() != nil {
			return ctx.Err()
		}

		// Resolve path
		result, realPath, err := h.resolveStorageForOperation(p, claims)
		if err != nil {
			failures = append(failures, fmt.Sprintf("%s: %s", p, err.Error()))
			processedFiles++
			continue
		}

		storageType := result.StorageType
		displayPath := result.DisplayPath

		if storageType == "root" || displayPath == "/home" || displayPath == "/shared" {
			failures = append(failures, fmt.Sprintf("%s: cannot delete root folders", p))
			processedFiles++
			continue
		}

		// Check readonly
		if err := checkReadonly(result); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %s", p, err.Error()))
			processedFiles++
			continue
		}

		// Check file lock
		if lockErr := h.CheckFileLockForOperation(displayPath, claims.UserID); lockErr != nil {
			failures = append(failures, fmt.Sprintf("%s: %s", p, lockErr.Message))
			processedFiles++
			continue
		}
		if lockErr := h.CheckFolderLocksForOperation(displayPath, claims.UserID); lockErr != nil {
			failures = append(failures, fmt.Sprintf("%s: %s", p, lockErr.Message))
			processedFiles++
			continue
		}

		// Create trash directory
		trashPath := h.getTrashPath(claims.Username)
		if err := os.MkdirAll(trashPath, 0755); err != nil {
			failures = append(failures, fmt.Sprintf("%s: failed to create trash directory", p))
			processedFiles++
			continue
		}

		// Determine file count for this item (for progress)
		var itemFileCount int
		var itemName string
		var isDir bool
		var size int64

		isNonLocal := storageType == StorageExternal && realPath == ""
		if isNonLocal {
			bgCtx := context.Background()
			info, err := result.Backend.Stat(bgCtx, result.RelPath)
			if err != nil {
				failures = append(failures, fmt.Sprintf("%s: item not found", p))
				processedFiles++
				continue
			}
			itemName = info.FileName
			isDir = info.IsDirectory
			size = info.FileSize
			if isDir {
				stats := CalculateTotalSizeBackend(bgCtx, result.Backend, result.RelPath, true)
				if stats.TotalFiles > 0 {
					itemFileCount = stats.TotalFiles
				} else {
					itemFileCount = 1
				}
				size = stats.TotalBytes
			} else {
				itemFileCount = 1
			}
		} else {
			info, err := os.Stat(realPath)
			if err != nil {
				failures = append(failures, fmt.Sprintf("%s: item not found", p))
				processedFiles++
				continue
			}
			itemName = info.Name()
			isDir = info.IsDir()
			size = info.Size()
			if isDir {
				stats := CalculateTotalSize(realPath, info)
				if stats.TotalFiles > 0 {
					itemFileCount = stats.TotalFiles
				} else {
					itemFileCount = 1
				}
				size = stats.TotalBytes
			} else {
				itemFileCount = 1
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
					failures = append(failures, fmt.Sprintf("%s: %s", p, err.Error()))
					processedFiles += itemFileCount
					continue
				}
			} else {
				if err := downloadFileToLocal(bgCtx, result.Backend, result.RelPath, trashItemPath); err != nil {
					failures = append(failures, fmt.Sprintf("%s: %s", p, err.Error()))
					processedFiles += itemFileCount
					continue
				}
			}
			if err := result.Backend.DeleteAll(bgCtx, result.RelPath); err != nil {
				failures = append(failures, fmt.Sprintf("%s: %s", p, err.Error()))
				processedFiles += itemFileCount
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
				failures = append(failures, fmt.Sprintf("%s: %s", p, err.Error()))
				processedFiles += itemFileCount
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

		processedFiles += itemFileCount

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
			return fmt.Errorf("all %d items failed to delete", len(failures))
		}
		return fmt.Errorf("%d succeeded, %d failed", successCount, len(failures))
	}

	return nil
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
				AND completed_at < NOW() - INTERVAL '24 hours'
			`)
			if err != nil {
				log.Printf("[TransferJobs] Cleanup error: %v", err)
			}
		}
	}()
}
