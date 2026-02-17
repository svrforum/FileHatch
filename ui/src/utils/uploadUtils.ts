import * as tus from 'tus-js-client'

const TUS_STORAGE_PREFIX = 'fh-tus-'
const TUS_META_KEY = 'fh-tus-pending-uploads'
const STALE_THRESHOLD = 24 * 60 * 60 * 1000 // 24시간

// localStorage 기반 tus URL 저장소 (이어받기 지원)
export const resumableUrlStorage: tus.UrlStorage = {
  findAllUploads: async () => {
    const results: tus.PreviousUpload[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(TUS_STORAGE_PREFIX)) continue
      try {
        const entry = JSON.parse(localStorage.getItem(key) || '')
        // 24시간 지난 항목 정리
        if (entry.createdAt && Date.now() - entry.createdAt > STALE_THRESHOLD) {
          localStorage.removeItem(key)
          continue
        }
        results.push(entry)
      } catch {
        localStorage.removeItem(key!)
      }
    }
    return results
  },

  findUploadsByFingerprint: async (fingerprint: string) => {
    const key = TUS_STORAGE_PREFIX + fingerprint
    try {
      const entry = localStorage.getItem(key)
      if (!entry) return []
      const data = JSON.parse(entry)
      // 24시간 지난 항목 무시
      if (data.createdAt && Date.now() - data.createdAt > STALE_THRESHOLD) {
        localStorage.removeItem(key)
        return []
      }
      return [data]
    } catch {
      localStorage.removeItem(key)
      return []
    }
  },

  removeUpload: async (urlStorageKey: string) => {
    localStorage.removeItem(urlStorageKey)
  },

  addUpload: async (fingerprint: string, upload: tus.PreviousUpload) => {
    const key = TUS_STORAGE_PREFIX + fingerprint
    localStorage.setItem(key, JSON.stringify({ ...upload, urlStorageKey: key, createdAt: Date.now() }))
    return key
  },
}

// tus fingerprint 생성 (파일명 + 크기 + 경로 포함)
export function tusFingerprint(file: File, path: string): string {
  return `${file.name}-${file.size}-${file.lastModified}-${path}`
}

// 중단된 업로드 메타 정보 저장/로드
export interface PendingUploadMeta {
  filename: string
  path: string
  size: number
  progress: number
  fingerprint: string
  savedAt: number
}

export function savePendingUploads(uploads: PendingUploadMeta[]): void {
  localStorage.setItem(TUS_META_KEY, JSON.stringify(uploads))
}

export function loadPendingUploads(): PendingUploadMeta[] {
  try {
    const data = localStorage.getItem(TUS_META_KEY)
    if (!data) return []
    const items: PendingUploadMeta[] = JSON.parse(data)
    // 24시간 지난 항목 필터
    return items.filter(i => Date.now() - i.savedAt < STALE_THRESHOLD)
  } catch {
    return []
  }
}

export function clearPendingUploads(): void {
  localStorage.removeItem(TUS_META_KEY)
}

// 이전 noopUrlStorage 호환 (다른 곳에서 import하는 경우 대비)
export const noopUrlStorage = resumableUrlStorage

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
  const fp = tusFingerprint(config.file, config.path)

  return new tus.Upload(config.file, {
    endpoint: `${window.location.origin}/api/upload/`,
    retryDelays: [0, 1000, 3000, 5000],
    removeFingerprintOnSuccess: true,
    fingerprint: () => Promise.resolve(fp),
    urlStorage: resumableUrlStorage,
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
