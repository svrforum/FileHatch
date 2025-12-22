import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listSMBUsers,
  createSMBUser,
  setSMBPassword,
  deleteSMBUser,
  getSMBConfig,
  updateSMBConfig,
  SMBUser,
  SMBConfig,
} from '../api/smb'
import './SMBSettings.css'

interface SMBSettingsProps {
  isOpen: boolean
  onClose: () => void
}

function SMBSettings({ isOpen, onClose }: SMBSettingsProps) {
  const [activeTab, setActiveTab] = useState<'users' | 'config'>('users')
  const [showAddUser, setShowAddUser] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState<SMBUser | null>(null)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const queryClient = useQueryClient()

  // Config state
  const [workgroup, setWorkgroup] = useState('')
  const [serverName, setServerName] = useState('')
  const [guestAccess, setGuestAccess] = useState(false)

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['smb-users'],
    queryFn: listSMBUsers,
    enabled: isOpen,
  })

  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: ['smb-config'],
    queryFn: getSMBConfig,
    enabled: isOpen,
  })

  useEffect(() => {
    if (configData) {
      setWorkgroup(configData.workgroup)
      setServerName(configData.serverName)
      setGuestAccess(configData.guestAccess)
    }
  }, [configData])

  const createUserMutation = useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      createSMBUser(username, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smb-users'] })
      setShowAddUser(false)
      setNewUsername('')
      setNewPassword('')
      setConfirmPassword('')
      setError('')
      setSuccess('사용자가 생성되었습니다. Samba 컨테이너를 재시작하여 적용하세요.')
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  const setPasswordMutation = useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      setSMBPassword(username, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smb-users'] })
      setShowPasswordModal(null)
      setNewPassword('')
      setConfirmPassword('')
      setError('')
      setSuccess('비밀번호가 변경되었습니다. Samba 컨테이너를 재시작하여 적용하세요.')
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  const deleteUserMutation = useMutation({
    mutationFn: (username: string) => deleteSMBUser(username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smb-users'] })
      setSuccess('SMB 접근 권한이 제거되었습니다.')
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  const updateConfigMutation = useMutation({
    mutationFn: (config: SMBConfig) => updateSMBConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smb-config'] })
      setSuccess('SMB 설정이 저장되었습니다. Samba 컨테이너를 재시작하여 적용하세요.')
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  const handleAddUser = useCallback(() => {
    setError('')
    if (!newUsername || !newPassword) {
      setError('사용자 이름과 비밀번호를 입력하세요.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }
    if (newPassword.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.')
      return
    }
    createUserMutation.mutate({ username: newUsername, password: newPassword })
  }, [newUsername, newPassword, confirmPassword, createUserMutation])

  const handleSetPassword = useCallback(() => {
    setError('')
    if (!showPasswordModal) return
    if (!newPassword) {
      setError('비밀번호를 입력하세요.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }
    if (newPassword.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.')
      return
    }
    setPasswordMutation.mutate({ username: showPasswordModal.username, password: newPassword })
  }, [showPasswordModal, newPassword, confirmPassword, setPasswordMutation])

  const handleSaveConfig = useCallback(() => {
    setError('')
    updateConfigMutation.mutate({
      workgroup,
      serverName,
      guestAccess,
    })
  }, [workgroup, serverName, guestAccess, updateConfigMutation])

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(''), 5000)
      return () => clearTimeout(timer)
    }
  }, [success])

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content smb-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>SMB 설정</h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="smb-tabs">
          <button
            className={`smb-tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            사용자 관리
          </button>
          <button
            className={`smb-tab ${activeTab === 'config' ? 'active' : ''}`}
            onClick={() => setActiveTab('config')}
          >
            서버 설정
          </button>
        </div>

        {success && (
          <div className="smb-alert success">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85781 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M22 4L12 14.01L9 11.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {success}
          </div>
        )}

        {error && (
          <div className="smb-alert error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M15 9L9 15M9 9L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            {error}
          </div>
        )}

        {activeTab === 'users' && (
          <div className="smb-content">
            <div className="smb-section-header">
              <h3>SMB 사용자</h3>
              <button className="btn-primary btn-sm" onClick={() => setShowAddUser(true)}>
                + 사용자 추가
              </button>
            </div>

            {usersLoading ? (
              <div className="smb-loading">로딩 중...</div>
            ) : (
              <div className="smb-user-list">
                {usersData?.users.length === 0 ? (
                  <div className="smb-empty">SMB 사용자가 없습니다.</div>
                ) : (
                  usersData?.users.map((user) => (
                    <div key={user.id} className="smb-user-item">
                      <div className="smb-user-info">
                        <span className="smb-username">{user.username}</span>
                        <span className={`smb-status ${user.hasSmb ? 'active' : 'inactive'}`}>
                          {user.hasSmb ? 'SMB 활성' : 'SMB 비활성'}
                        </span>
                      </div>
                      <div className="smb-user-actions">
                        <button
                          className="btn-text"
                          onClick={() => {
                            setShowPasswordModal(user)
                            setNewPassword('')
                            setConfirmPassword('')
                            setError('')
                          }}
                        >
                          비밀번호 변경
                        </button>
                        {user.hasSmb && (
                          <button
                            className="btn-text danger"
                            onClick={() => deleteUserMutation.mutate(user.username)}
                          >
                            SMB 제거
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="smb-hint">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 16V12M12 8H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span>변경사항을 적용하려면 Samba 컨테이너를 재시작해야 합니다.</span>
            </div>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="smb-content">
            {configLoading ? (
              <div className="smb-loading">로딩 중...</div>
            ) : (
              <>
                <div className="smb-form-group">
                  <label>작업 그룹 (Workgroup)</label>
                  <input
                    type="text"
                    value={workgroup}
                    onChange={(e) => setWorkgroup(e.target.value)}
                    placeholder="WORKGROUP"
                  />
                </div>

                <div className="smb-form-group">
                  <label>서버 이름</label>
                  <input
                    type="text"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    placeholder="SimpleCloudVault SMB Server"
                  />
                </div>

                <div className="smb-form-group checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={guestAccess}
                      onChange={(e) => setGuestAccess(e.target.checked)}
                    />
                    게스트 접근 허용
                  </label>
                  <p className="smb-form-hint">활성화하면 인증 없이 파일에 접근할 수 있습니다.</p>
                </div>

                <div className="smb-form-actions">
                  <button
                    className="btn-primary"
                    onClick={handleSaveConfig}
                    disabled={updateConfigMutation.isPending}
                  >
                    {updateConfigMutation.isPending ? '저장 중...' : '설정 저장'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Add User Modal */}
        {showAddUser && (
          <div className="smb-modal-overlay" onClick={() => setShowAddUser(false)}>
            <div className="smb-modal" onClick={(e) => e.stopPropagation()}>
              <h3>SMB 사용자 추가</h3>
              <div className="smb-form-group">
                <label>사용자 이름</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="username"
                  autoFocus
                />
              </div>
              <div className="smb-form-group">
                <label>비밀번호</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="8자 이상"
                />
              </div>
              <div className="smb-form-group">
                <label>비밀번호 확인</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="비밀번호 확인"
                />
              </div>
              <div className="smb-modal-actions">
                <button className="btn-secondary" onClick={() => setShowAddUser(false)}>
                  취소
                </button>
                <button
                  className="btn-primary"
                  onClick={handleAddUser}
                  disabled={createUserMutation.isPending}
                >
                  {createUserMutation.isPending ? '생성 중...' : '사용자 생성'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Change Password Modal */}
        {showPasswordModal && (
          <div className="smb-modal-overlay" onClick={() => setShowPasswordModal(null)}>
            <div className="smb-modal" onClick={(e) => e.stopPropagation()}>
              <h3>{showPasswordModal.username} 비밀번호 변경</h3>
              <div className="smb-form-group">
                <label>새 비밀번호</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="8자 이상"
                  autoFocus
                />
              </div>
              <div className="smb-form-group">
                <label>비밀번호 확인</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="비밀번호 확인"
                />
              </div>
              <div className="smb-modal-actions">
                <button className="btn-secondary" onClick={() => setShowPasswordModal(null)}>
                  취소
                </button>
                <button
                  className="btn-primary"
                  onClick={handleSetPassword}
                  disabled={setPasswordMutation.isPending}
                >
                  {setPasswordMutation.isPending ? '변경 중...' : '비밀번호 변경'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default SMBSettings
