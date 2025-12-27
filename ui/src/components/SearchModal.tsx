import { useState, useEffect, useCallback, useRef } from 'react'
import { searchFiles, FileInfo, formatFileSize, MatchType } from '../api/files'
import './SearchModal.css'

interface SearchModalProps {
  isOpen: boolean
  onClose: () => void
  initialQuery: string
  onNavigate?: (path: string) => void
  onFileSelect?: (filePath: string, parentPath: string) => void
}

type TabType = 'all' | 'name' | 'tag' | 'description'

const TABS: { key: TabType; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'name', label: '파일명' },
  { key: 'description', label: '설명' },
  { key: 'tag', label: '태그' },
]

function SearchModal({ isOpen, onClose, initialQuery, onNavigate, onFileSelect }: SearchModalProps) {
  const [query, setQuery] = useState(initialQuery)
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [results, setResults] = useState<FileInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery(initialQuery)
      setActiveTab('all')
      setResults([])
      setPage(1)
      setHasMore(false)
      setTotal(0)
      // Focus input after a short delay
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen, initialQuery])

  // Search when query or tab changes
  useEffect(() => {
    if (!isOpen || !query.trim()) {
      setResults([])
      setTotal(0)
      setHasMore(false)
      return
    }

    const doSearch = async () => {
      setIsLoading(true)
      setPage(1)
      try {
        const response = await searchFiles(query, {
          page: 1,
          limit: 20,
          matchType: activeTab as MatchType,
        })
        setResults(response.results || [])
        setTotal(response.total)
        setHasMore(response.hasMore)
        setPage(1)
      } catch {
        setResults([])
        setTotal(0)
        setHasMore(false)
      } finally {
        setIsLoading(false)
      }
    }

    const debounce = setTimeout(doSearch, 300)
    return () => clearTimeout(debounce)
  }, [isOpen, query, activeTab])

  // Load more for infinite scroll
  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore || !query.trim()) return

    setIsLoading(true)
    try {
      const nextPage = page + 1
      const response = await searchFiles(query, {
        page: nextPage,
        limit: 20,
        matchType: activeTab as MatchType,
      })
      setResults(prev => [...prev, ...(response.results || [])])
      setHasMore(response.hasMore)
      setPage(nextPage)
    } catch {
      // Ignore errors on load more
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, hasMore, query, page, activeTab])

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    observerRef.current = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          loadMore()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current)
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [hasMore, isLoading, loadMore])

  // Handle result click
  const handleResultClick = useCallback((file: FileInfo) => {
    const parentPath = file.path.split('/').slice(0, -1).join('/') || '/'

    if (file.isDir) {
      onNavigate?.(file.path)
    } else if (onFileSelect) {
      onFileSelect(file.path, parentPath)
    } else if (onNavigate) {
      onNavigate(parentPath)
    }

    onClose()
  }, [onNavigate, onFileSelect, onClose])

  // Handle key events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  if (!isOpen) return null

  return (
    <div className="search-modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="search-modal" onClick={e => e.stopPropagation()}>
        <div className="search-modal-header">
          <div className="search-modal-input-wrapper">
            <svg className="search-modal-icon" width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
              <path d="M20 20L16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <input
              ref={inputRef}
              type="text"
              className="search-modal-input"
              placeholder="파일, 태그, 설명 검색..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && onClose()}
            />
            {query && (
              <button className="search-modal-clear" onClick={() => setQuery('')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
          <button className="search-modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="search-modal-tabs">
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`search-modal-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              {activeTab === tab.key && total > 0 && (
                <span className="tab-count">{total}</span>
              )}
            </button>
          ))}
        </div>

        <div className="search-modal-results">
          {!query.trim() ? (
            <div className="search-modal-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M20 20L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <p>검색어를 입력하세요</p>
            </div>
          ) : results.length === 0 && !isLoading ? (
            <div className="search-modal-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <p>검색 결과가 없습니다</p>
            </div>
          ) : (
            <>
              {results.map((file, index) => (
                <div
                  key={`${file.path}-${index}`}
                  className="search-modal-item"
                  onClick={() => handleResultClick(file)}
                >
                  <div className="search-item-icon">
                    {file.isDir ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" fill="#3182F6"/>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                    )}
                  </div>
                  <div className="search-item-content">
                    <div className="search-item-name-row">
                      <span className="search-item-name">{file.name}</span>
                      {file.matchType && file.matchType !== 'name' && (
                        <span className={`search-item-badge ${file.matchType}`}>
                          {file.matchType === 'tag' ? `#${file.matchedTag || '태그'}` : '설명'}
                        </span>
                      )}
                    </div>
                    <span className="search-item-path">{file.path}</span>
                    {file.matchType === 'description' && file.description && (
                      <span className="search-item-description">{file.description}</span>
                    )}
                    {file.matchType === 'tag' && file.tags && file.tags.length > 0 && (
                      <div className="search-item-tags">
                        {file.tags.slice(0, 5).map((tag, i) => (
                          <span key={i} className="search-item-tag">#{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="search-item-meta">
                    {!file.isDir && <span className="search-item-size">{formatFileSize(file.size)}</span>}
                    <span className="search-item-date">
                      {new Date(file.modTime).toLocaleDateString('ko-KR')}
                    </span>
                  </div>
                </div>
              ))}
              {hasMore && (
                <div ref={loadMoreRef} className="search-modal-loading">
                  {isLoading && <div className="search-modal-spinner" />}
                </div>
              )}
              {!hasMore && results.length > 0 && (
                <div className="search-modal-end">
                  총 {total}개의 검색 결과
                </div>
              )}
            </>
          )}
          {isLoading && results.length === 0 && (
            <div className="search-modal-loading-initial">
              <div className="search-modal-spinner" />
              <p>검색 중...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SearchModal
