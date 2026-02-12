-- External Storages
-- S3 호환 스토리지 및 로컬 마운트를 위한 외부 스토리지 관리

CREATE TABLE IF NOT EXISTS external_storages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    mount_path VARCHAR(255) NOT NULL UNIQUE,         -- "company-s3", "nas-backup" 등
    backend_type VARCHAR(50) NOT NULL,                -- "s3", "local-mount"
    config_encrypted TEXT NOT NULL,                    -- AES-256-GCM 암호화된 JSON
    status VARCHAR(20) DEFAULT 'active',              -- "active", "disabled", "error"
    status_message TEXT,
    last_checked_at TIMESTAMPTZ,
    storage_used BIGINT DEFAULT 0,
    storage_quota BIGINT DEFAULT 0,                   -- 0 = 무제한
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_readonly BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_external_storages_mount_path ON external_storages(mount_path);
CREATE INDEX IF NOT EXISTS idx_external_storages_status ON external_storages(status);

CREATE TABLE IF NOT EXISTS external_storage_access (
    id BIGSERIAL PRIMARY KEY,
    external_storage_id UUID NOT NULL REFERENCES external_storages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_level INT NOT NULL DEFAULT 1,          -- 1=읽기, 2=읽기+쓰기
    granted_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(external_storage_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_external_storage_access_user ON external_storage_access(user_id);
CREATE INDEX IF NOT EXISTS idx_external_storage_access_storage ON external_storage_access(external_storage_id);

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES ('20240101000003', '003_external_storages')
ON CONFLICT (version) DO NOTHING;
