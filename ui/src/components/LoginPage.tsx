import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { getSSOProviders, getSSOAuthURL, SSOProviderPublic } from '../api/auth'
import './LoginPage.css'

// Provider icons
const providerIcons: Record<string, JSX.Element> = {
  google: (
    <svg viewBox="0 0 24 24" width="20" height="20">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  ),
  azure: (
    <svg viewBox="0 0 24 24" width="20" height="20">
      <path fill="#00a4ef" d="M5.7 4.5l7.5-2.1-4.5 7.5-5.4.9 2.4-6.3zm5.1 3.9l4.2 10.5-9.6-2.7 5.4-7.8zm6.6-3l3.9 3.3-8.1 11.7 4.2-15z"/>
    </svg>
  ),
  oidc: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
    </svg>
  ),
}

function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [ssoProviders, setSSOProviders] = useState<SSOProviderPublic[]>([])
  const [ssoEnabled, setSSOEnabled] = useState(false)
  const [ssoOnlyMode, setSSOOnlyMode] = useState(false)
  const [ssoLoading, setSSOLoading] = useState<string | null>(null)
  const [ssoError, setSSOError] = useState<string | null>(null)

  const { login, verify2FACode, cancel2FA, isLoading, error, clearError, requires2FA, setToken } = useAuthStore()

  // Check for SSO callback token on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ssoToken = params.get('sso_token')
    const ssoErrorParam = params.get('error')
    const ssoMessage = params.get('message')

    if (ssoToken) {
      // Clear URL params
      window.history.replaceState({}, '', '/login')
      // Set token directly to localStorage to ensure it's persisted before navigation
      localStorage.setItem('scv-auth', JSON.stringify({ state: { token: ssoToken, user: null }, version: 0 }))
      setToken(ssoToken)
      // Small delay to ensure state is persisted
      setTimeout(() => {
        window.location.href = '/'
      }, 100)
    } else if (ssoErrorParam) {
      setSSOError(ssoMessage || ssoErrorParam)
      window.history.replaceState({}, '', '/login')
    }
  }, [setToken])

  // Fetch SSO providers
  useEffect(() => {
    getSSOProviders()
      .then((data) => {
        setSSOEnabled(data.enabled)
        setSSOOnlyMode(data.ssoOnlyMode)
        setSSOProviders(data.providers || [])
      })
      .catch(() => {
        // Ignore errors - SSO just won't be available
      })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    setSSOError(null)

    try {
      const needs2FA = await login({ username, password })
      if (!needs2FA) {
        // Force page reload to ensure state is properly updated
        window.location.reload()
      }
      // If 2FA is required, the UI will switch to 2FA form
    } catch {
      // Error is handled by the store
    }
  }

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()

    try {
      await verify2FACode(otpCode)
      // Force page reload to ensure state is properly updated
      window.location.reload()
    } catch {
      // Error is handled by the store
    }
  }

  const handleCancel2FA = () => {
    cancel2FA()
    setOtpCode('')
    setPassword('')
  }

  const handleSSOLogin = async (provider: SSOProviderPublic) => {
    setSSOLoading(provider.id)
    setSSOError(null)

    try {
      const { authUrl } = await getSSOAuthURL(provider.id)
      // Redirect to OAuth provider
      window.location.href = authUrl
    } catch (err) {
      setSSOError(err instanceof Error ? err.message : 'SSO 로그인에 실패했습니다')
      setSSOLoading(null)
    }
  }

  const getProviderIcon = (provider: SSOProviderPublic) => {
    if (provider.iconUrl) {
      return <img src={provider.iconUrl} alt={provider.name} width="20" height="20" />
    }
    return providerIcons[provider.providerType] || providerIcons.oidc
  }

  const getProviderButtonStyle = (provider: SSOProviderPublic) => {
    if (provider.buttonColor) {
      return { backgroundColor: provider.buttonColor }
    }
    switch (provider.providerType) {
      case 'google':
        return { backgroundColor: '#ffffff', color: '#333' }
      case 'github':
        return { backgroundColor: '#24292e', color: '#fff' }
      case 'azure':
        return { backgroundColor: '#00a4ef', color: '#fff' }
      default:
        return { backgroundColor: '#6c757d', color: '#fff' }
    }
  }

  // 2FA verification form
  if (requires2FA) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-header">
            <div className="login-logo twofa-logo">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1>2단계 인증</h1>
            <p>인증 앱에서 생성된 코드를 입력하세요</p>
          </div>

          <form onSubmit={handle2FASubmit} className="login-form">
            {error && <div className="login-error">{error}</div>}

            <div className="form-group">
              <label htmlFor="otpCode">인증 코드</label>
              <input
                id="otpCode"
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="6자리 코드 또는 8자리 백업 코드"
                className="otp-input"
                required
                autoComplete="one-time-code"
                autoFocus
              />
              <span className="otp-hint">
                Google Authenticator 등 인증 앱의 6자리 코드 또는
                백업 코드(8자리)를 입력하세요.
              </span>
            </div>

            <button
              type="submit"
              className="login-btn"
              disabled={isLoading || !otpCode || (otpCode.length !== 6 && otpCode.length !== 8)}
            >
              {isLoading ? '확인 중...' : '확인'}
            </button>

            <button
              type="button"
              className="cancel-btn"
              onClick={handleCancel2FA}
              disabled={isLoading}
            >
              취소
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <div className="login-logo">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <path d="M19 11H5C3.89543 11 3 11.8954 3 13V20C3 21.1046 3.89543 22 5 22H19C20.1046 22 21 21.1046 21 20V13C21 11.8954 20.1046 11 19 11Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M7 11V7C7 5.67392 7.52678 4.40215 8.46447 3.46447C9.40215 2.52678 10.6739 2 12 2C13.3261 2 14.5979 2.52678 15.5355 3.46447C16.4732 4.40215 17 5.67392 17 7V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1>SimpleCloudVault</h1>
          <p>안전한 파일 저장소에 로그인하세요</p>
        </div>

        {(error || ssoError) && <div className="login-error">{error || ssoError}</div>}

        {/* SSO Buttons */}
        {ssoEnabled && ssoProviders.length > 0 && (
          <div className="sso-section">
            {ssoProviders.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className="sso-btn"
                style={getProviderButtonStyle(provider)}
                onClick={() => handleSSOLogin(provider)}
                disabled={ssoLoading !== null}
              >
                <span className="sso-icon">{getProviderIcon(provider)}</span>
                <span className="sso-text">
                  {ssoLoading === provider.id ? '로그인 중...' : `${provider.name}으로 로그인`}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Divider (only show if SSO is enabled and local login is also allowed) */}
        {ssoEnabled && ssoProviders.length > 0 && !ssoOnlyMode && (
          <div className="login-divider">
            <span>또는</span>
          </div>
        )}

        {/* Local login form (hidden if SSO-only mode) */}
        {!ssoOnlyMode && (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="username">사용자명</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="사용자명을 입력하세요"
                required
                autoComplete="username"
                autoFocus={!ssoEnabled}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">비밀번호</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호를 입력하세요"
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              className="login-btn"
              disabled={isLoading || !username || !password}
            >
              {isLoading ? '로그인 중...' : '로그인'}
            </button>
          </form>
        )}

        {ssoOnlyMode && (
          <div className="sso-only-notice">
            <p>이 시스템은 SSO 로그인만 지원합니다.</p>
            <p>위의 SSO 버튼을 사용하여 로그인하세요.</p>
          </div>
        )}

        <div className="login-footer">
          <p>계정이 없으신가요? 관리자에게 문의하세요.</p>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
