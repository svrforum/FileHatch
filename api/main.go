package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/svrforum/FileHatch/api/database"
	_ "github.com/svrforum/FileHatch/api/docs" // Swagger docs
	"github.com/svrforum/FileHatch/api/handlers"
	echoSwagger "github.com/swaggo/echo-swagger"
	"golang.org/x/time/rate"
)

const dataRoot = "/data"

// getCORSOrigins returns allowed CORS origins from environment or defaults
func getCORSOrigins() []string {
	origins := os.Getenv("CORS_ALLOWED_ORIGINS")
	if origins == "" {
		env := os.Getenv("SCV_ENV")
		if env == "production" {
			log.Println("WARNING: CORS_ALLOWED_ORIGINS not set in production. Using restrictive defaults.")
			// In production without explicit config, only allow same-origin
			return []string{}
		}
		// Development defaults
		log.Println("CORS: Using development defaults (localhost:3000, 3080, 5173)")
		return []string{
			"http://localhost:3000",
			"http://localhost:3080",
			"http://localhost:5173",
			"http://127.0.0.1:3000",
			"http://127.0.0.1:3080",
			"http://127.0.0.1:5173",
		}
	}

	// Parse comma-separated origins
	originList := strings.Split(origins, ",")
	result := make([]string, 0, len(originList))
	for _, o := range originList {
		o = strings.TrimSpace(o)
		if o != "" {
			result = append(result, o)
		}
	}
	log.Printf("CORS: Configured origins: %v", result)
	return result
}

