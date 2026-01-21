import { create } from 'zustand'
import * as tus from 'tus-js-client'
import { checkFileExists, getStorageUsage, formatFileSize } from '../api/files'
import { useToastStore, parseUploadError } from './toastStore'
import {
  noopUrlStorage,
  getAuthInfo,
  getTargetPath,
  getCachedStorageUsage,
  invalidateStorageCache,
  calculateUploadSpeed,
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
}

export interface DownloadItem {
  id: string
  filename: string
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
  pauseUpload: (id: string) => void
  resumeUpload: (id: string) => void
  removeUpload: (id: string) => void
  clearCompleted: () => void
  updateProgress: (id: string, progress: number, uploadSpeed?: number, lastBytesUploaded?: number, lastUpdateTime?: number) => void
  setStatus: (id: string, status: UploadItem['status'], error?: string) => void
  setUpload: (id: string, upload: tus.Upload) => void

  // Download functions
  addDownload: (filename: string, size: number) => string
  updateDownloadProgress: (id: string, progress: number) => void
  setDownloadStatus: (id: string, status: DownloadItem['status'], error?: string) => void
  setDownloadController: (id: string, controller: AbortController) => void
  removeDownload: (id: string) => void
  clearCompletedDownloads: () => void

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

    set((state) => ({ items: [...state.items, ...newItems] }))

    // Auto-start uploads
    setTimeout(() => get().startAllUploads(), 100)
  },

  // Start a single upload
  startUpload: (id, overwrite = false) => {
    const item = get().items.find((i) => i.id === id)
    if (!item || item.status === 'uploading') return

    const { token, username } = getAuthInfo()

    const upload = new tus.Upload(item.file, {
      endpoint: `${window.location.origin}/api/upload/`,
      retryDelays: [0, 1000, 3000, 5000],
      removeFingerprintOnSuccess: true,
      urlStorage: noopUrlStorage,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      metadata: {
        filename: item.file.name,
        filetype: item.file.type,
        path: item.path,
        username: username || '',
        overwrite: overwrite ? 'true' : 'false',
      },
      onError: (error) => {
        const errorMessage = parseUploadError(error.message)
        useToastStore.getState().showError(errorMessage)
        get().setStatus(id, 'error', errorMessage)
        setTimeout(() => get().startNextUpload(), 100)
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const progress = Math.round((bytesUploaded / bytesTotal) * 100)
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
    if (!item || item.status === 'uploading') return

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
        item.upload.abort()
      }
    }
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }))
  },

  clearCompleted: () => {
    set((state) => ({
      items: state.items.filter((i) => i.status !== 'completed'),
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
  addDownload: (filename, size) => {
    const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`
    set((state) => ({
      downloads: [...state.downloads, { id, filename, size, progress: 0, status: 'downloading' }],
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
