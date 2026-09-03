package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/labstack/echo/v4"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

const (
	userImportMaxBytes       = 5 * 1024 * 1024
	userImportMaxRows        = 1000
	userImportPreviewRows    = 100
	userImportQueueSize      = 8
	userImportWorkerCount    = 2
	userImportExpiry         = 24 * time.Hour
	userImportMaxResultLimit = 200
	userImportMaxQuotaGB     = 1024 * 1024
)

var (
	userImportHeaders = []string{
		"username",
		"email",
		"password",
		"is_admin",
		"storage_quota_gb",
	}
	userImportAllowedHeaders = map[string]struct{}{
		"username":         {},
		"email":            {},
		"password":         {},
		"is_admin":         {},
		"storage_quota_gb": {},
	}
)

// UserImportOptions isolates integrations that may differ between deployments.
type UserImportOptions struct {
	DataRoot         string
	Workers          int
	QueueSize        int
	AuditHandler     *AuditHandler
	PasswordPolicies PasswordPolicyProvider
	ValidatePassword func(context.Context, string) error
	PolicyRevision   func(context.Context) (string, error)
	CreateHomeDir    func(string) error
	HashPassword     func([]byte) ([]byte, error)
	Now              func() time.Time
}

// UserImportHandler implements administrator-owned, asynchronous CSV imports.
type UserImportHandler struct {
	db               *sql.DB
	validatePassword func(context.Context, string) error
	policyRevision   func(context.Context) (string, error)
	createHomeDir    func(string) error
	hashPassword     func([]byte) ([]byte, error)
	now              func() time.Time
	jobs             chan userImportWork
	stop             chan struct{}
	closeOnce        sync.Once
	workers          sync.WaitGroup
	audit            *AuditHandler
	ownsAudit        bool
}

type userImportWork struct {
	jobID      string
	adminID    string
	adminName  string
	clientIP   string
	rows       []userImportRow
	validation userImportValidation
}

type userImportRow struct {
	RowNumber   int
	Username    string
	Email       string
	Password    string
	IsAdmin     bool
	StorageByte int64
}

type userImportRowResult struct {
	RowNumber int    `json:"row"`
	Username  string `json:"username"`
	Email     string `json:"email,omitempty"`
	Status    string `json:"status"`
	Code      string `json:"code,omitempty"`
	Message   string `json:"message,omitempty"`
	Retryable bool   `json:"retryable"`
}

type userImportSummary struct {
	Total    int `json:"total"`
	Created  int `json:"created"`
	Warnings int `json:"warnings"`
	Failed   int `json:"failed"`
	Skipped  int `json:"skipped"`
}

type userImportValidation struct {
	Digest         string                `json:"digest"`
	PolicyRevision string                `json:"policyRevision"`
	ExpiresAt      time.Time             `json:"expiresAt"`
	TotalRows      int                   `json:"totalRows"`
	ValidRows      int                   `json:"validRows"`
	InvalidRows    int                   `json:"invalidRows"`
	Summary        userImportSummary     `json:"summary"`
	Rows           []userImportRow       `json:"-"`
	Results        []userImportRowResult `json:"rows"`
	Valid          bool                  `json:"valid"`
}

type userImportJob struct {
	ID             string                `json:"id"`
	Status         string                `json:"status"`
	Digest         string                `json:"digest"`
	PolicyRevision string                `json:"policyRevision"`
	TotalRows      int                   `json:"totalRows"`
	CreatedCount   int                   `json:"createdCount"`
	WarningCount   int                   `json:"warningCount"`
	FailedCount    int                   `json:"failedCount"`
	SkippedCount   int                   `json:"skippedCount"`
	FailureCode    string                `json:"failureCode,omitempty"`
	Results        []userImportRowResult `json:"rows"`
	CreatedAt      time.Time             `json:"createdAt"`
	CompletedAt    *time.Time            `json:"completedAt,omitempty"`
	ExpiresAt      time.Time             `json:"expiresAt"`
	Summary        userImportSummary     `json:"summary"`
	ResultTotal    int                   `json:"resultTotal"`
	Offset         int                   `json:"offset"`
	Limit          int                   `json:"limit"`
}

