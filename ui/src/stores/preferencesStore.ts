// 사용자 환경설정 스토어
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useAuthStore } from './authStore'

const API_BASE = '/api'

export const DEFAULT_SIDEBAR_ORDER = [
  'files', 'recent', 'shared-drives', 'external-storages', 'sharing', 'trash'
]

export interface UserPreferences {
  sidebarOrder: string[]
  sidebarHidden: string[]
  defaultLanding: string
}

interface PreferencesState {
  preferences: UserPreferences
  isLoaded: boolean
  fetchPreferences: () => Promise<void>
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>
  resetPreferences: () => Promise<void>
}

function getAuthHeaders(): HeadersInit {
  const token = useAuthStore.getState().token
  return token ? { 'Authorization': `Bearer ${token}` } : {}
}

export const usePreferencesStore = create<PreferencesState>()(persist((set, get) => ({
  preferences: {
    sidebarOrder: DEFAULT_SIDEBAR_ORDER,
    sidebarHidden: [],
    defaultLanding: '',
  },
  isLoaded: false,

  fetchPreferences: async () => {
    try {
      const res = await fetch(`${API_BASE}/user/preferences`, {
        headers: getAuthHeaders(),
      })
      if (!res.ok) {
        set({ isLoaded: true })
        return
      }
      const data = await res.json()
      let loadedOrder = data.sidebarOrder?.length > 0 ? data.sidebarOrder : DEFAULT_SIDEBAR_ORDER
      // Auto-migrate: add any new sections from DEFAULT_SIDEBAR_ORDER that are missing
      const missingItems = DEFAULT_SIDEBAR_ORDER.filter(item => !loadedOrder.includes(item))
      if (missingItems.length > 0) {
        loadedOrder = [...loadedOrder, ...missingItems]
      }
      set({
        preferences: {
          sidebarOrder: loadedOrder,
          sidebarHidden: data.sidebarHidden || [],
          defaultLanding: data.defaultLanding || '',
        },
        isLoaded: true,
      })
    } catch {
      // Use local defaults on error
      set({ isLoaded: true })
    }
  },

  updatePreferences: async (partial) => {
    const current = get().preferences
    const updated = { ...current, ...partial }
    set({ preferences: updated })

    try {
      const res = await fetch(`${API_BASE}/user/preferences`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      if (!res.ok) throw new Error('Failed to save preferences')
    } catch (err) {
      set({ preferences: current })
      throw err
    }
  },

  resetPreferences: async () => {
    const current = get().preferences
    const defaults: UserPreferences = {
      sidebarOrder: DEFAULT_SIDEBAR_ORDER,
      sidebarHidden: [],
      defaultLanding: '',
    }
    set({ preferences: defaults })
    try {
      const res = await fetch(`${API_BASE}/user/preferences`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(defaults),
      })
      if (!res.ok) throw new Error('Failed to reset preferences')
    } catch (err) {
      set({ preferences: current })
      throw err
    }
  },
}), {
  name: 'user-preferences',
  partialize: (state) => ({
    preferences: state.preferences,
  }),
}))
