import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { createUser } from '../api/auth'
import {
  getAllSharedFolders,
  addSharedFolderMember,
  SharedFolder,
  PERMISSION_READ_ONLY,
  PERMISSION_READ_WRITE,
} from '../api/sharedFolders'
import './CreateUserModal.css'

interface CreateUserModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
}

interface FolderPermission {
  folderId: string
  folderName: string
  permission: number // 0=none, 1=read-only, 2=read-write
}

function CreateUserModal({ isOpen, onClose, onCreated }: CreateUserModalProps) {
  const { token } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // User form state
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)

  // Shared folders state
  const [sharedFolders, setSharedFolders] = useState<SharedFolder[]>([])
  const [folderPermissions, setFolderPermissions] = useState<FolderPermission[]>([])
  const [loadingFolders, setLoadingFolders] = useState(false)

  // Load shared folders when modal opens
  useEffect(() => {
    if (isOpen) {
      loadSharedFolders()
      resetForm()
    }
  }, [isOpen])

  const resetForm = () => {
    setUsername('')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setIsAdmin(false)
    setError(null)
  }

  const loadSharedFolders = async () => {
    setLoadingFolders(true)
    try {
      const folders = await getAllSharedFolders()
      setSharedFolders(folders.filter(f => f.isActive))
      setFolderPermissions(
        folders
          .filter(f => f.isActive)
          .map(f => ({
            folderId: f.id,
            folderName: f.name,
            permission: 0, // Default: no access
          }))
      )
    } catch {
      console.error('Failed to load shared folders')
      setSharedFolders([])
      setFolderPermissions([])
    } finally {
      setLoadingFolders(false)
    }
  }

  const handlePermissionChange = (folderId: string, permission: number) => {
    setFolderPermissions(prev =>
      prev.map(fp =>
        fp.folderId === folderId ? { ...fp, permission } : fp
      )
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Create user
      const result = await createUser(token, {
        username,
        email: email || undefined,
        password,
        isAdmin,
      })

      // Add permissions to shared folders
      const permissionsToAdd = folderPermissions.filter(fp => fp.permission > 0)
      for (const fp of permissionsToAdd) {
        try {
          await addSharedFolderMember(fp.folderId, result.id, fp.permission)
        } catch (err) {
          console.error(`Failed to add permission for folder ${fp.folderName}:`, err)
        }
      }

      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '사용자 생성에 실패했습니다')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="create-user-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>새 사용자 추가</h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-content">
            {/* Basic Info Section */}
            <div className="form-section">
              <h3>기본 정보</h3>

              <div className="form-row">
                <div className="form-group">
                  <label>사용자명 *</label>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="영문, 숫자 3자 이상"
                    required
                    minLength={3}
                    pattern="[a-zA-Z0-9_]+"
                    title="영문, 숫자, 밑줄만 사용 가능"
                  />
                </div>
                <div className="form-group">
                  <label>이메일</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="선택 사항"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>비밀번호 *</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="8자 이상"
                    required
                    minLength={8}
                  />
                </div>
                <div className="form-group">
                  <label>비밀번호 확인 *</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="비밀번호 재입력"
                    required
                    minLength={8}
                  />
                </div>
              </div>

              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={isAdmin}
                    onChange={e => setIsAdmin(e.target.checked)}
                  />
                  <span className="checkmark"></span>
                  <span>관리자 권한 부여</span>
                </label>
                <p className="form-hint">관리자는 모든 시스템 설정과 사용자를 관리할 수 있습니다.</p>
              </div>
            </div>

            {/* Shared Folders Section */}
            <div className="form-section">
              <h3>공유 드라이브 권한</h3>
              <p className="section-description">생성할 사용자에게 공유 드라이브 접근 권한을 설정합니다.</p>

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
                <div className="folder-permissions-list">
                  {folderPermissions.map(fp => (
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
                  ))}
                </div>
              )}
            </div>

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
                  생성 중...
                </>
              ) : (
                '사용자 생성'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateUserModal
