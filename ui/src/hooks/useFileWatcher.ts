import { useEffect, useRef, useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'

interface FileChangeEvent {
  type: 'create' | 'write' | 'remove' | 'rename'
  path: string
  name: string
  isDir: boolean
  timestamp: number
}

export interface NotificationEventData {
  id: number
  userId: string
  type: string
  title: string
  message?: string
  link?: string
  actorId?: string
  actorName?: string
  isRead: boolean
  createdAt: string
  metadata?: Record<string, unknown>
}

interface NotificationEvent {
  type: 'notification'
  data: NotificationEventData
}

type WebSocketMessage = FileChangeEvent | NotificationEvent

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

interface UseFileWatcherOptions {
  watchPaths?: string[]
  onFileChange?: (event: FileChangeEvent) => void
  onNotification?: (notification: NotificationEventData) => void
  onConnectionStateChange?: (state: ConnectionState) => void
}

// Exponential backoff configuration
const INITIAL_RETRY_DELAY = 1000  // 1 second
const MAX_RETRY_DELAY = 30000     // 30 seconds
const MAX_RETRY_ATTEMPTS = 10

export function useFileWatcher(options: UseFileWatcherOptions = {}) {
  const { watchPaths = ['/home', '/shared'], onFileChange, onNotification, onConnectionStateChange } = options
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isConnectingRef = useRef(false)
  const retryCountRef = useRef(0)
  const retryDelayRef = useRef(INITIAL_RETRY_DELAY)
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const queryClient = useQueryClient()
  const { token } = useAuthStore()

  // Keep ref in sync for debugging
  useEffect(() => {
    console.debug('[WebSocket] Connection state:', connectionState)
  }, [connectionState])

  // Store callbacks in refs to avoid dependency changes
  const onFileChangeRef = useRef(onFileChange)
  const onNotificationRef = useRef(onNotification)
  const watchPathsRef = useRef(watchPaths)

  useEffect(() => {
    onFileChangeRef.current = onFileChange
  }, [onFileChange])

  useEffect(() => {
    onNotificationRef.current = onNotification
  }, [onNotification])

  useEffect(() => {
    watchPathsRef.current = watchPaths
  }, [watchPaths])

  // Update connection state and notify callback
  const updateConnectionState = useCallback((state: ConnectionState) => {
    setConnectionState(state)
    onConnectionStateChange?.(state)
  }, [onConnectionStateChange])

  useEffect(() => {
    if (!token) {
      updateConnectionState('disconnected')
      return
    }

    // Prevent multiple simultaneous connection attempts
    if (isConnectingRef.current || wsRef.current) return
    isConnectingRef.current = true

    const connect = (isReconnect = false) => {
      // Clear any existing reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      // Close existing connection
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }

      updateConnectionState(isReconnect ? 'reconnecting' : 'connecting')

      // Determine WebSocket URL with token as query parameter
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}`

      try {
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          console.log('[WebSocket] Connected')
          isConnectingRef.current = false
          retryCountRef.current = 0
          retryDelayRef.current = INITIAL_RETRY_DELAY
          updateConnectionState('connected')
          // Subscribe to watch paths
          ws.send(JSON.stringify({
            type: 'subscribe',
            paths: watchPathsRef.current
          }))
        }

        ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data)

            // Handle notification events
            if (message.type === 'notification') {
              console.log('[WebSocket] Notification:', message.data)
              if (onNotificationRef.current) {
                onNotificationRef.current(message.data)
              }
              return
            }

            // Handle file change events
            const data = message as FileChangeEvent
            console.log('[WebSocket] File change:', data)

            // Call custom handler if provided
            if (onFileChangeRef.current) {
              onFileChangeRef.current(data)
            }

            // Invalidate relevant queries
            // Get the directory path of the changed file
            const dirPath = data.path.substring(0, data.path.lastIndexOf('/')) || '/'

            // Invalidate the parent directory's file list
            queryClient.invalidateQueries({
              queryKey: ['files', dirPath],
              exact: true
            })

            // Also invalidate with all sort options since we might be viewing any sorting
            queryClient.invalidateQueries({
              queryKey: ['files'],
              predicate: (query) => {
                const key = query.queryKey
                return key[0] === 'files' && key[1] === dirPath
              }
            })

            // If it's a directory change, also invalidate that directory
            if (data.isDir && (data.type === 'create' || data.type === 'remove')) {
              queryClient.invalidateQueries({
                queryKey: ['files', data.path],
                exact: true
              })
            }

            // Also invalidate storage usage on file changes
            if (data.type === 'create' || data.type === 'remove' || data.type === 'write') {
              queryClient.invalidateQueries({ queryKey: ['storage-usage'] })
            }
          } catch (err) {
            console.error('[WebSocket] Failed to parse message:', err)
          }
        }

        ws.onclose = (event) => {
          console.log('[WebSocket] Disconnected:', event.code, event.reason)
          wsRef.current = null
          isConnectingRef.current = false
          updateConnectionState('disconnected')

          // Reconnect after delay (unless it was a normal closure or max retries reached)
          if (event.code !== 1000 && event.code !== 1005) {
            if (retryCountRef.current < MAX_RETRY_ATTEMPTS) {
              const delay = retryDelayRef.current
              console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${retryCountRef.current + 1}/${MAX_RETRY_ATTEMPTS})`)

              reconnectTimeoutRef.current = setTimeout(() => {
                retryCountRef.current++
                // Exponential backoff with jitter
                retryDelayRef.current = Math.min(
                  retryDelayRef.current * 2 + Math.random() * 1000,
                  MAX_RETRY_DELAY
                )
                connect(true)
              }, delay)
            } else {
              console.log('[WebSocket] Max retry attempts reached, giving up')
            }
          }
        }

        ws.onerror = (error) => {
          console.error('[WebSocket] Error:', error)
          isConnectingRef.current = false
        }
      } catch (err) {
        console.error('[WebSocket] Failed to connect:', err)
        isConnectingRef.current = false
        updateConnectionState('disconnected')

        // Retry connection with exponential backoff
        if (retryCountRef.current < MAX_RETRY_ATTEMPTS) {
          const delay = retryDelayRef.current
          reconnectTimeoutRef.current = setTimeout(() => {
            retryCountRef.current++
            retryDelayRef.current = Math.min(
              retryDelayRef.current * 2 + Math.random() * 1000,
              MAX_RETRY_DELAY
            )
            connect(true)
          }, delay)
        }
      }
    }

    // Handle online/offline events
    const handleOnline = () => {
      console.log('[WebSocket] Browser came online, reconnecting...')
      retryCountRef.current = 0
      retryDelayRef.current = INITIAL_RETRY_DELAY
      connect(true)
    }

    const handleOffline = () => {
      console.log('[WebSocket] Browser went offline')
      updateConnectionState('disconnected')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    connect()

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted')
        wsRef.current = null
      }
      isConnectingRef.current = false
      retryCountRef.current = 0
      retryDelayRef.current = INITIAL_RETRY_DELAY
    }
  }, [token, queryClient, updateConnectionState])

  const updateWatchPaths = useCallback((paths: string[]) => {
    watchPathsRef.current = paths
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'subscribe',
        paths
      }))
    }
  }, [])

  return {
    connectionState,
    updateWatchPaths
  }
}
