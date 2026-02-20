-- Performance indexes for Phase 1 optimization

-- 1. audit_logs: GetRecentFiles 쿼리 최적화 (actor_id + ts DESC 복합 인덱스)
CREATE INDEX IF NOT EXISTS idx_audit_actor_ts ON audit_logs(actor_id, ts DESC);

-- 2. shares: 만료 체크 최적화 (share_expiration.go에서 매시간 실행)
CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares(expires_at) WHERE expires_at IS NOT NULL;

-- 3. transfer_jobs: 완료된 작업 정리 최적화
CREATE INDEX IF NOT EXISTS idx_transfer_jobs_completed ON transfer_jobs(status, completed_at) WHERE status IN ('completed', 'failed', 'cancelled');

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES ('20240101000009', '009_performance_indexes')
ON CONFLICT (version) DO NOTHING;
