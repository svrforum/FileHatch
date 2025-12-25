package handlers

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// SMBClientCache caches SMB client connections
type SMBClientCache struct {
	mu        sync.RWMutex
	clients   map[string]string // username -> IP
	lastFetch time.Time
	cacheTTL  time.Duration
}

var smbClientCache = &SMBClientCache{
	clients:  make(map[string]string),
	cacheTTL: 5 * time.Second, // Refresh cache every 5 seconds
}

// GetSMBClientIP returns the IP address for an SMB client by username
func GetSMBClientIP(username string) string {
	smbClientCache.mu.RLock()
	needsRefresh := time.Since(smbClientCache.lastFetch) > smbClientCache.cacheTTL
	if !needsRefresh {
		ip := smbClientCache.clients[username]
		smbClientCache.mu.RUnlock()
		return ip
	}
	smbClientCache.mu.RUnlock()

	// Refresh cache
	smbClientCache.mu.Lock()
	defer smbClientCache.mu.Unlock()

	// Double-check after acquiring write lock
	if time.Since(smbClientCache.lastFetch) <= smbClientCache.cacheTTL {
		return smbClientCache.clients[username]
	}

	// Run smbstatus to get current connections
	cmd := exec.Command("docker", "exec", "scv-samba", "smbstatus", "-b")
	output, err := cmd.Output()
	if err != nil {
		log.Printf("[SMB] Failed to get smbstatus: %v", err)
		return ""
	}

	// Parse smbstatus output
	// Format: PID  Username  Group  Machine  Protocol  Encryption  Signing
	// Example: 234  admin  admin  172.28.128.1 (ipv4:172.28.128.1:58046)  SMB3_11  -  AES-128-CMAC
	smbClientCache.clients = make(map[string]string)
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	ipPattern := regexp.MustCompile(`(\d+\.\d+\.\d+\.\d+)`)

	for scanner.Scan() {
		line := scanner.Text()
		// Skip header lines
		if strings.HasPrefix(line, "Samba") || strings.HasPrefix(line, "PID") || strings.HasPrefix(line, "---") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) >= 4 {
			user := fields[1]
			machineField := fields[3]
			if matches := ipPattern.FindStringSubmatch(machineField); len(matches) > 0 {
				smbClientCache.clients[user] = matches[1]
			}
		}
	}

	smbClientCache.lastFetch = time.Now()
	return smbClientCache.clients[username]
}

// FileWatcher watches the data directory for changes
type FileWatcher struct {
	watcher  *fsnotify.Watcher
	dataRoot string
	db       *sql.DB
}

// NewFileWatcher creates a new file watcher
func NewFileWatcher(dataRoot string, db *sql.DB) (*FileWatcher, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	fw := &FileWatcher{
		watcher:  watcher,
		dataRoot: dataRoot,
		db:       db,
	}

	return fw, nil
}

// Start begins watching the data directory
func (fw *FileWatcher) Start() error {
	// Add all directories recursively
	err := filepath.Walk(fw.dataRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}
		if info.IsDir() {
			// Skip .trash directories
			if strings.Contains(path, "/.trash") {
				return filepath.SkipDir
			}
			if err := fw.watcher.Add(path); err != nil {
				log.Printf("[Watcher] Failed to watch %s: %v", path, err)
			} else {
				log.Printf("[Watcher] Watching: %s", path)
			}
		}
		return nil
	})
	if err != nil {
		return err
	}

	// Start event loop
	go fw.eventLoop()

	log.Printf("[Watcher] Started watching %s", fw.dataRoot)
	return nil
}

// Stop stops the file watcher
func (fw *FileWatcher) Stop() error {
	return fw.watcher.Close()
}

// debounceEntry stores debounce info for a path
type debounceEntry struct {
	lastTime  time.Time
	lastEvent string
}

