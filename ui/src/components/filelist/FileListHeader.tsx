// 파일 리스트 헤더 컴포넌트 - 경로 표시, 정렬, 뷰 모드 전환, 로컬 검색

import { useState, useRef, useEffect } from 'react'
import { ViewMode } from './types'
import { formatFileSize } from '../../api/files'

interface FileListHeaderProps {
  currentPath: string
  viewMode: ViewMode
  selectedCount: number
  totalCount: number
  totalSize: number
  canGoBack: boolean
  onGoBack: () => void
  onViewModeChange: (mode: ViewMode) => void
  onRefresh: () => void
  getPathDisplayName: (path: string) => string
  // 로컬 검색
  localSearchQuery: string
  onLocalSearchChange: (query: string) => void
  isSearching: boolean
  searchResultCount?: number
}

function FileListHeader({
  currentPath,
  viewMode,
  selectedCount,
  totalCount,
  totalSize,
  canGoBack,
  onGoBack,
  onViewModeChange,
  onRefresh,
  getPathDisplayName,
  localSearchQuery,
  onLocalSearchChange,
  isSearching,
  searchResultCount,
}: FileListHeaderProps) {
  const [showSearch, setShowSearch] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 검색창이 열릴 때 포커스
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [showSearch])

  // ESC로 검색창 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false)
        onLocalSearchChange('')
      }
      // Ctrl+F로 검색창 열기
      if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setShowSearch(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showSearch, onLocalSearchChange])

  const handleSearchToggle = () => {
    if (showSearch) {
      setShowSearch(false)
      onLocalSearchChange('')
    } else {
      setShowSearch(true)
    }
  }

  const handleClearSearch = () => {
    onLocalSearchChange('')
    searchInputRef.current?.focus()
  }

  return (
    <div className="file-list-header">
      <div className="breadcrumb">
        {canGoBack && (
          <button className="back-btn" onClick={onGoBack} title="상위 폴더로 이동">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <h2 className="current-path">
          {getPathDisplayName(currentPath)}
        </h2>
        <span className="file-count">
          {localSearchQuery ? (
            isSearching ? '검색 중...' : `${searchResultCount ?? 0}개 검색 결과`
          ) : selectedCount > 1 ? (
            `${selectedCount}개 선택됨`
          ) : (
            `${totalCount}개 항목 · ${formatFileSize(totalSize)}`
          )}
        </span>
      </div>

      <div className="view-options">
        {/* 로컬 검색 */}
        <div className={`local-search-container ${showSearch ? 'active' : ''}`}>
          {showSearch && (
            <div className="local-search-input-wrapper">
              <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                className="local-search-input"
                placeholder="현재 폴더에서 검색..."
                value={localSearchQuery}
                onChange={(e) => onLocalSearchChange(e.target.value)}
              />
              {localSearchQuery && (
                <button className="clear-search-btn" onClick={handleClearSearch} title="검색어 지우기">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              )}
              {isSearching && (
                <div className="search-spinner" />
              )}
            </div>
          )}
          <button
            className={`view-btn search-toggle-btn ${showSearch ? 'active' : ''}`}
            onClick={handleSearchToggle}
            title={showSearch ? '검색 닫기 (ESC)' : '폴더 내 검색 (Ctrl+F)'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
              <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <button
          className="view-btn refresh-btn"
          onClick={onRefresh}
          title="새로고침"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M1 4V10H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M23 20V14H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14L18.36 18.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
          onClick={() => onViewModeChange('list')}
          title="리스트 보기"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M8 6H21M8 12H21M8 18H21M3 6H3.01M3 12H3.01M3 18H3.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
          onClick={() => onViewModeChange('grid')}
          title="그리드 보기"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
            <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
            <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
            <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

export default FileListHeader
