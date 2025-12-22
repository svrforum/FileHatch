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
    is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
CREATE INDEX IF NOT EXISTS idx_shares_created_by ON shares(created_by);

-- Comments
COMMENT ON TABLE users IS 'User accounts for web and SMB authentication';
COMMENT ON TABLE acl IS 'Access Control List for file/folder permissions';
COMMENT ON TABLE audit_logs IS 'Immutable audit trail for all actions';
COMMENT ON TABLE shares IS 'Public share links with optional password and expiry';
