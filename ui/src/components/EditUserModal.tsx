import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { updateUser, adminReset2FA, User } from '../api/auth'
import {
  getAllSharedFolders,
  getSharedFolderMembers,
  addSharedFolderMember,
  updateMemberPermission,
  removeSharedFolderMember,
  SharedFolder,
  PERMISSION_READ_ONLY,
  PERMISSION_READ_WRITE,
} from '../api/sharedFolders'
import './EditUserModal.css'

interface EditUserModalProps {
  isOpen: boolean
  user: User | null
  currentUserId?: string
  onClose: () => void
  onUpdated: () => void
}

interface FolderPermission {
  folderId: string
  folderName: string
  permission: number // 0=none, 1=read-only, 2=read-write
  originalPermission: number // To track changes
}

function EditUserModal({ isOpen, user, currentUserId, onClose, onUpdated }: EditUserModalProps) {
  const { token } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [storageQuota, setStorageQuota] = useState<number>(0)

  // Shared folders state
  const [sharedFolders, setSharedFolders] = useState<SharedFolder[]>([])
  const [folderPermissions, setFolderPermissions] = useState<FolderPermission[]>([])
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [folderSearch, setFolderSearch] = useState('')

  // 2FA reset state
  const [showReset2FAConfirm, setShowReset2FAConfirm] = useState(false)
  const [resetting2FA, setResetting2FA] = useState(false)

  // Format bytes to human readable
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // Load shared folders and user's permissions
  const loadSharedFoldersAndPermissions = async () => {
    if (!user) return

    setLoadingFolders(true)
    try {
      const folders = await getAllSharedFolders()
      const activeFolders = folders.filter(f => f.isActive)
      setSharedFolders(activeFolders)

      // Get user's permissions for each folder
      const permissions: FolderPermission[] = []
      for (const folder of activeFolders) {
        try {
          const members = await getSharedFolderMembers(folder.id)
          const userMember = members.find(m => m.userId === user.id)
          const permLevel = userMember ? userMember.permissionLevel : 0
          permissions.push({
            folderId: folder.id,
            folderName: folder.name,
            permission: permLevel,
            originalPermission: permLevel,
          })
        } catch {
          permissions.push({
            folderId: folder.id,
            folderName: folder.name,
            permission: 0,
            originalPermission: 0,
          })
        }
      }
      setFolderPermissions(permissions)
    } catch {
      console.error('Failed to load shared folders')
      setSharedFolders([])
      setFolderPermissions([])
    } finally {
      setLoadingFolders(false)
    }
  }

  // Reset form when user changes
  useEffect(() => {
    if (user && isOpen) {
      setPassword('')
      setConfirmPassword('')
      setIsAdmin(user.isAdmin)
      setIsActive(user.isActive)
      setStorageQuota(user.storageQuota || 0)
      setError(null)
      setFolderSearch('')
      loadSharedFoldersAndPermissions()
    }
  }, [user, isOpen])

  // ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Filter folders based on search
  const filteredFolderPermissions = folderPermissions.filter(fp =>
    fp.folderName.toLowerCase().includes(folderSearch.toLowerCase())
  )

  const handlePermissionChange = (folderId: string, permission: number) => {
    setFolderPermissions(prev =>
      prev.map(fp =>
        fp.folderId === folderId ? { ...fp, permission } : fp
      )
    )
  }

  const handleReset2FA = async () => {
    if (!token || !user) return

    setResetting2FA(true)
    setError(null)

    try {
      await adminReset2FA(token, user.id)
      setShowReset2FAConfirm(false)
      onUpdated() // Refresh user list to update 2FA badge
    } catch (err) {
      setError(err instanceof Error ? err.message : '2FA 초기화에 실패했습니다')
    } finally {
      setResetting2FA(false)
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !user) return

    // Validate passwords if changed
    if (password && password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다')
      return
    }

    if (password && password.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Update user info
      await updateUser(token, user.id, {
        password: password || undefined,
        isAdmin,
        isActive,
        storageQuota,
      })

      // Update folder permissions
      for (const fp of folderPermissions) {
        if (fp.permission !== fp.originalPermission) {
          try {
            if (fp.originalPermission === 0 && fp.permission > 0) {
              // Add new permission
              await addSharedFolderMember(fp.folderId, user.id, fp.permission)
            } else if (fp.originalPermission > 0 && fp.permission === 0) {
              // Remove permission
              await removeSharedFolderMember(fp.folderId, user.id)
            } else if (fp.permission > 0) {
              // Update permission
              await updateMemberPermission(fp.folderId, user.id, fp.permission)
            }
          } catch (err) {
            console.error(`Failed to update permission for folder ${fp.folderName}:`, err)
          }
        }
      }

      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : '사용자 수정에 실패했습니다')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen || !user) return null

  const isSelf = user.id === currentUserId

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="edit-user-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-user-info">
            <div className="modal-user-avatar" style={{ background: getAvatarColor(user.username) }}>
              {getInitials(user.username)}
            </div>
            <div>
              <h2>{user.username}</h2>
              <p>{user.email || '이메일 없음'}</p>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-content">
            {/* Password Section */}
            <div className="form-section">
              <h3>비밀번호 변경</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>새 비밀번호</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="변경 시에만 입력"
                    minLength={8}
                  />
                </div>
                <div className="form-group">
                  <label>비밀번호 확인</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="비밀번호 재입력"
                    minLength={8}
                  />
                </div>
              </div>
            </div>

            {/* Storage Section */}
            <div className="form-section">
              <h3>저장공간</h3>
              <div className="form-group">
                <label>저장공간 제한</label>
                <div className="input-with-unit">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={storageQuota ? storageQuota / (1024 * 1024 * 1024) : 0}
                    onChange={e => setStorageQuota(parseFloat(e.target.value) * 1024 * 1024 * 1024)}
                    placeholder="0"
                  />
                  <span className="unit">GB</span>
                </div>
                <p className="form-hint">
                  현재 사용량: {formatBytes(user.storageUsed || 0)} (0 = 무제한)
                </p>
              </div>
            </div>

            {/* Shared Folders Section */}
            <div className="form-section">
              <h3>공유 드라이브 권한</h3>
              <p className="section-description">사용자의 공유 드라이브 접근 권한을 설정합니다.</p>

              {loadingFolders ? (
                <div className="loading-folders">
                  <div className="spinner"></div>
                  <span>공유 드라이브 불러오는 중...</span>
                </div>
              ) : sharedFolders.length === 0 ? (
                <div className="no-folders">
                  <p>생성된 공유 드라이브가 없습니다.</p>
                </div>
              ) : (
                <>
                  {sharedFolders.length > 5 && (
                    <div className="form-group folder-search-group">
                      <input
                        type="search"
                        value={folderSearch}
                        onChange={e => setFolderSearch(e.target.value)}
                        placeholder="드라이브 검색..."
                        className="folder-search-input"
                      />
                    </div>
                  )}
                  <div className="folder-permissions-list">
                    {filteredFolderPermissions.length === 0 ? (
                      <div className="no-folders">
                        <p>검색 결과가 없습니다.</p>
                      </div>
                    ) : (
                      filteredFolderPermissions.map(fp => (
                        <div key={fp.folderId} className="folder-permission-item">
                          <div className="folder-info">
                            <svg className="folder-icon" viewBox="0 0 24 24" fill="none">
                              <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H12L10 5H5C3.89543 5 3 5.89543 3 7Z" fill="currentColor"/>
                            </svg>
                            <span className="folder-name">{fp.folderName}</span>
                          </div>
                          <div className="permission-buttons">
                            <button
                              type="button"
                              className={`perm-btn ${fp.permission === 0 ? 'active none' : ''}`}
                              onClick={() => handlePermissionChange(fp.folderId, 0)}
                            >
                              접근 불가
                            </button>
                            <button
                              type="button"
                              className={`perm-btn ${fp.permission === PERMISSION_READ_ONLY ? 'active readonly' : ''}`}
                              onClick={() => handlePermissionChange(fp.folderId, PERMISSION_READ_ONLY)}
                            >
                              읽기 전용
                            </button>
                            <button
                              type="button"
                              className={`perm-btn ${fp.permission === PERMISSION_READ_WRITE ? 'active readwrite' : ''}`}
                              onClick={() => handlePermissionChange(fp.folderId, PERMISSION_READ_WRITE)}
                            >
                              읽기/쓰기
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Permissions Section */}
            <div className="form-section">
              <h3>권한 설정</h3>
              <div className="toggle-list">
                <label className={`toggle-item ${isSelf ? 'disabled' : ''}`}>
                  <div className="toggle-info">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M12 15C15.866 15 19 11.866 19 8C19 4.13401 15.866 1 12 1C8.13401 1 5 4.13401 5 8C5 11.866 8.13401 15 12 15Z" stroke="currentColor" strokeWidth="2"/>
                      <path d="M8.21 13.89L7 23L12 20L17 23L15.79 13.88" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <div>
                      <span className="toggle-title">관리자 권한</span>
                      <span className="toggle-desc">시스템 설정 및 사용자 관리 가능</span>
                    </div>
                  </div>
                  <div className={`toggle-switch ${isAdmin ? 'active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isAdmin}
                      onChange={e => setIsAdmin(e.target.checked)}
                      disabled={isSelf}
                    />
                    <span className="toggle-slider"></span>
                  </div>
                </label>

                <label className={`toggle-item ${isSelf ? 'disabled' : ''}`}>
                  <div className="toggle-info">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49707C5.79935 3.85782 7.69279 2.71538 9.79619 2.24015C11.8996 1.76491 14.1003 1.98234 16.07 2.86" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M22 4L12 14.01L9 11.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <div>
                      <span className="toggle-title">계정 활성화</span>
                      <span className="toggle-desc">비활성화 시 로그인 불가</span>
                    </div>
                  </div>
                  <div className={`toggle-switch ${isActive ? 'active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={e => setIsActive(e.target.checked)}
                      disabled={isSelf}
                    />
                    <span className="toggle-slider"></span>
                  </div>
                </label>
              </div>
              {isSelf && (
                <p className="self-warning">자신의 권한은 변경할 수 없습니다.</p>
              )}
            </div>

            {/* 2FA Security Section */}
            <div className="form-section twofa-section">
              <h3>2단계 인증</h3>
              <div className={`twofa-status-card ${user.has2fa ? 'enabled' : 'disabled'}`}>
                <div className="twofa-info">
                  <div className={`twofa-icon ${user.has2fa ? 'enabled' : 'disabled'}`}>
                    {user.has2fa ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <div>
                    <span className={`twofa-status-title ${user.has2fa ? '' : 'disabled'}`}>
                      {user.has2fa ? '2FA 활성화됨' : '2FA 비활성화'}
                    </span>
                    <span className="twofa-status-desc">
                      {user.has2fa
                        ? '이 사용자는 2단계 인증을 사용 중입니다'
                        : '이 사용자는 2단계 인증을 사용하지 않습니다'}
                    </span>
                  </div>
                </div>
                {user.has2fa && (
                  <button
                    type="button"
                    className="btn-reset-2fa"
                    onClick={() => setShowReset2FAConfirm(true)}
                  >
                    2FA 초기화
                  </button>
                )}
              </div>
              {user.has2fa && (
                <p className="form-hint">
                  2FA를 초기화하면 사용자가 다시 설정해야 합니다.
                </p>
              )}
            </div>

            {/* 2FA Reset Confirmation Dialog */}
            {showReset2FAConfirm && (
              <div className="reset-2fa-confirm">
                <div className="confirm-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4.99c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="confirm-content">
                  <h4>2FA 초기화 확인</h4>
                  <p><strong>{user.username}</strong> 사용자의 2단계 인증을 초기화하시겠습니까?</p>
                  <p className="confirm-warning">이 작업은 되돌릴 수 없습니다.</p>
                </div>
                <div className="confirm-actions">
                  <button
                    type="button"
                    className="btn-confirm-cancel"
                    onClick={() => setShowReset2FAConfirm(false)}
                    disabled={resetting2FA}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="btn-confirm-reset"
                    onClick={handleReset2FA}
                    disabled={resetting2FA}
                  >
                    {resetting2FA ? '초기화 중...' : '초기화'}
                  </button>
                </div>
              </div>
            )}

            {error && <div className="error-message">{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-cancel" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? (
                <>
                  <div className="btn-spinner"></div>
                  저장 중...
                </>
              ) : (
                '변경사항 저장'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default EditUserModal
