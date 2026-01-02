import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Notification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllRead,
} from '../api/notifications';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';

interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  handleMarkAsRead: (id: number) => Promise<void>;
  handleMarkAllAsRead: () => Promise<void>;
  handleDelete: (id: number) => Promise<void>;
  handleDeleteAllRead: () => Promise<void>;
  addNotification: (notification: Notification) => void;
}

export const useNotifications = (): UseNotificationsReturn => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { token } = useAuthStore();
  const isAuthenticated = !!token;
  const isMounted = useRef(true);
  const refreshTrigger = useNotificationStore((state) => state.refreshTrigger);

  const fetchNotifications = useCallback(async () => {
    if (!isAuthenticated) return;

    setIsLoading(true);
    setError(null);

    try {
      const [notifData, count] = await Promise.all([
        getNotifications(50, 0),
        getUnreadCount()
      ]);

      if (isMounted.current) {
        setNotifications(notifData.notifications || []);
        setUnreadCount(count);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
      if (isMounted.current) {
        setError('알림을 불러오는데 실패했습니다');
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [isAuthenticated]);

  // Initial fetch and refresh on trigger
  useEffect(() => {
    isMounted.current = true;
    fetchNotifications();

    return () => {
      isMounted.current = false;
    };
  }, [fetchNotifications, refreshTrigger]);

  // Periodic refresh (every 60 seconds)
  useEffect(() => {
    if (!isAuthenticated) return;

    const interval = setInterval(() => {
      getUnreadCount().then(count => {
        if (isMounted.current) {
          setUnreadCount(count);
        }
      }).catch(console.error);
    }, 60000);

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Add new notification (called from WebSocket handler)
  const addNotification = useCallback((notification: Notification) => {
    setNotifications(prev => [notification, ...prev]);
    setUnreadCount(prev => prev + 1);
  }, []);

  const handleMarkAsRead = useCallback(async (id: number) => {
    try {
      await markAsRead(id);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  }, []);

  const handleMarkAllAsRead = useCallback(async () => {
    try {
      await markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  }, []);

  const handleDelete = useCallback(async (id: number) => {
    try {
      const notification = notifications.find(n => n.id === id);
      await deleteNotification(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      if (notification && !notification.isRead) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Failed to delete notification:', err);
    }
  }, [notifications]);

  const handleDeleteAllRead = useCallback(async () => {
    try {
      await deleteAllRead();
      setNotifications(prev => prev.filter(n => !n.isRead));
    } catch (err) {
      console.error('Failed to delete read notifications:', err);
    }
  }, []);

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    refresh: fetchNotifications,
    handleMarkAsRead,
    handleMarkAllAsRead,
    handleDelete,
    handleDeleteAllRead,
    addNotification,
  };
};