// NewUserImportHandler starts a bounded worker pool and marks unsafe-to-resume
// jobs from an earlier process as failed.
func NewUserImportHandler(db *sql.DB, options UserImportOptions) *UserImportHandler {
	now := options.Now
	if now == nil {
		now = time.Now
	}

	validatePassword := options.ValidatePassword
	if validatePassword == nil && options.PasswordPolicies != nil {
		validatePassword = func(ctx context.Context, password string) error {
			policy, err := options.PasswordPolicies.GetPasswordPolicy(ctx)
			if err != nil {
				return err
			}
			return ValidatePasswordWithPolicy(password, policy)
		}
	}
	if validatePassword == nil {
		validatePassword = func(_ context.Context, password string) error {
			return ValidatePassword(password)
		}
	}

	policyRevision := options.PolicyRevision
	if policyRevision == nil && options.PasswordPolicies != nil {
		policyRevision = func(ctx context.Context) (string, error) {
			policy, err := options.PasswordPolicies.GetPasswordPolicy(ctx)
			if err != nil {
				return "", err
			}
			return policy.Revision, nil
		}
	}
	if policyRevision == nil {
		policyRevision = func(ctx context.Context) (string, error) {
			return readPasswordPolicyRevision(ctx, db)
		}
	}

	dataRoot := options.DataRoot
	if dataRoot == "" {
		dataRoot = "/data"
	}
	createHomeDir := options.CreateHomeDir
	if createHomeDir == nil {
		createHomeDir = func(username string) error {
			return os.MkdirAll(filepath.Join(dataRoot, "users", username), 0o755)
		}
	}

	hashPassword := options.HashPassword
	if hashPassword == nil {
		hashPassword = func(password []byte) ([]byte, error) {
			return bcrypt.GenerateFromPassword(password, bcrypt.DefaultCost)
		}
	}

	workerCount := options.Workers
	if workerCount <= 0 {
		workerCount = userImportWorkerCount
	}
	queueSize := options.QueueSize
	if queueSize <= 0 {
		queueSize = userImportQueueSize
	}

	auditHandler := options.AuditHandler
	ownsAudit := false
	if auditHandler == nil {
		auditHandler = NewAuditHandler(db, dataRoot)
		ownsAudit = true
	}

	handler := &UserImportHandler{
		db:               db,
		validatePassword: validatePassword,
		policyRevision:   policyRevision,
		createHomeDir:    createHomeDir,
		hashPassword:     hashPassword,
		now:              now,
		jobs:             make(chan userImportWork, queueSize),
		stop:             make(chan struct{}),
		audit:            auditHandler,
		ownsAudit:        ownsAudit,
	}

	_, _ = db.Exec(`
		UPDATE user_import_jobs
		SET status = 'failed', failure_code = 'server_restarted',
		    completed_at = NOW(), updated_at = NOW()
		WHERE status IN ('pending', 'running')
	`)

	for range workerCount {
		handler.workers.Add(1)
		go handler.worker()
	}

	return handler
}

// Close stops accepting work and waits for current in-memory work to stop.
func (h *UserImportHandler) Close() {
	h.closeOnce.Do(func() {
		close(h.stop)
		h.workers.Wait()
		if h.ownsAudit {
			h.audit.StopAuditLogger()
		}
	})
}

// RegisterAdminRoutes registers the complete import API on an admin route group.
func (h *UserImportHandler) RegisterAdminRoutes(group *echo.Group) {
	group.GET("/users/import-template", h.DownloadTemplate)
	group.POST("/users/import/validate", h.Validate)
	group.POST("/users/import-jobs", h.CreateJob)
	group.GET("/users/import-jobs/:id", h.GetJob)
	group.GET("/users/import-jobs/:id/result", h.DownloadResult)
	group.DELETE("/users/import-jobs/:id", h.CancelJob)
}

// DownloadTemplate returns an Excel-compatible UTF-8 BOM CSV template.
// @Summary Download the bulk user import CSV template
// @Tags Admin
// @Security BearerAuth
// @Produce text/csv
// @Success 200 {file} binary
// @Router /admin/users/import-template [get]
func (h *UserImportHandler) DownloadTemplate(c echo.Context) error {
	if _, err := RequireAdmin(c); err != nil {
		return err
	}

	c.Response().Header().Set(echo.HeaderContentType, "text/csv; charset=utf-8")
	c.Response().Header().Set(
		echo.HeaderContentDisposition,
		`attachment; filename="filehatch-user-import.csv"`,
	)
	c.Response().Header().Set("X-Content-Type-Options", "nosniff")

	var output bytes.Buffer
	output.Write([]byte{0xEF, 0xBB, 0xBF})
	writer := csv.NewWriter(&output)
	if err := writer.Write(userImportHeaders); err != nil {
		return RespondError(c, ErrInternal("Failed to create template"))
	}
	if err := writer.Write([]string{"sample_user", "user@example.com", "", "false", "10"}); err != nil {
		return RespondError(c, ErrInternal("Failed to create template"))
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return RespondError(c, ErrInternal("Failed to create template"))
	}

	return c.Blob(http.StatusOK, "text/csv; charset=utf-8", output.Bytes())
}

