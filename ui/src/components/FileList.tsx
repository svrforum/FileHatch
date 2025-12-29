import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchFiles, downloadFileWithProgress, formatFileSize, getFolderStats, renameItem, copyItem, moveItem, moveToTrash, getFileUrl, getAuthToken, FileInfo, FolderStats, checkOnlyOfficeStatus, getOnlyOfficeConfig, isOnlyOfficeSupported, OnlyOfficeConfig, createFile, fileTypeOptions, getFileMetadata, updateFileMetadata, getUserTags, FileMetadata, compressFiles, extractZip, downloadAsZip } from '../api/files'
import { getMySharedFolders, SharedFolderWithPermission } from '../api/sharedFolders'
import { getSharedWithMe, getSharedByMe, getMyShareLinks, SharedWithMeItem, SharedByMeItem, LinkShare, deleteFileShare, deleteShareLink } from '../api/fileShares'
import { useUploadStore } from '../stores/uploadStore'
import { useFileWatcher } from '../hooks/useFileWatcher'
import ConfirmModal from './ConfirmModal'
import Toast from './Toast'
import TextEditor from './TextEditor'
import FileViewer from './FileViewer'
import ZipViewer from './ZipViewer'
import OnlyOfficeEditor from './OnlyOfficeEditor'
import ShareModal from './ShareModal'
import LinkShareModal from './LinkShareModal'
import { SortField, SortOrder, ViewMode, ContextMenuType, HistoryAction, SharedFileInfo } from './filelist'
import ShareOptionsDisplay from './filelist/ShareOptionsDisplay'
import './FileList.css'

interface FileListProps {
  currentPath: string
  onNavigate: (path: string) => void
  onUploadClick: () => void
  onNewFolderClick: () => void
  highlightedFilePath?: string | null
  onClearHighlight?: () => void
}

