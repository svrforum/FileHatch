// 파일 업로드 드래그 앤 드롭 훅
import { useState, useCallback, useRef } from 'react'
import { useUploadStore } from '../stores/uploadStore'
import { FileInfo } from '../api/files'

type ToastType = 'success' | 'error' | 'info'

interface UseFileUploadDragDropProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  currentPath: string
  addToast: (message: string, type: ToastType) => void
}

// Helper function to recursively read folder entries
async function readEntriesRecursively(
  entry: FileSystemEntry,
  basePath: string
): Promise<{ file: File; relativePath: string }[]> {
  const results: { file: File; relativePath: string }[] = []

  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    return new Promise((resolve) => {
      fileEntry.file((file) => {
        // Skip hidden files and 0-byte files
        if (!file.name.startsWith('.') && file.size > 0) {
          results.push({ file, relativePath: basePath })
        }
        resolve(results)
      }, () => resolve([]))
    })
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    const reader = dirEntry.createReader()

    const readAllEntries = (): Promise<FileSystemEntry[]> => {
      return new Promise((resolve) => {
        const allEntries: FileSystemEntry[] = []
        const readBatch = () => {
          reader.readEntries((entries) => {
            if (entries.length === 0) {
              resolve(allEntries)
            } else {
              allEntries.push(...entries)
              readBatch()
            }
          }, () => resolve(allEntries))
        }
        readBatch()
      })
    }

    const entries = await readAllEntries()
    for (const childEntry of entries) {
      const childPath = basePath ? `${basePath}/${childEntry.name}` : childEntry.name
      const childResults = await readEntriesRecursively(childEntry, childPath)
      results.push(...childResults)
    }
  }

  return results
}

