import { useEffect } from 'react'
import { useUploadStore } from '../stores/uploadStore'
import './UploadModal.css'

function DuplicateModal() {
  const { duplicateFile, resolveDuplicate, items } = useUploadStore()

  // Handle Escape key
  useEffect(() => {
    if (!duplicateFile) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        resolveDuplicate('cancel')
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [duplicateFile, resolveDuplicate])

  if (!duplicateFile) return null

  // Count remaining pending/duplicate items
  const remainingCount = items.filter(i => i.status === 'pending' || i.status === 'duplicate').length

  return (
    <div className="modal-overlay" onClick={() => resolveDuplicate('cancel')}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-icon warning">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h3 className="confirm-title">파일이 이미 존재합니다</h3>
        <p className="confirm-message">
          <strong>{duplicateFile.filename}</strong> 파일이 이미 존재합니다.
          <br />어떻게 처리할까요?
        </p>
        <div className="confirm-actions duplicate-actions">
          <button className="btn-secondary" onClick={() => resolveDuplicate('cancel')}>
            취소
          </button>
          <button className="btn-primary" onClick={() => resolveDuplicate('rename')}>
            이름 변경
          </button>
          <button className="btn-danger" onClick={() => resolveDuplicate('overwrite')}>
            덮어쓰기
          </button>
          {remainingCount > 1 && (
            <button className="btn-danger-outline" onClick={() => resolveDuplicate('overwrite_all')}>
              전체 덮어쓰기 ({remainingCount})
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default DuplicateModal
