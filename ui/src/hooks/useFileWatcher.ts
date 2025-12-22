import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'

interface FileChangeEvent {
  type: 'create' | 'write' | 'remove' | 'rename'
  path: string
  name: string
  isDir: boolean
  timestamp: number
}

interface UseFileWatcherOptions {
  watchPaths?: string[]
  onFileChange?: (event: FileChangeEvent) => void
}

export function useFileWatcher(options: UseFileWatcherOptions = {}) {
  const { watchPaths = ['/home', '/shared'], onFileChange } = options
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isConnectingRef = useRef(false)
  const queryClient = useQueryClient()
  const { token } = useAuthStore()

  // Store callbacks in refs to avoid dependency changes
  const onFileChangeRef = useRef(onFileChange)
  const watchPathsRef = useRef(watchPaths)

  useEffect(() => {
    onFileChangeRef.current = onFileChange
  }, [onFileChange])

  useEffect(() => {
    watchPathsRef.current = watchPaths
  }, [watchPaths])

  useEffect(() => {
    if (!token) return

    // Prevent multiple simultaneous connection attempts
    if (isConnectingRef.current || wsRef.current) return
    isConnectingRef.current = true

    const connect = () => {
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

      // Determine WebSocket URL with token as query parameter
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}`

      try {
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          console.log('[WebSocket] Connected')
          isConnectingRef.current = false
          // Subscribe to watch paths
          ws.send(JSON.stringify({
            type: 'subscribe',
            paths: watchPathsRef.current
          }))
        }

        ws.onmessage = (event) => {
          try {
            const data: FileChangeEvent = JSON.parse(event.data)
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

          // Reconnect after delay (unless it was a normal closure)
          if (event.code !== 1000 && event.code !== 1005) {
            reconnectTimeoutRef.current = setTimeout(() => {
              console.log('[WebSocket] Attempting to reconnect...')
              connect()
            }, 3000)
          }
        }

        ws.onerror = (error) => {
          console.error('[WebSocket] Error:', error)
          isConnectingRef.current = false
        }
      } catch (err) {
        console.error('[WebSocket] Failed to connect:', err)
        isConnectingRef.current = false
        // Retry connection after delay
        reconnectTimeoutRef.current = setTimeout(connect, 5000)
      }
    }

    connect()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted')
        wsRef.current = null
      }
      isConnectingRef.current = false
    }
  }, [token, queryClient])

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
    updateWatchPaths
  }
}
