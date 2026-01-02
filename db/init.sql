-- SimpleCloudVault Database Schema
-- Version: 1.0.0

-- 1. Users (Identity & Authentication)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255),
    password_hash VARCHAR(255),
    smb_hash VARCHAR(255),
    provider VARCHAR(20) DEFAULT 'local',
    provider_id VARCHAR(255),
    is_admin BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    storage_quota BIGINT DEFAULT 0,  -- 0 = unlimited
    totp_secret VARCHAR(255),           -- 암호화된 TOTP 시크릿 (AES-256-GCM)
    totp_enabled BOOLEAN DEFAULT FALSE, -- 2FA 활성화 여부
    totp_backup_codes TEXT,             -- JSON 배열 (해시된 백업 코드)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create default admin account (password: admin1234)
-- bcrypt hash for 'admin1234'
INSERT INTO users (username, email, password_hash, is_admin, is_active)
VALUES ('admin', 'admin@localhost', '$2a$10$mRaibXXeo0eBpeg3gDgequkcQynn8GuvLflrbR9pRYAVDO/nf5pqW', TRUE, TRUE)
ON CONFLICT (username) DO NOTHING;

-- 2. ACL (Access Control List)
CREATE TABLE IF NOT EXISTS acl (
    id BIGSERIAL PRIMARY KEY,
    path VARCHAR(1000) NOT NULL,
    entity_type VARCHAR(10) NOT NULL,
    entity_id UUID NOT NULL,
    permission_level INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(path, entity_type, entity_id)
);

-- 3. Audit Logs (Immutable)
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ DEFAULT NOW(),
    actor_id UUID,
    ip_addr INET,
    event_type VARCHAR(50) NOT NULL,
    target_resource VARCHAR(1000),
    details JSONB
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_acl_path ON acl(path);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_resource);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);

-- 4. Shares (Public Links - Download, Upload, and Editable)
CREATE TABLE IF NOT EXISTS shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token VARCHAR(64) UNIQUE NOT NULL,
    path VARCHAR(1000) NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    password_hash VARCHAR(255),
    access_count INT DEFAULT 0,
    max_access INT,
    is_active BOOLEAN DEFAULT TRUE,
    require_login BOOLEAN DEFAULT FALSE,  -- If true, only authenticated users can access
    -- Share type and editing fields
    share_type VARCHAR(20) DEFAULT 'download' NOT NULL,  -- 'download', 'upload', or 'edit'
    editable BOOLEAN DEFAULT FALSE,           -- If true, allows document editing via OnlyOffice
    max_file_size BIGINT DEFAULT 0,           -- Max size per file in bytes (0 = unlimited)
    allowed_extensions TEXT,                   -- Comma-separated list (e.g., "pdf,docx,jpg")
    upload_count INT DEFAULT 0,               -- Number of files uploaded
    max_total_size BIGINT DEFAULT 0,          -- Max total upload size in bytes (0 = unlimited)
    total_uploaded_size BIGINT DEFAULT 0      -- Current total uploaded bytes
);

CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
CREATE INDEX IF NOT EXISTS idx_shares_created_by ON shares(created_by);
CREATE INDEX IF NOT EXISTS idx_shares_type ON shares(share_type);

-- 5. Shared Folders (Team Drives)
CREATE TABLE IF NOT EXISTS shared_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    storage_quota BIGINT DEFAULT 0,  -- 0 = unlimited
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

