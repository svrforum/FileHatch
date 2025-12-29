// 내부 파일 드래그 앤 드롭 훅 (파일 이동)
import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileInfo, moveItem } from '../api/files'
import { HistoryAction } from '../components/filelist/types'

type ToastType = 'success' | 'error' | 'info'

interface UseFileDragMoveProps {
  displayFiles: FileInfo[]
  selectedFiles: Set<string>
  currentPath: string
  addToHistory: (action: HistoryAction) => void
  addToast: (message: string, type: ToastType) => void
  setSelectedFiles: (files: Set<string>) => void
  setSelectedFile: (file: FileInfo | null) => void
}

export function useFileDragMove({
  displayFiles,
  selectedFiles,
  currentPath,
  addToHistory,
  addToast,
  setSelectedFiles,
  setSelectedFile,
}: UseFileDragMoveProps) {
  const queryClient = useQueryClient()
  const [draggedFiles, setDraggedFiles] = useState<FileInfo[]>([])
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, file: FileInfo) => {
    e.stopPropagation()
    // If the file being dragged is selected, drag all selected files
    const files = selectedFiles.has(file.path)
      ? displayFiles.filter(f => selectedFiles.has(f.path)) || [file]
      : [file]
    setDraggedFiles(files)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-file-move', JSON.stringify(files.map(f => f.path)))
    // Set drag image
    const dragImage = document.createElement('div')
    dragImage.className = 'drag-ghost'
    dragImage.textContent = files.length > 1 ? `${files.length}개 항목` : file.name
    dragImage.style.cssText = 'position: absolute; top: -1000px; padding: 8px 16px; background: var(--bg-primary); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-size: 14px;'
    document.body.appendChild(dragImage)
    e.dataTransfer.setDragImage(dragImage, 0, 0)
    setTimeout(() => document.body.removeChild(dragImage), 0)
  }, [selectedFiles, displayFiles])

  const handleDragEnd = useCallback(() => {
    setDraggedFiles([])
    setDropTargetPath(null)
  }, [])

  const handleFolderDragOver = useCallback((e: React.DragEvent, folder: FileInfo) => {
    e.preventDefault()
    e.stopPropagation()
    // Only accept if it's an internal file move (not external file upload)
    if (e.dataTransfer.types.includes('application/x-file-move') && folder.isDir) {
      // Don't allow dropping on self or into dragged folders
      const isDraggingSelf = draggedFiles.some(f => f.path === folder.path)
      const isDroppingIntoSelf = draggedFiles.some(f => folder.path.startsWith(f.path + '/'))
      if (!isDraggingSelf && !isDroppingIntoSelf) {
        e.dataTransfer.dropEffect = 'move'
        setDropTargetPath(folder.path)
      }
    }
  }, [draggedFiles])

  const handleFolderDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTargetPath(null)
  }, [])

  const handleFolderDrop = useCallback(async (e: React.DragEvent, folder: FileInfo) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTargetPath(null)

    // Handle internal file move
    if (e.dataTransfer.types.includes('application/x-file-move') && folder.isDir) {
      const filePaths = JSON.parse(e.dataTransfer.getData('application/x-file-move')) as string[]
      let successCount = 0
      let errorCount = 0
      const successfulSourcePaths: string[] = []
      const successfulDestPaths: string[] = []

      for (const filePath of filePaths) {
        // Don't move to self or parent
        if (filePath === folder.path || folder.path.startsWith(filePath + '/')) continue
        try {
          await moveItem(filePath, folder.path)
          successCount++
          successfulSourcePaths.push(filePath)
          const fileName = filePath.split('/').pop() || ''
          successfulDestPaths.push(`${folder.path}/${fileName}`)
        } catch {
          errorCount++
        }
      }

      if (successCount > 0) {
        // Add to history for undo/redo
        addToHistory({
          type: 'move',
          sourcePaths: successfulSourcePaths,
          destPaths: successfulDestPaths,
          destination: folder.path
        })

        queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
        queryClient.invalidateQueries({ queryKey: ['files', folder.path] })
        setSelectedFiles(new Set())
        setSelectedFile(null)

        if (errorCount === 0) {
          addToast(`${successCount}개 항목이 "${folder.name}"(으)로 이동되었습니다`, 'success')
        } else {
          addToast(`${successCount}개 이동 성공, ${errorCount}개 실패`, 'error')
        }
      }
    }

    setDraggedFiles([])
  }, [currentPath, queryClient, addToHistory, addToast, setSelectedFiles, setSelectedFile])

  return {
    draggedFiles,
    dropTargetPath,
    handleDragStart,
    handleDragEnd,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleFolderDrop,
  }
}
