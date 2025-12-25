package handlers

import (
	"fmt"
	"net/http"

	"github.com/labstack/echo/v4"
)

// ErrorCode represents a standardized error code
type ErrorCode string

const (
	// Authentication errors
	ErrCodeUnauthorized     ErrorCode = "UNAUTHORIZED"
	ErrCodeForbidden        ErrorCode = "FORBIDDEN"
	ErrCodeInvalidToken     ErrorCode = "INVALID_TOKEN"
	ErrCodeTokenExpired     ErrorCode = "TOKEN_EXPIRED"

	// Validation errors
	ErrCodeBadRequest       ErrorCode = "BAD_REQUEST"
	ErrCodeInvalidPath      ErrorCode = "INVALID_PATH"
	ErrCodeInvalidFilename  ErrorCode = "INVALID_FILENAME"
	ErrCodePathTraversal    ErrorCode = "PATH_TRAVERSAL"
	ErrCodeMissingParameter ErrorCode = "MISSING_PARAMETER"

	// Resource errors
	ErrCodeNotFound         ErrorCode = "NOT_FOUND"
	ErrCodeAlreadyExists    ErrorCode = "ALREADY_EXISTS"
	ErrCodeConflict         ErrorCode = "CONFLICT"

	// Storage errors
	ErrCodeQuotaExceeded    ErrorCode = "QUOTA_EXCEEDED"
	ErrCodeFileTooLarge     ErrorCode = "FILE_TOO_LARGE"
	ErrCodeStorageFull      ErrorCode = "STORAGE_FULL"

	// Operation errors
	ErrCodeOperationFailed  ErrorCode = "OPERATION_FAILED"
	ErrCodeReadFailed       ErrorCode = "READ_FAILED"
	ErrCodeWriteFailed      ErrorCode = "WRITE_FAILED"
	ErrCodeDeleteFailed     ErrorCode = "DELETE_FAILED"
	ErrCodeMoveFailed       ErrorCode = "MOVE_FAILED"
	ErrCodeCopyFailed       ErrorCode = "COPY_FAILED"

	// Server errors
	ErrCodeInternal         ErrorCode = "INTERNAL_ERROR"
	ErrCodeDatabaseError    ErrorCode = "DATABASE_ERROR"
	ErrCodeServiceUnavailable ErrorCode = "SERVICE_UNAVAILABLE"
)

// APIError represents a standardized API error response
type APIError struct {
	Code    ErrorCode   `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details,omitempty"`
}

