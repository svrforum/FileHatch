package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

// BruteForceConfig holds brute force protection settings
type BruteForceConfig struct {
	Enabled        bool          // 활성화 여부
	MaxAttempts    int           // 사용자별 최대 시도 횟수 (기본: 5)
	WindowDuration time.Duration // 추적 윈도우 (기본: 5분)
	LockDuration   time.Duration // 잠금 시간 (기본: 15분)
	IPMaxAttempts  int           // IP별 최대 시도 (기본: 20)
	IPLockDuration time.Duration // IP 잠금 시간 (기본: 30분)
}

// LocalCacheEntry represents a cached attempt count
type LocalCacheEntry struct {
	Count     int
	ExpiresAt time.Time
}

// BruteForceGuard provides login attempt tracking and lockout
type BruteForceGuard struct {
	redis        *redis.Client
	db           *sql.DB
	config       BruteForceConfig
	localCache   sync.Map // Valkey 장애 시 폴백
	audit        *AuditHandler
	keyPrefix    string
	redisEnabled bool
}

// 싱글톤 인스턴스
var (
	bruteForceGuard     *BruteForceGuard
	bruteForceGuardOnce sync.Once
)

// GetBruteForceGuard returns the singleton instance
func GetBruteForceGuard() *BruteForceGuard {
	return bruteForceGuard
}

// DefaultBruteForceConfig returns the default configuration
func DefaultBruteForceConfig() BruteForceConfig {
	return BruteForceConfig{
		Enabled:        true,
		MaxAttempts:    5,
		WindowDuration: 5 * time.Minute,
		LockDuration:   15 * time.Minute,
		IPMaxAttempts:  20,
		IPLockDuration: 30 * time.Minute,
	}
}

// InitBruteForceGuard initializes the brute force guard
func InitBruteForceGuard(db *sql.DB, auditHandler *AuditHandler) *BruteForceGuard {
	bruteForceGuardOnce.Do(func() {
		// Valkey 연결 설정 (stats_cache.go 패턴 참조)
		redisAddr := os.Getenv("VALKEY_HOST")
		if redisAddr == "" {
			redisAddr = "valkey"
		}
		redisPort := os.Getenv("VALKEY_PORT")
		if redisPort == "" {
			redisPort = "6379"
		}

		client := redis.NewClient(&redis.Options{
			Addr:     fmt.Sprintf("%s:%s", redisAddr, redisPort),
			Password: os.Getenv("VALKEY_PASSWORD"),
			DB:       0,
		})

		// Test connection
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		redisEnabled := true
		if err := client.Ping(ctx).Err(); err != nil {
			LogWarn("BruteForceGuard: Redis connection failed, using local cache only", "error", err)
			redisEnabled = false
		} else {
			LogInfo("BruteForceGuard: Redis connected successfully")
		}

		// DB에서 설정 로드
		config := loadBruteForceConfigFromDB(db)

		bruteForceGuard = &BruteForceGuard{
			redis:        client,
			db:           db,
			audit:        auditHandler,
			keyPrefix:    "fh:bruteforce:",
			config:       config,
			redisEnabled: redisEnabled,
		}

		// Start local cache cleanup goroutine
		go bruteForceGuard.cleanupLocalCache()
	})
	return bruteForceGuard
}

// loadBruteForceConfigFromDB loads configuration from system_settings
func loadBruteForceConfigFromDB(db *sql.DB) BruteForceConfig {
	config := DefaultBruteForceConfig()

	rows, err := db.Query(`
		SELECT key, value FROM system_settings
		WHERE key LIKE 'bruteforce_%'
	`)
	if err != nil {
		LogWarn("Failed to load brute force config from DB, using defaults", "error", err)
		return config
	}
	defer rows.Close()

	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}

		switch key {
		case "bruteforce_enabled":
			config.Enabled = value == "true"
		case "bruteforce_max_attempts":
			if v, err := strconv.Atoi(value); err == nil {
				config.MaxAttempts = v
			}
		case "bruteforce_window_minutes":
			if v, err := strconv.Atoi(value); err == nil {
				config.WindowDuration = time.Duration(v) * time.Minute
			}
		case "bruteforce_lock_minutes":
			if v, err := strconv.Atoi(value); err == nil {
				config.LockDuration = time.Duration(v) * time.Minute
			}
		case "bruteforce_ip_max_attempts":
			if v, err := strconv.Atoi(value); err == nil {
				config.IPMaxAttempts = v
			}
		case "bruteforce_ip_lock_minutes":
			if v, err := strconv.Atoi(value); err == nil {
				config.IPLockDuration = time.Duration(v) * time.Minute
			}
		}
	}

	return config
}

