//go:build integration

package handlers

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

func TestBruteForceGuardAdminUnlockUserPostgres(t *testing.T) {
	dsn := os.Getenv("FILEHATCH_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("FILEHATCH_TEST_POSTGRES_DSN is not set")
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("db.Close() error = %v", err)
		}
	})
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	var databaseName string
	if err := db.QueryRow("SELECT current_database()").Scan(&databaseName); err != nil {
		t.Fatalf("query current database: %v", err)
	}
	if !strings.Contains(strings.ToLower(databaseName), "test") {
		t.Fatalf("integration test requires a database name containing test, got %q", databaseName)
	}

	_, err = db.Exec(`
		CREATE TEMP TABLE users (
			username TEXT PRIMARY KEY,
			locked_until TIMESTAMPTZ,
			failed_login_count INTEGER NOT NULL DEFAULT 0
		)
	`)
	if err != nil {
		t.Fatalf("create temporary users table: %v", err)
	}

	tests := []struct {
		name        string
		username    string
		lockedUntil interface{}
		wantChanged bool
	}{
		{
			name:        "active lock with quoted username",
			username:    "alice'o",
			lockedUntil: time.Now().Add(10 * time.Minute),
			wantChanged: true,
		},
		{
			name:        "expired lock",
			username:    "expired-user",
			lockedUntil: time.Now().Add(-10 * time.Minute),
			wantChanged: false,
		},
		{
			name:        "no active lock",
			username:    "unlocked-user",
			lockedUntil: nil,
			wantChanged: false,
		},
	}

	ctx := context.Background()
	guard := &BruteForceGuard{db: db}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := db.Exec(
				"INSERT INTO users (username, locked_until, failed_login_count) VALUES ($1, $2, $3)",
				test.username,
				test.lockedUntil,
				3,
			)
			if err != nil {
				t.Fatalf("insert test user: %v", err)
			}

			changed, err := guard.AdminUnlockUser(ctx, test.username)
			if err != nil {
				t.Fatalf("AdminUnlockUser() error = %v", err)
			}
			if changed != test.wantChanged {
				t.Fatalf("AdminUnlockUser() changed = %v, want %v", changed, test.wantChanged)
			}

			var lockedUntil sql.NullTime
			var failedLoginCount int
			err = db.QueryRow(
				"SELECT locked_until, failed_login_count FROM users WHERE username = $1",
				test.username,
			).Scan(&lockedUntil, &failedLoginCount)
			if err != nil {
				t.Fatalf("query unlocked user: %v", err)
			}
			if lockedUntil.Valid {
				t.Fatalf("locked_until remains set: %v", lockedUntil.Time)
			}
			if failedLoginCount != 0 {
				t.Fatalf("failed_login_count = %d, want 0", failedLoginCount)
			}
		})
	}

	_, err = guard.AdminUnlockUser(ctx, "missing-user")
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("AdminUnlockUser() missing user error = %v, want sql.ErrNoRows", err)
	}
}
