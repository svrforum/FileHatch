import { useEffect } from 'react'
import { useUploadStore } from '../stores/uploadStore'
import './UploadModal.css'

function DuplicateModal() {
  const { duplicateFile, resolveDuplicate, items } = useUploadStore()

  // Issue #36: Escape는 단일 cancel 대신 명시적 사용자 액션을 요구하도록 변경.
  // 폴더 업로드 시 사용자가 "전체 취소"라고 오해하는 것을 방지하기 위해
  // 명확한 버튼 클릭만 액션이 발생한다. (외부 클릭도 마찬가지)
  useEffect(() => {
    if (!duplicateFile) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [duplicateFile])

  if (!duplicateFile) return null

  // Count remaining pending/duplicate items
  const remainingCount = items.filter(i => i.status === 'pending' || i.status === 'duplicate').length
  const hasBatch = remainingCount > 1

  return (
    <div
      className="modal-overlay duplicate-modal-overlay"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-icon warning">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h3 className="confirm-title">파일이 이미 존재합니다</h3>
        <p className="confirm-message">
          <strong>{duplicateFile.filename}</strong>
          <br />
          <span className="confirm-path-hint" data-testid="duplicate-target-path">
            업로드 대상: {duplicateFile.path}
          </span>
          {hasBatch && (
            <>
              <br />
              <span className="confirm-batch-hint">남은 파일: {remainingCount}개</span>
            </>
          )}
          <br />어떻게 처리할까요?
        </p>
        <div className="confirm-actions duplicate-actions">
          <button
            className="btn-secondary"
            onClick={() => resolveDuplicate('cancel')}
            data-testid="duplicate-cancel-one"
          >
            {hasBatch ? '이 파일 건너뛰기' : '취소'}
          </button>
          <button
            className="btn-primary"
            onClick={() => resolveDuplicate('rename')}
            data-testid="duplicate-rename"
          >
            이름 변경
          </button>
          <button
            className="btn-danger"
            onClick={() => resolveDuplicate('overwrite')}
            data-testid="duplicate-overwrite"
          >
            덮어쓰기
          </button>
          {hasBatch && (
            <>
              <button
                className="btn-danger-outline"
                onClick={() => resolveDuplicate('overwrite_all')}
                data-testid="duplicate-overwrite-all"
              >
                전체 덮어쓰기 ({remainingCount})
              </button>
              <button
                className="btn-secondary-outline"
                onClick={() => resolveDuplicate('cancel_all')}
                data-testid="duplicate-cancel-all"
              >
                전체 취소 ({remainingCount})
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default DuplicateModal
