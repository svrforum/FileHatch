import { useState, useCallback, useEffect } from 'react'
import { createFolder } from '../api/files'
import './UploadModal.css'

interface CreateFolderModalProps {
  isOpen: boolean
  onClose: () => void
  currentPath: string
  onCreated: () => void
}

function CreateFolderModal({ isOpen, onClose, currentPath, onCreated }: CreateFolderModalProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setName('')
        setError('')
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('폴더 이름을 입력해주세요')
      return
    }

    setLoading(true)
    setError('')

    try {
      await createFolder(currentPath, name.trim())
      setName('')
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : '폴더 생성에 실패했습니다')
    } finally {
      setLoading(false)
    }
  }, [name, currentPath, onCreated])

  const handleClose = useCallback(() => {
    setName('')
    setError('')
    onClose()
  }, [onClose])

  if (!isOpen) return null

  return (
    <div className="fh-modal-overlay upload-modal-overlay" onClick={handleClose}>
      <div className="fh-modal upload-modal create-folder-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fh-modal__header modal-header">
          <h2>새 폴더</h2>
          <button className="close-btn" onClick={handleClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="create-folder-form">
          <div className="fh-form-field form-group">
            <label className="fh-form-field__label form-label">폴더 이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="새 폴더"
              autoFocus
              className="fh-form-field__control form-input"
            />
          </div>

          {error && (
            <p className="form-error">{error}</p>
          )}

          <div className="modal-actions">
            <button type="button" className="fh-button fh-button--secondary btn-secondary" onClick={handleClose}>
              취소
            </button>
            <button type="submit" className="fh-button fh-button--primary btn-primary" disabled={loading}>
              {loading ? '생성 중...' : '생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateFolderModal
