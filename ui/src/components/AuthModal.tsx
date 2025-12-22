import { useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import './AuthModal.css'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
}

function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const { login, isLoading, error, clearError } = useAuthStore()

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      await login({ username, password })
      handleClose()
    } catch {
      // Error is handled by the store
    }
  }

  const handleClose = () => {
    setUsername('')
    setPassword('')
    clearError()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>로그인</h2>
          <button className="close-btn" onClick={handleClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-error">{error}</div>}

          <div className="form-group">
            <label>사용자명</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="사용자명을 입력하세요"
              required
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label>비밀번호</label>
            <input
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
            className="submit-btn"
            disabled={isLoading}
          >
            {isLoading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <div className="auth-hint">
          <p>관리자에게 계정을 요청하세요.</p>
        </div>
      </div>
    </div>
  )
}

export default AuthModal
