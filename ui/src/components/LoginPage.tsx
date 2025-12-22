import { useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import './LoginPage.css'

function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const { login, isLoading, error, clearError } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()

    try {
      await login({ username, password })
      // Force page reload to ensure state is properly updated
      window.location.reload()
    } catch {
      // Error is handled by the store
    }
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

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}

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
              autoFocus
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

        <div className="login-footer">
          <p>계정이 없으신가요? 관리자에게 문의하세요.</p>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
