package handlers

import (
	"bufio"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

// SMBAuditHandler handles SMB audit log processing
type SMBAuditHandler struct {
	db           *sql.DB
	configPath   string
	auditHandler *AuditHandler
	lastPosition int64
	mu           sync.Mutex
}

// SMBAuditEntry represents a parsed SMB audit log entry
type SMBAuditEntry struct {
	Timestamp   time.Time `json:"timestamp"`
	Username    string    `json:"username"`
	ClientIP    string    `json:"clientIp"`
	Hostname    string    `json:"hostname"`
	ShareName   string    `json:"shareName"`
	Operation   string    `json:"operation"`
	FilePath    string    `json:"filePath"`
	RawMessage  string    `json:"rawMessage"`
}

// NewSMBAuditHandler creates a new SMBAuditHandler
func NewSMBAuditHandler(db *sql.DB, configPath string) *SMBAuditHandler {
	return &SMBAuditHandler{
		db:           db,
		configPath:   configPath,
		auditHandler: NewAuditHandler(db),
		lastPosition: 0,
	}
}

// parseAuditLine parses a single SMB audit log line
// Format: <timestamp> <hostname> smbd_audit: SMB_AUDIT|username|clientIP|hostname|sharename|operation|filepath
func parseAuditLine(line string) (*SMBAuditEntry, error) {
	// Match syslog format with SMB_AUDIT prefix
	// Example: Dec 25 12:00:00 hostname smbd_audit: SMB_AUDIT|admin|192.168.1.1|client|shared|open|/path/to/file

	// Find SMB_AUDIT marker
	idx := strings.Index(line, "SMB_AUDIT|")
	if idx == -1 {
		return nil, fmt.Errorf("not an SMB audit line")
	}

	auditPart := line[idx+len("SMB_AUDIT|"):]
	parts := strings.SplitN(auditPart, "|", 5)
	if len(parts) < 4 {
		return nil, fmt.Errorf("invalid audit format")
	}

	entry := &SMBAuditEntry{
		Timestamp:  time.Now(), // Will be parsed from syslog timestamp if needed
		Username:   parts[0],
		ClientIP:   parts[1],
		Hostname:   parts[2],
		ShareName:  parts[3],
		RawMessage: line,
	}

	// Parse operation and file path from the rest
	if len(parts) >= 5 {
		remaining := parts[4]
		// Operation format: "operation|/path/to/file" or "operation(/path/to/file)"
		if opIdx := strings.Index(remaining, "|"); opIdx != -1 {
			entry.Operation = remaining[:opIdx]
			entry.FilePath = remaining[opIdx+1:]
		} else if strings.Contains(remaining, "(") {
			// Format: open(/data/shared/file.txt)
			re := regexp.MustCompile(`(\w+)\((.*)\)`)
			matches := re.FindStringSubmatch(remaining)
			if len(matches) >= 3 {
				entry.Operation = matches[1]
				entry.FilePath = matches[2]
			}
		}
	}

	// Parse timestamp from syslog format (e.g., "Dec 25 12:00:00")
	if len(line) > 15 {
		timestampStr := line[:15]
		currentYear := time.Now().Year()
		parsed, err := time.Parse("Jan  2 15:04:05", timestampStr)
		if err == nil {
			entry.Timestamp = time.Date(currentYear, parsed.Month(), parsed.Day(),
				parsed.Hour(), parsed.Minute(), parsed.Second(), 0, time.Local)
		}
	}

	return entry, nil
}

// mapOperationToAction maps SMB operations to audit action types
func mapOperationToAction(op string) string {
	switch strings.ToLower(op) {
	case "open", "read":
		return "smb_read"
	case "write":
		return "smb_write"
	case "mkdir":
		return "smb_mkdir"
	case "rmdir":
		return "smb_rmdir"
	case "unlink":
		return "smb_delete"
	case "rename":
		return "smb_rename"
	default:
		return "smb_" + strings.ToLower(op)
	}
}

// ProcessAuditLog reads and processes new entries from the SMB audit log
func (h *SMBAuditHandler) ProcessAuditLog() (int, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	logPath := filepath.Join(h.configPath, "smb_audit.log")
	file, err := os.Open(logPath)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil // No log file yet
		}
		return 0, err
	}
	defer file.Close()

	// Seek to last known position
	if h.lastPosition > 0 {
		_, err = file.Seek(h.lastPosition, 0)
		if err != nil {
			// File might have been rotated, start from beginning
			h.lastPosition = 0
			file.Seek(0, 0)
		}
	}

	scanner := bufio.NewScanner(file)
	processedCount := 0
	var lastErr error

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		entry, err := parseAuditLine(line)
		if err != nil {
			continue // Skip non-audit lines
		}

		// Skip read/open operations to reduce noise (optional - can be configurable)
		if entry.Operation == "open" || entry.Operation == "read" {
			continue
		}

		// Look up user ID from username
		var userID *string
		var uid string
		err = h.db.QueryRow("SELECT id FROM users WHERE username = $1", entry.Username).Scan(&uid)
		if err == nil {
			userID = &uid
		}

		// Build file path for audit log
		auditPath := entry.FilePath
		if entry.ShareName == "shared" {
			auditPath = "/shared-drives" + strings.TrimPrefix(entry.FilePath, "/data/shared")
		} else if entry.ShareName != "" {
			auditPath = "/home/" + entry.Username + strings.TrimPrefix(entry.FilePath, "/data/users/"+entry.Username)
		}

		// Log to audit table
		action := mapOperationToAction(entry.Operation)
		h.auditHandler.LogEvent(userID, entry.ClientIP, action, auditPath, map[string]interface{}{
			"smbShare":  entry.ShareName,
			"smbClient": entry.Hostname,
			"operation": entry.Operation,
		})

		processedCount++
	}

	if err := scanner.Err(); err != nil {
		lastErr = err
	}

	// Update last position
	pos, _ := file.Seek(0, 1) // Get current position
	h.lastPosition = pos

	return processedCount, lastErr
}

