import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { listUsers, createUser, updateUser, deleteUser, User } from '../api/auth'
import './UserManagement.css'

interface UserManagementProps {
  isOpen: boolean
  onClose: () => void
}

function UserManagement({ isOpen, onClose }: UserManagementProps) {
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

  useEffect(() => {
    if (isOpen && token) {
      loadUsers()
    }
  }, [isOpen, token])

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
      })
      setEditingUser(null)
      setEditPassword('')
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
  }

  if (!isOpen || !currentUser?.isAdmin) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal user-mgmt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>사용자 관리</h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="user-mgmt-content">
          {error && <div className="error-message">{error}</div>}

          <div className="user-mgmt-toolbar">
            <button
              className="create-user-btn"
              onClick={() => setShowCreateForm(true)}
              disabled={showCreateForm || editingUser !== null}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              사용자 추가
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={handleCreateUser} className="user-form">
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
                <button type="button" className="cancel-btn" onClick={() => setShowCreateForm(false)}>
                  취소
                </button>
                <button type="submit" className="submit-btn" disabled={loading}>
                  {loading ? '생성 중...' : '생성'}
                </button>
              </div>
            </form>
          )}

          {editingUser && (
            <form onSubmit={handleUpdateUser} className="user-form">
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
                <button type="button" className="cancel-btn" onClick={() => setEditingUser(null)}>
                  취소
                </button>
                <button type="submit" className="submit-btn" disabled={loading}>
                  {loading ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          )}

          <div className="users-list">
            {loading && users.length === 0 ? (
              <div className="loading">로딩 중...</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>사용자명</th>
                    <th>이메일</th>
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
                      <td>{user.username}</td>
                      <td>{user.email || '-'}</td>
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
                          className="edit-btn"
                          onClick={() => startEdit(user)}
                          disabled={editingUser !== null || showCreateForm}
                        >
                          수정
                        </button>
                        {user.id !== currentUser?.id && (
                          <button
                            className="delete-btn"
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
    </div>
  )
}

export default UserManagement
