import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { getRecentFiles, RecentFile, downloadFile, FileInfo, getFolderStats, FolderStats, getFileMetadata, FileMetadata, updateFileMetadata } from '../api/files'
import { getFileIcon } from '../utils/fileIcons'
import { FileRow, FileCard, VirtualizedFileTable, FileInfoPanel, VIRTUALIZATION_THRESHOLD } from './filelist'
import FileViewer from './FileViewer'
import TextEditor from './TextEditor'
import './MyActivity.css'

type ActivityTab = 'all' | 'upload' | 'download' | 'edit' | 'folder'
type SortOrder = 'newest' | 'oldest' | 'name-asc' | 'name-desc'
type ViewMode = 'list' | 'grid'

interface MyActivityProps {
  onNavigate: (path: string) => void
  onFileSelect?: (filePath: string, parentPath: string) => void
}

// Normalize path to ensure it starts with /home/
function normalizePath(path: string): string {
  if (!path) return '/home'
  if (path.startsWith('/home') || path.startsWith('/shared')) return path
  if (path.startsWith('users/')) {
    const parts = path.substring(6).split('/')
    if (parts.length > 1) return '/home/' + parts.slice(1).join('/')
    return '/home'
  }
  if (path.startsWith('shared/')) return '/' + path
  if (!path.startsWith('/')) return '/home/' + path
  return path
}

// Convert RecentFile to FileInfo
function toFileInfo(activity: RecentFile): FileInfo {
  const ext = activity.name.includes('.') ? activity.name.split('.').pop()?.toLowerCase() : undefined
  return {
    name: activity.name,
    path: normalizePath(activity.path),
    size: activity.size || 0,
    isDir: activity.isDir,
    modTime: activity.timestamp,
    extension: ext,
  }
}

