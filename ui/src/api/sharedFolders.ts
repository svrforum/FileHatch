/**
 * Shared Folders API
 */
import { api } from './client'

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

// ========== User API ==========

/**
 * Get shared folders the current user has access to
 */
export async function getMySharedFolders(): Promise<SharedFolderWithPermission[]> {
  const response = await api.get<{ data: { folders: SharedFolderWithPermission[] } }>('/shared-folders')
  return response.data?.folders || []
}

/**
 * Get current user's permission level for a shared folder
 */
export async function getMyPermission(
  folderId: string
): Promise<{ permissionLevel: number; canWrite: boolean }> {
  try {
    return await api.get<{ permissionLevel: number; canWrite: boolean }>(
      `/shared-folders/${folderId}/permission`
    )
  } catch (error) {
    // Return no permission if forbidden
    if (error instanceof Error && 'status' in error && (error as { status: number }).status === 403) {
      return { permissionLevel: 0, canWrite: false }
    }
    throw error
  }
}

// ========== Admin API ==========

/**
 * Get all shared folders (admin only)
 */
export async function getAllSharedFolders(): Promise<SharedFolder[]> {
  const response = await api.get<{ data: { folders: SharedFolder[] } }>('/admin/shared-folders')
  return response.data?.folders || []
}

/**
 * Create a new shared folder (admin only)
 */
export async function createSharedFolder(data: {
  name: string
  description?: string
  storageQuota?: number
}): Promise<{ id: string }> {
  return api.post<{ id: string }>('/admin/shared-folders', data)
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
  await api.put(`/admin/shared-folders/${folderId}`, data)
}

/**
 * Delete a shared folder (admin only)
 */
export async function deleteSharedFolder(folderId: string): Promise<void> {
  await api.delete(`/admin/shared-folders/${folderId}`)
}

// ========== Member Management (Admin) ==========

/**
 * Get members of a shared folder (admin only)
 */
export async function getSharedFolderMembers(folderId: string): Promise<SharedFolderMember[]> {
  const response = await api.get<{ data: { members: SharedFolderMember[] } }>(
    `/admin/shared-folders/${folderId}/members`
  )
  return response.data?.members || []
}

/**
 * Add a member to a shared folder (admin only)
 */
export async function addSharedFolderMember(
  folderId: string,
  userId: string,
  permissionLevel: number
): Promise<void> {
  await api.post(`/admin/shared-folders/${folderId}/members`, { userId, permissionLevel })
}

/**
 * Update a member's permission level (admin only)
 */
export async function updateMemberPermission(
  folderId: string,
  userId: string,
  permissionLevel: number
): Promise<void> {
  await api.put(`/admin/shared-folders/${folderId}/members/${userId}`, { permissionLevel })
}

/**
 * Remove a member from a shared folder (admin only)
 */
export async function removeSharedFolderMember(folderId: string, userId: string): Promise<void> {
  await api.delete(`/admin/shared-folders/${folderId}/members/${userId}`)
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
