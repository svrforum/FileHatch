// Shared folders hook with React Query caching
// Prevents duplicate API calls across components

import { useQuery } from '@tanstack/react-query'
import { getMySharedFolders, SharedFolderWithPermission } from '../api/sharedFolders'
import { useAuthStore } from '../stores/authStore'

export function useSharedFolders() {
  const { token } = useAuthStore()

  const { data: sharedFolders = [], isLoading, error, refetch } = useQuery({
    queryKey: ['shared-folders'],
    queryFn: getMySharedFolders,
    enabled: !!token,
    staleTime: 60000, // Consider data fresh for 1 minute
    gcTime: 300000, // Keep in cache for 5 minutes
  })

  return {
    sharedFolders,
    isLoading,
    error,
    refetch,
  }
}

// Helper to get folder name from shared folders list
export function getSharedFolderName(
  sharedFolders: SharedFolderWithPermission[],
  folderNameOrId: string
): string {
  const folder = sharedFolders.find(
    f => f.id === folderNameOrId || f.name === folderNameOrId
  )
  return folder?.name || folderNameOrId
}

export default useSharedFolders
