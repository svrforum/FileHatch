const API_BASE = '/api'

export interface User {
  id: string
  username: string
  email?: string
  provider: string
  isAdmin: boolean
  isActive: boolean
  hasSmb: boolean
  has2fa: boolean
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
  token?: string
  user?: User
  requires2fa?: boolean
  userId?: string
}

// 2FA interfaces
export interface TwoFASetupResponse {
  secret: string
  qrCodeUrl: string
  accountName: string
  issuer: string
}

export interface TwoFAStatusResponse {
  enabled: boolean
  backupCodesCount: number
}

export interface TwoFAEnableResponse {
  success: boolean
  message: string
  backupCodes: string[]
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

// 2FA Functions
export async function get2FAStatus(token: string): Promise<TwoFAStatusResponse> {
  const response = await fetch(`${API_BASE}/auth/2fa/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to get 2FA status')
  }

  return response.json()
}

export async function setup2FA(token: string): Promise<TwoFASetupResponse> {
  const response = await fetch(`${API_BASE}/auth/2fa/setup`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to setup 2FA')
  }

  return response.json()
}

export async function enable2FA(token: string, code: string): Promise<TwoFAEnableResponse> {
  const response = await fetch(`${API_BASE}/auth/2fa/enable`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to enable 2FA')
  }

  return response.json()
}

export async function disable2FA(token: string, password: string): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/2fa/disable`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ password }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to disable 2FA')
  }
}

export async function verify2FA(userId: string, code: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/2fa/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, code }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '2FA verification failed')
  }

  return response.json()
}

export async function regenerateBackupCodes(token: string): Promise<{ backupCodes: string[] }> {
  const response = await fetch(`${API_BASE}/auth/2fa/backup-codes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to regenerate backup codes')
  }

  return response.json()
}

export async function adminReset2FA(token: string, userId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/admin/users/${userId}/2fa`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to reset 2FA')
  }
}

// SSO Types
export interface SSOProviderPublic {
  id: string
  name: string
  providerType: string
  iconUrl?: string
  buttonColor?: string
}

export interface SSOProvidersResponse {
  enabled: boolean
  ssoOnlyMode: boolean
  providers: SSOProviderPublic[]
}

export interface SSOProvider {
  id: string
  name: string
  providerType: string
  clientId: string
  clientSecret?: string
  issuerUrl?: string
  authorizationUrl?: string
  tokenUrl?: string
  userinfoUrl?: string
  scopes: string
  allowedDomains?: string
  autoCreateUser: boolean
  defaultAdmin: boolean
  isEnabled: boolean
  displayOrder: number
  iconUrl?: string
  buttonColor?: string
  createdAt: string
  updatedAt: string
}

export interface SSOSettings {
  sso_enabled: string
  sso_only_mode: string
  sso_auto_register: string
  sso_allowed_domains: string
}

// SSO Functions
export async function getSSOProviders(): Promise<SSOProvidersResponse> {
  const response = await fetch(`${API_BASE}/auth/sso/providers`)

  if (!response.ok) {
    throw new Error('Failed to fetch SSO providers')
  }

  return response.json()
}

export async function getSSOAuthURL(providerId: string): Promise<{ authUrl: string; state: string }> {
  const response = await fetch(`${API_BASE}/auth/sso/auth/${providerId}`)

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to get SSO auth URL')
  }

  return response.json()
}

// Admin SSO Functions
export async function listSSOProviders(token: string): Promise<SSOProvider[]> {
  const response = await fetch(`${API_BASE}/admin/sso/providers`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch SSO providers')
  }

  return response.json()
}

export async function createSSOProvider(
  token: string,
  data: Omit<SSOProvider, 'id' | 'createdAt' | 'updatedAt'>
): Promise<{ id: string }> {
  const response = await fetch(`${API_BASE}/admin/sso/providers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create SSO provider')
  }

  return response.json()
}

export async function updateSSOProvider(
  token: string,
  id: string,
  data: Partial<Omit<SSOProvider, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
  const response = await fetch(`${API_BASE}/admin/sso/providers/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to update SSO provider')
  }
}

export async function deleteSSOProvider(token: string, id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/admin/sso/providers/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to delete SSO provider')
  }
}

export async function getSSOSettings(token: string): Promise<SSOSettings> {
  const response = await fetch(`${API_BASE}/admin/sso/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch SSO settings')
  }

  return response.json()
}

export async function updateSSOSettings(
  token: string,
  settings: Partial<SSOSettings>
): Promise<void> {
  const response = await fetch(`${API_BASE}/admin/sso/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(settings),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to update SSO settings')
  }
}
