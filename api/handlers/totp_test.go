package handlers

import (
	"os"
	"testing"
)

func TestNewTOTPHandler_KeyPolicy(t *testing.T) {
	trackedVariables := []string{
		"FH_ENV",
		"TOTP_ENCRYPTION_KEY",
		"SMB_ENCRYPTION_KEY",
		"JWT_SECRET",
	}
	originalValues := make(map[string]string, len(trackedVariables))
	originalSet := make(map[string]bool, len(trackedVariables))
	for _, name := range trackedVariables {
		originalValues[name], originalSet[name] = os.LookupEnv(name)
	}
	t.Cleanup(func() {
		for _, name := range trackedVariables {
			if originalSet[name] {
				_ = os.Setenv(name, originalValues[name])
			} else {
				_ = os.Unsetenv(name)
			}
		}
	})

	tests := []struct {
		name        string
		environment string
		totpKey     string
		smbKey      string
		jwtSecret   string
		wantError   bool
	}{
		{name: "production requires TOTP key", environment: "production", wantError: true},
		{
			name:        "SMB key is not a TOTP key fallback",
			environment: "production",
			smbKey:      "12345678901234567890123456789012",
			wantError:   true,
		},
		{
			name:        "JWT secret is not a TOTP key fallback",
			environment: "production",
			jwtSecret:   "production-jwt-secret-at-least-32-bytes",
			wantError:   true,
		},
		{name: "development allows TOTP development key", environment: "development"},
		{
			name:        "production accepts raw 32 byte TOTP key",
			environment: "production",
			totpKey:     "12345678901234567890123456789012",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setOrUnsetEnvironmentVariable("FH_ENV", tt.environment)
			setOrUnsetEnvironmentVariable("TOTP_ENCRYPTION_KEY", tt.totpKey)
			setOrUnsetEnvironmentVariable("SMB_ENCRYPTION_KEY", tt.smbKey)
			setOrUnsetEnvironmentVariable("JWT_SECRET", tt.jwtSecret)

			_, err := NewTOTPHandler(nil, nil)
			if tt.wantError && err == nil {
				t.Fatal("NewTOTPHandler() error = nil, want an error")
			}
			if !tt.wantError && err != nil {
				t.Fatalf("NewTOTPHandler() unexpected error: %v", err)
			}
		})
	}
}
