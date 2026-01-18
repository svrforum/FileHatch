-- Migration: 002_default_data
-- Version: 20240101000002
-- Description: Create default admin account and system settings

-- =============================================================================
-- Default Admin Account
-- =============================================================================
-- Password: admin1234 (bcrypt hash)
-- setup_completed = FALSE forces initial setup on first login
INSERT INTO users (username, email, password_hash, is_admin, is_active, setup_completed)
VALUES ('admin', 'admin@localhost', '$2a$10$mRaibXXeo0eBpeg3gDgequkcQynn8GuvLflrbR9pRYAVDO/nf5pqW', TRUE, TRUE, FALSE)
ON CONFLICT (username) DO NOTHING;

-- =============================================================================
-- Default System Settings
-- =============================================================================
INSERT INTO system_settings (key, value, description) VALUES
    -- Storage settings
    ('trash_retention_days', '30', 'Days before trash is auto-deleted (default: 30)'),
    ('default_storage_quota', '10737418240', 'Default storage quota in bytes (default: 10GB)'),
    ('max_file_size', '10737418240', 'Maximum file size in bytes (default: 10GB)'),

    -- Session settings
    ('session_timeout_hours', '24', 'Session timeout in hours (default: 24)'),

    -- Rate limiting
    ('rate_limit_enabled', 'true', 'Enable rate limiting'),
    ('rate_limit_rps', '100', 'Requests per second per IP'),

    -- Security headers
    ('security_headers_enabled', 'true', 'Enable security headers'),
    ('xss_protection_enabled', 'true', 'Enable XSS Protection header'),
    ('hsts_enabled', 'true', 'Enable HSTS (HTTP Strict Transport Security)'),
    ('csp_enabled', 'true', 'Enable Content Security Policy'),
    ('x_frame_options', 'SAMEORIGIN', 'X-Frame-Options setting (DENY, SAMEORIGIN, ALLOW-FROM)'),

    -- SSO settings
    ('sso_enabled', 'false', 'Enable SSO login'),
    ('sso_only_mode', 'false', 'SSO-only mode (disable local login)'),
    ('sso_auto_register', 'true', 'Auto-create users on first SSO login'),
    ('sso_allowed_domains', '', 'Allowed email domains for SSO (comma-separated, empty = all)'),

    -- Brute force protection
    ('bruteforce_max_attempts', '5', 'Max login attempts per user'),
    ('bruteforce_window_minutes', '5', 'Attempt tracking window in minutes'),
    ('bruteforce_lock_minutes', '15', 'Account lock duration in minutes'),
    ('bruteforce_ip_max_attempts', '20', 'Max login attempts per IP'),
    ('bruteforce_ip_lock_minutes', '30', 'IP lock duration in minutes'),
    ('bruteforce_enabled', 'true', 'Enable brute force protection')
ON CONFLICT (key) DO NOTHING;

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES ('20240101000002', '002_default_data')
ON CONFLICT (version) DO NOTHING;
