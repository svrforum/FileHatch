package database

import (
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestLoadConnectionConfig(t *testing.T) {
	tests := []struct {
		name        string
		environment string
		setDatabase bool
		wantError   bool
	}{
		{
			name:        "development uses documented defaults",
			environment: "development",
		},
		{
			name:        "production requires every database value",
			environment: "production",
			wantError:   true,
		},
		{
			name:        "production accepts explicit database values",
			environment: "production",
			setDatabase: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("FH_ENV", test.environment)
			for _, name := range []string{"DB_HOST", "DB_PORT", "DB_USER", "DB_PASS", "DB_NAME"} {
				t.Setenv(name, "")
			}
			if test.setDatabase {
				t.Setenv("DB_HOST", "database")
				t.Setenv("DB_PORT", "5432")
				t.Setenv("DB_USER", "filehatch")
				t.Setenv("DB_PASS", "test-password")
				t.Setenv("DB_NAME", "filehatch")
			}

			got, err := loadConnectionConfig()
			if test.wantError {
				if err == nil || !strings.Contains(err.Error(), "DB_HOST") {
					t.Fatalf("loadConnectionConfig() error = %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("loadConnectionConfig() error = %v", err)
			}
			if test.environment == "development" && got.user != "fh_user" {
				t.Fatalf("development user = %q, want fh_user", got.user)
			}
		})
	}
}

func TestSecureInitialAdmin(t *testing.T) {
	t.Run("development leaves bootstrap data unchanged", func(t *testing.T) {
		t.Setenv("FH_ENV", "development")
		if err := SecureInitialAdmin(nil); err != nil {
			t.Fatalf("SecureInitialAdmin() error = %v", err)
		}
	})

	t.Run("production requires a strong bootstrap password", func(t *testing.T) {
		t.Setenv("FH_ENV", "production")
		t.Setenv("INITIAL_ADMIN_PASSWORD", "short")
		if err := SecureInitialAdmin(nil); err == nil {
			t.Fatal("SecureInitialAdmin() error = nil, want validation error")
		}
	})

	t.Run("production replaces only the untouched default hash", func(t *testing.T) {
		t.Setenv("FH_ENV", "production")
		t.Setenv("INITIAL_ADMIN_PASSWORD", "temporary-admin-password")

		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New() error = %v", err)
		}
		defer db.Close()

		mock.ExpectExec("UPDATE users").
			WithArgs(sqlmock.AnyArg(), knownDefaultAdminHash).
			WillReturnResult(sqlmock.NewResult(0, 1))

		if err := SecureInitialAdmin(db); err != nil {
			t.Fatalf("SecureInitialAdmin() error = %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet database expectations: %v", err)
		}
	})
}