// Validate parses and validates a CSV without retaining its plaintext contents.
// @Summary Validate a bulk user import CSV
// @Tags Admin
// @Security BearerAuth
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "UTF-8 CSV file (maximum 5 MB)"
// @Success 200 {object} userImportValidation
// @Router /admin/users/import/validate [post]
func (h *UserImportHandler) Validate(c echo.Context) error {
	if _, err := RequireAdmin(c); err != nil {
		return err
	}

	contents, err := readImportUpload(c)
	if err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}
	defer zeroBytes(contents)

	validation, err := h.validateCSV(c.Request().Context(), contents)
	if err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}
	validation.Rows = nil
	validation.Summary = userImportSummary{
		Total:  validation.TotalRows,
		Failed: validation.InvalidRows,
	}
	if len(validation.Results) > userImportPreviewRows {
		validation.Results = validation.Results[:userImportPreviewRows]
	}

	return c.JSON(http.StatusOK, validation)
}

// CreateJob revalidates the submitted file and enqueues only valid rows.
// @Summary Start a bulk user import job
// @Tags Admin
// @Security BearerAuth
// @Accept multipart/form-data
// @Produce json
// @Param Idempotency-Key header string true "Unique submission key"
// @Param file formData file true "Same CSV file submitted for validation"
// @Param digest formData string true "Validated SHA-256 digest"
// @Param policyRevision formData string true "Validated password policy revision"
// @Success 202 {object} map[string]interface{}
// @Router /admin/users/import-jobs [post]
func (h *UserImportHandler) CreateJob(c echo.Context) error {
	claims, err := RequireAdmin(c)
	if err != nil {
		return err
	}

	idempotencyKey := strings.TrimSpace(c.Request().Header.Get("Idempotency-Key"))
	if idempotencyKey == "" || len(idempotencyKey) > 200 {
		return RespondError(c, ErrBadRequest("A valid Idempotency-Key header is required"))
	}

	contents, err := readImportUpload(c)
	if err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}
	defer zeroBytes(contents)

	validation, err := h.validateCSV(c.Request().Context(), contents)
	if err != nil {
		return RespondError(c, ErrBadRequest(err.Error()))
	}
	if validation.ValidRows == 0 {
		validation.Rows = nil
		validation.Summary = userImportSummary{
			Total:  validation.TotalRows,
			Failed: validation.InvalidRows,
		}
		return c.JSON(http.StatusBadRequest, validation)
	}

	expectedDigest := strings.TrimSpace(c.FormValue("digest"))
	if len(expectedDigest) != sha256.Size*2 {
		zeroImportRows(validation.Rows)
		return RespondError(c, ErrBadRequest("A validated SHA-256 digest is required"))
	}
	if expectedDigest != validation.Digest {
		zeroImportRows(validation.Rows)
		return RespondError(c, ErrBadRequest("The uploaded file does not match the validated digest"))
	}
	expectedRevision := strings.TrimSpace(c.FormValue("policyRevision"))
	if expectedRevision == "" {
		zeroImportRows(validation.Rows)
		return RespondError(c, ErrBadRequest("The validated password policy revision is required"))
	}
	policyChanged := expectedRevision != validation.PolicyRevision

	keyDigest := sha256.Sum256([]byte(idempotencyKey))
	keyHash := hex.EncodeToString(keyDigest[:])
	jobID, existing, err := h.insertJob(
		c.Request().Context(),
		claims.UserID,
		validation,
		keyHash,
	)
	if err != nil {
		zeroImportRows(validation.Rows)
		return RespondError(c, ErrInternal("Failed to create import job"))
	}
	if existing {
		zeroImportRows(validation.Rows)
		return c.JSON(http.StatusAccepted, map[string]interface{}{
			"importJobId":           jobID,
			"idempotent":            true,
			"policyChanged":         policyChanged,
			"policyRevisionApplied": validation.PolicyRevision,
		})
	}

	work := userImportWork{
		jobID:      jobID,
		adminID:    claims.UserID,
		adminName:  claims.Username,
		clientIP:   c.RealIP(),
		rows:       validation.Rows,
		validation: validation,
	}
	select {
	case h.jobs <- work:
		return c.JSON(http.StatusAccepted, map[string]interface{}{
			"importJobId":           jobID,
			"idempotent":            false,
			"policyChanged":         policyChanged,
			"policyRevisionApplied": validation.PolicyRevision,
		})
	default:
		zeroImportRows(validation.Rows)
		_, _ = h.db.Exec(`
			UPDATE user_import_jobs
			SET status = 'failed', failure_code = 'queue_full',
			    completed_at = NOW(), updated_at = NOW()
			WHERE id = $1 AND admin_id = $2 AND status = 'pending'
		`, jobID, claims.UserID)
		return RespondError(c, NewAPIError(
			ErrCodeServiceUnavailable,
			"Import queue is full; retry with a new Idempotency-Key",
		))
	}
}

