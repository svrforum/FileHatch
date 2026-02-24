import { create } from 'zustand'
import * as tus from 'tus-js-client'
import { checkFileExists, getStorageUsage, formatFileSize } from '../api/files'
import { useToastStore, parseUploadError } from './toastStore'
import {
  resumableUrlStorage,
  tusFingerprint,
  savePendingUploads,
  loadPendingUploads,
  clearPendingUploads,
  getAuthInfo,
  getTargetPath,
  getCachedStorageUsage,
  invalidateStorageCache,
  calculateUploadSpeed,
  type PendingUploadMeta,
} from '../utils/uploadUtils'

// Constants
const MAX_CONCURRENT_UPLOADS = 3
const API_TIMEOUT = 3000 // 3 seconds

export interface UploadItem {
  id: string
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'completed' | 'error' | 'paused' | 'duplicate'
  error?: string
  upload?: tus.Upload
  path: string
  relativePath?: string // For folder uploads
  overwrite?: boolean
  // Speed tracking
  uploadSpeed?: number
  lastBytesUploaded?: number
  lastUpdateTime?: number
  // Resume retry tracking
  _resumeRetried?: boolean
}

export interface DownloadItem {
  id: string
  filename: string
  path: string      // Full path for duplicate checking
  size: number
  progress: number
  status: 'downloading' | 'completed' | 'error'
  error?: string
  abortController?: AbortController
}

export interface DuplicateFile {
  id: string
  filename: string
  path: string
}

interface UploadState {
  items: UploadItem[]
  downloads: DownloadItem[]
  interruptedUploads: PendingUploadMeta[]
  isPanelOpen: boolean
  duplicateFile: DuplicateFile | null
  overwriteAll: boolean

  // Upload functions
  addFiles: (files: File[], currentPath: string, isFolder?: boolean) => void
  startUpload: (id: string, overwrite?: boolean) => void
  startAllUploads: () => Promise<void>
  startNextUpload: () => void
  checkAndStartUpload: (id: string) => Promise<void>
  resolveDuplicate: (action: 'overwrite' | 'rename' | 'cancel' | 'overwrite_all') => void
  retryUpload: (id: string) => void
  pauseUpload: (id: string) => void
  resumeUpload: (id: string) => void
  removeUpload: (id: string) => void
  clearCompleted: () => void
  clearErrors: () => void
  updateProgress: (id: string, progress: number, uploadSpeed?: number, lastBytesUploaded?: number, lastUpdateTime?: number) => void
  setStatus: (id: string, status: UploadItem['status'], error?: string) => void
  setUpload: (id: string, upload: tus.Upload) => void

  // Download functions
  addDownload: (filename: string, size: number, path: string) => string | null
  updateDownloadProgress: (id: string, progress: number) => void
  setDownloadStatus: (id: string, status: DownloadItem['status'], error?: string) => void
  setDownloadController: (id: string, controller: AbortController) => void
  removeDownload: (id: string) => void
  clearCompletedDownloads: () => void
  isDownloading: (path: string) => boolean

  // Interrupted uploads (resumable)
  loadInterruptedUploads: () => void
  dismissInterruptedUpload: (fingerprint: string) => void
  clearInterruptedUploads: () => void

  // Panel functions
  togglePanel: () => void
  openPanel: () => void
  closePanel: () => void

  // Getters
  getPendingCount: () => number
  getUploadingCount: () => number
  getCompletedCount: () => number
  hasActiveUploads: () => boolean
}

// Helper: Create timeout promise
function createTimeout<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
}

