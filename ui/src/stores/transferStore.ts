// 파일 이동/복사/압축/삭제 전송 상태 관리 스토어
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { moveItemStream, copyItemStream, compressFilesStream, moveToTrash, TransferProgress, CompressionProgress } from '../api/files'
import { createTransferJob, cancelTransferJob, listTransferJobs, getTransferJob, TransferProgressEvent } from '../api/transfers'

// Map of local item IDs to promises that resolve with the server job ID
// Used to wait for server job creation before cancelling
const pendingJobIdMap = new Map<string, Promise<string>>()

export type TransferType = 'move' | 'copy' | 'compress' | 'delete'
export type TransferStatus = 'pending' | 'transferring' | 'completed' | 'error'

export interface TransferItemInfo {
  path: string
  name: string
  size?: number
  isDirectory?: boolean
}

export interface TransferItem {
  id: string
  type: TransferType
  sourcePath: string
  sourceName: string
  destination: string
  status: TransferStatus
  error?: string
  startedAt?: number
  completedAt?: number
  fileSize?: number
  isDirectory?: boolean
  // Progress tracking
  totalBytes?: number
  copiedBytes?: number
  currentFile?: string
  totalFiles?: number
  copiedFiles?: number
  bytesPerSec?: number
  progress?: number // 0-100
  cancel?: () => void
  // Compression specific
  compressPaths?: string[]
  outputName?: string
  outputPath?: string
  outputSize?: number
  // Delete specific
  deletePaths?: string[]
  deleteNames?: string[]
  // Retry specific
  isRetry?: boolean
  // Overwrite mode
  overwrite?: boolean
  // Merge mode (folder copy)
  mergeMode?: string        // 'merge'
  fileConflict?: string     // 'overwrite' | 'skip' | 'rename'
  // Server-side job
  serverJobId?: string      // Server-side job UUID (if managed by server)
  isServerSide?: boolean    // Whether this is a server-side job
}

interface TransferState {
  items: TransferItem[]
  isPanelOpen: boolean
  isPanelMinimized: boolean

  // Actions
  addTransfer: (type: TransferType, sources: TransferItemInfo[], destination: string, overwrite?: boolean, mergeMode?: string, fileConflict?: string) => void
  addCompression: (paths: string[], outputName: string, currentPath: string) => void
  addDeletion: (paths: string[], names: string[]) => void
  startTransfers: () => void
  executeTransfer: (id: string) => Promise<void>
  removeItem: (id: string) => void
  clearCompleted: () => void
  retryTransfer: (id: string) => void
  addServerTransfer: (type: 'copy' | 'move', sourcePath: string, sourceName: string, destination: string, overwrite?: boolean, mergeMode?: string, fileConflict?: string) => Promise<string | null>
  handleTransferProgress: (event: TransferProgressEvent) => void
  loadServerJobs: () => Promise<void>
  cancelServerJob: (id: string) => Promise<void>
  openPanel: () => void
  closePanel: () => void
  toggleMinimize: () => void
}

