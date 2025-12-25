import { useState, useEffect, useCallback } from 'react'
import {
  createShareLink,
  getMyShareLinks,
  deleteShareLink,
  LinkShare,
} from '../api/fileShares'
import './LinkShareModal.css'

interface LinkShareModalProps {
  isOpen: boolean
  onClose: () => void
  itemPath: string
  itemName: string
  isFolder: boolean
}

function LinkShareModal({ isOpen, onClose, itemPath, itemName, isFolder }: LinkShareModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Existing links for this file
  const [existingLinks, setExistingLinks] = useState<LinkShare[]>([])
  const [loadingLinks, setLoadingLinks] = useState(true)

  // Form state
  const [usePassword, setUsePassword] = useState(false)
  const [password, setPassword] = useState('')
  const [useExpiry, setUseExpiry] = useState(false)
  const [expiryHours, setExpiryHours] = useState(24)
  const [useMaxAccess, setUseMaxAccess] = useState(false)
  const [maxAccess, setMaxAccess] = useState(10)
  const [requireLogin, setRequireLogin] = useState(false)

  // Created link
  const [createdLink, setCreatedLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Load existing links
  const loadLinks = useCallback(async () => {
    setLoadingLinks(true)
    try {
      const allLinks = await getMyShareLinks()
      // Filter links for this specific path
      const filtered = allLinks.filter((link) => link.path === itemPath.replace(/^\//, ''))
      setExistingLinks(filtered)
    } catch {
      setExistingLinks([])
    } finally {
      setLoadingLinks(false)
    }
  }, [itemPath])

  useEffect(() => {
    if (isOpen) {
      loadLinks()
      setError(null)
      setSuccess(null)
      setCreatedLink(null)
      setCopied(false)
      setUsePassword(false)
      setPassword('')
      setUseExpiry(false)
      setExpiryHours(24)
      setUseMaxAccess(false)
      setMaxAccess(10)
      setRequireLogin(false)
    }
  }, [isOpen, loadLinks])

  const handleCreateLink = async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await createShareLink({
        path: itemPath,
        password: usePassword && password ? password : undefined,
        expiresIn: useExpiry ? expiryHours : undefined,
        maxAccess: useMaxAccess ? maxAccess : undefined,
        requireLogin: requireLogin,
      })

      const fullUrl = `${window.location.origin}${result.url}`
      setCreatedLink(fullUrl)
      setSuccess('공유 링크가 생성되었습니다')
      loadLinks()
    } catch (err) {
      setError(err instanceof Error ? err.message : '링크 생성에 실패했습니다')
    } finally {
      setLoading(false)
    }
  }

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = url
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleDeleteLink = async (linkId: string) => {
    if (!confirm('이 링크를 삭제하시겠습니까?')) return
    try {
      await deleteShareLink(linkId)
      loadLinks()
      if (existingLinks.length === 1) {
        setCreatedLink(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '링크 삭제에 실패했습니다')
    }
  }

  const formatExpiry = (dateString: string | undefined) => {
    if (!dateString) return '무제한'
    const date = new Date(dateString)
    if (date.getTime() < Date.now()) return '만료됨'
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="link-share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {isFolder ? '📁' : '📄'} {itemName} 링크 공유
          </h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="link-share-modal-content">
          {/* Created link display */}
          {createdLink && (
            <div className="created-link-section">
              <label>공유 링크:</label>
              <div className="link-display">
                <input
                  type="text"
                  value={createdLink}
                  readOnly
                  className="link-input"
                />
                <button
                  className="copy-btn"
                  onClick={() => handleCopyLink(createdLink)}
                >
                  {copied ? '복사됨!' : '복사'}
                </button>
              </div>
            </div>
          )}

          {/* Create new link section */}
          <div className="create-link-section">
            <h3>새 링크 생성</h3>

            <div className="option-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={usePassword}
                  onChange={(e) => setUsePassword(e.target.checked)}
                />
                <span>암호 설정</span>
              </label>
              {usePassword && (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="암호 입력"
                  className="option-input"
                />
              )}
            </div>

            <div className="option-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={useExpiry}
                  onChange={(e) => setUseExpiry(e.target.checked)}
                />
                <span>만료 시간 설정</span>
              </label>
              {useExpiry && (
                <div className="expiry-select">
                  <select
                    value={expiryHours}
                    onChange={(e) => setExpiryHours(Number(e.target.value))}
                    className="option-input"
                  >
                    <option value={1}>1시간</option>
                    <option value={6}>6시간</option>
                    <option value={24}>1일</option>
                    <option value={72}>3일</option>
                    <option value={168}>1주일</option>
                    <option value={720}>30일</option>
                  </select>
                </div>
              )}
            </div>

            <div className="option-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={useMaxAccess}
                  onChange={(e) => setUseMaxAccess(e.target.checked)}
                />
                <span>접근 횟수 제한</span>
              </label>
              {useMaxAccess && (
                <input
                  type="number"
                  value={maxAccess}
                  onChange={(e) => setMaxAccess(Math.max(1, Number(e.target.value)))}
                  min={1}
                  className="option-input small"
                />
              )}
            </div>

            <div className="option-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={requireLogin}
                  onChange={(e) => setRequireLogin(e.target.checked)}
                />
                <span>로그인 필요</span>
              </label>
              {requireLogin && (
                <span className="option-hint">로그인한 사용자만 접근 가능</span>
              )}
            </div>

            {error && <p className="error-message">{error}</p>}
            {success && <p className="success-message">{success}</p>}

            <button
              className="btn-primary create-link-btn"
              onClick={handleCreateLink}
              disabled={loading || (usePassword && !password)}
            >
              {loading ? '생성 중...' : '링크 생성'}
            </button>
          </div>

          {/* Existing links section */}
          <div className="existing-links-section">
            <h3>기존 링크</h3>

            {loadingLinks ? (
              <p className="loading-text">불러오는 중...</p>
            ) : existingLinks.length === 0 ? (
              <p className="empty-text">생성된 링크가 없습니다</p>
            ) : (
              <div className="links-list">
                {existingLinks.map((link) => (
                  <div key={link.id} className="link-item">
                    <div className="link-info">
                      <div className="link-url-row">
                        <span className="link-url">{window.location.origin}/s/{link.token}</span>
                        <button
                          className="copy-btn small"
                          onClick={() => handleCopyLink(`${window.location.origin}/s/${link.token}`)}
                        >
                          복사
                        </button>
                      </div>
                      <div className="link-meta">
                        {link.hasPassword && <span className="meta-badge">🔒 암호</span>}
                        <span className="meta-text">만료: {formatExpiry(link.expiresAt)}</span>
                        {link.maxAccess && (
                          <span className="meta-text">접근: {link.accessCount}/{link.maxAccess}</span>
                        )}
                        {!link.maxAccess && (
                          <span className="meta-text">접근: {link.accessCount}회</span>
                        )}
                      </div>
                    </div>
                    <button
                      className="delete-link-btn"
                      onClick={() => handleDeleteLink(link.id)}
                      title="링크 삭제"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

export default LinkShareModal
