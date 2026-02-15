-- Add user preferences JSONB column to users table
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='preferences') THEN
    ALTER TABLE users ADD COLUMN preferences JSONB DEFAULT '{}';
  END IF;
END $$;

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES ('20240101000005', '005_user_preferences')
ON CONFLICT (version) DO NOTHING;
