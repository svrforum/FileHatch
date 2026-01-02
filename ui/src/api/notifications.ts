/**
 * Notifications API
 */
import { api, apiUrl } from './client'

export interface Notification {
  id: number
  userId: string
  type: string
  title: string
  message?: string
  link?: string
  actorId?: string
  actorName?: string
  isRead: boolean
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface NotificationListResponse {
  notifications: Notification[]
  total: number
  limit: number
  offset: number
}

export interface UnreadCountResponse {
  unreadCount: number
}

/**
 * Get notifications list
 */
export async function getNotifications(
  limit = 50,
  offset = 0
): Promise<NotificationListResponse> {
  const url = apiUrl.withParams('/notifications', { limit, offset })
  const response = await api.get<{ data: NotificationListResponse }>(url)
  return response.data
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(): Promise<number> {
  const response = await api.get<{ data: UnreadCountResponse }>('/notifications/unread-count')
  return response.data.unreadCount
}

/**
 * Mark a notification as read
 */
export async function markAsRead(id: number): Promise<void> {
  await api.put(`/notifications/${id}/read`)
}

/**
 * Mark all notifications as read
 */
export async function markAllAsRead(): Promise<void> {
  await api.put('/notifications/read-all')
}

/**
 * Delete a notification
 */
export async function deleteNotification(id: number): Promise<void> {
  await api.delete(`/notifications/${id}`)
}

/**
 * Delete all read notifications
 */
export async function deleteAllRead(): Promise<void> {
  await api.delete('/notifications')
}
