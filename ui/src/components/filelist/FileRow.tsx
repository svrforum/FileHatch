// 파일 행 컴포넌트 - 리스트 뷰에서 각 파일/폴더 행을 렌더링

import React, { useMemo, useEffect, useState } from 'react'
import { FileInfo, formatFileSize } from '../../api/files'
import { SharedFileInfo } from './types'
import ShareOptionsDisplay from './ShareOptionsDisplay'

// 썸네일을 지원하는 확장자
const THUMBNAIL_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'
])

// 썸네일을 fetch로 가져오는 훅
function useThumbnail(path: string | null, enabled: boolean) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!enabled || !path) return

    let cancelled = false
    // 토큰은 scv-auth에 JSON 형식으로 저장됨
    const authData = localStorage.getItem('scv-auth')
    const token = authData ? JSON.parse(authData).state?.token : null

    const fetchThumbnail = async () => {
      try {
        const pathWithoutSlash = path.startsWith('/') ? path.slice(1) : path
        // 경로의 각 부분을 개별적으로 인코딩 (괄호도 인코딩)
        const encodedPath = pathWithoutSlash.split('/').map(part =>
          encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29')
        ).join('/')
        const url = `/api/thumbnail/${encodedPath}?size=small`

        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })

        if (!response.ok) throw new Error('Failed to fetch thumbnail')

        const blob = await response.blob()
        if (!cancelled) {
          const objectUrl = URL.createObjectURL(blob)
          setBlobUrl(objectUrl)
        }
      } catch {
        if (!cancelled) {
          setError(true)
        }
      }
    }

    fetchThumbnail()

    return () => {
      cancelled = true
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [path, enabled])

  return { blobUrl, error }
}

export interface FileRowProps {
  file: FileInfo
  index: number
  isSelected: boolean
  isFocused: boolean
  isDropTarget: boolean
  isDragging: boolean
  isCut: boolean
  isSharedWithMeView: boolean
  isSharedByMeView: boolean
  isLinkSharesView: boolean
  isStarred?: boolean
  isLocked?: boolean
  lockInfo?: { username: string; lockedAt: string }
  onSelect: (file: FileInfo, e: React.MouseEvent) => void
  onDoubleClick: (file: FileInfo) => void
  onContextMenu: (e: React.MouseEvent, file: FileInfo) => void
  onDragStart: (e: React.DragEvent, file: FileInfo) => void
  onDragEnd: () => void
  onFolderDragOver?: (e: React.DragEvent, folder: FileInfo) => void
  onFolderDragLeave?: (e: React.DragEvent) => void
  onFolderDrop?: (e: React.DragEvent, folder: FileInfo) => void
  onUnshare?: (file: SharedFileInfo) => void
  onCopyLink?: (file: SharedFileInfo) => void
  onDeleteLink?: (file: SharedFileInfo) => void
  onToggleStar?: (file: FileInfo) => void
  getFileIcon: (file: FileInfo) => React.ReactNode
  formatDate: (date: string) => string
  getFullDateTime?: (date: string) => string
  setFocusedIndex: (index: number) => void
}

