// 파일 카드 컴포넌트 - 그리드 뷰에서 각 파일/폴더를 렌더링

import React, { useState, useMemo, useEffect } from 'react'
import { FileInfo, formatFileSize } from '../../api/files'

// 썸네일을 지원하는 확장자
const THUMBNAIL_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'
])

// 썸네일을 fetch로 가져오는 훅
function useThumbnail(path: string | null, enabled: boolean) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!enabled || !path) {
      setLoading(false)
      return
    }

    let cancelled = false
    // 토큰은 filehatch-auth에 JSON 형식으로 저장됨
    const authData = localStorage.getItem('filehatch-auth')
    const token = authData ? JSON.parse(authData).state?.token : null

    const fetchThumbnail = async () => {
      try {
        const pathWithoutSlash = path.startsWith('/') ? path.slice(1) : path
        // 경로의 각 부분을 개별적으로 인코딩 (괄호도 인코딩)
        const encodedPath = pathWithoutSlash.split('/').map(part =>
          encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29')
        ).join('/')
        const url = `/api/thumbnail/${encodedPath}?size=medium`

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
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setError(true)
          setLoading(false)
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

  return { blobUrl, loading, error }
}

export interface FileCardProps {
  file: FileInfo
  index: number
  isSelected: boolean
  isFocused: boolean
  isDropTarget: boolean
  isDragging: boolean
  isCut: boolean
  onSelect: (file: FileInfo, e: React.MouseEvent) => void
  onDoubleClick: (file: FileInfo) => void
  onContextMenu: (e: React.MouseEvent, file: FileInfo) => void
  onDragStart: (e: React.DragEvent, file: FileInfo) => void
  onDragEnd: () => void
  onFolderDragOver?: (e: React.DragEvent, folder: FileInfo) => void
  onFolderDragLeave?: (e: React.DragEvent) => void
  onFolderDrop?: (e: React.DragEvent, folder: FileInfo) => void
  getFileIcon: (file: FileInfo) => React.ReactNode
  setFocusedIndex: (index: number) => void
}

const FileCard = React.forwardRef<HTMLDivElement, FileCardProps>(({
  file,
  index,
  isSelected,
  isFocused,
  isDropTarget,
  isDragging,
  isCut,
  onSelect,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  getFileIcon,
  setFocusedIndex,
}, ref) => {
  // 썸네일 지원 여부 확인
  const hasThumbnail = useMemo(() => {
    if (file.isDir) return false
    const ext = file.extension?.toLowerCase() || ''
    return THUMBNAIL_EXTENSIONS.has(ext)
  }, [file.isDir, file.extension])

  // 썸네일 fetch
  const { blobUrl, loading: thumbnailLoading, error: thumbnailError } = useThumbnail(file.path, hasThumbnail)

  const classNames = [
    'file-card',
    isSelected ? 'selected' : '',
    isFocused ? 'focused' : '',
    isDropTarget ? 'drop-target' : '',
    isDragging ? 'dragging' : '',
    isCut ? 'cut' : '',
    hasThumbnail && !thumbnailError ? 'has-thumbnail' : '',
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
      <div className="file-card-icon">
        {hasThumbnail && !thumbnailError && blobUrl ? (
          <div className="file-thumbnail-wrapper">
            <img
              src={blobUrl}
              alt={file.name}
              className="file-thumbnail"
            />
          </div>
        ) : hasThumbnail && thumbnailLoading ? (
          <div className="file-thumbnail-wrapper">
            <div className="thumbnail-placeholder">
              {getFileIcon(file)}
            </div>
          </div>
        ) : (
          getFileIcon(file)
        )}
      </div>
      <div className="file-card-name" title={file.name}>
        {file.name}
      </div>
      <div className="file-card-meta">
        {file.isDir ? '폴더' : formatFileSize(file.size)}
      </div>
    </div>
  )
})

FileCard.displayName = 'FileCard'

export default FileCard
