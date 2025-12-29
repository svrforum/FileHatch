// 파일 리스트 헤더 컴포넌트 - 경로 표시, 정렬, 뷰 모드 전환

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
}: FileListHeaderProps) {
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
          {selectedCount > 1
            ? `${selectedCount}개 선택됨`
            : `${totalCount}개 항목 · ${formatFileSize(totalSize)}`
          }
        </span>
      </div>
      <div className="view-options">
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
