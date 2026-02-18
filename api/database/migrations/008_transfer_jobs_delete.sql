-- Add delete_paths column for server-side delete jobs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='transfer_jobs' AND column_name='delete_paths') THEN
    ALTER TABLE transfer_jobs ADD COLUMN delete_paths JSONB;
  END IF;
END $$;

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES ('20240101000008', '008_transfer_jobs_delete')
ON CONFLICT (version) DO NOTHING;
