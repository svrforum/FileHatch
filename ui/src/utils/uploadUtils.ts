import * as tus from 'tus-js-client'

// No-op URL storage to prevent TUS from caching upload URLs in localStorage
// This prevents stale resume attempts that can cause "file already exists" errors
export const noopUrlStorage: tus.UrlStorage = {
  findAllUploads: async () => [],
  findUploadsByFingerprint: async () => [],
  removeUpload: async () => {},
  addUpload: async () => '',
}

// Get authentication info from localStorage
export function getAuthInfo(): { token: string | null; username: string | null } {
  const stored = localStorage.getItem('filehatch-auth')
  if (stored) {
    try {
      const { state } = JSON.parse(stored)
      return {
        token: state?.token || null,
        username: state?.user?.username || null,
      }
    } catch {
      return { token: null, username: null }
    }
  }
  return { token: null, username: null }
}

// Calculate target path for folder uploads
// relativePath: e.g., "myFolder/subfolder/file.txt" from webkitRelativePath
// currentPath: e.g., "/home/user"
// Returns: e.g., "/home/user/myFolder/subfolder"
export function getTargetPath(currentPath: string, relativePath?: string): string {
  if (!relativePath) return currentPath

  // Get the directory part of the relative path (exclude filename)
  const pathParts = relativePath.split('/')
  pathParts.pop() // Remove filename

  if (pathParts.length === 0) return currentPath

  const relativeDirPath = pathParts.join('/')
  return currentPath === '/' ? '/' + relativeDirPath : currentPath + '/' + relativeDirPath
}

// TUS upload configuration factory
export interface TusUploadConfig {
  file: File
  path: string
  overwrite: boolean
  onProgress: (progress: number, bytesUploaded: number, bytesTotal: number) => void
  onSuccess: () => void
  onError: (errorMessage: string) => void
}

export function createTusUpload(config: TusUploadConfig): tus.Upload {
  const { token, username } = getAuthInfo()

  return new tus.Upload(config.file, {
    endpoint: `${window.location.origin}/api/upload/`,
    retryDelays: [0, 1000, 3000, 5000],
    removeFingerprintOnSuccess: true,
    urlStorage: noopUrlStorage,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    metadata: {
      filename: config.file.name,
      filetype: config.file.type,
      path: config.path,
      username: username || '',
      overwrite: config.overwrite ? 'true' : 'false',
    },
    onError: (error) => {
      // Extract error message from TUS error
      const message = error.message || 'Upload failed'
      config.onError(message)
    },
    onProgress: (bytesUploaded, bytesTotal) => {
      const progress = Math.round((bytesUploaded / bytesTotal) * 100)
      config.onProgress(progress, bytesUploaded, bytesTotal)
    },
    onSuccess: config.onSuccess,
  })
}

// Storage usage cache
interface StorageUsageCache {
  data: { quota: number; totalUsed: number } | null
  timestamp: number
}

let storageCache: StorageUsageCache = { data: null, timestamp: 0 }
const STORAGE_CACHE_TTL = 10000 // 10 seconds

export async function getCachedStorageUsage(
  fetchFn: () => Promise<{ quota: number; totalUsed: number }>
): Promise<{ quota: number; totalUsed: number }> {
  const now = Date.now()

  // Return cached data if still valid
  if (storageCache.data && now - storageCache.timestamp < STORAGE_CACHE_TTL) {
    return storageCache.data
  }

  // Fetch new data
  const data = await fetchFn()
  storageCache = { data, timestamp: now }
  return data
}

// Invalidate storage cache (call after upload completes)
export function invalidateStorageCache(): void {
  storageCache = { data: null, timestamp: 0 }
}

// Calculate upload speed
export function calculateUploadSpeed(
  bytesUploaded: number,
  lastBytesUploaded: number | undefined,
  lastUpdateTime: number | undefined
): number {
  if (lastBytesUploaded === undefined || lastUpdateTime === undefined) {
    return 0
  }

  const currentTime = Date.now()
  const timeDiff = (currentTime - lastUpdateTime) / 1000 // seconds
  const bytesDiff = bytesUploaded - lastBytesUploaded

  if (timeDiff > 0) {
    return bytesDiff / timeDiff
  }

  return 0
}
