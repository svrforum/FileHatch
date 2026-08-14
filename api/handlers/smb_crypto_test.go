package handlers

import (
	"bytes"
	"encoding/hex"
	"os"
	"testing"
)

func TestParseEncryptionKey(t *testing.T) {
	hexKey := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	wantDecoded, err := hex.DecodeString(hexKey)
	if err != nil {
		t.Fatalf("decode test fixture: %v", err)
	}

	tests := []struct {
		name      string
		value     string
		want      []byte
		wantError bool
	}{
		{
			name:  "raw 32 byte key",
			value: "12345678901234567890123456789012",
			want:  []byte("12345678901234567890123456789012"),
		},
		{name: "64 character hex key", value: hexKey, want: wantDecoded},
		{name: "short key is not padded", value: "short", wantError: true},
		{name: "long key is not truncated", value: string(bytes.Repeat([]byte{'z'}, 65)), wantError: true},
		{name: "invalid 64 character hex is rejected", value: string(bytes.Repeat([]byte{'g'}, 64)), wantError: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseEncryptionKey("TEST_KEY", tt.value)
			if tt.wantError {
				if err == nil {
					t.Fatal("parseEncryptionKey() error = nil, want an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("parseEncryptionKey() unexpected error: %v", err)
			}
			if !bytes.Equal(got, tt.want) {
				t.Errorf("parseEncryptionKey() = %x, want %x", got, tt.want)
			}
		})
	}
}

func TestNewSMBCrypto_KeyPolicy(t *testing.T) {
	originalKey, keySet := os.LookupEnv("SMB_ENCRYPTION_KEY")
	originalEnvironment, environmentSet := os.LookupEnv("FH_ENV")
	t.Cleanup(func() {
		if keySet {
			_ = os.Setenv("SMB_ENCRYPTION_KEY", originalKey)
		} else {
			_ = os.Unsetenv("SMB_ENCRYPTION_KEY")
		}
		if environmentSet {
			_ = os.Setenv("FH_ENV", originalEnvironment)
		} else {
			_ = os.Unsetenv("FH_ENV")
		}
	})

	tests := []struct {
		name        string
		environment string
		key         string
		wantError   bool
	}{
		{name: "production requires SMB key", environment: "production", wantError: true},
		{name: "unset environment requires SMB key", wantError: true},
		{name: "test environment allows SMB development key", environment: "test"},
		{
			name:        "production accepts raw 32 byte SMB key",
			environment: "production",
			key:         "12345678901234567890123456789012",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.environment == "" {
				_ = os.Unsetenv("FH_ENV")
			} else {
				_ = os.Setenv("FH_ENV", tt.environment)
			}
			if tt.key == "" {
				_ = os.Unsetenv("SMB_ENCRYPTION_KEY")
			} else {
				_ = os.Setenv("SMB_ENCRYPTION_KEY", tt.key)
			}

			_, err := NewSMBCrypto(t.TempDir())
			if tt.wantError && err == nil {
				t.Fatal("NewSMBCrypto() error = nil, want an error")
			}
			if !tt.wantError && err != nil {
				t.Fatalf("NewSMBCrypto() unexpected error: %v", err)
			}
		})
	}
}
