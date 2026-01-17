package handlers

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// SMBUserEntry represents an encrypted SMB user entry
type SMBUserEntry struct {
	Username          string `json:"username"`
	EncryptedPassword string `json:"password"` // AES-256-GCM encrypted
}

// SMBUsersFile represents the encrypted users file structure
type SMBUsersFile struct {
	Version int            `json:"version"`
	Users   []SMBUserEntry `json:"users"`
}

// SMBCrypto handles encryption/decryption of SMB user passwords
type SMBCrypto struct {
	key        []byte
	configPath string
	mu         sync.RWMutex
}

// NewSMBCrypto creates a new SMB crypto handler
func NewSMBCrypto(configPath string) (*SMBCrypto, error) {
	keyStr := os.Getenv("SMB_ENCRYPTION_KEY")
	if keyStr == "" {
		env := os.Getenv("FH_ENV")
		if env == "production" {
			return nil, fmt.Errorf("SMB_ENCRYPTION_KEY environment variable is required in production mode")
		}
		// Development default key - NOT FOR PRODUCTION
		keyStr = "fh-dev-smb-key-not-for-prod-32"
	}

	// Ensure key is exactly 32 bytes for AES-256
	key := make([]byte, 32)
	copy(key, []byte(keyStr))

	return &SMBCrypto{
		key:        key,
		configPath: configPath,
	}, nil
}

// GetSMBUsersFilePath returns the path to the SMB users file
func (sc *SMBCrypto) GetSMBUsersFilePath() string {
	return filepath.Join(sc.configPath, "smb_users.json")
}

// GetSMBUsersSyncFilePath returns the path to the plaintext sync file for samba container
func (sc *SMBCrypto) GetSMBUsersSyncFilePath() string {
	return filepath.Join(sc.configPath, "smb_users.txt")
}

// LoadUsers loads and decrypts all SMB users
func (sc *SMBCrypto) LoadUsers() (map[string]string, error) {
	sc.mu.RLock()
	defer sc.mu.RUnlock()

	filePath := sc.GetSMBUsersFilePath()
	content, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return make(map[string]string), nil
		}
		return nil, fmt.Errorf("failed to read SMB users file: %w", err)
	}

	var usersFile SMBUsersFile
	if err := json.Unmarshal(content, &usersFile); err != nil {
		return nil, fmt.Errorf("failed to parse SMB users file: %w", err)
	}

	users := make(map[string]string)
	for _, entry := range usersFile.Users {
		password, err := DecryptAESGCM(entry.EncryptedPassword, sc.key)
		if err != nil {
			// Skip entries that can't be decrypted (may have been encrypted with different key)
			continue
		}
		users[entry.Username] = string(password)
	}

	return users, nil
}

// SaveUser adds or updates a user's encrypted password
func (sc *SMBCrypto) SaveUser(username, password string) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()

	// Load existing users
	users, err := sc.loadUsersInternal()
	if err != nil {
		users = make(map[string]string)
	}

	// Update user
	users[username] = password

	// Save encrypted file
	if err := sc.saveUsersInternal(users); err != nil {
		return err
	}

	// Also write plaintext sync file for samba container
	return sc.writeSyncFile(users)
}

// RemoveUser removes a user from the encrypted store
func (sc *SMBCrypto) RemoveUser(username string) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()

	users, err := sc.loadUsersInternal()
	if err != nil {
		return nil // If file doesn't exist, nothing to remove
	}

	delete(users, username)

	if err := sc.saveUsersInternal(users); err != nil {
		return err
	}

	return sc.writeSyncFile(users)
}

// loadUsersInternal loads users without locking (caller must hold lock)
func (sc *SMBCrypto) loadUsersInternal() (map[string]string, error) {
	filePath := sc.GetSMBUsersFilePath()
	content, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return make(map[string]string), nil
		}
		return nil, err
	}

	var usersFile SMBUsersFile
	if err := json.Unmarshal(content, &usersFile); err != nil {
		return nil, err
	}

	users := make(map[string]string)
	for _, entry := range usersFile.Users {
		password, err := DecryptAESGCM(entry.EncryptedPassword, sc.key)
		if err != nil {
			continue
		}
		users[entry.Username] = string(password)
	}

	return users, nil
}

// saveUsersInternal saves users without locking (caller must hold lock)
func (sc *SMBCrypto) saveUsersInternal(users map[string]string) error {
	usersFile := SMBUsersFile{
		Version: 1,
		Users:   make([]SMBUserEntry, 0, len(users)),
	}

	for username, password := range users {
		encrypted, err := EncryptAESGCM([]byte(password), sc.key)
		if err != nil {
			return fmt.Errorf("failed to encrypt password for user %s: %w", username, err)
		}
		usersFile.Users = append(usersFile.Users, SMBUserEntry{
			Username:          username,
			EncryptedPassword: encrypted,
		})
	}

	content, err := json.MarshalIndent(usersFile, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal SMB users file: %w", err)
	}

	filePath := sc.GetSMBUsersFilePath()
	if err := os.WriteFile(filePath, content, 0600); err != nil {
		return fmt.Errorf("failed to write SMB users file: %w", err)
	}

	return nil
}

// writeSyncFile writes plaintext sync file for samba container
// This file is used by the samba container to set user passwords
func (sc *SMBCrypto) writeSyncFile(users map[string]string) error {
	var lines string
	for username, password := range users {
		lines += fmt.Sprintf("%s:%s\n", username, password)
	}

	syncPath := sc.GetSMBUsersSyncFilePath()
	return os.WriteFile(syncPath, []byte(lines), 0600)
}

// MigrateFromPlaintext migrates existing plaintext smb_users.txt to encrypted format
func (sc *SMBCrypto) MigrateFromPlaintext() error {
	sc.mu.Lock()
	defer sc.mu.Unlock()

	syncPath := sc.GetSMBUsersSyncFilePath()
	content, err := os.ReadFile(syncPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // Nothing to migrate
		}
		return fmt.Errorf("failed to read plaintext file: %w", err)
	}

	users := make(map[string]string)
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) == 2 {
			users[parts[0]] = parts[1]
		}
	}

	if len(users) == 0 {
		return nil
	}

	return sc.saveUsersInternal(users)
}