// Helper: Generate unique ID
function generateId(filename: string): string {
  return `${filename}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const useUploadStore = create<UploadState>((set, get) => ({
  items: [],
  downloads: [],
  interruptedUploads: [],
  isPanelOpen: false,
  duplicateFile: null,
  overwriteAll: false,

  // Add files to upload queue
  addFiles: (files, currentPath, isFolder = false) => {
    set({ overwriteAll: false })
    const existingItems = get().items

    const fileArray = Array.from(files).filter((file) => file.size > 0)

    // Filter out duplicates already in queue
    const newItems: UploadItem[] = fileArray
      .map((file) => {
        // Get relative path for folder uploads
        let relativePath = ''
        if (isFolder && 'webkitRelativePath' in file && file.webkitRelativePath) {
          relativePath = file.webkitRelativePath as string
        }

        const targetPath = getTargetPath(currentPath, relativePath)

        return {
          id: generateId(relativePath || file.name),
          file,
          progress: 0,
          status: 'pending' as const,
          path: targetPath,
          relativePath,
        }
      })
      .filter((item) => {
        // Check if already exists in queue
        const isDuplicate = existingItems.some(
          (existing) =>
            existing.file.name === item.file.name &&
            existing.file.size === item.file.size &&
            existing.path === item.path &&
            (existing.status === 'pending' || existing.status === 'uploading')
        )
        return !isDuplicate
      })

    if (newItems.length === 0) return

    // Clear matching interrupted uploads (user re-added the files for resume)
    const { interruptedUploads } = get()
    if (interruptedUploads.length > 0) {
      const matchedFps = new Set<string>()
      for (const item of newItems) {
        const fp = tusFingerprint(item.file, item.path)
        if (interruptedUploads.some(i => i.fingerprint === fp)) {
          matchedFps.add(fp)
        }
      }
      if (matchedFps.size > 0) {
        const remaining = interruptedUploads.filter(i => !matchedFps.has(i.fingerprint))
        set({ interruptedUploads: remaining })
        if (remaining.length > 0) savePendingUploads(remaining)
        else clearPendingUploads()
      }
    }

    set((state) => ({ items: [...state.items, ...newItems] }))

    // Auto-start uploads
    setTimeout(() => get().startAllUploads(), 100)
  },

  // Start a single upload
  startUpload: (id, overwrite = false) => {
    const item = get().items.find((i) => i.id === id)
    if (!item || item.status === 'uploading' || item.status === 'completed') return

    const { token, username } = getAuthInfo()
    const fp = tusFingerprint(item.file, item.path)

    const upload = new tus.Upload(item.file, {
      endpoint: `${window.location.origin}/api/upload/`,
      retryDelays: [0, 1000, 3000, 5000],
      removeFingerprintOnSuccess: true,
      fingerprint: () => Promise.resolve(fp),
      urlStorage: resumableUrlStorage,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      metadata: {
        filename: item.file.name,
        filetype: item.file.type,
        path: item.path,
        username: username || '',
        overwrite: overwrite ? 'true' : 'false',
      },
      onError: (error) => {
        const currentItem = get().items.find(i => i.id === id)

        // If this was a resume attempt (upload.url was set from stored URL)
        // and we haven't retried yet, clear stored URL and retry fresh
        if (!currentItem?._resumeRetried && upload.url) {
          resumableUrlStorage.removeUpload('fh-tus-' + fp)
          set(state => ({
            items: state.items.map(i => i.id === id
              ? { ...i, _resumeRetried: true, status: 'pending' as const, progress: 0 }
              : i
            )
          }))
          get().startUpload(id, overwrite)
          return
        }

        const errorMessage = parseUploadError(error.message)
        useToastStore.getState().showError(errorMessage)
        get().setStatus(id, 'error', errorMessage)
        setTimeout(() => get().startNextUpload(), 100)
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const progress = Math.round((bytesUploaded / bytesTotal) * 100)
        const isComplete = bytesUploaded >= bytesTotal

        // Throttle progress updates to every 200ms (always update on completion)
        if (!isComplete) {
          const currentItem = get().items.find((i) => i.id === id)
          const now = Date.now()
          if (currentItem?.lastUpdateTime && (now - currentItem.lastUpdateTime) < 200) {
            return
          }
        }

        const currentItem = get().items.find((i) => i.id === id)
        const uploadSpeed = calculateUploadSpeed(
          bytesUploaded,
          currentItem?.lastBytesUploaded,
          currentItem?.lastUpdateTime
        )
        get().updateProgress(id, progress, uploadSpeed, bytesUploaded, Date.now())
      },
      onSuccess: () => {
        get().setStatus(id, 'completed')
        invalidateStorageCache() // Clear cache after upload
        setTimeout(() => get().startNextUpload(), 100)
      },
    })

    get().setUpload(id, upload)
    get().setStatus(id, 'uploading')
    upload.start()
  },

  // Check for duplicates and quota before starting upload
  checkAndStartUpload: async (id) => {
    const item = get().items.find((i) => i.id === id)
    if (!item || item.status !== 'pending') return

    // Quota check with caching and timeout
    try {
      const storagePromise = getCachedStorageUsage(getStorageUsage)
      const storage = await Promise.race([
        storagePromise,
        createTimeout<never>(API_TIMEOUT, 'Quota check timeout'),
      ])

      // quota === 0 means unlimited
      if (storage.quota > 0) {
        const remaining = storage.quota - storage.totalUsed
        if (item.file.size > remaining) {
          const errorMessage = `저장 공간이 부족합니다. 필요: ${formatFileSize(item.file.size)}, 남은 공간: ${formatFileSize(remaining)}`
          useToastStore.getState().showError(errorMessage)
          get().setStatus(id, 'error', errorMessage)
          setTimeout(() => get().startNextUpload(), 100)
          return
        }
      }
    } catch {
      // Continue - backend will validate
    }

    // Duplicate check with timeout
    try {
      const checkPromise = checkFileExists(item.path, item.file.name)
      const result = await Promise.race([
        checkPromise,
        createTimeout<never>(API_TIMEOUT, 'File check timeout'),
      ])

      if (result.exists) {
        if (get().overwriteAll) {
          get().startUpload(id, true)
          return
        }
        // Show duplicate modal
        set({
          duplicateFile: {
            id,
            filename: item.relativePath || item.file.name,
            path: item.path,
          },
        })
        get().setStatus(id, 'duplicate')
        return
      }
    } catch {
      // If check fails, let backend handle it
    }

    get().startUpload(id, false)
  },

  // Resolve duplicate file conflict
  resolveDuplicate: (action) => {
    const { duplicateFile } = get()
    if (!duplicateFile) return

    const { id } = duplicateFile

    switch (action) {
      case 'overwrite':
        get().startUpload(id, true)
        break
      case 'overwrite_all':
        set({ overwriteAll: true })
        get().startUpload(id, true)
        break
      case 'rename':
        get().startUpload(id, false)
        break
      case 'cancel':
        get().removeUpload(id)
        break
    }

    set({ duplicateFile: null })
    setTimeout(() => get().startAllUploads(), 100)
  },

  // Start all pending uploads (up to MAX_CONCURRENT)
  startAllUploads: async () => {
    const { items, duplicateFile } = get()
    if (duplicateFile) return // Wait for duplicate resolution

    const uploadingCount = items.filter((i) => i.status === 'uploading').length
    const pendingItems = items.filter((i) => i.status === 'pending')

    const slotsAvailable = MAX_CONCURRENT_UPLOADS - uploadingCount
    const toStart = pendingItems.slice(0, slotsAvailable)

    // Stagger start to prevent server overload
    for (let i = 0; i < toStart.length; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      get().checkAndStartUpload(toStart[i].id)
      if (get().duplicateFile) break
    }
  },

  // Start next pending upload (called when one completes)
  startNextUpload: () => {
    const { items, duplicateFile } = get()
    if (duplicateFile) return

    const uploadingCount = items.filter((i) => i.status === 'uploading').length
    if (uploadingCount >= MAX_CONCURRENT_UPLOADS) return

    const pendingItems = items.filter((i) => i.status === 'pending')
    if (pendingItems.length > 0) {
      get().checkAndStartUpload(pendingItems[0].id)
    }
  },

  retryUpload: (id) => {
    const item = get().items.find((i) => i.id === id)
    if (!item || item.status !== 'error') return
    // Reset to pending and restart
    set(state => ({
      items: state.items.map(i =>
        i.id === id ? { ...i, status: 'pending' as const, error: undefined, progress: 0, upload: undefined, _resumeRetried: false } : i
      ),
    }))
    setTimeout(() => get().checkAndStartUpload(id), 100)
  },

  pauseUpload: (id) => {
    const item = get().items.find((i) => i.id === id)
    if (item?.upload && item.status === 'uploading') {
      item.upload.abort()
      get().setStatus(id, 'paused')
    }
  },

  resumeUpload: (id) => {
    const item = get().items.find((i) => i.id === id)
    if (item?.upload && item.status === 'paused') {
      item.upload.start()
      get().setStatus(id, 'uploading')
    }
  },

  removeUpload: async (id) => {
    const item = get().items.find((i) => i.id === id)
    if (item?.upload) {
      try {
        await item.upload.abort(true) // Terminate on server
      } catch {
        try { item.upload.abort() } catch { /* ignore */ }
      }
    }
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }))
  },

  clearCompleted: () => {
    set((state) => ({
      items: state.items.filter((i) => i.status !== 'completed'),
    }))
  },

  clearErrors: () => {
    set((state) => ({
      items: state.items.filter((i) => i.status !== 'error'),
    }))
  },

  updateProgress: (id, progress, uploadSpeed, lastBytesUploaded, lastUpdateTime) => {
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, progress, uploadSpeed, lastBytesUploaded, lastUpdateTime } : item
      ),
    }))
  },

  setStatus: (id, status, error) => {
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, status, error } : item)),
    }))
  },

  setUpload: (id, upload) => {
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, upload } : item)),
    }))
  },

  // Download functions
  addDownload: (filename, size, path) => {
    // Check if already downloading this path
    if (get().isDownloading(path)) {
      return null
    }
    const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`
    set((state) => ({
      downloads: [...state.downloads, { id, filename, path, size, progress: 0, status: 'downloading' }],
    }))
    return id
  },

  updateDownloadProgress: (id, progress) => {
    set((state) => ({
      downloads: state.downloads.map((item) => (item.id === id ? { ...item, progress } : item)),
    }))
  },

  setDownloadStatus: (id, status, error) => {
    set((state) => ({
      downloads: state.downloads.map((item) => (item.id === id ? { ...item, status, error } : item)),
    }))
  },

  setDownloadController: (id, controller) => {
    set((state) => ({
      downloads: state.downloads.map((item) =>
        item.id === id ? { ...item, abortController: controller } : item
      ),
    }))
  },

  removeDownload: (id) => {
    const item = get().downloads.find((i) => i.id === id)
    item?.abortController?.abort()
    set((state) => ({ downloads: state.downloads.filter((i) => i.id !== id) }))
  },

  clearCompletedDownloads: () => {
    set((state) => ({
      downloads: state.downloads.filter((i) => i.status !== 'completed'),
    }))
  },

  isDownloading: (path) => {
    return get().downloads.some((d) => d.path === path && d.status === 'downloading')
  },

  // Interrupted uploads (resumable)
  loadInterruptedUploads: () => {
    const interrupted = loadPendingUploads()
    if (interrupted.length > 0) {
      set({ interruptedUploads: interrupted })
      useToastStore.getState().showInfo(
        `${interrupted.length}개의 중단된 업로드가 있습니다. 파일을 다시 추가하면 이어받기합니다.`
      )
    }
  },

  dismissInterruptedUpload: (fingerprint) => {
    set(state => ({
      interruptedUploads: state.interruptedUploads.filter(i => i.fingerprint !== fingerprint)
    }))
    const remaining = get().interruptedUploads
    if (remaining.length > 0) savePendingUploads(remaining)
    else clearPendingUploads()
  },

  clearInterruptedUploads: () => {
    set({ interruptedUploads: [] })
    clearPendingUploads()
  },

  // Panel functions
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false }),

  // Getters
  getPendingCount: () => get().items.filter((i) => i.status === 'pending' || i.status === 'duplicate').length,
  getUploadingCount: () => get().items.filter((i) => i.status === 'uploading').length,
  getCompletedCount: () => get().items.filter((i) => i.status === 'completed').length,
  hasActiveUploads: () => get().items.some((i) => i.status === 'uploading' || i.status === 'pending'),
}))

// Save pending upload metadata when page is about to unload (for resume on next visit)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const state = useUploadStore.getState()
    const activeUploads = state.items.filter(
      i => i.status === 'uploading' || i.status === 'pending' || i.status === 'paused'
    )
    if (activeUploads.length > 0) {
      const metas: PendingUploadMeta[] = activeUploads.map(item => ({
        filename: item.file.name,
        path: item.path,
        size: item.file.size,
        progress: item.progress,
        fingerprint: tusFingerprint(item.file, item.path),
        savedAt: Date.now(),
      }))
      savePendingUploads(metas)
    } else {
      clearPendingUploads()
    }
  })
}
