-- Migration: 003_storage_tracking
-- Description: Add storage tracking columns for instant storage queries
-- Version: 20240108000001

-- Add storage tracking columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_used BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trash_used BIGINT DEFAULT 0;

-- Create index for faster storage queries
CREATE INDEX IF NOT EXISTS idx_users_storage ON users(storage_used);

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES ('20240108000001', '003_storage_tracking')
ON CONFLICT (version) DO NOTHING;
