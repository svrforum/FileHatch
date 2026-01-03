-- Migration: 001_initial_schema
-- Description: Initial database schema
-- Version: 20240101000001

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
    storage_quota BIGINT DEFAULT 0,
    totp_secret VARCHAR(255),
    totp_enabled BOOLEAN DEFAULT FALSE,
    totp_backup_codes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- 4. Shares (Public Links)
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
    require_login BOOLEAN DEFAULT FALSE,
    share_type VARCHAR(20) DEFAULT 'download' NOT NULL,
    editable BOOLEAN DEFAULT FALSE,
    max_file_size BIGINT DEFAULT 0,
    allowed_extensions TEXT,
    upload_count INT DEFAULT 0,
    max_total_size BIGINT DEFAULT 0,
    total_uploaded_size BIGINT DEFAULT 0
);

-- 5. Shared Folders (Team Drives)
CREATE TABLE IF NOT EXISTS shared_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    storage_quota BIGINT DEFAULT 0,
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
    permission_level INT NOT NULL DEFAULT 1,
    added_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(shared_folder_id, user_id)
);

-- 7. File Shares (User-to-User Sharing)
CREATE TABLE IF NOT EXISTS file_shares (
    id BIGSERIAL PRIMARY KEY,
    item_path VARCHAR(1024) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    is_folder BOOLEAN NOT NULL DEFAULT FALSE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_with_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_level INT NOT NULL DEFAULT 1,
    message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(item_path, owner_id, shared_with_id)
);

-- 8. System Settings (Key-Value Store)
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. File Metadata (Descriptions and Tags)
CREATE TABLE IF NOT EXISTS file_metadata (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path VARCHAR(1024) NOT NULL,
    description TEXT,
    tags JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, file_path)
);

-- 10. Notifications (In-app alerts)
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    link VARCHAR(500),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB
);

-- 11. SSO Providers (OAuth2/OIDC Configuration)
CREATE TABLE IF NOT EXISTS sso_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    provider_type VARCHAR(50) NOT NULL,
    client_id VARCHAR(255) NOT NULL,
    client_secret VARCHAR(500) NOT NULL,
    issuer_url VARCHAR(500),
    authorization_url VARCHAR(500),
    token_url VARCHAR(500),
    userinfo_url VARCHAR(500),
    scopes VARCHAR(500) DEFAULT 'openid email profile',
    allowed_domains TEXT,
    auto_create_user BOOLEAN DEFAULT TRUE,
    default_admin BOOLEAN DEFAULT FALSE,
    is_enabled BOOLEAN DEFAULT TRUE,
    display_order INT DEFAULT 0,
    icon_url VARCHAR(500),
    button_color VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_acl_path ON acl(path);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_resource);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
CREATE INDEX IF NOT EXISTS idx_shares_created_by ON shares(created_by);
CREATE INDEX IF NOT EXISTS idx_shares_type ON shares(share_type);
CREATE INDEX IF NOT EXISTS idx_shared_folders_name ON shared_folders(name);
CREATE INDEX IF NOT EXISTS idx_shared_folders_active ON shared_folders(is_active);
CREATE INDEX IF NOT EXISTS idx_shared_folder_members_folder ON shared_folder_members(shared_folder_id);
CREATE INDEX IF NOT EXISTS idx_shared_folder_members_user ON shared_folder_members(user_id);
CREATE INDEX IF NOT EXISTS idx_file_shares_owner ON file_shares(owner_id);
CREATE INDEX IF NOT EXISTS idx_file_shares_shared_with ON file_shares(shared_with_id);
CREATE INDEX IF NOT EXISTS idx_file_shares_path ON file_shares(item_path);
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);
CREATE INDEX IF NOT EXISTS idx_file_metadata_user ON file_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_path ON file_metadata(file_path);
CREATE INDEX IF NOT EXISTS idx_file_metadata_tags ON file_metadata USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_sso_providers_enabled ON sso_providers(is_enabled);
CREATE INDEX IF NOT EXISTS idx_sso_providers_type ON sso_providers(provider_type);

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES ('20240101000001', '001_initial_schema')
ON CONFLICT (version) DO NOTHING;
