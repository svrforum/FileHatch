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
  const [deletingId, setDeletingId] = useState<string | null>(null)
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
  // Upload share specific state
  const [shareType, setShareType] = useState<'download' | 'upload'>('download')
  const [useMaxFileSize, setUseMaxFileSize] = useState(false)
  const [maxFileSize, setMaxFileSize] = useState(104857600) // 100MB default
  const [useAllowedExtensions, setUseAllowedExtensions] = useState(false)
  const [allowedExtensions, setAllowedExtensions] = useState('')
  const [useMaxTotalSize, setUseMaxTotalSize] = useState(false)
  const [maxTotalSize, setMaxTotalSize] = useState(1073741824) // 1GB default

  // Created link
  const [createdLink, setCreatedLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Load existing links
  const loadLinks = useCallback(async () => {
    setLoadingLinks(true)
    try {
      const allLinks = await getMyShareLinks()
      // Filter links for this specific path using displayPath
      const normalizedPath = itemPath.startsWith('/') ? itemPath : '/' + itemPath
      const filtered = allLinks.filter((link) => link.displayPath === normalizedPath)
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
      // Reset upload share options
      setShareType('download')
      setUseMaxFileSize(false)
      setMaxFileSize(104857600)
      setUseAllowedExtensions(false)
      setAllowedExtensions('')
      setUseMaxTotalSize(false)
      setMaxTotalSize(1073741824)
    }
  }, [isOpen, loadLinks])

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

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
        // Upload share options
        shareType: shareType,
        maxFileSize: shareType === 'upload' && useMaxFileSize ? maxFileSize : undefined,
        allowedExtensions: shareType === 'upload' && useAllowedExtensions ? allowedExtensions : undefined,
        maxTotalSize: shareType === 'upload' && useMaxTotalSize ? maxTotalSize : undefined,
      })

      const fullUrl = `${window.location.origin}${result.url}`
      setCreatedLink(fullUrl)

      // Auto-copy to clipboard
      try {
        await navigator.clipboard.writeText(fullUrl)
        setCopied(true)
        setSuccess('링크가 클립보드에 복사되었습니다')
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // Fallback for older browsers
        const textArea = document.createElement('textarea')
        textArea.value = fullUrl
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
        setCopied(true)
        setSuccess('링크가 클립보드에 복사되었습니다')
        setTimeout(() => setCopied(false), 2000)
      }

      loadLinks()

      // Reset form
      setUsePassword(false)
      setPassword('')
      setUseExpiry(false)
      setUseMaxAccess(false)
      setRequireLogin(false)
      setShareType('download')
      setUseMaxFileSize(false)
      setUseAllowedExtensions(false)
      setUseMaxTotalSize(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '링크 생성 실패')
    } finally {
      setLoading(false)
    }
  }

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setSuccess('링크가 복사되었습니다')
      setTimeout(() => {
        setCopied(false)
        setSuccess(null)
      }, 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = url
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setSuccess('링크가 복사되었습니다')
      setTimeout(() => {
        setCopied(false)
        setSuccess(null)
      }, 2000)
    }
  }

  const handleDeleteLink = async (linkId: string) => {
    if (!confirm('이 링크를 삭제하시겠습니까?')) return
    setDeletingId(linkId)
    try {
      await deleteShareLink(linkId)
      loadLinks()
      if (existingLinks.length === 1) {
        setCreatedLink(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제 실패')
    } finally {
      setDeletingId(null)
    }
  }

  const formatExpiry = (dateString: string | undefined) => {
    if (!dateString) return '무제한'
    const date = new Date(dateString)
    if (date.getTime() < Date.now()) return '만료됨'

    const diff = date.getTime() - Date.now()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}일 후`
    if (hours > 0) return `${hours}시간 후`
    return '곧 만료'
  }

  if (!isOpen) return null

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div
        className="link-share-modal"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        <button className="modal-close-btn" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>

        <div className="link-share-modal-content">
          <h2>링크 공유</h2>
          <div className="link-share-target">
            {isFolder ? (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
              </svg>
            )}
            <span>{itemName}</span>
          </div>

          {/* Created link display */}
          {createdLink && (
            <div className="created-link-section">
              <label>공유 링크 생성 완료!</label>
              <div className="link-display">
                <input
                  type="text"
                  value={createdLink}
                  readOnly
                  className="link-input"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  className={`copy-btn ${copied ? 'copied' : ''}`}
                  onClick={() => handleCopyLink(createdLink)}
                >
                  {copied ? '복사됨' : '복사'}
                </button>
              </div>
            </div>
          )}

          {/* Share type toggle for folders */}
          {isFolder && (
            <div className="share-type-toggle">
              <button
                className={`share-type-btn ${shareType === 'download' ? 'active' : ''}`}
                onClick={() => setShareType('download')}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                </svg>
                다운로드
              </button>
              <button
                className={`share-type-btn ${shareType === 'upload' ? 'active' : ''}`}
                onClick={() => setShareType('upload')}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>
                </svg>
                업로드
              </button>
            </div>
          )}

          {/* Create new link section */}
          <div className="link-options">
            <h3>링크 옵션</h3>

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
                <div className="password-input-wrapper">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="암호 입력"
                    className="option-input"
                  />
                </div>
              )}
            </div>

            <div className="option-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={useExpiry}
                  onChange={(e) => setUseExpiry(e.target.checked)}
                />
                <span>만료 시간</span>
              </label>
              {useExpiry && (
                <div className="expiry-select-wrapper">
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
                <span className="option-hint">로그인한 사용자만 접근</span>
              )}
            </div>

            {/* Upload-specific options */}
            {shareType === 'upload' && (
              <>
                <div className="upload-options-divider">
                  <span>업로드 제한 옵션</span>
                </div>

                <div className="option-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={useMaxFileSize}
                      onChange={(e) => setUseMaxFileSize(e.target.checked)}
                    />
                    <span>파일 크기 제한</span>
                  </label>
                  {useMaxFileSize && (
                    <select
                      value={maxFileSize}
                      onChange={(e) => setMaxFileSize(Number(e.target.value))}
                      className="option-input"
                    >
                      <option value={10485760}>10 MB</option>
                      <option value={52428800}>50 MB</option>
                      <option value={104857600}>100 MB</option>
                      <option value={524288000}>500 MB</option>
                      <option value={1073741824}>1 GB</option>
                      <option value={5368709120}>5 GB</option>
                    </select>
                  )}
                </div>

                <div className="option-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={useAllowedExtensions}
                      onChange={(e) => setUseAllowedExtensions(e.target.checked)}
                    />
                    <span>허용 확장자</span>
                  </label>
                  {useAllowedExtensions && (
                    <input
                      type="text"
                      value={allowedExtensions}
                      onChange={(e) => setAllowedExtensions(e.target.value)}
                      placeholder="pdf,docx,jpg"
                      className="option-input"
                    />
                  )}
                </div>

                <div className="option-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={useMaxTotalSize}
                      onChange={(e) => setUseMaxTotalSize(e.target.checked)}
                    />
                    <span>총 용량 제한</span>
                  </label>
                  {useMaxTotalSize && (
                    <select
                      value={maxTotalSize}
                      onChange={(e) => setMaxTotalSize(Number(e.target.value))}
                      className="option-input"
                    >
                      <option value={104857600}>100 MB</option>
                      <option value={524288000}>500 MB</option>
                      <option value={1073741824}>1 GB</option>
                      <option value={5368709120}>5 GB</option>
                      <option value={10737418240}>10 GB</option>
                    </select>
                  )}
                </div>
              </>
            )}
          </div>

          {error && <p className="error-message">{error}</p>}
          {success && <p className="success-message">{success}</p>}

          <button
            className="create-link-btn"
            onClick={handleCreateLink}
            disabled={loading || (usePassword && !password)}
          >
            {loading ? '생성 중...' : shareType === 'upload' ? '업로드 링크 만들기' : '다운로드 링크 만들기'}
          </button>

          {/* Existing links section */}
          <div className="existing-links-section">
            <h3>
              기존 공유 링크
              {existingLinks.length > 0 && (
                <span className="link-count-badge">{existingLinks.length}</span>
              )}
            </h3>

            {loadingLinks ? (
              <p className="loading-text">불러오는 중...</p>
            ) : existingLinks.length === 0 ? (
              <p className="empty-text">이 파일에 대한 공유 링크가 없습니다</p>
            ) : (
              <div className="existing-links-list">
                {existingLinks.map((link) => {
                  const linkPrefix = link.shareType === 'upload' ? '/u/' : '/s/'
                  const linkUrl = `${window.location.origin}${linkPrefix}${link.token}`
                  return (
                  <div key={link.id} className={`link-item ${link.shareType === 'upload' ? 'upload-link' : ''}`}>
                    <div className="link-item-header">
                      <div className="link-url-display">
                        <input
                          type="text"
                          readOnly
                          value={linkUrl}
                          className="link-url-input"
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <button
                          className="link-copy-btn"
                          onClick={() => handleCopyLink(linkUrl)}
                        >
                          복사
                        </button>
                      </div>
                      <button
                        className="link-delete-btn"
                        onClick={() => handleDeleteLink(link.id)}
                        disabled={deletingId === link.id}
                      >
                        {deletingId === link.id ? '...' : '삭제'}
                      </button>
                    </div>
                    <div className="link-item-meta">
                      {link.hasPassword && (
                        <span className="link-meta-badge password">
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                          </svg>
                          암호
                        </span>
                      )}
                      <span className="link-meta-badge expiry">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                        </svg>
                        {formatExpiry(link.expiresAt)}
                      </span>
                      <span className="link-meta-badge access">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                        </svg>
                        {link.accessCount}회{link.maxAccess ? `/${link.maxAccess}` : ''}
                      </span>
                      {link.requireLogin && (
                        <span className="link-meta-badge login">
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                          </svg>
                          로그인 필요
                        </span>
                      )}
                      {link.shareType === 'upload' && (
                        <span className="link-meta-badge upload">
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>
                          </svg>
                          업로드
                        </span>
                      )}
                      {!link.isActive && (
                        <span className="link-meta-badge inactive">비활성</span>
                      )}
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default LinkShareModal