func main() {
	// Initialize Echo
	e := echo.New()
	e.HideBanner = true

	// Database connection (needed for settings before middleware)
	db, err := database.Connect()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Run database migrations automatically
	if err := database.RunMigrations(db); err != nil {
		log.Fatalf("Failed to run database migrations: %v", err)
	}

	// Create Settings handler early for middleware configuration
	settingsHandler := handlers.NewSettingsHandler(db)
	handlers.SetGlobalSettingsHandler(settingsHandler)

	// Conditionally apply Security Headers Middleware based on settings
	if settingsHandler.IsSecurityHeadersEnabled() {
		secureConfig := middleware.SecureConfig{
			ContentTypeNosniff: "nosniff",
		}

		// XSS Protection
		if settingsHandler.IsXSSProtectionEnabled() {
			secureConfig.XSSProtection = "1; mode=block"
		}

		// X-Frame-Options
		secureConfig.XFrameOptions = settingsHandler.GetXFrameOptions()

		// HSTS
		if settingsHandler.IsHSTSEnabled() {
			secureConfig.HSTSMaxAge = 31536000 // 1 year
			secureConfig.HSTSExcludeSubdomains = false
		}

		// CSP
		if settingsHandler.IsCSPEnabled() {
			secureConfig.ContentSecurityPolicy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-src 'self' *;"
		}

		e.Use(middleware.SecureWithConfig(secureConfig))
		log.Println("Security headers middleware enabled")
	} else {
		log.Println("Security headers middleware disabled")
	}

	// Conditionally apply Rate Limiting Middleware based on settings
	if settingsHandler.IsRateLimitEnabled() {
		rps := settingsHandler.GetRateLimitRPS()
		if rps < 1 {
			rps = 100 // default
		}
		e.Use(middleware.RateLimiter(middleware.NewRateLimiterMemoryStore(rate.Limit(rps))))
		log.Printf("Rate limiting enabled: %d requests/second per IP", rps)
	} else {
		log.Println("Rate limiting disabled")
	}

	// Middleware
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: getCORSOrigins(),
		AllowMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodHead, http.MethodOptions},
		AllowHeaders: []string{
			"Accept",
			"Accept-Language",
			"Authorization",
			"Content-Type",
			"Content-Length",
			"X-Requested-With",
			"Origin",
			"Cache-Control",
			"If-None-Match",
			"If-Modified-Since",
			"Upload-Length",
			"Upload-Offset",
			"Tus-Resumable",
			"Upload-Metadata",
			"Upload-Defer-Length",
			"Upload-Concat",
		},
		ExposeHeaders: []string{
			"Upload-Offset",
			"Location",
			"Upload-Length",
			"Tus-Version",
			"Tus-Resumable",
			"Tus-Max-Size",
			"Tus-Extension",
			"Upload-Metadata",
			"Upload-Defer-Length",
			"Upload-Concat",
			"ETag",
			"Last-Modified",
			"Content-Disposition",
		},
	}))

	// Create handlers
	h := handlers.NewHandler(db)

	// Create upload handler with tus support
	uploadHandler, err := handlers.NewUploadHandler(dataRoot, db)
	if err != nil {
		log.Fatalf("Failed to create upload handler: %v", err)
	}

	// Create SMB handler
	smbHandler := handlers.NewSMBHandler(db, "/etc/scv")

	// Create SMB Audit handler
	smbAuditHandler := handlers.NewSMBAuditHandler(db, "/etc/scv")
	// Start background sync every 30 seconds
	smbAuditHandler.StartBackgroundSync(30 * time.Second)

	// Create Auth handler
	authHandler := handlers.NewAuthHandler(db)

	// Create Audit handler
	auditHandler := handlers.NewAuditHandler(db, dataRoot)

	// Initialize Brute Force Guard for login protection
	bruteForceGuard := handlers.InitBruteForceGuard(db, auditHandler)
	log.Println("Brute force protection initialized")

	// Create TOTP handler for 2FA
	totpHandler := handlers.NewTOTPHandler(db, auditHandler)

	// Create Notification service and handler (must be before handlers that use it)
	notificationService := handlers.NewNotificationService(db)
	notificationHandler := handlers.NewNotificationHandler(notificationService)

	// Create share expiration checker (runs every hour to notify about expiring links)
	shareExpirationChecker := handlers.NewShareExpirationChecker(db, notificationService)
	shareExpirationChecker.StartBackgroundCheck(1 * time.Hour)

	// Create Share handler
	shareHandler := handlers.NewShareHandler(db, dataRoot, auditHandler, notificationService)

	// Create Upload Share handler
	uploadShareHandler, err := handlers.NewUploadShareHandler(db, dataRoot, auditHandler, notificationService)
	if err != nil {
		log.Fatalf("Failed to create upload share handler: %v", err)
	}

	// Create Shared Folder handler
	sharedFolderHandler := handlers.NewSharedFolderHandler(db, dataRoot, notificationService)

	// Create File Share handler
	fileShareHandler := handlers.NewFileShareHandler(db, notificationService)

	// Create File Metadata handler (descriptions and tags)
	fileMetadataHandler := handlers.NewFileMetadataHandler(db)

	// Create SSO handler
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "scv-dev-secret-not-for-production-use"
		log.Println("WARNING: JWT_SECRET not set, using insecure default. Set JWT_SECRET environment variable for production!")
	} else if len(jwtSecret) < 32 {
		log.Println("WARNING: JWT_SECRET is too short. Use at least 32 characters for security.")
	}
	ssoHandler := handlers.NewSSOHandler(db, jwtSecret, dataRoot)

	// Note: settingsHandler is already created earlier for middleware configuration

	// Routes
	e.GET("/health", h.HealthCheck)
	e.GET("/api/health", h.HealthCheck)

	// Swagger documentation
	e.GET("/swagger/*", echoSwagger.WrapHandler)

	// API group
	api := e.Group("/api")

	// Auth routes (public)
	api.POST("/auth/login", authHandler.Login)
	api.POST("/auth/2fa/verify", totpHandler.Verify2FA)

	// SSO routes (public)
	api.GET("/auth/sso/providers", ssoHandler.GetProviders)
	api.GET("/auth/sso/auth/:providerId", ssoHandler.GetAuthURL)
	api.GET("/auth/sso/callback/:providerId", ssoHandler.HandleCallback)

	// Auth routes (protected)
	authApi := api.Group("")
	authApi.Use(authHandler.JWTMiddleware)
	authApi.GET("/auth/profile", authHandler.GetProfile)
	authApi.PUT("/auth/profile", authHandler.UpdateProfile)
	authApi.POST("/auth/refresh", authHandler.RefreshToken)
	authApi.PUT("/auth/smb-password", authHandler.SetMySMBPassword)
	authApi.GET("/auth/storage", authHandler.GetMyStorageUsage)

	// 2FA routes (protected)
	authApi.GET("/auth/2fa/status", totpHandler.Get2FAStatus)
	authApi.GET("/auth/2fa/setup", totpHandler.Setup2FA)
	authApi.POST("/auth/2fa/enable", totpHandler.Enable2FA)
	authApi.POST("/auth/2fa/disable", totpHandler.Disable2FA)
	authApi.POST("/auth/2fa/backup-codes", totpHandler.RegenerateBackupCodes)

	// Admin routes (protected + admin only)
	adminApi := authApi.Group("")
	adminApi.Use(authHandler.AdminMiddleware)
	adminApi.GET("/admin/users", authHandler.ListUsers)
	adminApi.POST("/admin/users", authHandler.CreateUser)
	adminApi.PUT("/admin/users/:id", authHandler.UpdateUser)
	adminApi.DELETE("/admin/users/:id", authHandler.DeleteUser)
	adminApi.DELETE("/admin/users/:id/2fa", totpHandler.AdminReset2FA)

	// File API routes (with optional auth for virtual path resolution)
	api.GET("/files", h.ListFiles, authHandler.OptionalJWTMiddleware)
	api.GET("/files/check", h.CheckFileExists, authHandler.OptionalJWTMiddleware)
	api.GET("/files/search", h.SearchFiles, authHandler.OptionalJWTMiddleware)
	api.GET("/subtitle/*", h.GetSubtitle, authHandler.OptionalJWTMiddleware)
	api.GET("/files/*", h.GetFile, authHandler.OptionalJWTMiddleware)
	api.PUT("/files/content/*", h.SaveFileContent, authHandler.OptionalJWTMiddleware)
	api.DELETE("/files/*", h.DeleteFile, authHandler.OptionalJWTMiddleware)
	api.PUT("/files/rename/*", h.RenameItem, authHandler.OptionalJWTMiddleware)
	api.PUT("/files/move/*", h.MoveItem, authHandler.OptionalJWTMiddleware)
	api.POST("/files/copy/*", h.CopyItem, authHandler.OptionalJWTMiddleware)
	api.GET("/files/move-stream/*", h.MoveItemStream, authHandler.OptionalJWTMiddleware)
	api.GET("/files/copy-stream/*", h.CopyItemStream, authHandler.OptionalJWTMiddleware)
	api.POST("/folders", h.CreateFolder, authHandler.OptionalJWTMiddleware)
	api.DELETE("/folders/*", h.DeleteFolder, authHandler.OptionalJWTMiddleware)
	api.GET("/folders/stats/*", h.GetFolderStats, authHandler.OptionalJWTMiddleware)
	api.POST("/folders/batch-stats", h.BatchGetFolderStats, authHandler.OptionalJWTMiddleware)
	api.GET("/storage/usage", h.GetStorageUsage, authHandler.OptionalJWTMiddleware)
	api.POST("/files/create", h.CreateFile, authHandler.OptionalJWTMiddleware)
	api.POST("/files/compress", h.CompressFiles, authHandler.OptionalJWTMiddleware)
	api.POST("/files/extract", h.ExtractZip, authHandler.OptionalJWTMiddleware)

	// ZIP Download API routes
	api.POST("/download/zip", h.DownloadAsZip, authHandler.OptionalJWTMiddleware)
	api.GET("/download/folder/*", h.DownloadFolderAsZip, authHandler.OptionalJWTMiddleware)
	api.GET("/zip/preview/*", h.PreviewZip, authHandler.OptionalJWTMiddleware)

	// Trash API routes
	api.POST("/trash/*", h.MoveToTrash, authHandler.OptionalJWTMiddleware)
	api.GET("/trash", h.ListTrash, authHandler.OptionalJWTMiddleware)
	api.GET("/trash/stats", h.GetTrashStats, authHandler.OptionalJWTMiddleware)
	api.POST("/trash/restore/:id", h.RestoreFromTrash, authHandler.OptionalJWTMiddleware)
	api.DELETE("/trash/:id", h.DeleteFromTrash, authHandler.OptionalJWTMiddleware)
	api.DELETE("/trash", h.EmptyTrash, authHandler.OptionalJWTMiddleware)

	// Preview API
	api.GET("/preview/*", h.GetPreview, authHandler.OptionalJWTMiddleware)

	// Thumbnail API
	api.GET("/thumbnail/*", h.GetThumbnail, authHandler.OptionalJWTMiddleware)
	api.GET("/thumbnails/responsive/*", h.GetResponsiveThumbnail, authHandler.OptionalJWTMiddleware)
	api.POST("/thumbnails/batch", h.GetBatchThumbnails, authHandler.OptionalJWTMiddleware)
	api.POST("/thumbnails/preload/*", h.PreloadThumbnails, authHandler.OptionalJWTMiddleware)
	adminApi.GET("/thumbnails/stats", h.ThumbnailStats)
	adminApi.DELETE("/thumbnails/cache", h.ClearThumbnailCache)

	// OnlyOffice API routes
	api.GET("/onlyoffice/settings", h.GetOnlyOfficeSettings)
	api.GET("/onlyoffice/config/*", h.GetOnlyOfficeConfig, authHandler.JWTMiddleware)
	api.POST("/onlyoffice/callback", h.OnlyOfficeCallback)

	// SMB Management API (protected)
	authApi.GET("/smb/users", smbHandler.ListSMBUsers)
	authApi.POST("/smb/users", smbHandler.CreateSMBUser)
	authApi.PUT("/smb/users/password", smbHandler.SetSMBPassword)
	authApi.DELETE("/smb/users/:username", smbHandler.DeleteSMBUser)
	authApi.GET("/smb/config", smbHandler.GetSMBConfig)
	authApi.PUT("/smb/config", smbHandler.UpdateSMBConfig)
	adminApi.GET("/smb/audit", smbAuditHandler.GetSMBAuditLogs)
	adminApi.POST("/smb/audit/sync", smbAuditHandler.SyncSMBAuditLogs)

	// Audit logs API (protected)
	authApi.GET("/audit/logs", auditHandler.ListAuditLogs)
	authApi.GET("/audit/resource/*", auditHandler.GetResourceHistory)
	authApi.GET("/audit/system", auditHandler.GetSystemLogs)

	// Recent files API (protected)
	authApi.GET("/files/recent", auditHandler.GetRecentFiles)

	// Notifications API (protected)
	authApi.GET("/notifications", notificationHandler.List)
	authApi.GET("/notifications/unread-count", notificationHandler.GetUnreadCount)
	authApi.PUT("/notifications/:id/read", notificationHandler.MarkAsRead)
	authApi.PUT("/notifications/read-all", notificationHandler.MarkAllAsRead)
	authApi.DELETE("/notifications/:id", notificationHandler.Delete)
	authApi.DELETE("/notifications", notificationHandler.DeleteAllRead)

	// Share API (protected for management)
	authApi.POST("/shares", shareHandler.CreateShare)
	authApi.GET("/shares", shareHandler.ListShares)
	authApi.DELETE("/shares/:id", shareHandler.DeleteShare)

	// Share access (public, with optional auth for require_login check)
	api.GET("/s/:token", shareHandler.AccessShare, authHandler.OptionalJWTMiddleware)
	api.POST("/s/:token", shareHandler.AccessShare, authHandler.OptionalJWTMiddleware)
	api.GET("/s/:token/download", shareHandler.DownloadShare, authHandler.OptionalJWTMiddleware)

	// Edit share access (for OnlyOffice editable shares)
	api.GET("/e/:token", shareHandler.AccessShare, authHandler.OptionalJWTMiddleware)
	api.POST("/e/:token", shareHandler.AccessShare, authHandler.OptionalJWTMiddleware)
	api.GET("/e/:token/config", shareHandler.GetShareOnlyOfficeConfig, authHandler.OptionalJWTMiddleware)
	api.GET("/e/:token/file", shareHandler.GetShareFile, authHandler.OptionalJWTMiddleware)
	api.POST("/e/:token/callback", shareHandler.ShareOnlyOfficeCallback)

	// Upload share access (public, with optional auth for require_login check)
	api.GET("/u/:token", uploadShareHandler.AccessUploadShare, authHandler.OptionalJWTMiddleware)
	api.POST("/u/:token", uploadShareHandler.AccessUploadShare, authHandler.OptionalJWTMiddleware)

	// Upload share TUS routes
	e.Any("/api/u/:token/upload/", uploadShareHandler.HandleShareUpload, authHandler.OptionalJWTMiddleware)
	e.Any("/api/u/:token/upload/*", uploadShareHandler.HandleShareUpload, authHandler.OptionalJWTMiddleware)

	// Shared Folders API (user - protected)
	authApi.GET("/shared-folders", sharedFolderHandler.ListMySharedFolders)
	authApi.GET("/shared-folders/:id/permission", sharedFolderHandler.GetMyPermission)

	// Shared Folders API (admin - protected + admin only)
	adminApi.GET("/admin/shared-folders", sharedFolderHandler.ListAllSharedFolders)
	adminApi.POST("/admin/shared-folders", sharedFolderHandler.CreateSharedFolder)
	adminApi.PUT("/admin/shared-folders/:id", sharedFolderHandler.UpdateSharedFolder)
	adminApi.DELETE("/admin/shared-folders/:id", sharedFolderHandler.DeleteSharedFolder)
	adminApi.GET("/admin/shared-folders/:id/members", sharedFolderHandler.ListMembers)
	adminApi.POST("/admin/shared-folders/:id/members", sharedFolderHandler.AddMember)
	adminApi.PUT("/admin/shared-folders/:id/members/:userId", sharedFolderHandler.UpdateMemberPermission)
	adminApi.DELETE("/admin/shared-folders/:id/members/:userId", sharedFolderHandler.RemoveMember)

	// System Settings API (admin only)
	adminApi.GET("/admin/settings", settingsHandler.GetAllSettings)
	adminApi.PUT("/admin/settings", settingsHandler.UpdateSettings)

	// System Info API (admin only)
	adminApi.GET("/admin/system-info", h.GetSystemInfo)
	adminApi.GET("/admin/system-info/tree", h.GetFolderTreeAPI)

	// SSO Provider Management API (admin only)
	adminApi.GET("/admin/sso/providers", ssoHandler.ListAllProviders)
	adminApi.POST("/admin/sso/providers", ssoHandler.CreateProvider)
	adminApi.PUT("/admin/sso/providers/:id", ssoHandler.UpdateProvider)
	adminApi.DELETE("/admin/sso/providers/:id", ssoHandler.DeleteProvider)
	adminApi.GET("/admin/sso/settings", ssoHandler.GetSSOSettings)
	adminApi.PUT("/admin/sso/settings", ssoHandler.UpdateSSOSettings)

	// Security Management API (admin only) - Brute Force Protection
	adminApi.GET("/admin/security/locked-users", bruteForceGuard.GetLockedUsers)
	adminApi.DELETE("/admin/security/locked-users/:username", bruteForceGuard.UnlockUser)
	adminApi.GET("/admin/security/stats", bruteForceGuard.GetStats)

	// File Share API (user-to-user sharing - protected)
	authApi.POST("/file-shares", fileShareHandler.CreateFileShare)
	authApi.GET("/file-shares/shared-by-me", fileShareHandler.ListSharedByMe)
	authApi.GET("/file-shares/shared-with-me", fileShareHandler.ListSharedWithMe)
	authApi.PUT("/file-shares/:id", fileShareHandler.UpdateFileShare)
	authApi.DELETE("/file-shares/:id", fileShareHandler.DeleteFileShare)
	authApi.GET("/file-shares/file/*", fileShareHandler.GetFileShareInfo)
	authApi.GET("/users/search", fileShareHandler.SearchUsers)

	// File Metadata API (descriptions and tags - protected)
	authApi.GET("/file-metadata/tags", fileMetadataHandler.ListUserTags)
	authApi.GET("/file-metadata/search", fileMetadataHandler.SearchByTag)
	authApi.POST("/file-metadata/batch", fileMetadataHandler.GetBatchMetadata)
	authApi.GET("/file-metadata/*", fileMetadataHandler.GetFileMetadata)
	authApi.PUT("/file-metadata/*", fileMetadataHandler.UpdateFileMetadata)
	authApi.DELETE("/file-metadata/*", fileMetadataHandler.DeleteFileMetadata)

	// Starred Files API (protected)
	authApi.POST("/starred/toggle", h.ToggleStar)
	authApi.GET("/starred", h.GetStarredFiles)
	authApi.POST("/starred/check", h.CheckStarred)

	// File Locks API (protected)
	authApi.POST("/files/lock", h.LockFile)
	authApi.POST("/files/unlock", h.UnlockFile)
	authApi.GET("/files/lock", h.GetFileLock)
	authApi.POST("/files/locks/check", h.CheckFileLocks)
	authApi.GET("/files/locks/my", h.GetMyLocks)

	// Simple upload (non-resumable)
	api.POST("/upload/simple", h.SimpleUpload, authHandler.OptionalJWTMiddleware)

	// Tus upload routes (resumable) using UnroutedHandler
	tusHandler := uploadHandler.TusHandler()

	// All Tus routes - use wildcard to preserve full path
	// BasePath is set to "/" so we need to modify the request URL path
	// to just be the ID (or "/" for POST requests)
	tusRoutes := func(c echo.Context) error {
		req := c.Request()
		res := c.Response()

		// Extract the upload ID from the path
		// Original path: /api/upload/ or /api/upload/{id}
		originalPath := req.URL.Path
		tusPath := strings.TrimPrefix(originalPath, "/api/upload")
		if tusPath == "" {
			tusPath = "/"
		}

		// Modify the request URL path for tusd
		// tusd expects path to be / for POST, /{id} for other methods
		req.URL.Path = tusPath
		log.Printf("[TUS] Method: %s, Original: %s, Modified: %s", req.Method, originalPath, tusPath)

		switch req.Method {
		case http.MethodPost:
			// Check quota before allowing upload (only for /home/ uploads)
			uploadPath := req.Header.Get("Upload-Metadata")
			uploadLengthStr := req.Header.Get("Upload-Length")
			if uploadLengthStr != "" && strings.Contains(uploadPath, "cGF0aA") { // base64 of "path"
				uploadLength, _ := strconv.ParseInt(uploadLengthStr, 10, 64)
				// Extract username from metadata (base64 encoded as "username <base64value>")
				if strings.Contains(uploadPath, "dXNlcm5hbWU") { // base64 of "username"
					// Parse metadata to get username
					parts := strings.Split(uploadPath, ",")
					for _, part := range parts {
						part = strings.TrimSpace(part)
						if strings.HasPrefix(part, "username ") {
							// Decode base64 username
							usernameB64 := strings.TrimPrefix(part, "username ")
							if decoded, err := handlers.DecodeBase64(usernameB64); err == nil {
								username := string(decoded)
								allowed, quota, used := authHandler.CheckQuota(username, uploadLength)
								if !allowed {
									log.Printf("[TUS] Quota exceeded for user %s: used=%d, quota=%d, upload=%d", username, used, quota, uploadLength)
									return c.JSON(http.StatusForbidden, map[string]interface{}{
										"error":     "Storage quota exceeded",
										"quota":     quota,
										"used":      used,
										"requested": uploadLength,
									})
								}
							}
						}
					}
				}
			}
			tusHandler.PostFile(res, req)
			// Capture client IP for this upload
			if location := res.Header().Get("Location"); location != "" {
				// Extract upload ID from location header
				uploadID := filepath.Base(location)
				clientIP := c.RealIP()
				handlers.GetTusIPTracker().StoreIP(uploadID, clientIP)
				log.Printf("[TUS] Stored IP %s for upload %s", clientIP, uploadID)
			}
		case http.MethodHead:
			tusHandler.HeadFile(res, req)
		case http.MethodPatch:
			tusHandler.PatchFile(res, req)
		case http.MethodDelete:
			tusHandler.DelFile(res, req)
		case http.MethodGet:
			tusHandler.GetFile(res, req)
		case http.MethodOptions:
			// Return Tus supported methods
			res.Header().Set("Tus-Resumable", "1.0.0")
			res.Header().Set("Tus-Version", "1.0.0")
			res.Header().Set("Tus-Extension", "creation,creation-with-upload,termination")
			res.Header().Set("Tus-Max-Size", "10737418240")
			res.WriteHeader(http.StatusNoContent)
		default:
			return c.String(http.StatusMethodNotAllowed, "Method not allowed")
		}

		// Restore original path
		req.URL.Path = originalPath
		return nil
	}

	// Register routes on Echo
	e.Any("/api/upload/", tusRoutes)
	e.Any("/api/upload/*", tusRoutes)

	// WebSocket route for file change notifications (auth handled in handler via query param)
	api.GET("/ws", h.HandleWebSocket)

	// Start web upload tracker cleanup routines
	handlers.GetWebUploadTracker().StartCleanupRoutine()
	handlers.GetTusIPTracker().StartCleanupRoutine()

	// Initialize storage tracking for all users (background task with delay)
	go func() {
		// Wait 5 seconds before recalculating to avoid slowing down initial requests
		time.Sleep(5 * time.Second)
		log.Println("[Storage] Initializing storage tracking for users...")
		if err := h.RecalculateAllUsersStorage(); err != nil {
			log.Printf("[Storage] Warning: Failed to initialize storage: %v", err)
		}
	}()

	// Start trash auto-cleanup (runs every 24 hours)
	h.StartTrashAutoCleanup(handlers.DefaultTrashCleanupConfig())

	// Start file watcher for real-time updates and SMB audit logging
	fileWatcher, err := handlers.NewFileWatcher(dataRoot, db)
	if err != nil {
		log.Printf("Warning: Failed to create file watcher: %v", err)
	} else {
		if err := fileWatcher.Start(); err != nil {
			log.Printf("Warning: Failed to start file watcher: %v", err)
		}
		defer fileWatcher.Stop()
	}

	// WebDAV handler
	webdavHandler := handlers.NewWebDAVHandler(db, dataRoot)

	// Get port from environment or default
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Create a custom handler that routes WebDAV requests before Echo
	// This is necessary because Echo's routing doesn't work well with WebDAV methods
	combinedHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/webdav") {
			webdavHandler.ServeHTTP(w, r)
			return
		}
		e.ServeHTTP(w, r)
	})

	// Start server
	log.Printf("Starting server on port %s", port)
	log.Printf("WebDAV available at /webdav (use application password)")
	server := &http.Server{
		Addr:    ":" + port,
		Handler: combinedHandler,
	}
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Failed to start server: %v", err)
	}
}
