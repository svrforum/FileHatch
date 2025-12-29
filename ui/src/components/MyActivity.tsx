import { useState, useEffect, useMemo, useCallback } from 'react'
import { getRecentFiles, RecentFile, downloadFile } from '../api/files'
import './MyActivity.css'

type ActivityTab = 'all' | 'upload' | 'download' | 'edit' | 'folder'
type SortOrder = 'newest' | 'oldest' | 'name-asc' | 'name-desc'

interface MyActivityProps {
  onNavigate: (path: string) => void
  onFileSelect?: (filePath: string, parentPath: string) => void
}

// Normalize path to ensure it starts with /home/
// Storage paths like "users/admin/folder/file.txt" -> "/home/folder/file.txt"
// The "users/username" prefix represents the user's home directory
function normalizePath(path: string): string {
  if (!path) return '/home'

  // If path already starts with /home or /shared, return as-is
  if (path.startsWith('/home') || path.startsWith('/shared')) {
    return path
  }

  // Handle paths like "users/admin/folder/..." -> "/home/folder/..."
  // The format is: users/{username}/{actual_path}
  if (path.startsWith('users/')) {
    const parts = path.substring(6).split('/') // Remove "users/"
    if (parts.length > 1) {
      // Skip the first part (username) and use the rest
      return '/home/' + parts.slice(1).join('/')
    } else if (parts.length === 1) {
      // Only username, no sub-path
      return '/home'
    }
  }

  // Handle paths like "shared/..." -> "/shared/..."
  if (path.startsWith('shared/')) {
    return '/' + path
  }

  // Add leading slash if missing
  if (!path.startsWith('/')) {
    return '/home/' + path
  }

  return path
}

interface ContextMenuState {
  x: number
  y: number
  activity: RecentFile | null
}

// Map event types to display names
const eventTypeLabels: Record<string, string> = {
  'file.upload': '업로드',
  'file.download': '다운로드',
  'file.view': '열람',
  'file.edit': '편집',
  'file.copy': '복사',
  'file.move': '이동',
  'folder.create': '폴더 생성',
  'trash.restore': '복구',
}

// Map event types to icons
const eventTypeIcons: Record<string, JSX.Element> = {
  'file.upload': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  'file.download': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  'file.view': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M1 12S5 4 12 4 23 12 23 12 19 20 12 20 1 12 1 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
    </svg>
  ),
  'file.edit': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  'file.copy': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
      <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" strokeWidth="2"/>
    </svg>
  ),
  'file.move': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M5 9L2 12L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9 5L12 2L15 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M15 19L12 22L9 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M19 9L22 12L19 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 12H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 2V22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  'folder.create': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 11V17M9 14H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  'trash.restore': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M3 12C3 16.9706 7.02944 21 12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C8.5 3 5.5 5 4 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3 3V8H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
}

// File icon
const fileIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// Folder icon
const folderIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return '방금 전'
  if (diffMin < 60) return `${diffMin}분 전`
  if (diffHour < 24) return `${diffHour}시간 전`
  if (diffDay < 7) return `${diffDay}일 전`

  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

