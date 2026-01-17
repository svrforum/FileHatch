-- Migration: 005_login_lockout
-- Description: Add login lockout fields for brute force protection
-- Version: 20240110000001

-- Add login lockout fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient lockout queries
CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users(locked_until)
    WHERE locked_until IS NOT NULL;

-- Add brute force settings to system_settings
INSERT INTO system_settings (key, value, description) VALUES
    ('bruteforce_max_attempts', '5', '사용자별 로그인 최대 시도 횟수'),
    ('bruteforce_window_minutes', '5', '시도 횟수 추적 시간 (분)'),
    ('bruteforce_lock_minutes', '15', '계정 잠금 시간 (분)'),
    ('bruteforce_ip_max_attempts', '20', 'IP별 최대 로그인 시도 횟수'),
    ('bruteforce_ip_lock_minutes', '30', 'IP 잠금 시간 (분)'),
    ('bruteforce_enabled', 'true', '브루트포스 방어 활성화 여부')
ON CONFLICT (key) DO NOTHING;

-- Record migration
INSERT INTO schema_migrations (version, name, checksum)
VALUES ('20240110000001', '005_login_lockout', md5('005_login_lockout'))
ON CONFLICT (version) DO NOTHING;
