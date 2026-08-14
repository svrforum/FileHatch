package handlers

import (
	"encoding/json"
	"net/http"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
)

// newAdminUserContext wires an echo context that is already authenticated as an
// admin, mirroring what adminApi's middleware chain puts in place at runtime.
func newAdminUserContext(tc *TestContext, actorID string, req *http.Request) echo.Context {
	c := tc.Echo.NewContext(req, tc.Recorder)
	c.Set("user", &JWTClaims{
		UserID:   actorID,
		Username: "admin",
		IsAdmin:  true,
	})
	return c
}

func newTestAuthHandler(tc *TestContext) *AuthHandler {
	return &AuthHandler{
		db:        tc.DB,
		jwtSecret: []byte("test-jwt-secret-for-testing-only-32chars"),
		dataRoot:  "/data",
	}
}

// Regression test for Issue #40 (A): toggling only isActive used to bind
// IsAdmin to false and write it, silently stripping the target's admin rights.
func TestUpdateUser_PartialUpdate_DoesNotTouchIsAdmin(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	tc.Mock.ExpectQuery(regexp.QuoteMeta("SELECT username, is_admin, is_active FROM users WHERE id = $1")).
		WithArgs("target-id").
		WillReturnRows(sqlmock.NewRows([]string{"username", "is_admin", "is_active"}).
			AddRow("targetuser", true, true))

	// The target is an active admin being deactivated, so the last-admin guard
	// runs and must find at least one other admin.
	tc.Mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM users WHERE is_admin = true AND is_active = true AND id <> $1")).
		WithArgs("target-id").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))

	// The crux: the UPDATE must set is_active only. `is_admin` must not appear.
	tc.Mock.ExpectExec(`^UPDATE users SET updated_at = NOW\(\), is_active = \$1 WHERE id = \$2$`).
		WithArgs(false, "target-id").
		WillReturnResult(sqlmock.NewResult(0, 1))

	req, err := NewJSONRequest(http.MethodPut, "/api/admin/users/target-id",
		map[string]interface{}{"isActive": false})
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}

	c := newAdminUserContext(tc, "admin-id", req)
	c.SetParamNames("id")
	c.SetParamValues("target-id")

	if err := newTestAuthHandler(tc).UpdateUser(c); err != nil {
		t.Fatalf("UpdateUser returned error: %v", err)
	}

	AssertStatus(t, tc.Recorder, http.StatusOK)
	if err := tc.Mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

// An explicit isAdmin value must still be written.
func TestUpdateUser_ExplicitIsAdmin_IsApplied(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	tc.Mock.ExpectQuery(regexp.QuoteMeta("SELECT username, is_admin, is_active FROM users WHERE id = $1")).
		WithArgs("target-id").
		WillReturnRows(sqlmock.NewRows([]string{"username", "is_admin", "is_active"}).
			AddRow("targetuser", false, true))

	tc.Mock.ExpectExec(`^UPDATE users SET updated_at = NOW\(\), is_admin = \$1 WHERE id = \$2$`).
		WithArgs(true, "target-id").
		WillReturnResult(sqlmock.NewResult(0, 1))

	req, err := NewJSONRequest(http.MethodPut, "/api/admin/users/target-id",
		map[string]interface{}{"isAdmin": true})
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}

	c := newAdminUserContext(tc, "admin-id", req)
	c.SetParamNames("id")
	c.SetParamValues("target-id")

	if err := newTestAuthHandler(tc).UpdateUser(c); err != nil {
		t.Fatalf("UpdateUser returned error: %v", err)
	}

	AssertStatus(t, tc.Recorder, http.StatusOK)
	if err := tc.Mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

func TestUpdateUser_CannotDemoteSelf(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	tc.Mock.ExpectQuery(regexp.QuoteMeta("SELECT username, is_admin, is_active FROM users WHERE id = $1")).
		WithArgs("admin-id").
		WillReturnRows(sqlmock.NewRows([]string{"username", "is_admin", "is_active"}).
			AddRow("admin", true, true))

	req, err := NewJSONRequest(http.MethodPut, "/api/admin/users/admin-id",
		map[string]interface{}{"isAdmin": false})
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}

	c := newAdminUserContext(tc, "admin-id", req)
	c.SetParamNames("id")
	c.SetParamValues("admin-id")

	if err := newTestAuthHandler(tc).UpdateUser(c); err != nil {
		t.Fatalf("UpdateUser returned error: %v", err)
	}

	AssertStatus(t, tc.Recorder, http.StatusBadRequest)
	if err := tc.Mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

