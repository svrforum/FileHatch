import { useCallback, useRef, useState, useEffect } from 'react'
import { useModalKeyboard } from '../hooks/useModalKeyboard'
import { formatFileSize } from '../api/files'
import { useAuthStore } from '../stores/authStore'
import { useUploadStore } from '../stores/uploadStore'
import './UploadModal.css'

interface UploadModalProps {
  isOpen: boolean
  onClose: () => void
  currentPath: string
  onUploadComplete: () => void
}

function UploadModal({ isOpen, onClose, currentPath, onUploadComplete }: UploadModalProps) {
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const { user } = useAuthStore()

  // Use global upload store
  const {
    items,
    duplicateFile,
    addFiles,
    resolveDuplicate,
    removeUpload,
    getPendingCount,
    getUploadingCount,
    getCompletedCount,
    hasActiveUploads,
  } = useUploadStore()

  // Handle file selection
  const handleFilesSelected = useCallback(
    (fileList: FileList | null, isFolder: boolean = false) => {
      if (!fileList || fileList.length === 0) return
      addFiles(Array.from(fileList), currentPath, isFolder)
    },
    [addFiles, currentPath]
  )

  // Drag and drop handlers
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files.length > 0) {
        handleFilesSelected(e.dataTransfer.files, false)
      }
    },
    [handleFilesSelected]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  // Remove file from queue
  const handleRemoveFile = useCallback(
    (id: string) => {
      removeUpload(id)
    },
    [removeUpload]
  )

  // Handle duplicate actions
  const handleDuplicateAction = useCallback(
    (action: 'overwrite' | 'rename' | 'cancel' | 'overwrite_all') => {
      resolveDuplicate(action)
    },
    [resolveDuplicate]
  )

  // Close modal (uploads continue in background)
  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  // Handle keyboard shortcuts
  useModalKeyboard({
    isOpen,
    onCancel: handleClose,
    hasInput: true,
  })

  // Auto-close when all uploads complete
  useEffect(() => {
    if (items.length > 0 && !hasActiveUploads()) {
      const allCompleted = items.every((f) => f.status === 'completed' || f.status === 'error')
      if (allCompleted) {
        const timer = setTimeout(() => {
          onClose()
        }, 1000)
        return () => clearTimeout(timer)
      }
    }
  }, [items, hasActiveUploads, onClose])

  // Notify parent when uploads complete
  useEffect(() => {
    const completedCount = getCompletedCount()
    if (completedCount > 0) {
      onUploadComplete()
    }
  }, [getCompletedCount, onUploadComplete])

  if (!isOpen) return null

  // Check if current path is valid for uploads
  const isAtRoot = currentPath === '/'
  const isHomeWithoutLogin = currentPath.startsWith('/home') && !user
  const canUpload = !isAtRoot && !isHomeWithoutLogin

  const pendingCount = getPendingCount()
  const uploadingCount = getUploadingCount()
  const completedCount = getCompletedCount()

  // Filter items for current path only (for display in modal)
  const currentPathItems = items.filter((item) => item.path.startsWith(currentPath))

  return (
    <>
      <div className="modal-overlay" onClick={handleClose}>
        <div className="modal-content upload-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>파일 업로드</h2>
            <button className="close-btn" onClick={handleClose}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {!canUpload ? (
            <div className="upload-error-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path d="M12 8V12M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
                <path
                  d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="drop-text">파일을 여기에 드래그하세요</p>
              <p className="drop-hint">동시 업로드 3개, 이어올리기 지원</p>
              <div className="upload-buttons">
                <button
                  type="button"
                  className="upload-select-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    fileInputRef.current?.click()
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  파일 선택
                </button>
                <button
                  type="button"
                  className="upload-select-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    folderInputRef.current?.click()
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  폴더 선택
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={(e) => {
                  handleFilesSelected(e.target.files, false)
                  e.target.value = ''
                }}
                style={{ display: 'none' }}
              />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is not in the type definition
                webkitdirectory=""
                onChange={(e) => {
                  handleFilesSelected(e.target.files, true)
                  e.target.value = ''
                }}
                style={{ display: 'none' }}
              />
            </div>
          )}

          {currentPathItems.length > 0 && (
            <>
              <div className="upload-stats">
                <span>대기: {pendingCount}</span>
                <span>업로드 중: {uploadingCount}</span>
                <span>완료: {completedCount}</span>
              </div>

              <div className="file-list">
                {currentPathItems.map((file) => (
                  <div key={file.id} className={`file-item ${file.status}`}>
                    <div className="file-info">
                      <span className="file-name" title={file.relativePath || file.file.name}>
                        {file.relativePath || file.file.name}
                      </span>
                      <span className="file-size">{formatFileSize(file.file.size)}</span>
                    </div>
                    <div className="file-progress">
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${file.progress}%` }} />
                      </div>
                      <span className="progress-text">
                        {file.status === 'duplicate' ? '중복' : file.status === 'error' ? '오류' : `${file.progress}%`}
                      </span>
                    </div>
                    {file.error && <p className="file-error">{file.error}</p>}
                    <button className="remove-btn" onClick={() => handleRemoveFile(file.id)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              <div className="modal-actions">
                <button className="btn-primary" onClick={handleClose}>
                  {hasActiveUploads() ? '백그라운드에서 계속' : '닫기'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Duplicate File Modal */}
      {duplicateFile && (
        <div className="modal-overlay" style={{ zIndex: 1001 }} onClick={() => handleDuplicateAction('cancel')}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon warning">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h3 className="confirm-title">파일이 이미 존재합니다</h3>
            <p className="confirm-message">
              <strong>{duplicateFile.filename}</strong> 파일이 이미 존재합니다.
              <br />
              어떻게 처리할까요?
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
              {pendingCount > 1 && (
                <button className="btn-warning" onClick={() => handleDuplicateAction('overwrite_all')}>
                  모두 덮어쓰기
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default UploadModal
