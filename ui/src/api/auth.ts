const API_BASE = '/api'

export interface User {
  id: string
  username: string
  email?: string
  provider: string
  isAdmin: boolean
  isActive: boolean
  hasSmb: boolean
  storageQuota: number  // 0 = unlimited
  storageUsed: number
  createdAt: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface CreateUserRequest {
  username: string
  email?: string
  password: string
  isAdmin?: boolean
}

export interface AuthResponse {
  token: string
  user: User
}

export interface UpdateProfileRequest {
  email?: string
  currentPassword?: string
  newPassword?: string
}

export interface SetSMBPasswordRequest {
  password: string
}

export async function login(data: LoginRequest): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Login failed')
  }

  return response.json()
}

// Admin functions
export async function listUsers(token: string): Promise<{ users: User[]; total: number }> {
  const response = await fetch(`${API_BASE}/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to list users')
  }

  return response.json()
}

export async function createUser(token: string, data: CreateUserRequest): Promise<{ id: string }> {
  const response = await fetch(`${API_BASE}/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create user')
  }

  return response.json()
}

export async function updateUser(
  token: string,
  userId: string,
  data: { email?: string; password?: string; isAdmin?: boolean; isActive?: boolean; storageQuota?: number }
): Promise<void> {
  const response = await fetch(`${API_BASE}/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to update user')
  }
}

export async function deleteUser(token: string, userId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to delete user')
  }
}

export async function getProfile(token: string): Promise<User> {
  const response = await fetch(`${API_BASE}/auth/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error('Failed to get profile')
  }

  const data = await response.json()
  return data.user
}

export async function updateProfile(
  token: string,
  data: UpdateProfileRequest
): Promise<User> {
  const response = await fetch(`${API_BASE}/auth/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email: data.email,
      oldPassword: data.currentPassword,
      newPassword: data.newPassword,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to update profile')
  }

  const result = await response.json()
  return result.user
}

export async function setSMBPassword(
  token: string,
  password: string
): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/smb-password`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ password }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to set SMB password')
  }
}
