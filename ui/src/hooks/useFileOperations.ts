// 파일 작업 관련 커스텀 훅
// 파일 삭제, 이름변경, 복사, 이동, 압축, 다운로드 등의 작업을 관리

import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  FileInfo,
  renameItem,
  copyItem,
  moveItem,
  moveToTrash,
  createFile,
  compressFiles,
  downloadAsZip,
  downloadFileWithProgress
} from '../api/files'
import { useUploadStore } from '../stores/uploadStore'

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
}

export interface HistoryAction {
  type: 'move' | 'copy' | 'delete' | 'rename'
  sourcePaths: string[]
  destPaths?: string[]
  destination?: string
  oldName?: string
  newName?: string
}

export interface UseFileOperationsOptions {
  currentPath: string
  onToast: (message: string, type: ToastType) => void
}

export function useFileOperations({ currentPath, onToast }: UseFileOperationsOptions) {
  const queryClient = useQueryClient()
  // Use uploadStore for download progress (same store handles both)
  const downloadStore = useUploadStore()

  // History for undo/redo
  const [historyState, setHistoryState] = useState<{
    actions: HistoryAction[]
    index: number
  }>({ actions: [], index: -1 })

  // Clipboard for copy/cut
  const [clipboard, setClipboard] = useState<{ files: FileInfo[]; mode: 'copy' | 'cut' } | null>(null)

  // Add to history
  const addToHistory = useCallback((action: HistoryAction) => {
    setHistoryState(prev => {
      const newActions = prev.actions.slice(0, prev.index + 1)
      newActions.push(action)
      return { actions: newActions, index: newActions.length - 1 }
    })
  }, [])

  // Refresh file list
  const refreshFiles = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
  }, [queryClient, currentPath])

  // Delete file/folder
  const deleteFile = useCallback(async (file: FileInfo) => {
    try {
      await moveToTrash(file.path)
      addToHistory({
        type: 'delete',
        sourcePaths: [file.path],
      })
      onToast(`"${file.name}"이(가) 휴지통으로 이동되었습니다`, 'success')
      refreshFiles()
      return true
    } catch (error) {
      onToast('삭제에 실패했습니다', 'error')
      return false
    }
  }, [addToHistory, onToast, refreshFiles])

  // Bulk delete
  const bulkDelete = useCallback(async (files: FileInfo[]) => {
    try {
      await Promise.all(files.map(f => moveToTrash(f.path)))
      addToHistory({
        type: 'delete',
        sourcePaths: files.map(f => f.path),
      })
      onToast(`${files.length}개 항목이 휴지통으로 이동되었습니다`, 'success')
      refreshFiles()
      return true
    } catch (error) {
      onToast('일부 항목 삭제에 실패했습니다', 'error')
      return false
    }
  }, [addToHistory, onToast, refreshFiles])

  // Rename file/folder
  const rename = useCallback(async (file: FileInfo, newName: string) => {
    if (!newName.trim() || newName === file.name) return false

    try {
      await renameItem(file.path, newName)
      addToHistory({
        type: 'rename',
        sourcePaths: [file.path],
        oldName: file.name,
        newName,
      })
      onToast('이름이 변경되었습니다', 'success')
      refreshFiles()
      return true
    } catch (error: any) {
      onToast(error.message || '이름 변경에 실패했습니다', 'error')
      return false
    }
  }, [addToHistory, onToast, refreshFiles])

  // Copy files
  const copyFiles = useCallback((files: FileInfo[]) => {
    setClipboard({ files, mode: 'copy' })
    onToast(`${files.length}개 항목이 복사되었습니다`, 'info')
  }, [onToast])

  // Cut files
  const cutFiles = useCallback((files: FileInfo[]) => {
    setClipboard({ files, mode: 'cut' })
    onToast(`${files.length}개 항목이 잘라내기되었습니다`, 'info')
  }, [onToast])

  // Paste files
  const paste = useCallback(async (destination: string) => {
    if (!clipboard) return false

    try {
      const results = await Promise.all(
        clipboard.files.map(file =>
          clipboard.mode === 'copy'
            ? copyItem(file.path, destination)
            : moveItem(file.path, destination)
        )
      )

      addToHistory({
        type: clipboard.mode === 'copy' ? 'copy' : 'move',
        sourcePaths: clipboard.files.map(f => f.path),
        destination,
        destPaths: results.map(r => r.newPath),
      })

      onToast(
        `${clipboard.files.length}개 항목이 ${clipboard.mode === 'copy' ? '복사' : '이동'}되었습니다`,
        'success'
      )

      if (clipboard.mode === 'cut') {
        setClipboard(null)
      }

      refreshFiles()
      return true
    } catch (error: any) {
      onToast(error.message || '붙여넣기에 실패했습니다', 'error')
      return false
    }
  }, [clipboard, addToHistory, onToast, refreshFiles])

  // Move files to folder
  const moveToFolder = useCallback(async (files: FileInfo[], destination: string) => {
    try {
      const results = await Promise.all(
        files.map(file => moveItem(file.path, destination))
      )

      addToHistory({
        type: 'move',
        sourcePaths: files.map(f => f.path),
        destination,
        destPaths: results.map(r => r.newPath),
      })

      onToast(`${files.length}개 항목이 이동되었습니다`, 'success')
      refreshFiles()
      return true
    } catch (error: any) {
      onToast(error.message || '이동에 실패했습니다', 'error')
      return false
    }
  }, [addToHistory, onToast, refreshFiles])

  // Create new file
  const createNewFile = useCallback(async (path: string, filename: string, fileType: string) => {
    try {
      await createFile(path, filename, fileType)
      onToast(`"${filename}" 파일이 생성되었습니다`, 'success')
      refreshFiles()
      return true
    } catch (error: any) {
      onToast(error.message || '파일 생성에 실패했습니다', 'error')
      return false
    }
  }, [onToast, refreshFiles])

  // Compress files
  const compress = useCallback(async (paths: string[], zipName: string) => {
    try {
      await compressFiles(paths, zipName)
      onToast(`"${zipName}.zip" 파일이 생성되었습니다`, 'success')
      refreshFiles()
      return true
    } catch (error: any) {
      onToast(error.message || '압축에 실패했습니다', 'error')
      return false
    }
  }, [onToast, refreshFiles])

  // Download single file
  const download = useCallback((file: FileInfo) => {
    downloadFileWithProgress(file.path, file.size, downloadStore)
  }, [downloadStore])

  // Download multiple files as zip
  const downloadMultipleAsZip = useCallback(async (paths: string[]) => {
    try {
      await downloadAsZip(paths)
      return true
    } catch (error: any) {
      onToast(error.message || '다운로드에 실패했습니다', 'error')
      return false
    }
  }, [onToast])

  // Undo
  const undo = useCallback(async () => {
    if (historyState.index < 0) return

    const action = historyState.actions[historyState.index]

    try {
      switch (action.type) {
        case 'rename':
          if (action.oldName && action.newName) {
            const newPath = action.sourcePaths[0].replace(action.oldName, action.newName)
            await renameItem(newPath, action.oldName)
          }
          break
        case 'move':
          if (action.destPaths && action.sourcePaths) {
            await Promise.all(
              action.destPaths.map((destPath, i) => {
                const parentPath = action.sourcePaths[i].substring(0, action.sourcePaths[i].lastIndexOf('/'))
                return moveItem(destPath, parentPath)
              })
            )
          }
          break
        case 'delete':
          // Cannot undo delete (would need to restore from trash)
          onToast('삭제는 휴지통에서 복원해주세요', 'info')
          return
      }

      setHistoryState(prev => ({ ...prev, index: prev.index - 1 }))
      onToast('실행 취소되었습니다', 'success')
      refreshFiles()
    } catch (error) {
      onToast('실행 취소에 실패했습니다', 'error')
    }
  }, [historyState, onToast, refreshFiles])

  // Redo
  const redo = useCallback(async () => {
    if (historyState.index >= historyState.actions.length - 1) return

    const action = historyState.actions[historyState.index + 1]

    try {
      switch (action.type) {
        case 'rename':
          if (action.oldName && action.newName) {
            await renameItem(action.sourcePaths[0], action.newName)
          }
          break
        case 'move':
          if (action.destination && action.sourcePaths) {
            await Promise.all(action.sourcePaths.map(path => moveItem(path, action.destination!)))
          }
          break
      }

      setHistoryState(prev => ({ ...prev, index: prev.index + 1 }))
      onToast('다시 실행되었습니다', 'success')
      refreshFiles()
    } catch (error) {
      onToast('다시 실행에 실패했습니다', 'error')
    }
  }, [historyState, onToast, refreshFiles])

  return {
    // State
    clipboard,
    historyState,
    canUndo: historyState.index >= 0,
    canRedo: historyState.index < historyState.actions.length - 1,

    // Actions
    deleteFile,
    bulkDelete,
    rename,
    copyFiles,
    cutFiles,
    paste,
    moveToFolder,
    createNewFile,
    compress,
    download,
    downloadMultipleAsZip,
    undo,
    redo,
    refreshFiles,
    clearClipboard: () => setClipboard(null),
  }
}

export default useFileOperations
