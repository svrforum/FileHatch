package docs

// Common response models for Swagger documentation

// SuccessResponse represents a successful API response
type SuccessResponse struct {
	Success bool        `json:"success" example:"true"`
	Data    interface{} `json:"data"`
}

// ErrorResponse represents an error API response
type ErrorResponse struct {
	Success bool   `json:"success" example:"false"`
	Error   string `json:"error" example:"Error message"`
}

// MessageResponse represents a simple message response
type MessageResponse struct {
	Success bool   `json:"success" example:"true"`
	Message string `json:"message" example:"Operation completed successfully"`
}

// LoginRequest represents login credentials
type LoginRequest struct {
	Username string `json:"username" example:"admin"`
	Password string `json:"password" example:"admin1234"`
}

// LoginResponse represents successful login response
type LoginResponse struct {
	Success bool `json:"success" example:"true"`
	Data    struct {
		Token          string `json:"token" example:"eyJhbGciOiJIUzI1NiIs..."`
		User           User   `json:"user"`
		Requires2FA    bool   `json:"requires2fa" example:"false"`
		Pending2FAUser *User  `json:"pending2faUser,omitempty"`
	} `json:"data"`
}

// User represents a user object
type User struct {
	ID           string `json:"id" example:"550e8400-e29b-41d4-a716-446655440000"`
	Username     string `json:"username" example:"admin"`
	Email        string `json:"email" example:"admin@example.com"`
	IsAdmin      bool   `json:"isAdmin" example:"true"`
	IsActive     bool   `json:"isActive" example:"true"`
	StorageQuota int64  `json:"storageQuota" example:"10737418240"`
	StorageUsed  int64  `json:"storageUsed" example:"5368709120"`
	CreatedAt    string `json:"createdAt" example:"2024-01-01T00:00:00Z"`
	Provider     string `json:"provider" example:"local"`
	TOTPEnabled  bool   `json:"totpEnabled" example:"false"`
}

// FileItem represents a file or folder
type FileItem struct {
	Name       string `json:"name" example:"document.pdf"`
	Path       string `json:"path" example:"/home/admin/document.pdf"`
	Size       int64  `json:"size" example:"1048576"`
	IsDir      bool   `json:"isDir" example:"false"`
	ModTime    string `json:"modTime" example:"2024-01-01T12:00:00Z"`
	Extension  string `json:"extension" example:"pdf"`
	MimeType   string `json:"mimeType" example:"application/pdf"`
	Permission int    `json:"permission" example:"2"`
}

// FileListResponse represents file listing response
type FileListResponse struct {
	Success bool `json:"success" example:"true"`
	Data    struct {
		Files       []FileItem `json:"files"`
		TotalCount  int        `json:"totalCount" example:"100"`
		HasNextPage bool       `json:"hasNextPage" example:"true"`
	} `json:"data"`
}

// ShareRequest represents share creation request
type ShareRequest struct {
	Path         string `json:"path" example:"/home/admin/document.pdf"`
	ShareType    string `json:"shareType" example:"download" enums:"download,upload,edit"`
	Password     string `json:"password,omitempty" example:"secret123"`
	ExpiresIn    int    `json:"expiresIn,omitempty" example:"7"` // days
	MaxAccess    int    `json:"maxAccess,omitempty" example:"10"`
	RequireLogin bool   `json:"requireLogin,omitempty" example:"false"`
}

// Share represents a share object
type Share struct {
	ID           string `json:"id" example:"550e8400-e29b-41d4-a716-446655440000"`
	Token        string `json:"token" example:"abc123def456"`
	Path         string `json:"path" example:"/home/admin/document.pdf"`
	ShareType    string `json:"shareType" example:"download"`
	HasPassword  bool   `json:"hasPassword" example:"true"`
	ExpiresAt    string `json:"expiresAt,omitempty" example:"2024-12-31T23:59:59Z"`
	AccessCount  int    `json:"accessCount" example:"5"`
	MaxAccess    int    `json:"maxAccess,omitempty" example:"10"`
	RequireLogin bool   `json:"requireLogin" example:"false"`
	CreatedAt    string `json:"createdAt" example:"2024-01-01T00:00:00Z"`
	URL          string `json:"url" example:"http://localhost:3080/s/abc123def456"`
}

// SharedFolder represents a team shared folder
type SharedFolder struct {
	ID           string               `json:"id" example:"550e8400-e29b-41d4-a716-446655440000"`
	Name         string               `json:"name" example:"Team Documents"`
	Description  string               `json:"description" example:"Shared folder for team collaboration"`
	StorageQuota int64                `json:"storageQuota" example:"10737418240"`
	StorageUsed  int64                `json:"storageUsed" example:"5368709120"`
	CreatedBy    string               `json:"createdBy" example:"admin"`
	CreatedAt    string               `json:"createdAt" example:"2024-01-01T00:00:00Z"`
	IsActive     bool                 `json:"isActive" example:"true"`
	Members      []SharedFolderMember `json:"members,omitempty"`
}

