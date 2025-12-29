import { useState, useEffect } from 'react'
import { previewZip, ZipFileEntry, ZipPreviewResponse, extractZip } from '../api/files'
import './ZipViewer.css'

interface ZipViewerProps {
  filePath: string
  fileName: string
  onClose: () => void
  onExtract?: () => void
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function getFileIcon(entry: ZipFileEntry): JSX.Element {
  if (entry.isDir) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
    )
  }

  const ext = entry.name.split('.').pop()?.toLowerCase() || ''

  // Image files
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    )
  }

  // Video files
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M10 9l5 3-5 3V9z" fill="currentColor" />
      </svg>
    )
  }

  // Document files
  if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    )
  }

  // Default file icon
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
  )
}

export default function ZipViewer({ filePath, fileName, onClose, onExtract }: ZipViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [zipData, setZipData] = useState<ZipPreviewResponse | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [sortBy, setSortBy] = useState<'name' | 'size'>('name')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  useEffect(() => {
    const loadZipContents = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await previewZip(filePath)
        setZipData(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load ZIP contents')
      } finally {
        setLoading(false)
      }
    }

    loadZipContents()
  }, [filePath])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleExtract = async () => {
    try {
      setExtracting(true)
      await extractZip(filePath)
      onExtract?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract ZIP file')
    } finally {
      setExtracting(false)
    }
  }

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const newSet = new Set(prev)
      if (newSet.has(path)) {
        newSet.delete(path)
      } else {
        newSet.add(path)
      }
      return newSet
    })
  }

  const getSortedFiles = (files: ZipFileEntry[]): ZipFileEntry[] => {
    return [...files].sort((a, b) => {
      // Directories first
      if (a.isDir !== b.isDir) {
        return a.isDir ? -1 : 1
      }

      let comparison = 0
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name)
      } else {
        comparison = a.size - b.size
      }
      return sortOrder === 'asc' ? comparison : -comparison
    })
  }

  // Build tree structure from flat file list
  const buildTree = (files: ZipFileEntry[]) => {
    const tree: { [key: string]: ZipFileEntry[] } = { '': [] }

    for (const file of files) {
      const parts = file.path.split('/')
      if (parts.length === 1 || (parts.length === 2 && file.isDir)) {
        tree[''].push(file)
      } else {
        const parentPath = parts.slice(0, -1).join('/')
        if (!tree[parentPath]) {
          tree[parentPath] = []
        }
        tree[parentPath].push(file)
      }
    }

    return tree
  }

  const renderFileList = (files: ZipFileEntry[], depth: number = 0) => {
    const tree = buildTree(files)
    const sortedRootFiles = getSortedFiles(tree[''] || [])

    const renderEntry = (entry: ZipFileEntry, level: number): JSX.Element => {
      const children = tree[entry.path.replace(/\/$/, '')] || []
      const hasChildren = children.length > 0
      const isExpanded = expandedDirs.has(entry.path)

      return (
        <div key={entry.path}>
          <div
            className={`zip-entry ${entry.isDir ? 'dir' : 'file'}`}
            style={{ paddingLeft: `${level * 20 + 12}px` }}
            onClick={() => entry.isDir && hasChildren && toggleDir(entry.path)}
          >
            {entry.isDir && hasChildren && (
              <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            )}
            {entry.isDir && !hasChildren && <span className="expand-placeholder" />}
            <span className="zip-entry-icon">{getFileIcon(entry)}</span>
            <span className="zip-entry-name">{entry.name}</span>
            {!entry.isDir && (
              <span className="zip-entry-size">{formatFileSize(entry.size)}</span>
            )}
          </div>
          {entry.isDir && isExpanded && children.length > 0 && (
            <div className="zip-children">
              {getSortedFiles(children).map(child => renderEntry(child, level + 1))}
            </div>
          )}
        </div>
      )
    }

    return sortedRootFiles.map(entry => renderEntry(entry, depth))
  }

  return (
    <div className="zip-viewer-overlay" onClick={onClose}>
      <div className="zip-viewer-container" onClick={e => e.stopPropagation()}>
        <div className="zip-viewer-header">
          <div className="zip-viewer-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 8v13H3V3h12l6 5z" />
              <path d="M14 3v6h6" />
              <path d="M10 12h4M10 15h4M10 18h4" />
            </svg>
            <span>{fileName}</span>
          </div>
          <div className="zip-viewer-actions">
            <button
              className="extract-btn"
              onClick={handleExtract}
              disabled={extracting || loading}
            >
              {extracting ? (
                <>
                  <span className="spinner" />
                  압축 해제 중...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  압축 해제
                </>
              )}
            </button>
            <button className="close-btn" onClick={onClose} title="닫기 (Esc)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {zipData && (
          <div className="zip-viewer-info">
            <span>{zipData.totalFiles}개 항목</span>
            <span className="separator">|</span>
            <span>총 {formatFileSize(zipData.totalSize)}</span>
          </div>
        )}

        <div className="zip-viewer-toolbar">
          <div className="sort-options">
            <button
              className={sortBy === 'name' ? 'active' : ''}
              onClick={() => {
                if (sortBy === 'name') {
                  setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
                } else {
                  setSortBy('name')
                  setSortOrder('asc')
                }
              }}
            >
              이름 {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
            </button>
            <button
              className={sortBy === 'size' ? 'active' : ''}
              onClick={() => {
                if (sortBy === 'size') {
                  setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
                } else {
                  setSortBy('size')
                  setSortOrder('desc')
                }
              }}
            >
              크기 {sortBy === 'size' && (sortOrder === 'asc' ? '↑' : '↓')}
            </button>
          </div>
        </div>

        <div className="zip-viewer-content">
          {loading && (
            <div className="zip-loading">
              <span className="spinner large" />
              <p>ZIP 파일 분석 중...</p>
            </div>
          )}

          {error && (
            <div className="zip-error">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p>{error}</p>
            </div>
          )}

          {!loading && !error && zipData && (
            <div className="zip-file-list">
              {zipData.files.length === 0 ? (
                <div className="zip-empty">
                  <p>압축 파일이 비어있습니다</p>
                </div>
              ) : (
                renderFileList(zipData.files)
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
