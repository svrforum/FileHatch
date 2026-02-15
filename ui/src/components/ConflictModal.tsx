// 파일 충돌 해결 모달 - 동일 파일 존재 시 덮어쓰기/건너뛰기/이름변경 선택
import { useState } from 'react'
import './ConflictModal.css'

export type ConflictResolution = 'overwrite' | 'skip' | 'rename'

export interface ConflictInfo {
  sourcePath: string
  sourceName: string
  destinationPath: string
}

interface ConflictModalProps {
  isOpen: boolean
  conflicts: ConflictInfo[]
  onResolve: (resolution: ConflictResolution, applyToAll: boolean) => void
  onCancel: () => void
}

export default function ConflictModal({
  isOpen,
  conflicts,
  onResolve,
  onCancel,
}: ConflictModalProps) {
  const [applyToAll, setApplyToAll] = useState(false)

  if (!isOpen || conflicts.length === 0) return null

  const currentConflict = conflicts[0]

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="conflict-modal" onClick={e => e.stopPropagation()}>
        <div className="conflict-modal-header">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M10.29 3.86L1.82 18A2 2 0 003.54 21H20.46A2 2 0 0022.18 18L13.71 3.86A2 2 0 0010.29 3.86Z" stroke="var(--color-warning, #FF9800)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 9V13M12 17H12.01" stroke="var(--color-warning, #FF9800)" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <h2>파일이 이미 존재합니다</h2>
        </div>

        <div className="conflict-modal-body">
          <p className="conflict-filename">
            "<strong>{currentConflict.sourceName}</strong>" 파일이 대상 폴더에 이미 존재합니다.
          </p>
          {conflicts.length > 1 && (
            <p className="conflict-count">
              ({conflicts.length}개 파일 충돌)
            </p>
          )}
        </div>

        <div className="conflict-modal-actions">
          <button className="conflict-btn overwrite" onClick={() => onResolve('overwrite', applyToAll)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            덮어쓰기
          </button>
          <button className="conflict-btn skip" onClick={() => onResolve('skip', applyToAll)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            건너뛰기
          </button>
          <button className="conflict-btn rename" onClick={() => onResolve('rename', applyToAll)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            이름 변경
          </button>
        </div>

        {conflicts.length > 1 && (
          <label className="conflict-apply-all">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={e => setApplyToAll(e.target.checked)}
            />
            나머지 {conflicts.length - 1}개 파일에도 동일하게 적용
          </label>
        )}

        <button className="conflict-cancel" onClick={onCancel}>취소</button>
      </div>
    </div>
  )
}
