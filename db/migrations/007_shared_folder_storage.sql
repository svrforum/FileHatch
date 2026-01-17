-- Migration: 007_shared_folder_storage
-- Description: Add storage_used column to shared_folders for faster quota checks
-- Version: 20240112000001

-- =============================================================================
-- Add storage_used column to shared_folders
-- =============================================================================

-- Track current storage usage for shared folders
-- This eliminates the need for expensive filepath.Walk on every upload
ALTER TABLE shared_folders
ADD COLUMN IF NOT EXISTS storage_used BIGINT DEFAULT 0;

-- Add index for quota-related queries
CREATE INDEX IF NOT EXISTS idx_shared_folders_quota
    ON shared_folders(storage_quota, storage_used)
    WHERE is_active = TRUE AND storage_quota > 0;

-- =============================================================================
-- Record Migration
-- =============================================================================
INSERT INTO schema_migrations (version, name, checksum)
VALUES ('20240112000001', '007_shared_folder_storage', 'shared_folder_storage_v1')
ON CONFLICT (version) DO NOTHING;
