import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { User, login, getProfile, LoginRequest, verify2FA, refreshToken } from '../api/auth'
import { ApiError } from '../api/client'

interface AuthState {
  token: string | null
  user: User | null
  isLoading: boolean
  error: string | null
  // 2FA state
  requires2FA: boolean
  pending2FAUserId: string | null
  pendingRememberMe: boolean  // Store rememberMe during 2FA flow
  login: (data: LoginRequest) => Promise<boolean>  // returns true if 2FA is required
  verify2FACode: (code: string) => Promise<void>
  cancel2FA: () => void
  logout: () => void
  refreshProfile: () => Promise<void>
  refreshAuthToken: () => Promise<boolean>  // returns true if refresh succeeded
  clearError: () => void
  setToken: (token: string) => void  // For SSO login
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isLoading: false,
      error: null,
      requires2FA: false,
      pending2FAUserId: null,
      pendingRememberMe: false,

      login: async (data) => {
        set({ isLoading: true, error: null, requires2FA: false, pending2FAUserId: null, pendingRememberMe: false })
        try {
          const result = await login(data)

          // Check if 2FA is required
          if (result.requires2fa && result.userId) {
            set({
              isLoading: false,
              requires2FA: true,
              pending2FAUserId: result.userId,
              pendingRememberMe: data.rememberMe || false  // Store for 2FA verification
            })
            return true  // 2FA required
          }

          // Normal login (no 2FA)
          if (result.token && result.user) {
            set({ token: result.token, user: result.user, isLoading: false })
          }
          return false  // No 2FA required
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Login failed', isLoading: false })
          throw err
        }
      },

      verify2FACode: async (code: string) => {
        const { pending2FAUserId, pendingRememberMe } = get()
        if (!pending2FAUserId) {
          set({ error: 'No pending 2FA verification' })
          return
        }

        set({ isLoading: true, error: null })
        try {
          const result = await verify2FA(pending2FAUserId, code, pendingRememberMe)
          if (result.token && result.user) {
            set({
              token: result.token,
              user: result.user,
              isLoading: false,
              requires2FA: false,
              pending2FAUserId: null,
              pendingRememberMe: false
            })
          }
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : '2FA verification failed',
            isLoading: false
          })
          throw err
        }
      },

      cancel2FA: () => {
        set({
          requires2FA: false,
          pending2FAUserId: null,
          pendingRememberMe: false,
          error: null
        })
      },

      logout: () => {
        set({
          token: null,
          user: null,
          error: null,
          requires2FA: false,
          pending2FAUserId: null,
          pendingRememberMe: false
        })
      },

      refreshProfile: async () => {
        const { token } = get()
        if (!token) return

        try {
          const user = await getProfile(token)
          set({ user })
        } catch (err) {
          // Only logout if it's an authentication error (401/403)
          // Don't logout for network errors or other issues
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            console.log('[Auth] Token expired or unauthorized, logging out')
            set({ token: null, user: null })
          } else {
            // For other errors (network issues, etc.), keep the current state
            console.warn('[Auth] Failed to refresh profile (keeping session):', err)
          }
        }
      },

      refreshAuthToken: async () => {
        const { token } = get()
        if (!token) return false

        try {
          const result = await refreshToken()
          if (result.token) {
            set({ token: result.token })
            return true
          }
          return false
        } catch {
          // Token refresh failed, don't logout automatically
          // The user might want to continue with the current session
          return false
        }
      },

      clearError: () => set({ error: null }),

      setToken: (token: string) => {
        set({ token })
      },
    }),
    {
      name: 'scv-auth',
      partialize: (state) => ({ token: state.token, user: state.user }),
    }
  )
)