// GetSMBAuditLogs returns recent SMB audit logs from the database
func (h *SMBAuditHandler) GetSMBAuditLogs(c echo.Context) error {
	// Query audit logs with smb_ prefix
	rows, err := h.db.Query(`
		SELECT al.id, al.user_id, u.username, al.ip_address, al.action,
		       al.resource_path, al.details, al.created_at
		FROM audit_logs al
		LEFT JOIN users u ON al.user_id = u.id
		WHERE al.action LIKE 'smb_%'
		ORDER BY al.created_at DESC
		LIMIT 100
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Database error"})
	}
	defer rows.Close()

	logs := []map[string]interface{}{}
	for rows.Next() {
		var (
			id           int64
			userID       sql.NullString
			username     sql.NullString
			ipAddress    string
			action       string
			resourcePath string
			details      sql.NullString
			createdAt    time.Time
		)
		if err := rows.Scan(&id, &userID, &username, &ipAddress, &action, &resourcePath, &details, &createdAt); err != nil {
			continue
		}

		log := map[string]interface{}{
			"id":           id,
			"ipAddress":    ipAddress,
			"action":       action,
			"resourcePath": resourcePath,
			"createdAt":    createdAt,
		}
		if userID.Valid {
			log["userId"] = userID.String
		}
		if username.Valid {
			log["username"] = username.String
		}
		if details.Valid {
			log["details"] = details.String
		}

		logs = append(logs, log)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"logs":  logs,
		"total": len(logs),
	})
}

// SyncSMBAuditLogs manually triggers audit log sync (admin only)
func (h *SMBAuditHandler) SyncSMBAuditLogs(c echo.Context) error {
	count, err := h.ProcessAuditLog()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": fmt.Sprintf("Failed to process audit log: %v", err),
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":   true,
		"processed": count,
		"message":   fmt.Sprintf("Processed %d SMB audit entries", count),
	})
}

// StartBackgroundSync starts a background goroutine that periodically syncs audit logs
func (h *SMBAuditHandler) StartBackgroundSync(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for range ticker.C {
			count, err := h.ProcessAuditLog()
			if err != nil {
				fmt.Printf("SMB audit sync error: %v\n", err)
			} else if count > 0 {
				fmt.Printf("SMB audit sync: processed %d entries\n", count)
			}
		}
	}()
}
