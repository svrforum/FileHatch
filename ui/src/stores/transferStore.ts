// 파일 이동/복사/압축/삭제 전송 상태 관리 스토어
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { moveItemStream, copyItemStream, compressFilesStream, moveToTrash, TransferProgress, CompressionProgress } from '../api/files'

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
}

interface TransferState {
  items: TransferItem[]
  isPanelOpen: boolean
  isPanelMinimized: boolean

  // Actions
  addTransfer: (type: TransferType, sources: TransferItemInfo[], destination: string, overwrite?: boolean) => void
  addCompression: (paths: string[], outputName: string, currentPath: string) => void
  addDeletion: (paths: string[], names: string[]) => void
  startTransfers: () => void
  executeTransfer: (id: string) => Promise<void>
  removeItem: (id: string) => void
  clearCompleted: () => void
  retryTransfer: (id: string) => void
  openPanel: () => void
  closePanel: () => void
  toggleMinimize: () => void
}

export const useTransferStore = create<TransferState>()(persist((set, get) => ({
  items: [],
  isPanelOpen: false,
  isPanelMinimized: false,

  addTransfer: (type, sources, destination, overwrite) => {
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

    const newItem: TransferItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'delete',
      sourcePath: paths[0],
      sourceName: displayName,
      destination: '/trash',
      status: 'pending',
      deletePaths: paths,
      deleteNames: names,
    }

    set(state => ({
      items: [...state.items, newItem],
      isPanelOpen: true,
    }))

    // Auto-start the deletion
    setTimeout(() => {
      get().executeTransfer(newItem.id)
    }, 100)
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
          : copyItemStream(item.sourcePath, item.destination, onProgress, item.isRetry, item.overwrite)
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
    set(state => ({
      items: state.items.filter(i => i.id !== id),
    }))
  },

  clearCompleted: () => {
    set(state => ({
      items: state.items.filter(i => i.status !== 'completed'),
    }))
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