const FileRow = React.forwardRef<HTMLDivElement, FileRowProps>(({
  file,
  index,
  isSelected,
  isFocused,
  isDropTarget,
  isDragging,
  isCut,
  isSharedWithMeView,
  isSharedByMeView,
  isLinkSharesView,
  isStarred,
  isLocked,
  lockInfo,
  onSelect,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  onUnshare,
  onCopyLink,
  onDeleteLink,
  onToggleStar,
  getFileIcon,
  formatDate,
  getFullDateTime,
  setFocusedIndex,
}, ref) => {
  const sharedFile = file as SharedFileInfo

  // 썸네일 지원 여부 확인
  const hasThumbnail = useMemo(() => {
    if (file.isDir) return false
    const ext = file.extension?.toLowerCase() || ''
    return THUMBNAIL_EXTENSIONS.has(ext)
  }, [file.isDir, file.extension])

  // 썸네일 fetch
  const { blobUrl, error: thumbnailError } = useThumbnail(file.path, hasThumbnail)

  const classNames = [
    'file-row',
    isSelected ? 'selected' : '',
    isFocused ? 'focused' : '',
    isDropTarget ? 'drop-target' : '',
    isDragging ? 'dragging' : '',
    isCut ? 'cut' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      ref={ref}
      className={classNames}
      data-path={file.path}
      onClick={(e) => { onSelect(file, e); setFocusedIndex(index); }}
      onDoubleClick={() => onDoubleClick(file)}
      onContextMenu={(e) => onContextMenu(e, file)}
      draggable
      onDragStart={(e) => onDragStart(e, file)}
      onDragEnd={onDragEnd}
      onDragOver={file.isDir && onFolderDragOver ? (e) => onFolderDragOver(e, file) : undefined}
      onDragLeave={file.isDir && onFolderDragLeave ? onFolderDragLeave : undefined}
      onDrop={file.isDir && onFolderDrop ? (e) => onFolderDrop(e, file) : undefined}
    >
      <div className="col-name">
        {hasThumbnail && !thumbnailError && blobUrl ? (
          <div className="row-thumbnail-wrapper">
            <img
              src={blobUrl}
              alt=""
              className="row-thumbnail"
            />
          </div>
        ) : (
          getFileIcon(file)
        )}
        <span className="file-name">{file.name}</span>
        {/* Lock indicator */}
        {isLocked && (
          <span
            className="lock-indicator"
            title={lockInfo ? `${lockInfo.username}님이 잠금` : '잠김'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2"/>
              <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </span>
        )}
        {/* Star button */}
        {onToggleStar && !file.isDir && (
          <button
            className={`star-btn ${isStarred ? 'starred' : ''}`}
            title={isStarred ? '즐겨찾기 해제' : '즐겨찾기 추가'}
            onClick={(e) => {
              e.stopPropagation()
              onToggleStar(file)
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={isStarred ? 'currentColor' : 'none'}>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Shared with me - show who shared it */}
      {isSharedWithMeView && (
        <div className="col-share-info">
          <span className="shared-with-user">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2"/>
              <path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke="currentColor" strokeWidth="2"/>
            </svg>
            {sharedFile.sharedBy || '알 수 없음'}
          </span>
          <span className={`permission-tag ${sharedFile.permissionLevel === 2 ? 'rw' : 'r'}`}>
            {sharedFile.permissionLevel === 2 ? '읽기/쓰기' : '읽기 전용'}
          </span>
        </div>
      )}

      {/* Shared by me - show who it's shared with */}
      {isSharedByMeView && (
        <div className="col-share-info">
          <span className="shared-with-user">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2"/>
              <path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke="currentColor" strokeWidth="2"/>
            </svg>
            {sharedFile.sharedWith || '알 수 없음'}
          </span>
          <span className={`permission-tag ${sharedFile.permissionLevel === 2 ? 'rw' : 'r'}`}>
            {sharedFile.permissionLevel === 2 ? '읽기/쓰기' : '읽기 전용'}
          </span>
        </div>
      )}

      {/* Link shares - show share options */}
      {isLinkSharesView && (
        <div className="col-share-options">
          <ShareOptionsDisplay file={sharedFile} />
        </div>
      )}

      <div className="col-size">{file.isDir ? '-' : formatFileSize(file.size)}</div>
      <div className="col-date" title={getFullDateTime ? getFullDateTime(file.modTime) : undefined}>
        {formatDate(file.modTime)}
      </div>

      {/* Unshare button for share views */}
      {isSharedByMeView && onUnshare && (
        <div className="col-unshare">
          <button
            className="unshare-btn"
            title="공유 해제"
            onClick={(e) => {
              e.stopPropagation()
              onUnshare(sharedFile)
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}

      {isLinkSharesView && (
        <div className="col-unshare">
          {onCopyLink && (
            <button
              className="copy-link-btn"
              title="링크 복사"
              onClick={(e) => {
                e.stopPropagation()
                onCopyLink(sharedFile)
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
                <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" strokeWidth="2"/>
              </svg>
            </button>
          )}
          {onDeleteLink && (
            <button
              className="unshare-btn"
              title="링크 삭제"
              onClick={(e) => {
                e.stopPropagation()
                onDeleteLink(sharedFile)
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      )}

      <div className="col-actions">
        <button className="action-btn" onClick={(e) => { e.stopPropagation(); onContextMenu(e, file) }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="1" fill="currentColor"/>
            <circle cx="12" cy="5" r="1" fill="currentColor"/>
            <circle cx="12" cy="19" r="1" fill="currentColor"/>
          </svg>
        </button>
      </div>
    </div>
  )
})

FileRow.displayName = 'FileRow'

export default FileRow
