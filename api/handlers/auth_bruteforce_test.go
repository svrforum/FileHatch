package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
)

func TestBruteForceGuardLockUserReportsOnlyTransition(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	guard := &BruteForceGuard{db: db, config: DefaultBruteForceConfig()}
	query := regexp.QuoteMeta(`UPDATE users
		SET locked_until = $1
		WHERE username = $2
		  AND (locked_until IS NULL OR locked_until <= NOW())
		RETURNING locked_until`)
	mock.ExpectQuery(query).
		WithArgs(sqlmock.AnyArg(), "alice").
		WillReturnRows(sqlmock.NewRows([]string{"locked_until"}).AddRow(time.Now().Add(time.Minute)))
	mock.ExpectQuery(query).
		WithArgs(sqlmock.AnyArg(), "alice").
		WillReturnError(sql.ErrNoRows)

	if !guard.lockUser(context.Background(), "alice") {
		t.Fatal("first lock must report a state transition")
	}
	if guard.lockUser(context.Background(), "alice") {
		t.Fatal("existing lock must not report another state transition")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestBruteForceGuardLogLockEventUsesMatchingDuration(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	audit := &AuditHandler{db: db, eventCh: make(chan auditEntry, 2)}
	guard := &BruteForceGuard{
		db: db,
		config: BruteForceConfig{
			LockDuration:   15 * time.Minute,
			IPLockDuration: 30 * time.Minute,
		},
		audit: audit,
	}

	username := "alice"
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM users WHERE username = $1")).
		WithArgs(username).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("user-id"))
	guard.logLockEvent(&username, "192.0.2.1", "user", "max_attempts")
	guard.logLockEvent(nil, "192.0.2.2", "ip", "max_attempts")

	tests := []struct {
		name         string
		wantEvent    string
		wantDuration string
	}{
		{name: "user lock", wantEvent: EventAccountLocked, wantDuration: "15m0s"},
		{name: "IP lock", wantEvent: EventIPLocked, wantDuration: "30m0s"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			entry := <-audit.eventCh
			if entry.eventType != tt.wantEvent {
				t.Fatalf("event type = %q, want %q", entry.eventType, tt.wantEvent)
			}
			var details map[string]interface{}
			if err := json.Unmarshal(entry.detailsJSON, &details); err != nil {
				t.Fatal(err)
			}
			if details["duration"] != tt.wantDuration {
				t.Fatalf("duration = %v, want %q", details["duration"], tt.wantDuration)
			}
		})
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestBruteForceGuardUnlockUserContract(t *testing.T) {
	tests := []struct {
		name       string
		dbResult   *sqlmock.Rows
		dbErr      error
		wantStatus int
		wantChange *bool
		wantAudit  bool
	}{
		{
			name:       "missing user",
			dbErr:      sql.ErrNoRows,
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "existing user without active lock",
			dbResult:   sqlmock.NewRows([]string{"changed"}).AddRow(false),
			wantStatus: http.StatusOK,
			wantChange: boolPointer(false),
		},
		{
			name:       "active lock",
			dbResult:   sqlmock.NewRows([]string{"changed"}).AddRow(true),
			wantStatus: http.StatusOK,
			wantChange: boolPointer(true),
			wantAudit:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()

			expectation := mock.ExpectQuery("WITH current_user AS").WithArgs("alice")
			if tt.dbErr != nil {
				expectation.WillReturnError(tt.dbErr)
			} else {
				expectation.WillReturnRows(tt.dbResult)
			}

			audit := &AuditHandler{db: db, eventCh: make(chan auditEntry, 1)}
			guard := &BruteForceGuard{db: db, audit: audit, keyPrefix: "fh:bruteforce:"}
			guard.localCache.Store("locked:user:alice", LocalCacheEntry{
				Count:     1,
				ExpiresAt: time.Now().Add(time.Minute),
			})

			e := echo.New()
			req := httptest.NewRequest(http.MethodDelete, "/api/admin/security/locked-users/alice", nil)
			req.Header.Set(echo.HeaderXForwardedFor, "192.0.2.10")
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)
			c.SetPath("/api/admin/security/locked-users/:username")
			c.SetParamNames("username")
			c.SetParamValues("alice")
			c.Set("user", &JWTClaims{UserID: "admin-id", Username: "admin"})

			if err := guard.UnlockUser(c); err != nil {
				t.Fatal(err)
			}
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantChange != nil {
				var response map[string]interface{}
				if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
					t.Fatal(err)
				}
				if response["changed"] != *tt.wantChange {
					t.Fatalf("changed = %v, want %v", response["changed"], *tt.wantChange)
				}
			}

			_, cached := guard.localCache.Load("locked:user:alice")
			if tt.dbErr == nil && cached {
				t.Fatal("successful unlock must remove the local lock cache")
			}
			if len(audit.eventCh) != boolToInt(tt.wantAudit) {
				t.Fatalf("audit event count = %d, want %d", len(audit.eventCh), boolToInt(tt.wantAudit))
			}
			if tt.wantAudit {
				entry := <-audit.eventCh
				if entry.eventType != EventAccountUnlocked || entry.targetResource != "alice" {
					t.Fatalf("unexpected unlock audit entry: %#v", entry)
				}
				if entry.actorID == nil || *entry.actorID != "admin-id" || entry.ipAddr != "192.0.2.10" {
					t.Fatalf("unlock audit attribution is incomplete: %#v", entry)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func boolPointer(value bool) *bool {
	return &value
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
