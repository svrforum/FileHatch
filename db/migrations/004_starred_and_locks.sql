-- Migration: 004_starred_and_locks
-- Description: Add starred files and file locking features

-- ============================================
-- 1. Starred Files (즐겨찾기)
-- ============================================
CREATE TABLE IF NOT EXISTS starred_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path VARCHAR(1024) NOT NULL,  -- Virtual path like /home/folder/file.txt
    starred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_starred_files_user ON starred_files(user_id);
CREATE INDEX IF NOT EXISTS idx_starred_files_path ON starred_files(file_path);

-- ============================================
-- 2. File Locks (파일 잠금)
-- ============================================
CREATE TABLE IF NOT EXISTS file_locks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_path VARCHAR(1024) NOT NULL UNIQUE,  -- Virtual path
    locked_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    locked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,  -- NULL means no expiration (manual unlock required)
    lock_type VARCHAR(20) DEFAULT 'exclusive',  -- exclusive, shared (for future use)
    reason VARCHAR(255)  -- Optional reason for locking
);

CREATE INDEX IF NOT EXISTS idx_file_locks_path ON file_locks(file_path);
CREATE INDEX IF NOT EXISTS idx_file_locks_user ON file_locks(locked_by);
CREATE INDEX IF NOT EXISTS idx_file_locks_expires ON file_locks(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================
-- 3. Share expiration notification tracking
-- ============================================
ALTER TABLE shares ADD COLUMN IF NOT EXISTS expiration_notified BOOLEAN DEFAULT FALSE;
ALTER TABLE shares ADD COLUMN IF NOT EXISTS expiration_notified_at TIMESTAMP WITH TIME ZONE;

-- Record migration
INSERT INTO schema_migrations (version, name)
VALUES ('20240109000001', '004_starred_and_locks')
ON CONFLICT (version) DO NOTHING;
