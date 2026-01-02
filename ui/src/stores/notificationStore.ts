import { create } from 'zustand'
import { Notification } from '../api/notifications'

interface NotificationStore {
  // Trigger for refreshing notifications
  refreshTrigger: number
  // Last received notification (for showing toast)
  lastNotification: Notification | null
  // Trigger a refresh
  triggerRefresh: () => void
  // Set last notification
  setLastNotification: (notification: Notification) => void
  // Clear last notification
  clearLastNotification: () => void
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  refreshTrigger: 0,
  lastNotification: null,

  triggerRefresh: () => set((state) => ({ refreshTrigger: state.refreshTrigger + 1 })),

  setLastNotification: (notification) => set({ lastNotification: notification }),

  clearLastNotification: () => set({ lastNotification: null }),
}))
