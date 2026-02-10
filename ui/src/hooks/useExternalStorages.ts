// External storages hook with React Query caching
// Fetches external storages accessible by the current user

import { useQuery } from '@tanstack/react-query'
import { listMyExternalStorages, ExternalStorage } from '../api/externalStorages'
import { useAuthStore } from '../stores/authStore'

export function useExternalStorages() {
  const { token } = useAuthStore()

  const { data: externalStorages = [], isLoading, error, refetch } = useQuery({
    queryKey: ['external-storages'],
    queryFn: listMyExternalStorages,
    enabled: !!token,
    staleTime: 60000, // Consider data fresh for 1 minute
    gcTime: 300000, // Keep in cache for 5 minutes
  })

  return {
    externalStorages,
    isLoading,
    error,
    refetch,
  }
}

// Helper to check if an external storage path is readonly
export function isExternalStorageReadonly(
  externalStorages: ExternalStorage[],
  path: string
): boolean {
  // Path format: /external/{mountPath}/...
  const parts = path.replace(/^\//, '').split('/')
  if (parts.length < 2 || parts[0] !== 'external') return false
  const mountPath = parts[1]
  const storage = externalStorages.find(s => s.mountPath === mountPath)
  return storage?.isReadonly ?? false
}

// Helper to get external storage info from a path
export function getExternalStorageFromPath(
  externalStorages: ExternalStorage[],
  path: string
): ExternalStorage | undefined {
  const parts = path.replace(/^\//, '').split('/')
  if (parts.length < 2 || parts[0] !== 'external') return undefined
  const mountPath = parts[1]
  return externalStorages.find(s => s.mountPath === mountPath)
}

export default useExternalStorages
