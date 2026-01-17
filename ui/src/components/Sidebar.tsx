import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUploadStore } from '../stores/uploadStore'
import { useTransferStore } from '../stores/transferStore'
import { useAuthStore } from '../stores/authStore'
import { getStorageUsage, formatFileSize } from '../api/files'
import { PERMISSION_READ_WRITE } from '../api/sharedFolders'
import { useSharedFolders } from '../hooks/useSharedFolders'
import { api } from '../api/client'
import './Sidebar.css'

interface VersionInfo {
  version: string
  build_time?: string
  git_commit?: string
}

export type AdminView = 'users' | 'shared-folders' | 'settings' | 'sso' | 'logs' | 'system-info'

interface SidebarProps {
  currentPath: string
  onNavigate: (path: string) => void
  onUploadClick: () => void
  onNewFolderClick: () => void
  onAdminClick?: () => void
  isTrashView?: boolean
  isAdminMode?: boolean
  adminView?: AdminView
  onExitAdminMode?: () => void
  isMobileOpen?: boolean
  onMobileClose?: () => void
}

const icons: Record<string, JSX.Element> = {
  folder: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  shared: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
      <path d="M23 21V19C22.9993 18.1137 22.7044 17.2528 22.1614 16.5523C21.6184 15.8519 20.8581 15.3516 20 15.13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M16 3.13C16.8604 3.35031 17.623 3.85071 18.1676 4.55232C18.7122 5.25392 19.0078 6.11683 19.0078 7.005C19.0078 7.89318 18.7122 8.75608 18.1676 9.45769C17.623 10.1593 16.8604 10.6597 16 10.88" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  trash: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  users: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
      <path d="M23 21V19C22.9993 18.1137 22.7044 17.2528 22.1614 16.5523C21.6184 15.8519 20.8581 15.3516 20 15.13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M16 3.13C16.8604 3.35031 17.623 3.85071 18.1676 4.55232C18.7122 5.25392 19.0078 6.11683 19.0078 7.005C19.0078 7.89318 18.7122 8.75608 18.1676 9.45769C17.623 10.1593 16.8604 10.6597 16 10.88" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  logs: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M16 13H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M16 17H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 9H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  back: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M19 12H5M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  sharedDrive: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="12" cy="14" r="2" stroke="currentColor" strokeWidth="2"/>
      <path d="M12 12V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  sharedDrivesAdmin: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 11V17M9 14H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  sharedWithMe: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M4 12V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M16 6L12 2L8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 2V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  sharedByMe: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M4 12V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M8 18L12 22L16 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 22V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  linkShare: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  sso: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M15 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 17L15 12L10 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M15 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  recent: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
      <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  server: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" stroke="currentColor" strokeWidth="2"/>
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" stroke="currentColor" strokeWidth="2"/>
      <circle cx="6" cy="6" r="1" fill="currentColor"/>
      <circle cx="6" cy="18" r="1" fill="currentColor"/>
    </svg>
  ),
}

