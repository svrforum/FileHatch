package database

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Migration represents a database migration
type Migration struct {
	Version  string
	Name     string
	Filename string
	SQL      string
}

// RunMigrations runs all pending database migrations
func RunMigrations(db *sql.DB) error {
	log.Println("[Migration] Checking for pending migrations...")

	// Ensure migrations table exists
	if err := ensureMigrationsTable(db); err != nil {
		return fmt.Errorf("failed to ensure migrations table: %w", err)
	}

	// Get applied migrations
	applied, err := getAppliedMigrations(db)
	if err != nil {
		return fmt.Errorf("failed to get applied migrations: %w", err)
	}

	// Get all migrations from embedded files
	migrations, err := loadMigrations()
	if err != nil {
		return fmt.Errorf("failed to load migrations: %w", err)
	}

	// Apply pending migrations
	appliedCount := 0
	for _, m := range migrations {
		if applied[m.Version] {
			continue
		}

		log.Printf("[Migration] Applying: %s (%s)", m.Name, m.Version)

		if err := applyMigration(db, m); err != nil {
			return fmt.Errorf("failed to apply migration %s: %w", m.Name, err)
		}

		appliedCount++
		log.Printf("[Migration] Successfully applied: %s", m.Name)
	}

	if appliedCount == 0 {
		log.Println("[Migration] All migrations are up to date")
	} else {
		log.Printf("[Migration] Applied %d migration(s)", appliedCount)
	}

	return nil
}

func ensureMigrationsTable(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(14) PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			applied_at TIMESTAMPTZ DEFAULT NOW(),
			checksum VARCHAR(64)
		)
	`)
	return err
}

func getAppliedMigrations(db *sql.DB) (map[string]bool, error) {
	rows, err := db.Query("SELECT version FROM schema_migrations")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	applied := make(map[string]bool)
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, err
		}
		applied[version] = true
	}

	return applied, rows.Err()
}

func loadMigrations() ([]Migration, error) {
	var migrations []Migration

	err := fs.WalkDir(migrationsFS, "migrations", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if d.IsDir() || !strings.HasSuffix(path, ".sql") {
			return nil
		}

		// Skip the schema migrations table creation file
		filename := filepath.Base(path)
		if strings.HasPrefix(filename, "000_") {
			return nil
		}

		content, err := migrationsFS.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read %s: %w", path, err)
		}

		// Extract version and name from filename
		// Format: 001_initial_schema.sql -> version: extracted from SQL, name: 001_initial_schema
		name := strings.TrimSuffix(filename, ".sql")
		version := extractVersion(string(content), name)

		if version == "" {
			log.Printf("[Migration] Warning: Could not extract version from %s, skipping", filename)
			return nil
		}

		migrations = append(migrations, Migration{
			Version:  version,
			Name:     name,
			Filename: filename,
			SQL:      string(content),
		})

		return nil
	})

	if err != nil {
		return nil, err
	}

	// Sort by version
	sort.Slice(migrations, func(i, j int) bool {
		return migrations[i].Version < migrations[j].Version
	})

	return migrations, nil
}

func extractVersion(sql, name string) string {
	// Try to find version in INSERT statement
	// Pattern: INSERT INTO schema_migrations (version, name) VALUES ('VERSION', ...)
	lines := strings.Split(sql, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "INSERT INTO schema_migrations") {
			// Extract version from VALUES clause
			if idx := strings.Index(line, "VALUES"); idx != -1 {
				rest := line[idx:]
				// Find first quoted value
				start := strings.Index(rest, "'")
				if start != -1 {
					end := strings.Index(rest[start+1:], "'")
					if end != -1 {
						return rest[start+1 : start+1+end]
					}
				}
			}
		}
	}

	// Fallback: extract from name (e.g., "001" from "001_initial_schema")
	parts := strings.SplitN(name, "_", 2)
	if len(parts) > 0 {
		// Check if it's a number
		if _, err := fmt.Sscanf(parts[0], "%d", new(int)); err == nil {
			return parts[0]
		}
	}

	return ""
}

func applyMigration(db *sql.DB, m Migration) error {
	// Execute the migration SQL (which includes the INSERT INTO schema_migrations)
	_, err := db.Exec(m.SQL)
	return err
}
