import { useState, useEffect, useMemo } from 'react'
import { useAuthStore } from '../stores/authStore'
import { listUsers, updateUser, deleteUser, User } from '../api/auth'
import CreateUserModal from './CreateUserModal'
import EditUserModal from './EditUserModal'
import './AdminUserList.css'

type ViewMode = 'card' | 'list'
type FilterStatus = 'all' | 'active' | 'inactive' | 'admin'

function AdminUserList() {
  const { token, user: currentUser } = useAuthStore()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)

  // View and filter state (persist viewMode to localStorage)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('admin-users-view-mode')
    return (saved === 'list' || saved === 'card') ? saved : 'card'
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')

  // Persist viewMode changes
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode)
    localStorage.setItem('admin-users-view-mode', mode)
  }

  // Format bytes to human readable
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  useEffect(() => {
    if (token) {
      loadUsers()
    }
  }, [token])

  const loadUsers = async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const data = await listUsers(token)
      setUsers(data.users)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleActive = async (user: User) => {
    if (!token) return
    if (user.id === currentUser?.id) return

    const action = user.isActive ? '비활성화' : '활성화'
    if (!confirm(`${user.username} 계정을 ${action}하시겠습니까?`)) return

    setLoading(true)
    setError(null)
    try {
      await updateUser(token, user.id, {
        isActive: !user.isActive,
      })
      loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteUser = async (userId: string, username: string) => {
    if (!token) return
    if (!confirm(`정말 ${username} 사용자를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return

    setLoading(true)
    setError(null)
    try {
      await deleteUser(token, userId)
      loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user')
    } finally {
      setLoading(false)
    }
  }

  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase()
  }

  const getAvatarColor = (username: string) => {
    const colors = [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
      'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
      'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    ]
    const index = username.charCodeAt(0) % colors.length
    return colors[index]
  }

  const getStoragePercent = (user: User) => {
    if (!user.storageQuota || user.storageQuota === 0) return 0
    return Math.min(100, (user.storageUsed / user.storageQuota) * 100)
  }

  // Filtered and searched users
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      // Search filter
      const matchesSearch = searchQuery === '' ||
        user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (user.email && user.email.toLowerCase().includes(searchQuery.toLowerCase()))

      // Status filter
      let matchesFilter = true
      if (filterStatus === 'active') matchesFilter = user.isActive
      else if (filterStatus === 'inactive') matchesFilter = !user.isActive
      else if (filterStatus === 'admin') matchesFilter = user.isAdmin

      return matchesSearch && matchesFilter
    })
  }, [users, searchQuery, filterStatus])

  // Stats
  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter(u => u.isActive).length,
    inactive: users.filter(u => !u.isActive).length,
    admins: users.filter(u => u.isAdmin).length,
  }), [users])

  if (!currentUser?.isAdmin) {
    return <div className="admin-page">권한이 없습니다.</div>
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div className="header-content">
          <h2>사용자 관리</h2>
          <p className="admin-page-description">시스템의 모든 사용자를 관리합니다.</p>
        </div>
        <div className="header-actions">
          <button className="btn-icon" onClick={loadUsers} disabled={loading} title="새로고침">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M1 4V10H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M23 20V14H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14L18.36 18.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            className="btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            사용자 추가
          </button>
        </div>
      </div>

      <div className="admin-page-content">
        {error && (
          <div className="error-banner">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 8V12M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            {error}
          </div>
        )}

        {/* Stats Cards */}
        <div className="stats-row">
          <div className={`stat-card ${filterStatus === 'all' ? 'active' : ''}`} onClick={() => setFilterStatus('all')}>
            <span className="stat-value">{stats.total}</span>
            <span className="stat-label">전체</span>
          </div>
          <div className={`stat-card ${filterStatus === 'active' ? 'active' : ''}`} onClick={() => setFilterStatus('active')}>
            <span className="stat-value">{stats.active}</span>
            <span className="stat-label">활성</span>
          </div>
          <div className={`stat-card ${filterStatus === 'inactive' ? 'active' : ''}`} onClick={() => setFilterStatus('inactive')}>
            <span className="stat-value">{stats.inactive}</span>
            <span className="stat-label">비활성</span>
          </div>
          <div className={`stat-card ${filterStatus === 'admin' ? 'active' : ''}`} onClick={() => setFilterStatus('admin')}>
            <span className="stat-value">{stats.admins}</span>
            <span className="stat-label">관리자</span>
          </div>
        </div>

        {/* Toolbar */}
        <div className="toolbar">
          <div className="search-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
              <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              placeholder="이름 또는 이메일로 검색..."
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
          <div className="view-toggle">
            <button
              className={`view-btn ${viewMode === 'card' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('card')}
              title="카드 뷰"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
                <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
                <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
                <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
              </svg>
            </button>
            <button
              className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('list')}
              title="리스트 뷰"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M8 6H21M8 12H21M8 18H21M3 6H3.01M3 12H3.01M3 18H3.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* User List/Cards */}
        {loading && users.length === 0 ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>사용자 목록을 불러오는 중...</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="empty-state">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
              <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <h3>{searchQuery || filterStatus !== 'all' ? '검색 결과가 없습니다' : '등록된 사용자가 없습니다'}</h3>
            <p>{searchQuery || filterStatus !== 'all' ? '다른 검색어나 필터를 시도해보세요.' : '새 사용자를 추가하여 시스템을 시작하세요.'}</p>
          </div>
        ) : viewMode === 'card' ? (
          // Card View
          <div className="user-cards-grid">
            {filteredUsers.map((user) => (
              <div key={user.id} className={`user-card ${!user.isActive ? 'inactive' : ''}`}>
                <div className="user-card-header">
                  <div className="user-avatar" style={{ background: getAvatarColor(user.username) }}>
                    {getInitials(user.username)}
                    {user.isActive && <span className="status-dot"></span>}
                  </div>
                  <div className="user-info">
                    <h4 className="user-name">
                      {user.username}
                      {user.id === currentUser?.id && <span className="you-badge">나</span>}
                    </h4>
                    <p className="user-email">{user.email || '이메일 없음'}</p>
                  </div>
                </div>

                <div className="user-badges">
                  <span className={`badge ${user.isAdmin ? 'admin' : 'user'}`}>
                    {user.isAdmin ? '관리자' : '사용자'}
                  </span>
                  {user.hasSmb && (
                    <span className="badge smb">SMB</span>
                  )}
                  {!user.isActive && (
                    <span className="badge disabled">비활성</span>
                  )}
                </div>

                <div className="user-storage">
                  <div className="storage-header">
                    <span className="storage-label">저장공간</span>
                    <span className="storage-value">
                      {formatBytes(user.storageUsed || 0)} / {user.storageQuota ? formatBytes(user.storageQuota) : '무제한'}
                    </span>
                  </div>
                  {user.storageQuota > 0 && (
                    <div className="storage-progress">
                      <div
                        className="storage-progress-bar"
                        style={{
                          width: `${getStoragePercent(user)}%`,
                          background: getStoragePercent(user) > 90 ? '#ef4444' :
                                     getStoragePercent(user) > 70 ? '#f59e0b' : '#10b981'
                        }}
                      />
                    </div>
                  )}
                </div>

                <div className="user-meta">
                  <span className="meta-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
                      <path d="M16 2V6M8 2V6M3 10H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    {new Date(user.createdAt).toLocaleDateString('ko-KR')}
                  </span>
                </div>

                <div className="user-actions">
                  <button
                    className="btn-action edit"
                    onClick={() => setEditingUser(user)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    수정
                  </button>
                  {user.id !== currentUser?.id && (
                    <>
                      <button
                        className={`btn-action ${user.isActive ? 'deactivate' : 'activate'}`}
                        onClick={() => handleToggleActive(user)}
                        disabled={loading}
                      >
                        {user.isActive ? (
                          <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                              <path d="M15 9L9 15M9 9L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                            비활성화
                          </>
                        ) : (
                          <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                              <path d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49707C5.79935 3.85782 7.69279 2.71538 9.79619 2.24015C11.8996 1.76491 14.1003 1.98234 16.07 2.86" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M22 4L12 14.01L9 11.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            활성화
                          </>
                        )}
                      </button>
                      <button
                        className="btn-action delete"
                        onClick={() => handleDeleteUser(user.id, user.username)}
                        disabled={loading}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          // List View
          <div className="user-list-container">
            <table className="user-list-table">
              <thead>
                <tr>
                  <th>사용자</th>
                  <th>상태</th>
                  <th>저장공간</th>
                  <th>SMB</th>
                  <th>가입일</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id} className={!user.isActive ? 'inactive' : ''}>
                    <td>
                      <div className="user-cell">
                        <div className="user-avatar-sm" style={{ background: getAvatarColor(user.username) }}>
                          {getInitials(user.username)}
                        </div>
                        <div className="user-cell-info">
                          <span className="user-cell-name">
                            {user.username}
                            {user.id === currentUser?.id && <span className="you-badge">나</span>}
                            {user.isAdmin && <span className="badge admin small">관리자</span>}
                          </span>
                          <span className="user-cell-email">{user.email || '-'}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${user.isActive ? 'active' : 'inactive'}`}>
                        {user.isActive ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td>
                      <div className="storage-cell">
                        <span>{formatBytes(user.storageUsed || 0)}</span>
                        <span className="storage-sep">/</span>
                        <span className="storage-quota">{user.storageQuota ? formatBytes(user.storageQuota) : '무제한'}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`smb-status ${user.hasSmb ? 'enabled' : ''}`}>
                        {user.hasSmb ? '설정됨' : '-'}
                      </span>
                    </td>
                    <td className="date-cell">
                      {new Date(user.createdAt).toLocaleDateString('ko-KR')}
                    </td>
                    <td>
                      <div className="list-actions">
                        <button
                          className="list-action-btn"
                          onClick={() => setEditingUser(user)}
                          title="수정"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        {user.id !== currentUser?.id && (
                          <>
                            <button
                              className={`list-action-btn ${user.isActive ? 'warn' : 'success'}`}
                              onClick={() => handleToggleActive(user)}
                              disabled={loading}
                              title={user.isActive ? '비활성화' : '활성화'}
                            >
                              {user.isActive ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                                  <path d="M15 9L9 15M9 9L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                              ) : (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                  <path d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49707C5.79935 3.85782 7.69279 2.71538 9.79619 2.24015C11.8996 1.76491 14.1003 1.98234 16.07 2.86" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  <path d="M22 4L12 14.01L9 11.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </button>
                            <button
                              className="list-action-btn danger"
                              onClick={() => handleDeleteUser(user.id, user.username)}
                              disabled={loading}
                              title="삭제"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateUserModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => {
          loadUsers()
        }}
      />

      <EditUserModal
        isOpen={editingUser !== null}
        user={editingUser}
        currentUserId={currentUser?.id}
        onClose={() => setEditingUser(null)}
        onUpdated={() => {
          loadUsers()
          setEditingUser(null)
        }}
      />
    </div>
  )
}

export default AdminUserList
