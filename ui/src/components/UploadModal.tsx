import { useState, useCallback, useRef, useEffect } from 'react'
import * as tus from 'tus-js-client'
import { formatFileSize, checkFileExists } from '../api/files'
import { useAuthStore } from '../stores/authStore'
import './UploadModal.css'

// Helper to get auth token
function getAuthToken(): string | null {
  const stored = localStorage.getItem('scv-auth')
  if (stored) {
    try {
      const { state } = JSON.parse(stored)
      return state?.token || null
    } catch {
      return null
    }
  }
  return null
}

// No-op URL storage to prevent caching of internal URLs
const noopUrlStorage: tus.UrlStorage = {
  findAllUploads: async () => [],
  findUploadsByFingerprint: async () => [],
  removeUpload: async () => {},
  addUpload: async () => '',
}

interface UploadFile {
  id: string
  file: File
  relativePath: string // For folder uploads, stores the relative path
  progress: number
  status: 'pending' | 'uploading' | 'completed' | 'error' | 'duplicate'
  error?: string
  upload?: tus.Upload
  overwrite?: boolean
}

interface DuplicateInfo {
  fileId: string
  filename: string
}

interface UploadModalProps {
  isOpen: boolean
  onClose: () => void
  currentPath: string
  onUploadComplete: () => void
}

