package handlers

import (
	"os"
	"testing"
)

func TestNewExternalStorageHandler_KeyPolicy(t *testing.T) {
	trackedVariables := []string{"FH_ENV", "STORAGE_ENCRYPTION_KEY", "SMB_ENCRYPTION_KEY"}
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
		storageKey  string
		smbKey      string
		wantError   bool
	}{
		{name: "production requires storage key", environment: "production", wantError: true},
		{
			name:        "SMB key is not a storage key fallback",
			environment: "production",
			smbKey:      "12345678901234567890123456789012",
			wantError:   true,
		},
		{name: "local environment allows storage development key", environment: "local"},
		{
			name:        "production accepts 64 character hex storage key",
			environment: "production",
			storageKey:  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setOrUnsetEnvironmentVariable("FH_ENV", tt.environment)
			setOrUnsetEnvironmentVariable("STORAGE_ENCRYPTION_KEY", tt.storageKey)
			setOrUnsetEnvironmentVariable("SMB_ENCRYPTION_KEY", tt.smbKey)

			_, err := NewExternalStorageHandler(nil, t.TempDir())
			if tt.wantError && err == nil {
				t.Fatal("NewExternalStorageHandler() error = nil, want an error")
			}
			if !tt.wantError && err != nil {
				t.Fatalf("NewExternalStorageHandler() unexpected error: %v", err)
			}
		})
	}
}

func setOrUnsetEnvironmentVariable(name, value string) {
	if value == "" {
		_ = os.Unsetenv(name)
		return
	}
	_ = os.Setenv(name, value)
}
