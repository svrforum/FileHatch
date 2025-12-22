const API_BASE = '/api'

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

export async function listSMBUsers(): Promise<SMBUsersResponse> {
  const response = await fetch(`${API_BASE}/smb/users`)
  if (!response.ok) {
    throw new Error('Failed to fetch SMB users')
  }
  return response.json()
}

export async function createSMBUser(username: string, password: string): Promise<void> {
  const response = await fetch(`${API_BASE}/smb/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to create SMB user')
  }
}

export async function setSMBPassword(username: string, password: string): Promise<void> {
  const response = await fetch(`${API_BASE}/smb/users/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to set SMB password')
  }
}

export async function deleteSMBUser(username: string): Promise<void> {
  const response = await fetch(`${API_BASE}/smb/users/${encodeURIComponent(username)}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to delete SMB user')
  }
}

export async function getSMBConfig(): Promise<SMBConfig> {
  const response = await fetch(`${API_BASE}/smb/config`)
  if (!response.ok) {
    throw new Error('Failed to fetch SMB config')
  }
  return response.json()
}

export async function updateSMBConfig(config: SMBConfig): Promise<void> {
  const response = await fetch(`${API_BASE}/smb/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to update SMB config')
  }
}
