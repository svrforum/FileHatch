// Shared Folders API

export interface SharedFolder {
  id: string
  name: string
  description: string
  storageQuota: number // 0 = unlimited
  createdBy: string
  createdAt: string
  updatedAt: string
  isActive: boolean
  creatorUsername?: string
  usedStorage?: number
  memberCount?: number
}

export interface SharedFolderWithPermission extends SharedFolder {
  permissionLevel: number // 1=read-only, 2=read-write
}

export interface SharedFolderMember {
  id: number
  sharedFolderId: string
  userId: string
  permissionLevel: number
  addedBy: string
  createdAt: string
  username?: string
  addedByUsername?: string
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

// ========== User API ==========

/**
 * Get shared folders the current user has access to
 */
export async function getMySharedFolders(): Promise<SharedFolderWithPermission[]> {
  const response = await fetch(`${API_BASE}/shared-folders`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch shared folders')
  }

  const data = await response.json()
  return data.folders
}

/**
 * Get current user's permission level for a shared folder
 */
export async function getMyPermission(folderId: string): Promise<{ permissionLevel: number; canWrite: boolean }> {
  const response = await fetch(`${API_BASE}/shared-folders/${folderId}/permission`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    if (response.status === 403) {
      return { permissionLevel: 0, canWrite: false }
    }
    throw new Error('Failed to fetch permission')
  }

  return response.json()
}

// ========== Admin API ==========

/**
 * Get all shared folders (admin only)
 */
export async function getAllSharedFolders(): Promise<SharedFolder[]> {
  const response = await fetch(`${API_BASE}/admin/shared-folders`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch shared folders')
  }

  const data = await response.json()
  return data.folders
}

/**
 * Create a new shared folder (admin only)
 */
export async function createSharedFolder(data: {
  name: string
  description?: string
  storageQuota?: number
}): Promise<{ id: string }> {
  const response = await fetch(`${API_BASE}/admin/shared-folders`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create shared folder')
  }

  return response.json()
}

/**
 * Update a shared folder (admin only)
 */
export async function updateSharedFolder(
  folderId: string,
  data: {
    name: string
    description?: string
    storageQuota?: number
    isActive?: boolean
  }
): Promise<void> {
  const response = await fetch(`${API_BASE}/admin/shared-folders/${folderId}`, {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to update shared folder')
  }
}

/**
 * Delete a shared folder (admin only)
 */
export async function deleteSharedFolder(folderId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/admin/shared-folders/${folderId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to delete shared folder')
  }
}

// ========== Member Management (Admin) ==========

/**
 * Get members of a shared folder (admin only)
 */
export async function getSharedFolderMembers(folderId: string): Promise<SharedFolderMember[]> {
  const response = await fetch(`${API_BASE}/admin/shared-folders/${folderId}/members`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch members')
  }

  const data = await response.json()
  return data.members
}

/**
 * Add a member to a shared folder (admin only)
 */
export async function addSharedFolderMember(
  folderId: string,
  userId: string,
  permissionLevel: number
): Promise<void> {
  const response = await fetch(`${API_BASE}/admin/shared-folders/${folderId}/members`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, permissionLevel }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to add member')
  }
}

/**
 * Update a member's permission level (admin only)
 */
export async function updateMemberPermission(
  folderId: string,
  userId: string,
  permissionLevel: number
): Promise<void> {
  const response = await fetch(`${API_BASE}/admin/shared-folders/${folderId}/members/${userId}`, {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ permissionLevel }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to update permission')
  }
}

/**
 * Remove a member from a shared folder (admin only)
 */
export async function removeSharedFolderMember(folderId: string, userId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/admin/shared-folders/${folderId}/members/${userId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to remove member')
  }
}

// ========== Helper Functions ==========

/**
 * Format storage size for display
 */
export function formatStorageSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * Get permission label
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
 * Get permission badge class
 */
export function getPermissionBadgeClass(level: number): string {
  switch (level) {
    case PERMISSION_READ_ONLY:
      return 'permission-readonly'
    case PERMISSION_READ_WRITE:
      return 'permission-readwrite'
    default:
      return 'permission-none'
  }
}