// cleanupLocalCache periodically cleans up expired entries
func (g *BruteForceGuard) cleanupLocalCache() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		g.localCache.Range(func(key, value interface{}) bool {
			if entry, ok := value.(LocalCacheEntry); ok {
				if now.After(entry.ExpiresAt) {
					g.localCache.Delete(key)
				}
			}
			return true
		})
	}
}

// CheckAndRecordAttempt checks if login is allowed and records the attempt
// Returns: (allowed bool, reason string, remainingAttempts int)
func (g *BruteForceGuard) CheckAndRecordAttempt(ctx context.Context, ip, username string) (bool, string, int) {
	if !g.config.Enabled {
		return true, "", g.config.MaxAttempts
	}

	// 1. IP 잠금 확인
	if locked, until := g.isIPLocked(ctx, ip); locked {
		return false, fmt.Sprintf("IP가 %s까지 잠겨 있습니다", until.Format("15:04:05")), 0
	}

	// 2. 사용자 잠금 확인 (DB + Valkey)
	if username != "" {
		if locked, until := g.isUserLocked(ctx, username); locked {
			return false, fmt.Sprintf("계정이 %s까지 잠겨 있습니다", until.Format("15:04:05")), 0
		}
	}

	// 3. IP 시도 횟수 확인
	ipAttempts := g.getAttemptCount(ctx, "ip:"+ip)
	if ipAttempts >= g.config.IPMaxAttempts {
		g.lockIP(ctx, ip)
		g.logLockEvent(nil, ip, "ip", "max_attempts")
		return false, "너무 많은 로그인 시도로 IP가 잠겼습니다", 0
	}

	// 4. 사용자 시도 횟수 확인
	if username != "" {
		userAttempts := g.getAttemptCount(ctx, "user:"+username)
		remaining := g.config.MaxAttempts - userAttempts
		if userAttempts >= g.config.MaxAttempts {
			g.lockUser(ctx, username)
			g.logLockEvent(&username, ip, "user", "max_attempts")
			return false, "로그인 시도 횟수 초과로 계정이 잠겼습니다", 0
		}
		return true, "", remaining
	}

	return true, "", g.config.MaxAttempts - ipAttempts
}

// RecordFailedAttempt records a failed login attempt
func (g *BruteForceGuard) RecordFailedAttempt(ctx context.Context, ip, username string) {
	if !g.config.Enabled {
		return
	}

	// IP 카운터 증가
	g.incrementAttempt(ctx, "ip:"+ip, g.config.WindowDuration)

	// 사용자 카운터 증가 (사용자가 존재하는 경우만)
	if username != "" {
		g.incrementAttempt(ctx, "user:"+username, g.config.WindowDuration)

		// DB에도 기록 (영구 추적)
		_, _ = g.db.ExecContext(ctx, `
			UPDATE users
			SET failed_login_count = COALESCE(failed_login_count, 0) + 1,
			    last_failed_login = NOW()
			WHERE username = $1
		`, username)

		// 잠금 임계값 도달 여부 확인
		count := g.getAttemptCount(ctx, "user:"+username)
		if count >= g.config.MaxAttempts {
			g.lockUser(ctx, username)
			g.logLockEvent(&username, ip, "user", "max_attempts")
		}
	}

	// IP 잠금 임계값 확인
	ipCount := g.getAttemptCount(ctx, "ip:"+ip)
	if ipCount >= g.config.IPMaxAttempts {
		g.lockIP(ctx, ip)
		g.logLockEvent(nil, ip, "ip", "max_attempts")
	}
}

