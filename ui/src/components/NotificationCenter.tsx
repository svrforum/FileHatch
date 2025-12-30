import { useState, useMemo } from 'react'
import { useNotifications } from '../hooks/useNotifications'
import { Notification } from '../api/notifications'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import './NotificationCenter.css'

type FilterType = 'all' | 'unread' | 'read'

// Format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Format full date
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

// Get notification type label
function getNotificationTypeLabel(type: string): string {
  switch (type) {
    case 'share.received': return '파일 공유 받음'
    case 'share.permission_changed': return '공유 권한 변경'
    case 'share.removed': return '공유 취소됨'
    case 'shared_folder.invited': return '공유 폴더 초대'
    case 'shared_folder.removed': return '공유 폴더 제외'
    case 'shared_file.modified': return '공유 파일 수정'
    case 'share_link.accessed': return '링크 접속/다운로드'
    case 'upload_link.received': return '업로드 링크 파일 수신'
    default: return '알림'
  }
}

// Get notification icon
function getNotificationIcon(type: string): string {
  switch (type) {
    case 'share.received': return '📁'
    case 'share.permission_changed': return '🔐'
    case 'share.removed': return '❌'
    case 'shared_folder.invited': return '📂'
    case 'shared_folder.removed': return '🚫'
    case 'shared_file.modified': return '✏️'
    case 'share_link.accessed': return '🔗'
    case 'upload_link.received': return '📤'
    default: return '🔔'
  }
}

