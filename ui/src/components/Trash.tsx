import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listTrash, restoreFromTrash, deleteFromTrash, emptyTrash, formatFileSize, TrashItem } from '../api/files'
import Toast from './Toast'
import './Trash.css'

interface TrashProps {
  onNavigate: (path: string) => void
}

export default function Trash({ onNavigate }: TrashProps) {
  const queryClient = useQueryClient()
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'info' }[]>([])

  const addToast = (type: 'success' | 'error' | 'info', message: string) => {
    const id = Date.now().toString()
    setToasts(prev => [...prev, { id, message, type }])
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['trash'],
    queryFn: listTrash,
  })

  const restoreMutation = useMutation({
    mutationFn: restoreFromTrash,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['trash'] })
      queryClient.invalidateQueries({ queryKey: ['files'] })
      addToast('success', '복원되었습니다')
      // Navigate to the restored item's directory
      const parentPath = result.restoredPath.split('/').slice(0, -1).join('/') || '/'
      onNavigate(parentPath)
    },
    onError: (err: Error) => {
      addToast('error', err.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteFromTrash,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] })
      addToast('success', '영구 삭제되었습니다')
      setShowDeleteConfirm(null)
    },
    onError: (err: Error) => {
      addToast('error', err.message)
    },
  })

  const emptyMutation = useMutation({
    mutationFn: emptyTrash,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['trash'] })
      addToast('success', `${result.deletedCount}개 항목이 영구 삭제되었습니다`)
      setShowEmptyConfirm(false)
    },
    onError: (err: Error) => {
      addToast('error', err.message)
    },
  })

  const handleSelectItem = (id: string, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      const newSelected = new Set(selectedItems)
      if (newSelected.has(id)) {
        newSelected.delete(id)
      } else {
        newSelected.add(id)
      }
      setSelectedItems(newSelected)
    } else {
      setSelectedItems(new Set([id]))
    }
  }

  const handleRestore = (id: string) => {
    restoreMutation.mutate(id)
  }

  const handleDelete = (id: string) => {
    setShowDeleteConfirm(id)
  }

  const confirmDelete = () => {
    if (showDeleteConfirm) {
      deleteMutation.mutate(showDeleteConfirm)
    }
  }

  const handleEmptyTrash = () => {
    setShowEmptyConfirm(true)
  }

  const confirmEmptyTrash = () => {
    emptyMutation.mutate()
  }

  const formatDeletedTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
      if (diffHours === 0) {
        const diffMins = Math.floor(diffMs / (1000 * 60))
        return `${diffMins}분 전`
      }
      return `${diffHours}시간 전`
    } else if (diffDays === 1) {
      return '어제'
    } else if (diffDays < 7) {
      return `${diffDays}일 전`
    } else {
      return date.toLocaleDateString('ko-KR')
    }
  }

  // Icons
  const TrashIcon = ({ size = 24 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )

  const RestoreIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M1 4V10H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3.51 15C4.01717 16.6132 5.04245 18.0141 6.43585 19.0029C7.82926 19.9918 9.51425 20.5157 11.2335 20.4971C12.9527 20.4784 14.6258 19.9183 16.0001 18.8993C17.3744 17.8803 18.3774 16.4556 18.8584 14.8306C19.3395 13.2056 19.2738 11.4669 18.6708 9.88329C18.0677 8.29969 16.9593 6.95376 15.5117 6.03973C14.0642 5.12569 12.3555 4.69261 10.6394 4.80192C8.92328 4.91124 7.29214 5.55758 5.99 6.64L1 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )

  const FolderIcon = ({ size = 24 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" fill="#3182F6" stroke="#3182F6" strokeWidth="2"/>
    </svg>
  )

  const FileIcon = ({ size = 24 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )

  const ClockIcon = ({ size = 12 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
      <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )

  const AlertIcon = ({ size = 32 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M10.29 3.86L1.82 18C1.64 18.33 1.55 18.71 1.57 19.09C1.59 19.47 1.72 19.83 1.94 20.14C2.16 20.44 2.47 20.68 2.82 20.82C3.17 20.96 3.56 21 3.93 20.93H20.07C20.44 21 20.83 20.96 21.18 20.82C21.53 20.68 21.84 20.44 22.06 20.14C22.28 19.83 22.41 19.47 22.43 19.09C22.45 18.71 22.36 18.33 22.18 18L13.71 3.86C13.49 3.49 13.17 3.18 12.79 2.96C12.41 2.74 11.98 2.62 11.53 2.62C11.08 2.62 10.65 2.74 10.27 2.96C9.89 3.18 9.57 3.49 9.35 3.86L10.29 3.86Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 9V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M12 17H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )

  if (isLoading) {
    return (
      <div className="trash-container">
        <div className="trash-loading">로딩 중...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="trash-container">
        <div className="trash-error">휴지통을 불러오는 중 오류가 발생했습니다</div>
      </div>
    )
  }

  const items = data?.items || []
  const totalSize = data?.totalSize || 0

  return (
    <div className="trash-container">
      <div className="trash-header">
        <div className="trash-title">
          <TrashIcon size={24} />
          <h2>휴지통</h2>
        </div>
        <div className="trash-info">
          <span className="trash-count">{items.length}개 항목</span>
          <span className="trash-size">{formatFileSize(totalSize)}</span>
        </div>
        {items.length > 0 && (
          <button
            className="empty-trash-btn"
            onClick={handleEmptyTrash}
            disabled={emptyMutation.isPending}
          >
            <TrashIcon size={16} />
            휴지통 비우기
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="trash-empty">
          <TrashIcon size={64} />
          <p>휴지통이 비어 있습니다</p>
        </div>
      ) : (
        <div className="trash-list">
          {items.map((item: TrashItem) => (
            <div
              key={item.id}
              className={`trash-item ${selectedItems.has(item.id) ? 'selected' : ''}`}
              onClick={(e) => handleSelectItem(item.id, e)}
            >
              <div className="trash-item-icon">
                {item.isDir ? (
                  <FolderIcon size={24} />
                ) : (
                  <FileIcon size={24} />
                )}
              </div>
              <div className="trash-item-info">
                <div className="trash-item-name">{item.name}</div>
                <div className="trash-item-meta">
                  <span className="trash-item-path" title={item.originalPath}>
                    {item.originalPath}
                  </span>
                  <span className="trash-item-date">
                    <ClockIcon size={12} />
                    {formatDeletedTime(item.deletedAt)}
                  </span>
                </div>
              </div>
              <div className="trash-item-size">
                {formatFileSize(item.size)}
              </div>
              <div className="trash-item-actions">
                <button
                  className="restore-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRestore(item.id)
                  }}
                  disabled={restoreMutation.isPending}
                  title="복원"
                >
                  <RestoreIcon size={16} />
                </button>
                <button
                  className="delete-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(item.id)
                  }}
                  disabled={deleteMutation.isPending}
                  title="영구 삭제"
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty Trash Confirmation Modal */}
      {showEmptyConfirm && (
        <div className="modal-overlay" onClick={() => setShowEmptyConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon warning">
              <AlertIcon size={32} />
            </div>
            <h3>휴지통 비우기</h3>
            <p>
              휴지통의 모든 항목({items.length}개)이 영구적으로 삭제됩니다.
              <br />이 작업은 취소할 수 없습니다.
            </p>
            <div className="modal-actions">
              <button
                className="btn-cancel"
                onClick={() => setShowEmptyConfirm(false)}
              >
                취소
              </button>
              <button
                className="btn-danger"
                onClick={confirmEmptyTrash}
                disabled={emptyMutation.isPending}
              >
                {emptyMutation.isPending ? '삭제 중...' : '영구 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon warning">
              <AlertIcon size={32} />
            </div>
            <h3>영구 삭제</h3>
            <p>
              이 항목을 영구적으로 삭제하시겠습니까?
              <br />이 작업은 취소할 수 없습니다.
            </p>
            <div className="modal-actions">
              <button
                className="btn-cancel"
                onClick={() => setShowDeleteConfirm(null)}
              >
                취소
              </button>
              <button
                className="btn-danger"
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? '삭제 중...' : '영구 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast
        toasts={toasts}
        onRemove={(id) => setToasts(prev => prev.filter(t => t.id !== id))}
      />
    </div>
  )
}