// SharedFolderMember represents a member of shared folder
type SharedFolderMember struct {
	UserID          string `json:"userId" example:"550e8400-e29b-41d4-a716-446655440000"`
	Username        string `json:"username" example:"user1"`
	PermissionLevel int    `json:"permissionLevel" example:"2"` // 1=read, 2=read-write
	AddedAt         string `json:"addedAt" example:"2024-01-01T00:00:00Z"`
}

// FileShare represents user-to-user sharing
type FileShare struct {
	ID              int64  `json:"id" example:"1"`
	ItemPath        string `json:"itemPath" example:"/home/admin/document.pdf"`
	ItemName        string `json:"itemName" example:"document.pdf"`
	IsFolder        bool   `json:"isFolder" example:"false"`
	OwnerID         string `json:"ownerId" example:"550e8400-e29b-41d4-a716-446655440000"`
	OwnerName       string `json:"ownerName" example:"admin"`
	SharedWithID    string `json:"sharedWithId" example:"660e8400-e29b-41d4-a716-446655440001"`
	SharedWithName  string `json:"sharedWithName" example:"user1"`
	PermissionLevel int    `json:"permissionLevel" example:"1"` // 1=read, 2=read-write
	Message         string `json:"message,omitempty" example:"Please review this document"`
	CreatedAt       string `json:"createdAt" example:"2024-01-01T00:00:00Z"`
}

// Notification represents an in-app notification
type Notification struct {
	ID        int64  `json:"id" example:"1"`
	Type      string `json:"type" example:"share.received"`
	Title     string `json:"title" example:"New file shared with you"`
	Message   string `json:"message" example:"admin shared 'document.pdf' with you"`
	Link      string `json:"link,omitempty" example:"/shared-with-me"`
	IsRead    bool   `json:"isRead" example:"false"`
	CreatedAt string `json:"createdAt" example:"2024-01-01T12:00:00Z"`
	ActorName string `json:"actorName,omitempty" example:"admin"`
}

// AuditLog represents an audit log entry
type AuditLog struct {
	ID             int64       `json:"id" example:"1"`
	Timestamp      string      `json:"ts" example:"2024-01-01T12:00:00Z"`
	ActorID        string      `json:"actorId" example:"550e8400-e29b-41d4-a716-446655440000"`
	ActorName      string      `json:"actorName" example:"admin"`
	IPAddress      string      `json:"ipAddr" example:"192.168.1.100"`
	EventType      string      `json:"eventType" example:"file.uploaded"`
	TargetResource string      `json:"targetResource" example:"/home/admin/document.pdf"`
	Details        interface{} `json:"details,omitempty"`
}

// SystemInfo represents system information
type SystemInfo struct {
	Hostname    string      `json:"hostname" example:"scv-server"`
	OS          string      `json:"os" example:"linux"`
	Arch        string      `json:"arch" example:"amd64"`
	CPUs        int         `json:"cpus" example:"4"`
	GoVersion   string      `json:"goVersion" example:"go1.23"`
	Memory      MemoryInfo  `json:"memory"`
	Disk        DiskInfo    `json:"disk"`
	Uptime      string      `json:"uptime" example:"5d 12h 30m"`
	ServerTime  string      `json:"serverTime" example:"2024-01-01T12:00:00 KST"`
	DataPath    string      `json:"dataPath" example:"/data"`
	ProjectInfo ProjectInfo `json:"projectInfo"`
}

// MemoryInfo represents memory usage
type MemoryInfo struct {
	Total     uint64 `json:"total" example:"8589934592"`
	Used      uint64 `json:"used" example:"4294967296"`
	Free      uint64 `json:"free" example:"4294967296"`
	UsedPct   float64 `json:"usedPct" example:"50.0"`
	Formatted struct {
		Total string `json:"total" example:"8.00 GB"`
		Used  string `json:"used" example:"4.00 GB"`
		Free  string `json:"free" example:"4.00 GB"`
	} `json:"formatted"`
}

// DiskInfo represents disk usage
type DiskInfo struct {
	Total     uint64 `json:"total" example:"107374182400"`
	Used      uint64 `json:"used" example:"53687091200"`
	Free      uint64 `json:"free" example:"53687091200"`
	UsedPct   float64 `json:"usedPct" example:"50.0"`
	Formatted struct {
		Total string `json:"total" example:"100.00 GB"`
		Used  string `json:"used" example:"50.00 GB"`
		Free  string `json:"free" example:"50.00 GB"`
	} `json:"formatted"`
}

