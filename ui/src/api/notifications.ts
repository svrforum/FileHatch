const API_BASE = '/api'

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

// Helper to get auth headers
function getAuthHeaders(): HeadersInit {
  const stored = localStorage.getItem('scv-auth')
  if (stored) {
    try {
      const { state } = JSON.parse(stored)
      if (state?.token) {
        return { 'Authorization': `Bearer ${state.token}` }
      }
    } catch {
      // Ignore parse errors
    }
  }
  return {}
}

// Get notifications list
export async function getNotifications(limit = 50, offset = 0): Promise<NotificationListResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset)
  })
  const response = await fetch(`${API_BASE}/notifications?${params}`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch notifications')
  }

  return response.json()
}

// Get unread notification count
export async function getUnreadCount(): Promise<number> {
  const response = await fetch(`${API_BASE}/notifications/unread-count`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch unread count')
  }

  const data: UnreadCountResponse = await response.json()
  return data.unreadCount
}

// Mark a notification as read
export async function markAsRead(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/notifications/${id}/read`, {
    method: 'PUT',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to mark notification as read')
  }
}

// Mark all notifications as read
export async function markAllAsRead(): Promise<void> {
  const response = await fetch(`${API_BASE}/notifications/read-all`, {
    method: 'PUT',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to mark all as read')
  }
}

// Delete a notification
export async function deleteNotification(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/notifications/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to delete notification')
  }
}

// Delete all read notifications
export async function deleteAllRead(): Promise<void> {
  const response = await fetch(`${API_BASE}/notifications`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to delete read notifications')
  }
}
