import { create } from 'zustand'
import * as tus from 'tus-js-client'
import { checkFileExists } from '../api/files'

// Helper to get auth info
function getAuthInfo(): { token: string | null; username: string | null } {
  const stored = localStorage.getItem('scv-auth')
  if (stored) {
    try {
      const { state } = JSON.parse(stored)
      return {
        token: state?.token || null,
        username: state?.user?.username || null
      }
    } catch {
      return { token: null, username: null }
    }
  }
  return { token: null, username: null }
}

// No-op URL storage to prevent caching of internal URLs
const noopUrlStorage: tus.UrlStorage = {
  findAllUploads: async () => [],
  findUploadsByFingerprint: async () => [],
  removeUpload: async () => {},
  addUpload: async () => '',
}

export interface UploadItem {
  id: string
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'completed' | 'error' | 'paused' | 'duplicate'
  error?: string
  upload?: tus.Upload
  path: string
  overwrite?: boolean
  // Speed tracking
  uploadSpeed?: number // bytes per second
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
  addFiles: (files: File[], path: string) => void
  startUpload: (id: string, overwrite?: boolean) => void
  startAllUploads: () => void
  checkAndStartUpload: (id: string) => Promise<void>
  resolveDuplicate: (action: 'overwrite' | 'rename' | 'cancel' | 'overwrite_all') => void
  pauseUpload: (id: string) => void
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
  togglePanel: () => void
  openPanel: () => void
  closePanel: () => void
}

export const useUploadStore = create<UploadState>((set, get) => ({
  items: [],
  downloads: [],
  isPanelOpen: false,
  duplicateFile: null,
  overwriteAll: false,

  addFiles: (files, path) => {
    // Reset overwriteAll when adding new files
    set({ overwriteAll: false })
    const newItems: UploadItem[] = files.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      progress: 0,
      status: 'pending',
      path,
    }))
    set((state) => ({ items: [...state.items, ...newItems] }))
  },

  startUpload: (id, overwrite = false) => {
    const item = get().items.find((i) => i.id === id)
    if (!item || item.status === 'uploading') return

    const { token, username } = getAuthInfo()
    const upload = new tus.Upload(item.file, {
      endpoint: `${window.location.origin}/api/upload/`,
      retryDelays: [0, 1000, 3000, 5000],
      removeFingerprintOnSuccess: true,
      urlStorage: noopUrlStorage,
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      metadata: {
        filename: item.file.name,
        filetype: item.file.type,
        path: item.path,
        username: username || '',
        overwrite: overwrite ? 'true' : 'false',
      },
      onError: (error) => {
        get().setStatus(id, 'error', error.message)
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const progress = Math.round((bytesUploaded / bytesTotal) * 100)
        const currentTime = Date.now()
        const currentItem = get().items.find(i => i.id === id)

        let uploadSpeed = 0
        if (currentItem?.lastBytesUploaded !== undefined && currentItem?.lastUpdateTime !== undefined) {
          const timeDiff = (currentTime - currentItem.lastUpdateTime) / 1000 // seconds
          const bytesDiff = bytesUploaded - currentItem.lastBytesUploaded
          if (timeDiff > 0) {
            uploadSpeed = bytesDiff / timeDiff
          }
        }

        get().updateProgress(id, progress, uploadSpeed, bytesUploaded, currentTime)
      },
      onSuccess: () => {
        get().setStatus(id, 'completed')
      },
    })

    get().setUpload(id, upload)
    get().setStatus(id, 'uploading')
    upload.start()
  },

  checkAndStartUpload: async (id) => {
    const item = get().items.find((i) => i.id === id)
    if (!item || item.status === 'uploading') return

    try {
      const result = await checkFileExists(item.path, item.file.name)
      if (result.exists) {
        // If overwriteAll mode is enabled, skip the modal
        if (get().overwriteAll) {
          get().startUpload(id, true)
          return
        }
        // File exists, show duplicate modal
        set({ duplicateFile: { id, filename: item.file.name, path: item.path } })
        get().setStatus(id, 'duplicate')
      } else {
        // No duplicate, start upload directly
        get().startUpload(id, false)
      }
    } catch {
      // If check fails, just start upload (backend will handle duplicates)
      get().startUpload(id, false)
    }
  },

  resolveDuplicate: (action) => {
    const { duplicateFile } = get()
    if (!duplicateFile) return

    const { id } = duplicateFile

    if (action === 'overwrite') {
      get().startUpload(id, true)
    } else if (action === 'overwrite_all') {
      // Enable overwrite all mode and start this upload
      set({ overwriteAll: true })
      get().startUpload(id, true)
    } else if (action === 'rename') {
      get().startUpload(id, false)
    } else {
      // Cancel - remove the upload
      get().removeUpload(id)
    }

    set({ duplicateFile: null })

    // Continue with remaining pending uploads
    setTimeout(() => {
      get().startAllUploads()
    }, 100)
  },

  startAllUploads: async () => {
    const { items, checkAndStartUpload } = get()
    const pendingItems = items.filter((item) => item.status === 'pending')

    for (const item of pendingItems) {
      await checkAndStartUpload(item.id)
      // If duplicate modal is shown, wait for it to be resolved
      if (get().duplicateFile) break
    }
  },

  pauseUpload: (id) => {
    const item = get().items.find((i) => i.id === id)
    if (item?.upload && item.status === 'uploading') {
      item.upload.abort()
      get().setStatus(id, 'paused')
    }
  },

  removeUpload: (id) => {
    const item = get().items.find((i) => i.id === id)
    if (item?.upload && item.status === 'uploading') {
      item.upload.abort()
    }
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }))
  },

  clearCompleted: () => {
    set((state) => ({
      items: state.items.filter((item) => item.status !== 'completed'),
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
      items: state.items.map((item) =>
        item.id === id ? { ...item, status, error } : item
      ),
    }))
  },

  setUpload: (id, upload) => {
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, upload } : item
      ),
    }))
  },

  // Download functions
  addDownload: (filename, size) => {
    const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const newDownload: DownloadItem = {
      id,
      filename,
      size,
      progress: 0,
      status: 'downloading',
    }
    set((state) => ({ downloads: [...state.downloads, newDownload] }))
    return id
  },

  updateDownloadProgress: (id, progress) => {
    set((state) => ({
      downloads: state.downloads.map((item) =>
        item.id === id ? { ...item, progress } : item
      ),
    }))
  },

  setDownloadStatus: (id, status, error) => {
    set((state) => ({
      downloads: state.downloads.map((item) =>
        item.id === id ? { ...item, status, error } : item
      ),
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
    if (item?.abortController) {
      item.abortController.abort()
    }
    set((state) => ({ downloads: state.downloads.filter((i) => i.id !== id) }))
  },

  clearCompletedDownloads: () => {
    set((state) => ({
      downloads: state.downloads.filter((item) => item.status !== 'completed'),
    }))
  },

  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false }),
}))
