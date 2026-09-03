-- Migration: 011_password_policy_settings
-- Description: Add configurable web login password policy defaults.

INSERT INTO system_settings (key, value, description) VALUES
    ('password_min_length', '8', '웹 로그인 비밀번호 최소 문자 수'),
    ('password_max_length', '72', '웹 로그인 비밀번호 최대 문자 수'),
    ('password_required_uppercase', 'false', '웹 로그인 비밀번호 대문자 필수 여부'),
    ('password_required_lowercase', 'false', '웹 로그인 비밀번호 소문자 필수 여부'),
    ('password_required_number', 'false', '웹 로그인 비밀번호 숫자 필수 여부'),
    ('password_required_special', 'false', '웹 로그인 비밀번호 특수문자 필수 여부'),
    ('password_min_character_types', '3', '웹 로그인 비밀번호 최소 문자 종류 수')
ON CONFLICT (key) DO NOTHING;

INSERT INTO schema_migrations (version, name) VALUES ('20240101000011', '011_password_policy_settings')
ON CONFLICT (version) DO NOTHING;
