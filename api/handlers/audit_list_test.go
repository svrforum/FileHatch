package handlers

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
)

func TestBuildAuditLogFilterCategories(t *testing.T) {
	tests := []struct {
		name      string
		category  string
		wantParts []string
		wantErr   bool
	}{
		{
			name:      "legacy user category",
			category:  "user",
			wantParts: []string{"user.%", "share.%"},
		},
		{
			name:      "activity excludes login",
			category:  "activity",
			wantParts: []string{"share.%", "user.%", "user.login"},
		},
		{
			name:     "access allowlist",
			category: "access",
			wantParts: []string{
				"user.login", "sso_login", EventLoginFailed, EventLoginBlocked,
				EventAccountLocked, EventAccountUnlocked, EventIPLocked,
			},
		},
		{name: "unknown category", category: "everything", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filter, _, err := buildAuditLogFilter(tt.category, "", "", "", nil, nil)
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
			for _, part := range tt.wantParts {
				if !strings.Contains(filter, part) {
					t.Errorf("filter %q does not contain %q", filter, part)
				}
			}
		})
	}
}

func TestBuildAuditLogFilterSearchAndDatesShareArguments(t *testing.T) {
	start := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	filter, args, err := buildAuditLogFilter("access", "security.login_failed", "alice", "192.0.2", &start, &end)
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{"al.event_type = $1", "al.target_resource LIKE $2", "u.username", "al.ip_addr::text", "$3", "al.ts >= $4", "al.ts < $5"} {
		if !strings.Contains(filter, part) {
			t.Errorf("filter %q does not contain %q", filter, part)
		}
	}
	if len(args) != 5 {
		t.Fatalf("argument count = %d, want 5", len(args))
	}
}

func TestAuditHandlerListAuditLogsRejectsUnknownCategory(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/audit/logs?category=unknown", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	handler := &AuditHandler{db: db}

	if err := handler.ListAuditLogs(c); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAuditHandlerListAuditLogsUsesStableOrderAndHandlesCountError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta("ORDER BY al.ts DESC, al.id DESC LIMIT $1 OFFSET $2")).
		WithArgs(100, 0).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "ts", "actor_id", "username", "ip_addr", "event_type", "target_resource", "details",
		}))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\)").
		WillReturnError(errors.New("count failed"))

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/audit/logs", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	handler := &AuditHandler{db: db}

	if err := handler.ListAuditLogs(c); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500: %s", rec.Code, rec.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
