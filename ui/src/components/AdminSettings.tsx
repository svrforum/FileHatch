import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import './AdminSettings.css'

const API_BASE = '/api'

interface SystemSettings {
  trash_retention_days: string
  default_storage_quota: string
  max_file_size: string
  session_timeout_hours: string
  [key: string]: string
}

function AdminSettings() {
  const { user: currentUser, token } = useAuthStore()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<SystemSettings>({
    trash_retention_days: '30',
    default_storage_quota: '10737418240',
    max_file_size: '10737418240',
    session_timeout_hours: '24'
  })

  // Convert bytes to GB for display
  const bytesToGB = (bytes: string) => {
    const num = parseInt(bytes, 10)
    return isNaN(num) ? 10 : Math.round(num / (1024 * 1024 * 1024))
  }

  // Convert GB to bytes for saving
  const gbToBytes = (gb: number) => {
    return (gb * 1024 * 1024 * 1024).toString()
  }

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch(`${API_BASE}/admin/settings`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!response.ok) {
          throw new Error('Failed to fetch settings')
        }
        const data = await response.json()
        const loadedSettings: SystemSettings = {
          trash_retention_days: '30',
          default_storage_quota: '10737418240',
          max_file_size: '10737418240',
          session_timeout_hours: '24'
        }
        data.settings?.forEach((s: { key: string; value: string }) => {
          if (s.key in loadedSettings) {
            loadedSettings[s.key] = s.value
          }
        })
        setSettings(loadedSettings)
      } catch (error) {
        console.error('Failed to load settings:', error)
        showToast('설정을 불러오는데 실패했습니다.', 'error')
      } finally {
        setLoading(false)
      }
    }

    if (currentUser?.isAdmin) {
      loadSettings()
    } else {
      setLoading(false)
    }
  }, [currentUser?.isAdmin, token])

  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch(`${API_BASE}/admin/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ settings })
      })
      if (!response.ok) {
        throw new Error('Failed to save settings')
      }
      showToast('설정이 저장되었습니다.', 'success')
    } catch (error) {
      console.error('Failed to save settings:', error)
      showToast('설정 저장에 실패했습니다.', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!currentUser?.isAdmin) {
    return (
      <div className="as-container">
        <div className="as-access-denied">
          <div className="as-denied-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <path d="M12 22C12 22 20 18 20 12V5L12 2L4 5V12C4 18 12 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 8V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="12" cy="16" r="1" fill="currentColor"/>
            </svg>
          </div>
          <h2>접근 권한이 없습니다</h2>
          <p>이 페이지는 관리자만 접근할 수 있습니다.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="as-container">
        <div className="as-loading">
          <div className="as-loading-spinner"></div>
          <span>설정을 불러오는 중...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="as-container">
      {/* Header */}
      <div className="as-header">
        <div className="as-header-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
            <path d="M12 1V4M12 20V23M4.22 4.22L6.34 6.34M17.66 17.66L19.78 19.78M1 12H4M20 12H23M4.22 19.78L6.34 17.66M17.66 6.34L19.78 4.22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="as-header-text">
          <h1>시스템 설정</h1>
          <p>SimpleCloudVault 시스템 설정을 관리합니다.</p>
        </div>
      </div>

      {/* Settings Content */}
      <div className="as-content">
        {/* Trash Settings */}
        <div className="as-section">
          <div className="as-section-header">
            <div className="as-section-icon trash">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="as-section-title">
              <h3>휴지통 설정</h3>
              <p>휴지통 자동 비우기 설정을 관리합니다.</p>
            </div>
          </div>
          <div className="as-section-content">
            <div className="as-setting-row">
              <div className="as-setting-info">
                <label>자동 삭제 기간</label>
                <span className="as-setting-desc">휴지통에 있는 항목이 지정된 일수가 지나면 자동으로 삭제됩니다.</span>
              </div>
              <div className="as-setting-input-group">
                <input
                  type="number"
                  value={settings.trash_retention_days}
                  onChange={(e) => setSettings({ ...settings, trash_retention_days: e.target.value })}
                  min="1"
                  max="365"
                />
                <span className="as-input-unit">일</span>
              </div>
            </div>
          </div>
        </div>

        {/* Storage Settings */}
        <div className="as-section">
          <div className="as-section-header">
            <div className="as-section-icon storage">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M22 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5.45 5.11L2 12V18C2 18.5304 2.21071 19.0391 2.58579 19.4142C2.96086 19.7893 3.46957 20 4 20H20C20.5304 20 21.0391 19.7893 21.4142 19.4142C21.7893 19.0391 22 18.5304 22 18V12L18.55 5.11C18.3844 4.77679 18.1292 4.49637 17.813 4.30028C17.4967 4.10419 17.1321 4.0002 16.76 4H7.24C6.86792 4.0002 6.50326 4.10419 6.18704 4.30028C5.87083 4.49637 5.61558 4.77679 5.45 5.11Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M6 16H6.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M10 16H10.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="as-section-title">
              <h3>저장소 설정</h3>
              <p>사용자별 저장 공간 할당량을 설정합니다.</p>
            </div>
          </div>
          <div className="as-section-content">
            <div className="as-setting-row">
              <div className="as-setting-info">
                <label>기본 할당량</label>
                <span className="as-setting-desc">새로운 사용자에게 할당되는 기본 저장 공간입니다.</span>
              </div>
              <div className="as-setting-input-group">
                <input
                  type="number"
                  value={bytesToGB(settings.default_storage_quota)}
                  onChange={(e) => setSettings({ ...settings, default_storage_quota: gbToBytes(parseInt(e.target.value, 10) || 10) })}
                  min="1"
                />
                <span className="as-input-unit">GB</span>
              </div>
            </div>
            <div className="as-divider"></div>
            <div className="as-setting-row">
              <div className="as-setting-info">
                <label>최대 파일 크기</label>
                <span className="as-setting-desc">업로드 가능한 최대 파일 크기입니다.</span>
              </div>
              <div className="as-setting-input-group">
                <input
                  type="number"
                  value={bytesToGB(settings.max_file_size)}
                  onChange={(e) => setSettings({ ...settings, max_file_size: gbToBytes(parseInt(e.target.value, 10) || 10) })}
                  min="1"
                />
                <span className="as-input-unit">GB</span>
              </div>
            </div>
          </div>
        </div>

        {/* Security Settings */}
        <div className="as-section">
          <div className="as-section-header">
            <div className="as-section-icon security">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 22C12 22 20 18 20 12V5L12 2L4 5V12C4 18 12 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 12L11 14L15 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="as-section-title">
              <h3>보안 설정</h3>
              <p>인증 및 보안 관련 설정을 관리합니다.</p>
            </div>
          </div>
          <div className="as-section-content">
            <div className="as-setting-row">
              <div className="as-setting-info">
                <label>세션 만료 시간</label>
                <span className="as-setting-desc">로그인 세션이 유지되는 시간입니다. (최대 30일)</span>
              </div>
              <div className="as-setting-input-group">
                <input
                  type="number"
                  value={settings.session_timeout_hours}
                  onChange={(e) => setSettings({ ...settings, session_timeout_hours: e.target.value })}
                  min="1"
                  max="720"
                />
                <span className="as-input-unit">시간</span>
              </div>
            </div>
          </div>
        </div>

        {/* SMB Settings - Read Only */}
        <div className="as-section">
          <div className="as-section-header">
            <div className="as-section-icon smb">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
                <path d="M8 21H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M12 17V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <circle cx="7" cy="10" r="1.5" fill="currentColor"/>
                <circle cx="12" cy="10" r="1.5" fill="currentColor"/>
                <circle cx="17" cy="10" r="1.5" fill="currentColor"/>
              </svg>
            </div>
            <div className="as-section-title">
              <h3>SMB/CIFS 설정</h3>
              <p>네트워크 드라이브 접근 설정입니다.</p>
            </div>
            <span className="as-readonly-badge">읽기 전용</span>
          </div>
          <div className="as-section-content">
            <div className="as-setting-row">
              <div className="as-setting-info">
                <label>SMB 서버 상태</label>
                <span className="as-setting-desc">Samba 서버의 현재 실행 상태입니다.</span>
              </div>
              <div className="as-status-badge active">
                <span className="as-status-dot"></span>
                실행 중
              </div>
            </div>
            <div className="as-divider"></div>
            <div className="as-setting-row">
              <div className="as-setting-info">
                <label>작업 그룹</label>
                <span className="as-setting-desc">Windows 네트워크 작업 그룹 이름입니다.</span>
              </div>
              <div className="as-readonly-value">WORKGROUP</div>
            </div>
            <div className="as-divider"></div>
            <div className="as-setting-row">
              <div className="as-setting-info">
                <label>프로토콜 버전</label>
                <span className="as-setting-desc">지원되는 SMB 프로토콜 버전입니다.</span>
              </div>
              <div className="as-readonly-value">SMB2 / SMB3</div>
            </div>
          </div>
        </div>

        {/* Save Actions */}
        <div className="as-actions">
          <button
            className="as-btn-save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <>
                <span className="as-btn-spinner"></span>
                저장 중...
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H16L21 8V19C21 20.1046 20.1046 21 19 21Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M17 21V13H7V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M7 3V8H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                설정 저장
              </>
            )}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`as-toast ${toast.type}`}>
          {toast.type === 'success' ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M8 12L11 15L16 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 8V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="12" cy="16" r="1" fill="currentColor"/>
            </svg>
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  )
}

export default AdminSettings
