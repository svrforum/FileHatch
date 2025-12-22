import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useUploadStore } from '../stores/uploadStore'
import { useAuthStore } from '../stores/authStore'
import { getStorageUsage, formatFileSize } from '../api/files'
import './Sidebar.css'

export type AdminView = 'users' | 'settings' | 'logs'

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
}

function Sidebar({ currentPath, onNavigate, onUploadClick, onNewFolderClick, onAdminClick, isTrashView, isAdminMode, adminView, onExitAdminMode }: SidebarProps) {
  const { items, downloads, togglePanel, isPanelOpen, clearCompleted, clearCompletedDownloads } = useUploadStore()
  const { user } = useAuthStore()
  const [storageUsage, setStorageUsage] = useState({ totalUsed: 0, quota: 10 * 1024 * 1024 * 1024 })

  // Fetch storage usage
  useEffect(() => {
    const fetchUsage = async () => {
      try {
        const usage = await getStorageUsage()
        setStorageUsage(usage)
      } catch {
        // Ignore errors
      }
    }
    fetchUsage()
    // Refresh every 30 seconds
    const interval = setInterval(fetchUsage, 30000)
    return () => clearInterval(interval)
  }, [])

  const activeUploads = items.filter(i => i.status === 'uploading' || i.status === 'pending')
  const activeDownloads = downloads.filter(d => d.status === 'downloading')
  const completedUploads = items.filter(i => i.status === 'completed')
  const completedDownloads = downloads.filter(d => d.status === 'completed')

  const hasActiveTransfers = activeUploads.length > 0 || activeDownloads.length > 0
  const hasCompletedTransfers = completedUploads.length > 0 || completedDownloads.length > 0
  const hasTransfers = items.length > 0 || downloads.length > 0

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
  }

  return (
    <aside className={`sidebar ${isAdminMode ? 'admin-mode' : ''}`}>
      {!isAdminMode ? (
        <>
          <div className="sidebar-actions">
            <button className="upload-btn" onClick={onUploadClick}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>업로드</span>
            </button>
            <button className="new-folder-btn" onClick={onNewFolderClick} title="새 폴더">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          <nav className="nav-menu">
            {user && (
              <Link
                to="/files"
                className={`nav-item ${isActive('/home') ? 'active' : ''}`}
                onClick={() => onNavigate('/home')}
              >
                {icons.folder}
                <span>내 파일</span>
              </Link>
            )}
            <Link
              to="/files"
              className={`nav-item ${isActive('/shared') ? 'active' : ''}`}
              onClick={() => onNavigate('/shared')}
            >
              {icons.shared}
              <span>공유 폴더</span>
            </Link>
            {user && (
              <Link
                to="/trash"
                className={`nav-item ${isTrashView ? 'active' : ''}`}
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
              to="/scvadmin/users"
              className={`nav-item ${adminView === 'users' ? 'active' : ''}`}
            >
              {icons.users}
              <span>사용자 관리</span>
            </Link>
            <Link
              to="/scvadmin/settings"
              className={`nav-item ${adminView === 'settings' ? 'active' : ''}`}
            >
              {icons.settings}
              <span>시스템 설정</span>
            </Link>
            <Link
              to="/scvadmin/logs"
              className={`nav-item ${adminView === 'logs' ? 'active' : ''}`}
            >
              {icons.logs}
              <span>감사 로그</span>
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

        {/* Transfer Progress Section */}
        {hasTransfers && (
          <div className="transfer-section">
            <div className="transfer-header" onClick={togglePanel}>
              <span className="transfer-title">전송 현황</span>
              {hasActiveTransfers && (
                <span className="transfer-badge">{activeUploads.length + activeDownloads.length}</span>
              )}
              <svg className={`transfer-chevron ${isPanelOpen ? 'open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
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
              </div>
            )}

            {/* Completed notification */}
            {!hasActiveTransfers && hasCompletedTransfers && (
              <div className="transfer-completed">
                <span>완료 {completedUploads.length + completedDownloads.length}개</span>
                <button className="clear-btn" onClick={handleClearCompleted}>삭제</button>
              </div>
            )}
          </div>
        )}

        {/* Storage Info */}
        <div className="storage-info">
          <div className="storage-header">
            <span className="storage-label">저장 공간</span>
            <span className="storage-value">{formatFileSize(storageUsage.totalUsed)} / {formatFileSize(storageUsage.quota)}</span>
          </div>
          <div className="storage-bar">
            <div className="storage-bar-fill" style={{ width: `${Math.min(100, (storageUsage.totalUsed / storageUsage.quota) * 100)}%` }} />
          </div>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
