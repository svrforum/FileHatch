package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"time"
)

// Notification type for share link expiration
const (
	NotifShareLinkExpiring = "share_link.expiring"
)

// ShareExpirationChecker checks for expiring share links and notifies owners
type ShareExpirationChecker struct {
	db                  *sql.DB
	notificationService *NotificationService
}

// NewShareExpirationChecker creates a new ShareExpirationChecker
func NewShareExpirationChecker(db *sql.DB, notificationService *NotificationService) *ShareExpirationChecker {
	return &ShareExpirationChecker{
		db:                  db,
		notificationService: notificationService,
	}
}

// StartBackgroundCheck starts the background expiration check routine
// Checks every hour for shares expiring within the next 24 hours
func (c *ShareExpirationChecker) StartBackgroundCheck(checkInterval time.Duration) {
	go func() {
		// Initial check on startup
		c.checkExpiringShares()

		ticker := time.NewTicker(checkInterval)
		defer ticker.Stop()

		for range ticker.C {
			c.checkExpiringShares()
		}
	}()
	log.Printf("[ShareExpiration] Background checker started (interval: %v)", checkInterval)
}

// checkExpiringShares finds shares expiring soon and notifies their owners
func (c *ShareExpirationChecker) checkExpiringShares() {
	// Find shares expiring in the next 24 hours that haven't been notified yet
	rows, err := c.db.Query(`
		SELECT s.id, s.token, s.path, s.created_by, s.expires_at, u.username
		FROM shares s
		JOIN users u ON s.created_by = u.id
		WHERE s.expires_at IS NOT NULL
		  AND s.expires_at > NOW()
		  AND s.expires_at <= NOW() + INTERVAL '24 hours'
		  AND s.is_active = TRUE
		  AND (s.expiration_notified IS NULL OR s.expiration_notified = FALSE)
	`)
	if err != nil {
		log.Printf("[ShareExpiration] Failed to query expiring shares: %v", err)
		return
	}
	defer rows.Close()

	var notifiedCount int
	for rows.Next() {
		var shareID, token, path, createdBy, username string
		var expiresAt time.Time

		if err := rows.Scan(&shareID, &token, &path, &createdBy, &expiresAt, &username); err != nil {
			log.Printf("[ShareExpiration] Failed to scan row: %v", err)
			continue
		}

		// Calculate time until expiration
		timeUntil := time.Until(expiresAt)
		hoursUntil := int(timeUntil.Hours())

		// Create notification
		title := "공유 링크가 곧 만료됩니다"
		var message string
		if hoursUntil <= 1 {
			message = "공유 링크가 1시간 이내에 만료됩니다: " + getFileName(path)
		} else {
			message = "공유 링크가 약 " + formatExpirationDuration(hoursUntil) + " 후에 만료됩니다: " + getFileName(path)
		}

		// Create link to link shares view
		link := "/link-shares"

		metadata := map[string]interface{}{
			"shareId":   shareID,
			"path":      path,
			"expiresAt": expiresAt.Format(time.RFC3339),
		}

		_, err := c.notificationService.Create(
			createdBy,
			NotifShareLinkExpiring,
			title,
			message,
			link,
			nil,
			metadata,
		)

		if err != nil {
			log.Printf("[ShareExpiration] Failed to create notification for share %s: %v", shareID, err)
			continue
		}

		// Mark as notified
		_, err = c.db.Exec(`
			UPDATE shares
			SET expiration_notified = TRUE, expiration_notified_at = NOW()
			WHERE id = $1
		`, shareID)

		if err != nil {
			log.Printf("[ShareExpiration] Failed to mark share %s as notified: %v", shareID, err)
		}

		notifiedCount++
		log.Printf("[ShareExpiration] Notified user %s about expiring share %s", username, shareID)
	}

	if notifiedCount > 0 {
		log.Printf("[ShareExpiration] Sent %d expiration notifications", notifiedCount)
	}
}

// getFileName extracts filename from path
func getFileName(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[i+1:]
		}
	}
	return path
}

// formatExpirationDuration formats hours into a readable string
func formatExpirationDuration(hours int) string {
	if hours < 1 {
		return "1시간 미만"
	} else if hours < 24 {
		return fmt.Sprintf("%d시간", hours)
	}
	days := hours / 24
	if days == 1 {
		return "1일"
	}
	return fmt.Sprintf("%d일", days)
}
