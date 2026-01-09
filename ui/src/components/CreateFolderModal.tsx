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
    <div className="upload-modal-overlay" onClick={handleClose}>
      <div className="upload-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <h2>새 폴더</h2>
          <button className="close-btn" onClick={handleClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="create-folder-form">
          <div className="form-group">
            <label className="form-label">폴더 이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="새 폴더"
              autoFocus
              className="form-input"
            />
          </div>

          {error && (
            <p className="form-error">{error}</p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={handleClose}>
              취소
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? '생성 중...' : '생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateFolderModal
