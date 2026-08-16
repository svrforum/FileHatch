package handlers

import (
	"net/http"
	"regexp"
	"testing"

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
