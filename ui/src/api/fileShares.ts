// File Shares API (User-to-User Sharing)

export interface FileShare {
  id: number
  itemPath: string
  itemName: string
  isFolder: boolean
  ownerId: string
  sharedWithId: string
  permissionLevel: number // 1=read-only, 2=read-write
  message?: string
  createdAt: string
  updatedAt: string
  // Populated fields
  ownerUsername?: string
  sharedWithUsername?: string
}

export interface SharedWithMeItem extends FileShare {
  sharedBy: string
}

export interface SharedByMeItem extends FileShare {
  sharedWith: string
}

export interface UserSearchResult {
  id: string
  username: string
  email: string
}

export const PERMISSION_READ_ONLY = 1
export const PERMISSION_READ_WRITE = 2

const API_BASE = '/api'

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

// ========== File Sharing API ==========

/**
 * Create a new file share
 */
export async function createFileShare(data: {
  itemPath: string
  itemName: string
  isFolder: boolean
  sharedWithId: string
  permissionLevel: number
  message?: string
}): Promise<{ id: number }> {
  const response = await fetch(`${API_BASE}/file-shares`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create file share')
  }

  return response.json()
}

/**
 * Get files shared by the current user
 */
export async function getSharedByMe(): Promise<SharedByMeItem[]> {
  const response = await fetch(`${API_BASE}/file-shares/shared-by-me`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch shared files')
  }

  const data = await response.json()
  return data.shares
}

/**
 * Get files shared with the current user
 */
export async function getSharedWithMe(): Promise<SharedWithMeItem[]> {
  const response = await fetch(`${API_BASE}/file-shares/shared-with-me`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch shared files')
  }

  const data = await response.json()
  return data.shares
}

/**
 * Update a file share's permission level
 */
export async function updateFileShare(
  shareId: number,
  data: {
    permissionLevel: number
  }
): Promise<void> {
  const response = await fetch(`${API_BASE}/file-shares/${shareId}`, {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to update file share')
  }
}

/**
 * Delete a file share
 */
export async function deleteFileShare(shareId: number): Promise<void> {
  const response = await fetch(`${API_BASE}/file-shares/${shareId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to delete file share')
  }
}

/**
 * Get sharing info for a specific file
 */
export async function getFileShareInfo(itemPath: string): Promise<FileShare[]> {
  const encodedPath = encodeURIComponent(itemPath)
  const response = await fetch(`${API_BASE}/file-shares/file/${encodedPath}`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch file share info')
  }

  const data = await response.json()
  return data.shares
}

/**
 * Search users by username or email
 */
export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const response = await fetch(`${API_BASE}/users/search?q=${encodeURIComponent(query)}`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to search users')
  }

  const data = await response.json()
  return data.users
}

// ========== Link Sharing API (Public Links) ==========

export interface LinkShare {
  id: string
  token: string
  path: string
  createdBy: string
  createdAt: string
  expiresAt?: string
  hasPassword: boolean
  accessCount: number
  maxAccess?: number
  isActive: boolean
}

/**
 * Create a new share link
 */
export async function createShareLink(data: {
  path: string
  password?: string
  expiresIn?: number // hours, 0 = never
  maxAccess?: number // 0 = unlimited
}): Promise<{ id: string; token: string; url: string }> {
  const response = await fetch(`${API_BASE}/shares`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create share link')
  }

  return response.json()
}

/**
 * Get all share links created by the current user
 */
export async function getMyShareLinks(): Promise<LinkShare[]> {
  const response = await fetch(`${API_BASE}/shares`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch share links')
  }

  const data = await response.json()
  return data.shares
}

/**
 * Delete a share link
 */
export async function deleteShareLink(shareId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/shares/${shareId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to delete share link')
  }
}

/**
 * Access a shared link (for public access page)
 */
export async function accessShareLink(
  token: string,
  password?: string
): Promise<{
  token: string
  path: string
  name: string
  isDir: boolean
  size: number
  expiresAt?: string
  requiresPassword?: boolean
}> {
  const response = await fetch(`${API_BASE}/s/${token}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to access share')
  }

  return response.json()
}

// ========== Helper Functions ==========

/**
 * Get permission label in Korean
 */
export function getPermissionLabel(level: number): string {
  switch (level) {
    case PERMISSION_READ_ONLY:
      return '읽기 전용'
    case PERMISSION_READ_WRITE:
      return '읽기/쓰기'
    default:
      return '없음'
  }
}

/**
 * Check if user has write permission
 */
export function canWrite(permissionLevel: number): boolean {
  return permissionLevel >= PERMISSION_READ_WRITE
}

/**
 * Format date for display
 */
export function formatShareDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) {
    return '오늘'
  } else if (days === 1) {
    return '어제'
  } else if (days < 7) {
    return `${days}일 전`
  } else {
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }
}
