/**
 * Authentication API
 *
 * Handles user authentication, profile management, 2FA, and SSO operations.
 */

import { api } from './client'

// =============================================================================
// User Types
// =============================================================================

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
  rememberMe?: boolean
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

export interface UpdateProfileRequest {
  email?: string
  currentPassword?: string
  newPassword?: string
}

export interface SetSMBPasswordRequest {
  password: string
}

// =============================================================================
// 2FA Types
// =============================================================================

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

// =============================================================================
// SSO Types
// =============================================================================

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

// =============================================================================
// Authentication Functions
// =============================================================================

/**
 * Login with username and password
 */
export async function login(data: LoginRequest): Promise<AuthResponse> {
  return api.post<AuthResponse>('/auth/login', data, { noAuth: true })
}

/**
 * Get current user profile
 * @param _token - Deprecated, token is now handled automatically
 */
export async function getProfile(_token?: string): Promise<User> {
  const data = await api.get<{ user: User }>('/auth/profile')
  return data.user
}

/**
 * Update current user profile
 * @param _tokenOrData - If string, deprecated token. Otherwise, profile data.
 * @param data - Profile data (only when first param is token)
 */
export async function updateProfile(
  _tokenOrData: string | UpdateProfileRequest,
  data?: UpdateProfileRequest
): Promise<User> {
  const profileData = typeof _tokenOrData === 'string' ? data! : _tokenOrData
  const result = await api.put<{ user: User }>('/auth/profile', {
    email: profileData.email,
    oldPassword: profileData.currentPassword,
    newPassword: profileData.newPassword,
  })
  return result.user
}

/**
 * Set SMB/WebDAV password
 * @param _tokenOrPassword - If called with 2 params, first is token (deprecated). Otherwise, password.
 * @param password - Password (only when first param is token)
 */
export async function setSMBPassword(_tokenOrPassword: string, password?: string): Promise<void> {
  const pass = password ?? _tokenOrPassword
  await api.put('/auth/smb-password', { password: pass })
}

// =============================================================================
// 2FA Functions
// =============================================================================

/**
 * Get 2FA status for current user
 * @param _token - Deprecated, token is now handled automatically
 */
export async function get2FAStatus(_token?: string): Promise<TwoFAStatusResponse> {
  return api.get<TwoFAStatusResponse>('/auth/2fa/status')
}

/**
 * Setup 2FA - get QR code and secret
 * @param _token - Deprecated, token is now handled automatically
 */
export async function setup2FA(_token?: string): Promise<TwoFASetupResponse> {
  return api.get<TwoFASetupResponse>('/auth/2fa/setup')
}

/**
 * Enable 2FA with verification code
 * @param _tokenOrCode - If called with 2 params, first is token (deprecated). Otherwise, verification code.
 * @param code - Verification code (only when first param is token)
 */
export async function enable2FA(_tokenOrCode: string, code?: string): Promise<TwoFAEnableResponse> {
  const verificationCode = code ?? _tokenOrCode
  return api.post<TwoFAEnableResponse>('/auth/2fa/enable', { code: verificationCode })
}

/**
 * Disable 2FA with password confirmation
 * @param _tokenOrPassword - If called with 2 params, first is token (deprecated). Otherwise, password.
 * @param password - Password (only when first param is token)
 */
export async function disable2FA(_tokenOrPassword: string, password?: string): Promise<void> {
  const pass = password ?? _tokenOrPassword
  await api.post('/auth/2fa/disable', { password: pass })
}

/**
 * Verify 2FA code during login (no auth required)
 */
export async function verify2FA(userId: string, code: string, rememberMe?: boolean): Promise<AuthResponse> {
  return api.post<AuthResponse>('/auth/2fa/verify', { userId, code, rememberMe }, { noAuth: true })
}

/**
 * Refresh the authentication token
 */
export async function refreshToken(): Promise<{ token: string }> {
  return api.post<{ token: string }>('/auth/refresh')
}

/**
 * Regenerate backup codes
 * @param _token - Deprecated, token is now handled automatically
 */
export async function regenerateBackupCodes(_token?: string): Promise<{ backupCodes: string[] }> {
  return api.post<{ backupCodes: string[] }>('/auth/2fa/backup-codes')
}

// =============================================================================
// Admin User Functions
// =============================================================================

/**
 * List all users (admin only)
 * @param _token - Deprecated, token is now handled automatically
 */
export async function listUsers(_token?: string): Promise<{ users: User[]; total: number }> {
  return api.get<{ users: User[]; total: number }>('/admin/users')
}

/**
 * Create a new user (admin only)
 * @param _tokenOrData - If string, deprecated token (ignored). If object, user data.
 * @param data - User data (only when first param is token)
 */
export async function createUser(
  _tokenOrData: string | CreateUserRequest,
  data?: CreateUserRequest
): Promise<{ id: string }> {
  const userData = typeof _tokenOrData === 'string' ? data! : _tokenOrData
  return api.post<{ id: string }>('/admin/users', userData)
}