-- 6. Shared Folder Members
CREATE TABLE IF NOT EXISTS shared_folder_members (
    id BIGSERIAL PRIMARY KEY,
    shared_folder_id UUID NOT NULL REFERENCES shared_folders(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_level INT NOT NULL DEFAULT 1,  -- 1=read-only, 2=read-write
    added_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(shared_folder_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_shared_folders_name ON shared_folders(name);
CREATE INDEX IF NOT EXISTS idx_shared_folders_active ON shared_folders(is_active);
CREATE INDEX IF NOT EXISTS idx_shared_folder_members_folder ON shared_folder_members(shared_folder_id);
CREATE INDEX IF NOT EXISTS idx_shared_folder_members_user ON shared_folder_members(user_id);

-- 7. File Shares (User-to-User Sharing)
CREATE TABLE IF NOT EXISTS file_shares (
    id BIGSERIAL PRIMARY KEY,
    item_path VARCHAR(1024) NOT NULL,        -- Virtual path of shared file/folder
    item_name VARCHAR(255) NOT NULL,          -- File/folder name for display
    is_folder BOOLEAN NOT NULL DEFAULT FALSE, -- Whether this is a folder
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_with_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_level INT NOT NULL DEFAULT 1,  -- 1=read-only, 2=read-write
    message TEXT,                             -- Optional share message
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(item_path, owner_id, shared_with_id)
);

CREATE INDEX IF NOT EXISTS idx_file_shares_owner ON file_shares(owner_id);
CREATE INDEX IF NOT EXISTS idx_file_shares_shared_with ON file_shares(shared_with_id);
CREATE INDEX IF NOT EXISTS idx_file_shares_path ON file_shares(item_path);

-- 8. System Settings (Key-Value Store)
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO system_settings (key, value, description) VALUES
    ('trash_retention_days', '30', '휴지통 자동 삭제 일수 (기본: 30일)'),
    ('default_storage_quota', '10737418240', '기본 저장 공간 할당량 (바이트, 기본: 10GB)'),
    ('max_file_size', '10737418240', '최대 파일 크기 (바이트, 기본: 10GB)'),
    ('session_timeout_hours', '24', '세션 만료 시간 (시간, 기본: 24)'),
    -- Security Settings
    ('rate_limit_enabled', 'true', 'Rate Limiting 활성화 여부'),
    ('rate_limit_rps', '100', '초당 요청 제한 (IP당)'),
    ('security_headers_enabled', 'true', '보안 헤더 활성화 여부'),
    ('xss_protection_enabled', 'true', 'XSS Protection 헤더 활성화'),
    ('hsts_enabled', 'true', 'HSTS (HTTP Strict Transport Security) 활성화'),
    ('csp_enabled', 'true', 'Content Security Policy 활성화'),
    ('x_frame_options', 'SAMEORIGIN', 'X-Frame-Options 설정 (DENY, SAMEORIGIN, ALLOW-FROM)')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);

-- 9. File Metadata (Descriptions and Tags)
CREATE TABLE IF NOT EXISTS file_metadata (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path VARCHAR(1024) NOT NULL,        -- Virtual path of the file
    description TEXT,                         -- File description/comment
    tags JSONB DEFAULT '[]',                  -- Array of tags
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_file_metadata_user ON file_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_path ON file_metadata(file_path);
CREATE INDEX IF NOT EXISTS idx_file_metadata_tags ON file_metadata USING GIN(tags);

-- 10. Notifications (In-app alerts)
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,                -- 알림 타입 (share.received, share_link.accessed 등)
    title VARCHAR(255) NOT NULL,              -- 알림 제목
    message TEXT,                              -- 상세 메시지
    link VARCHAR(500),                         -- 클릭 시 이동할 경로
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- 알림 발생시킨 사용자
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB                             -- 추가 데이터
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- 11. SSO Providers (OAuth2/OIDC Configuration)
CREATE TABLE IF NOT EXISTS sso_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,              -- Display name (e.g., "Google", "Company Keycloak")
    provider_type VARCHAR(50) NOT NULL,       -- 'google', 'oidc', 'azure', 'github'
    client_id VARCHAR(255) NOT NULL,
    client_secret VARCHAR(500) NOT NULL,      -- Encrypted
    issuer_url VARCHAR(500),                  -- OIDC issuer URL (for generic OIDC)
    authorization_url VARCHAR(500),           -- Custom auth URL (optional)
    token_url VARCHAR(500),                   -- Custom token URL (optional)
    userinfo_url VARCHAR(500),                -- Custom userinfo URL (optional)
    scopes VARCHAR(500) DEFAULT 'openid email profile',
    allowed_domains TEXT,                     -- Comma-separated list of allowed email domains (empty = all)
    auto_create_user BOOLEAN DEFAULT TRUE,    -- Auto-create user on first login
    default_admin BOOLEAN DEFAULT FALSE,      -- New users are admins by default
    is_enabled BOOLEAN DEFAULT TRUE,
    display_order INT DEFAULT 0,              -- Order in login page
    icon_url VARCHAR(500),                    -- Custom icon URL
    button_color VARCHAR(20),                 -- Custom button color (hex)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sso_providers_enabled ON sso_providers(is_enabled);
CREATE INDEX IF NOT EXISTS idx_sso_providers_type ON sso_providers(provider_type);

-- SSO-related system settings
INSERT INTO system_settings (key, value, description) VALUES
    ('sso_enabled', 'false', 'SSO 로그인 활성화 여부'),
    ('sso_only_mode', 'false', 'SSO 전용 모드 (로컬 로그인 비활성화)'),
    ('sso_auto_register', 'true', 'SSO 최초 로그인 시 자동 사용자 생성'),
    ('sso_allowed_domains', '', 'SSO 허용 이메일 도메인 (쉼표로 구분, 비어있으면 모두 허용)')
ON CONFLICT (key) DO NOTHING;

-- Comments
COMMENT ON TABLE users IS 'User accounts for web and SMB authentication';
COMMENT ON TABLE acl IS 'Access Control List for file/folder permissions';
COMMENT ON TABLE audit_logs IS 'Immutable audit trail for all actions';
COMMENT ON TABLE shares IS 'Public share links with optional password and expiry';
COMMENT ON TABLE shared_folders IS 'Team shared drives with storage quotas';
COMMENT ON TABLE shared_folder_members IS 'User access permissions for shared drives';
COMMENT ON TABLE file_shares IS 'User-to-user file/folder sharing with RO/RW permissions';
COMMENT ON TABLE system_settings IS 'System-wide configuration settings';
COMMENT ON TABLE file_metadata IS 'File descriptions and tags for organization';
COMMENT ON TABLE notifications IS 'In-app notification alerts for users';
COMMENT ON TABLE sso_providers IS 'OAuth2/OIDC SSO provider configurations';
