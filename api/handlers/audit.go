package handlers

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

type AuditHandler struct {
	db *sql.DB
}

func NewAuditHandler(db *sql.DB) *AuditHandler {
	return &AuditHandler{db: db}
}

// AuditLog represents an audit log entry
type AuditLog struct {
	ID             int64           `json:"id"`
	Timestamp      time.Time       `json:"timestamp"`
	ActorID        *string         `json:"actorId,omitempty"`
	ActorUsername  *string         `json:"actorUsername,omitempty"`
	IPAddress      string          `json:"ipAddress"`
	EventType      string          `json:"eventType"`
	TargetResource string          `json:"targetResource"`
	Details        json.RawMessage `json:"details,omitempty"`
}

// EventTypes
const (
	// File events
	EventFileView     = "file.view"
	EventFileDownload = "file.download"
	EventFileUpload   = "file.upload"
	EventFileEdit     = "file.edit"
	EventFileDelete   = "file.delete"
	EventFileRename   = "file.rename"
	EventFolderCreate = "folder.create"
	EventFolderDelete = "folder.delete"

	// SMB events
	EventSMBCreate = "smb.create"
	EventSMBModify = "smb.modify"
	EventSMBDelete = "smb.delete"
	EventSMBRename = "smb.rename"

	// User events
	EventUserLogin  = "user.login"
	EventUserLogout = "user.logout"

	// Share events
	EventShareCreate = "share.create"
	EventShareAccess = "share.access"

	// Admin events
	EventAdminUserCreate     = "admin.user.create"
	EventAdminUserUpdate     = "admin.user.update"
	EventAdminUserDelete     = "admin.user.delete"
	EventAdminUserActivate   = "admin.user.activate"
	EventAdminUserDeactivate = "admin.user.deactivate"
	EventAdminSMBEnable      = "admin.smb.enable"
	EventAdminSMBDisable     = "admin.smb.disable"
	EventAdminSettingsUpdate = "admin.settings.update"
)

// LogEvent records an audit event
func (h *AuditHandler) LogEvent(actorID *string, ipAddr, eventType, targetResource string, details map[string]interface{}) error {
	detailsJSON, _ := json.Marshal(details)

	_, err := h.db.Exec(`
		INSERT INTO audit_logs (actor_id, ip_addr, event_type, target_resource, details)
		VALUES ($1, $2::inet, $3, $4, $5)
	`, actorID, ipAddr, eventType, targetResource, detailsJSON)

	return err
}

// LogEventFromContext logs an event using context information
func (h *AuditHandler) LogEventFromContext(c echo.Context, eventType, targetResource string, details map[string]interface{}) {
	var actorID *string

	if claims, ok := c.Get("user").(*JWTClaims); ok && claims != nil {
		actorID = &claims.UserID
	}

	ipAddr := c.RealIP()
	if ipAddr == "" {
		ipAddr = "0.0.0.0"
	}

	h.LogEvent(actorID, ipAddr, eventType, targetResource, details)
}

// ListAuditLogs returns audit logs with pagination and filtering
func (h *AuditHandler) ListAuditLogs(c echo.Context) error {
	// Parse query parameters
	eventType := c.QueryParam("eventType")
	category := c.QueryParam("category") // file, admin
	targetResource := c.QueryParam("resource")
	limitStr := c.QueryParam("limit")
	offsetStr := c.QueryParam("offset")

	limit := 100
	offset := 0
	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 500 {
		limit = l
	}
	if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
		offset = o
	}

	// Build query
	query := `
		SELECT al.id, al.ts, al.actor_id, u.username, al.ip_addr,
		       al.event_type, al.target_resource, al.details
		FROM audit_logs al
		LEFT JOIN users u ON al.actor_id = u.id
		WHERE 1=1
	`
	args := []interface{}{}
	argCount := 1

	// Category filter
	if category == "file" {
		query += " AND (al.event_type LIKE 'file.%' OR al.event_type LIKE 'folder.%' OR al.event_type LIKE 'smb.%')"
	} else if category == "admin" {
		query += " AND al.event_type LIKE 'admin.%'"
	} else if category == "user" {
		query += " AND (al.event_type LIKE 'user.%' OR al.event_type LIKE 'share.%')"
	}

	if eventType != "" {
		query += " AND al.event_type = $" + strconv.Itoa(argCount)
		args = append(args, eventType)
		argCount++
	}

	if targetResource != "" {
		query += " AND al.target_resource LIKE $" + strconv.Itoa(argCount)
		args = append(args, "%"+targetResource+"%")
		argCount++
	}

	query += " ORDER BY al.ts DESC LIMIT $" + strconv.Itoa(argCount) + " OFFSET $" + strconv.Itoa(argCount+1)
	args = append(args, limit, offset)

	rows, err := h.db.Query(query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to query audit logs",
		})
	}
	defer rows.Close()

	logs := []AuditLog{}
	for rows.Next() {
		var log AuditLog
		var actorID, username, ipAddr sql.NullString
		var details []byte

		err := rows.Scan(&log.ID, &log.Timestamp, &actorID, &username, &ipAddr,
			&log.EventType, &log.TargetResource, &details)
		if err != nil {
			continue
		}

		if actorID.Valid {
			log.ActorID = &actorID.String
		}
		if username.Valid {
			log.ActorUsername = &username.String
		}
		if ipAddr.Valid {
			log.IPAddress = ipAddr.String
		} else {
			log.IPAddress = "" // Will be displayed as "SMB" in UI
		}
		if details != nil {
			log.Details = details
		}

		logs = append(logs, log)
	}

	// Get total count
	countQuery := `SELECT COUNT(*) FROM audit_logs al WHERE 1=1`
	if category == "file" {
		countQuery += " AND (al.event_type LIKE 'file.%' OR al.event_type LIKE 'folder.%' OR al.event_type LIKE 'smb.%')"
	} else if category == "admin" {
		countQuery += " AND al.event_type LIKE 'admin.%'"
	} else if category == "user" {
		countQuery += " AND (al.event_type LIKE 'user.%' OR al.event_type LIKE 'share.%')"
	}

	var total int
	h.db.QueryRow(countQuery).Scan(&total)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"logs":   logs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// GetResourceHistory returns audit history for a specific resource
