import React, { useRef, useEffect, useMemo, memo, useState, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FileInfo, formatFileSize, getAuthToken } from '../api/files'
import './VirtualFileList.css'

// Threshold for enabling virtualization
const VIRTUALIZATION_THRESHOLD = 100

// Row height in pixels
const ROW_HEIGHT = 44

interface VirtualFileListProps {
  files: FileInfo[]
  onFileClick: (file: FileInfo, event: React.MouseEvent) => void
  onFileDoubleClick: (file: FileInfo) => void
  onContextMenu: (file: FileInfo, event: React.MouseEvent) => void
  selectedFiles: Set<string>
  highlightedPath?: string | null
  sortBy: string
  sortOrder: string
  onSort: (field: string) => void
  viewMode?: 'list' | 'grid'
  showThumbnails?: boolean
}

// Memoized row component for better performance
const FileRow = memo(function FileRow({
  file,
  style,
  isSelected,
  isHighlighted,
  onClick,
  onDoubleClick,
  onContextMenu,
  showThumbnail,
}: {
  file: FileInfo
  style: React.CSSProperties
  isSelected: boolean
  isHighlighted: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  showThumbnail: boolean
}) {
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false)
  const [thumbnailError, setThumbnailError] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // Lazy load thumbnail when visible
  useEffect(() => {
    if (!showThumbnail || file.isDir || thumbnailLoaded) return

    const ext = file.extension?.toLowerCase() || ''
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)
    const isVideo = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm'].includes(ext)

    if (!isImage && !isVideo) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && imgRef.current) {
          const token = getAuthToken()
          const cleanPath = file.path.startsWith('/') ? file.path.slice(1) : file.path

          fetch(`/api/thumbnail/${encodeURIComponent(cleanPath)}?size=small`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          })
            .then((res) => {
              if (!res.ok) throw new Error('Failed to load thumbnail')
              return res.blob()
            })
            .then((blob) => {
              if (imgRef.current) {
                imgRef.current.src = URL.createObjectURL(blob)
                setThumbnailLoaded(true)
              }
            })
            .catch(() => setThumbnailError(true))
        }
      },
      { rootMargin: '100px', threshold: 0.1 }
    )

    if (imgRef.current) {
      observer.observe(imgRef.current)
    }

    return () => observer.disconnect()
  }, [showThumbnail, file, thumbnailLoaded])

  const getFileIcon = useCallback(() => {
    if (file.isDir) return '\uD83D\uDCC1'
    const ext = file.extension?.toLowerCase() || ''
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return '\uD83D\uDDBC\uFE0F'
    if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm'].includes(ext)) return '\uD83C\uDFAC'
    if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return '\uD83C\uDFB5'
    if (['pdf'].includes(ext)) return '\uD83D\uDCD5'
    if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return '\uD83D\uDCDD'
    if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return '\uD83D\uDCCA'
    if (['ppt', 'pptx', 'odp'].includes(ext)) return '\uD83D\uDCFD\uFE0F'
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '\uD83D\uDCE6'
    if (['js', 'ts', 'jsx', 'tsx', 'py', 'go', 'java', 'c', 'cpp', 'h', 'rs'].includes(ext)) return '\uD83D\uDCBB'
    if (['html', 'css', 'scss', 'json', 'xml', 'yaml', 'yml'].includes(ext)) return '\uD83C\uDF10'
    if (['txt', 'md', 'log'].includes(ext)) return '\uD83D\uDCC4'
    return '\uD83D\uDCC4'
  }, [file.isDir, file.extension])

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const ext = file.extension?.toLowerCase() || ''
  const isMedia = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm'].includes(ext)

  return (
    <div
      className={`virtual-file-row ${isSelected ? 'selected' : ''} ${isHighlighted ? 'highlighted' : ''}`}
      style={style}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      data-path={file.path}
    >
      <div className="file-icon">
        {showThumbnail && isMedia && !file.isDir && !thumbnailError ? (
          <img
            ref={imgRef}
            className="file-thumbnail"
            alt=""
            style={{ display: thumbnailLoaded ? 'block' : 'none' }}
          />
        ) : null}
        {(!showThumbnail || !isMedia || file.isDir || thumbnailError || !thumbnailLoaded) && (
          <span className="file-icon-emoji">{getFileIcon()}</span>
        )}
      </div>
      <div className="file-name" title={file.name}>
        {file.name}
      </div>
      <div className="file-size">{file.isDir ? '-' : formatFileSize(file.size)}</div>
      <div className="file-date">{formatDate(file.modTime)}</div>
    </div>
  )
})

