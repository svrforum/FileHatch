-- Migration: 002_default_data
-- Description: Default admin account and system settings
-- Version: 20240101000002

-- Create default admin account (password: admin1234)
-- bcrypt hash for 'admin1234'
INSERT INTO users (username, email, password_hash, is_admin, is_active)
VALUES ('admin', 'admin@localhost', '$2a$10$mRaibXXeo0eBpeg3gDgequkcQynn8GuvLflrbR9pRYAVDO/nf5pqW', TRUE, TRUE)
ON CONFLICT (username) DO NOTHING;

-- Insert default settings
INSERT INTO system_settings (key, value, description) VALUES
    ('trash_retention_days', '30', '휴지통 자동 삭제 일수 (기본: 30일)'),
    ('default_storage_quota', '10737418240', '기본 저장 공간 할당량 (바이트, 기본: 10GB)'),
    ('max_file_size', '10737418240', '최대 파일 크기 (바이트, 기본: 10GB)'),
    ('session_timeout_hours', '24', '세션 만료 시간 (시간, 기본: 24)'),
    -- Security Settings
    ('rate_limit_enabled', 'true', 'Rate Limiting 활성화 여부'),
    ('rate_limit_rps', '100', '초당 요청 제한 (IP당)'),
    ('security_headers_enabled', 'true', '보안 헤더 활성화 여부'),
    ('xss_protection_enabled', 'true', 'XSS Protection 헤더 활성화'),
    ('hsts_enabled', 'true', 'HSTS (HTTP Strict Transport Security) 활성화'),
    ('csp_enabled', 'true', 'Content Security Policy 활성화'),
    ('x_frame_options', 'SAMEORIGIN', 'X-Frame-Options 설정 (DENY, SAMEORIGIN, ALLOW-FROM)'),
    -- SSO Settings
    ('sso_enabled', 'false', 'SSO 로그인 활성화 여부'),
    ('sso_only_mode', 'false', 'SSO 전용 모드 (로컬 로그인 비활성화)'),
    ('sso_auto_register', 'true', 'SSO 최초 로그인 시 자동 사용자 생성'),
    ('sso_allowed_domains', '', 'SSO 허용 이메일 도메인 (쉼표로 구분, 비어있으면 모두 허용)')
ON CONFLICT (key) DO NOTHING;

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES ('20240101000002', '002_default_data')
ON CONFLICT (version) DO NOTHING;
