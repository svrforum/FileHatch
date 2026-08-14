package handlers

import (
	"net/http"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestSettingsHandler_UpdateSettingsRejectsInvalidPasswordPolicy(t *testing.T) {
	tests := []struct {
		name     string
		settings map[string]string
	}{
		{
			name: "invalid boolean",
			settings: map[string]string{
				"password_required_uppercase": "yes",
			},
		},
		{
			name: "maximum below minimum",
			settings: map[string]string{
				"password_min_length": "16",
				"password_max_length": "8",
			},
		},
		{
			name: "unknown policy key",
			settings: map[string]string{
				"password_required_emoji": "true",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tc := SetupTest(t)
			defer tc.Cleanup()

			handler := NewSettingsHandler(tc.DB)
			if tt.name != "unknown policy key" {
				tc.Mock.ExpectQuery("SELECT key, value").WillReturnRows(
					sqlmock.NewRows([]string{"key", "value", "updated_at"}),
				)
			}
			req, _ := NewJSONRequest(http.MethodPut, "/api/admin/settings", map[string]interface{}{
				"settings": tt.settings,
			})
			c := CreateAuthenticatedContext(
				tc.Echo,
				tc.Recorder,
				req,
				"admin-id",
				"admin",
				true,
			)

			if err := handler.UpdateSettings(c); err != nil {
				t.Fatalf("UpdateSettings() error = %v", err)
			}
			AssertStatus(t, tc.Recorder, http.StatusBadRequest)
		})
	}
}

func TestSettingsHandler_UpdateSettingsCommitsPolicyAtomically(t *testing.T) {
	tc := SetupTest(t)
	defer tc.Cleanup()

	handler := NewSettingsHandler(tc.DB)
	tc.Mock.ExpectQuery("SELECT key, value").WillReturnRows(
		sqlmock.NewRows([]string{"key", "value", "updated_at"}),
	)
	tc.Mock.ExpectBegin()
	tc.Mock.ExpectExec(regexp.QuoteMeta("INSERT INTO system_settings (key, value, updated_by, updated_at)")).
		WithArgs("password_min_length", "12", "admin-id").
		WillReturnResult(sqlmock.NewResult(0, 1))
	tc.Mock.ExpectCommit()

	req, _ := NewJSONRequest(http.MethodPut, "/api/admin/settings", map[string]interface{}{
		"settings": map[string]string{"password_min_length": "12"},
	})
	c := CreateAuthenticatedContext(
		tc.Echo,
		tc.Recorder,
		req,
		"admin-id",
		"admin",
		true,
	)

	if err := handler.UpdateSettings(c); err != nil {
		t.Fatalf("UpdateSettings() error = %v", err)
	}
	AssertStatus(t, tc.Recorder, http.StatusOK)
}