function FileList({ currentPath, onNavigate, onUploadClick, onNewFolderClick, highlightedFilePath, onClearHighlight }: FileListProps) {
  const [sortBy, setSortBy] = useState<SortField>('name')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    // Persist view mode preference
    const saved = localStorage.getItem('fileViewMode')
    return (saved === 'grid' ? 'grid' : 'list') as ViewMode
  })
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
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
  const [zipViewingFile, setZipViewingFile] = useState<FileInfo | null>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [onlyOfficeAvailable, setOnlyOfficeAvailable] = useState(false)
  const [onlyOfficePublicUrl, setOnlyOfficePublicUrl] = useState<string | null>(null)
  const [onlyOfficeFile, setOnlyOfficeFile] = useState<FileInfo | null>(null)
  const [onlyOfficeConfig, setOnlyOfficeConfig] = useState<OnlyOfficeConfig | null>(null)
  const [showNewFileModal, setShowNewFileModal] = useState(false)
  const [newFileType, setNewFileType] = useState('')
  const [newFileName, setNewFileName] = useState('')
  const [showNewFileSubmenu, setShowNewFileSubmenu] = useState(false)
  const [shareTarget, setShareTarget] = useState<FileInfo | null>(null)
  const [linkShareTarget, setLinkShareTarget] = useState<FileInfo | null>(null)
  const [sharedFolders, setSharedFolders] = useState<SharedFolderWithPermission[]>([])
  // Compress modal state
  const [showCompressModal, setShowCompressModal] = useState(false)
  const [compressFileName, setCompressFileName] = useState('')
  const [pathsToCompress, setPathsToCompress] = useState<string[]>([])
  // Download options modal state
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [pathsToDownload, setPathsToDownload] = useState<string[]>([])
  const [downloadingAsZip, setDownloadingAsZip] = useState(false)
  // Clipboard state for copy/cut operations
  const [clipboard, setClipboard] = useState<{ files: FileInfo[]; mode: 'copy' | 'cut' } | null>(null)
  // Drag and drop state for internal file movement
  const [draggedFiles, setDraggedFiles] = useState<FileInfo[]>([])
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  // Marquee selection state
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false)
  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number } | null>(null)
  const [marqueeEnd, setMarqueeEnd] = useState<{ x: number; y: number } | null>(null)
  const fileRowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // Combined history state to avoid stale closure issues
  const [historyState, setHistoryState] = useState<{
    actions: HistoryAction[]
    index: number
  }>({ actions: [], index: -1 })

  // File metadata state (description and tags)
  const [fileMetadata, setFileMetadata] = useState<FileMetadata | null>(null)
  const [loadingMetadata, setLoadingMetadata] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionInput, setDescriptionInput] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [allUserTags, setAllUserTags] = useState<string[]>([])
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])
  // Keyboard search state
  const [searchBuffer, setSearchBuffer] = useState('')
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Add action to history for undo/redo
  const addToHistory = useCallback((action: HistoryAction) => {
    setHistoryState(prev => ({
      actions: [...prev.actions.slice(0, prev.index + 1), action],
      index: prev.index + 1
    }))
  }, [])

  const queryClient = useQueryClient()
  const containerRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const uploadStore = useUploadStore()
  const downloadStore = uploadStore

  // Fetch shared folders for name resolution
  useEffect(() => {
    getMySharedFolders()
      .then(setSharedFolders)
      .catch(() => {})
  }, [])

  // Real-time file change notifications via WebSocket
  // Watch paths are stable to avoid reconnection loops
  useFileWatcher({
    watchPaths: ['/home', '/shared'],
  })

  // Check if current path is a special share view
  const isSharedWithMeView = currentPath === '/shared-with-me'
  const isSharedByMeView = currentPath === '/shared-by-me'
  const isLinkSharesView = currentPath === '/link-shares'
  const isSpecialShareView = isSharedWithMeView || isSharedByMeView || isLinkSharesView

  // Regular file list query
  const { data, isLoading, error } = useQuery({
    queryKey: ['files', currentPath, sortBy, sortOrder],
    queryFn: () => fetchFiles(currentPath, sortBy, sortOrder),
    enabled: !isSpecialShareView,
  })

  // Shared with me query
  const { data: sharedWithMeData, isLoading: sharedWithMeLoading } = useQuery({
    queryKey: ['shared-with-me'],
    queryFn: getSharedWithMe,
    enabled: isSharedWithMeView,
  })

  // Shared by me query
  const { data: sharedByMeData, isLoading: sharedByMeLoading } = useQuery({
    queryKey: ['shared-by-me'],
    queryFn: getSharedByMe,
    enabled: isSharedByMeView,
  })

  // Link shares query
  const { data: linkSharesData, isLoading: linkSharesLoading } = useQuery({
    queryKey: ['link-shares'],
    queryFn: getMyShareLinks,
    enabled: isLinkSharesView,
  })

  // Transform share data to FileInfo format for display
  const getDisplayFiles = useCallback((): FileInfo[] => {
    if (isSharedWithMeView && sharedWithMeData) {
      return sharedWithMeData.map((share: SharedWithMeItem) => ({
        name: share.itemName,
        path: share.itemPath,
        size: 0,
        isDir: share.isFolder,
        modTime: share.createdAt,
        extension: share.isFolder ? undefined : share.itemName.split('.').pop(),
        // Extra fields for display
        sharedBy: share.sharedBy || share.ownerUsername,
        permissionLevel: share.permissionLevel,
        shareId: share.id,
      } as FileInfo & { sharedBy?: string; permissionLevel?: number; shareId?: number }))
    }
    if (isSharedByMeView && sharedByMeData) {
      return sharedByMeData.map((share: SharedByMeItem) => ({
        name: share.itemName,
        path: share.itemPath,
        size: 0,
        isDir: share.isFolder,
        modTime: share.createdAt,
        extension: share.isFolder ? undefined : share.itemName.split('.').pop(),
        // Extra fields for display
        sharedWith: share.sharedWith || share.sharedWithUsername,
        permissionLevel: share.permissionLevel,
        shareId: share.id,
      } as FileInfo & { sharedWith?: string; permissionLevel?: number; shareId?: number }))
    }
    if (isLinkSharesView && linkSharesData) {
      return linkSharesData.map((share: LinkShare) => {
        const name = share.name || share.path.split('/').pop() || share.path
        return {
          name: name,
          path: share.path,
          size: share.size || 0,
          isDir: share.isDir || false,
          modTime: share.createdAt,
          extension: share.isDir ? undefined : (name.includes('.') ? name.split('.').pop() : undefined),
          // Extra fields for display
          linkToken: share.token,
          linkId: share.id,
          accessCount: share.accessCount,
          maxAccess: share.maxAccess,
          expiresAt: share.expiresAt,
          hasPassword: share.hasPassword,
          isActive: share.isActive,
          requireLogin: share.requireLogin,
        } as FileInfo & { linkToken?: string; linkId?: string; accessCount?: number; maxAccess?: number; expiresAt?: string; hasPassword?: boolean; isActive?: boolean; requireLogin?: boolean }
      })
    }
    return data?.files || []
  }, [isSharedWithMeView, isSharedByMeView, isLinkSharesView, sharedWithMeData, sharedByMeData, linkSharesData, data?.files])

  const displayFiles = getDisplayFiles()
  const isLoadingFiles = isLoading || sharedWithMeLoading || sharedByMeLoading || linkSharesLoading

  // Clear selected file when path changes
  useEffect(() => {
    setSelectedFile(null)
    setSelectedFiles(new Set())
    setFolderStats(null)
  }, [currentPath])

  // Adjust context menu position to keep it within viewport
  useEffect(() => {
    if (contextMenu && contextMenuRef.current) {
      const menu = contextMenuRef.current
      const rect = menu.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let adjustedX = contextMenu.x
      let adjustedY = contextMenu.y

      // Adjust horizontal position if menu goes beyond right edge
      if (contextMenu.x + rect.width > viewportWidth - 10) {
        adjustedX = viewportWidth - rect.width - 10
      }

      // Adjust vertical position if menu goes beyond bottom edge
      if (contextMenu.y + rect.height > viewportHeight - 10) {
        adjustedY = viewportHeight - rect.height - 10
      }

      // Make sure menu doesn't go beyond left or top edge
      if (adjustedX < 10) adjustedX = 10
      if (adjustedY < 10) adjustedY = 10

      setContextMenuPosition({ x: adjustedX, y: adjustedY })
    } else {
      setContextMenuPosition(null)
    }
  }, [contextMenu])

  // Check OnlyOffice availability on mount
  useEffect(() => {
    checkOnlyOfficeStatus().then(({ available, publicUrl }) => {
      setOnlyOfficeAvailable(available)
      setOnlyOfficePublicUrl(publicUrl)
    })
  }, [])

  // Refresh file list when uploads complete
  useEffect(() => {
    const completedCount = uploadStore.items.filter(i => i.status === 'completed' && i.path === currentPath).length
    if (completedCount > 0) {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
    }
  }, [uploadStore.items, currentPath, queryClient])

  // Handle highlighted file from search
  useEffect(() => {
    if (highlightedFilePath && displayFiles.length > 0) {
      const file = displayFiles.find(f => f.path === highlightedFilePath)
      if (file) {
        setSelectedFile(file)
        setSelectedFiles(new Set())
        // Scroll to the file if needed
        const index = displayFiles.indexOf(file)
        if (index >= 0) {
          setFocusedIndex(index)
        }
        // Clear the highlight after selecting
        onClearHighlight?.()
      }
    }
  }, [highlightedFilePath, displayFiles, onClearHighlight])

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

  // Keyboard search - type to jump to file
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input, textarea, or contenteditable
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      // Ignore modifier keys and special keys
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.length !== 1) return // Only single character keys

      const pressedKey = e.key.toLowerCase()

      // Clear previous timeout
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }

      // Reset buffer after 500ms of no typing (shorter for better UX)
      searchTimeoutRef.current = setTimeout(() => {
        setSearchBuffer('')
      }, 500)

      // Find matching file
      if (displayFiles.length > 0) {
        // Check if same single character is being repeated
        const isSameChar = searchBuffer.length === 1 && pressedKey === searchBuffer

        // Try accumulated search first
        const accumulatedBuffer = isSameChar ? pressedKey : searchBuffer + pressedKey

        // Get all matching files for accumulated search
        const getMatchingIndices = (searchStr: string) => {
          const indices: number[] = []
          displayFiles.forEach((file, index) => {
            if (file.name.toLowerCase().startsWith(searchStr)) {
              indices.push(index)
            }
          })
          return indices
        }

        let matchingIndices = getMatchingIndices(accumulatedBuffer)
        let useBuffer = accumulatedBuffer

        // If no match with accumulated buffer and it's multi-char, try just the pressed key
        if (matchingIndices.length === 0 && accumulatedBuffer.length > 1) {
          matchingIndices = getMatchingIndices(pressedKey)
          useBuffer = pressedKey
        }

        setSearchBuffer(useBuffer)

        if (matchingIndices.length > 0) {
          let targetIndex: number

          if (isSameChar && matchingIndices.length > 1) {
            // Same character repeated - cycle to next match
            const currentIndex = matchingIndices.indexOf(focusedIndex)
            if (currentIndex >= 0 && currentIndex < matchingIndices.length - 1) {
              // Go to next match
              targetIndex = matchingIndices[currentIndex + 1]
            } else {
              // Wrap around to first match
              targetIndex = matchingIndices[0]
            }
          } else {
            // New search - go to first match
            targetIndex = matchingIndices[0]
          }

          const file = displayFiles[targetIndex]
          setSelectedFile(file)
          setSelectedFiles(new Set([file.path]))
          setFocusedIndex(targetIndex)
          // Scroll to the file
          const fileEl = fileRowRefs.current.get(file.path)
          fileEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [searchBuffer, displayFiles, focusedIndex])

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

  // Load file metadata (description and tags) when file is selected
  useEffect(() => {
    if (!selectedFile) {
      setFileMetadata(null)
      setEditingDescription(false)
      return
    }

    setLoadingMetadata(true)
    getFileMetadata(selectedFile.path)
      .then(metadata => {
        setFileMetadata(metadata)
        setDescriptionInput(metadata.description || '')
      })
      .catch(() => setFileMetadata(null))
      .finally(() => setLoadingMetadata(false))
  }, [selectedFile])

  // Load all user tags for autocomplete
  useEffect(() => {
    getUserTags()
      .then(({ tags }) => setAllUserTags(tags))
      .catch(() => setAllUserTags([]))
  }, [])

  // Filter tag suggestions based on input
  useEffect(() => {
    if (!tagInput.trim()) {
      setTagSuggestions([])
      return
    }
    const query = tagInput.toLowerCase()
    const currentTags = fileMetadata?.tags || []
    const suggestions = allUserTags
      .filter(tag => tag.toLowerCase().includes(query) && !currentTags.includes(tag))
      .slice(0, 5)
    setTagSuggestions(suggestions)
  }, [tagInput, allUserTags, fileMetadata?.tags])

  // Save file description
  const handleSaveDescription = useCallback(async () => {
    if (!selectedFile) return
    try {
      const updated = await updateFileMetadata(selectedFile.path, {
        description: descriptionInput,
        tags: fileMetadata?.tags || []
      })
      setFileMetadata(updated)
      setEditingDescription(false)
      setToasts(prev => [...prev, { id: Date.now().toString(), message: '설명이 저장되었습니다.', type: 'success' }])
    } catch {
      setToasts(prev => [...prev, { id: Date.now().toString(), message: '설명 저장에 실패했습니다.', type: 'error' }])
    }
  }, [selectedFile, descriptionInput, fileMetadata?.tags])

  // Add tag to file
  const handleAddTag = useCallback(async (tag: string) => {
    if (!selectedFile || !tag.trim()) return
    const newTag = tag.trim().toLowerCase()
    const currentTags = fileMetadata?.tags || []
    if (currentTags.includes(newTag)) {
      setTagInput('')
      return
    }
    try {
      const updated = await updateFileMetadata(selectedFile.path, {
        description: fileMetadata?.description || '',
        tags: [...currentTags, newTag]
      })
      setFileMetadata(updated)
      setTagInput('')
      if (!allUserTags.includes(newTag)) {
        setAllUserTags(prev => [...prev, newTag].sort())
      }
    } catch {
      setToasts(prev => [...prev, { id: Date.now().toString(), message: '태그 추가에 실패했습니다.', type: 'error' }])
    }
  }, [selectedFile, fileMetadata, allUserTags])

  // Remove tag from file
  const handleRemoveTag = useCallback(async (tagToRemove: string) => {
    if (!selectedFile || !fileMetadata) return
    const newTags = fileMetadata.tags.filter(t => t !== tagToRemove)
    try {
      const updated = await updateFileMetadata(selectedFile.path, {
        description: fileMetadata.description,
        tags: newTags
      })
      setFileMetadata(updated)
    } catch {
      setToasts(prev => [...prev, { id: Date.now().toString(), message: '태그 삭제에 실패했습니다.', type: 'error' }])
    }
  }, [selectedFile, fileMetadata])

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

  const isZipFile = useCallback((file: FileInfo) => {
    const ext = file.extension?.toLowerCase() || file.name.split('.').pop()?.toLowerCase()
    return ext === 'zip'
  }, [])

  const handleItemDoubleClick = useCallback((file: FileInfo) => {
    if (file.isDir) {
      onNavigate(file.path)
    } else if (isZipFile(file)) {
      setZipViewingFile(file)
    } else if (isEditableFile(file)) {
      setEditingFile(file)
    } else if (isViewableFile(file)) {
      setViewingFile(file)
    } else if (onlyOfficeAvailable && isOnlyOfficeSupported(file.extension)) {
      handleOnlyOfficeEdit(file)
    } else {
      downloadFileWithProgress(file.path, file.size, downloadStore)
    }
  }, [onNavigate, downloadStore, isEditableFile, isViewableFile, isZipFile, onlyOfficeAvailable, handleOnlyOfficeEdit])

  const handleContextMenu = useCallback((e: React.MouseEvent, file: FileInfo) => {
    e.preventDefault()
    e.stopPropagation()
    // If right-clicked file is not in selection, select only that file
    // If right-clicked file is already selected, keep the selection
    let pathsForMenu: string[]
    if (selectedFiles.has(file.path)) {
      // Keep current selection
      pathsForMenu = Array.from(selectedFiles)
    } else {
      // Select only the right-clicked file
      setSelectedFiles(new Set([file.path]))
      setSelectedFile(file)
      pathsForMenu = [file.path]
    }
    setContextMenu({ type: 'file', x: e.clientX, y: e.clientY, file, selectedPaths: pathsForMenu })
  }, [selectedFiles])

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

  // Compress files handler - opens modal to enter filename
  const handleCompress = useCallback((paths: string[]) => {
    if (paths.length === 0) return
    closeContextMenu()
    setPathsToCompress(paths)
    // Generate default filename
    const now = new Date()
    const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const defaultName = paths.length === 1
      ? paths[0].split('/').pop()?.replace(/\.[^/.]+$/, '') || 'archive' // Get filename without extension
      : `archive_${timestamp}`
    setCompressFileName(defaultName)
    setShowCompressModal(true)
  }, [closeContextMenu])

  // Actually execute compression
  const handleCompressConfirm = useCallback(async () => {
    if (pathsToCompress.length === 0 || !compressFileName.trim()) return
    setShowCompressModal(false)

    try {
      const outputName = compressFileName.trim().endsWith('.zip')
        ? compressFileName.trim()
        : `${compressFileName.trim()}.zip`
      const result = await compressFiles(pathsToCompress, outputName)
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
      const id = Date.now().toString()
      setToasts((prev) => [...prev, {
        id,
        message: `${pathsToCompress.length}개 항목이 "${result.outputName}"으로 압축되었습니다`,
        type: 'success'
      }])
      setSelectedFiles(new Set())
    } catch (err) {
      const id = Date.now().toString()
      setToasts((prev) => [...prev, {
        id,
        message: err instanceof Error ? err.message : '압축에 실패했습니다',
        type: 'error'
      }])
    }
    setPathsToCompress([])
    setCompressFileName('')
  }, [pathsToCompress, compressFileName, currentPath, queryClient])

  // Extract zip file handler
  const handleExtract = useCallback(async (file: FileInfo) => {
    closeContextMenu()

    try {
      const result = await extractZip(file.path)
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
      const id = Date.now().toString()
      setToasts((prev) => [...prev, {
        id,
        message: `${result.extractedCount}개 파일이 "${result.extractedPath}"에 압축해제되었습니다`,
        type: 'success'
      }])
    } catch (err) {
      const id = Date.now().toString()
      setToasts((prev) => [...prev, {
        id,
        message: err instanceof Error ? err.message : '압축해제에 실패했습니다',
        type: 'error'
      }])
    }
  }, [closeContextMenu, currentPath, queryClient])

  // Multiple file download handler - opens modal for download options
  const handleMultiDownload = useCallback((paths: string[]) => {
    if (paths.length === 0) return
    closeContextMenu()
    setPathsToDownload(paths)
    setShowDownloadModal(true)
  }, [closeContextMenu])

  // Download as ZIP
  const handleDownloadAsZip = useCallback(async () => {
    if (pathsToDownload.length === 0) return
    setDownloadingAsZip(true)

    try {
      await downloadAsZip(pathsToDownload)
      setShowDownloadModal(false)
      setPathsToDownload([])
      setSelectedFiles(new Set())
      const id = Date.now().toString()
      setToasts((prev) => [...prev, {
        id,
        message: `${pathsToDownload.length}개 파일을 ZIP으로 다운로드 중...`,
        type: 'info'
      }])
    } catch (err) {
      const id = Date.now().toString()
      setToasts((prev) => [...prev, {
        id,
        message: err instanceof Error ? err.message : 'ZIP 다운로드에 실패했습니다',
        type: 'error'
      }])
    } finally {
      setDownloadingAsZip(false)
    }
  }, [pathsToDownload])

  // Download files individually with delay between each to avoid browser blocking
  const handleDownloadIndividually = useCallback(async () => {
    if (pathsToDownload.length === 0) return
    setShowDownloadModal(false)

    // Find file info for each path to get sizes
    const filesToDownload = displayFiles.filter((f: FileInfo) => pathsToDownload.includes(f.path))
    const filesToDownloadFiltered = filesToDownload.filter((f: FileInfo) => !f.isDir)

    setPathsToDownload([])
    setSelectedFiles(new Set())
    const id = Date.now().toString()
    setToasts((prev) => [...prev, {
      id,
      message: `${filesToDownloadFiltered.length}개 파일 개별 다운로드 시작`,
      type: 'info'
    }])

    // Download each file with a delay to prevent browser from blocking multiple downloads
    for (let i = 0; i < filesToDownloadFiltered.length; i++) {
      const file = filesToDownloadFiltered[i]
      downloadFileWithProgress(file.path, file.size, downloadStore)

      // Add delay between downloads (except for the last one)
      if (i < filesToDownloadFiltered.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
  }, [pathsToDownload, displayFiles, downloadStore])

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

    const trimmedName = newName.trim()
    const dir = renameTarget.path.split('/').slice(0, -1).join('/')
    const newPath = `${dir}/${trimmedName}`

    try {
      await renameItem(renameTarget.path, trimmedName)

      // Add to history for undo/redo
      addToHistory({
        type: 'rename',
        sourcePaths: [renameTarget.path],
        destPaths: [newPath],
        oldName: renameTarget.name,
        newName: trimmedName
      })

      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
      setSelectedFile(null)
      const id = Date.now().toString()
      setToasts((prev) => [...prev, { id, message: `"${renameTarget.name}"이(가) "${trimmedName}"(으)로 이름이 변경되었습니다`, type: 'success' }])
    } catch (err) {
      const id = Date.now().toString()
      setToasts((prev) => [...prev, { id, message: err instanceof Error ? err.message : '이름 변경에 실패했습니다', type: 'error' }])
    }
    setRenameTarget(null)
    setNewName('')
  }, [renameTarget, newName, currentPath, queryClient, addToHistory])

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
    } else if (e.shiftKey && displayFiles) {
      // Shift+click: select range
      const files = displayFiles
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

    const filesToDelete = displayFiles.filter(f => selectedFiles.has(f.path)) || []
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

  // Clipboard operations
  const handleCopy = useCallback(() => {
    const files = displayFiles.filter(f => selectedFiles.has(f.path)) || []
    if (files.length === 0 && selectedFile) {
      setClipboard({ files: [selectedFile], mode: 'copy' })
    } else if (files.length > 0) {
      setClipboard({ files, mode: 'copy' })
    }
    const id = Date.now().toString()
    setToasts((prev) => [...prev, { id, message: `${files.length || 1}개 항목이 복사되었습니다`, type: 'info' }])
  }, [selectedFiles, selectedFile, data])

  const handleCut = useCallback(() => {
    const files = displayFiles.filter(f => selectedFiles.has(f.path)) || []
    if (files.length === 0 && selectedFile) {
      setClipboard({ files: [selectedFile], mode: 'cut' })
    } else if (files.length > 0) {
      setClipboard({ files, mode: 'cut' })
    }
    const id = Date.now().toString()
    setToasts((prev) => [...prev, { id, message: `${files.length || 1}개 항목이 잘라내기되었습니다`, type: 'info' }])
  }, [selectedFiles, selectedFile, data])

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
        // Calculate destination path
        const fileName = file.path.split('/').pop() || file.name
        successfulDestPaths.push(`${currentPath}/${fileName}`)
      } catch {
        errorCount++
      }
    }

    // Add to history for undo/redo
    if (successfulSourcePaths.length > 0) {
      addToHistory({
        type: clipboard.mode === 'copy' ? 'copy' : 'move',
        sourcePaths: successfulSourcePaths,
        destPaths: successfulDestPaths,
        destination: currentPath
      })
    }

    queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
    // If cut, also refresh the source folder
    if (clipboard.mode === 'cut') {
      const sourceFolders = new Set(clipboard.files.map(f => f.path.split('/').slice(0, -1).join('/')))
      sourceFolders.forEach(path => {
        queryClient.invalidateQueries({ queryKey: ['files', path] })
      })
      setClipboard(null) // Clear clipboard after cut-paste
    }

    const id = Date.now().toString()
    const action = clipboard.mode === 'copy' ? '복사' : '이동'
    if (errorCount === 0) {
      setToasts((prev) => [...prev, { id, message: `${successCount}개 항목이 ${action}되었습니다`, type: 'success' }])
    } else {
      setToasts((prev) => [...prev, { id, message: `${successCount}개 ${action} 성공, ${errorCount}개 실패`, type: 'error' }])
    }
  }, [clipboard, currentPath, queryClient, addToHistory])

  // Drag and Drop handlers for internal file movement
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
  }, [selectedFiles, data])

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

        const id = Date.now().toString()
        if (errorCount === 0) {
          setToasts((prev) => [...prev, { id, message: `${successCount}개 항목이 "${folder.name}"(으)로 이동되었습니다`, type: 'success' }])
        } else {
          setToasts((prev) => [...prev, { id, message: `${successCount}개 이동 성공, ${errorCount}개 실패`, type: 'error' }])
        }
      }
    }

    setDraggedFiles([])
  }, [currentPath, queryClient, addToHistory])

  // Marquee selection handlers
  const handleMarqueeStart = useCallback((e: React.MouseEvent) => {
    // Only start if clicking on background (not on a file or UI elements)
    if ((e.target as HTMLElement).closest('.file-row, .file-card, .multi-select-bar, .context-menu, .modal')) return
    // Only on left click
    if (e.button !== 0) return

    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left + container.scrollLeft
    const y = e.clientY - rect.top + container.scrollTop

    setIsMarqueeSelecting(true)
    setMarqueeStart({ x, y })
    setMarqueeEnd({ x, y })

    // Clear selection unless holding Ctrl/Cmd
    if (!e.ctrlKey && !e.metaKey) {
      setSelectedFiles(new Set())
      setSelectedFile(null)
    }
  }, [])

  const handleMarqueeMove = useCallback((e: React.MouseEvent) => {
    if (!isMarqueeSelecting || !marqueeStart) return

    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left + container.scrollLeft
    const y = e.clientY - rect.top + container.scrollTop

    setMarqueeEnd({ x, y })

    // Calculate marquee rectangle
    const minX = Math.min(marqueeStart.x, x)
    const maxX = Math.max(marqueeStart.x, x)
    const minY = Math.min(marqueeStart.y, y)
    const maxY = Math.max(marqueeStart.y, y)

    // Check intersection with file items
    const newSelection = new Set<string>()
    fileRowRefs.current.forEach((element, path) => {
      const elemRect = element.getBoundingClientRect()
      const elemLeft = elemRect.left - rect.left + container.scrollLeft
      const elemTop = elemRect.top - rect.top + container.scrollTop
      const elemRight = elemLeft + elemRect.width
      const elemBottom = elemTop + elemRect.height

      // Check if rectangles intersect
      if (!(elemRight < minX || elemLeft > maxX || elemBottom < minY || elemTop > maxY)) {
        newSelection.add(path)
      }
    })

    setSelectedFiles(newSelection)
    if (newSelection.size > 0) {
      const firstPath = Array.from(newSelection)[0]
      const file = displayFiles.find(f => f.path === firstPath)
      if (file) setSelectedFile(file)
    }
  }, [isMarqueeSelecting, marqueeStart, data])

  const handleMarqueeEnd = useCallback(() => {
    setIsMarqueeSelecting(false)
    setMarqueeStart(null)
    setMarqueeEnd(null)
  }, [])

  // Undo handler
  const handleUndo = useCallback(async () => {
    if (historyState.index < 0 || historyState.actions.length === 0) {
      const id = Date.now().toString()
      setToasts(prev => [...prev, { id, message: '실행취소할 작업이 없습니다', type: 'info' }])
      return
    }

    const action = historyState.actions[historyState.index]
    try {
      switch (action.type) {
        case 'move':
          // Move files back to original location
          if (action.destPaths && action.destPaths.length > 0) {
            for (let i = 0; i < action.destPaths.length; i++) {
              const destPath = action.destPaths[i]
              const originalDir = action.sourcePaths[i].split('/').slice(0, -1).join('/')
              await moveItem(destPath, originalDir)
            }
          }
          break
        case 'rename':
          // Rename back to original name
          if (action.oldName && action.newName && action.destPaths?.[0]) {
            await renameItem(action.destPaths[0], action.oldName)
          }
          break
        case 'delete': {
          // Cannot undo delete (trash) - would need restore API
          const id = Date.now().toString()
          setToasts(prev => [...prev, { id, message: '삭제는 휴지통에서 복원해주세요', type: 'info' }])
          return
        }
        case 'copy':
          // Undo copy by moving copied files to trash
          if (action.destPaths && action.destPaths.length > 0) {
            for (const destPath of action.destPaths) {
              await moveToTrash(destPath)
            }
          }
          break
      }

      setHistoryState(prev => ({ ...prev, index: prev.index - 1 }))
      queryClient.invalidateQueries({ queryKey: ['files'] })
      const id = Date.now().toString()
      setToasts(prev => [...prev, { id, message: '실행취소되었습니다', type: 'success' }])
    } catch (err) {
      const id = Date.now().toString()
      setToasts(prev => [...prev, { id, message: '실행취소에 실패했습니다', type: 'error' }])
    }
  }, [historyState, queryClient])

  // Redo handler
  const handleRedo = useCallback(async () => {
    if (historyState.index >= historyState.actions.length - 1) {
      const id = Date.now().toString()
      setToasts(prev => [...prev, { id, message: '다시실행할 작업이 없습니다', type: 'info' }])
      return
    }

    const action = historyState.actions[historyState.index + 1]
    try {
      switch (action.type) {
        case 'move':
          if (action.destination) {
            for (const sourcePath of action.sourcePaths) {
              await moveItem(sourcePath, action.destination)
            }
          }
          break
        case 'rename':
          if (action.oldName && action.newName && action.sourcePaths[0]) {
            await renameItem(action.sourcePaths[0], action.newName)
          }
          break
        case 'copy':
          // Redo copy - copy files again
          if (action.destination) {
            for (const sourcePath of action.sourcePaths) {
              await copyItem(sourcePath, action.destination)
            }
          }
          break
        case 'delete': {
          const id = Date.now().toString()
          setToasts(prev => [...prev, { id, message: '삭제는 다시실행할 수 없습니다', type: 'info' }])
          return
        }
      }

      setHistoryState(prev => ({ ...prev, index: prev.index + 1 }))
      queryClient.invalidateQueries({ queryKey: ['files'] })
      const id = Date.now().toString()
      setToasts(prev => [...prev, { id, message: '다시실행되었습니다', type: 'success' }])
    } catch (err) {
      const id = Date.now().toString()
      setToasts(prev => [...prev, { id, message: '다시실행에 실패했습니다', type: 'error' }])
    }
  }, [historyState, queryClient])

  // Check if we can go back (not at root level of home/shared or at shared drive root)
  const canGoBack = useCallback(() => {
    // Root paths where back button should not appear
    const rootPaths = ['/', '/home', '/shared']
    if (rootPaths.includes(currentPath)) return false

    // Also hide back button at shared drive root level (e.g., /shared/111)
    // Users cannot navigate to /shared/ directly
    if (currentPath.startsWith('/shared/')) {
      const sharedParts = currentPath.substring(8).split('/') // Remove '/shared/'
      if (sharedParts.length === 1) {
        return false // At shared drive root, no back button
      }
    }

    return true
  }, [currentPath])

  const goBack = useCallback(() => {
    const parts = currentPath.split('/').filter(Boolean)
    if (parts.length <= 1) {
      // Already at root level, go to home
      onNavigate('/home')
      return
    }

    // For shared paths, prevent going to /shared/ root
    if (currentPath.startsWith('/shared/')) {
      const sharedParts = currentPath.substring(8).split('/') // Remove '/shared/'
      if (sharedParts.length <= 1) {
        // At shared drive root, go to home instead
        onNavigate('/home')
        return
      }
      if (sharedParts.length === 2) {
        // One level deep in shared drive, go to shared drive root
        onNavigate('/shared/' + sharedParts[0])
        return
      }
    }

    const parentPath = '/' + parts.slice(0, -1).join('/')

    // Never navigate to /shared directly
    if (parentPath === '/shared') {
      onNavigate('/home')
      return
    }

    onNavigate(parentPath)
  }, [currentPath, onNavigate])

  // Toggle view mode and persist
  const toggleViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    localStorage.setItem('fileViewMode', mode)
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      const files = displayFiles || []
      if (files.length === 0) return

      // Calculate grid columns for grid view navigation
      const getGridColumns = () => {
        const gridElement = containerRef.current?.querySelector('.file-grid') as HTMLElement
        if (!gridElement) return 1
        // Get computed style - grid-template-columns returns something like "140px 140px 140px 140px"
        const gridStyle = window.getComputedStyle(gridElement)
        const columnsStr = gridStyle.getPropertyValue('grid-template-columns')
        // Filter out empty strings and count actual column values
        const columns = columnsStr.split(' ').filter(s => s.trim() !== '').length
        // Fallback: calculate from container width and item width
        if (columns <= 1) {
          const firstCard = gridElement.querySelector('.file-card') as HTMLElement
          if (firstCard) {
            const cardWidth = firstCard.offsetWidth + 16 // 16 is gap
            const gridWidth = gridElement.clientWidth
            return Math.max(1, Math.floor(gridWidth / cardWidth))
          }
        }
        return columns || 1
      }

      const navigateTo = (newIndex: number) => {
        if (newIndex >= 0 && newIndex < files.length) {
          setFocusedIndex(newIndex)
          setSelectedFile(files[newIndex])
          setSelectedFiles(new Set([files[newIndex].path]))
        }
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          if (viewMode === 'grid') {
            const cols = getGridColumns()
            navigateTo(Math.min(focusedIndex + cols, files.length - 1))
          } else {
            navigateTo(Math.min(focusedIndex + 1, files.length - 1))
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          if (viewMode === 'grid') {
            const cols = getGridColumns()
            navigateTo(Math.max(focusedIndex - cols, 0))
          } else {
            navigateTo(Math.max(focusedIndex - 1, 0))
          }
          break
        case 'ArrowLeft':
          if (viewMode === 'grid') {
            e.preventDefault()
            navigateTo(Math.max(focusedIndex - 1, 0))
          }
          break
        case 'ArrowRight':
          if (viewMode === 'grid') {
            e.preventDefault()
            navigateTo(Math.min(focusedIndex + 1, files.length - 1))
          }
          break
        case 'Enter':
          e.preventDefault()
          if (focusedIndex >= 0 && focusedIndex < files.length) {
            handleItemDoubleClick(files[focusedIndex])
          }
          break
        case 'Delete':
        case 'Backspace':
          if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) {
            e.preventDefault()
            if (selectedFiles.size > 0) {
              const filesToDelete = files.filter(f => selectedFiles.has(f.path))
              if (filesToDelete.length === 1) {
                setDeleteTarget(filesToDelete[0])
              } else if (filesToDelete.length > 1) {
                handleBulkDelete()
              }
            } else if (selectedFile) {
              setDeleteTarget(selectedFile)
            }
          }
          break
        case 'Escape':
          // Don't handle ESC if any modal is open (modals handle their own ESC)
          if (!viewingFile && !editingFile && !onlyOfficeConfig && !deleteTarget && !renameTarget && !showNewFileModal && !showCompressModal && !showDownloadModal) {
            setSelectedFile(null)
            setSelectedFiles(new Set())
            setFocusedIndex(-1)
          }
          break
        case 'a':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            setSelectedFiles(new Set(files.map(f => f.path)))
          }
          break
        case 'c':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            handleCopy()
          }
          break
        case 'x':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            handleCut()
          }
          break
        case 'v':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            handlePaste()
          }
          break
        case 'F2':
          e.preventDefault()
          if (selectedFile) {
            setRenameTarget(selectedFile)
            setNewName(selectedFile.name)
          }
          break
        case 'z':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            handleUndo()
          }
          break
        case 'y':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            handleRedo()
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [data, focusedIndex, selectedFile, selectedFiles, handleItemDoubleClick, handleBulkDelete, handleCopy, handleCut, handlePaste, handleUndo, handleRedo])

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
    const now = new Date()
    const fileDate = new Date(date)
    const diffMs = now.getTime() - fileDate.getTime()
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

    // Within 24 hours - show relative time
    if (diffMs < 24 * 60 * 60 * 1000 && diffMs >= 0) {
      if (diffMinutes < 1) {
        return '방금 전'
      } else if (diffMinutes < 60) {
        return `${diffMinutes}분 전`
      } else {
        return `${diffHours}시간 전`
      }
    }

    // Older than 24 hours - show date
    return fileDate.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const getFullDateTime = (date: string): string => {
    return new Date(date).toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
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

    // Word documents
    const wordExts = ['doc', 'docx', 'odt', 'rtf']
    if (wordExts.includes(ext || '')) {
      return (
        <svg className="file-icon word" width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#2B579A" stroke="#2B579A" strokeWidth="1"/>
          <path d="M14 2V8H20" stroke="#1A3A6B" strokeWidth="1"/>
          <text x="12" y="17" textAnchor="middle" fontSize="7" fill="white" fontWeight="bold">W</text>
        </svg>
      )
    }

    // Excel spreadsheets
    const excelExts = ['xls', 'xlsx', 'ods', 'csv']
    if (excelExts.includes(ext || '')) {
      return (
        <svg className="file-icon excel" width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#217346" stroke="#217346" strokeWidth="1"/>
          <path d="M14 2V8H20" stroke="#165232" strokeWidth="1"/>
          <text x="12" y="17" textAnchor="middle" fontSize="7" fill="white" fontWeight="bold">X</text>
        </svg>
      )
    }

    // PowerPoint presentations
    const pptExts = ['ppt', 'pptx', 'odp']
    if (pptExts.includes(ext || '')) {
      return (
        <svg className="file-icon powerpoint" width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#D24726" stroke="#D24726" strokeWidth="1"/>
          <path d="M14 2V8H20" stroke="#A33B1E" strokeWidth="1"/>
          <text x="12" y="17" textAnchor="middle" fontSize="7" fill="white" fontWeight="bold">P</text>
        </svg>
      )
    }

    // PDF files
    if (ext === 'pdf') {
      return (
        <svg className="file-icon pdf" width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#E53935" stroke="#E53935" strokeWidth="1"/>
          <path d="M14 2V8H20" stroke="#B71C1C" strokeWidth="1"/>
          <text x="12" y="17" textAnchor="middle" fontSize="5" fill="white" fontWeight="bold">PDF</text>
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
    if (path === '/shared') return '공유 드라이브'

    // Handle shared folder paths
    const parts = path.split('/').filter(Boolean)
    if (parts[0] === 'shared' && parts.length >= 2) {
      // parts[1] is the folder name - check if it's a shared drive
      const folderName = parts[1]
      const folder = sharedFolders.find(f => f.name === folderName)
      if (folder) {
        // If we're at the shared folder root, show folder name
        if (parts.length === 2) {
          return folder.name
        }
        // If we're in a subfolder, show the subfolder name
        return parts[parts.length - 1]
      }
    }

    // Get last segment for nested paths
    return parts[parts.length - 1] || '홈'
  }

  // Calculate marquee box position
  const marqueeStyle = marqueeStart && marqueeEnd ? {
    left: Math.min(marqueeStart.x, marqueeEnd.x),
    top: Math.min(marqueeStart.y, marqueeEnd.y),
    width: Math.abs(marqueeEnd.x - marqueeStart.x),
    height: Math.abs(marqueeEnd.y - marqueeStart.y),
  } : null

  return (
    <div
      className={`file-list-container ${isDraggingFiles ? 'dragging-files' : ''} ${isMarqueeSelecting ? 'marquee-selecting' : ''}`}
      ref={containerRef}
      onClick={closeContextMenu}
      onContextMenu={handleBackgroundContextMenu}
      onDragOver={handleFileDragOver}
      onDragEnter={handleFileDragEnter}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
      onMouseDown={handleMarqueeStart}
      onMouseMove={handleMarqueeMove}
      onMouseUp={handleMarqueeEnd}
      onMouseLeave={handleMarqueeEnd}
    >
      {/* Marquee selection box */}
      {isMarqueeSelecting && marqueeStyle && (
        <div
          className="marquee-selection-box"
          style={{
            left: marqueeStyle.left,
            top: marqueeStyle.top,
            width: marqueeStyle.width,
            height: marqueeStyle.height,
          }}
        />
      )}
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
          {canGoBack() && (
            <button className="back-btn" onClick={goBack} title="상위 폴더로 이동">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M19 12H5M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          <h2 className="current-path">
            {getPathDisplayName(currentPath)}
          </h2>
          {data && (
            <span className="file-count">
              {selectedFiles.size > 1
                ? `${selectedFiles.size}개 선택됨`
                : `${data.total}개 항목 · ${formatFileSize(data.totalSize)}`
              }
            </span>
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
          <button
            className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => toggleViewMode('list')}
            title="리스트 보기"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M8 6H21M8 12H21M8 18H21M3 6H3.01M3 12H3.01M3 18H3.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => toggleViewMode('grid')}
            title="그리드 보기"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
              <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
              <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
              <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </button>
        </div>
      </div>

      {isLoadingFiles && (
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

      {(data || isSpecialShareView) && displayFiles.length === 0 && !isLoadingFiles && (
        <div className="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
            <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2"/>
          </svg>
          {isSharedWithMeView ? (
            <>
              <h3>나에게 공유된 파일이 없습니다</h3>
              <p>다른 사용자가 파일을 공유하면 여기에 표시됩니다</p>
            </>
          ) : isSharedByMeView ? (
            <>
              <h3>다른 사용자에게 공유한 파일이 없습니다</h3>
              <p>파일을 공유하면 여기에 표시됩니다</p>
            </>
          ) : isLinkSharesView ? (
            <>
              <h3>링크로 공유된 파일이 없습니다</h3>
              <p>파일의 공유 링크를 생성하면 여기에 표시됩니다</p>
            </>
          ) : (
            <>
              <h3>폴더가 비어있습니다</h3>
              <p>파일을 업로드하거나 새 폴더를 만들어보세요</p>
              <div className="empty-actions">
                <button className="empty-action-btn primary" onClick={onUploadClick}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  파일 업로드
                </button>
                <button className="empty-action-btn" onClick={onNewFolderClick}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M12 11V17M9 14H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  새 폴더
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {(data || isSpecialShareView) && displayFiles.length > 0 && viewMode === 'list' && (
        <div className={`file-table ${isSpecialShareView ? 'share-view' : ''}`}>
          <div className="file-table-header">
            <div className="col-name sortable" onClick={() => handleSort('name')}>
              이름 {getSortIcon('name')}
            </div>
            {isSharedWithMeView && (
              <div className="col-share-info">공유자</div>
            )}
            {isSharedByMeView && (
              <div className="col-share-info">공유 대상</div>
            )}
            {isLinkSharesView && (
              <div className="col-share-options">공유 옵션</div>
            )}
            <div className="col-size sortable" onClick={() => handleSort('size')}>
              크기 {getSortIcon('size')}
            </div>
            <div className="col-date sortable" onClick={() => handleSort('date')}>
              {isSpecialShareView ? '공유일' : '수정일'} {getSortIcon('date')}
            </div>
            {isSpecialShareView && (
              <div className="col-unshare"></div>
            )}
            <div className="col-actions"></div>
          </div>
          <div className="file-table-body">
            {displayFiles.map((file, index) => (
              <div
                key={file.path}
                ref={(el) => { if (el) fileRowRefs.current.set(file.path, el); else fileRowRefs.current.delete(file.path); }}
                className={`file-row ${selectedFiles.has(file.path) || selectedFile?.path === file.path ? 'selected' : ''} ${focusedIndex === index ? 'focused' : ''} ${dropTargetPath === file.path ? 'drop-target' : ''} ${draggedFiles.some(f => f.path === file.path) ? 'dragging' : ''} ${clipboard?.mode === 'cut' && clipboard.files.some(f => f.path === file.path) ? 'cut' : ''}`}
                onClick={(e) => { handleSelectFile(file, e); setFocusedIndex(index); }}
                onDoubleClick={() => handleItemDoubleClick(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
                draggable
                onDragStart={(e) => handleDragStart(e, file)}
                onDragEnd={handleDragEnd}
                onDragOver={file.isDir ? (e) => handleFolderDragOver(e, file) : undefined}
                onDragLeave={file.isDir ? handleFolderDragLeave : undefined}
                onDrop={file.isDir ? (e) => handleFolderDrop(e, file) : undefined}
              >
                <div className="col-name">
                  {getFileIcon(file)}
                  <span className="file-name">{file.name}</span>
                </div>
                {/* Shared with me - show who shared it */}
                {isSharedWithMeView && (
                  <div className="col-share-info">
                    <span className="shared-with-user">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2"/>
                        <path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                      {(file as FileInfo & { sharedBy?: string }).sharedBy || '알 수 없음'}
                    </span>
                    <span className={`permission-tag ${(file as FileInfo & { permissionLevel?: number }).permissionLevel === 2 ? 'rw' : 'r'}`}>
                      {(file as FileInfo & { permissionLevel?: number }).permissionLevel === 2 ? '읽기/쓰기' : '읽기 전용'}
                    </span>
                  </div>
                )}
                {/* Shared by me - show who it's shared with */}
                {isSharedByMeView && (
                  <div className="col-share-info">
                    <span className="shared-with-user">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2"/>
                        <path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                      {(file as FileInfo & { sharedWith?: string }).sharedWith || '알 수 없음'}
                    </span>
                    <span className={`permission-tag ${(file as FileInfo & { permissionLevel?: number }).permissionLevel === 2 ? 'rw' : 'r'}`}>
                      {(file as FileInfo & { permissionLevel?: number }).permissionLevel === 2 ? '읽기/쓰기' : '읽기 전용'}
                    </span>
                  </div>
                )}
                {/* Link shares - show share options */}
                {isLinkSharesView && (
                  <div className="col-share-options">
                    <ShareOptionsDisplay file={file as SharedFileInfo} />
                  </div>
                )}
                <div className="col-size">{file.isDir ? '-' : formatFileSize(file.size)}</div>
                <div className="col-date" title={getFullDateTime(file.modTime)}>{formatDate(file.modTime)}</div>
                {/* Unshare button for share views */}
                {isSharedByMeView && (
                  <div className="col-unshare">
                    <button
                      className="unshare-btn"
                      title="공유 해제"
                      onClick={async (e) => {
                        e.stopPropagation()
                        const shareFile = file as FileInfo & { shareId?: number }
                        if (shareFile.shareId) {
                          try {
                            await deleteFileShare(shareFile.shareId)
                            queryClient.invalidateQueries({ queryKey: ['shared-by-me'] })
                            setToasts(prev => [...prev, { id: Date.now().toString(), message: '공유가 해제되었습니다', type: 'success' }])
                          } catch {
                            setToasts(prev => [...prev, { id: Date.now().toString(), message: '공유 해제에 실패했습니다', type: 'error' }])
                          }
                        }
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                )}
                {isLinkSharesView && (
                  <div className="col-unshare">
                    <button
                      className="copy-link-btn"
                      title="링크 복사"
                      onClick={(e) => {
                        e.stopPropagation()
                        const linkFile = file as FileInfo & { linkToken?: string }
                        if (linkFile.linkToken) {
                          navigator.clipboard.writeText(`${window.location.origin}/s/${linkFile.linkToken}`)
                          setToasts(prev => [...prev, { id: Date.now().toString(), message: '링크가 클립보드에 복사되었습니다', type: 'success' }])
                        }
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
                        <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                    </button>
                    <button
                      className="unshare-btn"
                      title="링크 삭제"
                      onClick={async (e) => {
                        e.stopPropagation()
                        const linkFile = file as FileInfo & { linkId?: string }
                        if (linkFile.linkId) {
                          try {
                            await deleteShareLink(linkFile.linkId)
                            queryClient.invalidateQueries({ queryKey: ['link-shares'] })
                            setToasts(prev => [...prev, { id: Date.now().toString(), message: '링크가 삭제되었습니다', type: 'success' }])
                          } catch {
                            setToasts(prev => [...prev, { id: Date.now().toString(), message: '링크 삭제에 실패했습니다', type: 'error' }])
                          }
                        }
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                )}
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

      {(data || isSpecialShareView) && displayFiles.length > 0 && viewMode === 'grid' && (
        <div className="file-grid">
          {displayFiles.map((file, index) => (
            <div
              key={file.path}
              ref={(el) => { if (el) fileRowRefs.current.set(file.path, el); else fileRowRefs.current.delete(file.path); }}
              className={`file-card ${selectedFiles.has(file.path) || selectedFile?.path === file.path ? 'selected' : ''} ${focusedIndex === index ? 'focused' : ''} ${dropTargetPath === file.path ? 'drop-target' : ''} ${draggedFiles.some(f => f.path === file.path) ? 'dragging' : ''} ${clipboard?.mode === 'cut' && clipboard.files.some(f => f.path === file.path) ? 'cut' : ''}`}
              onClick={(e) => { handleSelectFile(file, e); setFocusedIndex(index); }}
              onDoubleClick={() => handleItemDoubleClick(file)}
              onContextMenu={(e) => handleContextMenu(e, file)}
              draggable
              onDragStart={(e) => handleDragStart(e, file)}
              onDragEnd={handleDragEnd}
              onDragOver={file.isDir ? (e) => handleFolderDragOver(e, file) : undefined}
              onDragLeave={file.isDir ? handleFolderDragLeave : undefined}
              onDrop={file.isDir ? (e) => handleFolderDrop(e, file) : undefined}
            >
              <div className="file-card-icon">
                {getFileIcon(file)}
              </div>
              <div className="file-card-name" title={file.name}>
                {file.name}
              </div>
              <div className="file-card-meta">
                {file.isDir ? '폴더' : formatFileSize(file.size)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* File Details Panel */}
      {selectedFile && (
        <div className="file-details-panel" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
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

          {/* File Metadata Section */}
          {!loadingMetadata && (
            <div className="details-metadata">
              {/* Description */}
              <div className="metadata-row">
                <span className="metadata-label">설명</span>
                {editingDescription ? (
                  <div className="metadata-edit-inline">
                    <textarea
                      className="description-input"
                      value={descriptionInput}
                      onChange={(e) => setDescriptionInput(e.target.value)}
                      placeholder="설명 입력..."
                      rows={2}
                      autoFocus
                      onBlur={() => {
                        if (descriptionInput !== (fileMetadata?.description || '')) {
                          handleSaveDescription()
                        } else {
                          setEditingDescription(false)
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleSaveDescription()
                        } else if (e.key === 'Escape') {
                          setEditingDescription(false)
                          setDescriptionInput(fileMetadata?.description || '')
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div
                    className={`metadata-value clickable ${!isSpecialShareView ? 'editable' : ''}`}
                    onClick={() => {
                      if (!isSpecialShareView) {
                        setDescriptionInput(fileMetadata?.description || '')
                        setEditingDescription(true)
                      }
                    }}
                  >
                    {fileMetadata?.description || <span className="placeholder">클릭하여 설명 추가</span>}
                  </div>
                )}
              </div>

              {/* Tags */}
              <div className="metadata-row">
                <span className="metadata-label">태그</span>
                <div className="tags-inline">
                  {fileMetadata?.tags?.map(tag => (
                    <span key={tag} className="tag-chip">
                      #{tag}
                      {!isSpecialShareView && (
                        <button className="tag-remove-btn" onClick={() => handleRemoveTag(tag)}>×</button>
                      )}
                    </span>
                  ))}
                  {!isSpecialShareView && (
                    <div className="tag-add-inline">
                      <input
                        type="text"
                        className="tag-add-input"
                        placeholder="+ 태그"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleAddTag(tagInput)
                          }
                        }}
                      />
                      {tagSuggestions.length > 0 && (
                        <div className="tag-dropdown">
                          {tagSuggestions.map(tag => (
                            <button key={tag} onClick={() => handleAddTag(tag)}>#{tag}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

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
            {!isSpecialShareView && (
              <>
                <button className="btn-detail-action" onClick={() => setShareTarget(selectedFile)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="2"/>
                    <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                    <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="2"/>
                    <path d="M8.59 13.51L15.42 17.49" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M15.41 6.51L8.59 10.49" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  공유
                </button>
                <button className="btn-detail-action" onClick={() => setLinkShareTarget(selectedFile)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  링크 공유
                </button>
              </>
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
          ref={contextMenuRef}
          className="context-menu"
          style={{
            top: contextMenuPosition?.y ?? contextMenu.y,
            left: contextMenuPosition?.x ?? contextMenu.x,
            visibility: contextMenuPosition ? 'visible' : 'hidden'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'background' ? (
            isSpecialShareView ? (
              <div className="context-menu-item disabled">
                {isSharedWithMeView ? '나에게 공유된 파일에서는 작업을 할 수 없습니다' :
                 isSharedByMeView ? '다른사용자에 공유된 파일에서는 작업을 할 수 없습니다' :
                 '링크로 공유된 파일에서는 작업을 할 수 없습니다'}
              </div>
            ) : (
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
            )
          ) : isSpecialShareView ? (
            <>
              {/* Share view file context menu */}
              <button className="context-menu-item" onClick={() => { onNavigate(contextMenu.file.path.substring(0, contextMenu.file.path.lastIndexOf('/'))); closeContextMenu(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2"/>
                </svg>
                원본 위치로 이동
              </button>
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
              {isLinkSharesView && (
                <button className="context-menu-item" onClick={() => {
                  const file = contextMenu.file as FileInfo & { linkToken?: string }
                  if (file.linkToken) {
                    navigator.clipboard.writeText(`${window.location.origin}/s/${file.linkToken}`)
                    setToasts(prev => [...prev, { id: Date.now().toString(), message: '링크가 클립보드에 복사되었습니다', type: 'success' }])
                  }
                  closeContextMenu()
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
                    <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                  링크 복사
                </button>
              )}
              <div className="context-menu-divider" />
              {isSharedByMeView && (
                <button className="context-menu-item danger" onClick={async () => {
                  const file = contextMenu.file as FileInfo & { shareId?: number }
                  if (file.shareId) {
                    try {
                      await deleteFileShare(file.shareId)
                      queryClient.invalidateQueries({ queryKey: ['shared-by-me'] })
                      setToasts(prev => [...prev, { id: Date.now().toString(), message: '공유가 해제되었습니다', type: 'success' }])
                    } catch (err) {
                      setToasts(prev => [...prev, { id: Date.now().toString(), message: '공유 해제에 실패했습니다', type: 'error' }])
                    }
                  }
                  closeContextMenu()
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M19 6V20C19 21.1 18.1 22 17 22H7C5.9 22 5 21.1 5 20V6" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                  공유 해제
                </button>
              )}
              {isLinkSharesView && (
                <button className="context-menu-item danger" onClick={async () => {
                  const file = contextMenu.file as FileInfo & { linkId?: string }
                  if (file.linkId) {
                    try {
                      await deleteShareLink(file.linkId)
                      queryClient.invalidateQueries({ queryKey: ['link-shares'] })
                      setToasts(prev => [...prev, { id: Date.now().toString(), message: '링크가 삭제되었습니다', type: 'success' }])
                    } catch (err) {
                      setToasts(prev => [...prev, { id: Date.now().toString(), message: '링크 삭제에 실패했습니다', type: 'error' }])
                    }
                  }
                  closeContextMenu()
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M19 6V20C19 21.1 18.1 22 17 22H7C5.9 22 5 21.1 5 20V6" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                  링크 삭제
                </button>
              )}
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
              {/* Download button - shows modal for multiple files */}
              {!contextMenu.file.isDir && (
                <button className="context-menu-item" onClick={() => {
                  if (contextMenu.selectedPaths.length > 1) {
                    handleMultiDownload(contextMenu.selectedPaths)
                  } else {
                    handleDownload(contextMenu.file)
                  }
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {contextMenu.selectedPaths.length > 1 ? `${contextMenu.selectedPaths.length}개 다운로드` : '다운로드'}
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
              <button className="context-menu-item" onClick={() => {
                handleCompress(contextMenu.selectedPaths)
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M21 8V21H3V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M23 3H1V8H23V3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M10 12H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {contextMenu.selectedPaths.length > 1 ? `${contextMenu.selectedPaths.length}개 압축` : '압축'}
              </button>
              {/* Extract button - only for zip files */}
              {contextMenu.file.name.toLowerCase().endsWith('.zip') && (
                <button className="context-menu-item" onClick={() => handleExtract(contextMenu.file)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M21 8V21H3V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M23 3H1V8H23V3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M12 11V17M12 17L9 14M12 17L15 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  압축풀기
                </button>
              )}
              <div className="context-menu-divider" />
              <button className="context-menu-item" onClick={() => { setShareTarget(contextMenu.file); closeContextMenu(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="2"/>
                  <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                  <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="2"/>
                  <path d="M8.59 13.51L15.42 17.49M15.41 6.51L8.59 10.49" stroke="currentColor" strokeWidth="2"/>
                </svg>
                사용자에게 공유
              </button>
              <button className="context-menu-item" onClick={() => { setLinkShareTarget(contextMenu.file); closeContextMenu(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                링크로 공유
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
        <div className="multi-select-bar" onClick={(e) => e.stopPropagation()}>
          <span className="select-count">{selectedFiles.size}개 선택됨</span>
          <button className="multi-action-btn" onClick={(e) => {
            e.stopPropagation()
            const paths = Array.from(selectedFiles)
            if (paths.length > 0) {
              handleMultiDownload(paths)
            }
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            다운로드
          </button>
          <button className="multi-action-btn" onClick={(e) => {
            e.stopPropagation()
            const paths = Array.from(selectedFiles)
            if (paths.length > 0) {
              handleCompress(paths)
            }
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M21 8V21H3V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M23 3H1V8H23V3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M10 12H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            압축
          </button>
          <button className="multi-action-btn danger" onClick={(e) => { e.stopPropagation(); handleBulkDelete(); }}>
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
          siblingFiles={displayFiles}
          onNavigate={(file) => setViewingFile(file)}
        />
      )}

      {/* ZIP Viewer Modal */}
      {zipViewingFile && (
        <ZipViewer
          filePath={zipViewingFile.path}
          fileName={zipViewingFile.name}
          onClose={() => setZipViewingFile(null)}
          onExtract={() => {
            queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
            const id = Date.now().toString()
            setToasts((prev) => [...prev, { id, message: '압축이 해제되었습니다', type: 'success' }])
          }}
        />
      )}

      {/* OnlyOffice Editor Modal */}
      {onlyOfficeConfig && onlyOfficeFile && (
        <OnlyOfficeEditor
          config={onlyOfficeConfig}
          publicUrl={onlyOfficePublicUrl}
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

      {/* Compress Modal */}
      {showCompressModal && (
        <div className="modal-overlay" onClick={() => setShowCompressModal(false)}>
          <div className="modal compress-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>압축 파일 만들기</h3>
              <button className="modal-close" onClick={() => setShowCompressModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <label className="input-label">압축 파일 이름</label>
              <div className="compress-input-wrapper">
                <input
                  type="text"
                  className="rename-input"
                  value={compressFileName}
                  onChange={e => setCompressFileName(e.target.value)}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCompressConfirm()
                    if (e.key === 'Escape') setShowCompressModal(false)
                  }}
                />
                <span className="compress-extension">.zip</span>
              </div>
              <p className="input-hint">
                {pathsToCompress.length}개 항목을 압축합니다
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setShowCompressModal(false)}>취소</button>
              <button className="btn-confirm" onClick={handleCompressConfirm} disabled={!compressFileName.trim()}>
                압축
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Download Options Modal */}
      {showDownloadModal && (
        <div className="modal-overlay" onClick={() => !downloadingAsZip && setShowDownloadModal(false)}>
          <div className="modal download-options-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>다운로드 방식 선택</h3>
              <button className="modal-close" onClick={() => !downloadingAsZip && setShowDownloadModal(false)} disabled={downloadingAsZip}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <p className="download-info">
                {pathsToDownload.length}개 파일을 다운로드합니다
              </p>
              <div className="download-options">
                <button
                  className="download-option-btn"
                  onClick={handleDownloadAsZip}
                  disabled={downloadingAsZip}
                >
                  <div className="download-option-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 8v13H3V8" />
                      <path d="M23 3H1v5h22V3z" />
                      <path d="M10 12h4" />
                    </svg>
                  </div>
                  <div className="download-option-text">
                    <strong>ZIP으로 압축해서 다운로드</strong>
                    <span>모든 파일을 하나의 ZIP 파일로 다운로드</span>
                  </div>
                  {downloadingAsZip && <span className="spinner small" />}
                </button>
                <button
                  className="download-option-btn"
                  onClick={handleDownloadIndividually}
                  disabled={downloadingAsZip}
                >
                  <div className="download-option-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                      <path d="M7 10l5 5 5-5" />
                      <path d="M12 15V3" />
                    </svg>
                  </div>
                  <div className="download-option-text">
                    <strong>개별 파일로 다운로드</strong>
                    <span>각 파일을 따로 다운로드 (폴더 제외)</span>
                  </div>
                </button>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setShowDownloadModal(false)} disabled={downloadingAsZip}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {shareTarget && (
        <ShareModal
          isOpen={!!shareTarget}
          onClose={() => setShareTarget(null)}
          itemPath={shareTarget.path}
          itemName={shareTarget.name}
          isFolder={shareTarget.isDir}
        />
      )}

      {/* Link Share Modal */}
      {linkShareTarget && (
        <LinkShareModal
          isOpen={!!linkShareTarget}
          onClose={() => setLinkShareTarget(null)}
          itemPath={linkShareTarget.path}
          itemName={linkShareTarget.name}
          isFolder={linkShareTarget.isDir}
        />
      )}
    </div>
  )
}

export default FileList