export const useTransferStore = create<TransferState>()(persist((set, get) => ({
  items: [],
  isPanelOpen: false,
  isPanelMinimized: false,

  addTransfer: (type, sources, destination, overwrite, mergeMode, fileConflict) => {
    const newItems: TransferItem[] = sources.map(source => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      sourcePath: source.path,
      sourceName: source.name,
      destination,
      status: 'pending',
      fileSize: source.size,
      isDirectory: source.isDirectory,
      overwrite,
      mergeMode,
      fileConflict,
    }))

    set(state => ({
      items: [...state.items, ...newItems],
      isPanelOpen: true,
    }))
  },

  addCompression: (paths, outputName, currentPath) => {
    // Create display name for the compression task
    const displayName = paths.length === 1
      ? paths[0].split('/').pop() || outputName
      : `${paths.length}개 항목`

    const newItem: TransferItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'compress',
      sourcePath: paths[0],
      sourceName: displayName,
      destination: currentPath,
      status: 'pending',
      compressPaths: paths,
      outputName,
    }

    set(state => ({
      items: [...state.items, newItem],
      isPanelOpen: true,
    }))

    // Auto-start the compression
    setTimeout(() => {
      get().executeTransfer(newItem.id)
    }, 100)
  },

  addDeletion: (paths, names) => {
    const displayName = names.length === 1
      ? names[0]
      : `${names.length}개 항목`

    const tempId = `server-delete-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Use server-side delete for session-independent operation
    set(state => ({
      items: [...state.items, {
        id: tempId,
        type: 'delete' as TransferType,
        sourcePath: paths[0],
        sourceName: displayName,
        destination: '/trash',
        status: 'transferring' as TransferStatus,
        startedAt: Date.now(),
        isServerSide: true,
        deletePaths: paths,
        deleteNames: names,
        progress: 0,
      }],
      isPanelOpen: true,
    }))

    // Create server-side delete job and store the promise for cancel support
    const jobPromise = createTransferJob({
      type: 'delete',
      sourcePath: paths[0],
      destinationPath: '',
      paths,
    }).then(result => {
      // Update with real server job ID
      set(state => ({
        items: state.items.map(i =>
          i.id === tempId ? { ...i, serverJobId: result.id } : i
        ),
      }))
      pendingJobIdMap.delete(tempId)
      return result.id
    }).catch(error => {
      // Mark as error if API call failed
      set(state => ({
        items: state.items.map(i =>
          i.id === tempId ? {
            ...i,
            status: 'error' as TransferStatus,
            error: error instanceof Error ? error.message : '서버 삭제 작업 생성 실패',
            completedAt: Date.now(),
          } : i
        ),
      }))
      pendingJobIdMap.delete(tempId)
      return ''
    })
    pendingJobIdMap.set(tempId, jobPromise)
  },

  startTransfers: () => {
    const { items } = get()
    const pendingItems = items.filter(item => item.status === 'pending')

    // 순차적으로 전송 실행
    pendingItems.forEach((item, index) => {
      setTimeout(() => {
        get().executeTransfer(item.id)
      }, index * 100) // 약간의 딜레이로 순차 실행
    })
  },

  executeTransfer: async (id: string) => {
    const { items } = get()
    const item = items.find(i => i.id === id)
    if (!item || item.status !== 'pending') {
      return
    }

    // 상태를 transferring으로 변경
    set(state => ({
      items: state.items.map(i =>
        i.id === id ? { ...i, status: 'transferring' as TransferStatus, startedAt: Date.now() } : i
      ),
    }))

    // Progress callback for move/copy
    const onProgress = (progress: TransferProgress) => {
      const progressPercent = progress.totalBytes > 0
        ? Math.round((progress.copiedBytes / progress.totalBytes) * 100)
        : 0

      set(state => ({
        items: state.items.map(i =>
          i.id === id ? {
            ...i,
            totalBytes: progress.totalBytes,
            copiedBytes: progress.copiedBytes,
            currentFile: progress.currentFile,
            totalFiles: progress.totalFiles,
            copiedFiles: progress.copiedFiles,
            bytesPerSec: progress.bytesPerSec,
            progress: progressPercent,
          } : i
        ),
      }))
    }

    // Progress callback for compression
    const onCompressionProgress = (progress: CompressionProgress) => {
      const progressPercent = progress.totalBytes > 0
        ? Math.round((progress.compressedBytes / progress.totalBytes) * 100)
        : 0

      set(state => ({
        items: state.items.map(i =>
          i.id === id ? {
            ...i,
            totalBytes: progress.totalBytes,
            copiedBytes: progress.compressedBytes,
            currentFile: progress.currentFile,
            totalFiles: progress.totalFiles,
            copiedFiles: progress.processedFiles,
            bytesPerSec: progress.bytesPerSec,
            progress: progressPercent,
            outputPath: progress.outputPath,
            outputSize: progress.outputSize,
          } : i
        ),
      }))
    }

    try {
      let streamOp: { cancel: () => void; promise: Promise<unknown> }

      if (item.type === 'delete') {
        // Delete operation - individual items with progress tracking
        if (!item.deletePaths || item.deletePaths.length === 0) {
          throw new Error('Missing delete paths')
        }
        const deletePaths = item.deletePaths
        const total = deletePaths.length
        const abortController = new AbortController()
        const signal = abortController.signal

        // Set initial totalFiles
        set(state => ({
          items: state.items.map(i =>
            i.id === id ? { ...i, totalFiles: total, copiedFiles: 0, progress: 0 } : i
          ),
        }))

        const deletePromise = (async () => {
          const failures: { path: string; error: string }[] = []
          let consecutiveFailures = 0
          for (let i = 0; i < total; i++) {
            if (signal.aborted) {
              throw new Error('사용자에 의해 취소됨')
            }
            try {
              await moveToTrash(deletePaths[i])
              consecutiveFailures = 0
            } catch (err) {
              failures.push({ path: deletePaths[i], error: err instanceof Error ? err.message : '삭제 실패' })
              consecutiveFailures++
              if (consecutiveFailures >= 3) {
                throw new Error(`연속 ${consecutiveFailures}회 실패로 중단 (${failures.length}/${total}개 실패)`)
              }
            }
            // Update progress
            set(state => ({
              items: state.items.map(it =>
                it.id === id ? {
                  ...it,
                  copiedFiles: i + 1,
                  totalFiles: total,
                  progress: Math.round(((i + 1) / total) * 100),
                } : it
              ),
            }))
          }
          if (failures.length > 0) {
            const successCount = total - failures.length
            if (successCount === 0) {
              throw new Error(`삭제 실패: ${failures[0].error}`)
            }
            throw new Error(`${successCount}개 성공, ${failures.length}개 실패`)
          }
        })()

        streamOp = { cancel: () => abortController.abort(), promise: deletePromise }
      } else if (item.type === 'compress') {
        // Compression operation
        if (!item.compressPaths || !item.outputName) {
          throw new Error('Missing compression parameters')
        }
        streamOp = compressFilesStream(item.compressPaths, item.outputName, onCompressionProgress)
      } else {
        // Move/Copy operation
        streamOp = item.type === 'move'
          ? moveItemStream(item.sourcePath, item.destination, onProgress, item.overwrite)
          : copyItemStream(item.sourcePath, item.destination, onProgress, item.isRetry, item.overwrite, item.mergeMode, item.fileConflict)
      }

      // Store cancel function
      set(state => ({
        items: state.items.map(i =>
          i.id === id ? { ...i, cancel: streamOp.cancel } : i
        ),
      }))

      await streamOp.promise

      // 완료
      set(state => ({
        items: state.items.map(i =>
          i.id === id ? {
            ...i,
            status: 'completed' as TransferStatus,
            completedAt: Date.now(),
            progress: 100,
            cancel: undefined,
          } : i
        ),
      }))
    } catch (error) {
      // 에러
      set(state => ({
        items: state.items.map(i =>
          i.id === id ? {
            ...i,
            status: 'error' as TransferStatus,
            error: error instanceof Error ? error.message : '전송 실패',
            completedAt: Date.now(),
            cancel: undefined,
          } : i
        ),
      }))
    }

    // 에러 발생 시 패널 자동 열기
    const { items: updatedItems } = get()
    const currentItem = updatedItems.find(i => i.id === id)
    if (currentItem?.status === 'error') {
      set({ isPanelOpen: true, isPanelMinimized: false })
    }
  },

  retryTransfer: (id) => {
    const { items } = get()
    const item = items.find(i => i.id === id)
    if (!item || item.status !== 'error') return

    // For server-side delete jobs, retry by creating a new server job
    if (item.type === 'delete' && item.isServerSide && item.deletePaths) {
      set(state => ({
        items: state.items.filter(i => i.id !== id),
      }))
      get().addDeletion(item.deletePaths, item.deleteNames || item.deletePaths.map(p => p.split('/').pop() || p))
      return
    }

    set(state => ({
      items: state.items.map(i =>
        i.id === id && i.status === 'error'
          ? {
              ...i,
              status: 'pending' as TransferStatus,
              error: undefined,
              progress: 0,
              copiedBytes: 0,
              copiedFiles: 0,
              startedAt: undefined,
              totalBytes: undefined,
              currentFile: undefined,
              totalFiles: undefined,
              bytesPerSec: undefined,
              outputPath: undefined,
              outputSize: undefined,
              isRetry: (i.type === 'copy'),
            }
          : i
      ),
    }))
    get().executeTransfer(id)
  },

  removeItem: (id) => {
    pendingJobIdMap.delete(id)
    set(state => ({
      items: state.items.filter(i => i.id !== id),
    }))
  },

  clearCompleted: () => {
    set(state => ({
      items: state.items.filter(i => i.status === 'pending' || i.status === 'transferring'),
    }))
  },

  addServerTransfer: async (type, sourcePath, sourceName, destination, overwrite, mergeMode, fileConflict) => {
    const tempId = `server-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Add a temporary item immediately
    set(state => ({
      items: [...state.items, {
        id: tempId,
        type,
        sourcePath,
        sourceName,
        destination,
        status: 'transferring' as TransferStatus,
        startedAt: Date.now(),
        isServerSide: true,
        progress: 0,
      }],
      isPanelOpen: true,
    }))

    // Create server-side job and store the promise for cancel support
    const jobPromise = createTransferJob({
      type,
      sourcePath,
      destinationPath: destination,
      overwrite,
      mode: mergeMode,
      fileConflict,
    }).then(result => {
      // Update with real server job ID
      set(state => ({
        items: state.items.map(i =>
          i.id === tempId ? { ...i, serverJobId: result.id } : i
        ),
      }))
      pendingJobIdMap.delete(tempId)
      return result.id
    }).catch(error => {
      // Mark as error if API call failed
      set(state => ({
        items: state.items.map(i =>
          i.id === tempId ? {
            ...i,
            status: 'error' as TransferStatus,
            error: error instanceof Error ? error.message : '서버 전송 작업 생성 실패',
            completedAt: Date.now(),
          } : i
        ),
      }))
      pendingJobIdMap.delete(tempId)
      return ''
    })
    pendingJobIdMap.set(tempId, jobPromise)

    // Await and return the result for callers that need it
    const jobId = await jobPromise
    return jobId || null
  },

  handleTransferProgress: (event: TransferProgressEvent) => {
    const { items } = get()
    const existingItem = items.find(i => i.serverJobId === event.jobId)

    if (!existingItem) {
      // Server job from another session — fetch details and add it
      if (event.status === 'running' || event.status === 'started') {
        // Fetch job details from API to get the correct type
        getTransferJob(event.jobId).then(job => {
          const jobType = job.type as TransferType
          const isDelete = jobType === 'delete'
          const displayName = isDelete
            ? (event.totalFiles > 1 ? `${event.totalFiles}개 항목 삭제` : (job.sourcePath.split('/').pop() || '삭제'))
            : (job.sourcePath.split('/').pop() || '서버 전송 작업')

          // Check again if another event already added it
          const alreadyAdded = get().items.some(i => i.serverJobId === event.jobId)
          if (alreadyAdded) return

          set(state => ({
            items: [...state.items, {
              id: `server-${event.jobId}`,
              type: jobType,
              sourcePath: job.sourcePath,
              sourceName: displayName,
              destination: isDelete ? '/trash' : job.destinationPath,
              status: 'transferring' as TransferStatus,
              startedAt: new Date(job.createdAt).getTime(),
              isServerSide: true,
              serverJobId: event.jobId,
              totalBytes: event.totalBytes,
              copiedBytes: event.copiedBytes,
              totalFiles: event.totalFiles,
              copiedFiles: event.copiedFiles,
              currentFile: event.currentFile,
              bytesPerSec: event.bytesPerSec,
              progress: event.progress,
            }],
            isPanelOpen: true,
          }))
        }).catch(() => {
          // Fallback: add with generic info if API call fails
          set(state => ({
            items: [...state.items, {
              id: `server-${event.jobId}`,
              type: 'copy' as TransferType,
              sourcePath: '',
              sourceName: '',
              destination: '',
              status: 'transferring' as TransferStatus,
              startedAt: Date.now(),
              isServerSide: true,
              serverJobId: event.jobId,
              totalBytes: event.totalBytes,
              copiedBytes: event.copiedBytes,
              totalFiles: event.totalFiles,
              copiedFiles: event.copiedFiles,
              currentFile: event.currentFile,
              bytesPerSec: event.bytesPerSec,
              progress: event.progress,
            }],
            isPanelOpen: true,
          }))
        })
      }
      return
    }

    // Update existing item
    if (event.status === 'completed') {
      set(state => ({
        items: state.items.map(i =>
          i.serverJobId === event.jobId ? {
            ...i,
            status: 'completed' as TransferStatus,
            completedAt: Date.now(),
            progress: 100,
            cancel: undefined,
          } : i
        ),
      }))
    } else if (event.status === 'error') {
      set(state => ({
        items: state.items.map(i =>
          i.serverJobId === event.jobId ? {
            ...i,
            status: 'error' as TransferStatus,
            error: event.errorMessage || '전송 실패',
            completedAt: Date.now(),
            cancel: undefined,
          } : i
        ),
      }))
    } else if (event.status === 'cancelled') {
      set(state => ({
        items: state.items.map(i =>
          i.serverJobId === event.jobId ? {
            ...i,
            status: 'error' as TransferStatus,
            error: '취소됨',
            completedAt: Date.now(),
            cancel: undefined,
          } : i
        ),
      }))
    } else {
      // Running / progress update
      set(state => ({
        items: state.items.map(i =>
          i.serverJobId === event.jobId ? {
            ...i,
            status: 'transferring' as TransferStatus,
            totalBytes: event.totalBytes ?? i.totalBytes,
            copiedBytes: event.copiedBytes ?? i.copiedBytes,
            totalFiles: event.totalFiles ?? i.totalFiles,
            copiedFiles: event.copiedFiles ?? i.copiedFiles,
            currentFile: event.currentFile || i.currentFile,
            bytesPerSec: event.bytesPerSec ?? i.bytesPerSec,
            progress: event.progress ?? i.progress,
          } : i
        ),
      }))
    }
  },

  loadServerJobs: async () => {
    try {
      const jobs = await listTransferJobs()
      const { items } = get()

      // Only add jobs that aren't already tracked
      const newItems: TransferItem[] = []
      for (const job of jobs) {
        const alreadyTracked = items.some(i => i.serverJobId === job.id)
        if (alreadyTracked) continue
        if (job.status !== 'pending' && job.status !== 'running') continue

        const progressPercent = job.totalBytes > 0
          ? Math.round((job.copiedBytes / job.totalBytes) * 100)
          : 0

        const isDelete = job.type === 'delete'
        const displayName = isDelete
          ? (job.totalFiles > 1 ? `${job.totalFiles}개 항목 삭제` : (job.sourcePath.split('/').pop() || '삭제'))
          : (job.sourcePath.split('/').pop() || job.sourcePath)

        newItems.push({
          id: `server-${job.id}`,
          type: job.type as TransferType,
          sourcePath: job.sourcePath,
          sourceName: displayName,
          destination: job.destinationPath,
          status: 'transferring' as TransferStatus,
          startedAt: new Date(job.createdAt).getTime(),
          isServerSide: true,
          serverJobId: job.id,
          totalBytes: job.totalBytes,
          copiedBytes: job.copiedBytes,
          totalFiles: job.totalFiles,
          copiedFiles: job.copiedFiles,
          currentFile: job.currentFile,
          bytesPerSec: job.bytesPerSec,
          progress: progressPercent,
        })
      }

      if (newItems.length > 0) {
        set(state => ({
          items: [...state.items, ...newItems],
          isPanelOpen: true,
        }))
      }
    } catch {
      // Silently fail — server might not support transfer jobs yet
    }
  },

  cancelServerJob: async (id: string) => {
    const { items } = get()
    const item = items.find(i => i.id === id)
    if (!item) return

    let serverJobId = item.serverJobId

    // If serverJobId is not yet set, wait for the pending job creation
    if (!serverJobId) {
      const pending = pendingJobIdMap.get(id)
      if (!pending) return
      try {
        serverJobId = await pending
      } catch {
        return // Job creation itself failed, nothing to cancel
      }
      if (!serverJobId) return
    }

    try {
      await cancelTransferJob(serverJobId)
      // Update local state immediately (WebSocket event may also arrive)
      set(state => ({
        items: state.items.map(i =>
          i.id === id ? {
            ...i,
            status: 'error' as TransferStatus,
            error: '취소됨',
            completedAt: Date.now(),
            cancel: undefined,
          } : i
        ),
      }))
    } catch {
      // Cancel request may fail if already completed
    }
  },

  openPanel: () => {
    set({ isPanelOpen: true, isPanelMinimized: false })
  },

  closePanel: () => {
    set({ isPanelOpen: false })
  },

  toggleMinimize: () => {
    set(state => ({ isPanelMinimized: !state.isPanelMinimized }))
  },
}), {
  name: 'transfer-storage',
  partialize: (state) => ({
    // Only persist completed/error items (active transfers can't be restored)
    items: state.items
      .filter(i => i.status === 'completed' || i.status === 'error')
      .slice(-50)
      .map(({ cancel, ...rest }) => rest),
  }),
}))

// Listen for WebSocket transfer_progress events
if (typeof window !== 'undefined') {
  window.addEventListener('transfer-progress', ((event: CustomEvent<TransferProgressEvent>) => {
    useTransferStore.getState().handleTransferProgress(event.detail)
  }) as EventListener)
}