func TestUpdateUser_CannotRemoveLastAdmin(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	tc.Mock.ExpectQuery(regexp.QuoteMeta("SELECT username, is_admin, is_active FROM users WHERE id = $1")).
		WithArgs("target-id").
		WillReturnRows(sqlmock.NewRows([]string{"username", "is_admin", "is_active"}).
			AddRow("otheradmin", true, true))

	tc.Mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM users WHERE is_admin = true AND is_active = true AND id <> $1")).
		WithArgs("target-id").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	req, err := NewJSONRequest(http.MethodPut, "/api/admin/users/target-id",
		map[string]interface{}{"isAdmin": false})
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}

	c := newAdminUserContext(tc, "admin-id", req)
	c.SetParamNames("id")
	c.SetParamValues("target-id")

	if err := newTestAuthHandler(tc).UpdateUser(c); err != nil {
		t.Fatalf("UpdateUser returned error: %v", err)
	}

	AssertStatus(t, tc.Recorder, http.StatusBadRequest)
	if err := tc.Mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

// An empty body carries no instruction; writing only updated_at would be a
// silent no-op that still reports success.
func TestUpdateUser_EmptyBody_IsRejected(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	tc.Mock.ExpectQuery(regexp.QuoteMeta("SELECT username, is_admin, is_active FROM users WHERE id = $1")).
		WithArgs("target-id").
		WillReturnRows(sqlmock.NewRows([]string{"username", "is_admin", "is_active"}).
			AddRow("targetuser", false, true))

	req, err := NewJSONRequest(http.MethodPut, "/api/admin/users/target-id", map[string]interface{}{})
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}

	c := newAdminUserContext(tc, "admin-id", req)
	c.SetParamNames("id")
	c.SetParamValues("target-id")

	if err := newTestAuthHandler(tc).UpdateUser(c); err != nil {
		t.Fatalf("UpdateUser returned error: %v", err)
	}

	AssertStatus(t, tc.Recorder, http.StatusBadRequest)
	if err := tc.Mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

func TestDeleteUser_CannotDeleteLastAdmin(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	tc.Mock.ExpectQuery(regexp.QuoteMeta("SELECT username, is_admin, is_active FROM users WHERE id = $1")).
		WithArgs("target-id").
		WillReturnRows(sqlmock.NewRows([]string{"username", "is_admin", "is_active"}).
			AddRow("otheradmin", true, true))

	tc.Mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM users WHERE is_admin = true AND is_active = true AND id <> $1")).
		WithArgs("target-id").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	req, err := NewJSONRequest(http.MethodDelete, "/api/admin/users/target-id", nil)
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}

	c := newAdminUserContext(tc, "admin-id", req)
	c.SetParamNames("id")
	c.SetParamValues("target-id")

	if err := newTestAuthHandler(tc).DeleteUser(c); err != nil {
		t.Fatalf("DeleteUser returned error: %v", err)
	}

	AssertStatus(t, tc.Recorder, http.StatusBadRequest)
	if err := tc.Mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

// RequireAdmin used to hand back (nil, nil) for an unauthenticated request
// because RespondError returns c.JSON's nil. Callers' `if err != nil` guard
// never fired and the next claims dereference panicked.
func TestRequireAdmin_Unauthenticated_ReturnsError(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	req, err := NewJSONRequest(http.MethodGet, "/api/admin/users", nil)
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}
	c := tc.Echo.NewContext(req, tc.Recorder)

	claims, err := RequireAdmin(c)
	if claims != nil {
		t.Errorf("expected nil claims, got %+v", claims)
	}
	if err == nil {
		t.Fatal("expected a non-nil error so callers short-circuit; got nil")
	}
	AssertStatus(t, tc.Recorder, http.StatusUnauthorized)
}

func TestRequireAdmin_NonAdmin_ReturnsError(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	req, err := NewJSONRequest(http.MethodGet, "/api/admin/users", nil)
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}
	c := tc.Echo.NewContext(req, tc.Recorder)
	c.Set("user", &JWTClaims{UserID: "u1", Username: "bob", IsAdmin: false})

	claims, err := RequireAdmin(c)
	if claims != nil {
		t.Errorf("expected nil claims, got %+v", claims)
	}
	if err == nil {
		t.Fatal("expected a non-nil error so callers short-circuit; got nil")
	}
	AssertStatus(t, tc.Recorder, http.StatusForbidden)
}