// Error implements the error interface
func (e *APIError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// NewAPIError creates a new API error
func NewAPIError(code ErrorCode, message string) *APIError {
	return &APIError{
		Code:    code,
		Message: message,
	}
}

// WithDetails adds details to the error
func (e *APIError) WithDetails(details interface{}) *APIError {
	e.Details = details
	return e
}

// HTTPStatus returns the appropriate HTTP status code for the error
func (e *APIError) HTTPStatus() int {
	switch e.Code {
	case ErrCodeUnauthorized, ErrCodeInvalidToken, ErrCodeTokenExpired:
		return http.StatusUnauthorized
	case ErrCodeForbidden:
		return http.StatusForbidden
	case ErrCodeBadRequest, ErrCodeInvalidPath, ErrCodeInvalidFilename,
		ErrCodePathTraversal, ErrCodeMissingParameter:
		return http.StatusBadRequest
	case ErrCodeNotFound:
		return http.StatusNotFound
	case ErrCodeAlreadyExists, ErrCodeConflict:
		return http.StatusConflict
	case ErrCodeQuotaExceeded, ErrCodeFileTooLarge:
		return http.StatusRequestEntityTooLarge
	case ErrCodeStorageFull:
		return http.StatusInsufficientStorage
	case ErrCodeInternal, ErrCodeDatabaseError, ErrCodeOperationFailed,
		ErrCodeReadFailed, ErrCodeWriteFailed, ErrCodeDeleteFailed,
		ErrCodeMoveFailed, ErrCodeCopyFailed:
		return http.StatusInternalServerError
	case ErrCodeServiceUnavailable:
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

// RespondError sends a standardized error response
func RespondError(c echo.Context, err *APIError) error {
	return c.JSON(err.HTTPStatus(), map[string]interface{}{
		"error":   err.Message,
		"code":    err.Code,
		"details": err.Details,
	})
}

// Common error constructors for convenience

// ErrUnauthorized returns an unauthorized error
func ErrUnauthorized(message string) *APIError {
	if message == "" {
		message = "Authentication required"
	}
	return NewAPIError(ErrCodeUnauthorized, message)
}

// ErrForbidden returns a forbidden error
func ErrForbidden(message string) *APIError {
	if message == "" {
		message = "Access denied"
	}
	return NewAPIError(ErrCodeForbidden, message)
}

// ErrNotFound returns a not found error
func ErrNotFound(resource string) *APIError {
	message := "Resource not found"
	if resource != "" {
		message = fmt.Sprintf("%s not found", resource)
	}
	return NewAPIError(ErrCodeNotFound, message)
}

// ErrBadRequest returns a bad request error
func ErrBadRequest(message string) *APIError {
	if message == "" {
		message = "Invalid request"
	}
	return NewAPIError(ErrCodeBadRequest, message)
}

// ErrInvalidPath returns an invalid path error
func ErrInvalidPath(message string) *APIError {
	if message == "" {
		message = "Invalid path"
	}
	return NewAPIError(ErrCodeInvalidPath, message)
}

// ErrPathTraversal returns a path traversal error
func ErrPathTraversal() *APIError {
	return NewAPIError(ErrCodePathTraversal, "Path traversal not allowed")
}

// ErrQuotaExceeded returns a quota exceeded error
func ErrQuotaExceeded(quota, used, requested int64) *APIError {
	return NewAPIError(ErrCodeQuotaExceeded, "Storage quota exceeded").WithDetails(map[string]int64{
		"quota":     quota,
		"used":      used,
		"requested": requested,
	})
}

// ErrAlreadyExists returns an already exists error
func ErrAlreadyExists(resource string) *APIError {
	message := "Resource already exists"
	if resource != "" {
		message = fmt.Sprintf("%s already exists", resource)
	}
	return NewAPIError(ErrCodeAlreadyExists, message)
}

// ErrOperationFailed returns an operation failed error
func ErrOperationFailed(operation string, err error) *APIError {
	message := fmt.Sprintf("Failed to %s", operation)
	apiErr := NewAPIError(ErrCodeOperationFailed, message)
	if err != nil {
		apiErr.Details = map[string]string{"error": err.Error()}
	}
	return apiErr
}

// ErrInternal returns an internal server error
func ErrInternal(message string) *APIError {
	if message == "" {
		message = "Internal server error"
	}
	return NewAPIError(ErrCodeInternal, message)
}

// ErrMissingParameter returns a missing parameter error
func ErrMissingParameter(param string) *APIError {
	return NewAPIError(ErrCodeMissingParameter, fmt.Sprintf("Missing required parameter: %s", param))
}

// GetClaims extracts JWT claims from the context
// Returns nil if no claims are present
func GetClaims(c echo.Context) *JWTClaims {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return nil
	}
	return claims
}

// RequireClaims extracts JWT claims and returns an error if not authenticated
func RequireClaims(c echo.Context) (*JWTClaims, error) {
	claims := GetClaims(c)
	if claims == nil {
		return nil, RespondError(c, ErrUnauthorized(""))
	}
	return claims, nil
}

// RequireAdmin checks if the user is an admin and returns claims
func RequireAdmin(c echo.Context) (*JWTClaims, error) {
	claims := GetClaims(c)
	if claims == nil {
		return nil, RespondError(c, ErrUnauthorized(""))
	}
	if !claims.IsAdmin {
		return nil, RespondError(c, ErrForbidden("Admin access required"))
	}
	return claims, nil
}
