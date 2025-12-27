import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { User, login, getProfile, LoginRequest, verify2FA } from '../api/auth'

interface AuthState {
  token: string | null
  user: User | null
  isLoading: boolean
  error: string | null
  // 2FA state
  requires2FA: boolean
  pending2FAUserId: string | null
  login: (data: LoginRequest) => Promise<boolean>  // returns true if 2FA is required
  verify2FACode: (code: string) => Promise<void>
  cancel2FA: () => void
  logout: () => void
  refreshProfile: () => Promise<void>
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

      login: async (data) => {
        set({ isLoading: true, error: null, requires2FA: false, pending2FAUserId: null })
        try {
          const result = await login(data)

          // Check if 2FA is required
          if (result.requires2fa && result.userId) {
            set({
              isLoading: false,
              requires2FA: true,
              pending2FAUserId: result.userId
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
        const { pending2FAUserId } = get()
        if (!pending2FAUserId) {
          set({ error: 'No pending 2FA verification' })
          return
        }

        set({ isLoading: true, error: null })
        try {
          const result = await verify2FA(pending2FAUserId, code)
          if (result.token && result.user) {
            set({
              token: result.token,
              user: result.user,
              isLoading: false,
              requires2FA: false,
              pending2FAUserId: null
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
          error: null
        })
      },

      logout: () => {
        set({
          token: null,
          user: null,
          error: null,
          requires2FA: false,
          pending2FAUserId: null
        })
      },

      refreshProfile: async () => {
        const { token } = get()
        if (!token) return

        try {
          const user = await getProfile(token)
          set({ user })
        } catch {
          // Token might be expired, logout
          set({ token: null, user: null })
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