function MyActivity({ onNavigate, onFileSelect }: MyActivityProps) {

  // Activity data
  const [activeTab, setActiveTab] = useState<ActivityTab>('all')
  const [activities, setActivities] = useState<RecentFile[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('myActivityViewMode')
    return (saved === 'grid' || saved === 'list') ? saved : 'list'
  })

  // Selection and focus
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)

  // Viewers and editors
  const [viewingFile, setViewingFile] = useState<FileInfo | null>(null)
  const [editingFile, setEditingFile] = useState<FileInfo | null>(null)

  // Context menu
  const [contextMenu, setContextMenu] = useState<FileInfo | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // File info panel
  const [folderStats, setFolderStats] = useState<FolderStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)
  const [fileMetadata, setFileMetadata] = useState<FileMetadata | null>(null)
  const [loadingMetadata, setLoadingMetadata] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionInput, setDescriptionInput] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tagSuggestions] = useState<string[]>([])

  // Thumbnail
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)

  // Refs for keyboard navigation
  const fileRowRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Check if file is editable (text file)
  const isEditableFile = useCallback((file: FileInfo): boolean => {
    const ext = file.extension?.toLowerCase() || file.name.split('.').pop()?.toLowerCase() || ''
    const textExts = [
      'txt', 'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'toml',
      'js', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'less',
      'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb',
      'sh', 'bash', 'zsh', 'sql', 'log', 'ini', 'conf', 'cfg', 'env',
      'dockerfile', 'makefile', 'gitignore', 'editorconfig'
    ]
    const fileName = file.name.toLowerCase()
    if (['dockerfile', 'makefile', '.gitignore', '.editorconfig', '.env'].includes(fileName)) {
      return true
    }
    return textExts.includes(ext)
  }, [])

  // Check if file is viewable (images, PDFs, videos, audio)
  const isViewableFile = useCallback((file: FileInfo): boolean => {
    const ext = file.extension?.toLowerCase() || file.name.split('.').pop()?.toLowerCase() || ''
    const viewableExts = [
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
      'pdf',
      'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v',
      'mp3', 'wav', 'flac', 'm4a', 'aac'
    ]
    return viewableExts.includes(ext)
  }, [])

  // Save viewMode to localStorage
  useEffect(() => {
    localStorage.setItem('myActivityViewMode', viewMode)
  }, [viewMode])

  // Load activities
  useEffect(() => {
    const fetchActivities = async () => {
      try {
        setLoading(true)
        const files = await getRecentFiles(100)
        setActivities(files)
      } catch (error) {
        console.error('Failed to fetch activities:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchActivities()
  }, [])

  // Load folder stats when folder is selected
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

  // Load file metadata when file is selected
  useEffect(() => {
    if (selectedFile && !selectedFile.isDir) {
      setLoadingMetadata(true)
      getFileMetadata(selectedFile.path)
        .then(metadata => {
          setFileMetadata(metadata)
          setDescriptionInput(metadata?.description || '')
        })
        .catch(() => setFileMetadata(null))
        .finally(() => setLoadingMetadata(false))
    } else {
      setFileMetadata(null)
    }
  }, [selectedFile])

  // Load thumbnail for images
  useEffect(() => {
    if (thumbnailUrl) {
      URL.revokeObjectURL(thumbnailUrl)
      setThumbnailUrl(null)
    }
    if (!selectedFile || selectedFile.isDir) return

    const ext = selectedFile.extension?.toLowerCase() || ''
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']
    const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm']

    if (!imageExts.includes(ext) && !videoExts.includes(ext)) return

    const authData = localStorage.getItem('scv-auth')
    const token = authData ? JSON.parse(authData).state?.token : null
    const pathWithoutSlash = selectedFile.path.startsWith('/') ? selectedFile.path.slice(1) : selectedFile.path
    const encodedPath = pathWithoutSlash.split('/').map(part =>
      encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29')
    ).join('/')

    fetch(`/api/thumbnail/${encodedPath}?size=medium`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.ok ? res.blob() : Promise.reject())
      .then(blob => setThumbnailUrl(URL.createObjectURL(blob)))
      .catch(() => setThumbnailUrl(null))

    return () => {
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl)
    }
  }, [selectedFile])

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const tabs: { id: ActivityTab; label: string }[] = [
    { id: 'all', label: '전체' },
    { id: 'upload', label: '업로드' },
    { id: 'download', label: '다운로드' },
    { id: 'edit', label: '편집' },
    { id: 'folder', label: '폴더' },
  ]

  // Convert activities to FileInfo and filter
  const displayFiles = useMemo(() => {
    let result = activities.filter(activity => {
      if (activeTab === 'upload' && activity.eventType !== 'file.upload') return false
      if (activeTab === 'download' && activity.eventType !== 'file.download') return false
      if (activeTab === 'edit' && !['file.edit', 'file.view'].includes(activity.eventType)) return false
      if (activeTab === 'folder' && !['folder.create', 'file.copy', 'file.move', 'file.rename', 'trash.restore'].includes(activity.eventType)) return false

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        return activity.name.toLowerCase().includes(query) || activity.path.toLowerCase().includes(query)
      }
      return true
    })

    result.sort((a, b) => {
      switch (sortOrder) {
        case 'newest': return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        case 'oldest': return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        case 'name-asc': return a.name.localeCompare(b.name, 'ko')
        case 'name-desc': return b.name.localeCompare(a.name, 'ko')
        default: return 0
      }
    })

    return result.map(toFileInfo)
  }, [activities, activeTab, searchQuery, sortOrder])

  // Handlers
  const handleSelectFile = useCallback((file: FileInfo, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedFiles(prev => {
        const next = new Set(prev)
        if (next.has(file.path)) next.delete(file.path)
        else next.add(file.path)
        return next
      })
    } else if (e.shiftKey && focusedIndex >= 0) {
      const currentIndex = displayFiles.findIndex(f => f.path === file.path)
      const start = Math.min(focusedIndex, currentIndex)
      const end = Math.max(focusedIndex, currentIndex)
      const newSelection = new Set<string>()
      for (let i = start; i <= end; i++) {
        newSelection.add(displayFiles[i].path)
      }
      setSelectedFiles(newSelection)
    } else {
      setSelectedFiles(new Set())
      setSelectedFile(file)
    }
  }, [focusedIndex, displayFiles])

  const handleDoubleClick = useCallback((file: FileInfo) => {
    if (file.isDir) {
      onNavigate(file.path)
    } else if (isEditableFile(file)) {
      setEditingFile(file)
    } else if (isViewableFile(file)) {
      setViewingFile(file)
    } else {
      // Fallback: download unrecognized file types
      downloadFile(file.path)
    }
  }, [isEditableFile, isViewableFile, onNavigate])

  const handleContextMenu = useCallback((e: React.MouseEvent, file: FileInfo) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu(file)
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
  }, [])

  const handleGoToLocation = useCallback(() => {
    if (contextMenu) {
      const parentPath = contextMenu.path.substring(0, contextMenu.path.lastIndexOf('/')) || '/home'
      if (onFileSelect) {
        onFileSelect(contextMenu.path, parentPath)
      } else {
        onNavigate(parentPath)
      }
    }
    setContextMenu(null)
  }, [contextMenu, onNavigate, onFileSelect])

  const handleDownload = useCallback(() => {
    if (contextMenu && !contextMenu.isDir) {
      downloadFile(contextMenu.path)
    }
    setContextMenu(null)
  }, [contextMenu])

  const handleCopyPath = useCallback(() => {
    if (contextMenu) {
      navigator.clipboard.writeText(contextMenu.path)
    }
    setContextMenu(null)
  }, [contextMenu])

  const handleView = useCallback((file: FileInfo) => {
    if (isEditableFile(file)) {
      setEditingFile(file)
    } else if (isViewableFile(file)) {
      setViewingFile(file)
    } else {
      // Fallback: download unrecognized file types
      downloadFile(file.path)
    }
  }, [isEditableFile, isViewableFile])

  const handleSaveDescription = useCallback(async () => {
    if (!selectedFile) return
    try {
      await updateFileMetadata(selectedFile.path, { description: descriptionInput })
      setFileMetadata(prev => prev ? { ...prev, description: descriptionInput } : null)
      setEditingDescription(false)
    } catch (error) {
      console.error('Failed to save description:', error)
    }
  }, [selectedFile, descriptionInput])

  const handleAddTag = useCallback(async (tag: string) => {
    if (!selectedFile || !tag.trim()) return
    const newTags = [...(fileMetadata?.tags || []), tag.trim()]
    try {
      await updateFileMetadata(selectedFile.path, { tags: newTags })
      setFileMetadata(prev => prev ? { ...prev, tags: newTags } : null)
      setTagInput('')
    } catch (error) {
      console.error('Failed to add tag:', error)
    }
  }, [selectedFile, fileMetadata])

  const handleRemoveTag = useCallback(async (tag: string) => {
    if (!selectedFile) return
    const newTags = (fileMetadata?.tags || []).filter(t => t !== tag)
    try {
      await updateFileMetadata(selectedFile.path, { tags: newTags })
      setFileMetadata(prev => prev ? { ...prev, tags: newTags } : null)
    } catch (error) {
      console.error('Failed to remove tag:', error)
    }
  }, [selectedFile, fileMetadata])

  const formatDate = (date: string) => {
    const d = new Date(date)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)

    if (diffMin < 60) return `${diffMin}분 전`
    if (diffHour < 24) return `${diffHour}시간 전`
    if (diffDay < 7) return `${diffDay}일 전`
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
  }

  const formatFullDateTime = (date: string) => new Date(date).toLocaleString('ko-KR')

  return (
    <div className={`my-activity ${selectedFile ? 'panel-open' : ''}`}>
      <div className="my-activity-header">
        <h1>내 작업</h1>
        <p className="my-activity-subtitle">최근 파일 작업 기록</p>
      </div>

      <div className="my-activity-toolbar">
        <div className="my-activity-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
            <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder="파일명 또는 경로 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>

        <div className="my-activity-sort">
          <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as SortOrder)}>
            <option value="newest">최신순</option>
            <option value="oldest">오래된순</option>
            <option value="name-asc">이름 (ㄱ-ㅎ)</option>
            <option value="name-desc">이름 (ㅎ-ㄱ)</option>
          </select>
        </div>

        <div className="my-activity-view-toggle">
          <button
            className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            title="리스트 보기"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M8 6H21M8 12H21M8 18H21M3 6H3.01M3 12H3.01M3 18H3.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
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

      <div className="my-activity-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`my-activity-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="tab-count">{displayFiles.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="my-activity-content">
        {loading ? (
          <div className="my-activity-loading">
            <div className="loading-spinner" />
            <span>불러오는 중...</span>
          </div>
        ) : displayFiles.length === 0 ? (
          <div className="my-activity-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p>작업 기록이 없습니다</p>
          </div>
        ) : viewMode === 'list' ? (
          displayFiles.length >= VIRTUALIZATION_THRESHOLD ? (
            <VirtualizedFileTable
              files={displayFiles}
              selectedFiles={selectedFiles}
              focusedIndex={focusedIndex}
              dropTargetPath={null}
              draggedFiles={[]}
              clipboard={null}
              isSharedWithMeView={false}
              isSharedByMeView={false}
              isLinkSharesView={false}
              highlightedPath={null}
              onSelect={handleSelectFile}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
              onDragStart={() => {}}
              onDragEnd={() => {}}
              onFolderDragOver={() => {}}
              onFolderDragLeave={() => {}}
              onFolderDrop={() => {}}
              getFileIcon={(file) => getFileIcon(file, 'small')}
              formatDate={formatDate}
              getFullDateTime={formatFullDateTime}
              setFocusedIndex={setFocusedIndex}
              fileRowRefs={fileRowRefs}
            />
          ) : (
            <div className="file-table">
              <div className="file-table-header">
                <div className="col-name">이름</div>
                <div className="col-size">크기</div>
                <div className="col-date">수정일</div>
                <div className="col-actions"></div>
              </div>
              <div className="file-table-body">
                {displayFiles.map((file, index) => (
                  <FileRow
                    key={file.path}
                    ref={(el) => { if (el) fileRowRefs.current.set(file.path, el); else fileRowRefs.current.delete(file.path); }}
                    file={file}
                    index={index}
                    isSelected={selectedFiles.has(file.path) || selectedFile?.path === file.path}
                    isFocused={focusedIndex === index}
                    isDropTarget={false}
                    isDragging={false}
                    isCut={false}
                    isSharedWithMeView={false}
                    isSharedByMeView={false}
                    isLinkSharesView={false}
                    onSelect={handleSelectFile}
                    onDoubleClick={handleDoubleClick}
                    onContextMenu={handleContextMenu}
                    onDragStart={() => {}}
                    onDragEnd={() => {}}
                    getFileIcon={(file) => getFileIcon(file, 'small')}
                    formatDate={formatDate}
                    getFullDateTime={formatFullDateTime}
                    setFocusedIndex={setFocusedIndex}
                  />
                ))}
              </div>
            </div>
          )
        ) : (
          <div className="file-grid">
            {displayFiles.map((file, index) => (
              <FileCard
                key={file.path}
                ref={(el) => { if (el) fileRowRefs.current.set(file.path, el); else fileRowRefs.current.delete(file.path); }}
                file={file}
                index={index}
                isSelected={selectedFiles.has(file.path) || selectedFile?.path === file.path}
                isFocused={focusedIndex === index}
                isDropTarget={false}
                isDragging={false}
                isCut={false}
                onSelect={handleSelectFile}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
                onDragStart={() => {}}
                onDragEnd={() => {}}
                getFileIcon={(file) => getFileIcon(file, 'large')}
                setFocusedIndex={setFocusedIndex}
              />
            ))}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="activity-context-menu"
          style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Open/View */}
          {!contextMenu.isDir && (isEditableFile(contextMenu) || isViewableFile(contextMenu)) && (
            <button onClick={() => { handleView(contextMenu); setContextMenu(null); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M1 12S5 4 12 4 23 12 23 12 19 20 12 20 1 12 1 12Z" stroke="currentColor" strokeWidth="2"/>
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
              </svg>
              열기
            </button>
          )}

          {/* Download */}
          {!contextMenu.isDir && (
            <button onClick={handleDownload}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M21 15V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              다운로드
            </button>
          )}

          {/* Go to location */}
          <button onClick={handleGoToLocation}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            파일 위치로 가기
          </button>

          {/* Copy path */}
          <button onClick={handleCopyPath}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
              <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" strokeWidth="2"/>
            </svg>
            경로 복사
          </button>
        </div>
      )}

      {/* File Details Panel */}
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
          isSpecialShareView={false}
          onClose={() => setSelectedFile(null)}
          onView={handleView}
          onDownload={(file) => downloadFile(file.path)}
          onShare={() => {}}
          onLinkShare={() => {}}
          onDelete={() => {}}
          onDescriptionChange={setDescriptionInput}
          onDescriptionSave={handleSaveDescription}
          onDescriptionEdit={setEditingDescription}
          onDescriptionInputChange={setDescriptionInput}
          onTagInputChange={setTagInput}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          getFileIcon={(file) => getFileIcon(file, 'large')}
        />
      )}

      {/* Text Editor */}
      {editingFile && (
        <TextEditor
          filePath={editingFile.path}
          fileName={editingFile.name}
          onClose={() => setEditingFile(null)}
          onSaved={() => {}}
        />
      )}

      {/* File Viewer */}
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
    </div>
  )
}

export default MyActivity