export default function VirtualFileList({
  files,
  onFileClick,
  onFileDoubleClick,
  onContextMenu,
  selectedFiles,
  highlightedPath,
  sortBy,
  sortOrder,
  onSort,
  showThumbnails = true,
}: VirtualFileListProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  // Use virtualization only for large lists
  const shouldVirtualize = files.length > VIRTUALIZATION_THRESHOLD

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    enabled: shouldVirtualize,
  })

  const virtualItems = useMemo(() => {
    if (!shouldVirtualize) {
      return files.map((file, index) => ({
        index,
        start: index * ROW_HEIGHT,
        size: ROW_HEIGHT,
        key: file.path,
        file,
      }))
    }

    return virtualizer.getVirtualItems().map((item) => ({
      index: item.index,
      start: item.start,
      size: item.size,
      key: item.key,
      file: files[item.index],
    }))
  }, [shouldVirtualize, virtualizer, files])

  const totalHeight = shouldVirtualize
    ? virtualizer.getTotalSize()
    : files.length * ROW_HEIGHT

  // Scroll to highlighted file
  useEffect(() => {
    if (highlightedPath) {
      const index = files.findIndex((f) => f.path === highlightedPath)
      if (index !== -1) {
        if (shouldVirtualize) {
          virtualizer.scrollToIndex(index, { align: 'center' })
        } else if (parentRef.current) {
          const element = parentRef.current.querySelector(`[data-path="${highlightedPath}"]`)
          element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    }
  }, [highlightedPath, files, shouldVirtualize, virtualizer])

  const handleSort = (field: string) => {
    onSort(field)
  }

  const getSortIndicator = (field: string) => {
    if (sortBy !== field) return null
    return sortOrder === 'asc' ? ' \u25B2' : ' \u25BC'
  }

  if (files.length === 0) {
    return (
      <div className="virtual-file-list empty">
        <p>이 폴더는 비어 있습니다.</p>
      </div>
    )
  }

  return (
    <div className="virtual-file-list-container">
      {/* Header */}
      <div className="virtual-file-header">
        <div className="file-icon-header"></div>
        <div className="file-name-header" onClick={() => handleSort('name')}>
          이름{getSortIndicator('name')}
        </div>
        <div className="file-size-header" onClick={() => handleSort('size')}>
          크기{getSortIndicator('size')}
        </div>
        <div className="file-date-header" onClick={() => handleSort('modTime')}>
          수정일{getSortIndicator('modTime')}
        </div>
      </div>

      {/* Virtualized List */}
      <div
        ref={parentRef}
        className="virtual-file-list-scroll"
        style={{ height: '100%', overflow: 'auto' }}
      >
        <div
          style={{
            height: `${totalHeight}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map(({ start, size, file }) => (
            <FileRow
              key={file.path}
              file={file}
              style={{
                position: shouldVirtualize ? 'absolute' : 'relative',
                top: shouldVirtualize ? 0 : undefined,
                left: 0,
                width: '100%',
                height: `${size}px`,
                transform: shouldVirtualize ? `translateY(${start}px)` : undefined,
              }}
              isSelected={selectedFiles.has(file.path)}
              isHighlighted={file.path === highlightedPath}
              onClick={(e) => onFileClick(file, e)}
              onDoubleClick={() => onFileDoubleClick(file)}
              onContextMenu={(e) => onContextMenu(file, e)}
              showThumbnail={showThumbnails}
            />
          ))}
        </div>
      </div>

      {/* Performance indicator */}
      {shouldVirtualize && (
        <div className="virtual-indicator" title="가상 스크롤 활성화됨">
          {files.length}개 항목
        </div>
      )}
    </div>
  )
}

export { VIRTUALIZATION_THRESHOLD, ROW_HEIGHT }
