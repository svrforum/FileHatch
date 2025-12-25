package handlers

import (
	"bufio"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
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
// Format (rsyslog): 2025-12-25T22:57:49.939325+09:00 HOSTNAME smbd_audit: SMB_AUDIT|username|clientIP|hostname|sharename|operation|status|filepath
func parseAuditLine(line string) (*SMBAuditEntry, error) {
	// Find SMB_AUDIT marker
	idx := strings.Index(line, "SMB_AUDIT|")
	if idx == -1 {
		return nil, fmt.Errorf("not an SMB audit line")
	}

	auditPart := line[idx+len("SMB_AUDIT|"):]
	parts := strings.Split(auditPart, "|")
	if len(parts) < 6 {
		return nil, fmt.Errorf("invalid audit format: need at least 6 parts, got %d", len(parts))
	}

	entry := &SMBAuditEntry{
		Timestamp:  time.Now(),
		Username:   parts[0],
		ClientIP:   parts[1],
		Hostname:   parts[2],
		ShareName:  parts[3],
		Operation:  parts[4],
		RawMessage: line,
	}

	// parts[5] is status (ok/fail)
	// parts[6+] is file path (may contain | for rename operations)
	if len(parts) >= 7 {
		entry.FilePath = parts[6]
	}

	// Parse ISO 8601 timestamp from rsyslog format (e.g., "2025-12-25T22:57:49.939325+09:00")
	if len(line) > 32 && strings.HasPrefix(line, "20") {
		// Find first space to get timestamp
		spaceIdx := strings.Index(line, " ")
		if spaceIdx > 0 {
			timestampStr := line[:spaceIdx]
			parsed, err := time.Parse(time.RFC3339Nano, timestampStr)
			if err == nil {
				entry.Timestamp = parsed
			}
		}
	}

	return entry, nil
}

// mapOperationToAction maps SMB operations to audit action types
// Samba 4.22+ uses new operation names: mkdirat, unlinkat, renameat, pwrite
func mapOperationToAction(op string) string {
	switch strings.ToLower(op) {
	case "open", "read", "close":
		return "smb_read"
	case "write", "pwrite":
		return "smb_write"
	case "mkdir", "mkdirat":
		return "smb_mkdir"
	case "rmdir":
		return "smb_rmdir"
	case "unlink", "unlinkat":
		return "smb_delete"
	case "rename", "renameat":
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

		// Skip read/open/close operations to reduce noise (optional - can be configurable)
		if entry.Operation == "open" || entry.Operation == "read" || entry.Operation == "close" {
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
		SELECT al.id, al.actor_id, u.username, al.ip_addr::text, al.event_type,
		       al.target_resource, al.details, al.ts
		FROM audit_logs al
		LEFT JOIN users u ON al.actor_id = u.id
		WHERE al.event_type LIKE 'smb_%'
		ORDER BY al.ts DESC
		LIMIT 100
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Database error: " + err.Error()})
	}
	defer rows.Close()

	logs := []map[string]interface{}{}
	for rows.Next() {
		var (
			id           int64
			userID       sql.NullString
			username     sql.NullString
			ipAddress    sql.NullString
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
		if ipAddress.Valid {
			log["ipAddress"] = ipAddress.String
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
