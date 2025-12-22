import { useState, useEffect, useCallback } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { getFileUrl, getAuthToken, FileInfo } from '../api/files'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import './FileViewer.css'

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

interface FileViewerProps {
  filePath: string
  fileName: string
  mimeType?: string
  onClose: () => void
  // For navigation between files
  siblingFiles?: FileInfo[]
  onNavigate?: (file: FileInfo) => void
}

type ViewerType = 'image' | 'pdf' | 'video' | 'audio' | 'unsupported'

// Get MIME type for video files
function getVideoMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const mimeTypes: Record<string, string> = {
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'ogg': 'video/ogg',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    'm4v': 'video/x-m4v',
  }
  return mimeTypes[ext] || 'video/mp4'
}

// Get MIME type for audio files
function getAudioMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const mimeTypes: Record<string, string> = {
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
    'm4a': 'audio/mp4',
    'aac': 'audio/aac',
  }
  return mimeTypes[ext] || 'audio/mpeg'
}

function getViewerType(fileName: string, mimeType?: string): ViewerType {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''

  // Check by mime type first
  if (mimeType) {
    if (mimeType.startsWith('image/')) return 'image'
    if (mimeType === 'application/pdf') return 'pdf'
    if (mimeType.startsWith('video/')) return 'video'
    if (mimeType.startsWith('audio/')) return 'audio'
  }

  // Fallback to extension
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']
  const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac']

  if (imageExts.includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (videoExts.includes(ext)) return 'video'
  if (audioExts.includes(ext)) return 'audio'

  return 'unsupported'
}

// Check if file is viewable
function isViewableFile(file: FileInfo): boolean {
  const ext = file.extension?.toLowerCase() || ''
  const viewableExts = [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
    'pdf',
    'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v',
    'mp3', 'wav', 'flac', 'm4a', 'aac'
  ]
  return viewableExts.includes(ext)
}

function FileViewer({ filePath, fileName, mimeType, onClose, siblingFiles, onNavigate }: FileViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [numPages, setNumPages] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  const viewerType = getViewerType(fileName, mimeType)
  const fileUrl = getFileUrl(filePath)
  const token = getAuthToken()

  // Get viewable siblings for navigation
  const viewableSiblings = siblingFiles?.filter(f => !f.isDir && isViewableFile(f)) || []
  const currentIndex = viewableSiblings.findIndex(f => f.path === filePath)
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < viewableSiblings.length - 1

  // For PDFs, we need to fetch with auth headers
  const [pdfData, setPdfData] = useState<{ data: ArrayBuffer } | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null)
  // For video/audio, use streaming URL with token query param
  const streamingUrl = token ? `${fileUrl}?token=${encodeURIComponent(token)}` : fileUrl

  // Build subtitle URL
  const subtitleApiUrl = fileUrl.replace('/api/files/', '/api/subtitle/') + (token ? `?token=${encodeURIComponent(token)}` : '')

  useEffect(() => {
    // Reset state when file changes
    setLoading(true)
    setError(null)
    setScale(1)
    setPdfData(null)
    setSubtitleUrl(null)
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setImageUrl(null)

    // For video/audio, use streaming - don't fetch entire file
    if (viewerType === 'video' || viewerType === 'audio') {
      setLoading(false)
      // Check if subtitle exists
      if (viewerType === 'video') {
        fetch(subtitleApiUrl, { method: 'HEAD' })
          .then(res => {
            if (res.ok) {
              setSubtitleUrl(subtitleApiUrl)
            }
          })
          .catch(() => {
            // No subtitle available
          })
      }
      return
    }

    const loadFile = async () => {
      try {
        const response = await fetch(fileUrl, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        })

        if (!response.ok) {
          throw new Error('Failed to load file')
        }

        if (viewerType === 'pdf') {
          const arrayBuffer = await response.arrayBuffer()
          setPdfData({ data: arrayBuffer })
        } else if (viewerType === 'image') {
          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          setImageUrl(url)
        }
        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file')
        setLoading(false)
      }
    }

    loadFile()

    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    }
  }, [fileUrl, token, viewerType])

  const navigatePrev = useCallback(() => {
    if (hasPrev && onNavigate) {
      onNavigate(viewableSiblings[currentIndex - 1])
    }
  }, [hasPrev, onNavigate, viewableSiblings, currentIndex])

  const navigateNext = useCallback(() => {
    if (hasNext && onNavigate) {
      onNavigate(viewableSiblings[currentIndex + 1])
    }
  }, [hasNext, onNavigate, viewableSiblings, currentIndex])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }

    // Image/media navigation with arrow keys
    if (viewerType === 'image' || viewerType === 'video' || viewerType === 'audio') {
      if (e.key === 'ArrowLeft') {
        navigatePrev()
      }
      if (e.key === 'ArrowRight') {
        navigateNext()
      }
    }

    // PDF navigation
    if (viewerType === 'pdf' && numPages) {
      if (e.key === 'ArrowLeft' && currentPage > 1) {
        setCurrentPage(p => p - 1)
      }
      if (e.key === 'ArrowRight' && currentPage < numPages) {
        setCurrentPage(p => p + 1)
      }
    }

    // Zoom
    if (e.key === '+' || e.key === '=') {
      setScale(s => Math.min(s + 0.25, 3))
    }
    if (e.key === '-') {
      setScale(s => Math.max(s - 0.25, 0.25))
    }
  }, [onClose, viewerType, numPages, currentPage, navigatePrev, navigateNext])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
    setLoading(false)
  }

  const handleZoomIn = () => setScale(s => Math.min(s + 0.25, 3))
  const handleZoomOut = () => setScale(s => Math.max(s - 0.25, 0.25))
  const handleZoomReset = () => setScale(1)

  return (
    <div className="file-viewer-overlay" onClick={onClose}>
      <div className="file-viewer-container" onClick={e => e.stopPropagation()}>
        <div className="file-viewer-header">
          <div className="file-viewer-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
              <path d="M21 15L16 10L5 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>{fileName}</span>
            {viewableSiblings.length > 1 && (
              <span className="file-counter">{currentIndex + 1} / {viewableSiblings.length}</span>
            )}
          </div>
          <div className="file-viewer-actions">
            {(viewerType === 'image' || viewerType === 'pdf') && (
              <div className="zoom-controls">
                <button onClick={handleZoomOut} title="축소 (-)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                    <path d="M21 21L16.65 16.65M8 11H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
                <span className="zoom-level">{Math.round(scale * 100)}%</span>
                <button onClick={handleZoomIn} title="확대 (+)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                    <path d="M21 21L16.65 16.65M11 8V14M8 11H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
                <button onClick={handleZoomReset} title="원본 크기">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M15 3H21V9M9 21H3V15M21 3L14 10M3 21L10 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            )}
            {viewerType === 'pdf' && numPages && (
              <div className="page-controls">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <span className="page-info">{currentPage} / {numPages}</span>
                <button onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))} disabled={currentPage >= numPages}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            )}
            <button className="close-btn" onClick={onClose} title="닫기 (Esc)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="file-viewer-content">
          {/* Navigation arrows for images/videos/audio */}
          {viewableSiblings.length > 1 && (viewerType === 'image' || viewerType === 'video' || viewerType === 'audio') && (
            <>
              <button
                className={`nav-arrow nav-prev ${!hasPrev ? 'disabled' : ''}`}
                onClick={(e) => { e.stopPropagation(); navigatePrev(); }}
                disabled={!hasPrev}
                title="이전 (←)"
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                className={`nav-arrow nav-next ${!hasNext ? 'disabled' : ''}`}
                onClick={(e) => { e.stopPropagation(); navigateNext(); }}
                disabled={!hasNext}
                title="다음 (→)"
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </>
          )}

          {loading && (
            <div className="viewer-loading">
              <div className="spinner" />
              <p>로딩 중...</p>
            </div>
          )}

          {error && (
            <div className="viewer-error">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 8V12M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <p>{error}</p>
            </div>
          )}

          {!loading && !error && viewerType === 'image' && imageUrl && (
            <div className="image-container" style={{ transform: `scale(${scale})` }}>
              <img src={imageUrl} alt={fileName} onLoad={() => setLoading(false)} />
            </div>
          )}

          {!error && viewerType === 'pdf' && pdfData && (
            <div className="pdf-container">
              <Document
                file={pdfData}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={() => setError('PDF 로딩 실패')}
                loading={<div className="viewer-loading"><div className="spinner" /></div>}
              >
                <Page
                  pageNumber={currentPage}
                  scale={scale}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                />
              </Document>
            </div>
          )}

          {!loading && !error && viewerType === 'video' && (
            <div className="video-container">
              <video
                controls
                autoPlay
                playsInline
                crossOrigin="anonymous"
                onError={() => setError('비디오를 재생할 수 없습니다')}
              >
                <source src={streamingUrl} type={getVideoMimeType(fileName)} />
                {subtitleUrl && (
                  <track
                    kind="subtitles"
                    src={subtitleUrl}
                    srcLang="ko"
                    label="한국어"
                    default
                  />
                )}
                브라우저가 비디오 재생을 지원하지 않습니다.
              </video>
            </div>
          )}

          {!loading && !error && viewerType === 'audio' && (
            <div className="audio-container">
              <div className="audio-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                  <path d="M9 18V5L21 3V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2"/>
                  <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2"/>
                </svg>
              </div>
              <p className="audio-filename">{fileName}</p>
              <audio
                controls
                autoPlay
                onError={() => setError('오디오를 재생할 수 없습니다')}
              >
                <source src={streamingUrl} type={getAudioMimeType(fileName)} />
                브라우저가 오디오 재생을 지원하지 않습니다.
              </audio>
            </div>
          )}

          {!loading && !error && viewerType === 'unsupported' && (
            <div className="viewer-unsupported">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <p>미리보기를 지원하지 않는 파일 형식입니다.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default FileViewer