function NotificationCenter() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isAdmin = user?.isAdmin ?? false
  const [filter, setFilter] = useState<FilterType>('all')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const {
    notifications,
    unreadCount,
    isLoading,
    handleMarkAsRead,
    handleMarkAllAsRead,
    handleDelete,
    handleDeleteAllRead,
    refresh
  } = useNotifications()

  // Filter notifications
  const filteredNotifications = useMemo(() => {
    switch (filter) {
      case 'unread':
        return notifications.filter(n => !n.isRead)
      case 'read':
        return notifications.filter(n => n.isRead)
      default:
        return notifications
    }
  }, [notifications, filter])

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      handleMarkAsRead(notification.id)
    }
    setExpandedId(expandedId === notification.id ? null : notification.id)
  }

  const handleGoToLink = (notification: Notification) => {
    if (notification.link) {
      navigate(notification.link)
    }
  }

  // Render metadata details
  const renderMetadataDetails = (notification: Notification) => {
    const meta = notification.metadata as Record<string, unknown> | undefined
    if (!meta) return null

    return (
      <div className="notification-detail__metadata">
        {meta.filename != null && (
          <div className="metadata-item">
            <span className="metadata-label">파일명:</span>
            <span className="metadata-value">{String(meta.filename)}</span>
          </div>
        )}
        {meta.size != null && (
          <div className="metadata-item">
            <span className="metadata-label">파일 크기:</span>
            <span className="metadata-value">{formatFileSize(Number(meta.size))}</span>
          </div>
        )}
        {isAdmin && meta.clientIP != null && (
          <div className="metadata-item">
            <span className="metadata-label">접속 IP:</span>
            <span className="metadata-value">{String(meta.clientIP)}</span>
          </div>
        )}
        {meta.shareToken != null && (
          <div className="metadata-item">
            <span className="metadata-label">공유 토큰:</span>
            <span className="metadata-value code">{String(meta.shareToken).substring(0, 16)}...</span>
          </div>
        )}
        {meta.token != null && (
          <div className="metadata-item">
            <span className="metadata-label">토큰:</span>
            <span className="metadata-value code">{String(meta.token).substring(0, 16)}...</span>
          </div>
        )}
        {meta.path != null && (
          <div className="metadata-item">
            <span className="metadata-label">경로:</span>
            <span className="metadata-value">{String(meta.path)}</span>
          </div>
        )}
        {meta.permission != null && (
          <div className="metadata-item">
            <span className="metadata-label">권한:</span>
            <span className="metadata-value">{String(meta.permission)}</span>
          </div>
        )}
        {meta.sharedBy != null && (
          <div className="metadata-item">
            <span className="metadata-label">공유자:</span>
            <span className="metadata-value">{String(meta.sharedBy)}</span>
          </div>
        )}
        {meta.folderName != null && (
          <div className="metadata-item">
            <span className="metadata-label">폴더명:</span>
            <span className="metadata-value">{String(meta.folderName)}</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="notification-center">
      <div className="notification-center__header">
        <div className="header-left">
          <Link to="/files" className="back-link">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19L5 12L12 5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <h1>알림 센터</h1>
          {unreadCount > 0 && (
            <span className="unread-badge">{unreadCount}개 읽지 않음</span>
          )}
        </div>
        <div className="header-actions">
          <button onClick={refresh} className="action-btn" title="새로고침">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            onClick={handleMarkAllAsRead}
            className="action-btn"
            disabled={unreadCount === 0}
            title="모두 읽음 처리"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            onClick={handleDeleteAllRead}
            className="action-btn danger"
            title="읽은 알림 삭제"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="notification-center__filters">
        <button
          className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          전체 ({notifications.length})
        </button>
        <button
          className={`filter-btn ${filter === 'unread' ? 'active' : ''}`}
          onClick={() => setFilter('unread')}
        >
          읽지 않음 ({unreadCount})
        </button>
        <button
          className={`filter-btn ${filter === 'read' ? 'active' : ''}`}
          onClick={() => setFilter('read')}
        >
          읽음 ({notifications.length - unreadCount})
        </button>
      </div>

      <div className="notification-center__content">
        {isLoading && notifications.length === 0 ? (
          <div className="notification-center__empty">
            <div className="spinner" />
            <span>로딩 중...</span>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="notification-center__empty">
            <span className="empty-icon">🔔</span>
            <span>알림이 없습니다</span>
          </div>
        ) : (
          <div className="notification-list-full">
            {filteredNotifications.map((notification) => (
              <div
                key={notification.id}
                className={`notification-card ${notification.isRead ? 'read' : 'unread'} ${expandedId === notification.id ? 'expanded' : ''}`}
              >
                <div
                  className="notification-card__header"
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="notification-card__icon">
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="notification-card__main">
                    <div className="notification-card__type">
                      {getNotificationTypeLabel(notification.type)}
                    </div>
                    <div className="notification-card__title">
                      {notification.title}
                    </div>
                    {notification.message && (
                      <div className="notification-card__message">
                        {notification.message}
                      </div>
                    )}
                    <div className="notification-card__time">
                      {formatDate(notification.createdAt)}
                      {notification.actorName && (
                        <span className="notification-card__actor">
                          &bull; {notification.actorName}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="notification-card__actions">
                    {!notification.isRead && (
                      <span className="unread-dot" title="읽지 않음" />
                    )}
                    <svg
                      className={`expand-icon ${expandedId === notification.id ? 'rotated' : ''}`}
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M6 9L12 15L18 9" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>

                {expandedId === notification.id && (
                  <div className="notification-card__details">
                    <div className="notification-detail__section">
                      <h4>상세 정보</h4>
                      {renderMetadataDetails(notification)}
                      {!notification.metadata && (
                        <p className="no-details">추가 정보가 없습니다.</p>
                      )}
                    </div>
                    <div className="notification-detail__actions">
                      {notification.link && (
                        <button
                          className="detail-btn primary"
                          onClick={() => handleGoToLink(notification)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" strokeLinecap="round" strokeLinejoin="round"/>
                            <polyline points="15 3 21 3 21 9" strokeLinecap="round" strokeLinejoin="round"/>
                            <line x1="10" y1="14" x2="21" y2="3" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          바로가기
                        </button>
                      )}
                      <button
                        className="detail-btn danger"
                        onClick={() => handleDelete(notification.id)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        삭제
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default NotificationCenter
