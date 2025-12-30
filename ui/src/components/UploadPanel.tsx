import { useEffect, useRef } from 'react'
import { useUploadStore, UploadItem } from '../stores/uploadStore'
import { useTransferStore, TransferItem } from '../stores/transferStore'
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
  const { items: transferItems, removeItem: removeTransfer, clearCompleted: clearCompletedTransfers } = useTransferStore()
  const autoCloseTimerRef = useRef<number | null>(null)

  const uploadingCount = items.filter((i) => i.status === 'uploading').length
  const completedCount = items.filter((i) => i.status === 'completed').length
  const pendingCount = items.filter((i) => i.status === 'pending').length
  const errorCount = items.filter((i) => i.status === 'error').length

  // Move/Copy counts
  const transferringCount = transferItems.filter((t) => t.status === 'transferring').length
  const transferPendingCount = transferItems.filter((t) => t.status === 'pending').length
  const transferCompletedCount = transferItems.filter((t) => t.status === 'completed').length
  const transferErrorCount = transferItems.filter((t) => t.status === 'error').length

  const totalActiveCount = uploadingCount + pendingCount + transferringCount + transferPendingCount
  const totalCompletedCount = completedCount + transferCompletedCount
  const totalErrorCount = errorCount + transferErrorCount
  const hasItems = items.length > 0 || transferItems.length > 0

  // Auto-close panel when all uploads complete (with no errors)
  useEffect(() => {
    if (!isPanelOpen) return

    // Clear any existing timer
    if (autoCloseTimerRef.current) {
      window.clearTimeout(autoCloseTimerRef.current)
      autoCloseTimerRef.current = null
    }

    // Check if all items are completed (no uploading, no pending)
    if (hasItems && totalActiveCount === 0 && totalErrorCount === 0 && totalCompletedCount > 0) {
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
  }, [items, transferItems, totalActiveCount, totalCompletedCount, totalErrorCount, hasItems, isPanelOpen, closePanel])

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

  const getTransferStatusIcon = (item: TransferItem) => {
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
      case 'transferring':
        return <div className="spinner-small transfer" />
      default:
        return null
    }
  }

  const getTransferTypeIcon = (type: 'move' | 'copy') => {
    if (type === 'move') {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )
    }
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
        <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" strokeWidth="2"/>
      </svg>
    )
  }

  const handleClearAll = () => {
    clearCompleted()
    clearCompletedTransfers()
  }

  return (
    <div className="upload-panel">
      <div className="upload-panel-header">
        <h3>전송 현황</h3>
        <div className="upload-panel-actions">
          {totalCompletedCount > 0 && (
            <button className="panel-action-btn" onClick={handleClearAll}>
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
        {transferringCount > 0 && <span className="stat transferring">이동/복사 중 {transferringCount}</span>}
        {(pendingCount > 0 || transferPendingCount > 0) && <span className="stat pending">대기 {pendingCount + transferPendingCount}</span>}
        {totalCompletedCount > 0 && <span className="stat completed">완료 {totalCompletedCount}</span>}
        {totalErrorCount > 0 && <span className="stat error">오류 {totalErrorCount}</span>}
        {!hasItems && <span className="stat empty">전송 중인 파일이 없습니다</span>}
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

        {/* Move/Copy transfer items */}
        {transferItems.map((item) => (
          <div key={item.id} className={`upload-panel-item transfer ${item.status} ${item.type}`}>
            <div className="item-info">
              {getTransferStatusIcon(item)}
              <div className="item-details">
                <div className="item-name-row">
                  <span className="transfer-type-icon">{getTransferTypeIcon(item.type)}</span>
                  <span className="item-name">{item.sourceName}</span>
                </div>
                <span className="item-dest">→ {item.destination}</span>
              </div>
            </div>
            <div className="item-progress">
              {item.status === 'transferring' && (
                <>
                  <div className="progress-bar-mini transfer">
                    <div
                      className={`progress-fill ${item.type}`}
                      style={{ width: `${item.progress || 0}%` }}
                    />
                  </div>
                  <div className="progress-info">
                    <span className="progress-text">{item.progress || 0}%</span>
                    {item.bytesPerSec && item.bytesPerSec > 0 && (
                      <span className={`speed-text ${item.type}`}>{formatSpeed(item.bytesPerSec)}</span>
                    )}
                  </div>
                  {item.currentFile && (
                    <span className="current-file">{item.currentFile}</span>
                  )}
                  {item.totalFiles && item.totalFiles > 1 && (
                    <span className="file-count">{item.copiedFiles || 0}/{item.totalFiles}</span>
                  )}
                </>
              )}
              {item.status === 'pending' && (
                <span className="transfer-status pending">대기 중</span>
              )}
              {item.status === 'completed' && item.bytesPerSec && (
                <span className="transfer-complete-info">
                  {formatFileSize(item.totalBytes || 0)} · {formatSpeed(item.bytesPerSec)}
                </span>
              )}
              {item.status === 'error' && (
                <span className="error-text">{item.error}</span>
              )}
            </div>
            <div className="item-actions">
              {item.status === 'transferring' && item.cancel && (
                <button className="item-btn" onClick={item.cancel} title="취소">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
                  </svg>
                </button>
              )}
              <button className="item-btn remove" onClick={() => removeTransfer(item.id)} title="삭제">
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
