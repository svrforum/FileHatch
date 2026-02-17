-- Hidden recent items table for "내 작업 → 최근 항목" hide/clear feature
CREATE TABLE IF NOT EXISTS hidden_recent_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path VARCHAR(1024) NOT NULL,
    hidden_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_hidden_recent_user ON hidden_recent_items(user_id);

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES ('20240101000006', '006_hidden_recent_items')
ON CONFLICT (version) DO NOTHING;