/**
 * Update a user (admin only)
 * @param _tokenOrUserId - If called with token (deprecated), pass token here. Otherwise, user ID.
 * @param userIdOrData - User ID or update data
 * @param data - Update data (only when first param is token)
 */
export async function updateUser(
  _tokenOrUserId: string,
  userIdOrData: string | { email?: string; password?: string; isAdmin?: boolean; isActive?: boolean; storageQuota?: number },
  data?: { email?: string; password?: string; isAdmin?: boolean; isActive?: boolean; storageQuota?: number }
): Promise<void> {
  // If called with 3 params, first is token (deprecated)
  if (data !== undefined) {
    await api.put(`/admin/users/${userIdOrData}`, data)
  } else {
    // If called with 2 params, first is userId
    await api.put(`/admin/users/${_tokenOrUserId}`, userIdOrData)
  }
}

/**
 * Delete a user (admin only)
 * @param _tokenOrUserId - If called with 2 params, first is token (deprecated). Otherwise, user ID.
 * @param userId - User ID (only when first param is token)
 */
export async function deleteUser(_tokenOrUserId: string, userId?: string): Promise<void> {
  const id = userId ?? _tokenOrUserId
  await api.delete(`/admin/users/${id}`)
}

/**
 * Reset 2FA for a user (admin only)
 * @param _tokenOrUserId - If called with 2 params, first is token (deprecated). Otherwise, user ID.
 * @param userId - User ID (only when first param is token)
 */
export async function adminReset2FA(_tokenOrUserId: string, userId?: string): Promise<void> {
  const id = userId ?? _tokenOrUserId
  await api.delete(`/admin/users/${id}/2fa`)
}

// =============================================================================
// SSO Functions
// =============================================================================

/**
 * Get available SSO providers (public, no auth required)
 */
export async function getSSOProviders(): Promise<SSOProvidersResponse> {
  return api.get<SSOProvidersResponse>('/auth/sso/providers', { noAuth: true })
}

/**
 * Get SSO authorization URL for a provider
 */
export async function getSSOAuthURL(providerId: string): Promise<{ authUrl: string; state: string }> {
  return api.get<{ authUrl: string; state: string }>(`/auth/sso/auth/${providerId}`, { noAuth: true })
}

// =============================================================================
// Admin SSO Functions
// =============================================================================

/**
 * List all SSO providers (admin only)
 * @param _token - Deprecated, token is now handled automatically
 */
export async function listSSOProviders(_token?: string): Promise<SSOProvider[]> {
  return api.get<SSOProvider[]>('/admin/sso/providers')
}

/**
 * Create a new SSO provider (admin only)
 * @param _tokenOrData - If string, deprecated token. Otherwise, provider data.
 * @param data - Provider data (only when first param is token)
 */
export async function createSSOProvider(
  _tokenOrData: string | Omit<SSOProvider, 'id' | 'createdAt' | 'updatedAt'>,
  data?: Omit<SSOProvider, 'id' | 'createdAt' | 'updatedAt'>
): Promise<{ id: string }> {
  const providerData = typeof _tokenOrData === 'string' ? data! : _tokenOrData
  return api.post<{ id: string }>('/admin/sso/providers', providerData)
}

/**
 * Update an SSO provider (admin only)
 * @param _tokenOrId - If called with 3 params, first is token (deprecated). Otherwise, provider ID.
 * @param idOrData - Provider ID or update data
 * @param data - Update data (only when first param is token)
 */
export async function updateSSOProvider(
  _tokenOrId: string,
  idOrData: string | Partial<Omit<SSOProvider, 'id' | 'createdAt' | 'updatedAt'>>,
  data?: Partial<Omit<SSOProvider, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
  if (data !== undefined) {
    await api.put(`/admin/sso/providers/${idOrData}`, data)
  } else {
    await api.put(`/admin/sso/providers/${_tokenOrId}`, idOrData)
  }
}

/**
 * Delete an SSO provider (admin only)
 * @param _tokenOrId - If called with 2 params, first is token (deprecated). Otherwise, provider ID.
 * @param id - Provider ID (only when first param is token)
 */
export async function deleteSSOProvider(_tokenOrId: string, id?: string): Promise<void> {
  const providerId = id ?? _tokenOrId
  await api.delete(`/admin/sso/providers/${providerId}`)
}

/**
 * Get SSO settings (admin only)
 * @param _token - Deprecated, token is now handled automatically
 */
export async function getSSOSettings(_token?: string): Promise<SSOSettings> {
  return api.get<SSOSettings>('/admin/sso/settings')
}

/**
 * Update SSO settings (admin only)
 * @param _tokenOrSettings - If string, deprecated token. Otherwise, settings.
 * @param settings - Settings (only when first param is token)
 */
export async function updateSSOSettings(
  _tokenOrSettings: string | Partial<SSOSettings>,
  settings?: Partial<SSOSettings>
): Promise<void> {
  const settingsData = typeof _tokenOrSettings === 'string' ? settings! : _tokenOrSettings
  await api.put('/admin/sso/settings', settingsData)
}
