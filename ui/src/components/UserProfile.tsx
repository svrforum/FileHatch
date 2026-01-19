import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { updateProfile, setSMBPassword, get2FAStatus, setup2FA, enable2FA, disable2FA, regenerateBackupCodes, TwoFASetupResponse } from '../api/auth'
import { useTheme } from '../contexts/ThemeContext'
import './AuthModal.css'
import './UserProfile.css'

interface UserProfileProps {
  isOpen: boolean
  onClose: () => void
}

function UserProfile({ isOpen, onClose }: UserProfileProps) {
  const { user, token, refreshProfile, logout } = useAuthStore()
  const { theme, setTheme } = useTheme()
  const [activeTab, setActiveTab] = useState<'profile' | 'password' | 'app-password' | '2fa'>('profile')

  // Profile state
  const [email, setEmail] = useState(user?.email || '')

  // Password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Application password state (for SMB/WebDAV)
  const [appPassword, setAppPasswordVal] = useState('')
  const [appConfirmPassword, setAppConfirmPassword] = useState('')

  // 2FA state
  const [twoFAEnabled, setTwoFAEnabled] = useState(false)
  const [backupCodesCount, setBackupCodesCount] = useState(0)
  const [setupData, setSetupData] = useState<TwoFASetupResponse | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [disablePassword, setDisablePassword] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [showBackupCodes, setShowBackupCodes] = useState(false)
  const [twoFAStep, setTwoFAStep] = useState<'status' | 'setup' | 'verify' | 'disable'>('status')

  // UI state
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showConnectionInfo, setShowConnectionInfo] = useState(false)

  // Fetch 2FA status when tab changes
  useEffect(() => {
    if (activeTab === '2fa' && token) {
      fetchTwoFAStatus()
    }
  }, [activeTab, token])

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const fetchTwoFAStatus = async () => {
    if (!token) return
    try {
      const status = await get2FAStatus(token)
      setTwoFAEnabled(status.enabled)
      setBackupCodesCount(status.backupCodesCount)
      setTwoFAStep('status')
    } catch (err) {
      console.error('Failed to get 2FA status:', err)
    }
  }

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

  const handleSetAppPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (appPassword !== appConfirmPassword) {
      setMessage({ type: 'error', text: '비밀번호가 일치하지 않습니다.' })
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      await setSMBPassword(token, appPassword)
      setAppPasswordVal('')
      setAppConfirmPassword('')
      setMessage({ type: 'success', text: '애플리케이션 암호가 설정되었습니다.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '애플리케이션 암호 설정 실패' })
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    logout()
    onClose()
  }

  // 2FA handlers
  const handleSetup2FA = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const data = await setup2FA(token)
      setSetupData(data)
      setTwoFAStep('setup')
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '2FA 설정 실패' })
    } finally {
      setLoading(false)
    }
  }

  const handleEnable2FA = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    try {
      const result = await enable2FA(token, verifyCode)
      setBackupCodes(result.backupCodes)
      setShowBackupCodes(true)
      setTwoFAEnabled(true)
      setVerifyCode('')
      setSetupData(null)
      setTwoFAStep('status')
      await refreshProfile()
      setMessage({ type: 'success', text: '2FA가 활성화되었습니다. 백업 코드를 안전하게 보관하세요.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '2FA 활성화 실패' })
    } finally {
      setLoading(false)
    }
  }

  const handleDisable2FA = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    try {
      await disable2FA(token, disablePassword)
      setTwoFAEnabled(false)
      setDisablePassword('')
      setTwoFAStep('status')
      await refreshProfile()
      setMessage({ type: 'success', text: '2FA가 비활성화되었습니다.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '2FA 비활성화 실패' })
    } finally {
      setLoading(false)
    }
  }

  const handleRegenerateBackupCodes = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const result = await regenerateBackupCodes(token)
      setBackupCodes(result.backupCodes)
      setShowBackupCodes(true)
      await fetchTwoFAStatus()
      setMessage({ type: 'success', text: '새 백업 코드가 생성되었습니다. 안전하게 보관하세요.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '백업 코드 생성 실패' })
    } finally {
      setLoading(false)
    }
  }

  const copyBackupCodes = () => {
    const text = backupCodes.join('\n')
    navigator.clipboard.writeText(text)
    setMessage({ type: 'success', text: '백업 코드가 클립보드에 복사되었습니다.' })
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
            className={activeTab === 'app-password' ? 'active' : ''}
            onClick={() => { setActiveTab('app-password'); setMessage(null); }}
          >
            애플리케이션 암호
          </button>
          <button
            className={activeTab === '2fa' ? 'active' : ''}
            onClick={() => { setActiveTab('2fa'); setMessage(null); setShowBackupCodes(false); }}
          >
            2FA 보안
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
                <button
                  type="button"
                  className="theme-toggle-btn"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
                >
                  {theme === 'dark' ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2"/>
                      <path d="M12 2V4M12 20V22M4 12H2M6.31 6.31L4.9 4.9M17.69 6.31L19.1 4.9M6.31 17.69L4.9 19.1M17.69 17.69L19.1 19.1M22 12H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
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

          {activeTab === 'app-password' && (
            <div className="app-password-content">
              <div className="smb-info">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="#3182f6" strokeWidth="2"/>
                  <path d="M12 16V12M12 8H12.01" stroke="#3182f6" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <p>
                  SMB(네트워크 드라이브) 및 WebDAV 접속용 비밀번호를 설정합니다.
                  <br />
                  웹 로그인 비밀번호와 별도로 관리됩니다.
                </p>
              </div>

              {/* Connection Info Toggle */}
              <div className="connection-info-section">
                <button
                  type="button"
                  className={`connection-toggle ${showConnectionInfo ? 'open' : ''}`}
                  onClick={() => setShowConnectionInfo(!showConnectionInfo)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M13.5 6L10 18.5M6.5 8.5L3 12L6.5 15.5M17.5 8.5L21 12L17.5 15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>연결 정보 보기</span>
                  <svg className="toggle-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>

                {showConnectionInfo && (
                  <div className="connection-cards">
                    <div className="connection-card">
                      <div className="connection-header">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path d="M22 12H16L14 15H10L8 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M5.45 5.11L2 12V18C2 18.5304 2.21071 19.0391 2.58579 19.4142C2.96086 19.7893 3.46957 20 4 20H20C20.5304 20 21.0391 19.7893 21.4142 19.4142C21.7893 19.0391 22 18.5304 22 18V12L18.55 5.11C18.3844 4.77679 18.1292 4.49637 17.813 4.30028C17.4967 4.10419 17.1321 4.0002 16.76 4H7.24C6.86792 4.0002 6.50326 4.10419 6.18703 4.30028C5.8708 4.49637 5.61558 4.77679 5.45 5.11Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span>SMB (Windows)</span>
                      </div>
                      <div className="connection-url" onClick={async () => {
                        const smbUrl = `\\\\${window.location.hostname}`
                        try {
                          await navigator.clipboard.writeText(smbUrl)
                          setMessage({ type: 'success', text: 'SMB 주소가 복사되었습니다.' })
                        } catch {
                          // Fallback for non-HTTPS environments
                          const textArea = document.createElement('textarea')
                          textArea.value = smbUrl
                          document.body.appendChild(textArea)
                          textArea.select()
                          document.execCommand('copy')
                          document.body.removeChild(textArea)
                          setMessage({ type: 'success', text: 'SMB 주소가 복사되었습니다.' })
                        }
                      }}>
                        <code>{'\\\\' + window.location.hostname}</code>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <path d="M8 4V16C8 17.1046 8.89543 18 10 18H18C19.1046 18 20 17.1046 20 16V7.242C20 6.711 19.789 6.201 19.414 5.828L16.172 2.586C15.799 2.211 15.289 2 14.758 2H10C8.89543 2 8 2.89543 8 4Z" stroke="currentColor" strokeWidth="2"/>
                          <path d="M16 18V20C16 21.1046 15.1046 22 14 22H6C4.89543 22 4 21.1046 4 20V9C4 7.89543 4.89543 7 6 7H8" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                      </div>
                      <span className="connection-hint">{user.username}(내 파일), shared(공유 폴더) 접근 가능</span>
                    </div>

                    <div className="connection-card">
                      <div className="connection-header">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2"/>
                          <path d="M3.6 9H20.4" stroke="currentColor" strokeWidth="2"/>
                          <path d="M3.6 15H20.4" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                        <span>WebDAV</span>
                      </div>
                      <div className="connection-url" onClick={async () => {
                        const webdavUrl = `${window.location.protocol}//${window.location.host}/webdav/`
                        try {
                          await navigator.clipboard.writeText(webdavUrl)
                          setMessage({ type: 'success', text: 'WebDAV 주소가 복사되었습니다.' })
                        } catch {
                          // Fallback for non-HTTPS environments
                          const textArea = document.createElement('textarea')
                          textArea.value = webdavUrl
                          document.body.appendChild(textArea)
                          textArea.select()
                          document.execCommand('copy')
                          document.body.removeChild(textArea)
                          setMessage({ type: 'success', text: 'WebDAV 주소가 복사되었습니다.' })
                        }
                      }}>
                        <code>{window.location.protocol}//{window.location.host}/webdav/</code>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <path d="M8 4V16C8 17.1046 8.89543 18 10 18H18C19.1046 18 20 17.1046 20 16V7.242C20 6.711 19.789 6.201 19.414 5.828L16.172 2.586C15.799 2.211 15.289 2 14.758 2H10C8.89543 2 8 2.89543 8 4Z" stroke="currentColor" strokeWidth="2"/>
                          <path d="M16 18V20C16 21.1046 15.1046 22 14 22H6C4.89543 22 4 21.1046 4 20V9C4 7.89543 4.89543 7 6 7H8" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                      </div>
                      <span className="connection-hint">home(내 파일), shared(공유 폴더) 접근 가능</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Password Form */}
              <form onSubmit={handleSetAppPassword} className="app-password-form">
                <h4>애플리케이션 암호 설정</h4>
                <div className="form-group">
                  <label>사용자명</label>
                  <input type="text" value={user.username} disabled />
                  <span className="field-hint">SMB/WebDAV 접속 시 이 사용자명을 사용하세요</span>
                </div>

                <div className="form-group">
                  <label>애플리케이션 암호</label>
                  <input
                    type="password"
                    value={appPassword}
                    onChange={(e) => setAppPasswordVal(e.target.value)}
                    placeholder="애플리케이션 암호를 입력하세요"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>암호 확인</label>
                  <input
                    type="password"
                    value={appConfirmPassword}
                    onChange={(e) => setAppConfirmPassword(e.target.value)}
                    placeholder="암호를 다시 입력하세요"
                    required
                  />
                  {appPassword !== appConfirmPassword && appConfirmPassword && (
                    <span className="field-error">암호가 일치하지 않습니다</span>
                  )}
                </div>

                <div className="form-actions">
                  <button type="submit" className="primary-btn" disabled={loading || appPassword !== appConfirmPassword}>
                    {loading ? '설정 중...' : '애플리케이션 암호 설정'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === '2fa' && (
            <div className="twofa-content">
              {/* Show backup codes if just generated */}
              {showBackupCodes && backupCodes.length > 0 && (
                <div className="backup-codes-display">
                  <div className="backup-codes-header">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="#f59e0b" strokeWidth="2"/>
                      <path d="M12 8V12M12 16H12.01" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <h4>백업 코드 (반드시 안전하게 보관하세요)</h4>
                  </div>
                  <p className="backup-codes-warning">
                    이 코드들은 인증 앱을 사용할 수 없을 때 로그인에 사용할 수 있습니다.
                    각 코드는 한 번만 사용할 수 있으며, 이 창을 닫으면 다시 볼 수 없습니다.
                  </p>
                  <div className="backup-codes-grid">
                    {backupCodes.map((code, index) => (
                      <code key={index}>{code}</code>
                    ))}
                  </div>
                  <div className="backup-codes-actions">
                    <button type="button" className="secondary-btn" onClick={copyBackupCodes}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M8 4V16C8 17.1046 8.89543 18 10 18H18C19.1046 18 20 17.1046 20 16V7.242C20 6.711 19.789 6.201 19.414 5.828L16.172 2.586C15.799 2.211 15.289 2 14.758 2H10C8.89543 2 8 2.89543 8 4Z" stroke="currentColor" strokeWidth="2"/>
                        <path d="M16 18V20C16 21.1046 15.1046 22 14 22H6C4.89543 22 4 21.1046 4 20V9C4 7.89543 4.89543 7 6 7H8" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                      복사
                    </button>
                    <button type="button" className="primary-btn" onClick={() => setShowBackupCodes(false)}>
                      확인했습니다
                    </button>
                  </div>
                </div>
              )}

              {/* 2FA Status */}
              {!showBackupCodes && twoFAStep === 'status' && (
                <div className="twofa-status">
                  <div className={`twofa-status-badge ${twoFAEnabled ? 'enabled' : 'disabled'}`}>
                    {twoFAEnabled ? (
                      <>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                          <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="#22c55e" strokeWidth="2"/>
                          <path d="M8 12L11 15L16 9" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span>2FA 활성화됨</span>
                      </>
                    ) : (
                      <>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                          <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="#94a3b8" strokeWidth="2"/>
                          <path d="M15 9L9 15M9 9L15 15" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        <span>2FA 비활성화됨</span>
                      </>
                    )}
                  </div>

                  {twoFAEnabled ? (
                    <div className="twofa-enabled-info">
                      <p>2단계 인증이 활성화되어 있습니다. 로그인 시 인증 앱의 코드를 입력해야 합니다.</p>
                      <div className="twofa-backup-info">
                        <span>남은 백업 코드: <strong>{backupCodesCount}개</strong></span>
                      </div>
                      <div className="twofa-actions">
                        <button type="button" className="secondary-btn" onClick={handleRegenerateBackupCodes} disabled={loading}>
                          {loading ? '생성 중...' : '백업 코드 재생성'}
                        </button>
                        <button type="button" className="danger-btn" onClick={() => setTwoFAStep('disable')} disabled={loading}>
                          2FA 비활성화
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="twofa-disabled-info">
                      <div className="twofa-info-box">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#3182f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <div>
                          <h4>계정을 더 안전하게 보호하세요</h4>
                          <p>2단계 인증을 활성화하면 비밀번호 외에 인증 앱의 코드를 입력해야 합니다.</p>
                        </div>
                      </div>
                      <button type="button" className="primary-btn" onClick={handleSetup2FA} disabled={loading}>
                        {loading ? '설정 중...' : '2FA 설정하기'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 2FA Setup - QR Code */}
              {!showBackupCodes && twoFAStep === 'setup' && setupData && (
                <div className="twofa-setup">
                  <h4>1. 인증 앱으로 QR 코드 스캔</h4>
                  <p>Google Authenticator, Microsoft Authenticator 등의 앱에서 아래 QR 코드를 스캔하세요.</p>
                  <div className="qr-code-container">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setupData.qrCodeUrl)}`}
                      alt="2FA QR Code"
                    />
                  </div>
                  <div className="manual-entry">
                    <p>QR 코드를 스캔할 수 없는 경우, 수동으로 입력하세요:</p>
                    <code className="secret-code">{setupData.secret}</code>
                  </div>

                  <form onSubmit={handleEnable2FA}>
                    <h4>2. 인증 코드 입력</h4>
                    <p>인증 앱에 표시된 6자리 코드를 입력하세요.</p>
                    <div className="form-group">
                      <input
                        type="text"
                        value={verifyCode}
                        onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        className="verify-code-input"
                        maxLength={6}
                        pattern="\d{6}"
                        required
                        autoComplete="one-time-code"
                      />
                    </div>
                    <div className="form-actions">
                      <button type="button" className="secondary-btn" onClick={() => { setTwoFAStep('status'); setSetupData(null); }}>
                        취소
                      </button>
                      <button type="submit" className="primary-btn" disabled={loading || verifyCode.length !== 6}>
                        {loading ? '확인 중...' : '2FA 활성화'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* 2FA Disable */}
              {!showBackupCodes && twoFAStep === 'disable' && (
                <form onSubmit={handleDisable2FA} className="twofa-disable">
                  <div className="danger-warning">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="#ef4444" strokeWidth="2"/>
                      <path d="M12 8V12M12 16H12.01" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <div>
                      <h4>2FA를 비활성화하시겠습니까?</h4>
                      <p>2단계 인증을 비활성화하면 계정 보안이 약해집니다.</p>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>비밀번호 확인</label>
                    <input
                      type="password"
                      value={disablePassword}
                      onChange={(e) => setDisablePassword(e.target.value)}
                      placeholder="현재 비밀번호를 입력하세요"
                      required
                    />
                  </div>
                  <div className="form-actions">
                    <button type="button" className="secondary-btn" onClick={() => { setTwoFAStep('status'); setDisablePassword(''); }}>
                      취소
                    </button>
                    <button type="submit" className="danger-btn" disabled={loading || !disablePassword}>
                      {loading ? '처리 중...' : '2FA 비활성화'}
                    </button>
                  </div>
                </form>
              )}
            </div>
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
