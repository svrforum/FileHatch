-- Fix FK constraints on external_storages and external_storage_access tables
-- Add ON DELETE SET NULL for user references so user deletion does not cause FK violations

-- Fix external_storages.created_by FK
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'external_storages_created_by_fkey'
          AND table_name = 'external_storages'
    ) THEN
        ALTER TABLE external_storages DROP CONSTRAINT external_storages_created_by_fkey;
    END IF;

    ALTER TABLE external_storages
        ADD CONSTRAINT external_storages_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
END $$;

-- Fix external_storage_access.granted_by FK
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'external_storage_access_granted_by_fkey'
          AND table_name = 'external_storage_access'
    ) THEN
        ALTER TABLE external_storage_access DROP CONSTRAINT external_storage_access_granted_by_fkey;
    END IF;

    ALTER TABLE external_storage_access
        ADD CONSTRAINT external_storage_access_granted_by_fkey
        FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL;
END $$;

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES ('20240101000004', '004_fix_external_storage_fk')
ON CONFLICT (version) DO NOTHING;
