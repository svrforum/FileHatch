-- Migration: 010_add_missing_user_columns
-- Version: 20240101000010
-- Description: Add columns that may be missing from older installations
-- This fixes upgrades from pre-v0.10 where db/init.sql didn't include these columns

-- Add missing columns to users table (safe: IF NOT EXISTS)
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS setup_completed BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS smb_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS trash_used BIGINT DEFAULT 0;

-- Add missing indexes (safe: IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users(locked_until) WHERE locked_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_active ON users(username, is_active) WHERE is_active = TRUE;

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES ('20240101000010', '010_add_missing_user_columns')
ON CONFLICT (version) DO NOTHING;
