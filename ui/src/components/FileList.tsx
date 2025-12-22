import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchFiles, downloadFileWithProgress, formatFileSize, getFolderStats, renameItem, copyItem, moveToTrash, getFileUrl, getAuthToken, FileInfo, FolderStats, checkOnlyOfficeStatus, getOnlyOfficeConfig, isOnlyOfficeSupported, OnlyOfficeConfig, createFile, fileTypeOptions } from '../api/files'
import { useUploadStore } from '../stores/uploadStore'
import { useFileWatcher } from '../hooks/useFileWatcher'
import ConfirmModal from './ConfirmModal'
import Toast from './Toast'
import TextEditor from './TextEditor'
import FileViewer from './FileViewer'
import OnlyOfficeEditor from './OnlyOfficeEditor'
import './FileList.css'

interface FileListProps {
  currentPath: string
  onNavigate: (path: string) => void
  onUploadClick: () => void
  onNewFolderClick: () => void
}

type SortField = 'name' | 'size' | 'date'
type SortOrder = 'asc' | 'desc'

type ContextMenuType =
  | { type: 'file'; x: number; y: number; file: FileInfo }
  | { type: 'background'; x: number; y: number }
  | null

function FileList({ currentPath, onNavigate, onUploadClick, onNewFolderClick }: FileListProps) {
  const [sortBy, setSortBy] = useState<SortField>('name')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [contextMenu, setContextMenu] = useState<ContextMenuType>(null)
  const [deleteTarget, setDeleteTarget] = useState<FileInfo | null>(null)
  const [renameTarget, setRenameTarget] = useState<FileInfo | null>(null)
  const [newName, setNewName] = useState('')
  const [copyTarget, setCopyTarget] = useState<FileInfo | null>(null)
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [folderStats, setFolderStats] = useState<FolderStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'info' }[]>([])
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [editingFile, setEditingFile] = useState<FileInfo | null>(null)
  const [viewingFile, setViewingFile] = useState<FileInfo | null>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [onlyOfficeAvailable, setOnlyOfficeAvailable] = useState(false)
  const [onlyOfficeFile, setOnlyOfficeFile] = useState<FileInfo | null>(null)
  const [onlyOfficeConfig, setOnlyOfficeConfig] = useState<OnlyOfficeConfig | null>(null)
  const [showNewFileModal, setShowNewFileModal] = useState(false)
  const [newFileType, setNewFileType] = useState('')
  const [newFileName, setNewFileName] = useState('')
  const [showNewFileSubmenu, setShowNewFileSubmenu] = useState(false)
  const queryClient = useQueryClient()
  const containerRef = useRef<HTMLDivElement>(null)
  const uploadStore = useUploadStore()
  const downloadStore = uploadStore

  // Real-time file change notifications via WebSocket
  // Watch paths are stable to avoid reconnection loops
  useFileWatcher({
    watchPaths: ['/home', '/shared'],
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['files', currentPath, sortBy, sortOrder],
    queryFn: () => fetchFiles(currentPath, sortBy, sortOrder),
  })

  // Clear selected file when path changes
  useEffect(() => {
    setSelectedFile(null)
    setSelectedFiles(new Set())
    setFolderStats(null)
  }, [currentPath])

  // Check OnlyOffice availability on mount
  useEffect(() => {
    checkOnlyOfficeStatus().then(({ available }) => {
      setOnlyOfficeAvailable(available)
    })
  }, [])

  // Refresh file list when uploads complete
  useEffect(() => {
    const completedCount = uploadStore.items.filter(i => i.status === 'completed' && i.path === currentPath).length
    if (completedCount > 0) {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
    }
  }, [uploadStore.items, currentPath, queryClient])

  // Fetch folder stats when a folder is selected
  useEffect(() => {
    if (selectedFile?.isDir) {
      setLoadingStats(true)
      getFolderStats(selectedFile.path)
        .then(setFolderStats)
        .catch(() => setFolderStats(null))
        .finally(() => setLoadingStats(false))
    } else {
      setFolderStats(null)
    }
  }, [selectedFile])

  // Load thumbnail for image files
  useEffect(() => {
    if (thumbnailUrl) {
      URL.revokeObjectURL(thumbnailUrl)
      setThumbnailUrl(null)
    }

    if (!selectedFile || selectedFile.isDir) return

    const ext = selectedFile.extension?.toLowerCase() || ''
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']

    if (!imageExts.includes(ext)) return

    const token = getAuthToken()
    const fileUrl = getFileUrl(selectedFile.path)

    fetch(fileUrl, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    })
      .then(res => res.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob)
        setThumbnailUrl(url)
      })
      .catch(() => setThumbnailUrl(null))

    return () => {
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl)
    }
  }, [selectedFile])

  // Check if file is editable (text-based)
  const isEditableFile = useCallback((file: FileInfo): boolean => {
    const ext = file.extension?.toLowerCase() || ''
    const textExts = [
      'txt', 'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'toml',
      'js', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'less',
      'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb',
      'sh', 'bash', 'zsh', 'sql', 'log', 'ini', 'conf', 'cfg', 'env',
      'dockerfile', 'makefile', 'gitignore', 'editorconfig'
    ]
    const fileName = file.name.toLowerCase()
    // Check for special files without extension
    if (['dockerfile', 'makefile', '.gitignore', '.editorconfig', '.env'].includes(fileName)) {
      return true
    }
    return textExts.includes(ext)
  }, [])

  // Check if file is viewable (images, PDFs, videos, audio)
  const isViewableFile = useCallback((file: FileInfo): boolean => {
    const ext = file.extension?.toLowerCase() || ''
    const viewableExts = [
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
      'pdf',
      'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv',
      'mp3', 'wav', 'flac', 'm4a', 'aac'
    ]
    return viewableExts.includes(ext)
  }, [])

  // Handle opening file with OnlyOffice
  const handleOnlyOfficeEdit = useCallback(async (file: FileInfo) => {
    try {
      const config = await getOnlyOfficeConfig(file.path)
      setOnlyOfficeConfig(config)
      setOnlyOfficeFile(file)
    } catch (err) {
      const id = Date.now().toString()
      setToasts((prev) => [...prev, { id, message: err instanceof Error ? err.message : 'OnlyOffice 설정을 불러올 수 없습니다.', type: 'error' }])
    }
  }, [])

  const handleItemDoubleClick = useCallback((file: FileInfo) => {
    if (file.isDir) {
      onNavigate(file.path)
    } else if (isEditableFile(file)) {
      setEditingFile(file)
    } else if (isViewableFile(file)) {
      setViewingFile(file)
    } else if (onlyOfficeAvailable && isOnlyOfficeSupported(file.extension)) {
      handleOnlyOfficeEdit(file)
    } else {
      downloadFileWithProgress(file.path, file.size, downloadStore)
    }
  }, [onNavigate, downloadStore, isEditableFile, isViewableFile, onlyOfficeAvailable, handleOnlyOfficeEdit])

  const handleContextMenu = useCallback((e: React.MouseEvent, file: FileInfo) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ type: 'file', x: e.clientX, y: e.clientY, file })
  }, [])

  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ type: 'background', x: e.clientX, y: e.clientY })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleDeleteClick = useCallback((file: FileInfo) => {
    setDeleteTarget(file)
    closeContextMenu()
  }, [closeContextMenu])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return

    try {
      await moveToTrash(deleteTarget.path)
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
      queryClient.invalidateQueries({ queryKey: ['trash'] })
      setSelectedFile(null)
      const id = Date.now().toString()
      setToasts((prev) => [...prev, { id, message: `"${deleteTarget.name}"이(가) 휴지통으로 이동되었습니다`, type: 'success' }])
    } catch (err) {
      const id = Date.now().toString()
      setToasts((prev) => [...prev, { id, message: err instanceof Error ? err.message : '휴지통으로 이동에 실패했습니다', type: 'error' }])
    }
    setDeleteTarget(null)
  }, [deleteTarget, currentPath, queryClient])

  const handleDownload = useCallback((file: FileInfo) => {
    downloadFileWithProgress(file.path, file.size, downloadStore)
    closeContextMenu()
  }, [closeContextMenu, downloadStore])

  const handleRenameClick = useCallback((file: FileInfo) => {
    setRenameTarget(file)
    setNewName(file.name)
    closeContextMenu()
  }, [closeContextMenu])

  const handleRenameConfirm = useCallback(async () => {
    if (!renameTarget || !newName.trim() || newName === renameTarget.name) {
      setRenameTarget(null)
      return
    }

    try {
      await renameItem(renameTarget.path, newName.trim())
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
      setSelectedFile(null)
      const id = Date.now().toString()
      setToasts((prev) => [...prev, { id, message: `"${renameTarget.name}"이(가) "${newName.trim()}"(으)로 이름이 변경되었습니다`, type: 'success' }])
    } catch (err) {
      const id = Date.now().toString()
      setToasts((prev) => [...prev, { id, message: err instanceof Error ? err.message : '이름 변경에 실패했습니다', type: 'error' }])
    }
    setRenameTarget(null)
    setNewName('')
  }, [renameTarget, newName, currentPath, queryClient])

  const handleCopyClick = useCallback((file: FileInfo) => {
    setCopyTarget(file)
    closeContextMenu()
  }, [closeContextMenu])

  const handleCopyConfirm = useCallback(async () => {
    if (!copyTarget) return

    try {
      await copyItem(copyTarget.path, currentPath)
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
      const id = Date.now().toString()
      setToasts((prev) => [...prev, { id, message: `"${copyTarget.name}"이(가) 복사되었습니다`, type: 'success' }])
    } catch (err) {
      const id = Date.now().toString()
      setToasts((prev) => [...prev, { id, message: err instanceof Error ? err.message : '복사에 실패했습니다', type: 'error' }])
    }
    setCopyTarget(null)
  }, [copyTarget, currentPath, queryClient])

  // Handle creating new file
  const handleNewFileSelect = useCallback((fileType: string) => {
    const option = fileTypeOptions.find(o => o.type === fileType)
    if (option) {
      setNewFileType(fileType)
      setNewFileName(`새 파일${option.extension}`)
      setShowNewFileModal(true)
      setShowNewFileSubmenu(false)
      closeContextMenu()
    }
  }, [])

  const handleNewFileCreate = useCallback(async () => {
    if (!newFileName.trim() || !newFileType) {
      setShowNewFileModal(false)
      return
    }

    try {
      await createFile(currentPath, newFileName.trim(), newFileType)
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
      const id = Date.now().toString()
      setToasts((prev) => [...prev, { id, message: `"${newFileName.trim()}"이(가) 생성되었습니다`, type: 'success' }])
    } catch (err) {
      const id = Date.now().toString()
      setToasts((prev) => [...prev, { id, message: err instanceof Error ? err.message : '파일 생성에 실패했습니다', type: 'error' }])
    }
    setShowNewFileModal(false)
    setNewFileName('')
    setNewFileType('')
  }, [newFileName, newFileType, currentPath, queryClient])

  const handleSelectFile = useCallback((file: FileInfo, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedFiles(prev => {
        const newSet = new Set(prev)
        if (newSet.has(file.path)) {
          newSet.delete(file.path)
        } else {
          newSet.add(file.path)
        }
        return newSet
      })
    } else if (e.shiftKey && data?.files) {
      // Shift+click: select range
      const files = data.files
      const lastSelected = selectedFile?.path
      if (lastSelected) {
        const lastIdx = files.findIndex(f => f.path === lastSelected)
        const currIdx = files.findIndex(f => f.path === file.path)
        const start = Math.min(lastIdx, currIdx)
        const end = Math.max(lastIdx, currIdx)
        const newSet = new Set(selectedFiles)
        for (let i = start; i <= end; i++) {
          newSet.add(files[i].path)
        }
        setSelectedFiles(newSet)
      }
    } else {
      setSelectedFiles(new Set([file.path]))
    }
    setSelectedFile(file)
  }, [selectedFile, selectedFiles, data])

  const handleBulkDelete = useCallback(async () => {
    if (selectedFiles.size === 0) return

    const filesToDelete = data?.files.filter(f => selectedFiles.has(f.path)) || []
    let successCount = 0
    let errorCount = 0

    for (const file of filesToDelete) {
      try {
        await moveToTrash(file.path)
        successCount++
      } catch {
        errorCount++
      }
    }

    queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
    queryClient.invalidateQueries({ queryKey: ['trash'] })
    setSelectedFiles(new Set())
    setSelectedFile(null)

    const id = Date.now().toString()
    if (errorCount === 0) {
      setToasts((prev) => [...prev, { id, message: `${successCount}개 항목이 휴지통으로 이동되었습니다`, type: 'success' }])
    } else {
      setToasts((prev) => [...prev, { id, message: `${successCount}개 이동 성공, ${errorCount}개 실패`, type: 'error' }])
    }
  }, [selectedFiles, data, currentPath, queryClient])

  const goBack = useCallback(() => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/'
    onNavigate(parentPath)
  }, [currentPath, onNavigate])

  // Drag and drop handlers for file upload
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
  }, [])

  // Helper function to recursively read folder entries
  const readEntriesRecursively = async (entry: FileSystemEntry, basePath: string): Promise<{ file: File; relativePath: string }[]> => {
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

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingFiles(false)

    // Check if we can upload to current path
    const isAtRoot = currentPath === '/'
    if (isAtRoot) {
      const id = Date.now().toString()
      setToasts((prev) => [...prev, { id, message: '홈(/)에서는 업로드할 수 없습니다. 폴더를 선택해주세요.', type: 'error' }])
      return
    }

    // Check if we have items with webkitGetAsEntry (for folder support)
    const items = e.dataTransfer.items
    const hasEntries = items && items.length > 0 && items[0].webkitGetAsEntry

    if (hasEntries) {
      // Handle folder uploads using webkitGetAsEntry
      const allFiles: { file: File; relativePath: string }[] = []

      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry()
        if (entry) {
          const results = await readEntriesRecursively(entry, entry.isDirectory ? entry.name : '')
          allFiles.push(...results)
        }
      }

      if (allFiles.length === 0) {
        const id = Date.now().toString()
        setToasts((prev) => [...prev, { id, message: '업로드할 파일이 없습니다', type: 'error' }])
        return
      }

      // Group files by their folder path and add to upload store
      for (const { file, relativePath } of allFiles) {
        // Calculate target path: currentPath + folder structure from dropped folder
        const pathParts = relativePath.split('/')
        pathParts.pop() // Remove filename
        const targetPath = pathParts.length > 0
          ? `${currentPath}/${pathParts.join('/')}`
          : currentPath
        uploadStore.addFiles([file], targetPath)
      }

      // Start all uploads
      setTimeout(() => {
        uploadStore.startAllUploads()
      }, 100)

      const id = Date.now().toString()
      setToasts((prev) => [...prev, { id, message: `${allFiles.length}개 파일 업로드를 시작합니다`, type: 'info' }])
    } else {
      // Fallback for simple file drops
      const files = Array.from(e.dataTransfer.files).filter(f => f.size > 0)
      if (files.length === 0) return

      // Add files to upload store and start uploads
      uploadStore.addFiles(files, currentPath)

      // Start all uploads
      setTimeout(() => {
        uploadStore.startAllUploads()
      }, 100)

      const id = Date.now().toString()
      setToasts((prev) => [...prev, { id, message: `${files.length}개 파일 업로드를 시작합니다`, type: 'info' }])
    }
  }, [currentPath, uploadStore])

  const handleSort = useCallback((field: SortField) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
  }, [sortBy])

  const formatDate = (date: string): string => {
    return new Date(date).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const getFileIcon = (file: FileInfo) => {
    if (file.isDir) {
      // Special icons for root storage folders
      if (file.path === '/home') {
        return (
          <svg className="file-icon folder home" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M3 9L12 2L21 9V20C21 20.5304 20.7893 21.0391 20.4142 21.4142C20.0391 21.7893 19.5304 22 19 22H5C4.46957 22 3.96086 21.7893 3.58579 21.4142C3.21071 21.0391 3 20.5304 3 20V9Z" fill="#10B981" stroke="#10B981" strokeWidth="2"/>
            <path d="M9 22V12H15V22" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )
      }
      if (file.path === '/shared') {
        return (
          <svg className="file-icon folder shared" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" fill="#8B5CF6"/>
            <circle cx="9" cy="7" r="4" fill="#8B5CF6"/>
            <path d="M23 21V19C22.9993 18.1137 22.7044 17.2528 22.1614 16.5523C21.6184 15.8519 20.8581 15.3516 20 15.13M16 3.13C16.8604 3.35031 17.623 3.85071 18.1676 4.55232C18.7122 5.25392 19.0078 6.11683 19.0078 7.005C19.0078 7.89318 18.7122 8.75608 18.1676 9.45769C17.623 10.1593 16.8604 10.6597 16 10.88" stroke="#8B5CF6" strokeWidth="2"/>
          </svg>
        )
      }
      return (
        <svg className="file-icon folder" width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" fill="#3182F6" stroke="#3182F6" strokeWidth="2"/>
        </svg>
      )
    }

    const ext = file.extension?.toLowerCase()
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']
    const videoExts = ['mp4', 'webm', 'avi', 'mov', 'mkv']

    if (imageExts.includes(ext || '')) {
      return (
        <svg className="file-icon image" width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="#10B981" strokeWidth="2"/>
          <circle cx="8.5" cy="8.5" r="1.5" fill="#10B981"/>
          <path d="M21 15L16 10L5 21" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )
    }

    if (videoExts.includes(ext || '')) {
      return (
        <svg className="file-icon video" width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="4" width="20" height="16" rx="2" stroke="#8B5CF6" strokeWidth="2"/>
          <path d="M10 9L15 12L10 15V9Z" fill="#8B5CF6"/>
        </svg>
      )
    }

    return (
      <svg className="file-icon" width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  }

  const getSortIcon = (field: SortField) => {
    if (sortBy !== field) return null
    return sortOrder === 'asc' ? '↑' : '↓'
  }

  // Get display name for path
  const getPathDisplayName = (path: string): string => {
    if (path === '/') return '홈'
    if (path === '/home') return '내 파일'
    if (path === '/shared') return '공유 폴더'
    // Get last segment for nested paths
    const parts = path.split('/').filter(Boolean)
    return parts[parts.length - 1] || '홈'
  }

  return (
    <div
      className={`file-list-container ${isDraggingFiles ? 'dragging-files' : ''}`}
      ref={containerRef}
      onClick={closeContextMenu}
      onContextMenu={handleBackgroundContextMenu}
      onDragOver={handleFileDragOver}
      onDragEnter={handleFileDragEnter}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {/* Drag overlay */}
      {isDraggingFiles && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p>파일을 여기에 놓아 업로드하세요</p>
          </div>
        </div>
      )}
      <div className="file-list-header">
        <div className="breadcrumb">
          {currentPath !== '/' && (
            <button className="back-btn" onClick={goBack}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M19 12H5M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          <h2 className="current-path">
            {getPathDisplayName(currentPath)}
          </h2>
          {data && (
            <span className="file-count">{data.total}개 항목 · {formatFileSize(data.totalSize)}</span>
          )}
        </div>
        <div className="view-options">
          <button
            className="view-btn refresh-btn"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['files', currentPath] })}
            title="새로고침"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M1 4V10H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M23 20V14H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14L18.36 18.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button className="view-btn active">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M8 6H21M8 12H21M8 18H21M3 6H3.01M3 12H3.01M3 18H3.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button className="view-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
              <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
              <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
              <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="loading-state">
          <div className="spinner" />
          <p>파일을 불러오는 중...</p>
        </div>
      )}

      {error && (
        <div className="error-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
            <path d="M12 8V12M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <p>파일을 불러올 수 없습니다</p>
        </div>
      )}

      {data && data.files.length === 0 && (
        <div className="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
            <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2"/>
          </svg>
          <h3>폴더가 비어있습니다</h3>
          <p>파일을 업로드하거나 새 폴더를 만들어보세요</p>
        </div>
      )}

      {data && data.files.length > 0 && (
        <div className="file-table">
          <div className="file-table-header">
            <div className="col-name sortable" onClick={() => handleSort('name')}>
              이름 {getSortIcon('name')}
            </div>
            <div className="col-size sortable" onClick={() => handleSort('size')}>
              크기 {getSortIcon('size')}
            </div>
            <div className="col-date sortable" onClick={() => handleSort('date')}>
              수정일 {getSortIcon('date')}
            </div>
            <div className="col-actions"></div>
          </div>
          <div className="file-table-body">
            {data.files.map((file) => (
              <div
                key={file.path}
                className={`file-row ${selectedFiles.has(file.path) || selectedFile?.path === file.path ? 'selected' : ''}`}
                onClick={(e) => handleSelectFile(file, e)}
                onDoubleClick={() => handleItemDoubleClick(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
              >
                <div className="col-name">
                  {getFileIcon(file)}
                  <span className="file-name">{file.name}</span>
                </div>
                <div className="col-size">{file.isDir ? '-' : formatFileSize(file.size)}</div>
                <div className="col-date">{formatDate(file.modTime)}</div>
                <div className="col-actions">
                  <button className="action-btn" onClick={(e) => { e.stopPropagation(); handleContextMenu(e, file) }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="1" fill="currentColor"/>
                      <circle cx="12" cy="5" r="1" fill="currentColor"/>
                      <circle cx="12" cy="19" r="1" fill="currentColor"/>
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* File Details Panel */}
      {selectedFile && (
        <div className="file-details-panel">
          <div className="details-header">
            <h3>파일 정보</h3>
            <button className="close-details-btn" onClick={() => setSelectedFile(null)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          {thumbnailUrl ? (
            <div className="details-thumbnail" onClick={() => setViewingFile(selectedFile)}>
              <img src={thumbnailUrl} alt={selectedFile.name} />
              <div className="thumbnail-overlay">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M1 12S5 4 12 4S23 12 23 12S19 20 12 20S1 12 1 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                </svg>
              </div>
            </div>
          ) : (
            <div className="details-icon">
              {getFileIcon(selectedFile)}
            </div>
          )}
          <div className="details-name">{selectedFile.name}</div>
          <div className="details-list">
            <div className="details-item">
              <span className="details-label">종류</span>
              <span className="details-value">
                {selectedFile.isDir ? '폴더' : (selectedFile.extension ? selectedFile.extension.toUpperCase() + ' 파일' : '파일')}
              </span>
            </div>
            {selectedFile.isDir ? (
              <>
                {loadingStats ? (
                  <div className="details-item">
                    <span className="details-label">내용</span>
                    <span className="details-value">계산 중...</span>
                  </div>
                ) : folderStats && (
                  <>
                    <div className="details-item">
                      <span className="details-label">내용</span>
                      <span className="details-value">
                        폴더 {folderStats.folderCount}개, 파일 {folderStats.fileCount}개
                      </span>
                    </div>
                    <div className="details-item">
                      <span className="details-label">총 크기</span>
                      <span className="details-value">{formatFileSize(folderStats.totalSize)}</span>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="details-item">
                <span className="details-label">크기</span>
                <span className="details-value">{formatFileSize(selectedFile.size)}</span>
              </div>
            )}
            <div className="details-item">
              <span className="details-label">수정일</span>
              <span className="details-value">{new Date(selectedFile.modTime).toLocaleString('ko-KR')}</span>
            </div>
            <div className="details-item">
              <span className="details-label">경로</span>
              <span className="details-value path">{selectedFile.path}</span>
            </div>
          </div>
          <div className="details-actions">
            {!selectedFile.isDir && (
              <button className="btn-detail-action" onClick={() => downloadFileWithProgress(selectedFile.path, selectedFile.size, downloadStore)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                다운로드
              </button>
            )}
            <button className="btn-detail-action danger" onClick={() => setDeleteTarget(selectedFile)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              삭제
            </button>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'background' ? (
            <>
              <button className="context-menu-item" onClick={() => { closeContextMenu(); onUploadClick(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                파일 업로드
              </button>
              <button className="context-menu-item" onClick={() => { closeContextMenu(); onNewFolderClick(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 11V17M9 14H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                새 폴더
              </button>
              <div className="context-menu-divider" />
              <div
                className="context-menu-item has-submenu"
                onMouseEnter={() => setShowNewFileSubmenu(true)}
                onMouseLeave={() => setShowNewFileSubmenu(false)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 18V12M9 15H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                새 파일
                <svg className="submenu-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {showNewFileSubmenu && (
                  <div className="context-submenu">
                    {fileTypeOptions.map((option) => (
                      <button
                        key={option.type}
                        className="context-menu-item"
                        onClick={() => handleNewFileSelect(option.type)}
                      >
                        {option.icon === 'text' && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2"/>
                            <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2"/>
                            <path d="M8 13H16M8 17H12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                          </svg>
                        )}
                        {option.icon === 'markdown' && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="2"/>
                            <path d="M6 8V16M6 12L9 8V16M14 12L16 8L18 12M14 16V12M18 16V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                        {option.icon === 'html' && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2"/>
                            <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2"/>
                            <path d="M8 13L10 15L8 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M16 13L14 15L16 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                        {option.icon === 'json' && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2"/>
                            <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2"/>
                            <path d="M8 12C8 11 9 11 9 12V13C9 14 8 14 8 14M8 16C8 17 9 17 9 16V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                            <path d="M16 12C16 11 15 11 15 12V13C15 14 16 14 16 14M16 16C16 17 15 17 15 16V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                          </svg>
                        )}
                        {option.icon === 'word' && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="#2B579A" strokeWidth="2"/>
                            <path d="M14 2V8H20" stroke="#2B579A" strokeWidth="2"/>
                            <text x="12" y="16" textAnchor="middle" fontSize="6" fill="#2B579A" fontWeight="bold">W</text>
                          </svg>
                        )}
                        {option.icon === 'excel' && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="#217346" strokeWidth="2"/>
                            <path d="M14 2V8H20" stroke="#217346" strokeWidth="2"/>
                            <text x="12" y="16" textAnchor="middle" fontSize="6" fill="#217346" fontWeight="bold">X</text>
                          </svg>
                        )}
                        {option.icon === 'powerpoint' && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="#D24726" strokeWidth="2"/>
                            <path d="M14 2V8H20" stroke="#D24726" strokeWidth="2"/>
                            <text x="12" y="16" textAnchor="middle" fontSize="6" fill="#D24726" fontWeight="bold">P</text>
                          </svg>
                        )}
                        {option.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {!contextMenu.file.isDir && isEditableFile(contextMenu.file) && (
                <button className="context-menu-item" onClick={() => { setEditingFile(contextMenu.file); closeContextMenu(); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  편집
                </button>
              )}
              {!contextMenu.file.isDir && onlyOfficeAvailable && isOnlyOfficeSupported(contextMenu.file.extension) && (
                <button className="context-menu-item" onClick={() => { handleOnlyOfficeEdit(contextMenu.file); closeContextMenu(); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M8 13H16M8 17H12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  Office 편집
                </button>
              )}
              {!contextMenu.file.isDir && isViewableFile(contextMenu.file) && (
                <button className="context-menu-item" onClick={() => { setViewingFile(contextMenu.file); closeContextMenu(); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M1 12S5 4 12 4S23 12 23 12S19 20 12 20S1 12 1 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                  미리보기
                </button>
              )}
              {!contextMenu.file.isDir && (
                <button className="context-menu-item" onClick={() => handleDownload(contextMenu.file)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  다운로드
                </button>
              )}
              <button className="context-menu-item" onClick={() => handleRenameClick(contextMenu.file)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                이름 변경
              </button>
              <button className="context-menu-item" onClick={() => handleCopyClick(contextMenu.file)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
                  <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" strokeWidth="2"/>
                </svg>
                복사
              </button>
              <div className="context-menu-divider" />
              <button className="context-menu-item danger" onClick={() => handleDeleteClick(contextMenu.file)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                삭제
              </button>
            </>
          )}
        </div>
      )}

      {/* Multi-select action bar */}
      {selectedFiles.size > 1 && (
        <div className="multi-select-bar">
          <span className="select-count">{selectedFiles.size}개 선택됨</span>
          <button className="multi-action-btn danger" onClick={handleBulkDelete}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M19 6V20C19 21.1046 18.1046 22 17 22H7C5.89543 22 5 21.1046 5 20V6" stroke="currentColor" strokeWidth="2"/>
            </svg>
            삭제
          </button>
          <button className="multi-action-btn" onClick={() => setSelectedFiles(new Set())}>
            취소
          </button>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteTarget}
        title="휴지통으로 이동"
        message={deleteTarget ? `"${deleteTarget.name}"을(를) 휴지통으로 이동하시겠습니까? ${deleteTarget.isDir ? '폴더 내의 모든 파일이 함께 이동됩니다.' : ''}` : ''}
        confirmText="휴지통으로 이동"
        cancelText="취소"
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Rename Modal */}
      {renameTarget && (
        <div className="modal-overlay" onClick={() => setRenameTarget(null)}>
          <div className="modal rename-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>이름 변경</h3>
              <button className="modal-close" onClick={() => setRenameTarget(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <input
                type="text"
                className="rename-input"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRenameConfirm()
                  if (e.key === 'Escape') setRenameTarget(null)
                }}
              />
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setRenameTarget(null)}>취소</button>
              <button className="btn-confirm" onClick={handleRenameConfirm} disabled={!newName.trim() || newName === renameTarget.name}>
                변경
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy Confirm Modal */}
      <ConfirmModal
        isOpen={!!copyTarget}
        title="복사 확인"
        message={copyTarget ? `"${copyTarget.name}"을(를) 현재 폴더에 복사하시겠습니까?` : ''}
        confirmText="복사"
        cancelText="취소"
        onConfirm={handleCopyConfirm}
        onCancel={() => setCopyTarget(null)}
      />

      <Toast
        toasts={toasts}
        onRemove={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />

      {/* Text Editor Modal */}
      {editingFile && (
        <TextEditor
          filePath={editingFile.path}
          fileName={editingFile.name}
          onClose={() => setEditingFile(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
            const id = Date.now().toString()
            setToasts((prev) => [...prev, { id, message: '파일이 저장되었습니다', type: 'success' }])
          }}
        />
      )}

      {/* File Viewer Modal */}
      {viewingFile && (
        <FileViewer
          filePath={viewingFile.path}
          fileName={viewingFile.name}
          mimeType={viewingFile.mimeType}
          onClose={() => setViewingFile(null)}
          siblingFiles={data?.files}
          onNavigate={(file) => setViewingFile(file)}
        />
      )}

      {/* OnlyOffice Editor Modal */}
      {onlyOfficeConfig && onlyOfficeFile && (
        <OnlyOfficeEditor
          config={onlyOfficeConfig}
          onClose={() => {
            setOnlyOfficeConfig(null)
            setOnlyOfficeFile(null)
            queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
          }}
          onError={(error) => {
            const id = Date.now().toString()
            setToasts((prev) => [...prev, { id, message: error, type: 'error' }])
          }}
        />
      )}

      {/* New File Modal */}
      {showNewFileModal && (
        <div className="modal-overlay" onClick={() => setShowNewFileModal(false)}>
          <div className="modal new-file-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>새 파일 만들기</h3>
              <button className="modal-close" onClick={() => setShowNewFileModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <label className="input-label">파일 이름</label>
              <input
                type="text"
                className="rename-input"
                value={newFileName}
                onChange={e => setNewFileName(e.target.value)}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') handleNewFileCreate()
                  if (e.key === 'Escape') setShowNewFileModal(false)
                }}
              />
              <p className="input-hint">
                파일 종류: {fileTypeOptions.find(o => o.type === newFileType)?.name}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setShowNewFileModal(false)}>취소</button>
              <button className="btn-confirm" onClick={handleNewFileCreate} disabled={!newFileName.trim()}>
                만들기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FileList
