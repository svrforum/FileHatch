import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import {
  SSOProvider,
  listSSOProviders,
  createSSOProvider,
  updateSSOProvider,
  deleteSSOProvider,
  getSSOSettings,
  updateSSOSettings,
  SSOSettings
} from '../api/auth'
import './AdminSettings.css'

const PROVIDER_TYPES = [
  { value: 'google', label: 'Google' },
  { value: 'github', label: 'GitHub' },
  { value: 'azure', label: 'Microsoft Azure' },
  { value: 'oidc', label: 'OIDC (Keycloak, etc.)' },
]

function AdminSSOSettings() {
  const { user: currentUser, token } = useAuthStore()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [loading, setLoading] = useState(true)

  // SSO State
  const [ssoSettings, setSsoSettings] = useState<SSOSettings>({
    sso_enabled: 'false',
    sso_only_mode: 'false',
    sso_auto_register: 'true',
    sso_allowed_domains: ''
  })
  const [ssoProviders, setSsoProviders] = useState<SSOProvider[]>([])
  const [showProviderModal, setShowProviderModal] = useState(false)
  const [editingProvider, setEditingProvider] = useState<SSOProvider | null>(null)
  const [providerForm, setProviderForm] = useState({
    name: '',
    providerType: 'google',
    clientId: '',
    clientSecret: '',
    issuerUrl: '',
    authorizationUrl: '',
    tokenUrl: '',
    userinfoUrl: '',
    scopes: 'openid email profile',
    allowedDomains: '',
    autoCreateUser: true,
    defaultAdmin: false,
    isEnabled: true,
    displayOrder: 0,
    iconUrl: '',
    buttonColor: ''
  })
  const [savingSso, setSavingSso] = useState(false)

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  // Load SSO settings and providers on mount
  useEffect(() => {
    if (currentUser?.isAdmin) {
      loadSsoData()
    } else {
      setLoading(false)
    }
  }, [currentUser?.isAdmin, token])

  // Load SSO settings and providers
  const loadSsoData = async () => {
    if (!token) return
    try {
      const [settings, providers] = await Promise.all([
        getSSOSettings(token),
        listSSOProviders(token)
      ])
      setSsoSettings(settings)
      setSsoProviders(providers || [])
    } catch (error) {
      console.error('Failed to load SSO data:', error)
      showToast('SSO 설정을 불러오는데 실패했습니다.', 'error')
    } finally {
      setLoading(false)
    }
  }

  // SSO Settings handlers
  const handleSsoSettingsChange = async (key: keyof SSOSettings, value: string) => {
    const newSettings = { ...ssoSettings, [key]: value }
    setSsoSettings(newSettings)
    try {
      await updateSSOSettings(token!, { [key]: value })
      showToast('SSO 설정이 저장되었습니다.', 'success')
    } catch (error) {
      console.error('Failed to update SSO setting:', error)
      showToast('SSO 설정 저장에 실패했습니다.', 'error')
    }
  }

  // Provider CRUD handlers
  const openAddProviderModal = () => {
    setEditingProvider(null)
    setProviderForm({
      name: '',
      providerType: 'google',
      clientId: '',
      clientSecret: '',
      issuerUrl: '',
      authorizationUrl: '',
      tokenUrl: '',
      userinfoUrl: '',
      scopes: 'openid email profile',
      allowedDomains: '',
      autoCreateUser: true,
      defaultAdmin: false,
      isEnabled: true,
      displayOrder: ssoProviders.length,
      iconUrl: '',
      buttonColor: ''
    })
    setShowProviderModal(true)
  }

  const openEditProviderModal = (provider: SSOProvider) => {
    setEditingProvider(provider)
    setProviderForm({
      name: provider.name,
      providerType: provider.providerType,
      clientId: provider.clientId,
      clientSecret: '', // Don't show existing secret
      issuerUrl: provider.issuerUrl || '',
      authorizationUrl: provider.authorizationUrl || '',
      tokenUrl: provider.tokenUrl || '',
      userinfoUrl: provider.userinfoUrl || '',
      scopes: provider.scopes,
      allowedDomains: provider.allowedDomains || '',
      autoCreateUser: provider.autoCreateUser,
      defaultAdmin: provider.defaultAdmin,
      isEnabled: provider.isEnabled,
      displayOrder: provider.displayOrder,
      iconUrl: provider.iconUrl || '',
      buttonColor: provider.buttonColor || ''
    })
    setShowProviderModal(true)
  }

  const handleSaveProvider = async () => {
    if (!providerForm.name || !providerForm.clientId) {
      showToast('이름과 Client ID는 필수입니다.', 'error')
      return
    }
    if (!editingProvider && !providerForm.clientSecret) {
      showToast('Client Secret은 필수입니다.', 'error')
      return
    }

    setSavingSso(true)
    try {
      if (editingProvider) {
        await updateSSOProvider(token!, editingProvider.id, providerForm)
        showToast('SSO 프로바이더가 수정되었습니다.', 'success')
      } else {
        await createSSOProvider(token!, providerForm as never)
        showToast('SSO 프로바이더가 추가되었습니다.', 'success')
      }
      setShowProviderModal(false)
      loadSsoData()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'SSO 프로바이더 저장에 실패했습니다.', 'error')
    } finally {
      setSavingSso(false)
    }
  }

  const handleDeleteProvider = async (provider: SSOProvider) => {
    if (!confirm(`정말 "${provider.name}" 프로바이더를 삭제하시겠습니까?`)) return

    try {
      await deleteSSOProvider(token!, provider.id)
      showToast('SSO 프로바이더가 삭제되었습니다.', 'success')
      loadSsoData()
    } catch (error) {
      showToast('SSO 프로바이더 삭제에 실패했습니다.', 'error')
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
          <span>SSO 설정을 불러오는 중...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="as-container">
      {/* Header */}
      <div className="as-header">
        <div className="as-header-icon sso-header">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M15 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 17L15 12L10 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M15 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="as-header-text">
          <h1>SSO 설정</h1>
          <p>OAuth2.0/OIDC 기반 싱글 사인온 설정을 관리합니다.</p>
        </div>
      </div>

      {/* Settings Content */}
      <div className="as-content">
        {/* SSO Global Settings */}
        <div className="as-section">
          <div className="as-section-header">
            <div className="as-section-icon sso">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="as-section-title">
              <h3>전역 설정</h3>
              <p>SSO 인증 기능의 전역 설정을 관리합니다.</p>
            </div>
          </div>
          <div className="as-section-content">
            <div className="as-setting-row">
              <div className="as-setting-info">
                <label>SSO 활성화</label>
                <span className="as-setting-desc">외부 인증 제공자를 통한 로그인을 활성화합니다.</span>
              </div>
              <label className="as-toggle">
                <input
                  type="checkbox"
                  checked={ssoSettings.sso_enabled === 'true'}
                  onChange={(e) => handleSsoSettingsChange('sso_enabled', e.target.checked ? 'true' : 'false')}
                />
                <span className="as-toggle-slider"></span>
              </label>
            </div>
            {ssoSettings.sso_enabled === 'true' && (
              <>
                <div className="as-divider"></div>
                <div className="as-setting-row">
                  <div className="as-setting-info">
                    <label>SSO 전용 모드</label>
                    <span className="as-setting-desc">활성화 시 로컬 계정 로그인을 비활성화합니다. 주의: 관리자 계정도 SSO로만 로그인 가능합니다.</span>
                  </div>
                  <label className="as-toggle">
                    <input
                      type="checkbox"
                      checked={ssoSettings.sso_only_mode === 'true'}
                      onChange={(e) => handleSsoSettingsChange('sso_only_mode', e.target.checked ? 'true' : 'false')}
                    />
                    <span className="as-toggle-slider"></span>
                  </label>
                </div>
                <div className="as-divider"></div>
                <div className="as-setting-row">
                  <div className="as-setting-info">
                    <label>자동 사용자 생성</label>
                    <span className="as-setting-desc">SSO 최초 로그인 시 자동으로 사용자 계정을 생성합니다.</span>
                  </div>
                  <label className="as-toggle">
                    <input
                      type="checkbox"
                      checked={ssoSettings.sso_auto_register === 'true'}
                      onChange={(e) => handleSsoSettingsChange('sso_auto_register', e.target.checked ? 'true' : 'false')}
                    />
                    <span className="as-toggle-slider"></span>
                  </label>
                </div>
                <div className="as-divider"></div>
                <div className="as-setting-row">
                  <div className="as-setting-info">
                    <label>허용 도메인</label>
                    <span className="as-setting-desc">SSO 로그인을 허용할 이메일 도메인 (쉼표로 구분, 비어있으면 모두 허용)</span>
                  </div>
                  <input
                    type="text"
                    className="as-text-input"
                    placeholder="example.com, company.co.kr"
                    value={ssoSettings.sso_allowed_domains}
                    onChange={(e) => handleSsoSettingsChange('sso_allowed_domains', e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* SSO Providers */}
        <div className="as-section">
          <div className="as-section-header">
            <div className="as-section-icon providers">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
              </svg>
            </div>
            <div className="as-section-title">
              <h3>SSO 프로바이더</h3>
              <p>OAuth2.0/OIDC 인증 제공자를 관리합니다.</p>
            </div>
            <button className="as-btn-add" onClick={openAddProviderModal}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              프로바이더 추가
            </button>
          </div>
          <div className="as-section-content">
            {ssoProviders.length === 0 ? (
              <div className="as-empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
                </svg>
                <p>등록된 SSO 프로바이더가 없습니다.</p>
                <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                  Google, GitHub, Keycloak 등 외부 인증 제공자를 추가하세요.
                </p>
                <button className="as-btn-secondary" onClick={openAddProviderModal} style={{ marginTop: '16px' }}>
                  첫 번째 프로바이더 추가
                </button>
              </div>
            ) : (
              <div className="as-provider-list">
                {ssoProviders.map((provider) => (
                  <div key={provider.id} className={`as-provider-item ${!provider.isEnabled ? 'disabled' : ''}`}>
                    <div className="as-provider-info">
                      <div className="as-provider-badge" data-type={provider.providerType}>
                        {provider.providerType.toUpperCase()}
                      </div>
                      <div className="as-provider-details">
                        <span className="as-provider-name">{provider.name}</span>
                        <span className="as-provider-meta">
                          Client ID: {provider.clientId.length > 30
                            ? provider.clientId.substring(0, 30) + '...'
                            : provider.clientId}
                        </span>
                      </div>
                    </div>
                    <div className="as-provider-actions">
                      <span className={`as-provider-status ${provider.isEnabled ? 'active' : 'inactive'}`}>
                        {provider.isEnabled ? '활성' : '비활성'}
                      </span>
                      <button className="as-btn-icon" onClick={() => openEditProviderModal(provider)} title="수정">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button className="as-btn-icon danger" onClick={() => handleDeleteProvider(provider)} title="삭제">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Help Section */}
        <div className="as-section">
          <div className="as-section-header">
            <div className="as-section-icon help">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="17" r="1" fill="currentColor"/>
              </svg>
            </div>
            <div className="as-section-title">
              <h3>설정 가이드</h3>
              <p>SSO 프로바이더 설정 방법을 안내합니다.</p>
            </div>
          </div>
          <div className="as-section-content">
            <div className="sso-guide">
              <div className="sso-guide-item">
                <div className="sso-guide-icon google">G</div>
                <div className="sso-guide-content">
                  <h4>Google</h4>
                  <p>Google Cloud Console에서 OAuth 2.0 클라이언트를 생성하고 Client ID와 Secret을 입력하세요.</p>
                  <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">
                    Google Cloud Console 열기
                  </a>
                </div>
              </div>
              <div className="sso-guide-item">
                <div className="sso-guide-icon github">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                </div>
                <div className="sso-guide-content">
                  <h4>GitHub</h4>
                  <p>GitHub Developer Settings에서 OAuth App을 생성하세요.</p>
                  <a href="https://github.com/settings/developers" target="_blank" rel="noopener noreferrer">
                    GitHub Developer Settings 열기
                  </a>
                </div>
              </div>
              <div className="sso-guide-item">
                <div className="sso-guide-icon keycloak">K</div>
                <div className="sso-guide-content">
                  <h4>Keycloak / OIDC</h4>
                  <p>Keycloak Realm에서 Client를 생성하고, Issuer URL에 <code>https://keycloak.example.com/realms/REALM_NAME</code> 형식으로 입력하세요.</p>
                </div>
              </div>
            </div>
            <div className="sso-callback-info">
              <h4>Callback URL 설정</h4>
              <p>SSO 프로바이더 설정 시 아래 URL을 Redirect/Callback URL로 등록하세요:</p>
              <code>{window.location.origin}/api/auth/sso/callback/[PROVIDER_ID]</code>
            </div>
          </div>
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

      {/* SSO Provider Modal */}
      {showProviderModal && (
        <div className="as-modal-overlay" onClick={() => setShowProviderModal(false)}>
          <div className="as-modal" onClick={(e) => e.stopPropagation()}>
            <div className="as-modal-header">
              <h3>{editingProvider ? 'SSO 프로바이더 수정' : 'SSO 프로바이더 추가'}</h3>
              <button className="as-modal-close" onClick={() => setShowProviderModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="as-modal-content">
              <div className="as-form-group">
                <label>프로바이더 유형 *</label>
                <select
                  value={providerForm.providerType}
                  onChange={(e) => setProviderForm({ ...providerForm, providerType: e.target.value })}
                >
                  {PROVIDER_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
              <div className="as-form-group">
                <label>표시 이름 *</label>
                <input
                  type="text"
                  value={providerForm.name}
                  onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
                  placeholder="예: Google, Company SSO"
                />
              </div>
              <div className="as-form-row">
                <div className="as-form-group">
                  <label>Client ID *</label>
                  <input
                    type="text"
                    value={providerForm.clientId}
                    onChange={(e) => setProviderForm({ ...providerForm, clientId: e.target.value })}
                    placeholder="OAuth Client ID"
                  />
                </div>
                <div className="as-form-group">
                  <label>Client Secret {editingProvider ? '(변경 시에만 입력)' : '*'}</label>
                  <input
                    type="password"
                    value={providerForm.clientSecret}
                    onChange={(e) => setProviderForm({ ...providerForm, clientSecret: e.target.value })}
                    placeholder="OAuth Client Secret"
                  />
                </div>
              </div>

              {providerForm.providerType === 'oidc' && (
                <>
                  <div className="as-form-group">
                    <label>Issuer URL *</label>
                    <input
                      type="text"
                      value={providerForm.issuerUrl}
                      onChange={(e) => setProviderForm({ ...providerForm, issuerUrl: e.target.value })}
                      placeholder="https://keycloak.example.com/realms/master"
                    />
                    <span className="as-form-hint">Keycloak: https://host/realms/REALM_NAME</span>
                  </div>
                  <div className="as-form-row">
                    <div className="as-form-group">
                      <label>Authorization URL (선택)</label>
                      <input
                        type="text"
                        value={providerForm.authorizationUrl}
                        onChange={(e) => setProviderForm({ ...providerForm, authorizationUrl: e.target.value })}
                        placeholder="자동 생성됨"
                      />
                    </div>
                    <div className="as-form-group">
                      <label>Token URL (선택)</label>
                      <input
                        type="text"
                        value={providerForm.tokenUrl}
                        onChange={(e) => setProviderForm({ ...providerForm, tokenUrl: e.target.value })}
                        placeholder="자동 생성됨"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="as-form-group">
                <label>Scopes</label>
                <input
                  type="text"
                  value={providerForm.scopes}
                  onChange={(e) => setProviderForm({ ...providerForm, scopes: e.target.value })}
                  placeholder="openid email profile"
                />
              </div>

              <div className="as-form-group">
                <label>허용 도메인 (선택)</label>
                <input
                  type="text"
                  value={providerForm.allowedDomains}
                  onChange={(e) => setProviderForm({ ...providerForm, allowedDomains: e.target.value })}
                  placeholder="example.com, company.co.kr (비어있으면 모두 허용)"
                />
              </div>

              <div className="as-form-row">
                <label className="as-checkbox-label">
                  <input
                    type="checkbox"
                    checked={providerForm.autoCreateUser}
                    onChange={(e) => setProviderForm({ ...providerForm, autoCreateUser: e.target.checked })}
                  />
                  <span>자동 사용자 생성</span>
                </label>
                <label className="as-checkbox-label">
                  <input
                    type="checkbox"
                    checked={providerForm.defaultAdmin}
                    onChange={(e) => setProviderForm({ ...providerForm, defaultAdmin: e.target.checked })}
                  />
                  <span>기본 관리자 권한</span>
                </label>
                <label className="as-checkbox-label">
                  <input
                    type="checkbox"
                    checked={providerForm.isEnabled}
                    onChange={(e) => setProviderForm({ ...providerForm, isEnabled: e.target.checked })}
                  />
                  <span>활성화</span>
                </label>
              </div>
            </div>
            <div className="as-modal-footer">
              <button className="as-btn-cancel" onClick={() => setShowProviderModal(false)}>
                취소
              </button>
              <button className="as-btn-primary" onClick={handleSaveProvider} disabled={savingSso}>
                {savingSso ? '저장 중...' : (editingProvider ? '수정' : '추가')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminSSOSettings
