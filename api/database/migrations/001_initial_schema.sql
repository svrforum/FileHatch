-- Migration: 001_initial_schema
-- Version: 20240101000001
-- Description: Create all core tables and indexes

-- =============================================================================
-- Core Tables
-- =============================================================================

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
    storage_used BIGINT DEFAULT 0,
    trash_used BIGINT DEFAULT 0,
    totp_secret VARCHAR(255),
    totp_enabled BOOLEAN DEFAULT FALSE,
    totp_backup_codes TEXT,
    locked_until TIMESTAMPTZ DEFAULT NULL,
    failed_login_count INT DEFAULT 0,
    last_failed_login TIMESTAMPTZ DEFAULT NULL,
    setup_completed BOOLEAN DEFAULT TRUE,
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
    require_login BOOLEAN DEFAULT FALSE,
    share_type VARCHAR(20) DEFAULT 'download' NOT NULL,
    editable BOOLEAN DEFAULT FALSE,
    max_file_size BIGINT DEFAULT 0,
    allowed_extensions TEXT,
    upload_count INT DEFAULT 0,
    max_total_size BIGINT DEFAULT 0,
    total_uploaded_size BIGINT DEFAULT 0,
    expiration_notified BOOLEAN DEFAULT FALSE,
    expiration_notified_at TIMESTAMPTZ
);

-- 5. Shared Folders (Team Drives)
CREATE TABLE IF NOT EXISTS shared_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    storage_quota BIGINT DEFAULT 0,
    storage_used BIGINT DEFAULT 0,
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

-- 12. Starred Files (Favorites)
CREATE TABLE IF NOT EXISTS starred_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path VARCHAR(1024) NOT NULL,
    starred_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, file_path)
);

-- 13. File Locks (Concurrent Edit Prevention)
CREATE TABLE IF NOT EXISTS file_locks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_path VARCHAR(1024) NOT NULL UNIQUE,
    locked_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    locked_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    lock_type VARCHAR(20) DEFAULT 'exclusive',
    reason VARCHAR(255)
);

-- =============================================================================
-- Indexes
-- =============================================================================

-- User indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_storage ON users(storage_used);
CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users(locked_until) WHERE locked_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_active ON users(username, is_active) WHERE is_active = TRUE;

-- ACL indexes
CREATE INDEX IF NOT EXISTS idx_acl_path ON acl(path);

-- Audit log indexes
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_resource);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_type_ts ON audit_logs(event_type, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_security_events ON audit_logs(event_type, ts DESC) WHERE event_type LIKE 'security.%';

-- Share indexes
CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
CREATE INDEX IF NOT EXISTS idx_shares_created_by ON shares(created_by);
CREATE INDEX IF NOT EXISTS idx_shares_type ON shares(share_type);

-- Shared folder indexes
CREATE INDEX IF NOT EXISTS idx_shared_folders_name ON shared_folders(name);
CREATE INDEX IF NOT EXISTS idx_shared_folders_active ON shared_folders(is_active);
CREATE INDEX IF NOT EXISTS idx_shared_folders_name_active ON shared_folders(name, is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_shared_folders_quota ON shared_folders(storage_quota, storage_used) WHERE is_active = TRUE AND storage_quota > 0;

-- Shared folder member indexes
CREATE INDEX IF NOT EXISTS idx_shared_folder_members_folder ON shared_folder_members(shared_folder_id);
CREATE INDEX IF NOT EXISTS idx_shared_folder_members_user ON shared_folder_members(user_id);
CREATE INDEX IF NOT EXISTS idx_sfm_user_folder ON shared_folder_members(user_id, shared_folder_id);

-- File share indexes
CREATE INDEX IF NOT EXISTS idx_file_shares_owner ON file_shares(owner_id);
CREATE INDEX IF NOT EXISTS idx_file_shares_shared_with ON file_shares(shared_with_id);
CREATE INDEX IF NOT EXISTS idx_file_shares_path ON file_shares(item_path);
CREATE INDEX IF NOT EXISTS idx_file_shares_recipient_path ON file_shares(shared_with_id, item_path);
CREATE INDEX IF NOT EXISTS idx_file_shares_owner_path ON file_shares(owner_id, item_path);

-- System settings index
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);

-- File metadata indexes
CREATE INDEX IF NOT EXISTS idx_file_metadata_user ON file_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_path ON file_metadata(file_path);
CREATE INDEX IF NOT EXISTS idx_file_metadata_tags ON file_metadata USING GIN(tags);

-- Notification indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, created_at DESC) WHERE is_read = FALSE;

-- SSO provider indexes
CREATE INDEX IF NOT EXISTS idx_sso_providers_enabled ON sso_providers(is_enabled);
CREATE INDEX IF NOT EXISTS idx_sso_providers_type ON sso_providers(provider_type);

-- Starred files indexes
CREATE INDEX IF NOT EXISTS idx_starred_files_user ON starred_files(user_id);
CREATE INDEX IF NOT EXISTS idx_starred_files_path ON starred_files(file_path);

-- File lock indexes
CREATE INDEX IF NOT EXISTS idx_file_locks_path ON file_locks(file_path);
CREATE INDEX IF NOT EXISTS idx_file_locks_user ON file_locks(locked_by);
CREATE INDEX IF NOT EXISTS idx_file_locks_expires ON file_locks(expires_at) WHERE expires_at IS NOT NULL;

-- =============================================================================
-- Comments
-- =============================================================================
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
COMMENT ON TABLE starred_files IS 'User favorite files and folders';
COMMENT ON TABLE file_locks IS 'File locking for concurrent edit prevention';

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES ('20240101000001', '001_initial_schema')
ON CONFLICT (version) DO NOTHING;