// RecordSuccessfulLogin resets counters on successful login
func (g *BruteForceGuard) RecordSuccessfulLogin(ctx context.Context, ip, username string) {
	if !g.config.Enabled {
		return
	}

	// Valkey 카운터 삭제
	if g.redisEnabled {
		g.redis.Del(ctx, g.keyPrefix+"ip:"+ip)
		g.redis.Del(ctx, g.keyPrefix+"user:"+username)
	}

	// 로컬 캐시에서도 삭제
	g.localCache.Delete("ip:" + ip)
	g.localCache.Delete("user:" + username)

	// DB 카운터 리셋
	_, _ = g.db.ExecContext(ctx, `
		UPDATE users
		SET failed_login_count = 0,
		    last_failed_login = NULL,
		    locked_until = NULL
		WHERE username = $1
	`, username)
}

// isIPLocked checks if an IP is currently locked
func (g *BruteForceGuard) isIPLocked(ctx context.Context, ip string) (bool, time.Time) {
	key := g.keyPrefix + "locked:ip:" + ip

	if g.redisEnabled {
		ttl, err := g.redis.TTL(ctx, key).Result()
		if err == nil && ttl > 0 {
			return true, time.Now().Add(ttl)
		}
	}

	// 로컬 캐시 확인
	if entry, ok := g.localCache.Load("locked:ip:" + ip); ok {
		if e, ok := entry.(LocalCacheEntry); ok && time.Now().Before(e.ExpiresAt) {
			return true, e.ExpiresAt
		}
	}

	return false, time.Time{}
}

// isUserLocked checks if a user is currently locked
func (g *BruteForceGuard) isUserLocked(ctx context.Context, username string) (bool, time.Time) {
	// DB에서 먼저 확인 (영구 저장)
	var lockedUntil sql.NullTime
	err := g.db.QueryRowContext(ctx, `
		SELECT locked_until FROM users
		WHERE username = $1 AND locked_until IS NOT NULL AND locked_until > NOW()
	`, username).Scan(&lockedUntil)
	if err == nil && lockedUntil.Valid {
		return true, lockedUntil.Time
	}

	// Valkey에서 확인
	key := g.keyPrefix + "locked:user:" + username
	if g.redisEnabled {
		ttl, err := g.redis.TTL(ctx, key).Result()
		if err == nil && ttl > 0 {
			return true, time.Now().Add(ttl)
		}
	}

	// 로컬 캐시 확인
	if entry, ok := g.localCache.Load("locked:user:" + username); ok {
		if e, ok := entry.(LocalCacheEntry); ok && time.Now().Before(e.ExpiresAt) {
			return true, e.ExpiresAt
		}
	}

	return false, time.Time{}
}

// lockIP locks an IP address
func (g *BruteForceGuard) lockIP(ctx context.Context, ip string) {
	key := g.keyPrefix + "locked:ip:" + ip
	expiry := g.config.IPLockDuration

	if g.redisEnabled {
		g.redis.Set(ctx, key, "1", expiry)
	}

	// 로컬 캐시에도 저장
	g.localCache.Store("locked:ip:"+ip, LocalCacheEntry{
		Count:     1,
		ExpiresAt: time.Now().Add(expiry),
	})
}

// lockUser locks a user account
func (g *BruteForceGuard) lockUser(ctx context.Context, username string) {
	key := g.keyPrefix + "locked:user:" + username
	expiry := g.config.LockDuration
	lockedUntil := time.Now().Add(expiry)

	// DB에 영구 기록
	_, _ = g.db.ExecContext(ctx, `
		UPDATE users
		SET locked_until = $1
		WHERE username = $2
	`, lockedUntil, username)

	// Valkey에도 저장
	if g.redisEnabled {
		g.redis.Set(ctx, key, "1", expiry)
	}

	// 로컬 캐시에도 저장
	g.localCache.Store("locked:user:"+username, LocalCacheEntry{
		Count:     1,
		ExpiresAt: lockedUntil,
	})
}

