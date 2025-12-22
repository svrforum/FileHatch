import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { User, login, getProfile, LoginRequest } from '../api/auth'

interface AuthState {
  token: string | null
  user: User | null
  isLoading: boolean
  error: string | null
  login: (data: LoginRequest) => Promise<void>
  logout: () => void
  refreshProfile: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isLoading: false,
      error: null,

      login: async (data) => {
        set({ isLoading: true, error: null })
        try {
          const result = await login(data)
          set({ token: result.token, user: result.user, isLoading: false })
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Login failed', isLoading: false })
          throw err
        }
      },

      logout: () => {
        set({ token: null, user: null, error: null })
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
    }),
    {
      name: 'scv-auth',
      partialize: (state) => ({ token: state.token, user: state.user }),
    }
  )
)
