import { useEffect, useMemo } from 'react'
import { useUploadStore, UploadItem, DownloadItem } from '../stores/uploadStore'
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

// Convert virtual path to URL path for navigation
function virtualPathToUrl(virtualPath: string): string {
  if (virtualPath === '/trash') {
    return '/trash'
  }
  if (virtualPath.startsWith('/shared/')) {
    return `/shared-drive/${virtualPath.substring('/shared/'.length)}`
  }
  if (virtualPath.startsWith('/external/')) {
    return virtualPath
  }
  if (virtualPath.startsWith('/home/')) {
    return `/files/${virtualPath.substring('/home/'.length)}`
  }
  if (virtualPath === '/home') {
    return '/files'
  }
  return '/files'
}

function UploadPanel() {
  const { items, downloads, interruptedUploads, isPanelOpen: uploadPanelOpen, closePanel: closeUploadPanel, removeUpload, clearCompleted, clearCompletedDownloads, removeDownload, startUpload, pauseUpload, loadInterruptedUploads, dismissInterruptedUpload, clearInterruptedUploads } = useUploadStore()
  const { items: transferItems, isPanelOpen: transferPanelOpen, closePanel: closeTransferPanel, removeItem: removeTransfer, clearCompleted: clearCompletedTransfers, retryTransfer, cancelServerJob } = useTransferStore()

  // Panel is open if either upload or transfer panel is open
  const isPanelOpen = uploadPanelOpen || transferPanelOpen

  // Close both panels
  const closePanel = () => {
    closeUploadPanel()
    closeTransferPanel()
  }
  // Memoize all counts in a single pass to avoid 13+ separate .filter() calls per render
  const counts = useMemo(() => {
    let uploading = 0, completed = 0, pending = 0, error = 0
    for (const i of items) {
      if (i.status === 'uploading') uploading++
      else if (i.status === 'completed') completed++
      else if (i.status === 'pending') pending++
      else if (i.status === 'error') error++
    }

    let downloading = 0, dlCompleted = 0, dlError = 0
    for (const d of downloads) {
      if (d.status === 'downloading') downloading++
      else if (d.status === 'completed') dlCompleted++
      else if (d.status === 'error') dlError++
    }

    let transferring = 0, tPending = 0, tCompleted = 0, tError = 0
    let compressing = 0, cPending = 0, cCompleted = 0, cError = 0
    let deleting = 0, dPending = 0, dCompleted = 0, dError = 0
    for (const t of transferItems) {
      const isCompress = t.type === 'compress'
      const isDelete = t.type === 'delete'
      if (t.status === 'transferring') { if (isCompress) compressing++; else if (isDelete) deleting++; else transferring++ }
      else if (t.status === 'pending') { if (isCompress) cPending++; else if (isDelete) dPending++; else tPending++ }
      else if (t.status === 'completed') { if (isCompress) cCompleted++; else if (isDelete) dCompleted++; else tCompleted++ }
      else if (t.status === 'error') { if (isCompress) cError++; else if (isDelete) dError++; else tError++ }
    }

    return {
      uploadingCount: uploading, completedCount: completed, pendingCount: pending, errorCount: error,
      downloadingCount: downloading, downloadCompletedCount: dlCompleted, downloadErrorCount: dlError,
      transferringCount: transferring, transferPendingCount: tPending, transferCompletedCount: tCompleted, transferErrorCount: tError,
      compressingCount: compressing, compressPendingCount: cPending, compressCompletedCount: cCompleted, compressErrorCount: cError,
      deletingCount: deleting, deletePendingCount: dPending, deleteCompletedCount: dCompleted, deleteErrorCount: dError,
      totalActiveCount: uploading + pending + downloading + transferring + tPending + compressing + cPending + deleting + dPending,
      totalCompletedCount: completed + dlCompleted + tCompleted + cCompleted + dCompleted,
      totalErrorCount: error + dlError + tError + cError + dError,
      hasItems: items.length > 0 || downloads.length > 0 || transferItems.length > 0 || interruptedUploads.length > 0,
    }
  }, [items, downloads, transferItems, interruptedUploads])

  const {
    uploadingCount, pendingCount,
    downloadingCount,
    transferringCount, transferPendingCount,
    compressingCount, compressPendingCount,
    deletingCount, deletePendingCount,
    totalActiveCount, totalCompletedCount, totalErrorCount, hasItems,
  } = counts

  // Load interrupted uploads on mount
  useEffect(() => {
    loadInterruptedUploads()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Warn user before page unload if there are active transfers
  useEffect(() => {
    if (totalActiveCount === 0) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [totalActiveCount])

  if (!isPanelOpen) return null

  const getStatusIcon = (item: UploadItem) => {
    switch (item.status) {
      case 'completed':
        return (
          <svg className="status-icon success" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
            <path d="M8 12L11 15L16 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )
      case 'error':
        return (
          <svg className="status-icon error" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
            <path d="M15 9L9 15M9 9L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        )
      case 'uploading':
        return <div className="spinner-small" />
      case 'paused':
        return (
          <div className="paused-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <rect x="9" y="8" width="2" height="8" rx="0.5" fill="currentColor"/>
              <rect x="13" y="8" width="2" height="8" rx="0.5" fill="currentColor"/>
            </svg>
          </div>
        )
      default:
        return null
    }
  }

  const getTransferStatusIcon = (item: TransferItem) => {
    switch (item.status) {
      case 'completed':
        return (
          <svg className="status-icon success" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
            <path d="M8 12L11 15L16 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )
      case 'error':
        return (
          <svg className="status-icon error" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
            <path d="M15 9L9 15M9 9L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        )
      case 'transferring':
        return <div className={`spinner-small ${item.type === 'compress' ? 'compress' : item.type === 'delete' ? 'delete' : 'transfer'}`} />
      default:
        return null
    }
  }

  const getTransferTypeIcon = (type: 'move' | 'copy' | 'compress' | 'delete') => {
    if (type === 'delete') {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )
    }
    if (type === 'move') {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )
    }
    if (type === 'compress') {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 3V9M12 9L15 6M12 9L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 21V15M12 15L15 18M12 15L9 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <rect x="4" y="9" width="16" height="6" rx="1" stroke="currentColor" strokeWidth="2"/>
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

  const getDownloadStatusIcon = (item: DownloadItem) => {
    switch (item.status) {
      case 'completed':
        return (
          <svg className="status-icon success" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
            <path d="M8 12L11 15L16 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )
      case 'error':
        return (
          <svg className="status-icon error" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
            <path d="M15 9L9 15M9 9L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        )
      case 'downloading':
        return <div className="spinner-small download" />
      default:
        return null
    }
  }

  const handleClearAll = () => {
    clearCompleted()
    clearCompletedDownloads()
    clearCompletedTransfers()
    clearInterruptedUploads()
  }

  return (
    <div className="upload-panel-overlay" onClick={closePanel}>
      <div className="upload-panel" onClick={(e) => e.stopPropagation()}>
        <div className="upload-panel-header">
        <h3>전송 현황</h3>
        <div className="upload-panel-actions">
          {totalCompletedCount > 0 && (
            <button className="panel-action-btn" onClick={handleClearAll}>
              완료 항목 삭제
            </button>
          )}
          <button
            className="panel-close-btn"
            onClick={closePanel}
            title="닫기"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="upload-panel-stats">
        {uploadingCount > 0 && <span className="stat uploading">업로드 중 {uploadingCount}</span>}
        {downloadingCount > 0 && <span className="stat downloading">다운로드 중 {downloadingCount}</span>}
        {transferringCount > 0 && <span className="stat transferring">이동/복사 중 {transferringCount}</span>}
        {compressingCount > 0 && <span className="stat compressing">압축 중 {compressingCount}</span>}
        {deletingCount > 0 && <span className="stat deleting">삭제 중 {deletingCount}</span>}
        {(pendingCount > 0 || transferPendingCount > 0 || compressPendingCount > 0 || deletePendingCount > 0) && <span className="stat pending">대기 {pendingCount + transferPendingCount + compressPendingCount + deletePendingCount}</span>}
        {totalCompletedCount > 0 && <span className="stat completed">완료 {totalCompletedCount}</span>}
        {totalErrorCount > 0 && <span className="stat error">오류 {totalErrorCount}</span>}
        {!hasItems && <span className="stat empty">전송 중인 파일이 없습니다</span>}
      </div>

      <div className="upload-panel-list">
        {!hasItems && (
          <div className="upload-panel-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>진행 중인 전송이 없습니다</span>
          </div>
        )}
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
              {item.status === 'paused' && (
                <>
                  <div className="progress-bar-mini paused">
                    <div className="progress-fill paused" style={{ width: `${item.progress}%` }} />
                  </div>
                  <div className="progress-info">
                    <span className="progress-text paused">{item.progress}% 일시정지</span>
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

        {/* Interrupted uploads (resumable) */}
        {interruptedUploads.map((item) => (
          <div key={item.fingerprint} className="upload-panel-item paused">
            <div className="item-info">
              <div className="paused-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                  <path d="M12 8V12M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="item-details">
                <span className="item-name">{item.filename}</span>
                <span className="item-size">{formatFileSize(item.size)} · {item.path}</span>
              </div>
            </div>
            <div className="item-progress">
              <div className="progress-bar-mini paused">
                <div className="progress-fill paused" style={{ width: `${item.progress}%` }} />
              </div>
              <div className="progress-info">
                <span className="progress-text paused">{item.progress}% 중단됨 · 파일을 다시 추가하면 이어받기</span>
              </div>
            </div>
            <div className="item-actions">
              <button className="item-btn remove" onClick={() => dismissInterruptedUpload(item.fingerprint)} title="삭제">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          </div>
        ))}

        {/* Download items */}
        {downloads.map((item) => (
          <div key={item.id} className={`upload-panel-item download ${item.status}`}>
            <div className="item-info">
              {getDownloadStatusIcon(item)}
              <div className="item-details">
                <div className="item-name-row">
                  <span className="download-type-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M12 3V15M12 15L7 10M12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M3 17V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                  <span className="item-name">{item.filename}</span>
                </div>
                <span className="item-size">{formatFileSize(item.size)}</span>
              </div>
            </div>
            <div className="item-progress">
              {item.status === 'downloading' && (
                <>
                  <div className="progress-bar-mini download">
                    <div className="progress-fill download" style={{ width: `${item.progress}%` }} />
                  </div>
                  <div className="progress-info">
                    <span className="progress-text">{item.progress}%</span>
                  </div>
                </>
              )}
              {item.status === 'error' && (
                <span className="error-text">{item.error}</span>
              )}
            </div>
            <div className="item-actions">
              {item.status === 'downloading' && (
                <button className="item-btn" onClick={() => removeDownload(item.id)} title="취소">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
                  </svg>
                </button>
              )}
              <button className="item-btn remove" onClick={() => removeDownload(item.id)} title="삭제">
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
                  {item.isServerSide && <span className="server-badge">서버</span>}
                </div>
                {item.type === 'compress' ? (
                  <span className="item-dest">→ {item.outputName || '압축 파일'}</span>
                ) : (
                  <span className="item-dest">→ {item.destination}</span>
                )}
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
                  {item.totalFiles && item.totalFiles > 0 && (item.totalFiles > 1 || item.type === 'delete') && (
                    <span className="file-count">
                      {item.copiedFiles || 0}/{item.totalFiles}
                      {item.type === 'delete' && ' 삭제됨'}
                    </span>
                  )}
                </>
              )}
              {item.status === 'pending' && (
                <span className="transfer-status pending">대기 중</span>
              )}
              {item.status === 'completed' && item.bytesPerSec && (
                <span className="transfer-complete-info">
                  {item.type === 'compress' && item.outputSize
                    ? formatFileSize(item.outputSize)
                    : formatFileSize(item.totalBytes || 0)} · {formatSpeed(item.bytesPerSec)}
                </span>
              )}
              {item.status === 'error' && (
                <span className="error-text">{item.error}</span>
              )}
            </div>
            <div className="item-actions">
              {item.status === 'completed' && item.type !== 'compress' && (
                <button
                  className="item-btn goto"
                  onClick={() => { closePanel(); window.location.href = virtualPathToUrl(item.destination) }}
                  title="폴더로 이동"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H13L11 5H5C3.89543 5 3 5.89543 3 7Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
              {item.status === 'error' && (
                <button className="item-btn retry" onClick={() => retryTransfer(item.id)} title="다시 시도">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M1 4V10H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M3.51 15C4.15839 16.8404 5.38734 18.4202 7.01166 19.5014C8.63598 20.5826 10.5677 21.1066 12.5157 20.9945C14.4637 20.8824 16.3226 20.1402 17.8121 18.8798C19.3017 17.6193 20.3413 15.9090 20.7742 14.0064C21.2072 12.1037 21.0101 10.1139 20.2126 8.33122C19.4152 6.54852 18.0605 5.06985 16.3528 4.12C14.6451 3.17016 12.6769 2.80079 10.7386 3.06684C8.80028 3.33289 7.00147 4.22006 5.64 5.59999L1 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
              {item.status === 'transferring' && (item.cancel || item.isServerSide) && (
                <button className="item-btn" onClick={() => item.isServerSide ? cancelServerJob(item.id) : item.cancel?.()} title="취소">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
                  </svg>
                </button>
              )}
              {item.status !== 'transferring' && (
                <button className="item-btn remove" onClick={() => removeTransfer(item.id)} title="삭제">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  )
}

export default UploadPanel