function MyActivity({ onNavigate, onFileSelect }: MyActivityProps) {
  const [activeTab, setActiveTab] = useState<ActivityTab>('all')
  const [activities, setActivities] = useState<RecentFile[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ x: 0, y: 0, activity: null })

  const closeContextMenu = useCallback(() => {
    setContextMenu({ x: 0, y: 0, activity: null })
  }, [])

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => closeContextMenu()
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [closeContextMenu])

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        setLoading(true)
        const files = await getRecentFiles(50)
        setActivities(files)
      } catch (error) {
        console.error('Failed to fetch activities:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchActivities()
  }, [])

  const tabs: { id: ActivityTab; label: string }[] = [
    { id: 'all', label: '전체' },
    { id: 'upload', label: '업로드' },
    { id: 'download', label: '다운로드' },
    { id: 'edit', label: '편집' },
    { id: 'folder', label: '폴더' },
  ]

  const filteredActivities = useMemo(() => {
    let result = activities.filter(activity => {
      // Tab filter
      if (activeTab === 'upload' && activity.eventType !== 'file.upload') return false
      if (activeTab === 'download' && activity.eventType !== 'file.download') return false
      if (activeTab === 'edit' && !['file.edit', 'file.view'].includes(activity.eventType)) return false
      if (activeTab === 'folder' && !['folder.create', 'file.copy', 'file.move', 'trash.restore'].includes(activity.eventType)) return false

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        return activity.name.toLowerCase().includes(query) ||
               activity.path.toLowerCase().includes(query)
      }
      return true
    })

    // Sort
    result.sort((a, b) => {
      switch (sortOrder) {
        case 'newest':
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        case 'oldest':
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        case 'name-asc':
          return a.name.localeCompare(b.name, 'ko')
        case 'name-desc':
          return b.name.localeCompare(a.name, 'ko')
        default:
          return 0
      }
    })

    return result
  }, [activities, activeTab, searchQuery, sortOrder])

  const handleItemClick = (activity: RecentFile) => {
    // Normalize and extract parent folder path from file path
    const normalizedPath = normalizePath(activity.path)
    const parentPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/')) || '/home'

    if (activity.isDir) {
      // For folders, navigate directly to the folder
      onNavigate(normalizedPath)
    } else if (onFileSelect) {
      // For files, navigate to parent and select the file
      onFileSelect(normalizedPath, parentPath)
    } else {
      // Fallback: just navigate to parent folder
      onNavigate(parentPath)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, activity: RecentFile) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      activity
    })
  }

  const handleOpenFolder = () => {
    if (contextMenu.activity) {
      const normalizedPath = normalizePath(contextMenu.activity.path)
      const parentPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/')) || '/home'
      onNavigate(parentPath)
    }
    closeContextMenu()
  }

  const handleDownload = async () => {
    if (contextMenu.activity && !contextMenu.activity.isDir) {
      const normalizedPath = normalizePath(contextMenu.activity.path)
      try {
        await downloadFile(normalizedPath)
      } catch (error) {
        console.error('Download failed:', error)
      }
    }
    closeContextMenu()
  }

  const handleCopyPath = () => {
    if (contextMenu.activity) {
      const normalizedPath = normalizePath(contextMenu.activity.path)
      navigator.clipboard.writeText(normalizedPath)
    }
    closeContextMenu()
  }

  return (
    <div className="my-activity">
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
              <span className="tab-count">
                {filteredActivities.length}
              </span>
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
        ) : filteredActivities.length === 0 ? (
          <div className="my-activity-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p>작업 기록이 없습니다</p>
          </div>
        ) : (
          <div className="my-activity-list">
            {filteredActivities.map((activity, index) => {
              const normalizedPath = normalizePath(activity.path)
              return (
                <div
                  key={`${activity.path}-${index}`}
                  className="my-activity-item"
                  onClick={() => handleItemClick(activity)}
                  onContextMenu={(e) => handleContextMenu(e, activity)}
                >
                  <div className="activity-icon-wrapper">
                    {activity.isDir ? folderIcon : fileIcon}
                  </div>
                  <div className="activity-info">
                    <div className="activity-name">{activity.name}</div>
                    <div className="activity-path">{normalizedPath}</div>
                  </div>
                  <div className="activity-meta">
                    <div className="activity-type">
                      {eventTypeIcons[activity.eventType] || fileIcon}
                      <span>{eventTypeLabels[activity.eventType] || activity.eventType}</span>
                    </div>
                    <div className="activity-time">{formatRelativeTime(activity.timestamp)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu.activity && (
        <div
          className="activity-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={handleOpenFolder}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            폴더 열기
          </button>
          {!contextMenu.activity.isDir && (
            <button onClick={handleDownload}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              다운로드
            </button>
          )}
          <button onClick={handleCopyPath}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
              <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" strokeWidth="2"/>
            </svg>
            경로 복사
          </button>
        </div>
      )}
    </div>
  )
}

export default MyActivity
