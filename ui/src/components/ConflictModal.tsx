// 파일 충돌 해결 모달 - 동일 파일 존재 시 덮어쓰기/건너뛰기/이름변경/병합 선택
import { useState } from 'react'
import { useModalKeyboard } from '../hooks/useModalKeyboard'
import './ConflictModal.css'

export type ConflictResolution = 'overwrite' | 'skip' | 'rename' | 'merge'

export interface ConflictInfo {
  sourcePath: string
  sourceName: string
  destinationPath: string
  isFolder?: boolean
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

  useModalKeyboard({ isOpen, onCancel })

  if (!isOpen || conflicts.length === 0) return null

  const currentConflict = conflicts[0]
  const hasFolder = conflicts.some(c => c.isFolder)

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="conflict-modal" onClick={e => e.stopPropagation()}>
        <div className="conflict-modal-header">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M10.29 3.86L1.82 18A2 2 0 003.54 21H20.46A2 2 0 0022.18 18L13.71 3.86A2 2 0 0010.29 3.86Z" stroke="var(--color-warning, #FF9800)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 9V13M12 17H12.01" stroke="var(--color-warning, #FF9800)" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <h2>{currentConflict.isFolder ? '폴더가 이미 존재합니다' : '파일이 이미 존재합니다'}</h2>
        </div>

        <div className="conflict-modal-body">
          <p className="conflict-filename">
            "<strong>{currentConflict.sourceName}</strong>" {currentConflict.isFolder ? '폴더' : '파일'}이 대상 폴더에 이미 존재합니다.
          </p>
          {conflicts.length > 1 && (
            <p className="conflict-count">
              ({conflicts.length}개 항목 충돌)
            </p>
          )}
        </div>

        <div className="conflict-modal-actions">
          {hasFolder && (
            <button className="conflict-btn merge" onClick={() => onResolve('merge', applyToAll)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 11V17M9 14H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              병합
            </button>
          )}
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
            나머지 {conflicts.length - 1}개 항목에도 동일하게 적용
          </label>
        )}

        <button className="conflict-cancel" onClick={onCancel}>취소</button>
      </div>
    </div>
  )
}
