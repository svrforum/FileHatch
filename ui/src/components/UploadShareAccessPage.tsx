import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { accessUploadShare, getUploadShareTusUrl, UploadShareInfo } from '../api/fileShares'
import * as tus from 'tus-js-client'
import './UploadShareAccessPage.css'

interface UploadFile {
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'completed' | 'error'
  error?: string
  speed?: number // bytes per second
  uploadInstance?: tus.Upload
}

function UploadShareAccessPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // Extract token from URL path: /u/:token
  const token = location.pathname.split('/u/')[1]?.split('/')[0] || null
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shareInfo, setShareInfo] = useState<UploadShareInfo | null>(null)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  // Upload state
  const [files, setFiles] = useState<UploadFile[]>([])
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadShareInfo = useCallback(async (pwd?: string) => {
    if (!token) return

    try {
      const info = await accessUploadShare(token, pwd)

      // Check if requires password or login
      if ('requiresPassword' in info && info.requiresPassword) {
        setNeedsPassword(true)
        setLoading(false)
        return
      }
      if ('requiresLogin' in info && info.requiresLogin) {
        setNeedsLogin(true)
        setLoading(false)
        return
      }

      setShareInfo(info)
      setNeedsPassword(false)
      setNeedsLogin(false)
      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load share info')
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    loadShareInfo()
  }, [loadShareInfo])

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setVerifying(true)
    setPasswordError(null)

    try {
      await loadShareInfo(password)
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Invalid password')
    } finally {
      setVerifying(false)
    }
  }

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const validateFile = useCallback((file: File): string | null => {
    if (!shareInfo) return 'Share info not loaded'

    // Check for blocked extensions (security)
    const blockedExtensions = ['exe', 'bat', 'cmd', 'sh', 'ps1', 'vbs', 'js']
    const fileExt = file.name.split('.').pop()?.toLowerCase() || ''
    if (blockedExtensions.includes(fileExt)) {
      return `보안상 .${fileExt} 파일은 업로드할 수 없습니다. ZIP으로 압축 후 업로드해주세요.`
    }

    // Check file size
    if (shareInfo.maxFileSize && file.size > shareInfo.maxFileSize) {
      return `File too large (max ${formatBytes(shareInfo.maxFileSize)})`
    }

    // Check remaining size
    if (shareInfo.remainingSize !== undefined && file.size > shareInfo.remainingSize) {
      return `Exceeds remaining space (${formatBytes(shareInfo.remainingSize)} left)`
    }

    // Check allowed extensions
    if (shareInfo.allowedExtensions) {
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      const allowed = shareInfo.allowedExtensions.split(',').map(e => e.trim().toLowerCase())
      if (!allowed.includes(ext)) {
        return `File type not allowed (allowed: ${shareInfo.allowedExtensions})`
      }
    }

    return null
  }, [shareInfo])

  const handleFiles = useCallback((fileList: FileList) => {
    const newFiles: UploadFile[] = []
    for (const file of Array.from(fileList)) {
      const validationError = validateFile(file)
      newFiles.push({
        file,
        progress: 0,
        status: validationError ? 'error' : 'pending',
        error: validationError || undefined
      })
    }
    setFiles(prev => [...prev, ...newFiles])
  }, [validateFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files?.length) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      handleFiles(e.target.files)
    }
  }

  const uploadFile = async (uploadFile: UploadFile, index: number) => {
    if (!token) return

    let lastBytesUploaded = 0
    let lastTime = Date.now()

    const updateFile = (updates: Partial<UploadFile>) => {
      setFiles(prev => prev.map((f, i) =>
        i === index ? { ...f, ...updates } : f
      ))
    }

    updateFile({ progress: 0, status: 'uploading' })

    const upload = new tus.Upload(uploadFile.file, {
      endpoint: getUploadShareTusUrl(token),
      retryDelays: [0, 1000, 3000, 5000],
      metadata: {
        filename: uploadFile.file.name,
        filetype: uploadFile.file.type || 'application/octet-stream',
        shareToken: token,
      },
      onError: (err) => {
        console.error('Upload error:', err)
        updateFile({ progress: 0, status: 'error', error: err.message || 'Upload failed', uploadInstance: undefined })
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const now = Date.now()
        const timeDiff = (now - lastTime) / 1000 // seconds
        const bytesDiff = bytesUploaded - lastBytesUploaded

        let speed = 0
        if (timeDiff > 0.5) { // Update speed every 0.5 seconds
          speed = bytesDiff / timeDiff
          lastBytesUploaded = bytesUploaded
          lastTime = now
        }

        const percentage = Math.round((bytesUploaded / bytesTotal) * 100)
        updateFile({ progress: percentage, speed: speed > 0 ? speed : undefined })
      },
      onSuccess: () => {
        updateFile({ progress: 100, status: 'completed', speed: undefined, uploadInstance: undefined })
        // Reload share info to get updated counts
        loadShareInfo(password || undefined)
      },
    })

    // Store upload instance for cancel functionality
    updateFile({ uploadInstance: upload })
    upload.start()
  }

  const cancelUpload = (index: number) => {
    const file = files[index]
    if (file.uploadInstance) {
      file.uploadInstance.abort()
      setFiles(prev => prev.map((f, i) =>
        i === index ? { ...f, status: 'error', error: '업로드 취소됨', uploadInstance: undefined, speed: undefined } : f
      ))
    }
  }

  const startUpload = () => {
    files.forEach((file, index) => {
      if (file.status === 'pending') {
        uploadFile(file, index)
      }
    })
  }

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond === 0) return '0 B/s'
    const k = 1024
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k))
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const formatExpiry = (dateString: string | undefined) => {
    if (!dateString) return null
    const date = new Date(dateString)
    const diff = date.getTime() - Date.now()
    if (diff < 0) return 'Expired'

    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d left`
    if (hours > 0) return `${hours}h left`
    return 'Expiring soon'
  }

  const pendingCount = files.filter(f => f.status === 'pending').length
  const completedCount = files.filter(f => f.status === 'completed').length
  const hasErrors = files.some(f => f.status === 'error')

  if (loading) {
    return (
      <div className="upload-share-page">
        <div className="upload-share-card">
          <div className="upload-share-loading">
            <div className="upload-share-spinner" />
            <p>Loading...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="upload-share-page">
        <div className="upload-share-card">
          <div className="upload-share-error">
            <svg className="upload-share-error-icon" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <h2>Unable to access</h2>
            <p>{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (needsLogin) {
    return (
      <div className="upload-share-page">
        <div className="upload-share-card">
          <div className="upload-share-login-required">
            <svg className="upload-share-lock-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
            <h2>Login Required</h2>
            <p>Please login to upload files to this folder</p>
            <button
              className="upload-share-btn-primary"
              onClick={() => navigate('/login?redirect=' + encodeURIComponent(window.location.pathname))}
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (needsPassword) {
    return (
      <div className="upload-share-page">
        <div className="upload-share-card">
          <div className="upload-share-password-form">
            <svg className="upload-share-lock-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
            <h2>Password Protected</h2>
            <p>Enter the password to upload files</p>
            <form onSubmit={handlePasswordSubmit}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="upload-share-password-input"
                autoFocus
              />
              {passwordError && <p className="upload-share-password-error">{passwordError}</p>}
              <button
                type="submit"
                className="upload-share-btn-primary"
                disabled={verifying || !password}
              >
                {verifying ? 'Verifying...' : 'Continue'}
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  if (!shareInfo) {
    return null
  }

  return (
    <div className="upload-share-page">
      <div className="upload-share-card upload-share-main">
        {/* Header */}
        <div className="upload-share-header">
          <div className="upload-share-folder-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
          </div>
          <h1>{shareInfo.folderName}</h1>
          <p className="upload-share-subtitle">Upload files to this folder</p>
        </div>

        {/* Restrictions */}
        <div className="upload-share-restrictions">
          {shareInfo.maxFileSize && shareInfo.maxFileSize > 0 && (
            <div className="restriction-badge">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z"/>
              </svg>
              Max: {formatBytes(shareInfo.maxFileSize)}
            </div>
          )}
          {shareInfo.allowedExtensions && (
            <div className="restriction-badge">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              {shareInfo.allowedExtensions}
            </div>
          )}
          {shareInfo.remainingUploads !== undefined && shareInfo.remainingUploads >= 0 && (
            <div className="restriction-badge">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-7v4h4l-5 7z"/>
              </svg>
              {shareInfo.remainingUploads} uploads left
            </div>
          )}
          {shareInfo.remainingSize !== undefined && shareInfo.remainingSize > 0 && (
            <div className="restriction-badge">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm-4 7h20v-4H2v4zm2-3h2v2H4v-2z"/>
              </svg>
              {formatBytes(shareInfo.remainingSize)} remaining
            </div>
          )}
          {shareInfo.expiresAt && (
            <div className="restriction-badge expiry">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
              </svg>
              {formatExpiry(shareInfo.expiresAt)}
            </div>
          )}
        </div>

        {/* Drop zone */}
        <div
          className={`upload-share-dropzone ${dragActive ? 'active' : ''}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <svg className="upload-share-dropzone-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/>
          </svg>
          <p className="upload-share-dropzone-text">
            Drag & drop files here, or click to select
          </p>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="upload-share-file-list">
            {files.map((file, index) => (
              <div key={index} className={`upload-share-file-item ${file.status}`}>
                <div className="file-info">
                  <span className="file-name">{file.file.name}</span>
                  <span className="file-size">{formatBytes(file.file.size)}</span>
                </div>
                <div className="file-status">
                  {file.status === 'pending' && (
                    <button className="remove-btn" onClick={() => removeFile(index)}>
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                      </svg>
                    </button>
                  )}
                  {file.status === 'uploading' && (
                    <div className="upload-progress-container">
                      <div className="progress-wrapper">
                        <div className="progress-bar" style={{ width: `${file.progress}%` }} />
                        <span className="progress-text">{file.progress}%</span>
                      </div>
                      <div className="upload-info">
                        {file.speed && <span className="upload-speed">{formatSpeed(file.speed)}</span>}
                        <button className="cancel-btn" onClick={() => cancelUpload(index)} title="취소">
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                  {file.status === 'completed' && (
                    <svg className="status-icon success" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                  )}
                  {file.status === 'error' && (
                    <div className="error-info">
                      <svg className="status-icon error" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                      </svg>
                      <span className="error-text">{file.error}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        {files.length > 0 && (
          <div className="upload-share-actions">
            <button
              className="upload-share-btn-primary"
              onClick={startUpload}
              disabled={pendingCount === 0 || hasErrors && pendingCount === 0}
            >
              {pendingCount > 0 ? `Upload ${pendingCount} file${pendingCount > 1 ? 's' : ''}` :
               completedCount > 0 ? 'All files uploaded!' : 'No valid files'}
            </button>
            {files.length > 0 && (
              <button
                className="upload-share-btn-secondary"
                onClick={() => setFiles([])}
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Branding */}
        <p className="upload-share-branding">Powered by SimpleCloudVault</p>
      </div>
    </div>
  )
}

export default UploadShareAccessPage