export function useFileUploadDragDrop({
  containerRef,
  currentPath,
  addToast,
}: UseFileUploadDragDropProps) {
  const uploadStore = useUploadStore()
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [uploadDropTargetPath, setUploadDropTargetPath] = useState<string | null>(null)
  const uploadDropTargetRef = useRef<FileInfo | null>(null)

  const handleFileDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only show dragging state if dragging files (not internal drag)
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingFiles(true)
    }
  }, [])

  const handleFileDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingFiles(true)
    }
  }, [])

  const handleFileDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only reset if leaving the container (not entering a child element)
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const { clientX, clientY } = e
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        setIsDraggingFiles(false)
      }
    }
  }, [containerRef])

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingFiles(false)

    // Check if we can upload to current path
    const isAtRoot = currentPath === '/'
    if (isAtRoot) {
      addToast('홈(/)에서는 업로드할 수 없습니다. 폴더를 선택해주세요.', 'error')
      return
    }

    const items = e.dataTransfer.items
    const files = e.dataTransfer.files

    // Check if any item is a directory (need webkitGetAsEntry for folders)
    let hasDirectory = false
    const entries: FileSystemEntry[] = []

    if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
      // Get all entries synchronously first (before any async operation)
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry()
        if (entry) {
          entries.push(entry)
          if (entry.isDirectory) {
            hasDirectory = true
          }
        }
      }
    }

    // If there are directories, use the entry-based approach for folder structure
    if (hasDirectory && entries.length > 0) {
      const allFiles: { file: File; relativePath: string }[] = []

      for (const entry of entries) {
        const results = await readEntriesRecursively(entry, entry.isDirectory ? entry.name : '')
        allFiles.push(...results)
      }

      if (allFiles.length === 0) {
        addToast('업로드할 파일이 없습니다', 'error')
        return
      }

      // Group files by their folder path and add to upload store
      for (const { file, relativePath } of allFiles) {
        const pathParts = relativePath.split('/')
        pathParts.pop() // Remove filename
        const targetPath = pathParts.length > 0
          ? `${currentPath}/${pathParts.join('/')}`
          : currentPath
        uploadStore.addFiles([file], targetPath)
      }

      // Open upload panel and start uploads
      uploadStore.openPanel()
      setTimeout(() => {
        uploadStore.startAllUploads()
      }, 100)

      addToast(`${allFiles.length}개 파일 업로드를 시작합니다`, 'info')
    } else {
      // For regular files (no directories), use the simpler and more reliable files API
      const fileList = Array.from(files).filter(f => f.size > 0 && !f.name.startsWith('.'))

      if (fileList.length === 0) {
        addToast('업로드할 파일이 없습니다', 'error')
        return
      }

      // Add all files at once to upload store
      uploadStore.addFiles(fileList, currentPath)

      // Open upload panel and start uploads
      uploadStore.openPanel()
      setTimeout(() => {
        uploadStore.startAllUploads()
      }, 100)

      addToast(`${fileList.length}개 파일 업로드를 시작합니다`, 'info')
    }
  }, [currentPath, uploadStore, addToast])

  // Handle drag over a folder (for upload targeting)
  const handleFolderUploadDragOver = useCallback((e: React.DragEvent, folder: FileInfo) => {
    // Only handle if dragging external files (not internal file move)
    if (!e.dataTransfer.types.includes('Files')) return
    if (e.dataTransfer.types.includes('application/x-file-move')) return
    if (!folder.isDir) return

    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setUploadDropTargetPath(folder.path)
    uploadDropTargetRef.current = folder
  }, [])

  // Handle drag leave from a folder
  const handleFolderUploadDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setUploadDropTargetPath(null)
    uploadDropTargetRef.current = null
  }, [])

  // Handle drop on a folder (upload files to that folder)
  const handleFolderUploadDrop = useCallback(async (e: React.DragEvent, folder: FileInfo) => {
    // Only handle if dragging external files (not internal file move)
    if (!e.dataTransfer.types.includes('Files')) return
    if (e.dataTransfer.types.includes('application/x-file-move')) return
    if (!folder.isDir) return

    e.preventDefault()
    e.stopPropagation()
    setIsDraggingFiles(false)
    setUploadDropTargetPath(null)
    uploadDropTargetRef.current = null

    const targetPath = folder.path
    const items = e.dataTransfer.items
    const files = e.dataTransfer.files

    // Check if any item is a directory
    let hasDirectory = false
    const entries: FileSystemEntry[] = []

    if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry()
        if (entry) {
          entries.push(entry)
          if (entry.isDirectory) {
            hasDirectory = true
          }
        }
      }
    }

    if (hasDirectory && entries.length > 0) {
      const allFiles: { file: File; relativePath: string }[] = []

      for (const entry of entries) {
        const results = await readEntriesRecursively(entry, entry.isDirectory ? entry.name : '')
        allFiles.push(...results)
      }

      if (allFiles.length === 0) {
        addToast('업로드할 파일이 없습니다', 'error')
        return
      }

      for (const { file, relativePath } of allFiles) {
        const pathParts = relativePath.split('/')
        pathParts.pop()
        const uploadPath = pathParts.length > 0
          ? `${targetPath}/${pathParts.join('/')}`
          : targetPath
        uploadStore.addFiles([file], uploadPath)
      }

      uploadStore.openPanel()
      setTimeout(() => {
        uploadStore.startAllUploads()
      }, 100)

      addToast(`${allFiles.length}개 파일을 "${folder.name}"에 업로드합니다`, 'info')
    } else {
      const fileList = Array.from(files).filter(f => f.size > 0 && !f.name.startsWith('.'))

      if (fileList.length === 0) {
        addToast('업로드할 파일이 없습니다', 'error')
        return
      }

      uploadStore.addFiles(fileList, targetPath)
      uploadStore.openPanel()
      setTimeout(() => {
        uploadStore.startAllUploads()
      }, 100)

      addToast(`${fileList.length}개 파일을 "${folder.name}"에 업로드합니다`, 'info')
    }
  }, [uploadStore, addToast])

  return {
    isDraggingFiles,
    uploadDropTargetPath,
    handleFileDragOver,
    handleFileDragEnter,
    handleFileDragLeave,
    handleFileDrop,
    handleFolderUploadDragOver,
    handleFolderUploadDragLeave,
    handleFolderUploadDrop,
  }
}
