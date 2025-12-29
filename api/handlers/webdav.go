package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"net/http"
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
}

// NewWebDAVHandler creates a new WebDAV handler
func NewWebDAVHandler(db *sql.DB, dataRoot string) *WebDAVHandler {
	return &WebDAVHandler{
		db:         db,
		dataRoot:   dataRoot,
		lockSystem: webdav.NewMemLS(),
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
		w.Header().Set("WWW-Authenticate", `Basic realm="SimpleCloudVault WebDAV"`)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Verify credentials using application password (same as SMB)
	user, err := h.authenticateUser(username, password)
	if err != nil {
		w.Header().Set("WWW-Authenticate", `Basic realm="SimpleCloudVault WebDAV"`)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Create virtual filesystem for this user
	vfs := &VirtualFS{
		db:       h.db,
		dataRoot: h.dataRoot,
		user:     user,
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

	// Log access
	h.logAccess(user.ID, r)

	// Serve WebDAV request
	davHandler.ServeHTTP(w, r)
}

// UserInfo holds basic user info
type UserInfo struct {
	ID       string
	Username string
	IsAdmin  bool
}

// authenticateUser verifies username and application password
func (h *WebDAVHandler) authenticateUser(username, password string) (*UserInfo, error) {
	var user UserInfo
	var smbHash sql.NullString

	err := h.db.QueryRow(`
		SELECT id, username, is_admin, smb_hash
		FROM users
		WHERE username = $1 AND is_active = true
	`, username).Scan(&user.ID, &user.Username, &user.IsAdmin, &smbHash)

	if err != nil {
		return nil, fmt.Errorf("user not found")
	}

	if !smbHash.Valid || smbHash.String == "" {
		return nil, fmt.Errorf("application password not set")
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(smbHash.String), []byte(password)); err != nil {
		return nil, fmt.Errorf("invalid password")
	}

	return &user, nil
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

	h.db.Exec(`
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

// VirtualFS implements webdav.FileSystem with virtual directories
// Structure:
//   /home/         -> User's home directory
//   /shared/       -> Shared folders the user has access to
type VirtualFS struct {
	db       *sql.DB
	dataRoot string
	user     *UserInfo
}

// Mkdir creates a directory
func (vfs *VirtualFS) Mkdir(ctx context.Context, name string, perm os.FileMode) error {
	realPath, err := vfs.resolvePath(name, true)
	if err != nil {
		return err
	}
	return os.Mkdir(realPath, perm)
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

	// Resolve actual path
	realPath, err := vfs.resolvePath(name, false)
	if err != nil {
		return nil, err
	}

	return os.OpenFile(realPath, flag, perm)
}

// RemoveAll removes a file or directory
func (vfs *VirtualFS) RemoveAll(ctx context.Context, name string) error {
	realPath, err := vfs.resolvePath(name, true)
	if err != nil {
		return err
	}
	return os.RemoveAll(realPath)
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
	return os.Rename(oldPath, newPath)
}

// Stat returns file info
func (vfs *VirtualFS) Stat(ctx context.Context, name string) (os.FileInfo, error) {
	// Handle virtual root
	if name == "/" || name == "" {
		return &virtualDirInfo{name: "/", isDir: true}, nil
	}

	// Handle /home virtual directory
	if name == "/home" || name == "/home/" {
		return &virtualDirInfo{name: "home", isDir: true}, nil
	}

	// Handle /shared virtual directory
	if name == "/shared" || name == "/shared/" {
		return &virtualDirInfo{name: "shared", isDir: true}, nil
	}

	// Resolve actual path
	realPath, err := vfs.resolvePath(name, false)
	if err != nil {
		return nil, err
	}

	return os.Stat(realPath)
}

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
	name  string
	isDir bool
}

func (v *virtualDirInfo) Name() string       { return v.name }
func (v *virtualDirInfo) Size() int64        { return 0 }
func (v *virtualDirInfo) Mode() os.FileMode  { return os.ModeDir | 0755 }
func (v *virtualDirInfo) ModTime() time.Time { return time.Now() }
func (v *virtualDirInfo) IsDir() bool        { return v.isDir }
func (v *virtualDirInfo) Sys() interface{}   { return nil }

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
	return &virtualDirInfo{name: "/", isDir: true}, nil
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
	return &virtualDirInfo{name: "home", isDir: true}, nil
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
	return &virtualDirInfo{name: "shared", isDir: true}, nil
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