// getAttemptCount gets the current attempt count for a key
func (g *BruteForceGuard) getAttemptCount(ctx context.Context, keySuffix string) int {
	key := g.keyPrefix + keySuffix

	if g.redisEnabled {
		count, err := g.redis.Get(ctx, key).Int()
		if err == nil {
			return count
		}
	}

	// 로컬 캐시에서 확인
	if entry, ok := g.localCache.Load(keySuffix); ok {
		if e, ok := entry.(LocalCacheEntry); ok && time.Now().Before(e.ExpiresAt) {
			return e.Count
		}
	}

	return 0
}

// incrementAttempt increments the attempt counter
func (g *BruteForceGuard) incrementAttempt(ctx context.Context, keySuffix string, ttl time.Duration) {
	key := g.keyPrefix + keySuffix

	if g.redisEnabled {
		pipe := g.redis.Pipeline()
		pipe.Incr(ctx, key)
		pipe.Expire(ctx, key, ttl)
		_, _ = pipe.Exec(ctx)
	}

	// 로컬 캐시 업데이트
	count := 1
	if entry, ok := g.localCache.Load(keySuffix); ok {
		if e, ok := entry.(LocalCacheEntry); ok && time.Now().Before(e.ExpiresAt) {
			count = e.Count + 1
		}
	}
	g.localCache.Store(keySuffix, LocalCacheEntry{
		Count:     count,
		ExpiresAt: time.Now().Add(ttl),
	})
}

// logLockEvent logs a lock event to audit log
func (g *BruteForceGuard) logLockEvent(username *string, ip, lockType, reason string) {
	if g.audit == nil {
		return
	}

	var userID *string
	target := ip
	eventType := EventIPLocked

	if lockType == "user" && username != nil {
		eventType = EventAccountLocked
		target = *username

		// 사용자 ID 조회
		var id string
		err := g.db.QueryRow(`SELECT id FROM users WHERE username = $1`, *username).Scan(&id)
		if err == nil {
			userID = &id
		}
	}

	g.audit.LogEvent(userID, ip, eventType, target, map[string]interface{}{
		"lockType": lockType,
		"reason":   reason,
		"duration": g.config.LockDuration.String(),
	})
}

// AdminUnlockUser allows admin to manually unlock a user
func (g *BruteForceGuard) AdminUnlockUser(ctx context.Context, username string) error {
	// Valkey 잠금 해제
	if g.redisEnabled {
		g.redis.Del(ctx, g.keyPrefix+"locked:user:"+username)
		g.redis.Del(ctx, g.keyPrefix+"user:"+username)
	}

	// 로컬 캐시에서도 삭제
	g.localCache.Delete("locked:user:" + username)
	g.localCache.Delete("user:" + username)

	// DB 잠금 해제
	_, err := g.db.ExecContext(ctx, `
		UPDATE users
		SET locked_until = NULL,
		    failed_login_count = 0
		WHERE username = $1
	`, username)

	return err
}

// AdminUnlockIP allows admin to manually unlock an IP
func (g *BruteForceGuard) AdminUnlockIP(ctx context.Context, ip string) error {
	if g.redisEnabled {
		g.redis.Del(ctx, g.keyPrefix+"locked:ip:"+ip)
		g.redis.Del(ctx, g.keyPrefix+"ip:"+ip)
	}

	// 로컬 캐시에서도 삭제
	g.localCache.Delete("locked:ip:" + ip)
	g.localCache.Delete("ip:" + ip)

	return nil
}

// LockedUserInfo represents a locked user's information
type LockedUserInfo struct {
	Username       string     `json:"username"`
	LockedUntil    time.Time  `json:"lockedUntil"`
	FailedCount    int        `json:"failedCount"`
	LastFailedAt   *time.Time `json:"lastFailedAt,omitempty"`
	RemainingTime  string     `json:"remainingTime"`
}

