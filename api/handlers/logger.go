package handlers

import (
	"os"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

var logger zerolog.Logger

// InitLogger initializes the structured logger
func InitLogger(development bool) {
	zerolog.TimeFieldFormat = time.RFC3339

	if development {
		// Pretty console output for development
		output := zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: "15:04:05"}
		logger = zerolog.New(output).With().Timestamp().Caller().Logger()
	} else {
		// JSON output for production
		logger = zerolog.New(os.Stdout).With().Timestamp().Logger()
	}

	// Set global logger
	log.Logger = logger
}

// GetLogger returns the configured logger
func GetLogger() zerolog.Logger {
	return logger
}

// LogInfo logs an info message with optional fields
func LogInfo(msg string, fields ...interface{}) {
	event := logger.Info()
	for i := 0; i < len(fields)-1; i += 2 {
		if key, ok := fields[i].(string); ok {
			event = event.Interface(key, fields[i+1])
		}
	}
	event.Msg(msg)
}

// LogError logs an error message with optional fields
func LogError(msg string, err error, fields ...interface{}) {
	event := logger.Error().Err(err)
	for i := 0; i < len(fields)-1; i += 2 {
		if key, ok := fields[i].(string); ok {
			event = event.Interface(key, fields[i+1])
		}
	}
	event.Msg(msg)
}

// LogWarn logs a warning message with optional fields
func LogWarn(msg string, fields ...interface{}) {
	event := logger.Warn()
	for i := 0; i < len(fields)-1; i += 2 {
		if key, ok := fields[i].(string); ok {
			event = event.Interface(key, fields[i+1])
		}
	}
	event.Msg(msg)
}

// LogDebug logs a debug message with optional fields
func LogDebug(msg string, fields ...interface{}) {
	event := logger.Debug()
	for i := 0; i < len(fields)-1; i += 2 {
		if key, ok := fields[i].(string); ok {
			event = event.Interface(key, fields[i+1])
		}
	}
	event.Msg(msg)
}

// RequestLogger is a middleware that logs HTTP requests
func RequestLogger() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()
			req := c.Request()
			res := c.Response()

			// Process request
			err := next(c)

			// Log request details
			latency := time.Since(start)

			event := logger.Info()
			if err != nil {
				event = logger.Error().Err(err)
			}

			// Add request context
			event.
				Str("method", req.Method).
				Str("path", req.URL.Path).
				Str("remote_ip", c.RealIP()).
				Int("status", res.Status).
				Dur("latency", latency).
				Int64("bytes_out", res.Size)

			// Add user context if available
			if claims := GetClaims(c); claims != nil {
				event.
					Str("user_id", claims.UserID).
					Str("username", claims.Username)
			}

			// Add query params for non-GET or important endpoints
			if req.Method != "GET" || req.URL.Path == "/api/auth/login" {
				event.Str("query", req.URL.RawQuery)
			}

			event.Msg("request")

			return err
		}
	}
}

// FileOperationLogger logs file operations
type FileOperationLogger struct {
	logger zerolog.Logger
}

// NewFileOperationLogger creates a new file operation logger
func NewFileOperationLogger() *FileOperationLogger {
	return &FileOperationLogger{
		logger: logger.With().Str("component", "file_ops").Logger(),
	}
}

// LogUpload logs file upload events
func (l *FileOperationLogger) LogUpload(username, path string, size int64, success bool, err error) {
	event := l.logger.Info()
	if !success {
		event = l.logger.Error().Err(err)
	}
	event.
		Str("operation", "upload").
		Str("username", username).
		Str("path", path).
		Int64("size", size).
		Bool("success", success).
		Msg("file upload")
}

// LogDownload logs file download events
func (l *FileOperationLogger) LogDownload(username, path string, success bool, err error) {
	event := l.logger.Info()
	if !success {
		event = l.logger.Error().Err(err)
	}
	event.
		Str("operation", "download").
		Str("username", username).
		Str("path", path).
		Bool("success", success).
		Msg("file download")
}

// LogDelete logs file deletion events
func (l *FileOperationLogger) LogDelete(username, path string, toTrash bool, success bool, err error) {
	event := l.logger.Info()
	if !success {
		event = l.logger.Error().Err(err)
	}
	event.
		Str("operation", "delete").
		Str("username", username).
		Str("path", path).
		Bool("to_trash", toTrash).
		Bool("success", success).
		Msg("file delete")
}

// LogMove logs file move events
func (l *FileOperationLogger) LogMove(username, srcPath, dstPath string, success bool, err error) {
	event := l.logger.Info()
	if !success {
		event = l.logger.Error().Err(err)
	}
	event.
		Str("operation", "move").
		Str("username", username).
		Str("src_path", srcPath).
		Str("dst_path", dstPath).
		Bool("success", success).
		Msg("file move")
}

// LogCopy logs file copy events
func (l *FileOperationLogger) LogCopy(username, srcPath, dstPath string, success bool, err error) {
	event := l.logger.Info()
	if !success {
		event = l.logger.Error().Err(err)
	}
	event.
		Str("operation", "copy").
		Str("username", username).
		Str("src_path", srcPath).
		Str("dst_path", dstPath).
		Bool("success", success).
		Msg("file copy")
}

// TrashLogger logs trash operations
type TrashLogger struct {
	logger zerolog.Logger
}

// NewTrashLogger creates a new trash logger
func NewTrashLogger() *TrashLogger {
	return &TrashLogger{
		logger: logger.With().Str("component", "trash").Logger(),
	}
}

// LogAutoCleanup logs trash auto-cleanup events
func (l *TrashLogger) LogAutoCleanup(itemsDeleted int, bytesFreed int64, retentionDays int) {
	l.logger.Info().
		Str("operation", "auto_cleanup").
		Int("items_deleted", itemsDeleted).
		Int64("bytes_freed", bytesFreed).
		Int("retention_days", retentionDays).
		Msg("trash auto-cleanup completed")
}
