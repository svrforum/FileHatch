import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { listUsers, createUser, updateUser, deleteUser, User } from '../api/auth'
import './AdminUserList.css'

function AdminUserList() {
  const { token, user: currentUser } = useAuthStore()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)

  // Create form state
  const [newUsername, setNewUsername] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newIsAdmin, setNewIsAdmin] = useState(false)

  // Edit form state
  const [editPassword, setEditPassword] = useState('')
  const [editIsAdmin, setEditIsAdmin] = useState(false)
  const [editIsActive, setEditIsActive] = useState(true)
  const [editStorageQuota, setEditStorageQuota] = useState<number>(0)

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

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return

    setLoading(true)
    setError(null)
    try {
      await createUser(token, {
        username: newUsername,
        email: newEmail || undefined,
        password: newPassword,
        isAdmin: newIsAdmin,
      })
      setShowCreateForm(false)
      setNewUsername('')
      setNewEmail('')
      setNewPassword('')
      setNewIsAdmin(false)
      loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !editingUser) return

    setLoading(true)
    setError(null)
    try {
      await updateUser(token, editingUser.id, {
        password: editPassword || undefined,
        isAdmin: editIsAdmin,
        isActive: editIsActive,
        storageQuota: editStorageQuota,
      })
      setEditingUser(null)
      setEditPassword('')
      setEditStorageQuota(0)
      loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteUser = async (userId: string) => {
    if (!token) return
    if (!confirm('정말 이 사용자를 삭제하시겠습니까?')) return

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

  const startEdit = (user: User) => {
    setEditingUser(user)
    setEditPassword('')
    setEditIsAdmin(user.isAdmin)
    setEditIsActive(user.isActive)
    setEditStorageQuota(user.storageQuota || 0)
  }

  if (!currentUser?.isAdmin) {
    return <div className="admin-page">권한이 없습니다.</div>
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h2>사용자 관리</h2>
        <p className="admin-page-description">시스템의 모든 사용자를 관리합니다.</p>
      </div>

      <div className="admin-page-content">
        {error && <div className="error-message">{error}</div>}

        <div className="admin-toolbar">
          <button
            className="btn-create"
            onClick={() => setShowCreateForm(true)}
            disabled={showCreateForm || editingUser !== null}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            사용자 추가
          </button>
          <button className="btn-refresh" onClick={loadUsers} disabled={loading}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M1 4V10H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M23 20V14H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14L18.36 18.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            새로고침
          </button>
        </div>

        {showCreateForm && (
          <div className="admin-card">
            <form onSubmit={handleCreateUser} className="admin-form">
              <h3>새 사용자</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>사용자명 *</label>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="사용자명"
                    required
                    minLength={3}
                  />
                </div>
                <div className="form-group">
                  <label>이메일</label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="이메일 (선택)"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>비밀번호 *</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="비밀번호 (8자 이상)"
                    required
                    minLength={8}
                  />
                </div>
                <div className="form-group checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={newIsAdmin}
                      onChange={(e) => setNewIsAdmin(e.target.checked)}
                    />
                    관리자 권한
                  </label>
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowCreateForm(false)}>
                  취소
                </button>
                <button type="submit" className="btn-submit" disabled={loading}>
                  {loading ? '생성 중...' : '생성'}
                </button>
              </div>
            </form>
          </div>
        )}

        {editingUser && (
          <div className="admin-card">
            <form onSubmit={handleUpdateUser} className="admin-form">
              <h3>사용자 수정: {editingUser.username}</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>새 비밀번호</label>
                  <input
                    type="password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="변경 시에만 입력"
                    minLength={8}
                  />
                </div>
                <div className="form-group">
                  <label>저장공간 제한</label>
                  <div className="quota-input-group">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={editStorageQuota ? editStorageQuota / (1024 * 1024 * 1024) : 0}
                      onChange={(e) => setEditStorageQuota(parseFloat(e.target.value) * 1024 * 1024 * 1024)}
                      placeholder="0 = 무제한"
                    />
                    <span className="quota-unit">GB</span>
                  </div>
                  <small className="form-hint">
                    현재 사용: {formatBytes(editingUser.storageUsed || 0)} / 0 = 무제한
                  </small>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={editIsAdmin}
                      onChange={(e) => setEditIsAdmin(e.target.checked)}
                      disabled={editingUser.id === currentUser?.id}
                    />
                    관리자 권한
                  </label>
                </div>
                <div className="form-group checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={editIsActive}
                      onChange={(e) => setEditIsActive(e.target.checked)}
                      disabled={editingUser.id === currentUser?.id}
                    />
                    계정 활성화
                  </label>
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => setEditingUser(null)}>
                  취소
                </button>
                <button type="submit" className="btn-submit" disabled={loading}>
                  {loading ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="admin-card">
          {loading && users.length === 0 ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>로딩 중...</p>
            </div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>사용자명</th>
                  <th>이메일</th>
                  <th>저장공간</th>
                  <th>권한</th>
                  <th>상태</th>
                  <th>SMB</th>
                  <th>가입일</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={!user.isActive ? 'inactive' : ''}>
                    <td className="user-name">{user.username}</td>
                    <td>{user.email || '-'}</td>
                    <td className="storage-cell">
                      <div className="storage-info">
                        <span className="storage-used">{formatBytes(user.storageUsed || 0)}</span>
                        <span className="storage-separator">/</span>
                        <span className="storage-quota">
                          {user.storageQuota ? formatBytes(user.storageQuota) : '무제한'}
                        </span>
                      </div>
                      {user.storageQuota > 0 && (
                        <div className="storage-bar">
                          <div
                            className="storage-bar-fill"
                            style={{
                              width: `${Math.min(100, (user.storageUsed / user.storageQuota) * 100)}%`,
                              backgroundColor: (user.storageUsed / user.storageQuota) > 0.9 ? '#ef4444' :
                                               (user.storageUsed / user.storageQuota) > 0.7 ? '#f59e0b' : '#10b981'
                            }}
                          />
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${user.isAdmin ? 'admin' : 'user'}`}>
                        {user.isAdmin ? '관리자' : '사용자'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${user.isActive ? 'active' : 'inactive'}`}>
                        {user.isActive ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${user.hasSmb ? 'active' : ''}`}>
                        {user.hasSmb ? '설정됨' : '-'}
                      </span>
                    </td>
                    <td>{new Date(user.createdAt).toLocaleDateString('ko-KR')}</td>
                    <td className="actions">
                      <button
                        className="btn-edit"
                        onClick={() => startEdit(user)}
                        disabled={editingUser !== null || showCreateForm}
                      >
                        수정
                      </button>
                      {user.id !== currentUser?.id && (
                        <button
                          className="btn-delete"
                          onClick={() => handleDeleteUser(user.id)}
                          disabled={loading}
                        >
                          삭제
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

export default AdminUserList