// GetJob returns only a job owned by the current administrator.
// @Summary Get the current administrator's bulk import job
// @Tags Admin
// @Security BearerAuth
// @Produce json
// @Param id path string true "Import job ID"
// @Success 200 {object} map[string]interface{}
// @Router /admin/users/import-jobs/{id} [get]
func (h *UserImportHandler) GetJob(c echo.Context) error {
	claims, err := RequireAdmin(c)
	if err != nil {
		return err
	}

	job, err := h.loadJob(c.Request().Context(), c.Param("id"), claims.UserID)
	if errors.Is(err, sql.ErrNoRows) {
		return RespondError(c, ErrNotFound("Import job"))
	}
	if err != nil {
		return RespondError(c, ErrInternal("Failed to load import job"))
	}

	offset, limit := importPagination(c)
	totalResults := len(job.Results)
	if offset > totalResults {
		offset = totalResults
	}
	end := min(offset+limit, totalResults)
	job.Results = job.Results[offset:end]
	job.ResultTotal = totalResults
	job.Offset = offset
	job.Limit = limit

	return c.JSON(http.StatusOK, job)
}

// DownloadResult streams a password-free, spreadsheet-safe result CSV.
// @Summary Download a password-free bulk import result CSV
// @Tags Admin
// @Security BearerAuth
// @Produce text/csv
// @Param id path string true "Import job ID"
// @Success 200 {file} binary
// @Router /admin/users/import-jobs/{id}/result [get]
func (h *UserImportHandler) DownloadResult(c echo.Context) error {
	claims, err := RequireAdmin(c)
	if err != nil {
		return err
	}

	job, err := h.loadJob(c.Request().Context(), c.Param("id"), claims.UserID)
	if errors.Is(err, sql.ErrNoRows) {
		return RespondError(c, ErrNotFound("Import job"))
	}
	if err != nil {
		return RespondError(c, ErrInternal("Failed to load import job"))
	}

	var output bytes.Buffer
	output.Write([]byte{0xEF, 0xBB, 0xBF})
	writer := csv.NewWriter(&output)
	_ = writer.Write([]string{"row_number", "username", "email", "status", "code", "message", "retryable"})
	for _, result := range job.Results {
		_ = writer.Write([]string{
			strconv.Itoa(result.RowNumber),
			escapeSpreadsheetCell(result.Username),
			escapeSpreadsheetCell(result.Email),
			result.Status,
			result.Code,
			escapeSpreadsheetCell(result.Message),
			strconv.FormatBool(result.Retryable),
		})
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return RespondError(c, ErrInternal("Failed to create result"))
	}

	c.Response().Header().Set(
		echo.HeaderContentDisposition,
		`attachment; filename="filehatch-user-import-result.csv"`,
	)
	c.Response().Header().Set("X-Content-Type-Options", "nosniff")
	return c.Blob(http.StatusOK, "text/csv; charset=utf-8", output.Bytes())
}

// CancelJob cancels a pending job; running jobs deliberately cannot be cancelled.
// @Summary Cancel a pending bulk import job
// @Tags Admin
// @Security BearerAuth
// @Param id path string true "Import job ID"
// @Success 204
// @Router /admin/users/import-jobs/{id} [delete]
func (h *UserImportHandler) CancelJob(c echo.Context) error {
	claims, err := RequireAdmin(c)
	if err != nil {
		return err
	}

	result, err := h.db.ExecContext(c.Request().Context(), `
		UPDATE user_import_jobs
		SET status = 'cancelled', completed_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND admin_id = $2 AND status = 'pending'
	`, c.Param("id"), claims.UserID)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to cancel import job"))
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return RespondError(c, NewAPIError(
			ErrCodeConflict,
			"Only pending import jobs can be cancelled",
		))
	}

	return c.NoContent(http.StatusNoContent)
}

