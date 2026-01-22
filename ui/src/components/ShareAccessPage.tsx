import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { listShareContents, getShareFileDownloadUrl, ShareFileItem } from '../api/fileShares'
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
  shareType?: string
  editable?: boolean
}

interface OnlyOfficeConfig {
  documentType: string
  document: {
    fileType: string
    key: string
    title: string
    url: string
  }
  editorConfig: {
    callbackUrl: string
    user: {
      id: string
      name: string
    }
    lang: string
    mode: string
    customization: {
      autosave: boolean
      forcesave: boolean
    }
  }
}

type MediaType = 'video' | 'image' | 'audio' | 'text' | 'none'

function ShareAccessPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // Extract token from URL path: /s/:token or /e/:token (edit share)
  const isEditShare = location.pathname.startsWith('/e/')
  const token = isEditShare
    ? location.pathname.split('/e/')[1]?.split('/')[0] || null
    : location.pathname.split('/s/')[1]?.split('/')[0] || null
  const { token: authToken } = useAuthStore()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null)
  const [password, setPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [textContent, setTextContent] = useState<string | null>(null)
  const [loadingText, setLoadingText] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [onlyOfficeConfig, setOnlyOfficeConfig] = useState<OnlyOfficeConfig | null>(null)
  const [onlyOfficeAvailable, setOnlyOfficeAvailable] = useState(false)
  const [onlyOfficePublicUrl, setOnlyOfficePublicUrl] = useState('')
  // Folder contents state
  const [folderContents, setFolderContents] = useState<ShareFileItem[]>([])
  const [currentSubpath, setCurrentSubpath] = useState('')
  const [loadingContents, setLoadingContents] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const videoRef = useRef<HTMLVideoElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)

  // Check OnlyOffice availability
  useEffect(() => {
    const checkOnlyOffice = async () => {
      try {
        const response = await fetch('/api/onlyoffice/settings')
        const data = await response.json()
        if (data.available) {
          setOnlyOfficeAvailable(true)
          setOnlyOfficePublicUrl(data.publicUrl)
        }
      } catch {
        console.log('OnlyOffice not available')
      }
    }
    if (isEditShare) {
      checkOnlyOffice()
    }
  }, [isEditShare])

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

      // Use different API path for edit shares
      const apiPath = isEditShare ? `/api/e/${token}` : `/api/s/${token}`
      const response = await fetch(apiPath, {
        method: 'POST',
        headers,
        body: JSON.stringify({ password: pwd || '' }),
      })

      const response_data = await response.json()

      if (response.ok) {
        // API returns { success: true, data: {...} }
        const data = response_data.data || response_data
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
        setError(response_data.error || '공유 링크에 접근할 수 없습니다')
      }
    } catch {
      setError('공유 링크를 불러오는 중 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }, [token, authToken, isEditShare])

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
    const name = filename.toLowerCase()

    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']
    const textExts = [
      'txt', 'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'toml',
      'js', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'less',
      'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb',
      'sh', 'bash', 'zsh', 'sql', 'log', 'ini', 'conf', 'cfg', 'env',
      'dockerfile', 'makefile', 'gitignore', 'editorconfig'
    ]
    // Special files without extension
    const specialTextFiles = ['dockerfile', 'makefile', '.gitignore', '.editorconfig', '.env']

    if (videoExts.includes(ext)) return 'video'
    if (imageExts.includes(ext)) return 'image'
    if (audioExts.includes(ext)) return 'audio'
    if (textExts.includes(ext) || specialTextFiles.includes(name)) return 'text'
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

    if (mediaType === 'text') {
      return (
        <svg className="share-file-icon text" viewBox="0 0 24 24" fill="none">
          <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" fill="currentColor"/>
          <path d="M14 2V8H20" stroke="white" strokeWidth="1.5"/>
          <path d="M8 13H16M8 17H13" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
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

  const handlePreview = async () => {
    setShowPreview(true)

    // Load text content if it's a text file
    if (shareInfo && getMediaType(shareInfo.name) === 'text') {
      setLoadingText(true)
      try {
        const response = await fetch(getDownloadUrl())
        if (response.ok) {
          const text = await response.text()
          setTextContent(text)
        } else {
          setTextContent('파일을 불러올 수 없습니다.')
        }
      } catch {
        setTextContent('파일을 불러오는 중 오류가 발생했습니다.')
      } finally {
        setLoadingText(false)
      }
    }
  }

  const handleClosePreview = () => {
    setShowPreview(false)
    setTextContent(null)
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

  // Open OnlyOffice editor for editable shares
  const handleOpenEditor = async () => {
    if (!token || !onlyOfficeAvailable) return

    try {
      // Fetch OnlyOffice config from the edit share endpoint
      let configUrl = `/api/e/${token}/config`
      if (password) {
        configUrl += `?password=${encodeURIComponent(password)}`
      }

      const response = await fetch(configUrl)
      if (!response.ok) {
        throw new Error('Failed to get editor config')
      }

      const config = await response.json()
      setOnlyOfficeConfig(config)
      setShowEditor(true)
    } catch (err) {
      console.error('Failed to open editor:', err)
      setError('편집기를 열 수 없습니다')
    }
  }

  // Initialize OnlyOffice editor when config is ready
  useEffect(() => {
    if (showEditor && onlyOfficeConfig && onlyOfficePublicUrl && editorRef.current) {
      // Load OnlyOffice Document Server API
      const script = document.createElement('script')
      script.src = `${onlyOfficePublicUrl}/web-apps/apps/api/documents/api.js`
      script.onload = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const DocEditor = (window as any).DocsAPI?.DocEditor
        if (DocEditor && editorRef.current) {
          new DocEditor('share-onlyoffice-editor', onlyOfficeConfig)
        }
      }
      document.head.appendChild(script)

      return () => {
        // Cleanup script when component unmounts
        document.head.removeChild(script)
      }
    }
  }, [showEditor, onlyOfficeConfig, onlyOfficePublicUrl])

  const handleCloseEditor = () => {
    setShowEditor(false)
    setOnlyOfficeConfig(null)
    // Refresh share info to get updated file info
    fetchShareInfo(password)
  }

  // Fetch folder contents when shareInfo is a directory
  const fetchFolderContents = useCallback(async (subpath: string = '') => {
    if (!token || !shareInfo?.isDir) return

    setLoadingContents(true)
    try {
      const contents = await listShareContents(token, subpath, password || undefined)
      if (contents.requiresPassword || contents.requiresLogin) {
        // Handle auth requirements
        return
      }
      setFolderContents(contents.files)
      setCurrentSubpath(subpath)
    } catch (err) {
      console.error('Failed to load folder contents:', err)
    } finally {
      setLoadingContents(false)
    }
  }, [token, shareInfo?.isDir, password])

  // Load folder contents when shareInfo changes
  useEffect(() => {
    if (shareInfo?.isDir) {
      fetchFolderContents('')
    }
  }, [shareInfo?.isDir, fetchFolderContents])

  // Navigate to subfolder
  const handleNavigateFolder = (item: ShareFileItem) => {
    if (item.isDir) {
      fetchFolderContents(item.path)
    }
  }

  // Navigate back to parent folder
  const handleNavigateBack = () => {
    const parts = currentSubpath.split('/').filter(Boolean)
    parts.pop()
    fetchFolderContents(parts.join('/'))
  }

  // Toggle file selection
  const handleToggleSelect = (filepath: string) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev)
      if (newSet.has(filepath)) {
        newSet.delete(filepath)
      } else {
        newSet.add(filepath)
      }
      return newSet
    })
  }

  // Select all files
  const handleSelectAll = () => {
    const allFiles = folderContents.filter(f => !f.isDir).map(f => f.path)
    if (selectedFiles.size === allFiles.length) {
      setSelectedFiles(new Set())
    } else {
      setSelectedFiles(new Set(allFiles))
    }
  }

  // Download selected files (individual downloads)
  const handleDownloadSelected = () => {
    if (!token) return
    selectedFiles.forEach(filepath => {
      const url = getShareFileDownloadUrl(token, filepath, password || undefined)
      const link = document.createElement('a')
      link.href = url
      link.download = filepath.split('/').pop() || filepath
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    })
  }

  // Get file extension
  const getFileExtension = (filename: string): string => {
    return filename.split('.').pop()?.toLowerCase() || ''
  }

  // Get file type icon
  const getItemIcon = (item: ShareFileItem) => {
    if (item.isDir) {
      return (
        <svg className="folder-item-icon folder" viewBox="0 0 24 24" fill="none">
          <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H12L10 5H5C3.89543 5 3 5.89543 3 7Z" fill="currentColor"/>
        </svg>
      )
    }

    const ext = getFileExtension(item.name)
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']

    if (videoExts.includes(ext)) {
      return (
        <svg className="folder-item-icon video" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor"/>
          <path d="M10 8L16 12L10 16V8Z" fill="white"/>
        </svg>
      )
    }

    if (imageExts.includes(ext)) {
      return (
        <svg className="folder-item-icon image" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor"/>
          <circle cx="8.5" cy="8.5" r="1.5" fill="white"/>
          <path d="M21 15L16 10L5 21" stroke="white" strokeWidth="2"/>
        </svg>
      )
    }

    if (audioExts.includes(ext)) {
      return (
        <svg className="folder-item-icon audio" viewBox="0 0 24 24" fill="none">
          <path d="M9 18V5L21 3V16" fill="currentColor"/>
          <circle cx="6" cy="18" r="3" fill="currentColor"/>
          <circle cx="18" cy="16" r="3" fill="currentColor"/>
        </svg>
      )
    }

    return (
      <svg className="folder-item-icon file" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" fill="currentColor"/>
        <path d="M14 2V8H20" stroke="white" strokeWidth="1.5"/>
      </svg>
    )
  }

  // Check if file is editable with OnlyOffice
  const isOnlyOfficeEditable = (filename: string): boolean => {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    const editableExts = ['doc', 'docx', 'odt', 'rtf', 'txt', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'pdf']
    return editableExts.includes(ext)
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
                {/* Edit button for editable shares */}
                {isEditShare && onlyOfficeAvailable && shareInfo.editable && isOnlyOfficeEditable(shareInfo.name) && (
                  <button
                    className="share-btn-primary share-edit-btn"
                    onClick={handleOpenEditor}
                  >
                    <svg viewBox="0 0 24 24" fill="none" className="share-btn-icon">
                      <path d="M11 4H4C3.44772 4 3 4.44772 3 5V20C3 20.5523 3.44772 21 4 21H19C19.5523 21 20 20.5523 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      <path d="M18.5 2.5C18.8978 2.10217 19.4374 1.87868 20 1.87868C20.5626 1.87868 21.1022 2.10217 21.5 2.5C21.8978 2.89782 22.1213 3.43739 22.1213 4C22.1213 4.56261 21.8978 5.10217 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    편집
                  </button>
                )}
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
                      ) : mediaType === 'text' ? (
                        <>
                          <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2"/>
                          <path d="M8 13H16M8 17H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </>
                      ) : (
                        <>
                          <path d="M9 18V5L21 3V16" stroke="currentColor" strokeWidth="2"/>
                          <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2"/>
                          <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2"/>
                        </>
                      )}
                    </svg>
                    {mediaType === 'video' ? '재생' : mediaType === 'image' ? '보기' : mediaType === 'text' ? '보기' : '듣기'}
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

            {/* Folder Contents */}
            {shareInfo.isDir && (
              <div className="share-folder-contents">
                {/* Folder navigation header */}
                <div className="share-folder-header">
                  <div className="share-folder-path">
                    {currentSubpath && (
                      <button className="share-folder-back-btn" onClick={handleNavigateBack}>
                        <svg viewBox="0 0 24 24" fill="none">
                          <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        상위 폴더
                      </button>
                    )}
                    <span className="share-folder-current">
                      {currentSubpath ? `/${currentSubpath}` : '/'}
                    </span>
                  </div>
                  {folderContents.some(f => !f.isDir) && (
                    <div className="share-folder-actions">
                      <button className="share-folder-select-all" onClick={handleSelectAll}>
                        {selectedFiles.size === folderContents.filter(f => !f.isDir).length ? '선택 해제' : '전체 선택'}
                      </button>
                      {selectedFiles.size > 0 && (
                        <button className="share-btn-primary share-download-selected" onClick={handleDownloadSelected}>
                          <svg viewBox="0 0 24 24" fill="none" className="share-btn-icon">
                            <path d="M21 15V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            <path d="M12 3V15M12 15L7 10M12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          {selectedFiles.size}개 다운로드
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* File list */}
                {loadingContents ? (
                  <div className="share-folder-loading">
                    <div className="share-spinner"></div>
                    <p>폴더 내용을 불러오는 중...</p>
                  </div>
                ) : folderContents.length === 0 ? (
                  <div className="share-folder-empty">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H12L10 5H5C3.89543 5 3 5.89543 3 7Z" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                    <p>폴더가 비어 있습니다</p>
                  </div>
                ) : (
                  <div className="share-folder-list">
                    {folderContents.map((item) => (
                      <div
                        key={item.path}
                        className={`share-folder-item ${item.isDir ? 'is-folder' : ''} ${selectedFiles.has(item.path) ? 'selected' : ''}`}
                      >
                        {!item.isDir && (
                          <label className="share-folder-checkbox">
                            <input
                              type="checkbox"
                              checked={selectedFiles.has(item.path)}
                              onChange={() => handleToggleSelect(item.path)}
                            />
                            <span className="checkmark"></span>
                          </label>
                        )}
                        <div
                          className="share-folder-item-content"
                          onClick={() => item.isDir ? handleNavigateFolder(item) : handleToggleSelect(item.path)}
                        >
                          {getItemIcon(item)}
                          <div className="share-folder-item-info">
                            <span className="share-folder-item-name">{item.name}</span>
                            {!item.isDir && (
                              <span className="share-folder-item-size">{formatFileSize(item.size)}</span>
                            )}
                          </div>
                        </div>
                        {!item.isDir && (
                          <a
                            href={getShareFileDownloadUrl(token!, item.path, password || undefined)}
                            className="share-folder-item-download"
                            download={item.name}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <svg viewBox="0 0 24 24" fill="none">
                              <path d="M21 15V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                              <path d="M12 3V15M12 15L7 10M12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Download entire folder */}
                <div className="share-folder-download-all">
                  <a
                    href={getDownloadUrl()}
                    className="share-btn-secondary share-download-all-btn"
                    download={`${shareInfo.name}.zip`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" className="share-btn-icon">
                      <path d="M21 15V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      <path d="M12 3V15M12 15L7 10M12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    전체 폴더 다운로드 (ZIP)
                  </a>
                </div>
              </div>
            )}

            {shareInfo.expiresAt && (
              <p className="share-expiry">
                만료: {new Date(shareInfo.expiresAt).toLocaleString('ko-KR')}
              </p>
            )}
          </div>

          <p className="share-branding">FileHatch로 공유됨</p>
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
              {mediaType === 'text' && (
                <div className="share-text-viewer-container">
                  {loadingText ? (
                    <div className="share-text-loading">
                      <div className="share-spinner"></div>
                      <p>파일을 불러오는 중...</p>
                    </div>
                  ) : (
                    <pre className="share-text-content">{textContent}</pre>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* OnlyOffice Editor Overlay */}
        {showEditor && onlyOfficeConfig && (
          <div className="share-editor-overlay">
            <div className="share-editor-header">
              <span className="share-editor-title">{shareInfo.name}</span>
              <button className="share-editor-close-btn" onClick={handleCloseEditor}>
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                닫기
              </button>
            </div>
            <div className="share-editor-container">
              <div id="share-onlyoffice-editor" ref={editorRef} style={{ width: '100%', height: '100%' }}></div>
            </div>
          </div>
        )}
      </>
    )
  }

  return null
}

export default ShareAccessPage
