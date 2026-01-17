-- Migration: 008_initial_setup
-- Description: Add setup_completed field for initial admin setup flow
-- Version: 20240113000001

-- Add setup_completed field to users table
-- Default TRUE so existing users don't need to go through setup
ALTER TABLE users ADD COLUMN IF NOT EXISTS setup_completed BOOLEAN DEFAULT TRUE;

-- Set setup_completed = FALSE for admin accounts that still have the default password
-- This ensures only fresh installs with default credentials trigger the setup flow
UPDATE users SET setup_completed = FALSE
WHERE username = 'admin'
  AND password_hash = '$2a$10$mRaibXXeo0eBpeg3gDgequkcQynn8GuvLflrbR9pRYAVDO/nf5pqW';

-- Record migration
INSERT INTO schema_migrations (version, name, checksum)
VALUES ('20240113000001', '008_initial_setup', md5('008_initial_setup'))
ON CONFLICT (version) DO NOTHING;