func (h *AuditHandler) GetResourceHistory(c echo.Context) error {
	resource := c.Param("*")
	if resource == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Resource path required",
		})
	}

	rows, err := h.db.Query(`
		SELECT al.id, al.ts, al.actor_id, u.username, al.ip_addr,
		       al.event_type, al.target_resource, al.details
		FROM audit_logs al
		LEFT JOIN users u ON al.actor_id = u.id
		WHERE al.target_resource = $1 OR al.target_resource LIKE $2
		ORDER BY al.ts DESC
		LIMIT 100
	`, "/"+resource, "/"+resource+"/%")

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to query resource history",
		})
	}
	defer rows.Close()

	logs := []AuditLog{}
	for rows.Next() {
		var log AuditLog
		var actorID, username sql.NullString
		var details []byte

		err := rows.Scan(&log.ID, &log.Timestamp, &actorID, &username, &log.IPAddress,
			&log.EventType, &log.TargetResource, &details)
		if err != nil {
			continue
		}

		if actorID.Valid {
			log.ActorID = &actorID.String
		}
		if username.Valid {
			log.ActorUsername = &username.String
		}
		if details != nil {
			log.Details = details
		}

		logs = append(logs, log)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"resource": "/" + resource,
		"logs":     logs,
		"total":    len(logs),
	})
}

// SystemLogEntry represents a docker container log entry
type SystemLogEntry struct {
	Timestamp string `json:"timestamp"`
	Container string `json:"container"`
	Level     string `json:"level"`
	Message   string `json:"message"`
}

// GetSystemLogs returns docker container logs
func (h *AuditHandler) GetSystemLogs(c echo.Context) error {
	container := c.QueryParam("container") // api, ui, db, valkey
	level := c.QueryParam("level")         // info, warn, error, fatal
	tailStr := c.QueryParam("tail")

	tail := 200
	if t, err := strconv.Atoi(tailStr); err == nil && t > 0 && t <= 1000 {
		tail = t
	}

	// Determine which containers to fetch logs from
	containers := []string{"scv-api", "scv-ui", "scv-db"}
	if container != "" {
		containerMap := map[string]string{
			"api":    "scv-api",
			"ui":     "scv-ui",
			"db":     "scv-db",
			"valkey": "scv-valkey",
		}
		if mapped, ok := containerMap[container]; ok {
			containers = []string{mapped}
		}
	}

	allLogs := []SystemLogEntry{}

	for _, cont := range containers {
		logs := h.fetchContainerLogs(cont, tail, level)
		allLogs = append(allLogs, logs...)
	}

	// Sort by timestamp (newest first) - simple string comparison works for ISO timestamps
	for i := 0; i < len(allLogs)-1; i++ {
		for j := i + 1; j < len(allLogs); j++ {
			if allLogs[i].Timestamp < allLogs[j].Timestamp {
				allLogs[i], allLogs[j] = allLogs[j], allLogs[i]
			}
		}
	}

	// Limit results
	if len(allLogs) > tail {
		allLogs = allLogs[:tail]
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"logs":  allLogs,
		"total": len(allLogs),
	})
}

func (h *AuditHandler) fetchContainerLogs(container string, tail int, level string) []SystemLogEntry {
	logs := []SystemLogEntry{}

	// Use docker logs command
	cmd := exec.Command("docker", "logs", "--tail", strconv.Itoa(tail), "--timestamps", container)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return logs
	}

	// Parse log lines
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	logPattern := regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+(.*)$`)
	levelPattern := regexp.MustCompile(`(?i)\b(fatal|error|warn(?:ing)?|info|debug)\b`)

	containerShort := strings.TrimPrefix(container, "scv-")

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		entry := SystemLogEntry{
			Container: containerShort,
			Level:     "info",
		}

		// Try to extract timestamp
		if matches := logPattern.FindStringSubmatch(line); len(matches) > 0 {
			entry.Timestamp = matches[1]
			entry.Message = matches[2]
		} else {
			entry.Timestamp = time.Now().Format(time.RFC3339)
			entry.Message = line
		}

		// Detect log level
		if levelMatch := levelPattern.FindStringSubmatch(entry.Message); len(levelMatch) > 0 {
			detectedLevel := strings.ToLower(levelMatch[1])
			if detectedLevel == "warning" {
				detectedLevel = "warn"
			}
			entry.Level = detectedLevel
		}

		// Filter by level if specified
		if level != "" && level != entry.Level {
			continue
		}

		logs = append(logs, entry)
	}

	return logs
}