func TestRequireClaims_Unauthenticated_ReturnsError(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	req, err := NewJSONRequest(http.MethodGet, "/api/shares", nil)
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}
	c := tc.Echo.NewContext(req, tc.Recorder)

	claims, err := RequireClaims(c)
	if claims != nil {
		t.Errorf("expected nil claims, got %+v", claims)
	}
	if err == nil {
		t.Fatal("expected a non-nil error so callers short-circuit; got nil")
	}
	AssertStatus(t, tc.Recorder, http.StatusUnauthorized)
}

func TestAuthHandler_ListUsersReturnsPaginationAndLockState(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	now := time.Now().UTC().Truncate(time.Second)
	lockedUntil := now.Add(15 * time.Minute)
	tc.Mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM users WHERE 1=1 AND locked_until IS NOT NULL AND locked_until > NOW()")).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	tc.Mock.ExpectQuery("SELECT id, username, email, provider, is_admin, is_active, smb_hash,[\\s\\S]+FROM users WHERE 1=1 AND locked_until IS NOT NULL").
		WithArgs(25, 25).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "username", "email", "provider", "is_admin", "is_active", "smb_hash",
			"totp_enabled", "storage_quota", "storage_used", "created_at", "updated_at",
			"locked_until", "failed_login_count", "last_failed_login",
		}).AddRow(
			"user-1", "locked-user", nil, "local", false, true, nil,
			false, int64(1024), int64(256), now, now, lockedUntil, 5, now,
		))

	req, _ := http.NewRequest(http.MethodGet, "/api/admin/users?page=2&limit=25&status=locked", nil)
	c := tc.Echo.NewContext(req, tc.Recorder)
	if err := CreateTestAuthHandler(tc.DB).ListUsers(c); err != nil {
		t.Fatalf("ListUsers() error = %v", err)
	}

	var response struct {
		Users []User `json:"users"`
		Total int    `json:"total"`
		Page  int    `json:"page"`
		Limit int    `json:"limit"`
	}
	if err := json.Unmarshal(tc.Recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Total != 1 || response.Page != 2 || response.Limit != 25 {
		t.Fatalf("pagination = total:%d page:%d limit:%d", response.Total, response.Page, response.Limit)
	}
	if len(response.Users) != 1 || response.Users[0].LockedUntil == nil || response.Users[0].FailedLoginCount != 5 {
		t.Fatalf("lock state not returned: %+v", response.Users)
	}
}

func TestAuthHandler_ListUsersRejectsUnknownStatus(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	req, _ := http.NewRequest(http.MethodGet, "/api/admin/users?status=unexpected", nil)
	c := tc.Echo.NewContext(req, tc.Recorder)
	if err := CreateTestAuthHandler(tc.DB).ListUsers(c); err != nil {
		t.Fatalf("ListUsers() error = %v", err)
	}
	AssertStatus(t, tc.Recorder, http.StatusBadRequest)
}

func TestAuthHandler_UpdateUserRejectsPasswordForSSOAccount(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := CreateTestAuthHandler(tc.DB)
	tc.Mock.ExpectQuery(regexp.QuoteMeta(
		"SELECT COALESCE(provider, 'local') FROM users WHERE id = $1",
	)).WithArgs("sso-user-id").WillReturnRows(
		sqlmock.NewRows([]string{"provider"}).AddRow("oidc"),
	)

	req, _ := NewJSONRequest(http.MethodPut, "/api/admin/users/sso-user-id", UpdateUserRequest{
		Password: "Password123!",
		IsActive: boolPointer(true),
	})
	c := tc.Echo.NewContext(req, tc.Recorder)
	c.SetPath("/api/admin/users/:id")
	c.SetParamNames("id")
	c.SetParamValues("sso-user-id")

	if err := handler.UpdateUser(c); err != nil {
		t.Fatalf("UpdateUser() error = %v", err)
	}
	AssertStatus(t, tc.Recorder, http.StatusForbidden)
	AssertJSONError(t, tc.Recorder, "SSO accounts cannot set a local password")
}