function UploadModal({ isOpen, onClose, currentPath, onUploadComplete }: UploadModalProps) {
  const [files, setFiles] = useState<UploadFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const { user } = useAuthStore()

  const addFiles = useCallback((newFiles: FileList | File[], isFolder: boolean = false) => {
    const fileArray = Array.from(newFiles)
    const uploadFiles: UploadFile[] = fileArray
      .filter((file) => file.size > 0) // Filter out empty directory entries
      .map((file) => {
        // Get relative path from webkitRelativePath or default to filename
        let relativePath = ''
        if (isFolder && 'webkitRelativePath' in file && file.webkitRelativePath) {
          // webkitRelativePath includes the folder name, e.g., "myFolder/subfolder/file.txt"
          relativePath = file.webkitRelativePath
        }
        return {
          id: `${relativePath || file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          relativePath,
          progress: 0,
          status: 'pending' as const,
        }
      })
    setFiles((prev) => [...prev, ...uploadFiles])
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files)
      }
    },
    [addFiles]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const doUpload = useCallback(
    (uploadFile: UploadFile, overwrite: boolean) => {
      // Calculate the target path including any folder structure from relative path
      let targetPath = currentPath
      if (uploadFile.relativePath) {
        // Get the directory part of the relative path (exclude filename)
        const pathParts = uploadFile.relativePath.split('/')
        pathParts.pop() // Remove filename
        if (pathParts.length > 0) {
          const relativeDirPath = pathParts.join('/')
          targetPath = currentPath === '/'
            ? '/' + relativeDirPath
            : currentPath + '/' + relativeDirPath
        }
      }

      const token = getAuthToken()
      const upload = new tus.Upload(uploadFile.file, {
        endpoint: `${window.location.origin}/api/upload/`,
        retryDelays: [0, 1000, 3000, 5000],
        removeFingerprintOnSuccess: true,
        urlStorage: noopUrlStorage,
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        metadata: {
          filename: uploadFile.file.name,
          filetype: uploadFile.file.type,
          path: targetPath,
          username: user?.username || '',
          overwrite: overwrite ? 'true' : 'false',
        },
        onError: (error) => {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === uploadFile.id
                ? { ...f, status: 'error', error: error.message }
                : f
            )
          )
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const progress = Math.round((bytesUploaded / bytesTotal) * 100)
          setFiles((prev) =>
            prev.map((f) =>
              f.id === uploadFile.id ? { ...f, progress, status: 'uploading' } : f
            )
          )
        },
        onSuccess: () => {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === uploadFile.id ? { ...f, progress: 100, status: 'completed' } : f
            )
          )
          onUploadComplete()
        },
      })

      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadFile.id ? { ...f, upload, status: 'uploading' } : f
        )
      )

      upload.start()
    },
    [currentPath, onUploadComplete]
  )

  const checkAndUpload = useCallback(
    async (uploadFile: UploadFile) => {
      try {
        // Calculate the target path including any folder structure from relative path
        let targetPath = currentPath
        if (uploadFile.relativePath) {
          const pathParts = uploadFile.relativePath.split('/')
          pathParts.pop() // Remove filename
          if (pathParts.length > 0) {
            const relativeDirPath = pathParts.join('/')
            targetPath = currentPath === '/'
              ? '/' + relativeDirPath
              : currentPath + '/' + relativeDirPath
          }
        }

        const result = await checkFileExists(targetPath, uploadFile.file.name)
        if (result.exists) {
          // Show duplicate modal
          setDuplicateInfo({ fileId: uploadFile.id, filename: uploadFile.relativePath || uploadFile.file.name })
          setFiles((prev) =>
            prev.map((f) =>
              f.id === uploadFile.id ? { ...f, status: 'duplicate' } : f
            )
          )
        } else {
          // No duplicate, upload directly
          doUpload(uploadFile, false)
        }
      } catch {
        // If check fails, just upload (backend will handle duplicates)
        doUpload(uploadFile, false)
      }
    },
    [currentPath, doUpload]
  )

  const handleDuplicateAction = useCallback(
    (action: 'overwrite' | 'rename' | 'cancel') => {
      if (!duplicateInfo) return

      const file = files.find((f) => f.id === duplicateInfo.fileId)
      if (!file) {
        setDuplicateInfo(null)
        return
      }

      if (action === 'overwrite') {
        doUpload(file, true)
      } else if (action === 'rename') {
        doUpload(file, false)
      } else {
        // Cancel - remove the file
        setFiles((prev) => prev.filter((f) => f.id !== duplicateInfo.fileId))
      }

      setDuplicateInfo(null)

      // Continue with next pending file
      setTimeout(() => {
        const nextPending = files.find(
          (f) => f.status === 'pending' && f.id !== duplicateInfo.fileId
        )
        if (nextPending) {
          checkAndUpload(nextPending)
        }
      }, 100)
    },
    [duplicateInfo, files, doUpload, checkAndUpload]
  )

  const startAllUploads = useCallback(async () => {
    const pendingFiles = files.filter((f) => f.status === 'pending')
    if (pendingFiles.length === 0) return

    // Start with the first pending file
    checkAndUpload(pendingFiles[0])
  }, [files, checkAndUpload])

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => {
      const file = prev.find((f) => f.id === id)
      if (file?.upload && file.status === 'uploading') {
        file.upload.abort()
      }
      return prev.filter((f) => f.id !== id)
    })
  }, [])

  const handleClose = useCallback(() => {
    // Abort all ongoing uploads
    files.forEach((f) => {
      if (f.upload && f.status === 'uploading') {
        f.upload.abort()
      }
    })
    setFiles([])
    setDuplicateInfo(null)
    onClose()
  }, [files, onClose])

  // Auto-close when all uploads are completed
  useEffect(() => {
    if (files.length > 0) {
      const allCompleted = files.every((f) => f.status === 'completed')
      const hasUploading = files.some((f) => f.status === 'uploading')

      if (allCompleted && !hasUploading) {
        // Wait a moment to show completion status, then close
        const timer = setTimeout(() => {
          setFiles([])
          onClose()
        }, 1000)
        return () => clearTimeout(timer)
      }
    }
  }, [files, onClose])

  // Continue uploading when duplicate is resolved
  useEffect(() => {
    if (!duplicateInfo && files.length > 0) {
      const nextPending = files.find((f) => f.status === 'pending')
      if (nextPending) {
        const hasUploading = files.some((f) => f.status === 'uploading')
        if (!hasUploading) {
          checkAndUpload(nextPending)
        }
      }
    }
  }, [duplicateInfo, files, checkAndUpload])

  if (!isOpen) return null

  // Check if current path is valid for uploads
  const isAtRoot = currentPath === '/'
  const isHomeWithoutLogin = currentPath.startsWith('/home') && !user
  const canUpload = !isAtRoot && !isHomeWithoutLogin

  const pendingCount = files.filter((f) => f.status === 'pending' || f.status === 'duplicate').length
  const uploadingCount = files.filter((f) => f.status === 'uploading').length
  const completedCount = files.filter((f) => f.status === 'completed').length

  return (
    <>
      <div className="modal-overlay" onClick={handleClose}>
        <div className="modal-content upload-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>파일 업로드</h2>
            <button className="close-btn" onClick={handleClose}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {!canUpload ? (
            <div className="upload-error-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 8V12M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              {isAtRoot ? (
                <>
                  <p className="error-title">폴더를 선택해주세요</p>
                  <p className="error-hint">홈(/) 에서는 업로드할 수 없습니다. 내 파일 또는 공유 폴더로 이동해주세요.</p>
                </>
              ) : (
                <>
                  <p className="error-title">로그인이 필요합니다</p>
                  <p className="error-hint">내 파일에 업로드하려면 로그인해주세요.</p>
                </>
              )}
            </div>
          ) : (
            <div
              className={`drop-zone ${isDragging ? 'dragging' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <p className="drop-text">파일을 여기에 드래그하세요</p>
              <p className="drop-hint">이어올리기를 지원합니다</p>
              <div className="upload-buttons">
                <button
                  type="button"
                  className="upload-select-btn"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  파일 선택
                </button>
                <button
                  type="button"
                  className="upload-select-btn"
                  onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click() }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  폴더 선택
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={(e) => { e.target.files && addFiles(e.target.files, false); e.target.value = '' }}
                style={{ display: 'none' }}
              />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is not in the type definition
                webkitdirectory=""
                onChange={(e) => { e.target.files && addFiles(e.target.files, true); e.target.value = '' }}
                style={{ display: 'none' }}
              />
            </div>
          )}

          {files.length > 0 && (
            <>
              <div className="upload-stats">
                <span>대기: {pendingCount}</span>
                <span>업로드 중: {uploadingCount}</span>
                <span>완료: {completedCount}</span>
              </div>

              <div className="file-list">
                {files.map((file) => (
                  <div key={file.id} className={`file-item ${file.status}`}>
                    <div className="file-info">
                      <span className="file-name" title={file.relativePath || file.file.name}>
                        {file.relativePath || file.file.name}
                      </span>
                      <span className="file-size">{formatFileSize(file.file.size)}</span>
                    </div>
                    <div className="file-progress">
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{ width: `${file.progress}%` }}
                        />
                      </div>
                      <span className="progress-text">
                        {file.status === 'duplicate' ? '중복' : `${file.progress}%`}
                      </span>
                    </div>
                    {file.error && <p className="file-error">{file.error}</p>}
                    <button
                      className="remove-btn"
                      onClick={() => removeFile(file.id)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              <div className="modal-actions">
                <button className="btn-secondary" onClick={handleClose}>
                  취소
                </button>
                <button
                  className="btn-primary"
                  onClick={startAllUploads}
                  disabled={pendingCount === 0 || uploadingCount > 0}
                >
                  업로드 시작 ({pendingCount})
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Duplicate File Modal */}
      {duplicateInfo && (
        <div className="modal-overlay" style={{ zIndex: 1001 }} onClick={() => handleDuplicateAction('cancel')}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon warning">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="confirm-title">파일이 이미 존재합니다</h3>
            <p className="confirm-message">
              <strong>{duplicateInfo.filename}</strong> 파일이 이미 존재합니다.
              <br />어떻게 처리할까요?
            </p>
            <div className="confirm-actions duplicate-actions">
              <button className="btn-secondary" onClick={() => handleDuplicateAction('cancel')}>
                취소
              </button>
              <button className="btn-primary" onClick={() => handleDuplicateAction('rename')}>
                이름 변경 [1]
              </button>
              <button className="btn-danger" onClick={() => handleDuplicateAction('overwrite')}>
                덮어쓰기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default UploadModal
