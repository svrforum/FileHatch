-- Schema Migrations Tracking Table
-- 이 테이블은 적용된 마이그레이션을 추적합니다.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(14) PRIMARY KEY,  -- 형식: YYYYMMDDHHMMSS
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    checksum VARCHAR(64)  -- SHA256 해시
);

COMMENT ON TABLE schema_migrations IS 'Database migration version tracking';
