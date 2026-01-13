// 다중 선택 액션 바 컴포넌트 - 여러 파일 선택 시 하단에 표시

interface MultiSelectBarProps {
  selectedCount: number
  onDownload: () => void
  onCompress: () => void
  onDelete: () => void
  onClear: () => void
}

function MultiSelectBar({
  selectedCount,
  onDownload,
  onCompress,
  onDelete,
  onClear,
}: MultiSelectBarProps) {
  if (selectedCount <= 1) return null

  return (
    <div
      className="multi-select-bar"
      onClick={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label={`${selectedCount}개 파일 선택됨`}
    >
      <span className="select-count">{selectedCount}개 선택됨</span>

      <button
        className="multi-action-btn"
        onClick={(e) => { e.stopPropagation(); onDownload(); }}
        aria-label={`${selectedCount}개 파일 다운로드`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        다운로드
      </button>

      <button
        className="multi-action-btn"
        onClick={(e) => { e.stopPropagation(); onCompress(); }}
        aria-label={`${selectedCount}개 파일 압축`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M21 8V21H3V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M23 3H1V8H23V3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M10 12H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        압축
      </button>

      <button
        className="multi-action-btn danger"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        aria-label={`${selectedCount}개 파일 삭제`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M19 6V20C19 21.1046 18.1046 22 17 22H7C5.89543 22 5 21.1046 5 20V6" stroke="currentColor" strokeWidth="2"/>
        </svg>
        삭제
      </button>

      <button className="multi-action-btn" onClick={onClear} aria-label="선택 취소">
        취소
      </button>
    </div>
  )
}

export default MultiSelectBar