function Sidebar({ currentPath, onNavigate, onUploadClick, onNewFolderClick, onAdminClick, isTrashView, isAdminMode, adminView, onExitAdminMode, isMobileOpen, onMobileClose }: SidebarProps) {
  const { items, downloads, togglePanel, clearCompleted, clearCompletedDownloads } = useUploadStore()
  const { items: transferItems, clearCompleted: clearCompletedTransfers } = useTransferStore()
  const { user, token } = useAuthStore()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { sharedFolders } = useSharedFolders()
  const [sharedDrivesExpanded, setSharedDrivesExpanded] = useState(true)
  const [sharingExpanded, setSharingExpanded] = useState(true)

  // Safe arrays to prevent undefined errors
  const safeItems = items || []
  const safeDownloads = downloads || []
  const safeTransferItems = transferItems || []

  // Fetch storage usage with React Query for real-time updates
  const { data: storageUsage, isLoading: isStorageLoading } = useQuery({
    queryKey: ['storage-usage'],
    queryFn: getStorageUsage,
    enabled: !!token,
    refetchInterval: 30000, // Still refresh every 30 seconds as backup
    staleTime: 5000, // Consider data stale after 5 seconds
  })

  // Fetch version info
  const { data: versionInfo } = useQuery({
    queryKey: ['version'],
    queryFn: () => api.get<VersionInfo>('/version', { noAuth: true }),
    staleTime: Infinity, // Version doesn't change during runtime
  })

  // Default values when loading
  const displayStorage = storageUsage ?? { totalUsed: 0, quota: 10 * 1024 * 1024 * 1024, homeUsed: 0, sharedUsed: 0, trashUsed: 0 }

  // Refresh storage usage when uploads complete
  const completedUploadCount = safeItems.filter(i => i.status === 'completed').length
  const completedTransferCount = safeTransferItems.filter(t => t.status === 'completed').length

  useEffect(() => {
    if (completedUploadCount > 0 || completedTransferCount > 0) {
      // Invalidate storage query when uploads/transfers complete
      queryClient.invalidateQueries({ queryKey: ['storage-usage'] })
    }
  }, [completedUploadCount, completedTransferCount, queryClient])

  const activeUploads = safeItems.filter(i => i.status === 'uploading' || i.status === 'pending')
  const activeDownloads = safeDownloads.filter(d => d.status === 'downloading')
  const activeMoveCopy = safeTransferItems.filter(t => t.status === 'pending' || t.status === 'transferring')
  const completedUploads = safeItems.filter(i => i.status === 'completed')
  const completedDownloads = safeDownloads.filter(d => d.status === 'completed')
  const completedMoveCopy = safeTransferItems.filter(t => t.status === 'completed')

  const hasActiveTransfers = activeUploads.length > 0 || activeDownloads.length > 0 || activeMoveCopy.length > 0
  const hasCompletedTransfers = completedUploads.length > 0 || completedDownloads.length > 0 || completedMoveCopy.length > 0
  const hasTransfers = safeItems.length > 0 || safeDownloads.length > 0 || safeTransferItems.length > 0

  // Debug logging for transfers
  if (safeTransferItems.length > 0) {
    console.log('[Sidebar] Transfer items:', transferItems)
    console.log('[Sidebar] Active move/copy:', activeMoveCopy)
    console.log('[Sidebar] hasTransfers:', hasTransfers, 'hasActiveTransfers:', hasActiveTransfers)
  }

  // Calculate overall upload progress
  const uploadProgress = activeUploads.length > 0
    ? Math.round(activeUploads.reduce((sum, i) => sum + i.progress, 0) / activeUploads.length)
    : 0

  // Calculate overall download progress
  const downloadProgress = activeDownloads.length > 0
    ? Math.round(activeDownloads.reduce((sum, d) => sum + d.progress, 0) / activeDownloads.length)
    : 0

  const isActive = (itemPath: string) => {
    return currentPath.startsWith(itemPath)
  }

  const handleClearCompleted = () => {
    clearCompleted()
    clearCompletedDownloads()
    clearCompletedTransfers()
  }

  // Handle navigation with mobile close
  const handleNavigation = (path: string) => {
    onNavigate(path)
    onMobileClose?.()
  }

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${isMobileOpen ? 'visible' : ''}`}
        onClick={onMobileClose}
      />
      <aside className={`sidebar ${isAdminMode ? 'admin-mode' : ''} ${isMobileOpen ? 'mobile-open' : ''}`}>
      {!isAdminMode ? (
        <>
          <div className="sidebar-actions">
            <button className="upload-btn" onClick={onUploadClick} aria-label="파일 업로드">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>업로드</span>
            </button>
            <button className="new-folder-btn" onClick={onNewFolderClick} title="새 폴더" aria-label="새 폴더 만들기">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          <nav className="nav-menu">
            {user && (
              <Link
                to="/files"
                className={`nav-item ${(location.pathname === '/files' || location.pathname === '/') && isActive('/home') ? 'active' : ''}`}
                onClick={() => handleNavigation('/home')}
              >
                {icons.folder}
                <span>내 파일</span>
              </Link>
            )}

            {/* My Activity Link */}
            {user && (
              <Link
                to="/my-activity"
                className={`nav-item ${location.pathname === '/my-activity' ? 'active' : ''}`}
                onClick={() => onMobileClose?.()}
              >
                {icons.recent}
                <span>내 작업</span>
              </Link>
            )}

            {/* Shared Drives Section */}
            {user && sharedFolders.length > 0 && (
              <div className="shared-section">
                <button
                  className="shared-header"
                  onClick={() => setSharedDrivesExpanded(!sharedDrivesExpanded)}
                  aria-expanded={sharedDrivesExpanded}
                  aria-label="공유 드라이브 섹션"
                >
                  {icons.sharedDrive}
                  <span>공유 드라이브</span>
                  <svg
                    className={`chevron ${sharedDrivesExpanded ? 'expanded' : ''}`}
                    aria-hidden="true"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {sharedDrivesExpanded && (
                  <div className="shared-list">
                    {sharedFolders.map(folder => (
                      <Link
                        key={folder.id}
                        to={`/shared-drive/${encodeURIComponent(folder.name)}`}
                        className={`nav-item shared-drive-item ${location.pathname.startsWith(`/shared-drive/${encodeURIComponent(folder.name)}`) ? 'active' : ''}`}
                        onClick={() => onMobileClose?.()}
                      >
                        <span className="drive-name">{folder.name}</span>
                        <span className={`permission-badge ${folder.permissionLevel === PERMISSION_READ_WRITE ? 'rw' : 'r'}`}>
                          {folder.permissionLevel === PERMISSION_READ_WRITE ? 'RW' : 'R'}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Sharing Section */}
            {user && (
              <div className="shared-section">
                <button
                  className="shared-header"
                  onClick={() => setSharingExpanded(!sharingExpanded)}
                  aria-expanded={sharingExpanded}
                  aria-label="공유 섹션"
                >
                  {icons.shared}
                  <span>공유</span>
                  <svg
                    className={`chevron ${sharingExpanded ? 'expanded' : ''}`}
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {sharingExpanded && (
                  <div className="shared-list">
                    <Link
                      to="/shared-with-me"
                      className={`nav-item shared-drive-item ${location.pathname === '/shared-with-me' ? 'active' : ''}`}
                      onClick={() => onMobileClose?.()}
                    >
                      {icons.sharedWithMe}
                      <span>나에게 공유된 파일</span>
                    </Link>
                    <Link
                      to="/shared-by-me"
                      className={`nav-item shared-drive-item ${location.pathname === '/shared-by-me' ? 'active' : ''}`}
                      onClick={() => onMobileClose?.()}
                    >
                      {icons.sharedByMe}
                      <span>다른사용자에 공유된 파일</span>
                    </Link>
                    <Link
                      to="/link-shares"
                      className={`nav-item shared-drive-item ${location.pathname === '/link-shares' ? 'active' : ''}`}
                      onClick={() => onMobileClose?.()}
                    >
                      {icons.linkShare}
                      <span>링크로 공유된 파일</span>
                    </Link>
                  </div>
                )}
              </div>
            )}

            {user && (
              <Link
                to="/trash"
                className={`nav-item ${isTrashView ? 'active' : ''}`}
                onClick={() => onMobileClose?.()}
              >
                {icons.trash}
                <span>휴지통</span>
              </Link>
            )}
          </nav>
        </>
      ) : (
        <>
          <div className="admin-header">
            <div className="admin-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>관리자 설정</span>
            </div>
          </div>

          <nav className="nav-menu">
            <Link
              to="/fhadmin/users"
              className={`nav-item ${adminView === 'users' ? 'active' : ''}`}
              onClick={() => onMobileClose?.()}
            >
              {icons.users}
              <span>사용자 관리</span>
            </Link>
            <Link
              to="/fhadmin/shared-folders"
              className={`nav-item ${adminView === 'shared-folders' ? 'active' : ''}`}
              onClick={() => onMobileClose?.()}
            >
              {icons.sharedDrivesAdmin}
              <span>공유 드라이브</span>
            </Link>
            <Link
              to="/fhadmin/settings"
              className={`nav-item ${adminView === 'settings' ? 'active' : ''}`}
              onClick={() => onMobileClose?.()}
            >
              {icons.settings}
              <span>시스템 설정</span>
            </Link>
            <Link
              to="/fhadmin/sso"
              className={`nav-item ${adminView === 'sso' ? 'active' : ''}`}
              onClick={() => onMobileClose?.()}
            >
              {icons.sso}
              <span>SSO 설정</span>
            </Link>
            <Link
              to="/fhadmin/logs"
              className={`nav-item ${adminView === 'logs' ? 'active' : ''}`}
              onClick={() => onMobileClose?.()}
            >
              {icons.logs}
              <span>감사 로그</span>
            </Link>
            <Link
              to="/fhadmin/system-info"
              className={`nav-item ${adminView === 'system-info' ? 'active' : ''}`}
              onClick={() => onMobileClose?.()}
            >
              {icons.server}
              <span>서버 정보</span>
            </Link>
          </nav>
        </>
      )}

      <div className="sidebar-footer">
        {/* Admin Mode Toggle Button */}
        {user?.isAdmin && (
          isAdminMode ? (
            <button className="admin-btn exit-admin" onClick={onExitAdminMode}>
              {icons.back}
              <span>일반 모드로</span>
            </button>
          ) : (
            onAdminClick && (
              <button className="admin-btn" onClick={onAdminClick}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>관리자 모드</span>
              </button>
            )
          )
        )}

        {/* Transfer Progress Section - Always visible */}
        <div className="transfer-section">
          <div className="transfer-header" onClick={togglePanel}>
            <svg className="transfer-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2V6M12 18V22M4.93 4.93L7.76 7.76M16.24 16.24L19.07 19.07M2 12H6M18 12H22M4.93 19.07L7.76 16.24M16.24 7.76L19.07 4.93" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="transfer-title">전송 현황</span>
            {hasActiveTransfers && (
              <span className="transfer-badge active">{activeUploads.length + activeDownloads.length + activeMoveCopy.length}</span>
            )}
            {!hasActiveTransfers && hasCompletedTransfers && (
              <span className="transfer-badge completed">{completedUploads.length + completedDownloads.length + completedMoveCopy.length}</span>
            )}
          </div>

          {/* Active transfers mini view */}
          {hasActiveTransfers && (
            <div className="transfer-mini">
              {activeUploads.length > 0 && (
                <div className="transfer-mini-item">
                  <div className="transfer-mini-icon upload">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div className="transfer-mini-info">
                    <span className="transfer-mini-label">업로드 {activeUploads.length}개</span>
                    <div className="transfer-mini-bar">
                      <div className="transfer-mini-fill" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  </div>
                  <span className="transfer-mini-percent">{uploadProgress}%</span>
                </div>
              )}
              {activeDownloads.length > 0 && (
                <div className="transfer-mini-item">
                  <div className="transfer-mini-icon download">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div className="transfer-mini-info">
                    <span className="transfer-mini-label">다운로드 {activeDownloads.length}개</span>
                    <div className="transfer-mini-bar">
                      <div className="transfer-mini-fill download" style={{ width: `${downloadProgress}%` }} />
                    </div>
                  </div>
                  <span className="transfer-mini-percent">{downloadProgress}%</span>
                </div>
              )}
              {activeMoveCopy.length > 0 && (() => {
                const transferringItems = activeMoveCopy.filter(t => t.status === 'transferring')
                const avgProgress = transferringItems.length > 0
                  ? Math.round(transferringItems.reduce((sum, t) => sum + (t.progress || 0), 0) / transferringItems.length)
                  : 0
                return (
                  <div className="transfer-mini-item">
                    <div className="transfer-mini-icon move-copy">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div className="transfer-mini-info">
                      <span className="transfer-mini-label">
                        {activeMoveCopy.filter(t => t.type === 'move').length > 0 && `이동 ${activeMoveCopy.filter(t => t.type === 'move').length}개`}
                        {activeMoveCopy.filter(t => t.type === 'move').length > 0 && activeMoveCopy.filter(t => t.type === 'copy').length > 0 && ' / '}
                        {activeMoveCopy.filter(t => t.type === 'copy').length > 0 && `복사 ${activeMoveCopy.filter(t => t.type === 'copy').length}개`}
                      </span>
                      <div className="transfer-mini-bar">
                        <div className="transfer-mini-fill move-copy" style={{ width: `${avgProgress}%` }} />
                      </div>
                    </div>
                    <span className="transfer-mini-percent">
                      {transferringItems.length > 0 ? `${avgProgress}%` : '대기'}
                    </span>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Completed notification */}
          {!hasActiveTransfers && hasCompletedTransfers && (
            <div className="transfer-completed">
              <span>완료 {completedUploads.length + completedDownloads.length + completedMoveCopy.length}개</span>
              <button className="clear-btn" onClick={handleClearCompleted}>삭제</button>
            </div>
          )}

          {/* Idle state */}
          {!hasTransfers && (
            <div className="transfer-idle" onClick={togglePanel}>
              <span>진행 중인 전송 없음</span>
            </div>
          )}
        </div>

        {/* Storage Info */}
        <div className="storage-info">
          <div className="storage-header">
            <span className="storage-label">저장 공간</span>
            <span className="storage-value">
              {isStorageLoading ? '로딩...' : `${formatFileSize(displayStorage.totalUsed)} / ${formatFileSize(displayStorage.quota)}`}
            </span>
          </div>
          <div className="storage-bar">
            <div className="storage-bar-fill" style={{ width: `${Math.min(100, (displayStorage.totalUsed / displayStorage.quota) * 100)}%` }} />
          </div>
          {!isStorageLoading && displayStorage.trashUsed > 0 && (
            <div className="storage-detail">
              <span className="storage-detail-text">
                휴지통: {formatFileSize(displayStorage.trashUsed)}
              </span>
            </div>
          )}
        </div>

        {/* Version & GitHub Link */}
        <div className="sidebar-version">
          <span className="version-text">
            v{versionInfo?.version || '0.0.0'}
          </span>
          <a
            href="https://github.com/svrforum/filehatch"
            target="_blank"
            rel="noopener noreferrer"
            className="github-link"
            title="GitHub"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
        </div>
      </div>
    </aside>
    </>
  )
}

export default Sidebar
