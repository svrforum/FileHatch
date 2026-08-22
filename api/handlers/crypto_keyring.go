package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// External storage credentials, SMB passwords and TOTP seeds were each
// encrypted with a key that, when the operator had not set one, came from a
// string literal in this repository:
//
//	"filehatch-default-key-change-me!!"
//	"fh-dev-smb-key-not-for-prod-32"
//	"fh-dev-totp-key-not-for-prod-32"
//
// The repository is public, so on a default install those ciphertexts were
// readable by anyone who obtained the database — S3 secret keys, SMB
// passwords, and every user's 2FA seed.
//
// Simply deleting the literals would make existing data undecryptable. A
// keyring solves both halves: encryption always uses the primary key, while
// decryption walks the whole ring, so data written under a legacy key keeps
// opening and is re-encrypted the next time it is written.

// keyPurpose identifies which secret a keyring protects.
type keyPurpose string

const (
	purposeStorage keyPurpose = "storage"
	purposeSMB     keyPurpose = "smb"
	purposeTOTP    keyPurpose = "totp"
)

// keyringSpec describes where a purpose's key material may come from.
type keyringSpec struct {
	// envVars are read in order; the first non-empty one becomes primary.
	envVars []string
	// legacyKey is the string literal previous versions fell back to. It is
	// decrypt-only.
	legacyKey string
	// fileName is where a generated key is persisted, under the config dir.
	fileName string
}

var keyringSpecs = map[keyPurpose]keyringSpec{
	purposeStorage: {
		envVars:   []string{"STORAGE_ENCRYPTION_KEY", "SMB_ENCRYPTION_KEY"},
		legacyKey: "filehatch-default-key-change-me!!",
		fileName:  "storage_encryption_key",
	},
	purposeSMB: {
		envVars:   []string{"SMB_ENCRYPTION_KEY"},
		legacyKey: "fh-dev-smb-key-not-for-prod-32",
		fileName:  "smb_encryption_key",
	},
	purposeTOTP: {
		envVars:   []string{"TOTP_ENCRYPTION_KEY", "SMB_ENCRYPTION_KEY"},
		legacyKey: "fh-dev-totp-key-not-for-prod-32",
		fileName:  "totp_encryption_key",
	},
}

// Keyring holds one primary key for writing and any number of older keys that
// are still accepted for reading.
type Keyring struct {
	primary []byte
	legacy  [][]byte
}

// Primary returns the key new ciphertext is written with.
func (k *Keyring) Primary() []byte { return k.primary }

// Decrypt tries the primary key first, then each legacy key. The second return
// value reports whether a legacy key was used, so callers can re-encrypt.
func (k *Keyring) Decrypt(ciphertext string) (plaintext []byte, usedLegacy bool, err error) {
	if plaintext, err = DecryptAESGCM(ciphertext, k.primary); err == nil {
		return plaintext, false, nil
	}
	for _, key := range k.legacy {
		if plaintext, legacyErr := DecryptAESGCM(ciphertext, key); legacyErr == nil {
			return plaintext, true, nil
		}
	}
	// Report the primary-key failure: it is the one an operator can act on.
	return nil, false, err
}

// Encrypt writes ciphertext under the primary key.
func (k *Keyring) Encrypt(plaintext []byte) (string, error) {
	return EncryptAESGCM(plaintext, k.primary)
}

var (
	keyringsMu sync.Mutex
	keyrings   = map[keyPurpose]*Keyring{}
)

// normalizeKey coerces arbitrary key material to the 32 bytes AES-256 needs,
// matching what previous versions did so existing ciphertext still opens.
func normalizeKey(raw string) []byte {
	key := make([]byte, 32)
	copy(key, []byte(raw))
	return key
}

// GetKeyring returns the keyring for a purpose, building it on first use.
func GetKeyring(purpose keyPurpose) *Keyring {
	keyringsMu.Lock()
	defer keyringsMu.Unlock()

	if ring, ok := keyrings[purpose]; ok {
		return ring
	}

	spec := keyringSpecs[purpose]
	ring := &Keyring{}

	for _, env := range spec.envVars {
		if v := os.Getenv(env); v != "" {
			ring.primary = normalizeKey(v)
			break
		}
	}

	if ring.primary == nil {
		ring.primary = loadOrCreatePersistedKey(purpose, spec)
	}

	// The published literal always stays readable so upgrades do not lose data.
	ring.legacy = append(ring.legacy, normalizeKey(spec.legacyKey))

	// An operator rotating keys can keep the old one readable for one release.
	if legacy := os.Getenv("LEGACY_ENCRYPTION_KEY"); legacy != "" {
		ring.legacy = append(ring.legacy, normalizeKey(legacy))
	}

	keyrings[purpose] = ring
	return ring
}

// loadOrCreatePersistedKey reads a generated key from the config volume, or
// creates one. This keeps a default install off the published literal without
// demanding configuration before the server will start.
func loadOrCreatePersistedKey(purpose keyPurpose, spec keyringSpec) []byte {
	configPath := os.Getenv("FH_CONFIG_PATH")
	if configPath == "" {
		configPath = defaultConfigPath
	}
	keyPath := filepath.Join(configPath, spec.fileName)

	if stored, err := os.ReadFile(keyPath); err == nil {
		if trimmed := strings.TrimSpace(string(stored)); len(trimmed) >= 32 {
			return normalizeKey(trimmed)
		}
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		log.Printf("WARNING: could not generate a %s encryption key (%v); falling back to the legacy key. "+
			"Set %s explicitly.", purpose, err, spec.envVars[0])
		return normalizeKey(spec.legacyKey)
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)

	if err := os.MkdirAll(configPath, 0o750); err != nil {
		log.Printf("WARNING: %s is not writable (%v); the generated %s key cannot be kept and secrets "+
			"written now will not open after a restart. Set %s explicitly.", configPath, err, purpose, spec.envVars[0])
		return normalizeKey(spec.legacyKey)
	}
	if err := os.WriteFile(keyPath, []byte(encoded), 0o600); err != nil {
		log.Printf("WARNING: could not save the generated %s key to %s (%v). Set %s explicitly.",
			purpose, keyPath, err, spec.envVars[0])
		return normalizeKey(spec.legacyKey)
	}

	log.Printf("%s was not set. A random encryption key was generated and saved to %s. "+
		"Existing data stays readable and is re-encrypted as it is written.", spec.envVars[0], keyPath)
	return normalizeKey(encoded)
}

// ResetKeyringsForTest clears the cache so tests can vary the environment.
func ResetKeyringsForTest() {
	keyringsMu.Lock()
	defer keyringsMu.Unlock()
	keyrings = map[keyPurpose]*Keyring{}
}
