import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchFiles, downloadFileWithProgress, getFolderStats, renameItem, copyItem, moveToTrash, getFileUrl, getAuthToken, FileInfo, FolderStats, checkOnlyOfficeStatus, getOnlyOfficeConfig, isOnlyOfficeSupported, OnlyOfficeConfig, createFile, fileTypeOptions, getFileMetadata, updateFileMetadata, getUserTags, FileMetadata, compressFiles, extractZip, downloadAsZip, searchFiles } from '../api/files'
import { getMySharedFolders, SharedFolderWithPermission } from '../api/sharedFolders'
import { getSharedWithMe, getSharedByMe, getMyShareLinks, SharedWithMeItem, SharedByMeItem, LinkShare, deleteFileShare, deleteShareLink } from '../api/fileShares'
import { useUploadStore } from '../stores/uploadStore'
import { useTransferStore } from '../stores/transferStore'
import { useFileWatcher } from '../hooks/useFileWatcher'
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation'
import { useMarqueeSelection } from '../hooks/useMarqueeSelection'
import { useFileHistory } from '../hooks/useFileHistory'
import { useClipboard } from '../hooks/useClipboard'
import { useFileUploadDragDrop } from '../hooks/useFileUploadDragDrop'
import { useFileDragMove } from '../hooks/useFileDragMove'
import ConfirmModal from './ConfirmModal'
import Toast from './Toast'
import TextEditor from './TextEditor'
import FileViewer from './FileViewer'
import ZipViewer from './ZipViewer'
import OnlyOfficeEditor from './OnlyOfficeEditor'
import ShareModal from './ShareModal'
import LinkShareModal from './LinkShareModal'
import FolderSelectModal from './FolderSelectModal'
import {
  SortField, SortOrder, ViewMode, ContextMenuType,
  FileCard, MultiSelectBar, ContextMenu, FileInfoPanel,
  FileListHeader, RenameModal, NewFileModal, CompressModal, DownloadOptionsModal,
  VirtualizedFileTable
} from './filelist'
import { getFileIcon } from '../utils/fileIcons'
import { formatRelativeDate, formatFullDateTime } from '../utils/dateUtils'
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
  // Move/Copy modal state
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [pathsToTransfer, setPathsToTransfer] = useState<string[]>([])
  const fileRowRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // File metadata state (description and tags)
  const [fileMetadata, setFileMetadata] = useState<FileMetadata | null>(null)
  const [loadingMetadata, setLoadingMetadata] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionInput, setDescriptionInput] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [allUserTags, setAllUserTags] = useState<string[]>([])
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])

  // 로컬 검색 상태
  const [localSearchQuery, setLocalSearchQuery] = useState('')
  const [localSearchResults, setLocalSearchResults] = useState<FileInfo[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showLocalSearch, setShowLocalSearch] = useState(false)
  const localSearchInputRef = useRef<HTMLInputElement>(null)
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)

  // Toast helper
  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    const id = Date.now().toString()
    setToasts(prev => [...prev, { id, message, type }])
  }, [])

  const queryClient = useQueryClient()
  const containerRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const uploadStore = useUploadStore()
  const transferStore = useTransferStore()
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

  // 로컬 검색 핸들러 (디바운스 적용)
  const handleLocalSearchChange = useCallback((query: string) => {
    setLocalSearchQuery(query)

    // 기존 타이머 취소
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    if (!query.trim()) {
      setLocalSearchResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)

    // 300ms 디바운스
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const response = await searchFiles(query, {
          path: currentPath,
          limit: 100,
          matchType: 'name',
        })
        setLocalSearchResults(response.results)
      } catch (error) {
        console.error('Search failed:', error)
        setLocalSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)
  }, [currentPath])

  // Check if current path is a special share view
  const isSharedWithMeView = currentPath === '/shared-with-me'
  const isSharedByMeView = currentPath === '/shared-by-me'
  const isLinkSharesView = currentPath === '/link-shares'
  const isSpecialShareView = isSharedWithMeView || isSharedByMeView || isLinkSharesView

  // 경로 변경 시 검색 초기화
  useEffect(() => {
    setLocalSearchQuery('')
    setLocalSearchResults([])
    setShowLocalSearch(false)
  }, [currentPath])

  // Ctrl+F 단축키로 검색창 열기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' && (e.ctrlKey || e.metaKey) && !isSpecialShareView) {
        e.preventDefault()
        setShowLocalSearch(true)
        setTimeout(() => localSearchInputRef.current?.focus(), 50)
      }
      if (e.key === 'Escape' && showLocalSearch) {
        setShowLocalSearch(false)
        setLocalSearchQuery('')
        setLocalSearchResults([])
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showLocalSearch, isSpecialShareView])

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
    // 로컬 검색 쿼리가 있으면 검색 결과 반환 (결과가 없어도)
    if (localSearchQuery.trim()) {
      return localSearchResults
    }

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
  }, [isSharedWithMeView, isSharedByMeView, isLinkSharesView, sharedWithMeData, sharedByMeData, linkSharesData, data?.files, localSearchQuery, localSearchResults])

  const displayFiles = getDisplayFiles()
  const isLoadingFiles = isLoading || sharedWithMeLoading || sharedByMeLoading || linkSharesLoading

  // History hook for undo/redo
  const { addToHistory, handleUndo, handleRedo } = useFileHistory({ addToast })

  // Clipboard hook for copy/cut/paste
  const { clipboard, handleCopy, handleCut, handlePaste, isFileCut } = useClipboard({
    displayFiles,
    selectedFiles,
    selectedFile,
    currentPath,
    addToHistory,
    addToast,
  })

  // Marquee selection hook
  const {
    isMarqueeSelecting,
    marqueeStyle,
    handleMarqueeStart,
    handleMarqueeMove,
    handleMarqueeEnd,
  } = useMarqueeSelection({
    containerRef,
    fileRowRefs,
    displayFiles,
    setSelectedFiles,
    setSelectedFile,
  })

  // File upload drag/drop hook
  const {
    isDraggingFiles,
    uploadDropTargetPath,
    handleFileDragOver,
    handleFileDragEnter,
    handleFileDragLeave,
    handleFileDrop,
    handleFolderUploadDragOver,
    handleFolderUploadDragLeave,
    handleFolderUploadDrop,
  } = useFileUploadDragDrop({
    containerRef,
    currentPath,
    addToast,
  })

  // Internal file drag/drop hook (move files between folders)
  const {
    draggedFiles,
    dropTargetPath: moveDropTargetPath,
    handleDragStart,
    handleDragEnd,
    handleFolderDragOver: handleFolderMoveDragOver,
    handleFolderDragLeave: handleFolderMoveDragLeave,
    handleFolderDrop: handleFolderMoveDrop,
  } = useFileDragMove({
    displayFiles,
    selectedFiles,
    currentPath,
    addToHistory,
    addToast,
    setSelectedFiles,
    setSelectedFile,
  })

  // Combined drop target path (from either internal move or external upload)
  const dropTargetPath = moveDropTargetPath || uploadDropTargetPath

  // Combined folder drag handlers (handle both internal move and external upload)
  const handleFolderDragOver = useCallback((e: React.DragEvent, folder: FileInfo) => {
    // Handle internal file move drag
    handleFolderMoveDragOver(e, folder)
    // Handle external file upload drag
    handleFolderUploadDragOver(e, folder)
  }, [handleFolderMoveDragOver, handleFolderUploadDragOver])

  const handleFolderDragLeave = useCallback((e: React.DragEvent) => {
    handleFolderMoveDragLeave(e)
    handleFolderUploadDragLeave(e)
  }, [handleFolderMoveDragLeave, handleFolderUploadDragLeave])

  const handleFolderDrop = useCallback(async (e: React.DragEvent, folder: FileInfo) => {
    // Try internal file move first
    await handleFolderMoveDrop(e, folder)
    // Then try external file upload
    await handleFolderUploadDrop(e, folder)
  }, [handleFolderMoveDrop, handleFolderUploadDrop])

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

  // Move to handler - opens folder select modal
  const handleMoveTo = useCallback((paths: string[]) => {
    if (paths.length === 0) return
    closeContextMenu()
    setPathsToTransfer(paths)
    setShowMoveModal(true)
  }, [closeContextMenu])

  // Copy to handler - opens folder select modal
  const handleCopyTo = useCallback((paths: string[]) => {
    if (paths.length === 0) return
    closeContextMenu()
    setPathsToTransfer(paths)
    setShowCopyModal(true)
  }, [closeContextMenu])

  // Execute move
  const handleMoveConfirm = useCallback((destination: string) => {
    if (pathsToTransfer.length === 0) return
    setShowMoveModal(false)
    // Convert paths to TransferItemInfo
    const transferInfos = pathsToTransfer.map(path => {
      const file = displayFiles.find(f => f.path === path)
      return {
        path,
        name: file?.name || path.split('/').pop() || path,
        size: file?.size,
        isDirectory: file?.isDir,
      }
    })
    transferStore.addTransfer('move', transferInfos, destination)
    transferStore.startTransfers()
    // Invalidate queries after a short delay to allow transfers to complete
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
      queryClient.invalidateQueries({ queryKey: ['files', destination] })
    }, 500)
    setSelectedFiles(new Set())
    setSelectedFile(null)
  }, [pathsToTransfer, displayFiles, transferStore, queryClient, currentPath, setSelectedFiles, setSelectedFile])

  // Execute copy to destination
  const handleCopyToConfirm = useCallback((destination: string) => {
    if (pathsToTransfer.length === 0) return
    setShowCopyModal(false)
    // Convert paths to TransferItemInfo
    const transferInfos = pathsToTransfer.map(path => {
      const file = displayFiles.find(f => f.path === path)
      return {
        path,
        name: file?.name || path.split('/').pop() || path,
        size: file?.size,
        isDirectory: file?.isDir,
      }
    })
    transferStore.addTransfer('copy', transferInfos, destination)
    transferStore.startTransfers()
    // Invalidate queries after a short delay to allow transfers to complete
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['files', destination] })
    }, 500)
    setSelectedFiles(new Set())
    setSelectedFile(null)
  }, [pathsToTransfer, displayFiles, transferStore, queryClient, setSelectedFiles, setSelectedFile])

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

  // 공유 해제 핸들러 (VirtualizedFileTable용)
  const handleUnshare = useCallback(async (sharedFile: { shareId?: number }) => {
    if (sharedFile.shareId) {
      try {
        await deleteFileShare(sharedFile.shareId)
        queryClient.invalidateQueries({ queryKey: ['shared-by-me'] })
        setToasts(prev => [...prev, { id: Date.now().toString(), message: '공유가 해제되었습니다', type: 'success' }])
      } catch {
        setToasts(prev => [...prev, { id: Date.now().toString(), message: '공유 해제에 실패했습니다', type: 'error' }])
      }
    }
  }, [queryClient])

  // 링크 복사 핸들러 (VirtualizedFileTable용)
  const handleCopyShareLink = useCallback((sharedFile: { linkToken?: string }) => {
    if (sharedFile.linkToken) {
      navigator.clipboard.writeText(`${window.location.origin}/s/${sharedFile.linkToken}`)
      setToasts(prev => [...prev, { id: Date.now().toString(), message: '링크가 클립보드에 복사되었습니다', type: 'success' }])
    }
  }, [])

  // 링크 삭제 핸들러 (VirtualizedFileTable용)
  const handleDeleteShareLink = useCallback(async (sharedFile: { linkId?: string }) => {
    if (sharedFile.linkId) {
      try {
        await deleteShareLink(sharedFile.linkId)
        queryClient.invalidateQueries({ queryKey: ['link-shares'] })
        setToasts(prev => [...prev, { id: Date.now().toString(), message: '링크가 삭제되었습니다', type: 'success' }])
      } catch {
        setToasts(prev => [...prev, { id: Date.now().toString(), message: '링크 삭제에 실패했습니다', type: 'error' }])
      }
    }
  }, [queryClient])

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

  // Keyboard navigation hook
  const modalsOpen = !!(viewingFile || editingFile || onlyOfficeConfig || deleteTarget || renameTarget || showNewFileModal || showCompressModal || showDownloadModal)

  useKeyboardNavigation({
    displayFiles,
    focusedIndex,
    setFocusedIndex,
    selectedFile,
    setSelectedFile,
    selectedFiles,
    setSelectedFiles,
    viewMode,
    containerRef,
    fileRowRefs,
    modalsOpen,
    canGoBack: canGoBack(),
    onGoBack: goBack,
    onDoubleClick: handleItemDoubleClick,
    onDelete: (file) => setDeleteTarget(file),
    onBulkDelete: handleBulkDelete,
    onRename: (file) => { setRenameTarget(file); setNewName(file.name) },
    onCopy: handleCopy,
    onCut: handleCut,
    onPaste: handlePaste,
    onUndo: handleUndo,
    onRedo: handleRedo,
  })

  const handleSort = useCallback((field: SortField) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
  }, [sortBy])


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

  return (
    <div className={`file-list-wrapper ${selectedFile ? 'panel-open' : ''}`}>
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
      {/* Drag overlay - pointer-events: none in CSS to allow folder targeting */}
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
      <FileListHeader
        currentPath={currentPath}
        viewMode={viewMode}
        selectedCount={selectedFiles.size}
        totalCount={data?.total || displayFiles.length}
        totalSize={data?.totalSize || 0}
        canGoBack={canGoBack()}
        onGoBack={goBack}
        onViewModeChange={toggleViewMode}
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ['files', currentPath] })}
        getPathDisplayName={getPathDisplayName}
        localSearchQuery={localSearchQuery}
        onLocalSearchChange={handleLocalSearchChange}
        isSearching={isSearching}
        searchResultCount={localSearchResults.length}
      />

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
          {/* 파일 테이블 본문 - VirtualizedFileTable이 가상화 여부를 자동 결정 */}
          <VirtualizedFileTable
            files={displayFiles}
            selectedFiles={selectedFiles}
            focusedIndex={focusedIndex}
            dropTargetPath={dropTargetPath}
            draggedFiles={draggedFiles}
            clipboard={clipboard}
            isSharedWithMeView={isSharedWithMeView}
            isSharedByMeView={isSharedByMeView}
            isLinkSharesView={isLinkSharesView}
            highlightedPath={highlightedFilePath}
            onSelect={handleSelectFile}
            onDoubleClick={handleItemDoubleClick}
            onContextMenu={handleContextMenu}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onFolderDragOver={handleFolderDragOver}
            onFolderDragLeave={handleFolderDragLeave}
            onFolderDrop={handleFolderDrop}
            onUnshare={handleUnshare}
            onCopyLink={handleCopyShareLink}
            onDeleteLink={handleDeleteShareLink}
            getFileIcon={getFileIcon}
            formatDate={formatRelativeDate}
            getFullDateTime={formatFullDateTime}
            setFocusedIndex={setFocusedIndex}
            fileRowRefs={fileRowRefs}
          />
        </div>
      )}

      {(data || isSpecialShareView) && displayFiles.length > 0 && viewMode === 'grid' && (
        <div className="file-grid">
          {displayFiles.map((file, index) => (
            <FileCard
              key={file.path}
              ref={(el) => { if (el) fileRowRefs.current.set(file.path, el); else fileRowRefs.current.delete(file.path); }}
              file={file}
              index={index}
              isSelected={selectedFiles.has(file.path) || selectedFile?.path === file.path}
              isFocused={focusedIndex === index}
              isDropTarget={dropTargetPath === file.path}
              isDragging={draggedFiles.some(f => f.path === file.path)}
              isCut={isFileCut(file.path)}
              onSelect={handleSelectFile}
              onDoubleClick={handleItemDoubleClick}
              onContextMenu={handleContextMenu}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onFolderDragOver={handleFolderDragOver}
              onFolderDragLeave={handleFolderDragLeave}
              onFolderDrop={handleFolderDrop}
              getFileIcon={getFileIcon}
              setFocusedIndex={setFocusedIndex}
            />
          ))}
        </div>
      )}
    </div>
    {/* End of file-list-container */}

    {/* File Details Panel - Separate Sidebar */}
    {selectedFile && (
      <FileInfoPanel
        selectedFile={selectedFile}
        thumbnailUrl={thumbnailUrl}
        folderStats={folderStats}
        loadingStats={loadingStats}
        fileMetadata={fileMetadata}
        loadingMetadata={loadingMetadata}
        editingDescription={editingDescription}
        descriptionInput={descriptionInput}
        tagInput={tagInput}
        tagSuggestions={tagSuggestions}
        isSpecialShareView={isSpecialShareView}
        onClose={() => setSelectedFile(null)}
        onView={(file) => setViewingFile(file)}
        onDownload={(file) => downloadFileWithProgress(file.path, file.size, downloadStore)}
        onShare={(file) => setShareTarget(file)}
        onLinkShare={(file) => setLinkShareTarget(file)}
        onDelete={(file) => setDeleteTarget(file)}
        onDescriptionChange={(value) => setDescriptionInput(value)}
        onDescriptionSave={handleSaveDescription}
        onDescriptionEdit={(editing) => setEditingDescription(editing)}
        onDescriptionInputChange={(value) => setDescriptionInput(value)}
        onTagInputChange={(value) => setTagInput(value)}
        onAddTag={handleAddTag}
        onRemoveTag={handleRemoveTag}
        getFileIcon={getFileIcon}
      />
    )}

      <ContextMenu
        contextMenu={contextMenu}
        contextMenuPosition={contextMenuPosition}
        contextMenuRef={contextMenuRef}
        isSpecialShareView={isSpecialShareView}
        isSharedWithMeView={isSharedWithMeView}
        isSharedByMeView={isSharedByMeView}
        isLinkSharesView={isLinkSharesView}
        showNewFileSubmenu={showNewFileSubmenu}
        fileTypeOptions={fileTypeOptions}
        onlyOfficeAvailable={onlyOfficeAvailable}
        onClose={closeContextMenu}
        onUploadClick={onUploadClick}
        onNewFolderClick={onNewFolderClick}
        onNewFileSelect={handleNewFileSelect}
        onSetShowNewFileSubmenu={setShowNewFileSubmenu}
        onNavigateToOriginal={onNavigate}
        onDownload={handleDownload}
        onMultiDownload={handleMultiDownload}
        onEdit={(file) => setEditingFile(file)}
        onOnlyOfficeEdit={handleOnlyOfficeEdit}
        onView={(file) => setViewingFile(file)}
        onRename={handleRenameClick}
        onCopy={handleCopyClick}
        onMoveTo={handleMoveTo}
        onCopyTo={handleCopyTo}
        onCompress={handleCompress}
        onExtract={handleExtract}
        onShare={(file) => setShareTarget(file)}
        onLinkShare={(file) => setLinkShareTarget(file)}
        onDelete={handleDeleteClick}
        onUnshare={async (shareId) => {
          try {
            await deleteFileShare(shareId)
            queryClient.invalidateQueries({ queryKey: ['shared-by-me'] })
            setToasts(prev => [...prev, { id: Date.now().toString(), message: '공유가 해제되었습니다', type: 'success' }])
          } catch {
            setToasts(prev => [...prev, { id: Date.now().toString(), message: '공유 해제에 실패했습니다', type: 'error' }])
          }
        }}
        onDeleteLink={async (linkId) => {
          try {
            await deleteShareLink(linkId)
            queryClient.invalidateQueries({ queryKey: ['link-shares'] })
            setToasts(prev => [...prev, { id: Date.now().toString(), message: '링크가 삭제되었습니다', type: 'success' }])
          } catch {
            setToasts(prev => [...prev, { id: Date.now().toString(), message: '링크 삭제에 실패했습니다', type: 'error' }])
          }
        }}
        onCopyLink={(token) => {
          navigator.clipboard.writeText(`${window.location.origin}/s/${token}`)
          setToasts(prev => [...prev, { id: Date.now().toString(), message: '링크가 클립보드에 복사되었습니다', type: 'success' }])
        }}
        isEditableFile={isEditableFile}
        isViewableFile={isViewableFile}
        isOnlyOfficeSupported={isOnlyOfficeSupported}
      />

      {/* Multi-select action bar */}
      <MultiSelectBar
        selectedCount={selectedFiles.size}
        onDownload={() => {
          const paths = Array.from(selectedFiles)
          if (paths.length > 0) {
            handleMultiDownload(paths)
          }
        }}
        onCompress={() => {
          const paths = Array.from(selectedFiles)
          if (paths.length > 0) {
            handleCompress(paths)
          }
        }}
        onDelete={handleBulkDelete}
        onClear={() => setSelectedFiles(new Set())}
      />

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
      <RenameModal
        target={renameTarget}
        newName={newName}
        onNameChange={setNewName}
        onConfirm={handleRenameConfirm}
        onClose={() => setRenameTarget(null)}
      />

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
      <NewFileModal
        isOpen={showNewFileModal}
        fileName={newFileName}
        fileType={newFileType}
        fileTypeOptions={fileTypeOptions}
        onFileNameChange={setNewFileName}
        onConfirm={handleNewFileCreate}
        onClose={() => setShowNewFileModal(false)}
      />

      {/* Compress Modal */}
      <CompressModal
        isOpen={showCompressModal}
        fileName={compressFileName}
        itemCount={pathsToCompress.length}
        onFileNameChange={setCompressFileName}
        onConfirm={handleCompressConfirm}
        onClose={() => setShowCompressModal(false)}
      />

      {/* Download Options Modal */}
      <DownloadOptionsModal
        isOpen={showDownloadModal}
        itemCount={pathsToDownload.length}
        isDownloading={downloadingAsZip}
        onDownloadSeparate={handleDownloadIndividually}
        onDownloadAsZip={handleDownloadAsZip}
        onClose={() => setShowDownloadModal(false)}
      />

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

      {/* Move Modal */}
      <FolderSelectModal
        isOpen={showMoveModal}
        onClose={() => setShowMoveModal(false)}
        onSelect={handleMoveConfirm}
        title="이동할 위치 선택"
        actionLabel="이동"
        excludePaths={pathsToTransfer}
      />

      {/* Copy Modal */}
      <FolderSelectModal
        isOpen={showCopyModal}
        onClose={() => setShowCopyModal(false)}
        onSelect={handleCopyToConfirm}
        title="복사할 위치 선택"
        actionLabel="복사"
      />
    </div>
  )
}

export default FileList
