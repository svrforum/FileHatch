import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import './ShareAccessPage.css'

interface ShareInfo {
  token: string
  path: string
  name: string
  isDir: boolean
  size: number
  expiresAt?: string
  requiresPassword?: boolean
  requiresLogin?: boolean
}

type MediaType = 'video' | 'image' | 'audio' | 'none'

function ShareAccessPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // Extract token from URL path: /s/:token
  const token = location.pathname.split('/s/')[1]?.split('/')[0] || null
  const { token: authToken } = useAuthStore()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null)
  const [password, setPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const fetchShareInfo = useCallback(async (pwd?: string) => {
    if (!token) {
      setError('잘못된 공유 링크입니다')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }

      // Add auth header if logged in
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`
      }

      const response = await fetch(`/api/s/${token}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ password: pwd || '' }),
      })

      const data = await response.json()

      if (response.ok) {
        if (data.requiresPassword) {
          setNeedsPassword(true)
          setShareInfo(null)
        } else if (data.requiresLogin) {
          setNeedsLogin(true)
          setShareInfo(null)
        } else {
          setShareInfo(data)
          setNeedsPassword(false)
          setNeedsLogin(false)
        }
      } else {
        setError(data.error || '공유 링크에 접근할 수 없습니다')
      }
    } catch {
      setError('공유 링크를 불러오는 중 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }, [token, authToken])

  useEffect(() => {
    fetchShareInfo()
  }, [fetchShareInfo])

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    fetchShareInfo(password)
  }

  // Get download URL
  const getDownloadUrl = () => {
    if (!token) return ''
    let url = `/api/s/${token}/download`
    if (password) {
      url += `?password=${encodeURIComponent(password)}`
    }
    return url
  }

  // Get media streaming URL (same as download but for inline viewing)
  const getStreamUrl = () => {
    return getDownloadUrl()
  }

  const handleLoginRedirect = () => {
    // Save current URL to redirect back after login
    sessionStorage.setItem('shareRedirect', `/s/${token}`)
    navigate('/')
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // Detect media type from filename
  const getMediaType = (filename: string): MediaType => {
    const ext = filename.split('.').pop()?.toLowerCase() || ''

    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']

    if (videoExts.includes(ext)) return 'video'
    if (imageExts.includes(ext)) return 'image'
    if (audioExts.includes(ext)) return 'audio'
    return 'none'
  }

  const getFileIcon = () => {
    if (shareInfo?.isDir) {
      return (
        <svg className="share-file-icon folder" viewBox="0 0 24 24" fill="none">
          <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H12L10 5H5C3.89543 5 3 5.89543 3 7Z" fill="currentColor"/>
        </svg>
      )
    }

    const mediaType = getMediaType(shareInfo?.name || '')

    if (mediaType === 'video') {
      return (
        <svg className="share-file-icon video" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor"/>
          <path d="M10 8L16 12L10 16V8Z" fill="white"/>
        </svg>
      )
    }

    if (mediaType === 'image') {
      return (
        <svg className="share-file-icon image" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor"/>
          <circle cx="8.5" cy="8.5" r="1.5" fill="white"/>
          <path d="M21 15L16 10L5 21" stroke="white" strokeWidth="2"/>
        </svg>
      )
    }

    if (mediaType === 'audio') {
      return (
        <svg className="share-file-icon audio" viewBox="0 0 24 24" fill="none">
          <path d="M9 18V5L21 3V16" fill="currentColor"/>
          <circle cx="6" cy="18" r="3" fill="currentColor"/>
          <circle cx="18" cy="16" r="3" fill="currentColor"/>
        </svg>
      )
    }

    return (
      <svg className="share-file-icon file" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" fill="currentColor"/>
        <path d="M14 2V8H20" stroke="white" strokeWidth="1.5"/>
      </svg>
    )
  }

  const handlePreview = () => {
    setShowPreview(true)
  }

  const handleClosePreview = () => {
    setShowPreview(false)
    if (videoRef.current) {
      videoRef.current.pause()
    }
  }

  const handleFullscreen = () => {
    const previewContainer = document.querySelector('.share-preview-overlay')
    if (previewContainer) {
      if (document.fullscreenElement) {
        document.exitFullscreen()
      } else {
        previewContainer.requestFullscreen()
      }
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="share-access-page">
        <div className="share-access-card">
          <div className="share-loading">
            <div className="share-spinner"></div>
            <p>공유 링크를 확인하는 중...</p>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (error && !needsPassword && !needsLogin) {
    return (
      <div className="share-access-page">
        <div className="share-access-card">
          <div className="share-error">
            <svg className="share-error-icon" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 8V12M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <h2>접근할 수 없음</h2>
            <p>{error}</p>
            <button className="share-btn-secondary" onClick={() => navigate('/')}>
              홈으로 이동
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Needs login state
  if (needsLogin) {
    return (
      <div className="share-access-page">
        <div className="share-access-card">
          <div className="share-login-required">
            <svg className="share-lock-icon" viewBox="0 0 24 24" fill="none">
              <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2"/>
              <path d="M8 11V7C8 4.79086 9.79086 3 12 3C14.2091 3 16 4.79086 16 7V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <h2>로그인이 필요합니다</h2>
            <p>이 공유 링크는 로그인한 사용자만 접근할 수 있습니다</p>
            <button className="share-btn-primary" onClick={handleLoginRedirect}>
              로그인하기
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Needs password state
  if (needsPassword) {
    return (
      <div className="share-access-page">
        <div className="share-access-card">
          <div className="share-password-form">
            <svg className="share-lock-icon" viewBox="0 0 24 24" fill="none">
              <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2"/>
              <path d="M8 11V7C8 4.79086 9.79086 3 12 3C14.2091 3 16 4.79086 16 7V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <h2>암호가 필요합니다</h2>
            <p>이 공유 링크는 암호로 보호되어 있습니다</p>
            <form onSubmit={handlePasswordSubmit}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="암호 입력"
                className="share-password-input"
                autoFocus
              />
              {error && <p className="share-password-error">{error}</p>}
              <button type="submit" className="share-btn-primary" disabled={!password}>
                확인
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // Success state - show file info
  if (shareInfo) {
    const mediaType = getMediaType(shareInfo.name)
    const canPreview = mediaType !== 'none' && !shareInfo.isDir

    return (
      <>
        <div className="share-access-page">
          <div className="share-access-card share-success">
            <div className="share-file-preview">
              {getFileIcon()}
            </div>
            <div className="share-file-info">
              <h2 className="share-file-name">{shareInfo.name}</h2>
              <div className="share-file-meta">
                {!shareInfo.isDir && (
                  <span className="share-file-size">{formatFileSize(shareInfo.size)}</span>
                )}
                {shareInfo.isDir && (
                  <span className="share-file-type">폴더</span>
                )}
              </div>
            </div>

            {!shareInfo.isDir && (
              <div className="share-action-buttons">
                {canPreview && (
                  <button
                    className="share-btn-primary share-preview-btn"
                    onClick={handlePreview}
                  >
                    <svg viewBox="0 0 24 24" fill="none" className="share-btn-icon">
                      {mediaType === 'video' ? (
                        <path d="M5 4L19 12L5 20V4Z" fill="currentColor"/>
                      ) : mediaType === 'image' ? (
                        <>
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                          <circle cx="12" cy="12" r="3" fill="currentColor"/>
                        </>
                      ) : (
                        <>
                          <path d="M9 18V5L21 3V16" stroke="currentColor" strokeWidth="2"/>
                          <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2"/>
                          <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2"/>
                        </>
                      )}
                    </svg>
                    {mediaType === 'video' ? '재생' : mediaType === 'image' ? '보기' : '듣기'}
                  </button>
                )}
                <a
                  href={getDownloadUrl()}
                  className="share-btn-secondary share-download-btn"
                  download={shareInfo.name}
                >
                  <svg viewBox="0 0 24 24" fill="none" className="share-btn-icon">
                    <path d="M21 15V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M12 3V15M12 15L7 10M12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  다운로드
                </a>
              </div>
            )}

            {shareInfo.expiresAt && (
              <p className="share-expiry">
                만료: {new Date(shareInfo.expiresAt).toLocaleString('ko-KR')}
              </p>
            )}
          </div>

          <p className="share-branding">SimpleCloudVault로 공유됨</p>
        </div>

        {/* Preview Overlay */}
        {showPreview && canPreview && (
          <div className="share-preview-overlay" onClick={handleClosePreview}>
            <div className="share-preview-header">
              <span className="share-preview-title">{shareInfo.name}</span>
              <div className="share-preview-actions">
                <button className="share-preview-action-btn" onClick={(e) => { e.stopPropagation(); handleFullscreen(); }}>
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M8 3H5C3.89543 3 3 3.89543 3 5V8M21 8V5C21 3.89543 20.1046 3 19 3H16M16 21H19C20.1046 21 21 20.1046 21 19V16M3 16V19C3 20.1046 3.89543 21 5 21H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
                <button className="share-preview-action-btn" onClick={handleClosePreview}>
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
            <div className="share-preview-content" onClick={(e) => e.stopPropagation()}>
              {mediaType === 'video' && (
                <video
                  ref={videoRef}
                  src={getStreamUrl()}
                  controls
                  autoPlay
                  className="share-video-player"
                >
                  브라우저가 비디오 재생을 지원하지 않습니다.
                </video>
              )}
              {mediaType === 'image' && (
                <img
                  src={getStreamUrl()}
                  alt={shareInfo.name}
                  className="share-image-viewer"
                />
              )}
              {mediaType === 'audio' && (
                <div className="share-audio-player-container">
                  <div className="share-audio-icon">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M9 18V5L21 3V16" stroke="currentColor" strokeWidth="2"/>
                      <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2"/>
                      <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  </div>
                  <audio
                    src={getStreamUrl()}
                    controls
                    autoPlay
                    className="share-audio-player"
                  >
                    브라우저가 오디오 재생을 지원하지 않습니다.
                  </audio>
                </div>
              )}
            </div>
          </div>
        )}
      </>
    )
  }

  return null
}

export default ShareAccessPage
