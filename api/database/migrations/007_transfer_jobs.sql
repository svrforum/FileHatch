-- Transfer jobs table for server-side transfer queue
CREATE TABLE IF NOT EXISTS transfer_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,          -- 'copy', 'move', 'compress', 'delete'
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending','running','completed','error','cancelled'
    source_path TEXT NOT NULL,
    destination_path TEXT,
    total_bytes BIGINT DEFAULT 0,
    copied_bytes BIGINT DEFAULT 0,
    total_files INT DEFAULT 0,
    copied_files INT DEFAULT 0,
    current_file TEXT,
    bytes_per_sec BIGINT DEFAULT 0,
    error_message TEXT,
    mode VARCHAR(20),                   -- 'merge', 'overwrite', 'rename', etc.
    file_conflict VARCHAR(20),          -- for merge mode: 'overwrite', 'skip', 'rename'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_transfer_jobs_user ON transfer_jobs(user_id, status);

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES ('20240101000007', '007_transfer_jobs')
ON CONFLICT (version) DO NOTHING;
