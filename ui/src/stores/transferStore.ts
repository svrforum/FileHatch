// 파일 이동/복사 전송 상태 관리 스토어
import { create } from 'zustand'
import { moveItemStream, copyItemStream, TransferProgress } from '../api/files'

export type TransferType = 'move' | 'copy'
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
}

interface TransferState {
  items: TransferItem[]
  isPanelOpen: boolean
  isPanelMinimized: boolean

  // Actions
  addTransfer: (type: TransferType, sources: TransferItemInfo[], destination: string) => void
  startTransfers: () => void
  executeTransfer: (id: string) => Promise<void>
  removeItem: (id: string) => void
  clearCompleted: () => void
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

    // Progress callback
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

    try {
      const streamOp = item.type === 'move'
        ? moveItemStream(item.sourcePath, item.destination, onProgress)
        : copyItemStream(item.sourcePath, item.destination, onProgress)

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

