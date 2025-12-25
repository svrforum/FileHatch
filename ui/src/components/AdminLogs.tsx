import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import './AdminLogs.css'

type LogTab = 'file' | 'user' | 'admin' | 'system'
type LogLevel = 'all' | 'info' | 'warn' | 'error' | 'fatal'

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

function AdminLogs() {
  const { user: currentUser, token } = useAuthStore()
  const [activeTab, setActiveTab] = useState<LogTab>('file')
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [logLevel, setLogLevel] = useState<LogLevel>('all')
  const [container, setContainer] = useState<string>('all')

  useEffect(() => {
    if (activeTab === 'system') {
      loadSystemLogs()
    } else {
      loadAuditLogs()
    }
  }, [activeTab, logLevel, container])

  const loadAuditLogs = async () => {
    setLoading(true)
    try {
      const category = activeTab // file, user, or admin
      const response = await fetch(`/api/audit/logs?category=${category}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      if (response.ok) {
        const data = await response.json()
        setAuditLogs(data.logs || [])
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadSystemLogs = async () => {
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
  }

  const handleRefresh = () => {
    if (activeTab === 'system') {
      loadSystemLogs()
    } else {
      loadAuditLogs()
    }
  }

  const filteredAuditLogs = auditLogs.filter(log =>
    (log.actorUsername?.toLowerCase() || '').includes(filter.toLowerCase()) ||
    log.eventType.toLowerCase().includes(filter.toLowerCase()) ||
    log.targetResource.toLowerCase().includes(filter.toLowerCase())
  )

  const filteredSystemLogs = systemLogs.filter(log =>
    log.message.toLowerCase().includes(filter.toLowerCase()) ||
    log.container.toLowerCase().includes(filter.toLowerCase())
  )

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
    if (eventType.startsWith('smb.')) return 'action-smb'
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
    return ip || '-'
  }

  if (!currentUser?.isAdmin) {
    return <div className="admin-page">권한이 없습니다.</div>
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h2>시스템 로그</h2>
        <p className="admin-page-description">파일 변경, 관리자 활동, 시스템 로그를 확인합니다.</p>
      </div>

      <div className="admin-page-content">
        <div className="logs-tabs">
          <button
            className={`tab-btn ${activeTab === 'file' ? 'active' : ''}`}
            onClick={() => setActiveTab('file')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            파일 감사로그
          </button>
          <button
            className={`tab-btn ${activeTab === 'user' ? 'active' : ''}`}
            onClick={() => setActiveTab('user')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
            </svg>
            접속 이력
          </button>
          <button
            className={`tab-btn ${activeTab === 'admin' ? 'active' : ''}`}
            onClick={() => setActiveTab('admin')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 15C15.866 15 19 11.866 19 8C19 4.13401 15.866 1 12 1C8.13401 1 5 4.13401 5 8C5 11.866 8.13401 15 12 15Z" stroke="currentColor" strokeWidth="2"/>
              <path d="M8.21 13.89L7 23L12 20L17 23L15.79 13.88" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            관리자 로그
          </button>
          <button
            className={`tab-btn ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => setActiveTab('system')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
              <path d="M8 21H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <path d="M12 17V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            시스템 로그
          </button>
        </div>

        <div className="logs-toolbar">
          <div className="search-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
              <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              placeholder="로그 검색..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

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
                <option value="warn">Warn</option>
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

          <button className="btn-refresh" onClick={handleRefresh} disabled={loading}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M1 4V10H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M23 20V14H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14L18.36 18.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            새로고침
          </button>
        </div>

        <div className="admin-card">
          {loading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>로딩 중...</p>
            </div>
          ) : activeTab === 'system' ? (
            // System Logs View
            filteredSystemLogs.length === 0 ? (
              <div className="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
                  <path d="M8 21H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M12 17V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <p>시스템 로그가 없습니다.</p>
              </div>
            ) : (
              <div className="system-logs">
                {filteredSystemLogs.map((log, index) => (
                  <div key={index} className={`system-log-entry ${getLevelColor(log.level)}`}>
                    <div className="log-meta">
                      <span className="log-timestamp">
                        {new Date(log.timestamp).toLocaleString('ko-KR')}
                      </span>
                      <span className={`log-level ${getLevelColor(log.level)}`}>
                        {log.level.toUpperCase()}
                      </span>
                      <span className="log-container">{log.container}</span>
                    </div>
                    <div className="log-message">{log.message}</div>
                  </div>
                ))}
              </div>
            )
          ) : (
            // Audit Logs View (file/admin)
            filteredAuditLogs.length === 0 ? (
              <div className="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                  <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <p>
                  {activeTab === 'file' ? '파일 감사 로그가 없습니다.' :
                   activeTab === 'user' ? '접속 이력이 없습니다.' : '관리자 로그가 없습니다.'}
                </p>
              </div>
            ) : (
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
                      <td className="timestamp">
                        {new Date(log.timestamp).toLocaleString('ko-KR')}
                      </td>
                      <td className="username">{log.actorUsername || '-'}</td>
                      <td>
                        <span className={`action-badge ${getActionColor(log.eventType)}`}>
                          {getEventTypeLabel(log.eventType)}
                        </span>
                      </td>
                      <td className="details">{formatDetails(log)}</td>
                      <td className="ip">{formatIpAddress(log.ipAddress)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>
    </div>
  )
}

export default AdminLogs
