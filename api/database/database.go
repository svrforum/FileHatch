package database

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
	"github.com/svrforum/FileHatch/api/appconfig"
	"golang.org/x/crypto/bcrypt"
)

const knownDefaultAdminHash = "$2a$10$mRaibXXeo0eBpeg3gDgequkcQynn8GuvLflrbR9pRYAVDO/nf5pqW"

func Connect() (*sql.DB, error) {
	dbConfig, err := loadConnectionConfig()
	if err != nil {
		return nil, err
	}

	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		dbConfig.host,
		dbConfig.port,
		dbConfig.user,
		dbConfig.password,
		dbConfig.name,
	)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Connection pool settings
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(3 * time.Minute)

	// Verify connection
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return db, nil
}

// SecureInitialAdmin은 HTTP 서버 시작 전에 공개된 migration 비밀번호를 교체한다.
// 아직 초기 설정을 완료하지 않은 기본 계정만 변경한다.
func SecureInitialAdmin(db *sql.DB) error {
	if !appconfig.IsProduction() {
		return nil
	}

	password := os.Getenv("INITIAL_ADMIN_PASSWORD")
	if len([]byte(password)) < 12 {
		return fmt.Errorf("INITIAL_ADMIN_PASSWORD must be at least 12 bytes in production")
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash initial admin password: %w", err)
	}

	_, err = db.Exec(
		`UPDATE users
		 SET password_hash = $1
		 WHERE username = 'admin'
		   AND setup_completed = FALSE
		   AND password_hash = $2`,
		string(passwordHash),
		knownDefaultAdminHash,
	)
	if err != nil {
		return fmt.Errorf("secure initial admin password: %w", err)
	}
	return nil
}

type connectionConfig struct {
	host     string
	port     string
	user     string
	password string
	name     string
}

func loadConnectionConfig() (connectionConfig, error) {
	if appconfig.IsProduction() {
		missing := []string{}
		for _, name := range []string{"DB_HOST", "DB_PORT", "DB_USER", "DB_PASS", "DB_NAME"} {
			if strings.TrimSpace(os.Getenv(name)) == "" {
				missing = append(missing, name)
			}
		}
		if len(missing) > 0 {
			return connectionConfig{}, fmt.Errorf(
				"production database configuration is missing: %s",
				strings.Join(missing, ", "),
			)
		}
	}

	return connectionConfig{
		host:     getEnv("DB_HOST", "localhost"),
		port:     getEnv("DB_PORT", "5432"),
		user:     getEnv("DB_USER", "fh_user"),
		password: getEnv("DB_PASS", "fh_password"),
		name:     getEnv("DB_NAME", "fh_main"),
	}, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