func (fw *FileWatcher) eventLoop() {
	// Debounce map to avoid duplicate events
	debounce := make(map[string]*debounceEntry)
	debounceMu := &sync.Mutex{} // Protect debounce map
	debounceInterval := 2 * time.Second // Longer interval to catch related events

	// Cleanup old entries every 30 seconds to prevent memory leak
	cleanupTicker := time.NewTicker(30 * time.Second)
	defer cleanupTicker.Stop()

	// Cleanup function removes entries older than 1 minute
	cleanupDebounce := func() {
		debounceMu.Lock()
		defer debounceMu.Unlock()
		cutoff := time.Now().Add(-1 * time.Minute)
		for path, entry := range debounce {
			if entry.lastTime.Before(cutoff) {
				delete(debounce, path)
			}
		}
	}

	for {
		select {
		case <-cleanupTicker.C:
			cleanupDebounce()

		case event, ok := <-fw.watcher.Events:
			if !ok {
				return
			}

			// Skip .trash and .uploads directory events
			if strings.Contains(event.Name, "/.trash") || strings.Contains(event.Name, "/.uploads") {
				continue
			}

			// Skip temporary files and hidden files
			baseName := filepath.Base(event.Name)
			if strings.HasPrefix(baseName, ".") || strings.HasSuffix(baseName, ".tmp") {
				continue
			}

			now := time.Now()

			// Convert filesystem path to virtual path
			virtualPath := fw.toVirtualPath(event.Name)
			if virtualPath == "" {
				continue
			}

			// Determine event type
			var eventType string
			var auditEventType string
			switch {
			case event.Op&fsnotify.Create == fsnotify.Create:
				eventType = "create"
				auditEventType = EventSMBCreate
				// If a new directory is created, add it to watch list
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
					fw.watcher.Add(event.Name)
				}
			case event.Op&fsnotify.Write == fsnotify.Write:
				eventType = "write"
				auditEventType = EventSMBModify
			case event.Op&fsnotify.Remove == fsnotify.Remove:
				eventType = "remove"
				auditEventType = EventSMBDelete
			case event.Op&fsnotify.Rename == fsnotify.Rename:
				eventType = "rename"
				auditEventType = EventSMBRename
			default:
				continue
			}

			// Smart debounce logic:
			// 1. Skip WRITE events if we recently saw CREATE for same file
			// 2. Skip duplicate events of same type within debounce interval
			debounceMu.Lock()
			entry, exists := debounce[event.Name]
			shouldSkip := false
			if exists {
				timeSinceLastEvent := now.Sub(entry.lastTime)

				// Skip WRITE if we just saw CREATE (file is still being written)
				if eventType == "write" && entry.lastEvent == "create" && timeSinceLastEvent < debounceInterval {
					shouldSkip = true
				}

				// Skip duplicate same-type events within short interval
				if entry.lastEvent == eventType && timeSinceLastEvent < 500*time.Millisecond {
					shouldSkip = true
				}
			}

			// Update debounce entry
			debounce[event.Name] = &debounceEntry{
				lastTime:  now,
				lastEvent: eventType,
			}
			debounceMu.Unlock()

			if shouldSkip {
				continue
			}

			// Extract username from path for audit logging
			username := fw.extractUsername(event.Name)

			// Check if it's a directory
			isDir := false
			if info, err := os.Stat(event.Name); err == nil {
				isDir = info.IsDir()
			}

			// Broadcast the event for real-time UI updates
			changeEvent := FileChangeEvent{
				Type:      eventType,
				Path:      virtualPath,
				Name:      filepath.Base(event.Name),
				IsDir:     isDir,
				Timestamp: now.Unix(),
			}

			log.Printf("[Watcher] Event: %s %s (isDir: %v)", eventType, virtualPath, isDir)
			BroadcastFileChange(changeEvent)

			// Log to audit (SMB operations) - only for create/delete/rename, not modify
			// Skip if this is a web upload (not SMB)
			if eventType != "write" && !GetWebUploadTracker().IsWebUpload(event.Name) {
				fw.logAuditEvent(username, auditEventType, virtualPath, map[string]interface{}{
					"source":   "smb",
					"fileName": filepath.Base(event.Name),
					"isDir":    isDir,
				})
			}

		case err, ok := <-fw.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("[Watcher] Error: %v", err)
		}
	}
}

// toVirtualPath converts a filesystem path to a virtual path
func (fw *FileWatcher) toVirtualPath(fsPath string) string {
	// Remove dataRoot prefix
	relPath := strings.TrimPrefix(fsPath, fw.dataRoot)
	if relPath == fsPath {
		return ""
	}

	// Clean the path
	relPath = filepath.Clean(relPath)
	if !strings.HasPrefix(relPath, "/") {
		relPath = "/" + relPath
	}

	// Convert /users/{username}/... to /home/...
	// Convert /shared/... to /shared/...
	parts := strings.Split(strings.TrimPrefix(relPath, "/"), "/")
	if len(parts) >= 2 && parts[0] == "users" {
		// /users/{username}/... -> /home/...
		if len(parts) > 2 {
			return "/home/" + strings.Join(parts[2:], "/")
		}
		return "/home"
	} else if len(parts) >= 1 && parts[0] == "shared" {
		// /shared/... -> /shared/...
		return relPath
	}

	// For other paths, return as-is but this shouldn't happen in normal use
	return relPath
}

// extractUsername extracts username from filesystem path
func (fw *FileWatcher) extractUsername(fsPath string) string {
	relPath := strings.TrimPrefix(fsPath, fw.dataRoot)
	parts := strings.Split(strings.TrimPrefix(relPath, "/"), "/")

	// /users/{username}/... -> username
	if len(parts) >= 2 && parts[0] == "users" {
		return parts[1]
	}

	// For shared folder, we can't determine the user
	return ""
}

// logAuditEvent logs an SMB file operation to the audit log
func (fw *FileWatcher) logAuditEvent(username, eventType, targetResource string, details map[string]interface{}) {
	if fw.db == nil {
		return
	}

	// Find user ID by username
	var actorID *string
	if username != "" {
		var userID string
		err := fw.db.QueryRow("SELECT id FROM users WHERE username = $1", username).Scan(&userID)
		if err == nil {
			actorID = &userID
		}
	}

	// Get SMB client IP from smbstatus
	clientIP := ""
	if username != "" {
		clientIP = GetSMBClientIP(username)
	}

	detailsJSON, _ := json.Marshal(details)

	// Use client IP if available, otherwise NULL
	var err error
	if clientIP != "" {
		_, err = fw.db.Exec(`
			INSERT INTO audit_logs (actor_id, ip_addr, event_type, target_resource, details)
			VALUES ($1, $2::inet, $3, $4, $5)
		`, actorID, clientIP, eventType, targetResource, detailsJSON)
	} else {
		_, err = fw.db.Exec(`
			INSERT INTO audit_logs (actor_id, ip_addr, event_type, target_resource, details)
			VALUES ($1, NULL, $2, $3, $4)
		`, actorID, eventType, targetResource, detailsJSON)
	}

	if err != nil {
		log.Printf("[Watcher] Failed to log audit event: %v", err)
	}
}
