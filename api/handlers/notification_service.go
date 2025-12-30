package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"time"
)

// NotificationType constants
const (
	NotifShareReceived         = "share.received"
	NotifSharePermissionChanged = "share.permission_changed"
	NotifShareRemoved          = "share.removed"
	NotifSharedFolderInvited   = "shared_folder.invited"
	NotifSharedFolderRemoved   = "shared_folder.removed"
	NotifSharedFileModified    = "shared_file.modified"
	NotifShareLinkAccessed     = "share_link.accessed"
	NotifUploadLinkReceived    = "upload_link.received"
)

// Notification represents a notification record
type Notification struct {
	ID        int64                  `json:"id"`
	UserID    string                 `json:"userId"`
	Type      string                 `json:"type"`
	Title     string                 `json:"title"`
	Message   string                 `json:"message,omitempty"`
	Link      string                 `json:"link,omitempty"`
	ActorID   *string                `json:"actorId,omitempty"`
	ActorName *string                `json:"actorName,omitempty"`
	IsRead    bool                   `json:"isRead"`
	CreatedAt time.Time              `json:"createdAt"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// NotificationService handles notification creation and broadcasting
type NotificationService struct {
	db *sql.DB
}

// NewNotificationService creates a new NotificationService
func NewNotificationService(db *sql.DB) *NotificationService {
	return &NotificationService{db: db}
}

// Create creates a new notification and broadcasts it via WebSocket
func (s *NotificationService) Create(userID, notifType, title, message, link string, actorID *string, metadata map[string]interface{}) (*Notification, error) {
	var metadataJSON []byte
	var err error
	if metadata != nil {
		metadataJSON, err = json.Marshal(metadata)
		if err != nil {
			metadataJSON = []byte("{}")
		}
	}

	var id int64
	var createdAt time.Time
	err = s.db.QueryRow(`
		INSERT INTO notifications (user_id, type, title, message, link, actor_id, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at
	`, userID, notifType, title, message, link, actorID, metadataJSON).Scan(&id, &createdAt)

	if err != nil {
		log.Printf("[Notification] Failed to create notification: %v", err)
		return nil, err
	}

	// Get actor name if actorID is provided
	var actorName *string
	if actorID != nil {
		var name string
		if err := s.db.QueryRow("SELECT username FROM users WHERE id = $1", *actorID).Scan(&name); err == nil {
			actorName = &name
		}
	}

	notif := &Notification{
		ID:        id,
		UserID:    userID,
		Type:      notifType,
		Title:     title,
		Message:   message,
		Link:      link,
		ActorID:   actorID,
		ActorName: actorName,
		IsRead:    false,
		CreatedAt: createdAt,
		Metadata:  metadata,
	}

	// Broadcast to user via WebSocket
	BroadcastNotification(userID, notif)

	return notif, nil
}

// CreateBulk creates notifications for multiple users
func (s *NotificationService) CreateBulk(userIDs []string, notifType, title, message, link string, actorID *string, metadata map[string]interface{}) error {
	for _, userID := range userIDs {
		if _, err := s.Create(userID, notifType, title, message, link, actorID, metadata); err != nil {
			log.Printf("[Notification] Failed to create notification for user %s: %v", userID, err)
		}
	}
	return nil
}

// GetUnreadCount returns the count of unread notifications for a user
func (s *NotificationService) GetUnreadCount(userID string) (int, error) {
	var count int
	err := s.db.QueryRow(`
		SELECT COUNT(*) FROM notifications
		WHERE user_id = $1 AND is_read = FALSE
	`, userID).Scan(&count)
	return count, err
}

// List returns notifications for a user with pagination
func (s *NotificationService) List(userID string, limit, offset int) ([]Notification, int, error) {
	// Clean up old notifications (30 days)
	s.db.Exec(`DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '30 days'`)

	rows, err := s.db.Query(`
		SELECT n.id, n.user_id, n.type, n.title, n.message, n.link,
		       n.actor_id, u.username, n.is_read, n.created_at, n.metadata
		FROM notifications n
		LEFT JOIN users u ON n.actor_id = u.id
		WHERE n.user_id = $1
		ORDER BY n.created_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var notifications []Notification
	for rows.Next() {
		var n Notification
		var message, link sql.NullString
		var actorID, actorName sql.NullString
		var metadata []byte

		err := rows.Scan(&n.ID, &n.UserID, &n.Type, &n.Title, &message, &link,
			&actorID, &actorName, &n.IsRead, &n.CreatedAt, &metadata)
		if err != nil {
			continue
		}

		if message.Valid {
			n.Message = message.String
		}
		if link.Valid {
			n.Link = link.String
		}
		if actorID.Valid {
			n.ActorID = &actorID.String
		}
		if actorName.Valid {
			n.ActorName = &actorName.String
		}
		if metadata != nil {
			json.Unmarshal(metadata, &n.Metadata)
		}

		notifications = append(notifications, n)
	}

	// Get total count
	var total int
	s.db.QueryRow(`SELECT COUNT(*) FROM notifications WHERE user_id = $1`, userID).Scan(&total)

	return notifications, total, nil
}

// MarkAsRead marks a notification as read
func (s *NotificationService) MarkAsRead(userID string, notifID int64) error {
	_, err := s.db.Exec(`
		UPDATE notifications SET is_read = TRUE
		WHERE id = $1 AND user_id = $2
	`, notifID, userID)
	return err
}

// MarkAllAsRead marks all notifications as read for a user
func (s *NotificationService) MarkAllAsRead(userID string) error {
	_, err := s.db.Exec(`
		UPDATE notifications SET is_read = TRUE
		WHERE user_id = $1 AND is_read = FALSE
	`, userID)
	return err
}

// Delete deletes a notification
func (s *NotificationService) Delete(userID string, notifID int64) error {
	_, err := s.db.Exec(`
		DELETE FROM notifications
		WHERE id = $1 AND user_id = $2
	`, notifID, userID)
	return err
}

// DeleteAllRead deletes all read notifications for a user
func (s *NotificationService) DeleteAllRead(userID string) error {
	_, err := s.db.Exec(`
		DELETE FROM notifications
		WHERE user_id = $1 AND is_read = TRUE
	`, userID)
	return err
}
