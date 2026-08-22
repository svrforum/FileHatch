package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/net/webdav"
)

// WebDAVHandler handles WebDAV requests
type WebDAVHandler struct {
	db         *sql.DB
	dataRoot   string
	lockSystem webdav.LockSystem
	handler    *Handler // For trash functionality
}

// NewWebDAVHandler creates a new WebDAV handler
func NewWebDAVHandler(db *sql.DB, dataRoot string, handler *Handler) *WebDAVHandler {
	return &WebDAVHandler{
		db:         db,
		dataRoot:   dataRoot,
		lockSystem: webdav.NewMemLS(),
		handler:    handler,
	}
}

// ServeHTTP implements http.Handler for WebDAV
func (h *WebDAVHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Handle OPTIONS without authentication (required for WebDAV discovery)
	if r.Method == "OPTIONS" {
		w.Header().Set("Allow", "OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK")
		w.Header().Set("DAV", "1, 2")
		w.Header().Set("MS-Author-Via", "DAV")
		w.WriteHeader(http.StatusOK)
		return
	}

	// Authenticate user
	username, password, ok := r.BasicAuth()
	if !ok {
		w.Header().Set("WWW-Authenticate", `Basic realm="FileHatch WebDAV"`)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Verify credentials using application password (same as SMB)
	user, err := h.authenticateUser(username, password)
	if err != nil {
		w.Header().Set("WWW-Authenticate", `Basic realm="FileHatch WebDAV"`)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Create virtual filesystem for this user
	vfs := &VirtualFS{
		db:       h.db,
		dataRoot: h.dataRoot,
		user:     user,
		handler:  h.handler,
	}

	// Create WebDAV handler with shared lock system
	davHandler := &webdav.Handler{
		Prefix:     "/webdav",
		FileSystem: vfs,
		LockSystem: h.lockSystem,
		Logger: func(r *http.Request, err error) {
			if err != nil {
				fmt.Printf("[WebDAV] %s %s: %v\n", r.Method, r.URL.Path, err)
			}
		},
	}

	// Fix Destination header for MOVE/COPY behind reverse proxy.
	// WebDAV clients send the external host in the Destination header,
	// but the reverse proxy changes r.Host to the internal backend host.
	// The upstream webdav library rejects the request with 502 Bad Gateway
	// when Destination host doesn't match r.Host.
	if r.Method == "MOVE" || r.Method == "COPY" {
		if dst := r.Header.Get("Destination"); dst != "" {
			if dstURL, parseErr := url.Parse(dst); parseErr == nil && dstURL.Host != "" && dstURL.Host != r.Host {
				dstURL.Host = r.Host
				r.Header.Set("Destination", dstURL.String())
			}
		}
	}

	// Serve WebDAV request with status capturing
	sw := newStatusCapturingWriter(w, r)
	davHandler.ServeHTTP(sw, r)

	// Only log access for successful write operations
	if sw.statusCode == 0 || (sw.statusCode >= 200 && sw.statusCode < 300) {
		h.logAccess(user.ID, r)
	}
}

// UserInfo holds basic user info
type UserInfo struct {
	ID       string
	Username string
	IsAdmin  bool
}

// authenticateUser verifies username and password for WebDAV access.
// It first tries the application password (smb_hash), then falls back
// to the regular login password (password_hash) for user convenience.
func (h *WebDAVHandler) authenticateUser(username, password string) (*UserInfo, error) {
	var user UserInfo
	var smbHash sql.NullString
	var passwordHash sql.NullString

	err := h.db.QueryRow(`
		SELECT id, username, is_admin, smb_hash, password_hash
		FROM users
		WHERE username = $1 AND is_active = true
	`, username).Scan(&user.ID, &user.Username, &user.IsAdmin, &smbHash, &passwordHash)

	if err != nil {
		return nil, fmt.Errorf("user not found")
	}

	// Try application password first (smb_hash)
	if smbHash.Valid && smbHash.String != "" {
		if err := bcrypt.CompareHashAndPassword([]byte(smbHash.String), []byte(password)); err == nil {
			return &user, nil
		}
	}

	// Fall back to regular login password (password_hash)
	if passwordHash.Valid && passwordHash.String != "" {
		if err := bcrypt.CompareHashAndPassword([]byte(passwordHash.String), []byte(password)); err == nil {
			return &user, nil
		}
	}

	return nil, fmt.Errorf("invalid password")
}

// logAccess logs WebDAV access to audit log
func (h *WebDAVHandler) logAccess(userID string, r *http.Request) {
	// Only log write operations (not reads)
	// WebDAV clients often make GET requests for verification before operations,
	// which creates misleading "download" logs
	method := r.Method
	if method == "OPTIONS" || method == "PROPFIND" || method == "PROPPATCH" ||
	   method == "LOCK" || method == "UNLOCK" || method == "GET" || method == "HEAD" {
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/webdav")
	if path == "" || path == "/" {
		return
	}

	// Convert WebDAV path to display path
	// WebDAV path: /home/file.txt -> Display path: /home/username/file.txt
	// But actually WebDAV uses /home directly which maps to user's home
	displayPath := path

	// Use standard event types for consistency with web UI
	var eventType string
	switch method {
	case "PUT":
		eventType = EventFileUpload
	case "DELETE":
		// Check if it's a folder based on path (ends with /)
		if strings.HasSuffix(path, "/") {
			eventType = EventFolderDelete
		} else {
			eventType = EventFileDelete
		}
	case "MKCOL":
		eventType = EventFolderCreate
	case "MOVE":
		eventType = EventFileMove
	case "COPY":
		eventType = EventFileCopy
	default:
		return // Don't log other methods
	}

	_, _ = h.db.Exec(`
		INSERT INTO audit_logs (actor_id, ip_addr, event_type, target_resource, details)
		VALUES ($1, $2, $3, $4, $5)
	`, userID, getClientIP(r), eventType, displayPath, fmt.Sprintf(`{"source": "webdav", "method": "%s"}`, method))
}

// getClientIP extracts client IP from request
func getClientIP(r *http.Request) string {
	// Check X-Forwarded-For header
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ips := strings.Split(xff, ",")
		if len(ips) > 0 {
			return strings.TrimSpace(ips[0])
		}
	}

	// Check X-Real-IP header
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}

	// Fall back to RemoteAddr
	ip := r.RemoteAddr
	if colonIdx := strings.LastIndex(ip, ":"); colonIdx != -1 {
		ip = ip[:colonIdx]
	}
	return ip
}

// statusCapturingWriter wraps http.ResponseWriter to capture status codes
// and inject Cache-Control headers for non-GET/HEAD responses.
type statusCapturingWriter struct {
	http.ResponseWriter
	statusCode     int
	wroteHeader    bool
	noCacheHeaders bool
}

func newStatusCapturingWriter(w http.ResponseWriter, r *http.Request) *statusCapturingWriter {
	// Apply no-cache headers for all WebDAV methods except file content retrieval (GET/HEAD).
	// This is especially important for PROPFIND to prevent clients from caching directory listings.
	return &statusCapturingWriter{
		ResponseWriter: w,
		noCacheHeaders: r.Method != "GET" && r.Method != "HEAD",
	}
}

func (w *statusCapturingWriter) WriteHeader(code int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.statusCode = code
	if w.noCacheHeaders {
		h := w.ResponseWriter.Header()
		h.Set("Cache-Control", "no-cache, no-store, must-revalidate")
		// Windows' WebDAV redirector (WebClient) fetches through WinINET, an
		// HTTP/1.0-era stack that only drops a cached response when the
		// HTTP/1.0 directives are present too. Sending Cache-Control alone
		// leaves Explorer showing a stale directory listing for minutes after
		// a file appears on the server. See Issue #38.
		h.Set("Pragma", "no-cache")
		h.Set("Expires", "0")
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusCapturingWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

// VirtualFS implements webdav.FileSystem with virtual directories
// Structure:
//   /home/         -> User's home directory
//   /shared/       -> Shared folders the user has access to
type VirtualFS struct {
	db       *sql.DB
	dataRoot string
	user     *UserInfo
	handler  *Handler // For trash functionality
}

// Mkdir creates a directory
func (vfs *VirtualFS) Mkdir(ctx context.Context, name string, perm os.FileMode) error {
	realPath, err := vfs.resolvePath(name, true)
	if err != nil {
		return err
	}
	if err := os.Mkdir(realPath, perm); err != nil {
		return err
	}
	vfs.broadcastChange(name, "create", true)
	return nil
}

// OpenFile opens a file
func (vfs *VirtualFS) OpenFile(ctx context.Context, name string, flag int, perm os.FileMode) (webdav.File, error) {
	// Handle virtual root
	if name == "/" || name == "" {
		return &VirtualRootDir{vfs: vfs, name: "/"}, nil
	}

	// Handle /home virtual directory
	if name == "/home" || name == "/home/" {
		return &VirtualHomeDir{vfs: vfs}, nil
	}

	// Handle /shared virtual directory
	if name == "/shared" || name == "/shared/" {
		return &VirtualSharedDir{vfs: vfs}, nil
	}

	// Determine write intent from open flags so viewer-only users cannot upload via PUT
	write := flag&(os.O_WRONLY|os.O_RDWR|os.O_CREATE|os.O_TRUNC|os.O_APPEND) != 0

	// Resolve actual path
	realPath, err := vfs.resolvePath(name, write)
	if err != nil {
		return nil, err
	}

	return os.OpenFile(realPath, flag, perm)
}

// RemoveAll removes a file or directory (moves to trash instead of permanent deletion)
func (vfs *VirtualFS) RemoveAll(ctx context.Context, name string) error {
	realPath, err := vfs.resolvePath(name, true)
	if err != nil {
		return err
	}

	// Pre-stat for broadcast info
	info, statErr := os.Stat(realPath)
	isDir := statErr == nil && info.IsDir()

	// Temp files (e.g., ~$doc.docx, .~lock.file, *.tmp) are permanently deleted
	if isTempFile(name) {
		err = os.RemoveAll(realPath)
	} else if vfs.handler != nil {
		// Get virtual path for trash metadata
		virtualPath := vfs.getVirtualPath(name)
		err = vfs.handler.MoveToTrashInternal(
			vfs.user.Username,
			vfs.user.ID,
			virtualPath,
			realPath,
		)
	} else {
		// Fallback to permanent deletion if handler is not available
		err = os.RemoveAll(realPath)
	}

	if err == nil {
		vfs.broadcastChange(name, "remove", isDir)
	}
	return err
}

// broadcastChange sends a WebSocket file change event for WebDAV operations.
func (vfs *VirtualFS) broadcastChange(virtualName, eventType string, isDir bool) {
	BroadcastFileChange(FileChangeEvent{
		Type:      eventType,
		Path:      virtualName,
		Name:      filepath.Base(virtualName),
		IsDir:     isDir,
		Timestamp: time.Now().Unix(),
	})
}

// isTempFile checks if a file is a temporary file created by Office applications.
func isTempFile(name string) bool {
	base := filepath.Base(name)
	lower := strings.ToLower(base)
	return strings.HasPrefix(base, "~$") ||
		strings.HasPrefix(base, ".~lock.") ||
		strings.HasSuffix(lower, ".tmp")
}

// getVirtualPath converts WebDAV path to virtual display path
// This maintains consistency with web UI trash paths
func (vfs *VirtualFS) getVirtualPath(name string) string {
	name = filepath.Clean(name)

	// /home/* -> /home/* (keep as-is for consistency with web UI)
	// WebDAV /home/file.txt maps to user's home, same as web UI /home/file.txt
	if strings.HasPrefix(name, "/home/") || name == "/home" {
		return name
	}

	// /shared/* remains as is
	if strings.HasPrefix(name, "/shared/") {
		return name
	}

	return name
}

// Rename renames a file or directory
func (vfs *VirtualFS) Rename(ctx context.Context, oldName, newName string) error {
	oldPath, err := vfs.resolvePath(oldName, true)
	if err != nil {
		return err
	}
	newPath, err := vfs.resolvePath(newName, true)
	if err != nil {
		return err
	}

	// Pre-stat for broadcast info
	info, statErr := os.Stat(oldPath)
	isDir := statErr == nil && info.IsDir()

	if err := moveOrCopy(oldPath, newPath); err != nil {
		return err
	}
	vfs.broadcastChange(oldName, "remove", isDir)
	vfs.broadcastChange(newName, "create", isDir)
	return nil
}

// Stat returns file info
func (vfs *VirtualFS) Stat(ctx context.Context, name string) (os.FileInfo, error) {
	// Handle virtual root
	if name == "/" || name == "" {
		return &virtualDirInfo{name: "/", isDir: true, modTime: time.Now()}, nil
	}

	// Handle /home virtual directory - always use current time to prevent ETag caching.
	// The real directory mtime only changes for direct children, not nested changes,
	// so using time.Now() ensures clients always get fresh directory listings.
	if name == "/home" || name == "/home/" {
		return &virtualDirInfo{name: "home", isDir: true, modTime: time.Now()}, nil
	}

	// Handle /shared virtual directory - same as /home
	if name == "/shared" || name == "/shared/" {
		return &virtualDirInfo{name: "shared", isDir: true, modTime: time.Now()}, nil
	}

	// Resolve actual path
	realPath, err := vfs.resolvePath(name, false)
	if err != nil {
		return nil, err
	}

	info, err := os.Stat(realPath)
	if err != nil {
		return nil, err
	}
	// Real directories use freshDirInfo so each PROPFIND yields a new ETag —
	// otherwise nested changes (a file added in /shared/foo/sub/) leave the
	// parent's mtime unchanged and WebDAV clients cache stale listings for
	// minutes. See Issue #33.
	if info.IsDir() {
		return &freshDirInfo{FileInfo: info}, nil
	}
	return info, nil
}

// freshDirInfo wraps os.FileInfo for a directory and reports time.Now() as ModTime.
// This defeats client-side ETag caching of directory listings without affecting
// individual file metadata.
type freshDirInfo struct {
	os.FileInfo
}

func (f *freshDirInfo) ModTime() time.Time { return time.Now() }

// resolvePath converts virtual path to real filesystem path
func (vfs *VirtualFS) resolvePath(name string, write bool) (string, error) {
	name = filepath.Clean(name)

	// /home/* -> user's home directory (uses /data/users/{username})
	if strings.HasPrefix(name, "/home/") || name == "/home" {
		subPath := strings.TrimPrefix(name, "/home")
		userHome := filepath.Join(vfs.dataRoot, "users", vfs.user.Username)

		// Ensure user's home directory exists
		if err := os.MkdirAll(userHome, 0755); err != nil {
			return "", err
		}

		return filepath.Join(userHome, subPath), nil
	}

	// /shared/{folder-name}/* -> shared folder
	if strings.HasPrefix(name, "/shared/") {
		parts := strings.SplitN(strings.TrimPrefix(name, "/shared/"), "/", 2)
		folderName := parts[0]

		// Get shared folder info and check access
		folder, err := vfs.getSharedFolder(folderName)
		if err != nil {
			return "", os.ErrPermission
		}

		// Check write permission
		if write && folder.Permission == "viewer" {
			return "", os.ErrPermission
		}

		subPath := ""
		if len(parts) > 1 {
			subPath = parts[1]
		}

		return filepath.Join(folder.Path, subPath), nil
	}

	return "", os.ErrNotExist
}

// SharedFolderInfo holds shared folder info
type SharedFolderInfo struct {
	ID         string
	Name       string
	Path       string
	Permission string
}

// getSharedFolder returns shared folder info if user has access
func (vfs *VirtualFS) getSharedFolder(name string) (*SharedFolderInfo, error) {
	var folder SharedFolderInfo
	var permLevel int

	err := vfs.db.QueryRow(`
		SELECT sf.id, sf.name, sfm.permission_level
		FROM shared_folders sf
		JOIN shared_folder_members sfm ON sf.id = sfm.shared_folder_id
		WHERE sf.name = $1 AND sfm.user_id = $2 AND sf.is_active = true
	`, name, vfs.user.ID).Scan(&folder.ID, &folder.Name, &permLevel)

	if err != nil {
		// Also check if user is admin with direct access
		if vfs.user.IsAdmin {
			err = vfs.db.QueryRow(`
				SELECT id, name
				FROM shared_folders
				WHERE name = $1 AND is_active = true
			`, name).Scan(&folder.ID, &folder.Name)

			if err == nil {
				folder.Permission = "admin"
				folder.Path = filepath.Join(vfs.dataRoot, "shared", folder.Name)
				return &folder, nil
			}
		}
		return nil, err
	}

	// Convert permission level to string (1=viewer, 2=editor, 3=admin)
	switch permLevel {
	case 1:
		folder.Permission = "viewer"
	case 2:
		folder.Permission = "editor"
	default:
		folder.Permission = "admin"
	}

	// Build path from folder name
	folder.Path = filepath.Join(vfs.dataRoot, "shared", folder.Name)
	return &folder, nil
}

// getUserSharedFolders returns all shared folders the user has access to
func (vfs *VirtualFS) getUserSharedFolders() ([]SharedFolderInfo, error) {
	query := `
		SELECT sf.id, sf.name, sfm.permission_level
		FROM shared_folders sf
		JOIN shared_folder_members sfm ON sf.id = sfm.shared_folder_id
		WHERE sfm.user_id = $1 AND sf.is_active = true
		ORDER BY sf.name
	`

	rows, err := vfs.db.Query(query, vfs.user.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var folders []SharedFolderInfo
	for rows.Next() {
		var folder SharedFolderInfo
		var permLevel int
		if err := rows.Scan(&folder.ID, &folder.Name, &permLevel); err != nil {
			continue
		}
		switch permLevel {
		case 1:
			folder.Permission = "viewer"
		case 2:
			folder.Permission = "editor"
		default:
			folder.Permission = "admin"
		}
		folder.Path = filepath.Join(vfs.dataRoot, "shared", folder.Name)
		folders = append(folders, folder)
	}

	// For admin, also get folders they own but aren't members of
	if vfs.user.IsAdmin {
		adminQuery := `
			SELECT sf.id, sf.name
			FROM shared_folders sf
			WHERE sf.created_by = $1 AND sf.is_active = true
			AND NOT EXISTS (
				SELECT 1 FROM shared_folder_members sfm
				WHERE sfm.shared_folder_id = sf.id AND sfm.user_id = $1
			)
		`
		adminRows, err := vfs.db.Query(adminQuery, vfs.user.ID)
		if err == nil {
			defer adminRows.Close()
			for adminRows.Next() {
				var folder SharedFolderInfo
				if err := adminRows.Scan(&folder.ID, &folder.Name); err == nil {
					folder.Permission = "admin"
					folder.Path = filepath.Join(vfs.dataRoot, "shared", folder.Name)
					folders = append(folders, folder)
				}
			}
		}
	}

	return folders, nil
}

// virtualDirInfo implements os.FileInfo for virtual directories
type virtualDirInfo struct {
	name    string
	isDir   bool
	modTime time.Time
}

func (v *virtualDirInfo) Name() string      { return v.name }
func (v *virtualDirInfo) Size() int64       { return 0 }
func (v *virtualDirInfo) Mode() os.FileMode { return os.ModeDir | 0755 }
func (v *virtualDirInfo) ModTime() time.Time {
	if !v.modTime.IsZero() {
		return v.modTime
	}
	return time.Now()
}
func (v *virtualDirInfo) IsDir() bool      { return v.isDir }
func (v *virtualDirInfo) Sys() interface{} { return nil }

// VirtualRootDir represents the root directory with /home and /shared
type VirtualRootDir struct {
	vfs      *VirtualFS
	name     string
	children []os.FileInfo
	pos      int
}

func (d *VirtualRootDir) Close() error { return nil }

func (d *VirtualRootDir) Read(p []byte) (n int, err error) {
	return 0, os.ErrInvalid
}

func (d *VirtualRootDir) Seek(offset int64, whence int) (int64, error) {
	return 0, os.ErrInvalid
}

func (d *VirtualRootDir) Readdir(count int) ([]os.FileInfo, error) {
	if d.children == nil {
		d.children = []os.FileInfo{
			&virtualDirInfo{name: "home", isDir: true},
			&virtualDirInfo{name: "shared", isDir: true},
		}
	}

	if count <= 0 {
		result := d.children[d.pos:]
		d.pos = len(d.children)
		return result, nil
	}

	end := d.pos + count
	if end > len(d.children) {
		end = len(d.children)
	}
	result := d.children[d.pos:end]
	d.pos = end
	return result, nil
}

func (d *VirtualRootDir) Stat() (os.FileInfo, error) {
	return &virtualDirInfo{name: "/", isDir: true, modTime: time.Now()}, nil
}

func (d *VirtualRootDir) Write(p []byte) (n int, err error) {
	return 0, os.ErrPermission
}

// VirtualHomeDir represents the /home directory pointing to user's home
type VirtualHomeDir struct {
	vfs     *VirtualFS
	realDir *os.File
	opened  bool
}

func (d *VirtualHomeDir) ensureOpen() error {
	if d.opened {
		return nil
	}
	userHome := filepath.Join(d.vfs.dataRoot, "users", d.vfs.user.Username)
	if err := os.MkdirAll(userHome, 0755); err != nil {
		return err
	}
	f, err := os.Open(userHome)
	if err != nil {
		return err
	}
	d.realDir = f
	d.opened = true
	return nil
}

func (d *VirtualHomeDir) Close() error {
	if d.realDir != nil {
		return d.realDir.Close()
	}
	return nil
}

func (d *VirtualHomeDir) Read(p []byte) (n int, err error) {
	return 0, os.ErrInvalid
}

func (d *VirtualHomeDir) Seek(offset int64, whence int) (int64, error) {
	return 0, os.ErrInvalid
}

func (d *VirtualHomeDir) Readdir(count int) ([]os.FileInfo, error) {
	if err := d.ensureOpen(); err != nil {
		return nil, err
	}
	return d.realDir.Readdir(count)
}

func (d *VirtualHomeDir) Stat() (os.FileInfo, error) {
	return &virtualDirInfo{name: "home", isDir: true, modTime: time.Now()}, nil
}

func (d *VirtualHomeDir) Write(p []byte) (n int, err error) {
	return 0, os.ErrPermission
}

// VirtualSharedDir represents the /shared directory listing shared folders
type VirtualSharedDir struct {
	vfs      *VirtualFS
	children []os.FileInfo
	pos      int
}

func (d *VirtualSharedDir) Close() error { return nil }

func (d *VirtualSharedDir) Read(p []byte) (n int, err error) {
	return 0, os.ErrInvalid
}

func (d *VirtualSharedDir) Seek(offset int64, whence int) (int64, error) {
	return 0, os.ErrInvalid
}

func (d *VirtualSharedDir) Readdir(count int) ([]os.FileInfo, error) {
	if d.children == nil {
		folders, err := d.vfs.getUserSharedFolders()
		if err != nil {
			return nil, err
		}
		d.children = make([]os.FileInfo, len(folders))
		for i, folder := range folders {
			d.children[i] = &virtualDirInfo{name: folder.Name, isDir: true}
		}
	}

	if count <= 0 {
		result := d.children[d.pos:]
		d.pos = len(d.children)
		return result, nil
	}

	end := d.pos + count
	if end > len(d.children) {
		end = len(d.children)
	}
	result := d.children[d.pos:end]
	d.pos = end
	return result, nil
}

func (d *VirtualSharedDir) Stat() (os.FileInfo, error) {
	return &virtualDirInfo{name: "shared", isDir: true, modTime: time.Now()}, nil
}

func (d *VirtualSharedDir) Write(p []byte) (n int, err error) {
	return 0, os.ErrPermission
}

// Ensure interfaces are implemented
var _ webdav.FileSystem = (*VirtualFS)(nil)
var _ webdav.File = (*VirtualRootDir)(nil)
var _ webdav.File = (*VirtualHomeDir)(nil)
var _ webdav.File = (*VirtualSharedDir)(nil)
var _ fs.FileInfo = (*virtualDirInfo)(nil)
