package handlers

import "testing"

// withKeyringEnv points the keyring at a temp config dir and clears the key
// environment, so each test starts from a known state.
func withKeyringEnv(t *testing.T, env map[string]string) {
	t.Helper()
	t.Setenv("FH_CONFIG_PATH", t.TempDir())
	for _, k := range []string{"STORAGE_ENCRYPTION_KEY", "SMB_ENCRYPTION_KEY", "TOTP_ENCRYPTION_KEY", "LEGACY_ENCRYPTION_KEY"} {
		t.Setenv(k, "")
	}
	for k, v := range env {
		t.Setenv(k, v)
	}
	ResetKeyringsForTest()
	t.Cleanup(ResetKeyringsForTest)
}

// The upgrade case that matters: an install running the old code encrypted its
// secrets with the published literal. After upgrading, those secrets must still
// open, or every external storage mount and every 2FA enrolment breaks.
func TestKeyring_ReadsLegacyCiphertext(t *testing.T) {
	for _, tc := range []struct {
		name    string
		purpose keyPurpose
	}{
		{"storage", purposeStorage},
		{"smb", purposeSMB},
		{"totp", purposeTOTP},
	} {
		t.Run(tc.name, func(t *testing.T) {
			withKeyringEnv(t, nil)

			legacyKey := normalizeKey(keyringSpecs[tc.purpose].legacyKey)
			ciphertext, err := EncryptAESGCM([]byte("s3-secret-value"), legacyKey)
			if err != nil {
				t.Fatalf("encrypt with legacy key: %v", err)
			}

			plaintext, usedLegacy, err := GetKeyring(tc.purpose).Decrypt(ciphertext)
			if err != nil {
				t.Fatalf("legacy ciphertext failed to decrypt: %v", err)
			}
			if string(plaintext) != "s3-secret-value" {
				t.Errorf("plaintext = %q, want s3-secret-value", plaintext)
			}
			if !usedLegacy {
				t.Error("usedLegacy = false; caller has no signal to re-encrypt")
			}
		})
	}
}

// New writes must not use the published literal.
func TestKeyring_GeneratedPrimaryDiffersFromLegacy(t *testing.T) {
	withKeyringEnv(t, nil)

	ring := GetKeyring(purposeStorage)
	legacy := normalizeKey(keyringSpecs[purposeStorage].legacyKey)

	if string(ring.Primary()) == string(legacy) {
		t.Fatal("primary key is still the published literal")
	}

	ciphertext, err := ring.Encrypt([]byte("new-secret"))
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if _, err := DecryptAESGCM(ciphertext, legacy); err == nil {
		t.Fatal("new ciphertext opened with the published literal")
	}
}

func TestKeyring_PrefersExplicitEnvVar(t *testing.T) {
	withKeyringEnv(t, map[string]string{"STORAGE_ENCRYPTION_KEY": "operator-supplied-key-value-32ch"})

	if string(GetKeyring(purposeStorage).Primary()) != string(normalizeKey("operator-supplied-key-value-32ch")) {
		t.Fatal("STORAGE_ENCRYPTION_KEY was not used as the primary key")
	}
}

// A generated key is written to the config volume, so a restart keeps reading
// what the previous run wrote.
func TestKeyring_GeneratedKeyIsStable(t *testing.T) {
	withKeyringEnv(t, nil)

	ciphertext, err := GetKeyring(purposeTOTP).Encrypt([]byte("totp-seed"))
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	// Simulate a restart: same config dir, fresh keyring cache.
	ResetKeyringsForTest()

	plaintext, _, err := GetKeyring(purposeTOTP).Decrypt(ciphertext)
	if err != nil {
		t.Fatalf("data written before the restart no longer opens: %v", err)
	}
	if string(plaintext) != "totp-seed" {
		t.Errorf("plaintext = %q, want totp-seed", plaintext)
	}
}

// LEGACY_ENCRYPTION_KEY lets an operator rotate without losing existing data.
func TestKeyring_AcceptsOperatorLegacyKey(t *testing.T) {
	oldKey := "the-previous-operator-key-32chars"
	ciphertext, err := EncryptAESGCM([]byte("rotated-secret"), normalizeKey(oldKey))
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	withKeyringEnv(t, map[string]string{
		"STORAGE_ENCRYPTION_KEY": "the-brand-new-operator-key-32chr",
		"LEGACY_ENCRYPTION_KEY":  oldKey,
	})

	plaintext, usedLegacy, err := GetKeyring(purposeStorage).Decrypt(ciphertext)
	if err != nil {
		t.Fatalf("data under the previous key did not open: %v", err)
	}
	if string(plaintext) != "rotated-secret" {
		t.Errorf("plaintext = %q", plaintext)
	}
	if !usedLegacy {
		t.Error("usedLegacy = false")
	}
}

func TestKeyring_RejectsUnknownCiphertext(t *testing.T) {
	withKeyringEnv(t, nil)

	stranger, err := EncryptAESGCM([]byte("not-ours"), normalizeKey("a-key-this-server-never-had-32ch"))
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	if _, _, err := GetKeyring(purposeStorage).Decrypt(stranger); err == nil {
		t.Fatal("ciphertext from an unrelated key was accepted")
	}
}
