package handlers

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"
)

// NotificationHandler handles notification API requests
type NotificationHandler struct {
	service *NotificationService
}

// NewNotificationHandler creates a new NotificationHandler
func NewNotificationHandler(service *NotificationService) *NotificationHandler {
	return &NotificationHandler{service: service}
}

// List returns notifications for the current user
func (h *NotificationHandler) List(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	limit := 50
	offset := 0

	if l, err := strconv.Atoi(c.QueryParam("limit")); err == nil && l > 0 && l <= 100 {
		limit = l
	}
	if o, err := strconv.Atoi(c.QueryParam("offset")); err == nil && o >= 0 {
		offset = o
	}

	notifications, total, err := h.service.List(claims.UserID, limit, offset)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get notifications"})
	}

	if notifications == nil {
		notifications = []Notification{}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"notifications": notifications,
		"total":         total,
		"limit":         limit,
		"offset":        offset,
	})
}

// GetUnreadCount returns the count of unread notifications
func (h *NotificationHandler) GetUnreadCount(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	count, err := h.service.GetUnreadCount(claims.UserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get unread count"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"unreadCount": count,
	})
}

// MarkAsRead marks a notification as read
func (h *NotificationHandler) MarkAsRead(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid notification ID"})
	}

	if err := h.service.MarkAsRead(claims.UserID, id); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to mark as read"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}

// MarkAllAsRead marks all notifications as read
func (h *NotificationHandler) MarkAllAsRead(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	if err := h.service.MarkAllAsRead(claims.UserID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to mark all as read"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}

// Delete deletes a notification
func (h *NotificationHandler) Delete(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid notification ID"})
	}

	if err := h.service.Delete(claims.UserID, id); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete notification"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}

// DeleteAllRead deletes all read notifications
func (h *NotificationHandler) DeleteAllRead(c echo.Context) error {
	claims, ok := c.Get("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	if err := h.service.DeleteAllRead(claims.UserID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete notifications"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}
