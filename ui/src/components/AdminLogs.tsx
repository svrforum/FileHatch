import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../stores/authStore'
import './AdminLogs.css'

type LogTab = 'file' | 'user' | 'admin' | 'system'
type LogLevel = 'all' | 'info' | 'warn' | 'error' | 'fatal'
type DatePreset = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'

interface AuditLogEntry {
  id: number
  timestamp: string
  actorId?: string
  actorUsername?: string
  ipAddress: string
  eventType: string
  targetResource: string
  details?: {
    source?: string
    fileName?: string
    isDir?: boolean
    [key: string]: unknown
  }
}

interface SystemLogEntry {
  timestamp: string
  container: string
  level: string
  message: string
}

const ITEMS_PER_PAGE = 50

// Helper to format date to YYYY-MM-DD (using local timezone)
const formatDateForInput = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Get date range for presets
const getDateRange = (preset: DatePreset): { startDate: string; endDate: string } => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  switch (preset) {
    case 'today':
      return { startDate: formatDateForInput(today), endDate: formatDateForInput(today) }
    case 'yesterday': {
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      return { startDate: formatDateForInput(yesterday), endDate: formatDateForInput(yesterday) }
    }
    case 'week': {
      const weekAgo = new Date(today)
      weekAgo.setDate(weekAgo.getDate() - 7)
      return { startDate: formatDateForInput(weekAgo), endDate: formatDateForInput(today) }
    }
    case 'month': {
      const monthAgo = new Date(today)
      monthAgo.setMonth(monthAgo.getMonth() - 1)
      return { startDate: formatDateForInput(monthAgo), endDate: formatDateForInput(today) }
    }
    default:
      return { startDate: '', endDate: '' }
  }
}

