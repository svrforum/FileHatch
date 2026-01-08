// Package docs provides auto-generated Swagger documentation for FileHatch API.
//
//	@title						FileHatch API
//	@version					1.0
//	@description				Enterprise-grade cloud file sharing and management API.
//	@description				FileHatch provides comprehensive file management, sharing, and collaboration features.
//
//	@contact.name				API Support
//	@contact.email				support@simplecloudvault.io
//
//	@license.name				MIT
//	@license.url				https://opensource.org/licenses/MIT
//
//	@host						localhost:3080
//	@BasePath					/api
//
//	@securityDefinitions.apikey	BearerAuth
//	@in							header
//	@name						Authorization
//	@description				JWT Bearer token. Format: "Bearer {token}"
//
//	@tag.name					Auth
//	@tag.description			Authentication and user management endpoints
//
//	@tag.name					2FA
//	@tag.description			Two-factor authentication (TOTP) endpoints
//
//	@tag.name					SSO
//	@tag.description			Single Sign-On (OIDC) endpoints
//
//	@tag.name					Files
//	@tag.description			File and folder management endpoints
//
//	@tag.name					Upload
//	@tag.description			File upload endpoints (TUS protocol)
//
//	@tag.name					Download
//	@tag.description			File download endpoints including ZIP
//
//	@tag.name					Trash
//	@tag.description			Trash management endpoints
//
//	@tag.name					Shares
//	@tag.description			Public share link management
//
//	@tag.name					UploadShares
//	@tag.description			Upload share link management
//
//	@tag.name					FileShares
//	@tag.description			User-to-user file sharing
//
//	@tag.name					SharedFolders
//	@tag.description			Team shared folder (drive) management
//
//	@tag.name					Notifications
//	@tag.description			In-app notification management
//
//	@tag.name					Metadata
//	@tag.description			File metadata (tags, descriptions)
//
//	@tag.name					Audit
//	@tag.description			Audit log endpoints
//
//	@tag.name					Admin
//	@tag.description			Administrative endpoints (requires admin role)
//
//	@tag.name					System
//	@tag.description			System information and health check
package docs
