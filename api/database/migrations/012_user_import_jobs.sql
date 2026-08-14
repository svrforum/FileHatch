-- Migration: 012_user_import_jobs
-- Version: 20240101000012
-- Description: Store password-free metadata and row results for bulk user imports

CREATE TABLE IF NOT EXISTS user_import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_digest CHAR(64) NOT NULL,
    policy_revision VARCHAR(128) NOT NULL,
    idempotency_key_hash CHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    total_rows INT NOT NULL CHECK (total_rows BETWEEN 0 AND 1000),
    created_count INT NOT NULL DEFAULT 0,
    warning_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    skipped_count INT NOT NULL DEFAULT 0,
    results JSONB NOT NULL DEFAULT '[]'::jsonb,
    failure_code VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (admin_id, file_digest, idempotency_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_import_jobs_owner_created
    ON user_import_jobs(admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_import_jobs_status
    ON user_import_jobs(status) WHERE status IN ('pending', 'running');

-- A process restart cannot safely resume a job because plaintext passwords are
-- intentionally memory-only. The application also runs this transition during
-- handler initialization, while this statement covers migrations/redeployments.
UPDATE user_import_jobs
SET status = 'failed',
    failure_code = 'server_restarted',
    completed_at = NOW(),
    updated_at = NOW()
WHERE status IN ('pending', 'running');

INSERT INTO schema_migrations (version, name) VALUES ('20240101000012', '012_user_import_jobs')
ON CONFLICT (version) DO NOTHING;
