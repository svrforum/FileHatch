-- Migration: 006_performance_indexes
-- Description: Add composite indexes for frequently used query patterns
-- Version: 20240111000001

-- =============================================================================
-- Composite Indexes for Permission Checks
-- =============================================================================

-- Optimizes the join in permission check queries:
-- SELECT ... FROM shared_folders sf
-- INNER JOIN shared_folder_members sfm ON sf.id = sfm.shared_folder_id
-- WHERE sf.name = $1 AND sfm.user_id = $2 AND sf.is_active = TRUE
CREATE INDEX IF NOT EXISTS idx_sfm_user_folder
    ON shared_folder_members(user_id, shared_folder_id);

-- Optimizes shared folder lookup by name with active filter
CREATE INDEX IF NOT EXISTS idx_shared_folders_name_active
    ON shared_folders(name, is_active)
    WHERE is_active = TRUE;

-- =============================================================================
-- Composite Indexes for File Shares
-- =============================================================================

-- Optimizes file share permission lookups:
-- SELECT ... FROM file_shares WHERE shared_with_id = $1 AND item_path = $2
CREATE INDEX IF NOT EXISTS idx_file_shares_recipient_path
    ON file_shares(shared_with_id, item_path);

-- Optimizes owner's share listing with path prefix matching
CREATE INDEX IF NOT EXISTS idx_file_shares_owner_path
    ON file_shares(owner_id, item_path);

-- =============================================================================
-- Indexes for Audit Log Queries
-- =============================================================================

-- Optimizes audit log filtering by event type with timestamp ordering
CREATE INDEX IF NOT EXISTS idx_audit_type_ts
    ON audit_logs(event_type, ts DESC);

-- Optimizes security event filtering (login failures, access denied)
CREATE INDEX IF NOT EXISTS idx_audit_security_events
    ON audit_logs(event_type, ts DESC)
    WHERE event_type LIKE 'security.%';

-- =============================================================================
-- Indexes for Notification Queries
-- =============================================================================

-- Optimizes unread notification count and listing
CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON notifications(user_id, created_at DESC)
    WHERE is_read = FALSE;

-- =============================================================================
-- Indexes for Active Session Queries
-- =============================================================================

-- Optimizes user lookups with active filter (common in authentication)
CREATE INDEX IF NOT EXISTS idx_users_active
    ON users(username, is_active)
    WHERE is_active = TRUE;

-- =============================================================================
-- Record Migration
-- =============================================================================
INSERT INTO schema_migrations (version, name, checksum)
VALUES ('20240111000001', '006_performance_indexes', 'performance_idx_v1')
ON CONFLICT (version) DO NOTHING;
