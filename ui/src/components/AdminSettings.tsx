import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import './AdminSettings.css'

const API_BASE = '/api'

interface SystemSettings {
  trash_retention_days: string
  default_storage_quota: string
  max_file_size: string
  session_timeout_hours: string
  [key: string]: string  // Index signature for dynamic access
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
    return <div className="admin-page">권한이 없습니다.</div>
  }

  if (loading) {
    return (
      <div className="admin-page">
        <div className="loading-spinner">설정을 불러오는 중...</div>
      </div>
    )
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h2>시스템 설정</h2>
        <p className="admin-page-description">SimpleCloudVault 시스템 설정을 관리합니다.</p>
      </div>

      <div className="admin-page-content">
        {/* Trash Settings */}
        <div className="settings-section">
          <div className="settings-section-header">
            <div className="section-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <h3>휴지통 설정</h3>
              <p>휴지통 자동 비우기 설정을 관리합니다.</p>
            </div>
          </div>
          <div className="settings-content">
            <div className="setting-item">
              <label>자동 삭제 기간</label>
              <div className="setting-value">
                <input
                  type="number"
                  value={settings.trash_retention_days}
                  onChange={(e) => setSettings({ ...settings, trash_retention_days: e.target.value })}
                  min="1"
                  max="365"
                />
                <span className="setting-unit">일</span>
              </div>
              <p className="setting-description">
                휴지통에 있는 항목이 지정된 일수가 지나면 자동으로 삭제됩니다.
              </p>
            </div>
          </div>
        </div>

        {/* Storage Settings */}
        <div className="settings-section">
          <div className="settings-section-header">
            <div className="section-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M22 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5.45 5.11L2 12V18C2 18.5304 2.21071 19.0391 2.58579 19.4142C2.96086 19.7893 3.46957 20 4 20H20C20.5304 20 21.0391 19.7893 21.4142 19.4142C21.7893 19.0391 22 18.5304 22 18V12L18.55 5.11C18.3844 4.77679 18.1292 4.49637 17.813 4.30028C17.4967 4.10419 17.1321 4.0002 16.76 4H7.24C6.86792 4.0002 6.50326 4.10419 6.18704 4.30028C5.87083 4.49637 5.61558 4.77679 5.45 5.11Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M6 16H6.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M10 16H10.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <h3>저장소 설정</h3>
              <p>사용자별 저장 공간 할당량을 설정합니다.</p>
            </div>
          </div>
          <div className="settings-content">
            <div className="setting-item">
              <label>기본 할당량</label>
              <div className="setting-value">
                <input
                  type="number"
                  value={bytesToGB(settings.default_storage_quota)}
                  onChange={(e) => setSettings({ ...settings, default_storage_quota: gbToBytes(parseInt(e.target.value, 10) || 10) })}
                  min="1"
                />
                <span className="setting-unit">GB</span>
              </div>
              <p className="setting-description">
                새로운 사용자에게 할당되는 기본 저장 공간입니다.
              </p>
            </div>
            <div className="setting-item">
              <label>최대 파일 크기</label>
              <div className="setting-value">
                <input
                  type="number"
                  value={bytesToGB(settings.max_file_size)}
                  onChange={(e) => setSettings({ ...settings, max_file_size: gbToBytes(parseInt(e.target.value, 10) || 10) })}
                  min="1"
                />
                <span className="setting-unit">GB</span>
              </div>
              <p className="setting-description">
                업로드 가능한 최대 파일 크기입니다.
              </p>
            </div>
          </div>
        </div>

        {/* Security Settings */}
        <div className="settings-section">
          <div className="settings-section-header">
            <div className="section-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 22C12 22 20 18 20 12V5L12 2L4 5V12C4 18 12 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <h3>보안 설정</h3>
              <p>인증 및 보안 관련 설정을 관리합니다.</p>
            </div>
          </div>
          <div className="settings-content">
            <div className="setting-item">
              <label>세션 만료 시간</label>
              <div className="setting-value">
                <input
                  type="number"
                  value={settings.session_timeout_hours}
                  onChange={(e) => setSettings({ ...settings, session_timeout_hours: e.target.value })}
                  min="1"
                  max="720"
                />
                <span className="setting-unit">시간</span>
              </div>
              <p className="setting-description">
                로그인 세션이 유지되는 시간입니다.
              </p>
            </div>
          </div>
        </div>

        {/* SMB Settings - Read Only Display */}
        <div className="settings-section">
          <div className="settings-section-header">
            <div className="section-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
                <path d="M8 21H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M12 17V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <h3>SMB/CIFS 설정</h3>
              <p>네트워크 드라이브 접근 설정입니다. (읽기 전용)</p>
            </div>
          </div>
          <div className="settings-content">
            <div className="setting-item">
              <label>SMB 서버 상태</label>
              <div className="setting-value">
                <span className="status-badge active">실행 중</span>
              </div>
            </div>
            <div className="setting-item">
              <label>작업 그룹</label>
              <div className="setting-value">
                <span className="setting-readonly">WORKGROUP</span>
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="settings-actions">
          <button
            className="btn-save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '저장 중...' : '설정 저장'}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}

export default AdminSettings