// ProjectInfo represents project statistics
type ProjectInfo struct {
	TotalSize     int64  `json:"totalSize" example:"10737418240"`
	TotalFiles    int    `json:"totalFiles" example:"1000"`
	TotalFolders  int    `json:"totalFolders" example:"100"`
	UsersCount    int    `json:"usersCount" example:"10"`
	SharedFolders int    `json:"sharedFolders" example:"5"`
	Formatted     string `json:"formatted" example:"10.00 GB"`
}

// TwoFASetupResponse represents 2FA setup response
type TwoFASetupResponse struct {
	Success bool `json:"success" example:"true"`
	Data    struct {
		Secret    string `json:"secret" example:"JBSWY3DPEHPK3PXP"`
		QRCodeURL string `json:"qrCodeUrl" example:"otpauth://totp/SimpleCloudVault:admin?secret=JBSWY3DPEHPK3PXP&issuer=SimpleCloudVault"`
		QRCodeB64 string `json:"qrCodeB64" example:"data:image/png;base64,iVBORw0KGgo..."`
	} `json:"data"`
}

// TwoFAEnableRequest represents 2FA enable request
type TwoFAEnableRequest struct {
	Code string `json:"code" example:"123456"`
}

// TwoFAVerifyRequest represents 2FA verification request
type TwoFAVerifyRequest struct {
	UserID string `json:"userId" example:"550e8400-e29b-41d4-a716-446655440000"`
	Code   string `json:"code" example:"123456"`
}

// StorageUsageResponse represents storage usage response
type StorageUsageResponse struct {
	Success bool `json:"success" example:"true"`
	Data    struct {
		Used      int64   `json:"used" example:"5368709120"`
		Quota     int64   `json:"quota" example:"10737418240"`
		UsedPct   float64 `json:"usedPct" example:"50.0"`
		Formatted struct {
			Used  string `json:"used" example:"5.00 GB"`
			Quota string `json:"quota" example:"10.00 GB"`
		} `json:"formatted"`
	} `json:"data"`
}

// CreateFolderRequest represents folder creation request
type CreateFolderRequest struct {
	Path string `json:"path" example:"/home/admin"`
	Name string `json:"name" example:"New Folder"`
}

// CreateFileRequest represents file creation request
type CreateFileRequest struct {
	Path     string `json:"path" example:"/home/admin"`
	Filename string `json:"filename" example:"document.txt"`
	FileType string `json:"fileType" example:"txt" enums:"txt,md,html,json,docx,xlsx,pptx"`
}

// RenameRequest represents rename operation request
type RenameRequest struct {
	NewName string `json:"newName" example:"renamed-file.pdf"`
}

// MoveRequest represents move operation request
type MoveRequest struct {
	Destination string `json:"destination" example:"/home/admin/documents"`
}

// FileShareRequest represents file share creation request
type FileShareRequest struct {
	ItemPath        string `json:"itemPath" example:"/home/admin/document.pdf"`
	SharedWithID    string `json:"sharedWithId" example:"660e8400-e29b-41d4-a716-446655440001"`
	PermissionLevel int    `json:"permissionLevel" example:"1" enums:"1,2"` // 1=read, 2=read-write
	Message         string `json:"message,omitempty" example:"Please review this document"`
}

// SharedFolderRequest represents shared folder creation request
type SharedFolderRequest struct {
	Name         string `json:"name" example:"Team Documents"`
	Description  string `json:"description,omitempty" example:"Shared folder for team"`
	StorageQuota int64  `json:"storageQuota,omitempty" example:"10737418240"`
}

// AddMemberRequest represents add member request
type AddMemberRequest struct {
	UserID          string `json:"userId" example:"660e8400-e29b-41d4-a716-446655440001"`
	PermissionLevel int    `json:"permissionLevel" example:"2" enums:"1,2"`
}

// CreateUserRequest represents user creation request
type CreateUserRequest struct {
	Username     string   `json:"username" example:"newuser"`
	Email        string   `json:"email" example:"newuser@example.com"`
	Password     string   `json:"password" example:"password123"`
	IsAdmin      bool     `json:"isAdmin" example:"false"`
	StorageQuota int64    `json:"storageQuota,omitempty" example:"10737418240"`
	SharedDrives []string `json:"sharedDrives,omitempty" example:"[\"drive1-id\", \"drive2-id\"]"`
}