func (h *UserImportHandler) validateCSV(
	ctx context.Context,
	contents []byte,
) (userImportValidation, error) {
	parsedRows, err := parseUserImportCSV(contents)
	if err != nil {
		return userImportValidation{}, err
	}

	revision, err := h.policyRevision(ctx)
	if err != nil {
		zeroImportRows(parsedRows)
		return userImportValidation{}, fmt.Errorf("password policy is temporarily unavailable")
	}
	defaultQuota, err := h.defaultStorageQuota(ctx)
	if err != nil {
		zeroImportRows(parsedRows)
		return userImportValidation{}, fmt.Errorf("default storage quota is unavailable")
	}

	digest := sha256.Sum256(contents)
	validation := userImportValidation{
		Digest:         hex.EncodeToString(digest[:]),
		PolicyRevision: revision,
		ExpiresAt:      h.now().Add(userImportExpiry),
		TotalRows:      len(parsedRows),
		Rows:           make([]userImportRow, 0, len(parsedRows)),
		Results:        make([]userImportRowResult, 0, len(parsedRows)),
		Valid:          true,
	}
	seen := make(map[string]int, len(parsedRows))

	for _, row := range parsedRows {
		result := userImportRowResult{
			RowNumber: row.RowNumber,
			Username:  row.Username,
			Email:     row.Email,
			Status:    "valid",
		}
		code, message := h.validateRow(ctx, &row, defaultQuota, seen)
		if code != "" {
			result.Status = "failed"
			result.Code = code
			result.Message = message
			validation.InvalidRows++
			validation.Valid = false
			row.Password = ""
		} else {
			validation.ValidRows++
			validation.Rows = append(validation.Rows, row)
		}
		validation.Results = append(validation.Results, result)
	}

	zeroImportRows(parsedRows)
	validation.Summary = userImportSummary{
		Total:  validation.TotalRows,
		Failed: validation.InvalidRows,
	}
	return validation, nil
}

func (h *UserImportHandler) validateRow(
	ctx context.Context,
	row *userImportRow,
	defaultQuota int64,
	seen map[string]int,
) (string, string) {
	row.Username = strings.TrimSpace(row.Username)
	row.Email = strings.TrimSpace(row.Email)
	if err := ValidateUsername(row.Username); err != nil {
		return "invalid_username", err.Error()
	}
	if firstRow, exists := seen[row.Username]; exists {
		return "duplicate_in_file", fmt.Sprintf("username duplicates row %d", firstRow)
	}
	seen[row.Username] = row.RowNumber

	if err := ValidateEmail(row.Email); err != nil {
		return "invalid_email", err.Error()
	}
	if err := h.validatePassword(ctx, row.Password); err != nil {
		return "invalid_password", safePasswordValidationMessage(err, row.Password)
	}

	if row.StorageByte == -1 {
		row.StorageByte = defaultQuota
	}

	var exists bool
	err := h.db.QueryRowContext(
		ctx,
		"SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)",
		row.Username,
	).Scan(&exists)
	if err != nil {
		return "database_unavailable", "could not check whether the username already exists"
	}
	if exists {
		return "username_exists", "username already exists"
	}

	return "", ""
}

func parseUserImportCSV(contents []byte) ([]userImportRow, error) {
	if len(contents) == 0 {
		return nil, fmt.Errorf("CSV file is empty")
	}
	if !utf8.Valid(contents) {
		return nil, fmt.Errorf("CSV file must be valid UTF-8")
	}
	contents = bytes.TrimPrefix(contents, []byte{0xEF, 0xBB, 0xBF})

	reader := csv.NewReader(bytes.NewReader(contents))
	reader.FieldsPerRecord = -1
	reader.ReuseRecord = false
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("could not read CSV header: %w", err)
	}
	indexes, err := validateImportHeaders(header)
	if err != nil {
		return nil, err
	}

	rows := make([]userImportRow, 0)
	for rowNumber := 2; ; rowNumber++ {
		record, readErr := reader.Read()
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			zeroImportRows(rows)
			return nil, fmt.Errorf("CSV row %d is malformed: %w", rowNumber, readErr)
		}
		if len(record) != len(header) {
			zeroImportRows(rows)
			return nil, fmt.Errorf("CSV row %d has %d fields; expected %d", rowNumber, len(record), len(header))
		}
		if len(rows) >= userImportMaxRows {
			zeroImportRows(rows)
			return nil, fmt.Errorf("CSV may contain at most %d data rows", userImportMaxRows)
		}

		row, parseErr := parseUserImportRow(rowNumber, record, indexes)
		if parseErr != nil {
			zeroImportRows(rows)
			return nil, parseErr
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("CSV must contain at least one data row")
	}

	return rows, nil
}

