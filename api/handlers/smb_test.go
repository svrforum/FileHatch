package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestRequireSMBAdmin(t *testing.T) {
	tests := []struct {
		name       string
		claims     *JWTClaims
		wantStatus int
	}{
		{name: "anonymous rejected", wantStatus: http.StatusUnauthorized},
		{
			name:       "regular user rejected",
			claims:     &JWTClaims{UserID: "user-id", Username: "user"},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "administrator accepted",
			claims:     &JWTClaims{UserID: "admin-id", Username: "admin", IsAdmin: true},
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := echo.New()
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/smb/users", nil)
			c := e.NewContext(request, recorder)
			if tt.claims != nil {
				c.Set("user", tt.claims)
			}

			err := requireSMBAdmin(c)
			if err != nil {
				t.Fatalf("requireSMBAdmin() error = %v", err)
			}
			if tt.wantStatus == http.StatusOK {
				if recorder.Code != http.StatusOK {
					t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
				}
				return
			}
			if recorder.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, tt.wantStatus)
			}
		})
	}
}
