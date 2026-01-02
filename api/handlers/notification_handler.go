package handlers

import (
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
// @Summary		List notifications
// @Description	Get paginated list of notifications for the current user
// @Tags		Notifications
// @Accept		json
// @Produce		json
// @Param		limit	query		int		false	"Maximum number of notifications to return (default 50, max 100)"
// @Param		offset	query		int		false	"Offset for pagination (default 0)"
// @Success		200		{object}	docs.SuccessResponse{data=docs.NotificationListResponse}	"List of notifications"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/notifications [get]
func (h *NotificationHandler) List(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
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
		return RespondError(c, ErrInternal("Failed to get notifications"))
	}

	if notifications == nil {
		notifications = []Notification{}
	}

	return RespondSuccess(c, map[string]interface{}{
		"notifications": notifications,
		"total":         total,
		"limit":         limit,
		"offset":        offset,
	})
}

// GetUnreadCount returns the count of unread notifications
// @Summary		Get unread notification count
// @Description	Get the number of unread notifications for the current user
// @Tags		Notifications
// @Accept		json
// @Produce		json
// @Success		200		{object}	docs.SuccessResponse{data=docs.UnreadCountResponse}	"Unread count"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/notifications/unread-count [get]
func (h *NotificationHandler) GetUnreadCount(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	count, err := h.service.GetUnreadCount(claims.UserID)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to get unread count"))
	}

	return RespondSuccess(c, map[string]interface{}{
		"unreadCount": count,
	})
}

// MarkAsRead marks a notification as read
// @Summary		Mark notification as read
// @Description	Mark a specific notification as read
// @Tags		Notifications
// @Accept		json
// @Produce		json
// @Param		id		path		int		true	"Notification ID"
// @Success		200		{object}	docs.SuccessResponse	"Notification marked as read"
// @Failure		400		{object}	docs.ErrorResponse	"Invalid notification ID"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/notifications/{id}/read [put]
func (h *NotificationHandler) MarkAsRead(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return RespondError(c, ErrBadRequest("Invalid notification ID"))
	}

	if err := h.service.MarkAsRead(claims.UserID, id); err != nil {
		return RespondError(c, ErrInternal("Failed to mark as read"))
	}

	return RespondSuccess(c, map[string]interface{}{"success": true})
}

// MarkAllAsRead marks all notifications as read
// @Summary		Mark all notifications as read
// @Description	Mark all notifications as read for the current user
// @Tags		Notifications
// @Accept		json
// @Produce		json
// @Success		200		{object}	docs.SuccessResponse	"All notifications marked as read"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/notifications/read-all [put]
func (h *NotificationHandler) MarkAllAsRead(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	if err := h.service.MarkAllAsRead(claims.UserID); err != nil {
		return RespondError(c, ErrInternal("Failed to mark all as read"))
	}

	return RespondSuccess(c, map[string]interface{}{"success": true})
}

// Delete deletes a notification
// @Summary		Delete notification
// @Description	Delete a specific notification
// @Tags		Notifications
// @Accept		json
// @Produce		json
// @Param		id		path		int		true	"Notification ID"
// @Success		200		{object}	docs.SuccessResponse	"Notification deleted"
// @Failure		400		{object}	docs.ErrorResponse	"Invalid notification ID"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/notifications/{id} [delete]
func (h *NotificationHandler) Delete(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return RespondError(c, ErrBadRequest("Invalid notification ID"))
	}

	if err := h.service.Delete(claims.UserID, id); err != nil {
		return RespondError(c, ErrInternal("Failed to delete notification"))
	}

	return RespondSuccess(c, map[string]interface{}{"success": true})
}

// DeleteAllRead deletes all read notifications
// @Summary		Delete all read notifications
// @Description	Delete all read notifications for the current user
// @Tags		Notifications
// @Accept		json
// @Produce		json
// @Success		200		{object}	docs.SuccessResponse	"Read notifications deleted"
// @Failure		401		{object}	docs.ErrorResponse	"Unauthorized"
// @Failure		500		{object}	docs.ErrorResponse	"Internal server error"
// @Security	BearerAuth
// @Router		/notifications/read [delete]
func (h *NotificationHandler) DeleteAllRead(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	if err := h.service.DeleteAllRead(claims.UserID); err != nil {
		return RespondError(c, ErrInternal("Failed to delete notifications"))
	}

	return RespondSuccess(c, map[string]interface{}{"success": true})
}
