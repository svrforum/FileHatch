<p align="center">
  <img src="./File_Hatch_banner.png" alt="FileHatch Banner" width="600">
</p>

# FileHatch

**English** | [한국어](README.md)

**Self-Hosted Cloud File Sharing System**

> **Beta**: This project is currently in beta. Thorough testing is recommended before production use.

[![Go Version](https://img.shields.io/badge/Go-1.23-00ADD8?logo=go)](https://golang.org/)
[![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)](https://www.docker.com/)
[![Status](https://img.shields.io/badge/Status-Beta-yellow.svg)]()

## Overview

FileHatch is a secure and feature-rich self-hosted cloud storage solution. It can replace commercial solutions like Dropbox, OneDrive, and ShareFile while maintaining complete control over your data.

### Key Features

- **Multi-Protocol Access**: Web UI, SMB/CIFS, WebDAV support
- **Strong Security**: JWT authentication, 2FA (TOTP), SSO/OIDC integration, brute-force protection
- **Document Editing**: OnlyOffice integration for in-browser Office document editing
- **Team Collaboration**: Shared drives, file sharing, real-time notifications
- **PWA Support**: Installable like a mobile/desktop app
- **Fully Containerized**: Easy deployment with Docker Compose

---

## Tech Stack

### Backend (Go API Server)
| Technology | Version | Purpose |
|------------|---------|---------|
| Go | 1.23 | Main language |
| Echo | v4.12 | Web framework |
| PostgreSQL | 17 | Primary database |
| Valkey | 8.1 | Cache/Session (Redis compatible) |
| TUS | v2.4 | Resumable file uploads |
| JWT | v5 | Authentication tokens |
| Gorilla WebSocket | v1.5 | Real-time notifications |
| pquerna/otp | v1.4 | TOTP two-factor authentication |
| zerolog | - | Structured logging |

### Frontend (React SPA)
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.3 | UI framework |
| TypeScript | 5.6 | Type safety |
| Vite | 5.4 | Build tool |
| Zustand | 5.0 | State management |
| TanStack Query | 5.62 | Server state management |
| TanStack Virtual | 3.11 | Virtual scrolling |
| tus-js-client | 4.2 | Resumable uploads |
| Monaco Editor | 0.52 | Code/text editor |
| react-pdf | 10.2 | PDF viewer |

### Infrastructure
| Technology | Purpose |
|------------|---------|
| Docker & Docker Compose | Container orchestration |
| Express.js 4.21 | UI reverse proxy |
| Samba 4.20 | SMB/CIFS file sharing |
| OnlyOffice (optional) | Office document editing |
| Keycloak 26.4 (optional) | SSO/OIDC authentication |

---

## Feature Details

### Authentication and Security
- **JWT-based Authentication**: Secure token-based authentication
- **Two-Factor Authentication (TOTP)**: Compatible with Google Authenticator, Authy, etc.
  - Easy setup via QR code scanning
  - 8 backup codes provided
- **SSO Integration**: OIDC protocol support
  - Keycloak, Google, Azure AD, GitHub, etc.
  - Auto user creation option
  - Domain restriction settings
- **Role-Based Access Control**: Admin/regular user separation
- **ACL-Based Permission Management**: Fine-grained file/folder permissions
- **Brute-Force Protection**: Login attempt limiting and automatic blocking
- **Audit Logging**: Immutable audit trail for all operations

### File Management
- **Upload**
  - TUS protocol-based resumable uploads
  - Drag and drop (files and folders)
  - Folder structure preserving uploads
  - Upload progress and speed display
  - Upload pause/resume/cancel
- **Download**
  - Individual file download
  - ZIP folder download (with caching)
  - Multi-file ZIP compression download
  - Download progress display
- **File Operations**
  - Rename, copy, move
  - Trash (restore, permanent delete)
  - Multi-select (Ctrl+click, Shift+click)
  - Batch operations (delete, download)
  - File locking (prevent concurrent editing)
  - Favorites/star feature
- **File Creation**
  - Text files (txt, md, html, json)
  - Office documents (docx, xlsx, pptx)
- **Search**
  - Filename, tag, description search
  - Pagination support
  - Real-time local filtering

### File Preview and Editing
- **Preview Support**
  - Images (JPEG, PNG, GIF, WebP, SVG)
  - Videos (MP4, WebM, MOV)
  - Audio (MP3, WAV, OGG)
  - PDF documents
  - Text/code files
  - ZIP files (content browsing and extraction)
- **Thumbnail System**
  - Automatic thumbnail generation
  - Responsive sizes (64px ~ 512px)
  - Disk + Valkey dual caching
- **Document Editing**
  - Monaco Editor-based text/code editing
  - Syntax highlighting support
  - OnlyOffice integration (optional)
    - Word, Excel, PowerPoint editing
    - Real-time auto-save

### File Sharing

#### Download Links
Securely share files/folders with external users
- Unique share URL generation
- Password protection (optional)
- Expiration time setting
- Maximum access count limit
- Login required option
- Access statistics tracking

#### Upload Links
Collect files from external users
- Folder-based upload links
- Password protection
- File size limit
- Allowed extensions setting
- Total upload capacity limit
- Upload count limit

#### User-to-User Sharing
Share files with users within the system
- Read-only / Read+Write permissions
- Share message attachment
- Shared files list (/shared-with-me)
- Share notifications (real-time)

### Shared Drives (Team Folders)
Shared workspace for team collaboration
- Admins create/manage drives
- Add/remove members
- Permission management (read-only, read/write)
- Storage quota settings
- Auto permission assignment on user creation
- Drive search (when 5+ drives)

### Storage Management
- **Per-User Home Folder** (`/home/{username}`)
- **Shared Drives** (`/shared-drives/{drive-name}`)
- **Shared With Me** (`/shared-with-me`)
- **Storage Quotas**: Per-user capacity limits
- **Real-time Usage Display**
- **SMB/CIFS Access**: Windows Explorer, macOS Finder
- **WebDAV Access**: Desktop app integration

### User Experience
- **Real-time Notifications**: WebSocket-based file change notifications
- **Dark Mode**: System settings sync
- **Responsive Design**: Mobile/tablet support
- **Virtual Scrolling**: Large folder performance optimization (100+ files)
- **Context Menu**: Right-click quick actions
- **Keyboard Shortcuts**: File navigation and operations
- **File Details Panel**: Metadata, statistics display
- **Toast Notifications**: Operation result feedback

### Admin Features
- **User Management**: CRUD, activate/deactivate
- **Shared Drive Management**: Create, member management
- **System Settings**: Trash retention period, default quotas, etc.
- **SSO Provider Management**: OIDC settings
- **Audit Logs**: Detailed filtering, export
- **SMB Management**: User sync, password management
- **System Info**: Server status, resource usage

---

## System Architecture

```
+---------------------------------------------------------------------+
|                           Clients                                    |
|  +----------+  +----------+  +----------+  +--------------------+   |
|  |  Browser |  |   SMB    |  |  WebDAV  |  |  Mobile/Desktop    |   |
|  +----+-----+  +----+-----+  +----+-----+  +---------+----------+   |
+-------|-----------+-----------+------------------+------------------+
        |           |           |                  |
        v           v           v                  v
+---------------------------------------------------------------------+
|                       Docker Network                                 |
|  +---------------------------------------------------------------+  |
|  |                                                               |  |
|  |  :3080 UI Server (Express)  <---->  :8080 API Server (Go)    |  |
|  |  |- Static files                    |- Auth (JWT/2FA/SSO)    |  |
|  |  |- API Proxy                       |- File Operations       |  |
|  |  +- WebSocket Proxy                 |- Share Management      |  |
|  |                                     |- TUS Upload            |  |
|  |  :445 Samba (SMB/CIFS)              |- WebSocket             |  |
|  |  +- Network file sharing            |- WebDAV                |  |
|  |                                     +- OnlyOffice            |  |
|  |                                                               |  |
|  +---------------------------------------------------------------+  |
|                              |                                       |
|                              v                                       |
|  +---------------------------------------------------------------+  |
|  |                    Shared Volume (/data)                      |  |
|  |  |- /users/      - User home directories                      |  |
|  |  |- /shared/     - Shared drives                              |  |
|  |  +- /.cache/     - Thumbnail/preview cache                    |  |
|  +---------------------------------------------------------------+  |
|                              |                                       |
|                              v                                       |
|  +---------------------+  +-------------------------------------+   |
|  |  PostgreSQL (DB)    |  |  Valkey (Cache/Session)             |   |
|  |  +- 11 tables       |  |  +- Sessions, thumbnails, stats     |   |
|  +---------------------+  +-------------------------------------+   |
|                                                                      |
|  Optional Services:                                                  |
|  +---------------------+  +-------------------------------------+   |
|  |  OnlyOffice (:8088) |  |  Keycloak (:8180)                   |   |
|  |  +- Document editing|  |  +- SSO/OIDC                        |   |
|  +---------------------+  +-------------------------------------+   |
+---------------------------------------------------------------------+
```

---

## Quick Start

### Requirements
- Docker Engine 24.0+
- Docker Compose v2.20+
- Minimum 4GB RAM
- Available ports: 3080 (web), 445/139 (SMB)

### One-Line Install (Recommended)

Run on any server with Docker installed:

```bash
mkdir -p filehatch && cd filehatch && \
curl -fsSL https://raw.githubusercontent.com/svrforum/FileHatch/main/.env.example -o .env && \
curl -fsSL https://raw.githubusercontent.com/svrforum/FileHatch/main/docker-compose.yml -o docker-compose.yml && \
mkdir -p config && \
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env && \
sed -i "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env && \
sed -i "s/DB_PASS=.*/DB_PASS=$(openssl rand -base64 16 | tr -d '=+/')/" .env && \
docker compose up -d
```

For macOS (sed syntax differs):
```bash
mkdir -p filehatch && cd filehatch && \
curl -fsSL https://raw.githubusercontent.com/svrforum/FileHatch/main/.env.example -o .env && \
curl -fsSL https://raw.githubusercontent.com/svrforum/FileHatch/main/docker-compose.yml -o docker-compose.yml && \
mkdir -p config && \
sed -i '' "s/JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env && \
sed -i '' "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env && \
sed -i '' "s/DB_PASS=.*/DB_PASS=$(openssl rand -base64 16 | tr -d '=+/')/" .env && \
docker compose up -d
```

Using wget:
```bash
mkdir -p filehatch && cd filehatch && \
wget -q https://raw.githubusercontent.com/svrforum/FileHatch/main/.env.example -O .env && \
wget -q https://raw.githubusercontent.com/svrforum/FileHatch/main/docker-compose.yml -O docker-compose.yml && \
mkdir -p config && \
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env && \
sed -i "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env && \
sed -i "s/DB_PASS=.*/DB_PASS=$(openssl rand -base64 16 | tr -d '=+/')/" .env && \
docker compose up -d
```

### Step-by-Step Install

```bash
# 1. Create directory
mkdir -p filehatch && cd filehatch

# 2. Download config files
curl -fsSL https://raw.githubusercontent.com/svrforum/FileHatch/main/.env.example -o .env
curl -fsSL https://raw.githubusercontent.com/svrforum/FileHatch/main/docker-compose.yml -o docker-compose.yml

# 3. Create config directory
mkdir -p config

# 4. Generate security keys (IMPORTANT!)
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env
sed -i "s/DB_PASS=.*/DB_PASS=$(openssl rand -base64 16 | tr -d '=+/')/" .env

# 5. Start services
docker compose up -d

# 6. Check status
docker compose ps
```

### Source Install (Development)

```bash
# Clone repository
git clone https://github.com/svrforum/FileHatch.git
cd FileHatch

# Run auto setup script (environment config, security key generation, build, start)
./scripts/setup.sh
```

Or manual installation:

```bash
# Set environment variables
cp .env.example .env
# Edit .env file to set JWT_SECRET, ENCRYPTION_KEY, etc.

# Build and start all services
docker compose up -d --build

# Check status
docker compose ps

# Check logs
docker compose logs -f
```

> **Note**: Database migrations run automatically when the API server starts.

### Access Information

| Protocol | URL | Description |
|----------|-----|-------------|
| Web UI | http://localhost:3080 | Main web interface |
| SMB (Windows) | `\\localhost\home` | Access via Windows Explorer |
| SMB (Mac/Linux) | `smb://localhost/home` | Access via Finder/File Manager |
| WebDAV | http://localhost:3080/api/webdav/ | WebDAV client integration |

### Default Account

```
Username: admin
Password: admin1234
```

> **First Login**: On first login with the default admin account, you will be prompted to change your username and password through the initial setup screen. This is a mandatory step for security.

> **Security Warning**: The initial setup screen only appears once. Make sure to remember your new credentials!

---

## Runtime Options

### Docker Compose Profiles

FileHatch uses Docker Compose profiles to enable optional features.

| Command | Included Services | Purpose |
|---------|-------------------|---------|
| `docker compose up -d` | API, UI, DB, Valkey, Samba | Basic installation |
| `docker compose --profile office up -d` | Basic + OnlyOffice | Document editing |
| `docker compose --profile sso up -d` | Basic + Keycloak | SSO authentication |
| `docker compose --profile office --profile sso up -d` | All services | Full features |

### Service Ports

| Service | Port | Protocol | Description |
|---------|------|----------|-------------|
| UI | 3080 | HTTP | Web interface |
| SMB | 445, 139 | SMB/CIFS | Windows file sharing |
| WebDAV | 3080/webdav | HTTP | WebDAV client |
| OnlyOffice | 8088 | HTTP | Document editing server (--profile office) |
| Keycloak | 8180 | HTTP | SSO authentication server (--profile sso) |
| PostgreSQL | 5432 | TCP | Database (internal) |
| Valkey | 6379 | TCP | Cache server (internal) |

---

## Advanced Configuration

### OnlyOffice Document Editor (Optional)

Edit Office documents (Word, Excel, PowerPoint) directly in the browser.

> **Detailed Guide**: [OnlyOffice Setup Guide](./docs/ONLYOFFICE_SETUP.md)

```bash
# Start with OnlyOffice
docker compose --profile office up -d

# Check OnlyOffice status
docker compose logs onlyoffice
```

OnlyOffice settings:
- Internal URL: `http://onlyoffice` (Docker network)
- External URL: `http://serverIP:8088`
- For external access, set `ONLYOFFICE_PUBLIC_URL` in `.env`

### SSO (Keycloak) Integration (Optional)

Set up OIDC-based Single Sign-On.

> **Detailed Guide**: [SSO Setup Guide](./docs/SSO_SETUP.md)

```bash
# 1. Start with SSO profile
docker compose --profile sso up -d

# 2. Wait until Keycloak is ready (about 2 minutes)
docker compose logs -f keycloak
# Ready when "Running the server" message appears

# 3. Initial Keycloak setup (first time only)
./scripts/setup-keycloak.sh
```

Keycloak admin console: http://localhost:8180/auth
- Username: `admin`
- Password: `admin123` (changeable in `.env`)

> **Warning**: Make sure to change `KEYCLOAK_ADMIN_PASSWORD` in production.

### Enable All Features

```bash
# Use both OnlyOffice + Keycloak
docker compose --profile office --profile sso up -d

# Check status
docker compose ps
```

### Useful Commands

```bash
# Check service status
docker compose ps

# Check logs (real-time)
docker compose logs -f

# Specific service logs
docker compose logs -f api

# Restart service
docker compose restart api

# Stop all
docker compose down

# Delete all including volumes (data will be deleted!)
docker compose down -v

# Rebuild images
docker compose build --no-cache

# Run API tests
./scripts/test-api.sh

# Check migration status
./scripts/migrate.sh status

# Backup
./scripts/backup.sh
```

### Environment Variables

#### API Server
| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | db | PostgreSQL host |
| `DB_PORT` | 5432 | PostgreSQL port |
| `DB_USER` | fh_user | Database user |
| `DB_PASS` | fh_password | Database password |
| `DB_NAME` | fh_main | Database name |
| `VALKEY_HOST` | valkey | Valkey host |
| `VALKEY_PORT` | 6379 | Valkey port |
| `JWT_SECRET` | (auto-generated) | JWT signing key (**must change in production**) |
| `CORS_ALLOWED_ORIGINS` | * | Allowed CORS origins |
| `ENCRYPTION_KEY` | (auto-generated) | Sensitive data encryption key |

#### UI Server
| Variable | Default | Description |
|----------|---------|-------------|
| `API_URL` | http://api:8080 | API server internal URL |
| `ONLYOFFICE_URL` | http://onlyoffice | OnlyOffice internal URL |
| `ONLYOFFICE_PUBLIC_URL` | - | OnlyOffice external access URL |

---

## Directory Structure

```
FileHatch/
├── api/                          # Go backend
│   ├── handlers/                 # HTTP handlers (~50 files)
│   │   ├── auth.go               # Authentication (JWT, Login)
│   │   ├── auth_user.go          # User CRUD
│   │   ├── handler.go            # File/folder CRUD
│   │   ├── operations.go         # Rename/Move/Copy
│   │   ├── search.go             # File search
│   │   ├── share.go              # Download sharing
│   │   ├── upload_share.go       # Upload sharing
│   │   ├── file_share_handler.go # User-to-user sharing
│   │   ├── shared_folder_handler.go # Shared drives
│   │   ├── onlyoffice.go         # OnlyOffice integration
│   │   ├── sso.go                # SSO core
│   │   ├── sso_callback.go       # OAuth callback
│   │   ├── trash.go              # Trash
│   │   ├── audit.go              # Audit logs
│   │   ├── websocket.go          # Real-time notifications
│   │   ├── webdav.go             # WebDAV
│   │   ├── thumbnail.go          # Thumbnail generation
│   │   └── ...
│   ├── database/                 # DB connection
│   ├── main.go                   # Entry point (~500 lines)
│   └── Dockerfile
├── ui/                           # React frontend
│   ├── src/
│   │   ├── api/                  # API clients (11)
│   │   │   ├── client.ts         # Common API client
│   │   │   ├── auth.ts           # Auth API
│   │   │   ├── files.ts          # Files API
│   │   │   └── ...
│   │   ├── components/           # React components (65+)
│   │   │   ├── FileList.tsx      # Main file browser
│   │   │   ├── filelist/         # FileList sub-components
│   │   │   ├── Admin*.tsx        # Admin pages
│   │   │   └── ...
│   │   ├── hooks/                # Custom hooks (15)
│   │   │   ├── useToast.ts
│   │   │   ├── useLocalSearch.ts
│   │   │   ├── useFileMetadata.ts
│   │   │   └── ...
│   │   ├── stores/               # Zustand stores
│   │   └── styles/               # Global styles
│   ├── server.cjs                # Express server
│   └── Dockerfile
├── samba/                        # Samba configuration
│   ├── smb.conf.template
│   ├── entrypoint.sh
│   └── Dockerfile
├── db/                           # Database
│   └── init.sql                  # Schema (11 tables)
├── scripts/                      # Utility scripts
│   └── setup-keycloak.sh
├── data/                         # File storage (volume)
├── docker-compose.yml            # Default configuration
└── docker-compose-sso.yaml       # SSO configuration
```

---

## API Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/2fa/verify` | 2FA code verification |
| GET | `/api/auth/profile` | Get profile |
| PUT | `/api/auth/profile` | Update profile |
| PUT | `/api/auth/password` | Change password |
| GET | `/api/auth/2fa/status` | Check 2FA status |
| POST | `/api/auth/2fa/setup` | Start 2FA setup |
| POST | `/api/auth/2fa/enable` | Enable 2FA |
| DELETE | `/api/auth/2fa/disable` | Disable 2FA |
| GET | `/api/auth/sso/providers` | SSO provider list |
| GET | `/api/auth/sso/auth/:id` | SSO auth URL |
| GET | `/api/auth/sso/callback/:id` | OAuth callback |

### File Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files` | File list (pagination) |
| GET | `/api/files/search` | File search |
| GET | `/api/files/recent` | Recent files |
| GET | `/api/files/*` | File download |
| DELETE | `/api/files/*` | Delete file |
| POST | `/api/files/rename` | Rename |
| POST | `/api/files/move` | Move |
| POST | `/api/files/copy` | Copy |
| POST | `/api/files/create` | Create new file |
| PUT | `/api/files/content/*` | Save file content |
| POST | `/api/folders` | Create folder |
| GET | `/api/folders/stats/*` | Folder stats |
| GET | `/api/zip/*` | ZIP download |

### Upload (TUS Protocol)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload/` | Start upload |
| PATCH | `/api/upload/*` | Chunk upload |
| HEAD | `/api/upload/*` | Upload status |
| DELETE | `/api/upload/*` | Cancel upload |

### Share Links

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/shares` | Create share |
| GET | `/api/shares` | My shares list |
| DELETE | `/api/shares/:id` | Delete share |
| GET | `/api/s/:token` | Share info (public) |
| GET | `/api/s/:token/download` | Share download |
| GET | `/api/u/:token` | Upload share info |
| POST | `/api/u/:token/upload/` | Upload file via upload share |

### User-to-User Sharing

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/file-shares` | Share file |
| GET | `/api/file-shares/shared-by-me` | Files I shared |
| GET | `/api/file-shares/shared-with-me` | Files shared with me |
| DELETE | `/api/file-shares/:id` | Cancel share |

### Shared Drives

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/shared-folders` | My shared drives list |
| GET | `/api/admin/shared-folders` | All shared drives (admin) |
| POST | `/api/admin/shared-folders` | Create (admin) |
| PUT | `/api/admin/shared-folders/:id` | Update (admin) |
| DELETE | `/api/admin/shared-folders/:id` | Delete (admin) |
| POST | `/api/admin/shared-folders/:id/members` | Add member |
| DELETE | `/api/admin/shared-folders/:id/members/:userId` | Remove member |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/users` | User list |
| POST | `/api/admin/users` | Create user |
| PUT | `/api/admin/users/:id` | Update user |
| DELETE | `/api/admin/users/:id` | Delete user |
| GET | `/api/admin/settings` | Get system settings |
| PUT | `/api/admin/settings` | Update system settings |
| GET | `/api/admin/system-info` | System info |
| GET | `/api/audit/logs` | Audit logs |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | Notification list |
| PUT | `/api/notifications/:id/read` | Mark as read |
| PUT | `/api/notifications/read-all` | Mark all as read |
| DELETE | `/api/notifications/:id` | Delete notification |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| WS | `/api/ws` | Real-time notification WebSocket |
| ANY | `/api/webdav/*` | WebDAV access |
| GET | `/api/storage/usage` | Storage usage |
| GET | `/api/thumbnail/*` | Get thumbnail |
| GET | `/api/metadata/*` | File metadata |
| PUT | `/api/metadata/*` | Update metadata |
| GET | `/api/trash` | Trash list |
| POST | `/api/trash/restore/:id` | Restore from trash |
| DELETE | `/api/trash/:id` | Permanent delete |

---

## Database Schema

| Table | Description | Key Columns |
|-------|-------------|-------------|
| `users` | User accounts | id, username, email, password_hash, totp_secret |
| `acl` | Access control list | path, entity_type, entity_id, permission_level |
| `audit_logs` | Audit logs (immutable) | ts, actor_id, event_type, target_resource, details |
| `shares` | Share links | token, path, share_type, expires_at, password_hash |
| `shared_folders` | Shared drives | name, description, storage_quota, created_by |
| `shared_folder_members` | Drive membership | shared_folder_id, user_id, permission_level |
| `file_shares` | User-to-user sharing | item_path, owner_id, shared_with_id, permission_level |
| `file_metadata` | File metadata | user_id, file_path, description, tags |
| `notifications` | Notifications | user_id, type, title, message, is_read |
| `system_settings` | System settings | key, value, description |
| `sso_providers` | SSO providers | name, provider_type, client_id, issuer_url |

---

## Security Features

### Implemented Security Features
- JWT token-based authentication
- TOTP-based 2FA (with backup codes)
- Password hashing (bcrypt)
- Sensitive data encryption (AES-256-GCM)
- SQL injection prevention (parameterized queries)
- CORS protection
- Security headers middleware (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, etc.)
- XSS prevention
- IP-based rate limiting
- Brute-force protection (login attempt limiting)
- Audit logging (immutable)
- ACL-based access control

### Required Changes Before Deployment

Make sure to change the following before production deployment:

#### 1. Environment Variables (.env)

| Variable | Default | Description | Generation Method |
|----------|---------|-------------|-------------------|
| `JWT_SECRET` | Dev default | JWT signing key (64+ chars recommended) | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | Dev default | AES-256 encryption key | `openssl rand -hex 32` |
| `DB_PASS` | `fh_password` | PostgreSQL password | `openssl rand -base64 24` |
| `KEYCLOAK_ADMIN_PASSWORD` | `admin123` | Keycloak admin password | Set strong password |

> **Tip**: Running `./scripts/setup.sh` automatically generates secure values for JWT_SECRET, ENCRYPTION_KEY, and DB_PASS.

#### 2. Default Admin Account

| Item | Default | Action |
|------|---------|--------|
| Username | `admin` | Recommended to create new admin account after first login |
| Password | `admin1234` | **Must change immediately after first login** |
| Email | `admin@localhost` | Change to actual email |

#### 3. Security Checklist

```bash
# Pre-deployment checklist
[ ] All secret values in .env file changed
[ ] Admin password changed (after first login)
[ ] CORS_ALLOWED_ORIGINS set to actual domain only
[ ] HTTPS configured (reverse proxy)
[ ] Firewall configured (only necessary ports open)
[ ] Backup scripts configured
```

### Recommended Production Settings

```bash
# .env file example (production)
JWT_SECRET=your_openssl_rand_hex_32_result_here
ENCRYPTION_KEY=your_openssl_rand_hex_32_result_here
DB_PASS=strong_database_password
CORS_ALLOWED_ORIGINS=https://your-domain.com
```

```yaml
# docker-compose.override.yml (optional)
services:
  api:
    environment:
      - LOG_LEVEL=warn
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
```

---

## Troubleshooting

### Common Issues

**Q: Docker containers won't start.**
```bash
# Check logs
docker compose logs api db valkey

# Restart containers
docker compose down && docker compose up -d
```

**Q: Database connection error**
```bash
# Check DB container status
docker compose exec db pg_isready -U fh_user -d fh_main
```

**Q: Can't access SMB.**
```bash
# Check Samba logs
docker compose logs samba

# Check ports (445 must be open)
netstat -an | grep 445
```

**Q: OnlyOffice documents won't open.**
- Verify started with OnlyOffice profile: `docker compose --profile office up -d`
- Check OnlyOffice container status: `docker compose logs onlyoffice`

---

## Development Guide

### Local Development Environment

```bash
# Backend (Go)
cd api
go mod download
go run main.go

# Frontend (React)
cd ui
npm install
npm run dev
```

### Running Tests

```bash
# Go tests
cd api
go test ./handlers/...

# React tests
cd ui
npm run test:run
```

### Build

```bash
# Full build
docker compose build

# Individual service build
docker compose build api
docker compose build ui
```

---

## Roadmap

See [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md) for detailed development plans.

### Short-term Plans
- [ ] API documentation (OpenAPI/Swagger)
- [ ] E2E tests
- [ ] Performance monitoring (Prometheus/Grafana)
- [ ] Log aggregation (ELK Stack)

### Mid-term Plans
- [ ] File versioning (history)
- [ ] Advanced search (Elasticsearch)
- [ ] Mobile optimization improvements
- [ ] Offline sync

### Long-term Plans
- [ ] Mobile apps (iOS/Android)
- [ ] File encryption (at rest)
- [ ] Watermark feature
- [ ] Desktop sync client

---

## Contributing

Issues and pull requests are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project does not have a license specified yet. To be updated.

---

## Acknowledgments

This project uses the following open-source projects:

- [Echo](https://echo.labstack.com/) - Go web framework
- [React](https://reactjs.org/) - UI library
- [TUS](https://tus.io/) - Resumable upload protocol
- [OnlyOffice](https://www.onlyoffice.com/) - Document editor
- [Keycloak](https://www.keycloak.org/) - SSO solution