// UpdateUserRequest represents user update request
type UpdateUserRequest struct {
	Email        string `json:"email,omitempty" example:"updated@example.com"`
	Password     string `json:"password,omitempty" example:"newpassword123"`
	IsAdmin      bool   `json:"isAdmin,omitempty" example:"false"`
	IsActive     bool   `json:"isActive,omitempty" example:"true"`
	StorageQuota int64  `json:"storageQuota,omitempty" example:"10737418240"`
}

// SSOProvider represents SSO provider configuration
type SSOProvider struct {
	ID               string `json:"id" example:"550e8400-e29b-41d4-a716-446655440000"`
	Name             string `json:"name" example:"Company SSO"`
	ProviderType     string `json:"providerType" example:"oidc" enums:"oidc,google,azure,github"`
	ClientID         string `json:"clientId" example:"client-id-here"`
	IssuerURL        string `json:"issuerUrl,omitempty" example:"https://auth.example.com/realms/master"`
	AuthorizationURL string `json:"authorizationUrl,omitempty" example:"https://auth.example.com/auth"`
	TokenURL         string `json:"tokenUrl,omitempty" example:"https://auth.example.com/token"`
	UserInfoURL      string `json:"userinfoUrl,omitempty" example:"https://auth.example.com/userinfo"`
	Scopes           string `json:"scopes" example:"openid profile email"`
	AllowedDomains   string `json:"allowedDomains,omitempty" example:"example.com"`
	AutoCreateUser   bool   `json:"autoCreateUser" example:"true"`
	DefaultAdmin     bool   `json:"defaultAdmin" example:"false"`
	IsEnabled        bool   `json:"isEnabled" example:"true"`
	DisplayOrder     int    `json:"displayOrder" example:"1"`
	IconURL          string `json:"iconUrl,omitempty" example:"https://example.com/icon.png"`
	ButtonColor      string `json:"buttonColor,omitempty" example:"#4285F4"`
}

// TrashItem represents a trash item
type TrashItem struct {
	ID           string `json:"id" example:"1704067200000000000_document.pdf"`
	OriginalPath string `json:"originalPath" example:"/home/admin/document.pdf"`
	Name         string `json:"name" example:"document.pdf"`
	Size         int64  `json:"size" example:"1048576"`
	IsDir        bool   `json:"isDir" example:"false"`
	DeletedAt    string `json:"deletedAt" example:"2024-01-01T12:00:00Z"`
	DeletedBy    string `json:"deletedBy" example:"admin"`
}

// FolderStats represents folder statistics
type FolderStats struct {
	TotalSize   int64  `json:"totalSize" example:"10737418240"`
	TotalFiles  int    `json:"totalFiles" example:"100"`
	TotalDirs   int    `json:"totalDirs" example:"10"`
	Formatted   string `json:"formatted" example:"10.00 GB"`
}

// HealthResponse represents health check response
type HealthResponse struct {
	Status  string `json:"status" example:"ok"`
	Version string `json:"version" example:"1.0.0"`
}

// PaginationParams represents common pagination parameters
type PaginationParams struct {
	Page  int `query:"page" example:"1"`
	Limit int `query:"limit" example:"50"`
}

// NotificationListResponse represents notification list response data
type NotificationListResponse struct {
	Notifications []Notification `json:"notifications"`
	Total         int            `json:"total" example:"10"`
	Limit         int            `json:"limit" example:"50"`
	Offset        int            `json:"offset" example:"0"`
}

// UnreadCountResponse represents unread count response data
type UnreadCountResponse struct {
	UnreadCount int `json:"unreadCount" example:"5"`
}

// TrashListResponse represents trash list response data
type TrashListResponse struct {
	Items     []TrashItem `json:"items"`
	Total     int         `json:"total" example:"5"`
	TotalSize int64       `json:"totalSize" example:"5242880"`
}

// TrashStatsResponse represents trash statistics response
type TrashStatsResponse struct {
	ItemCount            int    `json:"itemCount" example:"10"`
	TotalSize            int64  `json:"totalSize" example:"10485760"`
	RetentionDays        int    `json:"retentionDays" example:"30"`
	OldestItem           string `json:"oldestItem,omitempty" example:"2024-01-01T12:00:00Z"`
	OldestItemDaysLeft   int    `json:"oldestItemDaysLeft,omitempty" example:"15"`
	NewestItem           string `json:"newestItem,omitempty" example:"2024-01-15T12:00:00Z"`
}

// AuditLogListResponse represents audit log list response data
type AuditLogListResponse struct {
	Logs   []AuditLog `json:"logs"`
	Total  int        `json:"total" example:"100"`
	Limit  int        `json:"limit" example:"100"`
	Offset int        `json:"offset" example:"0"`
}