func validateImportHeaders(header []string) (map[string]int, error) {
	indexes := make(map[string]int, len(header))
	for index, name := range header {
		if _, allowed := userImportAllowedHeaders[name]; !allowed {
			return nil, fmt.Errorf("unknown CSV header %q", name)
		}
		if _, duplicate := indexes[name]; duplicate {
			return nil, fmt.Errorf("duplicate CSV header %q", name)
		}
		indexes[name] = index
	}
	for _, required := range []string{"username", "password"} {
		if _, exists := indexes[required]; !exists {
			return nil, fmt.Errorf("required CSV header %q is missing", required)
		}
	}
	return indexes, nil
}

func parseUserImportRow(
	rowNumber int,
	record []string,
	indexes map[string]int,
) (userImportRow, error) {
	value := func(name string) string {
		index, exists := indexes[name]
		if !exists {
			return ""
		}
		return record[index]
	}

	isAdmin := false
	switch value("is_admin") {
	case "", "false":
	case "true":
		isAdmin = true
	default:
		return userImportRow{}, fmt.Errorf("CSV row %d has invalid is_admin; use true, false, or empty", rowNumber)
	}

	storageBytes := int64(-1)
	quota := value("storage_quota_gb")
	if quota != "" {
		gigabytes, err := strconv.ParseUint(quota, 10, 63)
		tooLargeForBytes := gigabytes > uint64(math.MaxInt64/(1024*1024*1024))
		exceedsOperationalLimit := gigabytes > userImportMaxQuotaGB
		if err != nil || tooLargeForBytes || exceedsOperationalLimit {
			return userImportRow{}, fmt.Errorf("CSV row %d has invalid storage_quota_gb", rowNumber)
		}
		storageBytes = int64(gigabytes) * 1024 * 1024 * 1024
	}

	return userImportRow{
		RowNumber:   rowNumber,
		Username:    value("username"),
		Email:       value("email"),
		Password:    value("password"),
		IsAdmin:     isAdmin,
		StorageByte: storageBytes,
	}, nil
}

func readImportUpload(c echo.Context) ([]byte, error) {
	request := c.Request()
	request.Body = http.MaxBytesReader(c.Response(), request.Body, userImportMaxBytes+64*1024)
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return nil, fmt.Errorf("CSV file is required")
	}
	file, err := fileHeader.Open()
	if err != nil {
		return nil, fmt.Errorf("could not open CSV file")
	}
	defer file.Close()

	contents, err := io.ReadAll(io.LimitReader(file, userImportMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("could not read CSV file")
	}
	if len(contents) > userImportMaxBytes {
		zeroBytes(contents)
		return nil, fmt.Errorf("CSV file exceeds the 5 MB limit")
	}
	return contents, nil
}

func (h *UserImportHandler) insertJob(
	ctx context.Context,
	adminID string,
	validation userImportValidation,
	keyHash string,
) (string, bool, error) {
	var jobID string
	err := h.db.QueryRowContext(ctx, `
		INSERT INTO user_import_jobs (
			admin_id, file_digest, policy_revision, idempotency_key_hash,
			total_rows, expires_at
		)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (admin_id, file_digest, idempotency_key_hash) DO NOTHING
		RETURNING id
	`,
		adminID,
		validation.Digest,
		validation.PolicyRevision,
		keyHash,
		validation.TotalRows,
		validation.ExpiresAt,
	).Scan(&jobID)
	if err == nil {
		return jobID, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", false, err
	}

	err = h.db.QueryRowContext(ctx, `
		SELECT id
		FROM user_import_jobs
		WHERE admin_id = $1 AND file_digest = $2 AND idempotency_key_hash = $3
		  AND expires_at > NOW()
	`, adminID, validation.Digest, keyHash).Scan(&jobID)
	if err != nil {
		return "", false, err
	}
	return jobID, true, nil
}