// GetLockedUsers returns list of currently locked users (admin only)
func (g *BruteForceGuard) GetLockedUsers(c echo.Context) error {
	ctx := c.Request().Context()

	rows, err := g.db.QueryContext(ctx, `
		SELECT username, locked_until, failed_login_count, last_failed_login
		FROM users
		WHERE locked_until IS NOT NULL AND locked_until > NOW()
		ORDER BY locked_until DESC
	`)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to query locked users"))
	}
	defer rows.Close()

	var lockedUsers []LockedUserInfo
	now := time.Now()

	for rows.Next() {
		var username string
		var lockedUntil time.Time
		var failedCount int
		var lastFailed sql.NullTime

		if err := rows.Scan(&username, &lockedUntil, &failedCount, &lastFailed); err != nil {
			continue
		}

		remaining := lockedUntil.Sub(now)
		info := LockedUserInfo{
			Username:      username,
			LockedUntil:   lockedUntil,
			FailedCount:   failedCount,
			RemainingTime: formatLockDuration(remaining),
		}
		if lastFailed.Valid {
			info.LastFailedAt = &lastFailed.Time
		}

		lockedUsers = append(lockedUsers, info)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"lockedUsers": lockedUsers,
		"total":       len(lockedUsers),
	})
}

// UnlockUser unlocks a specific user (admin only)
func (g *BruteForceGuard) UnlockUser(c echo.Context) error {
	username := c.Param("username")
	if username == "" {
		return RespondError(c, ErrMissingParameter("username"))
	}

	ctx := c.Request().Context()
	if err := g.AdminUnlockUser(ctx, username); err != nil {
		return RespondError(c, ErrInternal("Failed to unlock user"))
	}

	// 감사 로그
	if claims, ok := c.Get("user").(*JWTClaims); ok {
		g.audit.LogEvent(&claims.UserID, c.RealIP(), EventAccountUnlocked, username, map[string]interface{}{
			"unlockedBy": claims.Username,
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": fmt.Sprintf("사용자 %s의 잠금이 해제되었습니다", username),
	})
}

// BruteForceStats represents brute force protection statistics
type BruteForceStats struct {
	TrackedIPs   int64                  `json:"trackedIPs"`
	TrackedUsers int64                  `json:"trackedUsers"`
	LockedUsers  int                    `json:"lockedUsers"`
	Config       map[string]interface{} `json:"config"`
}

// GetStats returns brute force protection statistics (admin only)
func (g *BruteForceGuard) GetStats(c echo.Context) error {
	ctx := c.Request().Context()

	// Valkey에서 현재 추적 중인 키 수 조회
	var ipCount, userCount int64

	if g.redisEnabled {
		ipIter := g.redis.Scan(ctx, 0, g.keyPrefix+"ip:*", 1000).Iterator()
		for ipIter.Next(ctx) {
			ipCount++
		}

		userIter := g.redis.Scan(ctx, 0, g.keyPrefix+"user:*", 1000).Iterator()
		for userIter.Next(ctx) {
			userCount++
		}
	}

	// DB에서 잠긴 사용자 수
	var dbLockedCount int
	_ = g.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM users
		WHERE locked_until IS NOT NULL AND locked_until > NOW()
	`).Scan(&dbLockedCount)

	return c.JSON(http.StatusOK, BruteForceStats{
		TrackedIPs:   ipCount,
		TrackedUsers: userCount,
		LockedUsers:  dbLockedCount,
		Config: map[string]interface{}{
			"enabled":          g.config.Enabled,
			"maxAttempts":      g.config.MaxAttempts,
			"windowMinutes":    g.config.WindowDuration.Minutes(),
			"lockMinutes":      g.config.LockDuration.Minutes(),
			"ipMaxAttempts":    g.config.IPMaxAttempts,
			"ipLockMinutes":    g.config.IPLockDuration.Minutes(),
		},
	})
}

// formatLockDuration formats a duration as a human-readable string for brute force locks
func formatLockDuration(d time.Duration) string {
	if d < 0 {
		return "0s"
	}
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm %ds", int(d.Minutes()), int(d.Seconds())%60)
	}
	return fmt.Sprintf("%dh %dm", int(d.Hours()), int(d.Minutes())%60)
}

// ReloadConfig reloads the configuration from the database
func (g *BruteForceGuard) ReloadConfig() {
	g.config = loadBruteForceConfigFromDB(g.db)
	LogInfo("BruteForceGuard: Configuration reloaded", "config", g.config)
}
