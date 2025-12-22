import { useEffect, useRef } from 'react'
import { useUploadStore, UploadItem } from '../stores/uploadStore'
import { formatFileSize } from '../api/files'
import './UploadPanel.css'

// Format speed in human readable format
function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) {
    return `${bytesPerSecond.toFixed(0)} B/s`
  } else if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`
  } else {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
  }
}

function UploadPanel() {
  const { items, isPanelOpen, closePanel, removeUpload, clearCompleted, startUpload, pauseUpload } = useUploadStore()
  const autoCloseTimerRef = useRef<number | null>(null)

  const uploadingCount = items.filter((i) => i.status === 'uploading').length
  const completedCount = items.filter((i) => i.status === 'completed').length
  const pendingCount = items.filter((i) => i.status === 'pending').length
  const errorCount = items.filter((i) => i.status === 'error').length

  // Auto-close panel when all uploads complete (with no errors)
  useEffect(() => {
    if (!isPanelOpen) return

    // Clear any existing timer
    if (autoCloseTimerRef.current) {
      window.clearTimeout(autoCloseTimerRef.current)
      autoCloseTimerRef.current = null
    }

    // Check if all items are completed (no uploading, no pending)
    if (items.length > 0 && uploadingCount === 0 && pendingCount === 0 && errorCount === 0 && completedCount > 0) {
      // Auto-close after 2 seconds
      autoCloseTimerRef.current = window.setTimeout(() => {
        closePanel()
      }, 2000)
    }

    return () => {
      if (autoCloseTimerRef.current) {
        window.clearTimeout(autoCloseTimerRef.current)
      }
    }
  }, [items, uploadingCount, pendingCount, errorCount, completedCount, isPanelOpen, closePanel])

  if (!isPanelOpen) return null

  const getStatusIcon = (item: UploadItem) => {
    switch (item.status) {
      case 'completed':
        return (
          <svg className="status-icon success" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
            <path d="M8 12L11 15L16 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )
      case 'error':
        return (
          <svg className="status-icon error" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
            <path d="M15 9L9 15M9 9L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        )
      case 'uploading':
        return <div className="spinner-small" />
      default:
        return null
    }
  }

  return (
    <div className="upload-panel">
      <div className="upload-panel-header">
        <h3>전송 현황</h3>
        <div className="upload-panel-actions">
          {completedCount > 0 && (
            <button className="panel-action-btn" onClick={clearCompleted}>
              완료 항목 삭제
            </button>
          )}
          <button className="panel-close-btn" onClick={closePanel}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="upload-panel-stats">
        {uploadingCount > 0 && <span className="stat uploading">업로드 중 {uploadingCount}</span>}
        {pendingCount > 0 && <span className="stat pending">대기 {pendingCount}</span>}
        {completedCount > 0 && <span className="stat completed">완료 {completedCount}</span>}
        {items.length === 0 && <span className="stat empty">전송 중인 파일이 없습니다</span>}
      </div>

      <div className="upload-panel-list">
        {items.map((item) => (
          <div key={item.id} className={`upload-panel-item ${item.status}`}>
            <div className="item-info">
              {getStatusIcon(item)}
              <div className="item-details">
                <span className="item-name">{item.file.name}</span>
                <span className="item-size">{formatFileSize(item.file.size)}</span>
              </div>
            </div>
            <div className="item-progress">
              {item.status === 'uploading' && (
                <>
                  <div className="progress-bar-mini">
                    <div className="progress-fill" style={{ width: `${item.progress}%` }} />
                  </div>
                  <div className="progress-info">
                    <span className="progress-text">{item.progress}%</span>
                    {item.uploadSpeed && item.uploadSpeed > 0 && (
                      <span className="speed-text">{formatSpeed(item.uploadSpeed)}</span>
                    )}
                  </div>
                </>
              )}
              {item.status === 'error' && (
                <span className="error-text">{item.error}</span>
              )}
            </div>
            <div className="item-actions">
              {item.status === 'pending' && (
                <button className="item-btn" onClick={() => startUpload(item.id)} title="시작">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M5 3L19 12L5 21V3Z" fill="currentColor"/>
                  </svg>
                </button>
              )}
              {item.status === 'uploading' && (
                <button className="item-btn" onClick={() => pauseUpload(item.id)} title="일시정지">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <rect x="6" y="4" width="4" height="16" fill="currentColor"/>
                    <rect x="14" y="4" width="4" height="16" fill="currentColor"/>
                  </svg>
                </button>
              )}
              {item.status === 'paused' && (
                <button className="item-btn" onClick={() => startUpload(item.id)} title="재개">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M5 3L19 12L5 21V3Z" fill="currentColor"/>
                  </svg>
                </button>
              )}
              <button className="item-btn remove" onClick={() => removeUpload(item.id)} title="삭제">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default UploadPanel
