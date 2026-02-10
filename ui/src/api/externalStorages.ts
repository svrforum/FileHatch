/**
 * External Storages API
 */
import { api } from './client'

export interface ExternalStorage {
  id: string
  name: string
  mountPath: string
  backendType: string // "s3", "local-mount"
  status: string // "active", "disabled", "error"
  statusMessage?: string
  lastCheckedAt?: string
  storageUsed: number
  storageQuota: number // 0 = unlimited
  createdBy: string
  createdAt: string
  updatedAt: string
  isReadonly: boolean
  config?: Record<string, unknown> // masked config for display
}

export interface ExternalStorageAccess {
  id: number
  externalStorageId: string
  userId: string
  permissionLevel: number // 1=read, 2=read-write
  grantedBy?: string
  createdAt: string
  username?: string
  grantedByUsername?: string
}

export interface S3Config {
  endpoint: string
  region: string
  bucket: string
  access_key_id: string
  secret_access_key: string
  path_style: boolean
  prefix: string
}

export interface LocalMountConfig {
  path: string
}

export interface CreateExternalStorageRequest {
  name: string
  mountPath: string
  backendType: string
  config: S3Config | LocalMountConfig
  storageQuota?: number
  isReadonly?: boolean
}

export interface UpdateExternalStorageRequest {
  name?: string
  config?: S3Config | LocalMountConfig
  status?: string
  storageQuota?: number
  isReadonly?: boolean
}

// ========== Admin API ==========

export async function listExternalStorages(): Promise<ExternalStorage[]> {
  const response = await api.get<{ storages: ExternalStorage[] }>('/admin/external-storages')
  return response.storages || []
}

export async function getExternalStorage(id: string): Promise<ExternalStorage> {
  const response = await api.get<{ storage: ExternalStorage; config: Record<string, unknown> }>(`/admin/external-storages/${id}`)
  return { ...response.storage, config: response.config }
}

export async function createExternalStorage(data: CreateExternalStorageRequest): Promise<{ id: string }> {
  return api.post<{ id: string }>('/admin/external-storages', data)
}

export async function updateExternalStorage(id: string, data: UpdateExternalStorageRequest): Promise<void> {
  await api.put(`/admin/external-storages/${id}`, data)
}

export async function deleteExternalStorage(id: string): Promise<void> {
  await api.delete(`/admin/external-storages/${id}`)
}

export async function testExternalStorage(id: string): Promise<{ success: boolean; message: string; latencyMs?: number }> {
  return api.post<{ success: boolean; message: string; latencyMs?: number }>(`/admin/external-storages/${id}/test`)
}

// ========== Access Management (Admin) ==========

export async function listExternalStorageAccess(storageId: string): Promise<ExternalStorageAccess[]> {
  const response = await api.get<{ access: ExternalStorageAccess[] }>(`/admin/external-storages/${storageId}/access`)
  return response.access || []
}

export async function grantExternalStorageAccess(
  storageId: string,
  userId: string,
  permissionLevel: number
): Promise<void> {
  await api.post(`/admin/external-storages/${storageId}/access`, { userId, permissionLevel })
}

export async function updateExternalStorageAccess(
  storageId: string,
  userId: string,
  permissionLevel: number
): Promise<void> {
  await api.put(`/admin/external-storages/${storageId}/access/${userId}`, { permissionLevel })
}

export async function revokeExternalStorageAccess(storageId: string, userId: string): Promise<void> {
  await api.delete(`/admin/external-storages/${storageId}/access/${userId}`)
}

// ========== User API ==========

export async function listMyExternalStorages(): Promise<ExternalStorage[]> {
  const response = await api.get<{ storages: ExternalStorage[] }>('/external-storages')
  return response.storages || []
}

// ========== Helper Functions ==========

export function getBackendTypeLabel(type: string): string {
  switch (type) {
    case 's3':
      return 'S3 호환 스토리지'
    case 'local-mount':
      return '로컬 마운트'
    default:
      return type
  }
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return '활성'
    case 'disabled':
      return '비활성'
    case 'error':
      return '오류'
    default:
      return status
  }
}

export function formatStorageSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export const PERMISSION_READ = 1
export const PERMISSION_READ_WRITE = 2
