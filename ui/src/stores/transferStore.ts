// 파일 이동/복사/압축/삭제 전송 상태 관리 스토어
import { create } from 'zustand'
import { moveItemStream, copyItemStream, compressFilesStream, batchMoveToTrash, TransferProgress, CompressionProgress } from '../api/files'

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
}

interface TransferState {
  items: TransferItem[]
  isPanelOpen: boolean
  isPanelMinimized: boolean

  // Actions
  addTransfer: (type: TransferType, sources: TransferItemInfo[], destination: string) => void
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

export const useTransferStore = create<TransferState>((set, get) => ({
  items: [],
  isPanelOpen: false,
  isPanelMinimized: false,

  addTransfer: (type, sources, destination) => {
    const newItems: TransferItem[] = sources.map(source => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      sourcePath: source.path,
      sourceName: source.name,
      destination,
      status: 'pending',
      fileSize: source.size,
      isDirectory: source.isDirectory,
    }))

    set(state => ({
      items: [...state.items, ...newItems],
      isPanelOpen: true,
      isPanelMinimized: false,
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
      isPanelMinimized: false,
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
      destination: '휴지통',
      status: 'pending',
      deletePaths: paths,
      deleteNames: names,
    }

    set(state => ({
      items: [...state.items, newItem],
      isPanelOpen: true,
      isPanelMinimized: false,
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
        // Delete operation - use batch API
        if (!item.deletePaths || item.deletePaths.length === 0) {
          throw new Error('Missing delete paths')
        }
        const deletePaths = item.deletePaths
        const deletePromise = batchMoveToTrash(deletePaths).then(result => {
          if (result.failed && result.failed.length > 0) {
            const failedCount = result.failed.length
            const successCount = result.success ? result.success.length : 0
            if (successCount === 0) {
              throw new Error(`삭제 실패: ${result.failed[0].error}`)
            }
            throw new Error(`${successCount}개 성공, ${failedCount}개 실패`)
          }
        })
        streamOp = { cancel: () => {}, promise: deletePromise }
      } else if (item.type === 'compress') {
        // Compression operation
        if (!item.compressPaths || !item.outputName) {
          throw new Error('Missing compression parameters')
        }
        streamOp = compressFilesStream(item.compressPaths, item.outputName, onCompressionProgress)
      } else {
        // Move/Copy operation
        streamOp = item.type === 'move'
          ? moveItemStream(item.sourcePath, item.destination, onProgress)
          : copyItemStream(item.sourcePath, item.destination, onProgress, item.isRetry)
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

    // 모든 항목이 완료되었는지 확인
    const { items: updatedItems } = get()
    const allDone = updatedItems.every(i => i.status === 'completed' || i.status === 'error')
    if (allDone) {
      // 2초 후 패널 자동 닫기 (에러가 없는 경우에만)
      const hasError = updatedItems.some(i => i.status === 'error')
      if (!hasError) {
        setTimeout(() => {
          const { items: currentItems } = get()
          const stillAllDone = currentItems.every(i => i.status === 'completed' || i.status === 'error')
          if (stillAllDone) {
            set({ isPanelOpen: false })
          }
        }, 2000)
      }
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
}))

