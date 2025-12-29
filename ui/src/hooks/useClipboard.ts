// 파일 클립보드 훅 (복사/잘라내기/붙여넣기)
import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileInfo, copyItem, moveItem } from '../api/files'
import { HistoryAction } from '../components/filelist/types'

type ToastType = 'success' | 'error' | 'info'

interface ClipboardState {
  files: FileInfo[]
  mode: 'copy' | 'cut'
}

interface UseClipboardProps {
  displayFiles: FileInfo[]
  selectedFiles: Set<string>
  selectedFile: FileInfo | null
  currentPath: string
  addToHistory: (action: HistoryAction) => void
  addToast: (message: string, type: ToastType) => void
}

export function useClipboard({
  displayFiles,
  selectedFiles,
  selectedFile,
  currentPath,
  addToHistory,
  addToast,
}: UseClipboardProps) {
  const queryClient = useQueryClient()
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null)

  const handleCopy = useCallback(() => {
    const files = displayFiles.filter(f => selectedFiles.has(f.path)) || []
    if (files.length === 0 && selectedFile) {
      setClipboard({ files: [selectedFile], mode: 'copy' })
    } else if (files.length > 0) {
      setClipboard({ files, mode: 'copy' })
    }
    addToast(`${files.length || 1}개 항목이 복사되었습니다`, 'info')
  }, [displayFiles, selectedFiles, selectedFile, addToast])

  const handleCut = useCallback(() => {
    const files = displayFiles.filter(f => selectedFiles.has(f.path)) || []
    if (files.length === 0 && selectedFile) {
      setClipboard({ files: [selectedFile], mode: 'cut' })
    } else if (files.length > 0) {
      setClipboard({ files, mode: 'cut' })
    }
    addToast(`${files.length || 1}개 항목이 잘라내기되었습니다`, 'info')
  }, [displayFiles, selectedFiles, selectedFile, addToast])

  const handlePaste = useCallback(async () => {
    if (!clipboard || clipboard.files.length === 0) return

    let successCount = 0
    let errorCount = 0
    const successfulSourcePaths: string[] = []
    const successfulDestPaths: string[] = []

    for (const file of clipboard.files) {
      try {
        if (clipboard.mode === 'copy') {
          await copyItem(file.path, currentPath)
        } else {
          await moveItem(file.path, currentPath)
        }
        successCount++
        successfulSourcePaths.push(file.path)
        const fileName = file.path.split('/').pop() || file.name
        successfulDestPaths.push(`${currentPath}/${fileName}`)
      } catch {
        errorCount++
      }
    }

    if (successfulSourcePaths.length > 0) {
      addToHistory({
        type: clipboard.mode === 'copy' ? 'copy' : 'move',
        sourcePaths: successfulSourcePaths,
        destPaths: successfulDestPaths,
        destination: currentPath
      })
    }

    queryClient.invalidateQueries({ queryKey: ['files', currentPath] })

    if (clipboard.mode === 'cut') {
      const sourceFolders = new Set(clipboard.files.map(f => f.path.split('/').slice(0, -1).join('/')))
      sourceFolders.forEach(path => {
        queryClient.invalidateQueries({ queryKey: ['files', path] })
      })
      setClipboard(null)
    }

    const action = clipboard.mode === 'copy' ? '복사' : '이동'
    if (errorCount === 0) {
      addToast(`${successCount}개 항목이 ${action}되었습니다`, 'success')
    } else {
      addToast(`${successCount}개 ${action} 성공, ${errorCount}개 실패`, 'error')
    }
  }, [clipboard, currentPath, queryClient, addToHistory, addToast])

  const isFileCut = useCallback((filePath: string) => {
    return !!(clipboard?.mode === 'cut' && clipboard.files.some(f => f.path === filePath))
  }, [clipboard])

  return {
    clipboard,
    handleCopy,
    handleCut,
    handlePaste,
    isFileCut,
  }
}
