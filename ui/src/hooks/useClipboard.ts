// 파일 클립보드 훅 (복사/잘라내기/붙여넣기)
import { useState, useCallback } from 'react'
import { FileInfo } from '../api/files'

type ToastType = 'success' | 'error' | 'info'

interface ClipboardState {
  files: FileInfo[]
  mode: 'copy' | 'cut'
}

interface TransferItemInfo {
  path: string
  name: string
  size?: number
  isDirectory?: boolean
}

interface UseClipboardProps {
  displayFiles: FileInfo[]
  selectedFiles: Set<string>
  selectedFile: FileInfo | null
  currentPath: string
  addToast: (message: string, type: ToastType) => void
  onTransfer: (type: 'move' | 'copy', sources: TransferItemInfo[], destination: string) => void
}

export function useClipboard({
  displayFiles,
  selectedFiles,
  selectedFile,
  currentPath,
  addToast,
  onTransfer,
}: UseClipboardProps) {
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

    const transferType = clipboard.mode === 'copy' ? 'copy' : 'move'
    const sources = clipboard.files.map(file => ({
      path: file.path,
      name: file.name,
      size: file.size,
      isDirectory: file.isDir,
    }))

    onTransfer(transferType, sources, currentPath)

    if (clipboard.mode === 'cut') {
      setClipboard(null)
    }
  }, [clipboard, currentPath, onTransfer])

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
