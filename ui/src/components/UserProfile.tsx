import { useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { updateProfile, setSMBPassword } from '../api/auth'
import './AuthModal.css'
import './UserProfile.css'

interface UserProfileProps {
  isOpen: boolean
  onClose: () => void
}

function UserProfile({ isOpen, onClose }: UserProfileProps) {
  const { user, token, refreshProfile, logout } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'profile' | 'password' | 'smb'>('profile')

  // Profile state
  const [email, setEmail] = useState(user?.email || '')

  // Password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // SMB state
  const [smbPassword, setSmbPasswordVal] = useState('')
  const [smbConfirmPassword, setSmbConfirmPassword] = useState('')

  // UI state
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  if (!isOpen || !user || !token) return null

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      await updateProfile(token, { email: email || undefined })
      await refreshProfile()
      setMessage({ type: 'success', text: '프로필이 업데이트되었습니다.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '업데이트 실패' })
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: '새 비밀번호가 일치하지 않습니다.' })
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      await updateProfile(token, { currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage({ type: 'success', text: '비밀번호가 변경되었습니다.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '비밀번호 변경 실패' })
    } finally {
      setLoading(false)
    }
  }

  const handleSetSMBPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (smbPassword !== smbConfirmPassword) {
      setMessage({ type: 'error', text: 'SMB 비밀번호가 일치하지 않습니다.' })
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      await setSMBPassword(token, smbPassword)
      setSmbPasswordVal('')
      setSmbConfirmPassword('')
      setMessage({ type: 'success', text: 'SMB 비밀번호가 설정되었습니다.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'SMB 비밀번호 설정 실패' })
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    logout()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal user-profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>내 프로필</h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="profile-tabs">
          <button
            className={activeTab === 'profile' ? 'active' : ''}
            onClick={() => { setActiveTab('profile'); setMessage(null); }}
          >
            프로필
          </button>
          <button
            className={activeTab === 'password' ? 'active' : ''}
            onClick={() => { setActiveTab('password'); setMessage(null); }}
          >
            비밀번호
          </button>
          <button
            className={activeTab === 'smb' ? 'active' : ''}
            onClick={() => { setActiveTab('smb'); setMessage(null); }}
          >
            SMB 설정
          </button>
        </div>

        <div className="profile-content">
          {message && (
            <div className={`profile-message ${message.type}`}>
              {message.text}
            </div>
          )}

          {activeTab === 'profile' && (
            <form onSubmit={handleUpdateProfile}>
              <div className="user-info">
                <div className="user-avatar">
                  {user.username.charAt(0).toUpperCase()}
                </div>
                <div className="user-details">
                  <h3>{user.username}</h3>
                  <span className="user-provider">{user.provider === 'local' ? '로컬 계정' : user.provider}</span>
                </div>
              </div>

              <div className="form-group">
                <label>사용자명</label>
                <input type="text" value={user.username} disabled />
              </div>

              <div className="form-group">
                <label>이메일</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="이메일을 입력하세요"
                />
              </div>

              <div className="form-group">
                <label>가입일</label>
                <input type="text" value={new Date(user.createdAt).toLocaleDateString('ko-KR')} disabled />
              </div>

              <div className="form-actions">
                <button type="submit" className="primary-btn" disabled={loading}>
                  {loading ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'password' && (
            <form onSubmit={handleChangePassword}>
              <div className="form-group">
                <label>현재 비밀번호</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="현재 비밀번호를 입력하세요"
                  required
                />
              </div>

              <div className="form-group">
                <label>새 비밀번호</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="새 비밀번호를 입력하세요"
                  required
                />
              </div>

              <div className="form-group">
                <label>새 비밀번호 확인</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="새 비밀번호를 다시 입력하세요"
                  required
                />
                {newPassword !== confirmPassword && confirmPassword && (
                  <span className="field-error">비밀번호가 일치하지 않습니다</span>
                )}
              </div>

              <div className="form-actions">
                <button type="submit" className="primary-btn" disabled={loading || newPassword !== confirmPassword}>
                  {loading ? '변경 중...' : '비밀번호 변경'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'smb' && (
            <form onSubmit={handleSetSMBPassword}>
              <div className="smb-info">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="#3182f6" strokeWidth="2"/>
                  <path d="M12 16V12M12 8H12.01" stroke="#3182f6" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <p>
                  SMB(네트워크 드라이브) 접속용 비밀번호를 설정합니다.
                  <br />
                  웹 로그인 비밀번호와 별도로 관리됩니다.
                </p>
              </div>

              <div className="form-group">
                <label>SMB 사용자명</label>
                <input type="text" value={user.username} disabled />
                <span className="field-hint">SMB 접속 시 이 사용자명을 사용하세요</span>
              </div>

              <div className="form-group">
                <label>SMB 비밀번호</label>
                <input
                  type="password"
                  value={smbPassword}
                  onChange={(e) => setSmbPasswordVal(e.target.value)}
                  placeholder="SMB 비밀번호를 입력하세요"
                  required
                />
              </div>

              <div className="form-group">
                <label>비밀번호 확인</label>
                <input
                  type="password"
                  value={smbConfirmPassword}
                  onChange={(e) => setSmbConfirmPassword(e.target.value)}
                  placeholder="비밀번호를 다시 입력하세요"
                  required
                />
                {smbPassword !== smbConfirmPassword && smbConfirmPassword && (
                  <span className="field-error">비밀번호가 일치하지 않습니다</span>
                )}
              </div>

              <div className="form-actions">
                <button type="submit" className="primary-btn" disabled={loading || smbPassword !== smbConfirmPassword}>
                  {loading ? '설정 중...' : 'SMB 비밀번호 설정'}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="profile-footer">
          <button className="logout-btn" onClick={handleLogout}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M16 17L21 12L16 7M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            로그아웃
          </button>
        </div>
      </div>
    </div>
  )
}

export default UserProfile