func (h *UserImportHandler) worker() {
	defer h.workers.Done()
	for {
		select {
		case <-h.stop:
			return
		case work := <-h.jobs:
			h.executeJob(work)
		}
	}
}

func (h *UserImportHandler) executeJob(work userImportWork) {
	defer zeroImportRows(work.rows)
	result, err := h.db.Exec(`
		UPDATE user_import_jobs
		SET status = 'running', started_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND admin_id = $2 AND status = 'pending'
	`, work.jobID, work.adminID)
	if err != nil {
		h.failJob(work.jobID, work.adminID, "database_unavailable")
		return
	}
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return
	}

	results := make([]userImportRowResult, 0, work.validation.TotalRows)
	createdCount := 0
	warningCount := 0
	failedCount := work.validation.InvalidRows
	for _, validationResult := range work.validation.Results {
		if validationResult.Status == "failed" {
			results = append(results, validationResult)
			_ = h.audit.LogEvent(
				&work.adminID,
				work.clientIP,
				"admin.user.import_failed",
				validationResult.Username,
				map[string]interface{}{
					"admin":       work.adminName,
					"importJobId": work.jobID,
					"rowNumber":   validationResult.RowNumber,
					"code":        validationResult.Code,
				},
			)
		}
	}
	for _, row := range work.rows {
		rowResult := h.createUser(work, row)
		results = append(results, rowResult)
		switch rowResult.Status {
		case "created":
			createdCount++
		case "created_with_warning":
			createdCount++
			warningCount++
		default:
			failedCount++
		}
	}
	sort.Slice(results, func(left, right int) bool {
		return results[left].RowNumber < results[right].RowNumber
	})

	encodedResults, err := json.Marshal(results)
	if err != nil {
		h.failJob(work.jobID, work.adminID, "result_encoding_failed")
		return
	}
	_, err = h.db.Exec(`
		UPDATE user_import_jobs
		SET status = 'completed', created_count = $1, warning_count = $2,
		    failed_count = $3, results = $4, completed_at = NOW(), updated_at = NOW()
		WHERE id = $5 AND admin_id = $6 AND status = 'running'
	`, createdCount, warningCount, failedCount, encodedResults, work.jobID, work.adminID)
	if err != nil {
		h.failJob(work.jobID, work.adminID, "result_persistence_failed")
	}
}

func (h *UserImportHandler) createUser(
	work userImportWork,
	row userImportRow,
) (result userImportRowResult) {
	result = userImportRowResult{
		RowNumber: row.RowNumber,
		Username:  row.Username,
		Email:     row.Email,
		Status:    "failed",
	}
	defer func() {
		if result.Status != "failed" {
			return
		}
		_ = h.audit.LogEvent(
			&work.adminID,
			work.clientIP,
			"admin.user.import_failed",
			row.Username,
			map[string]interface{}{
				"admin":       work.adminName,
				"importJobId": work.jobID,
				"rowNumber":   row.RowNumber,
				"code":        result.Code,
			},
		)
	}()

	// Validate mutable policy and DB state once more immediately before hashing.
	if err := h.validatePassword(context.Background(), row.Password); err != nil {
		result.Code = "policy_changed"
		result.Message = "password no longer satisfies the current policy"
		return result
	}
	var exists bool
	if err := h.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)",
		row.Username,
	).Scan(&exists); err != nil {
		result.Code = "database_unavailable"
		result.Message = "could not revalidate username"
		result.Retryable = true
		return result
	}
	if exists {
		result.Code = "username_exists"
		result.Message = "username already exists"
		return result
	}

	passwordHash, err := h.hashPassword([]byte(row.Password))
	if err != nil {
		result.Code = "password_hash_failed"
		result.Message = "could not securely hash password"
		result.Retryable = true
		return result
	}
	defer zeroBytes(passwordHash)

	var email interface{}
	if row.Email != "" {
		email = row.Email
	}
	var userID string
	err = h.db.QueryRow(`
		INSERT INTO users (
			username, email, password_hash, provider, is_admin, is_active, storage_quota
		)
		VALUES ($1, $2, $3, 'local', $4, true, $5)
		RETURNING id
	`, row.Username, email, string(passwordHash), row.IsAdmin, row.StorageByte).Scan(&userID)
	if err != nil {
		if postgresError, ok := err.(*pq.Error); ok && postgresError.Code == "23505" {
			result.Code = "username_exists"
			result.Message = "username already exists"
			return result
		}
		result.Code = "create_failed"
		result.Message = "database rejected user creation"
		result.Retryable = true
		return result
	}

	result.Status = "created"
	if err := h.createHomeDir(row.Username); err != nil {
		result.Status = "created_with_warning"
		result.Code = "home_directory_failed"
		result.Message = "account was created; home directory will be retried on first access"
		result.Retryable = true
	}

	_ = h.audit.LogEvent(&work.adminID, work.clientIP, "admin.user.import_created", row.Username, map[string]interface{}{
		"admin":       work.adminName,
		"importJobId": work.jobID,
		"rowNumber":   row.RowNumber,
		"userId":      userID,
		"status":      result.Status,
	})
	return result
}

func (h *UserImportHandler) failJob(jobID, adminID, code string) {
	_, _ = h.db.Exec(`
		UPDATE user_import_jobs
		SET status = 'failed', failure_code = $1, completed_at = NOW(), updated_at = NOW()
		WHERE id = $2 AND admin_id = $3 AND status IN ('pending', 'running')
	`, code, jobID, adminID)
}

func (h *UserImportHandler) loadJob(
	ctx context.Context,
	jobID string,
	adminID string,
) (userImportJob, error) {
	var job userImportJob
	var rawResults []byte
	var failureCode sql.NullString
	var completedAt sql.NullTime
	err := h.db.QueryRowContext(ctx, `
		SELECT id, status, file_digest, policy_revision, total_rows,
		       created_count, warning_count, failed_count, skipped_count,
		       failure_code, results, created_at, completed_at, expires_at
		FROM user_import_jobs
		WHERE id = $1 AND admin_id = $2
	`, jobID, adminID).Scan(
		&job.ID,
		&job.Status,
		&job.Digest,
		&job.PolicyRevision,
		&job.TotalRows,
		&job.CreatedCount,
		&job.WarningCount,
		&job.FailedCount,
		&job.SkippedCount,
		&failureCode,
		&rawResults,
		&job.CreatedAt,
		&completedAt,
		&job.ExpiresAt,
	)
	if err != nil {
		return userImportJob{}, err
	}
	if failureCode.Valid {
		job.FailureCode = failureCode.String
	}
	if completedAt.Valid {
		job.CompletedAt = &completedAt.Time
	}
	job.Summary = userImportSummary{
		Total:    job.TotalRows,
		Created:  job.CreatedCount,
		Warnings: job.WarningCount,
		Failed:   job.FailedCount,
		Skipped:  job.SkippedCount,
	}
	job.Results = []userImportRowResult{}
	if len(rawResults) > 0 {
		if err := json.Unmarshal(rawResults, &job.Results); err != nil {
			return userImportJob{}, fmt.Errorf("decode import results: %w", err)
		}
	}
	return job, nil
}

func (h *UserImportHandler) defaultStorageQuota(ctx context.Context) (int64, error) {
	var raw string
	err := h.db.QueryRowContext(
		ctx,
		"SELECT value FROM system_settings WHERE key = 'default_storage_quota'",
	).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	quota, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || quota < 0 {
		return 0, fmt.Errorf("invalid default_storage_quota")
	}
	return quota, nil
}

func readPasswordPolicyRevision(ctx context.Context, db *sql.DB) (string, error) {
	var revision sql.NullString
	err := db.QueryRowContext(ctx, `
		SELECT TO_CHAR(MAX(updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
		FROM system_settings
		WHERE key LIKE 'password_%'
	`).Scan(&revision)
	if err != nil {
		return "", err
	}
	if !revision.Valid || revision.String == "" {
		return "legacy-v1", nil
	}
	return revision.String, nil
}

func importPagination(c echo.Context) (int, int) {
	offset, _ := strconv.Atoi(c.QueryParam("offset"))
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > userImportMaxResultLimit {
		limit = 50
	}
	return offset, limit
}

func escapeSpreadsheetCell(value string) string {
	if value == "" {
		return value
	}
	switch value[0] {
	case '=', '+', '-', '@', '\t', '\r', '\n':
		return "'" + value
	default:
		return value
	}
}

func safePasswordValidationMessage(err error, password string) string {
	message := err.Error()
	if password != "" && strings.Contains(message, password) {
		return "password does not satisfy the current policy"
	}
	return message
}

func zeroImportRows(rows []userImportRow) {
	for index := range rows {
		rows[index].Password = ""
	}
}

func zeroBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
