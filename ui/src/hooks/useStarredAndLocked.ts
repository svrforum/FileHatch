// Hook for managing starred files and file locks status

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  checkStarred,
  checkFileLocks,
  toggleStar as apiToggleStar,
  lockFile as apiLockFile,
  unlockFile as apiUnlockFile,
  FileLockInfo,
} from '../api/files'

interface UseStarredAndLockedOptions {
  filePaths: string[]
  currentUserId?: string
  enabled?: boolean
}

export function useStarredAndLocked({
  filePaths,
  currentUserId,
  enabled = true
}: UseStarredAndLockedOptions) {
  const queryClient = useQueryClient()
  const [localStarred, setLocalStarred] = useState<Record<string, boolean>>({})
  const [localLocks, setLocalLocks] = useState<Record<string, FileLockInfo>>({})

  // Sort paths for stable query key (prevents cache misses when order changes)
  const sortedPaths = [...filePaths].sort()
  const pathsKey = sortedPaths.join(',')

  // Query starred status for current files
  const { data: starredData, refetch: refetchStarred } = useQuery({
    queryKey: ['starred-status', pathsKey],
    queryFn: async () => {
      if (filePaths.length === 0) return { starred: {} }
      return checkStarred(filePaths)
    },
    enabled: enabled && filePaths.length > 0,
    staleTime: 30000, // Consider data fresh for 30 seconds
  })

  // Query lock status for current files
  const { data: locksData, refetch: refetchLocks } = useQuery({
    queryKey: ['locks-status', pathsKey],
    queryFn: async () => {
      if (filePaths.length === 0) return { locks: {} }
      return checkFileLocks(filePaths)
    },
    enabled: enabled && filePaths.length > 0,
    staleTime: 10000, // Lock status should be more fresh
  })

  // Update local state when data changes
  useEffect(() => {
    if (starredData?.starred) {
      setLocalStarred(prev => ({ ...prev, ...starredData.starred }))
    }
  }, [starredData])

  useEffect(() => {
    if (locksData?.locks) {
      setLocalLocks(prev => ({ ...prev, ...locksData.locks }))
    }
  }, [locksData])

  // Toggle star for a file
  const toggleStar = useCallback(async (path: string) => {
    try {
      const result = await apiToggleStar(path)
      setLocalStarred(prev => ({ ...prev, [path]: result.starred }))
      queryClient.invalidateQueries({ queryKey: ['starred-files'] })
      return result
    } catch (error) {
      console.error('Failed to toggle star:', error)
      throw error
    }
  }, [queryClient])

  // Lock a file
  const lockFile = useCallback(async (path: string, duration?: number, reason?: string) => {
    try {
      const result = await apiLockFile(path, duration, reason)
      if (result.locked && !result.error) {
        refetchLocks()
      }
      return result
    } catch (error) {
      console.error('Failed to lock file:', error)
      throw error
    }
  }, [refetchLocks])

  // Unlock a file
  const unlockFile = useCallback(async (path: string, force?: boolean) => {
    try {
      const result = await apiUnlockFile(path, force)
      if (result.unlocked) {
        setLocalLocks(prev => {
          const newLocks = { ...prev }
          delete newLocks[path]
          return newLocks
        })
      }
      return result
    } catch (error) {
      console.error('Failed to unlock file:', error)
      throw error
    }
  }, [])

  // Check if a file is starred
  const isStarred = useCallback((path: string) => {
    return localStarred[path] ?? false
  }, [localStarred])

  // Check if a file is locked
  const isLocked = useCallback((path: string) => {
    return !!localLocks[path]
  }, [localLocks])

  // Get lock info for a file
  const getLockInfo = useCallback((path: string): FileLockInfo | undefined => {
    return localLocks[path]
  }, [localLocks])

  // Check if current user owns the lock
  const isLockedByMe = useCallback((path: string) => {
    const lock = localLocks[path]
    return lock && lock.lockedBy === currentUserId
  }, [localLocks, currentUserId])

  return {
    starred: localStarred,
    locks: localLocks,
    isStarred,
    isLocked,
    getLockInfo,
    isLockedByMe,
    toggleStar,
    lockFile,
    unlockFile,
    refetchStarred,
    refetchLocks,
  }
}

export type UseStarredAndLockedReturn = ReturnType<typeof useStarredAndLocked>