function AdminLogs() {
  const { user: currentUser, token } = useAuthStore()
  const [activeTab, setActiveTab] = useState<LogTab>(() => {
    const saved = localStorage.getItem('admin-logs-tab')
    return (saved === 'file' || saved === 'user' || saved === 'admin' || saved === 'system') ? saved : 'file'
  })
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [logLevel, setLogLevel] = useState<LogLevel>('all')
  const [container, setContainer] = useState<string>('all')
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('all')

  // Date range filter
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)

  // Stats
  const [stats, setStats] = useState({
    total: 0,
    today: 0,
    thisWeek: 0,
  })

  const handleTabChange = (tab: LogTab) => {
    setActiveTab(tab)
    setCurrentPage(1)
    setSearchQuery('')
    setEventTypeFilter('all')
    setDatePreset('all')
    setStartDate('')
    setEndDate('')
    localStorage.setItem('admin-logs-tab', tab)
  }

  const handleDatePresetChange = (preset: DatePreset) => {
    setDatePreset(preset)
    if (preset !== 'custom') {
      const range = getDateRange(preset)
      setStartDate(range.startDate)
      setEndDate(range.endDate)
    }
    setCurrentPage(1)
  }

  const handleCustomDateChange = (type: 'start' | 'end', value: string) => {
    if (type === 'start') {
      setStartDate(value)
    } else {
      setEndDate(value)
    }
    setDatePreset('custom')
    setCurrentPage(1)
  }

  const loadAuditLogs = useCallback(async () => {
    setLoading(true)
    try {
      const category = activeTab
      const offset = (currentPage - 1) * ITEMS_PER_PAGE
      let url = `/api/audit/logs?category=${category}&limit=${ITEMS_PER_PAGE}&offset=${offset}`

      if (eventTypeFilter !== 'all') {
        url += `&eventType=${encodeURIComponent(eventTypeFilter)}`
      }

      // Add date range filter
      if (startDate) {
        url += `&startDate=${startDate}`
      }
      if (endDate) {
        url += `&endDate=${endDate}`
      }

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      if (response.ok) {
        const data = await response.json()
        setAuditLogs(data.logs || [])
        setTotalItems(data.total || 0)

        // Calculate stats
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

        const todayCount = (data.logs || []).filter((log: AuditLogEntry) =>
          new Date(log.timestamp) >= today
        ).length

        const weekCount = (data.logs || []).filter((log: AuditLogEntry) =>
          new Date(log.timestamp) >= weekAgo
        ).length

        setStats({
          total: data.total || 0,
          today: todayCount,
          thisWeek: weekCount,
        })
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err)
    } finally {
      setLoading(false)
    }
  }, [activeTab, token, currentPage, eventTypeFilter, startDate, endDate])

  const loadSystemLogs = useCallback(async () => {
    setLoading(true)
    try {
      let url = '/api/audit/system?tail=300'
      if (logLevel !== 'all') {
        url += `&level=${logLevel}`
      }
      if (container !== 'all') {
        url += `&container=${container}`
      }
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      if (response.ok) {
        const data = await response.json()
        setSystemLogs(data.logs || [])
      }
    } catch (err) {
      console.error('Failed to load system logs:', err)
    } finally {
      setLoading(false)
    }
  }, [token, logLevel, container])

  useEffect(() => {
    if (activeTab === 'system') {
      loadSystemLogs()
    } else {
      loadAuditLogs()
    }
  }, [activeTab, loadAuditLogs, loadSystemLogs])

  const handleRefresh = () => {
    if (activeTab === 'system') {
      loadSystemLogs()
    } else {
      loadAuditLogs()
    }
  }

  // Filter logs by search query
  const filteredAuditLogs = auditLogs.filter(log =>
    (log.actorUsername?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
    log.eventType.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.targetResource.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.ipAddress.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredSystemLogs = systemLogs.filter(log =>
    log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.container.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Get unique event types for filter
  const eventTypes = Array.from(new Set(auditLogs.map(log => log.eventType))).sort()

  const getEventTypeLabel = (eventType: string) => {
    const labels: Record<string, string> = {
      'file.view': '파일 조회',
      'file.download': '파일 다운로드',
      'file.upload': '파일 업로드',
      'file.delete': '파일 삭제',
      'file.rename': '파일 이름변경',
      'folder.create': '폴더 생성',
      'folder.delete': '폴더 삭제',
      'smb.create': 'SMB 생성',
      'smb.modify': 'SMB 수정',
      'smb.delete': 'SMB 삭제',
      'smb.rename': 'SMB 이름변경',
      'smb_open': 'SMB 파일 열기',
      'smb_create': 'SMB 파일 생성',
      'smb_write': 'SMB 파일 쓰기',
      'smb_mkdir': 'SMB 폴더 생성',
      'smb_rmdir': 'SMB 폴더 삭제',
      'smb_delete': 'SMB 삭제',
      'smb_rename': 'SMB 이름변경',
      'smb_read': 'SMB 읽기',
      'user.login': '로그인',
      'user.logout': '로그아웃',
      'share.create': '공유 생성',
      'share.access': '공유 접근',
      'admin.user.create': '사용자 생성',
      'admin.user.update': '사용자 수정',
      'admin.user.delete': '사용자 삭제',
      'admin.user.activate': '사용자 활성화',
      'admin.user.deactivate': '사용자 비활성화',
      'admin.smb.enable': 'SMB 활성화',
      'admin.smb.disable': 'SMB 비활성화',
      'admin.settings.update': '설정 변경',
    }
    return labels[eventType] || eventType
  }

  const getActionColor = (eventType: string) => {
    if (eventType.includes('login')) return 'action-login'
    if (eventType.includes('logout')) return 'action-logout'
    if (eventType.includes('upload') || eventType.includes('create')) return 'action-upload'
    if (eventType.includes('download') || eventType.includes('view')) return 'action-download'
    if (eventType.includes('delete')) return 'action-delete'
    if (eventType.includes('share')) return 'action-share'
    if (eventType.startsWith('smb.') || eventType.startsWith('smb_')) return 'action-smb'
    if (eventType.startsWith('admin.')) return 'action-admin'
    return 'action-default'
  }

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'fatal': return 'level-fatal'
      case 'error': return 'level-error'
      case 'warn': return 'level-warn'
      case 'info': return 'level-info'
      case 'debug': return 'level-debug'
      default: return 'level-info'
    }
  }

  const formatDetails = (log: AuditLogEntry) => {
    if (log.details?.source === 'smb') {
      return `${log.details.fileName || log.targetResource} (SMB)`
    }
    return log.targetResource
  }

  const formatIpAddress = (ip: string) => {
    if (!ip || ip === '') return 'SMB'
    return ip
  }

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 60000) return '방금 전'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`

    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Pagination
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE)

  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    const maxVisible = 5

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i)
        pages.push('...')
        pages.push(totalPages)
      } else if (currentPage >= totalPages - 2) {
        pages.push(1)
        pages.push('...')
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i)
      } else {
        pages.push(1)
        pages.push('...')
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i)
        pages.push('...')
        pages.push(totalPages)
      }
    }

    return pages
  }

  if (!currentUser?.isAdmin) {
    return <div className="admin-logs-page">권한이 없습니다.</div>
  }

  return (
    <div className="admin-logs-page">
      {/* Header */}
      <div className="logs-page-header">
        <div className="header-content">
          <div className="header-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M16 13H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M16 17H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M10 9H9H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <h1>시스템 로그</h1>
            <p>파일 변경, 사용자 활동, 관리자 로그를 확인합니다.</p>
          </div>
        </div>
        <button className="refresh-btn" onClick={handleRefresh} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={loading ? 'spinning' : ''}>
            <path d="M1 4V10H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M23 20V14H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14L18.36 18.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          새로고침
        </button>
      </div>

      {/* Stats Cards - Only for audit logs */}
      {activeTab !== 'system' && (
        <div className="logs-stats">
          <div className="stat-card">
            <div className="stat-icon total">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2"/>
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-value">{stats.total.toLocaleString()}</span>
              <span className="stat-label">전체 로그</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon today">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-value">{stats.today.toLocaleString()}</span>
              <span className="stat-label">오늘</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon week">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
                <path d="M16 2V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M8 2V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M3 10H21" stroke="currentColor" strokeWidth="2"/>
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-value">{stats.thisWeek.toLocaleString()}</span>
              <span className="stat-label">이번 주</span>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="logs-tabs">
        <button
          className={`tab-btn ${activeTab === 'file' ? 'active' : ''}`}
          onClick={() => handleTabChange('file')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          파일 감사로그
        </button>
        <button
          className={`tab-btn ${activeTab === 'user' ? 'active' : ''}`}
          onClick={() => handleTabChange('user')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
          </svg>
          접속 이력
        </button>
        <button
          className={`tab-btn ${activeTab === 'admin' ? 'active' : ''}`}
          onClick={() => handleTabChange('admin')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 15C15.866 15 19 11.866 19 8C19 4.13401 15.866 1 12 1C8.13401 1 5 4.13401 5 8C5 11.866 8.13401 15 12 15Z" stroke="currentColor" strokeWidth="2"/>
            <path d="M8.21 13.89L7 23L12 20L17 23L15.79 13.88" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          관리자 로그
        </button>
        <button
          className={`tab-btn ${activeTab === 'system' ? 'active' : ''}`}
          onClick={() => handleTabChange('system')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
            <path d="M8 21H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M12 17V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          시스템 로그
        </button>
      </div>

      {/* Toolbar */}
      <div className="logs-toolbar">
        <div className="search-box">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
            <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder={activeTab === 'system' ? '메시지 검색...' : '사용자, 이벤트, 대상 검색...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-search" onClick={() => setSearchQuery('')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>

        {activeTab !== 'system' && eventTypes.length > 0 && (
          <select
            className="log-filter"
            value={eventTypeFilter}
            onChange={(e) => {
              setEventTypeFilter(e.target.value)
              setCurrentPage(1)
            }}
          >
            <option value="all">모든 이벤트</option>
            {eventTypes.map(type => (
              <option key={type} value={type}>{getEventTypeLabel(type)}</option>
            ))}
          </select>
        )}

        {activeTab !== 'system' && (
          <div className="date-filter-group">
            <select
              className="log-filter date-preset"
              value={datePreset}
              onChange={(e) => handleDatePresetChange(e.target.value as DatePreset)}
            >
              <option value="all">전체 기간</option>
              <option value="today">오늘</option>
              <option value="yesterday">어제</option>
              <option value="week">최근 7일</option>
              <option value="month">최근 30일</option>
              <option value="custom">직접 선택</option>
            </select>
            {(datePreset === 'custom' || startDate || endDate) && (
              <div className="date-range-inputs">
                <input
                  type="date"
                  className="date-input"
                  value={startDate}
                  onChange={(e) => handleCustomDateChange('start', e.target.value)}
                  placeholder="시작일"
                />
                <span className="date-separator">~</span>
                <input
                  type="date"
                  className="date-input"
                  value={endDate}
                  onChange={(e) => handleCustomDateChange('end', e.target.value)}
                  placeholder="종료일"
                />
                {(startDate || endDate) && (
                  <button
                    className="clear-date-btn"
                    onClick={() => {
                      setStartDate('')
                      setEndDate('')
                      setDatePreset('all')
                      setCurrentPage(1)
                    }}
                    title="날짜 필터 초기화"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'system' && (
          <>
            <select
              className="log-filter"
              value={logLevel}
              onChange={(e) => setLogLevel(e.target.value as LogLevel)}
            >
              <option value="all">모든 레벨</option>
              <option value="fatal">Fatal</option>
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="info">Info</option>
            </select>
            <select
              className="log-filter"
              value={container}
              onChange={(e) => setContainer(e.target.value)}
            >
              <option value="all">모든 컨테이너</option>
              <option value="api">API</option>
              <option value="ui">UI</option>
              <option value="db">Database</option>
            </select>
          </>
        )}
      </div>

      {/* Content */}
      <div className="logs-content">
        {loading ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>로그를 불러오는 중...</p>
          </div>
        ) : activeTab === 'system' ? (
          // System Logs View
          filteredSystemLogs.length === 0 ? (
            <div className="empty-state">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M8 21H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M12 17V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <h3>시스템 로그가 없습니다</h3>
              <p>선택한 필터 조건에 맞는 로그가 없습니다.</p>
            </div>
          ) : (
            <div className="system-logs-list">
              {filteredSystemLogs.map((log, index) => (
                <div key={index} className={`system-log-entry ${getLevelColor(log.level)}`}>
                  <div className="log-meta">
                    <span className="log-timestamp">
                      {formatTimestamp(log.timestamp)}
                    </span>
                    <span className={`log-level-badge ${getLevelColor(log.level)}`}>
                      {log.level.toUpperCase()}
                    </span>
                    <span className="log-container-badge">{log.container}</span>
                  </div>
                  <div className="log-message">{log.message}</div>
                </div>
              ))}
            </div>
          )
        ) : (
          // Audit Logs View
          filteredAuditLogs.length === 0 ? (
            <div className="empty-state">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
                <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <h3>
                {activeTab === 'file' ? '파일 감사 로그가 없습니다' :
                 activeTab === 'user' ? '접속 이력이 없습니다' : '관리자 로그가 없습니다'}
              </h3>
              <p>선택한 기간에 기록된 로그가 없습니다.</p>
            </div>
          ) : (
            <>
              <div className="logs-table-wrapper">
                <table className="logs-table">
                  <thead>
                    <tr>
                      <th>시간</th>
                      <th>사용자</th>
                      <th>이벤트</th>
                      <th>대상</th>
                      <th>IP 주소</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAuditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="timestamp-cell">
                          <span className="timestamp-relative">{formatTimestamp(log.timestamp)}</span>
                          <span className="timestamp-full">
                            {new Date(log.timestamp).toLocaleString('ko-KR')}
                          </span>
                        </td>
                        <td className="user-cell">
                          {log.actorUsername ? (
                            <span className="username">{log.actorUsername}</span>
                          ) : (
                            <span className="username-empty">시스템</span>
                          )}
                        </td>
                        <td className="event-cell">
                          <span className={`event-badge ${getActionColor(log.eventType)}`}>
                            {getEventTypeLabel(log.eventType)}
                          </span>
                        </td>
                        <td className="target-cell" title={formatDetails(log)}>
                          {formatDetails(log)}
                        </td>
                        <td className="ip-cell">
                          <span className={`ip-address ${!log.ipAddress ? 'smb' : ''}`}>
                            {formatIpAddress(log.ipAddress)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="pagination">
                  <div className="pagination-info">
                    총 <strong>{totalItems.toLocaleString()}</strong>개 중{' '}
                    <strong>{((currentPage - 1) * ITEMS_PER_PAGE) + 1}</strong> -{' '}
                    <strong>{Math.min(currentPage * ITEMS_PER_PAGE, totalItems)}</strong>
                  </div>
                  <div className="pagination-controls">
                    <button
                      className="page-btn"
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M11 17L6 12L11 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M18 17L13 12L18 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    <button
                      className="page-btn"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>

                    {getPageNumbers().map((page, idx) => (
                      page === '...' ? (
                        <span key={`ellipsis-${idx}`} className="page-ellipsis">...</span>
                      ) : (
                        <button
                          key={page}
                          className={`page-btn ${currentPage === page ? 'active' : ''}`}
                          onClick={() => setCurrentPage(page as number)}
                        >
                          {page}
                        </button>
                      )
                    ))}

                    <button
                      className="page-btn"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    <button
                      className="page-btn"
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M13 17L18 12L13 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M6 17L11 12L6 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </>
          )
        )}
      </div>
    </div>
  )
}

export default AdminLogs
