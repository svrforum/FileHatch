// 파일 관련 모달 컴포넌트들

import { FileInfo } from '../../api/files'
import ConfirmModal from '../ConfirmModal'

// 파일 타입 옵션
export interface FileTypeOption {
  type: string
  name: string
  icon: string
}

// Rename Modal
interface RenameModalProps {
  target: FileInfo | null
  newName: string
  onNameChange: (name: string) => void
  onConfirm: () => void
  onClose: () => void
}

export function RenameModal({ target, newName, onNameChange, onConfirm, onClose }: RenameModalProps) {
  if (!target) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal rename-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>이름 변경</h3>
          <button className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <input
            type="text"
            className="rename-input"
            value={newName}
            onChange={e => onNameChange(e.target.value)}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') onConfirm()
              if (e.key === 'Escape') onClose()
            }}
          />
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>취소</button>
          <button className="btn-confirm" onClick={onConfirm} disabled={!newName.trim() || newName === target.name}>
            변경
          </button>
        </div>
      </div>
    </div>
  )
}

// New File Modal
interface NewFileModalProps {
  isOpen: boolean
  fileName: string
  fileType: string
  fileTypeOptions: FileTypeOption[]
  onFileNameChange: (name: string) => void
  onConfirm: () => void
  onClose: () => void
}

export function NewFileModal({
  isOpen,
  fileName,
  fileType,
  fileTypeOptions,
  onFileNameChange,
  onConfirm,
  onClose
}: NewFileModalProps) {
  if (!isOpen) return null

  const selectedOption = fileTypeOptions.find(o => o.type === fileType)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal new-file-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>새 파일 만들기</h3>
          <button className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <label className="input-label">파일 이름</label>
          <input
            type="text"
            className="rename-input"
            value={fileName}
            onChange={e => onFileNameChange(e.target.value)}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') onConfirm()
              if (e.key === 'Escape') onClose()
            }}
          />
          <p className="input-hint">
            파일 종류: {selectedOption?.name}
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>취소</button>
          <button className="btn-confirm" onClick={onConfirm} disabled={!fileName.trim()}>
            만들기
          </button>
        </div>
      </div>
    </div>
  )
}

// Compress Modal
interface CompressModalProps {
  isOpen: boolean
  fileName: string
  itemCount: number
  onFileNameChange: (name: string) => void
  onConfirm: () => void
  onClose: () => void
}

export function CompressModal({
  isOpen,
  fileName,
  itemCount,
  onFileNameChange,
  onConfirm,
  onClose
}: CompressModalProps) {
  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal compress-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>압축 파일 만들기</h3>
          <button className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <label className="input-label">압축 파일 이름</label>
          <div className="compress-input-wrapper">
            <input
              type="text"
              className="rename-input"
              value={fileName}
              onChange={e => onFileNameChange(e.target.value)}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') onConfirm()
                if (e.key === 'Escape') onClose()
              }}
            />
            <span className="compress-extension">.zip</span>
          </div>
          <p className="input-hint">
            {itemCount}개 항목을 압축합니다
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>취소</button>
          <button className="btn-confirm" onClick={onConfirm} disabled={!fileName.trim()}>
            압축
          </button>
        </div>
      </div>
    </div>
  )
}

// Download Options Modal
interface DownloadOptionsModalProps {
  isOpen: boolean
  itemCount: number
  isDownloading: boolean
  onDownloadSeparate: () => void
  onDownloadAsZip: () => void
  onClose: () => void
}

export function DownloadOptionsModal({
  isOpen,
  itemCount,
  isDownloading,
  onDownloadSeparate,
  onDownloadAsZip,
  onClose
}: DownloadOptionsModalProps) {
  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={() => !isDownloading && onClose()}>
      <div className="modal download-options-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>다운로드 방식 선택</h3>
          <button className="modal-close" onClick={() => !isDownloading && onClose()} disabled={isDownloading}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <p className="download-info">
            {itemCount}개 파일을 다운로드합니다
          </p>
          <div className="download-options">
            <button
              className="download-option-btn"
              onClick={onDownloadSeparate}
              disabled={isDownloading}
            >
              <div className="download-option-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="download-option-text">
                <strong>개별 다운로드</strong>
                <span>각 파일을 별도로 다운로드</span>
              </div>
            </button>

            <button
              className="download-option-btn"
              onClick={onDownloadAsZip}
              disabled={isDownloading}
            >
              <div className="download-option-icon">
                {isDownloading ? (
                  <div className="spinner small" />
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M21 8V21H3V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M23 3H1V8H23V3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M10 12H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <div className="download-option-text">
                <strong>ZIP으로 다운로드</strong>
                <span>모든 파일을 압축하여 다운로드</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Delete Confirm Modal
interface DeleteConfirmModalProps {
  target: FileInfo | null
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmModal({ target, onConfirm, onCancel }: DeleteConfirmModalProps) {
  return (
    <ConfirmModal
      isOpen={!!target}
      title="휴지통으로 이동"
      message={target ? `"${target.name}"을(를) 휴지통으로 이동하시겠습니까? ${target.isDir ? '폴더 내의 모든 파일이 함께 이동됩니다.' : ''}` : ''}
      confirmText="휴지통으로 이동"
      cancelText="취소"
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

// Copy Confirm Modal
interface CopyConfirmModalProps {
  isOpen: boolean
  target: FileInfo | null
  destination: string
  onConfirm: () => void
  onCancel: () => void
}

export function CopyConfirmModal({ isOpen, target, destination, onConfirm, onCancel }: CopyConfirmModalProps) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      title="파일 복사"
      message={target ? `"${target.name}"을(를) "${destination}"에 복사하시겠습니까?` : ''}
      confirmText="복사"
      cancelText="취소"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
