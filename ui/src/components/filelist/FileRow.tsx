// 파일 행 컴포넌트 - 리스트 뷰에서 각 파일/폴더 행을 렌더링

import { FileInfo, formatFileSize } from '../../api/files'
import { SharedFileInfo } from './types'
import ShareOptionsDisplay from './ShareOptionsDisplay'

interface FileRowProps {
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
  getFileIcon: (file: FileInfo) => React.ReactNode
  formatDate: (date: string) => string
  setFocusedIndex: (index: number) => void
  rowRef: (el: HTMLDivElement | null) => void
}

function FileRow({
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
  getFileIcon,
  formatDate,
  setFocusedIndex,
  rowRef,
}: FileRowProps) {
  const sharedFile = file as SharedFileInfo

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
      ref={rowRef}
      className={classNames}
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
        {getFileIcon(file)}
        <span className="file-name">{file.name}</span>
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
      <div className="col-date">{formatDate(file.modTime)}</div>

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
}

export default FileRow
