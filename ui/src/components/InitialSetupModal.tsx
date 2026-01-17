import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import './InitialSetupModal.css'

// Password strength calculation
function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  let score = 0

  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[a-z]/.test(password)) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) score++

  if (score <= 2) return { score, label: '약함', color: '#dc3545' }
  if (score <= 4) return { score, label: '보통', color: '#ffc107' }
  return { score, label: '강함', color: '#28a745' }
}

function InitialSetupModal() {
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [email, setEmail] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const { completeSetup, isLoading, error, clearError } = useAuthStore()

  const passwordStrength = getPasswordStrength(newPassword)
  const passwordsMatch = newPassword === confirmPassword

  // Clear errors when inputs change
  useEffect(() => {
    setValidationError(null)
    clearError()
  }, [newUsername, newPassword, confirmPassword, email, clearError])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setValidationError(null)

    // Validate username
    if (newUsername.length < 3 || newUsername.length > 50) {
      setValidationError('사용자명은 3~50자 사이여야 합니다')
      return
    }

    // Validate password
    if (newPassword.length < 8) {
      setValidationError('비밀번호는 최소 8자 이상이어야 합니다')
      return
    }

    // Check password complexity
    if (passwordStrength.score < 3) {
      setValidationError('비밀번호는 대문자, 소문자, 숫자, 특수문자를 조합하여 사용해주세요')
      return
    }

    // Confirm password match
    if (!passwordsMatch) {
      setValidationError('비밀번호가 일치하지 않습니다')
      return
    }

    // Validate email format if provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setValidationError('유효한 이메일 주소를 입력해주세요')
      return
    }

    try {
      await completeSetup({
        newUsername,
        newPassword,
        email: email || undefined
      })
      // On success, the store will update and this component will unmount
      window.location.reload()
    } catch {
      // Error is handled by the store
    }
  }

  return (
    <div className="initial-setup-overlay">
      <div className="initial-setup-modal">
        <div className="initial-setup-header">
          <div className="initial-setup-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
          </div>
          <h1>초기 관리자 설정</h1>
          <p>보안을 위해 기본 관리자 계정 정보를 변경해주세요.</p>
          <p className="initial-setup-warning">
            이 설정은 필수이며, 완료 전까지 시스템을 사용할 수 없습니다.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="initial-setup-form">
          {(error || validationError) && (
            <div className="initial-setup-error">
              {validationError || error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="newUsername">새 사용자명 *</label>
            <input
              id="newUsername"
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="새 사용자명 입력"
              required
              autoComplete="username"
              autoFocus
              minLength={3}
              maxLength={50}
            />
            <span className="form-hint">3~50자, 기존 admin 대신 사용할 이름</span>
          </div>

          <div className="form-group">
            <label htmlFor="newPassword">새 비밀번호 *</label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="새 비밀번호 입력"
              required
              autoComplete="new-password"
              minLength={8}
            />
            {newPassword && (
              <div className="password-strength">
                <div className="password-strength-bar">
                  <div
                    className="password-strength-fill"
                    style={{
                      width: `${(passwordStrength.score / 6) * 100}%`,
                      backgroundColor: passwordStrength.color
                    }}
                  />
                </div>
                <span style={{ color: passwordStrength.color }}>
                  {passwordStrength.label}
                </span>
              </div>
            )}
            <span className="form-hint">최소 8자, 대소문자/숫자/특수문자 조합 권장</span>
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">비밀번호 확인 *</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="비밀번호 다시 입력"
              required
              autoComplete="new-password"
            />
            {confirmPassword && !passwordsMatch && (
              <span className="form-error">비밀번호가 일치하지 않습니다</span>
            )}
            {confirmPassword && passwordsMatch && (
              <span className="form-success">비밀번호가 일치합니다</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="email">이메일 (선택)</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              autoComplete="email"
            />
            <span className="form-hint">비밀번호 재설정 등에 사용됩니다</span>
          </div>

          <button
            type="submit"
            className="initial-setup-submit"
            disabled={isLoading || !newUsername || !newPassword || !confirmPassword || !passwordsMatch}
          >
            {isLoading ? '설정 중...' : '설정 완료'}
          </button>
        </form>

        <div className="initial-setup-footer">
          <p>FileHatch 보안 설정 마법사</p>
        </div>
      </div>
    </div>
  )
}

export default InitialSetupModal
