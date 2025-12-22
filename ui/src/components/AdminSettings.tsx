import { useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import './AdminSettings.css'

function AdminSettings() {
  const { user: currentUser } = useAuthStore()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  if (!currentUser?.isAdmin) {
    return <div className="admin-page">권한이 없습니다.</div>
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h2>시스템 설정</h2>
        <p className="admin-page-description">SimpleCloudVault 시스템 설정을 관리합니다.</p>
      </div>

      <div className="admin-page-content">
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
                <input type="number" defaultValue="10" min="1" /> GB
              </div>
            </div>
            <div className="setting-item">
              <label>최대 파일 크기</label>
              <div className="setting-value">
                <input type="number" defaultValue="10" min="1" /> GB
              </div>
            </div>
          </div>
        </div>

        {/* SMB Settings */}
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
              <p>네트워크 드라이브 접근 설정을 관리합니다.</p>
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
                <input type="text" defaultValue="WORKGROUP" />
              </div>
            </div>
            <div className="setting-item">
              <label>익명 접근</label>
              <div className="setting-value">
                <span className="status-badge disabled">비활성화</span>
              </div>
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
                <input type="number" defaultValue="24" min="1" /> 시간
              </div>
            </div>
            <div className="setting-item">
              <label>최소 비밀번호 길이</label>
              <div className="setting-value">
                <input type="number" defaultValue="8" min="6" max="32" /> 자
              </div>
            </div>
          </div>
        </div>

        {/* Placeholder for save button */}
        <div className="settings-actions">
          <button
            className="btn-save"
            onClick={() => showToast('설정이 저장되었습니다.', 'success')}
          >
            설정 저장
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
