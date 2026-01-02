/**
 * File Shares API (User-to-User Sharing & Link Sharing)
 */
import { api } from './client'

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
  return api.post<{ id: number }>('/file-shares', data)
}

/**
 * Get files shared by the current user
 */
export async function getSharedByMe(): Promise<SharedByMeItem[]> {
  const response = await api.get<{ data: { shares: SharedByMeItem[] } }>('/file-shares/shared-by-me')
  return response.data?.shares || []
}

/**
 * Get files shared with the current user
 */
export async function getSharedWithMe(): Promise<SharedWithMeItem[]> {
  const response = await api.get<{ data: { shares: SharedWithMeItem[] } }>('/file-shares/shared-with-me')
  return response.data?.shares || []
}

/**
 * Update a file share's permission level
 */
export async function updateFileShare(
  shareId: number,
  data: { permissionLevel: number }
): Promise<void> {
  await api.put(`/file-shares/${shareId}`, data)
}

/**
 * Delete a file share
 */
export async function deleteFileShare(shareId: number): Promise<void> {
  await api.delete(`/file-shares/${shareId}`)
}

/**
 * Get sharing info for a specific file
 */
export async function getFileShareInfo(itemPath: string): Promise<FileShare[]> {
  const encodedPath = encodeURIComponent(itemPath)
  const response = await api.get<{ data: { shares: FileShare[] } }>(`/file-shares/file/${encodedPath}`)
  return response.data?.shares || []
}

/**
 * Search users by username or email
 */
export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const response = await api.get<{ data: { users: UserSearchResult[] } }>(
    `/users/search?q=${encodeURIComponent(query)}`
  )
  return response.data?.users || []
}

// ========== Link Sharing API (Public Links) ==========

export interface LinkShare {
  id: string
  token: string
  path: string
  displayPath: string
  createdBy: string
  createdAt: string
  expiresAt?: string
  hasPassword: boolean
  accessCount: number
  maxAccess?: number
  isActive: boolean
  requireLogin: boolean
  // File metadata
  size: number
  isDir: boolean
  name: string
  // Share type fields
  shareType: 'download' | 'upload' | 'edit'
  editable?: boolean
  maxFileSize?: number
  allowedExtensions?: string
  uploadCount?: number
  maxTotalSize?: number
  totalUploadedSize?: number
}

export interface UploadShareInfo {
  token: string
  folderName: string
  expiresAt?: string
  maxFileSize?: number
  allowedExtensions?: string
  uploadCount: number
  maxAccess?: number
  maxTotalSize?: number
  totalUploadedSize: number
  remainingSize?: number
  remainingUploads?: number
  requiresPassword?: boolean
  requiresLogin?: boolean
}

/**
 * Create a new share link
 */
export async function createShareLink(data: {
  path: string
  password?: string
  expiresIn?: number // hours, 0 = never
  maxAccess?: number // 0 = unlimited
  requireLogin?: boolean // if true, only authenticated users can access
  // Upload share specific options
  shareType?: 'download' | 'upload' // default: 'download'
  maxFileSize?: number // max file size in bytes (0 = unlimited)
  allowedExtensions?: string // comma-separated list
  maxTotalSize?: number // max total upload size in bytes
}): Promise<{ id: string; token: string; url: string; shareType: string }> {
  const response = await api.post<{ data: { id: string; token: string; url: string; shareType: string } }>('/shares', data)
  return response.data
}

/**
 * Get all share links created by the current user
 */
export async function getMyShareLinks(): Promise<LinkShare[]> {
  const response = await api.get<{ data: { shares: LinkShare[] } }>('/shares')
  return response.data?.shares || []
}

/**
 * Delete a share link
 */
export async function deleteShareLink(shareId: string): Promise<void> {
  await api.delete(`/shares/${shareId}`)
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
  const response = await api.post<{ data: {
    token: string
    path: string
    name: string
    isDir: boolean
    size: number
    expiresAt?: string
    requiresPassword?: boolean
  } }>(`/s/${token}`, { password }, { noAuth: true })
  return response.data
}

/**
 * Access an upload share link (for public upload page)
 */
export async function accessUploadShare(
  token: string,
  password?: string
): Promise<UploadShareInfo> {
  const response = await api.post<{ data: UploadShareInfo }>(`/u/${token}`, { password }, { noAuth: true })
  return response.data
}

/**
 * Get TUS upload URL for upload share
 */
export function getUploadShareTusUrl(token: string): string {
  return `/api/u/${token}/upload/`
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
