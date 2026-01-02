/**
 * SMB Configuration API
 */
import { api } from './client'

export interface SMBUser {
  id: string
  username: string
  isActive: boolean
  hasSmb: boolean
  createdAt: string
  updatedAt: string
}

export interface SMBConfig {
  workgroup: string
  serverName: string
  guestAccess: boolean
}

export interface SMBUsersResponse {
  users: SMBUser[]
  total: number
}

/**
 * List all SMB users
 */
export async function listSMBUsers(): Promise<SMBUsersResponse> {
  return api.get<SMBUsersResponse>('/smb/users')
}

/**
 * Create a new SMB user
 */
export async function createSMBUser(username: string, password: string): Promise<void> {
  await api.post('/smb/users', { username, password })
}

/**
 * Set SMB password for a user
 */
export async function setSMBPassword(username: string, password: string): Promise<void> {
  await api.put('/smb/users/password', { username, password })
}

/**
 * Delete an SMB user
 */
export async function deleteSMBUser(username: string): Promise<void> {
  await api.delete(`/smb/users/${encodeURIComponent(username)}`)
}

/**
 * Get SMB configuration
 */
export async function getSMBConfig(): Promise<SMBConfig> {
  return api.get<SMBConfig>('/smb/config')
}

/**
 * Update SMB configuration
 */
export async function updateSMBConfig(config: SMBConfig): Promise<void> {
  await api.put('/smb/config', config)
}
