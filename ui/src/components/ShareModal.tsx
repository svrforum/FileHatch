import { useState, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  createFileShare,
  getFileShareInfo,
  updateFileShare,
  deleteFileShare,
  searchUsers,
  FileShare,
  UserSearchResult,
  PERMISSION_READ_ONLY,
  PERMISSION_READ_WRITE,
  getPermissionLabel,
} from '../api/fileShares'
import './ShareModal.css'

interface ShareModalProps {
  isOpen: boolean
  onClose: () => void
  itemPath: string
  itemName: string
  isFolder: boolean
}

function ShareModal({ isOpen, onClose, itemPath, itemName, isFolder }: ShareModalProps) {
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Current shares
  const [shares, setShares] = useState<FileShare[]>([])
  const [loadingShares, setLoadingShares] = useState(true)

  // User search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)

  // New share form
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null)
  const [permission, setPermission] = useState(PERMISSION_READ_ONLY)
  const [message, setMessage] = useState('')

  // Load existing shares for this file
  const loadShares = useCallback(async () => {
    if (!itemPath) return
    setLoadingShares(true)
    try {
      const data = await getFileShareInfo(itemPath)
      setShares(data)
    } catch {
      // Ignore errors - might not have any shares
      setShares([])
    } finally {
      setLoadingShares(false)
    }
  }, [itemPath])

  useEffect(() => {
    if (isOpen) {
      loadShares()
      setError(null)
      setSuccess(null)
      setSelectedUser(null)
      setPermission(PERMISSION_READ_ONLY)
      setMessage('')
      setSearchQuery('')
      setSearchResults([])
    }
  }, [isOpen, loadShares])

  // User search with debounce
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }

    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await searchUsers(searchQuery)
        // Filter out users who already have access
        const existingUserIds = new Set(shares.map((s) => s.sharedWithId))
        const filtered = results.filter((u) => !existingUserIds.has(u.id))
        setSearchResults(filtered)
        setShowDropdown(true)
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, shares])

  const handleSelectUser = (user: UserSearchResult) => {
    setSelectedUser(user)
    setSearchQuery(user.username)
    setShowDropdown(false)
    setSearchResults([])
  }

  const handleShare = async () => {
    if (!selectedUser) {
      setError('사용자를 선택해주세요')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await createFileShare({
        itemPath,
        itemName,
        isFolder,
        sharedWithId: selectedUser.id,
        permissionLevel: permission,
        message: message.trim() || undefined,
      })
      setSuccess(`${selectedUser.username}님에게 공유되었습니다`)
      setSelectedUser(null)
      setSearchQuery('')
      setMessage('')
      loadShares()
      // Invalidate shared-by-me query for real-time update
      queryClient.invalidateQueries({ queryKey: ['shared-by-me'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : '공유에 실패했습니다')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdatePermission = async (shareId: number, newPermission: number) => {
    try {
      await updateFileShare(shareId, { permissionLevel: newPermission })
      loadShares()
    } catch (err) {
      setError(err instanceof Error ? err.message : '권한 변경에 실패했습니다')
    }
  }

  const handleRemoveShare = async (shareId: number) => {
    if (!confirm('공유를 취소하시겠습니까?')) return
    try {
      await deleteFileShare(shareId)
      loadShares()
      queryClient.invalidateQueries({ queryKey: ['shared-by-me'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : '공유 취소에 실패했습니다')
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose} onMouseDown={(e) => e.stopPropagation()}>
      <div className="share-modal" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {isFolder ? '📁' : '📄'} {itemName} 공유
          </h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="share-modal-content">
          {/* Add user section */}
          <div className="share-section">
            <h3>사용자 추가</h3>

            <div className="user-search-container">
              <div className="search-input-wrapper">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setSelectedUser(null)
                  }}
                  placeholder="사용자 이름 또는 이메일로 검색..."
                  className="search-input"
                />
                {searching && <span className="search-loading">검색 중...</span>}
              </div>

              {showDropdown && searchResults.length > 0 && (
                <div className="search-dropdown">
                  {searchResults.map((user) => (
                    <div
                      key={user.id}
                      className="search-result-item"
                      onClick={() => handleSelectUser(user)}
                    >
                      <div className="user-avatar">
                        {user.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="user-info">
                        <span className="user-name">{user.username}</span>
                        {user.email && <span className="user-email">{user.email}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {showDropdown && searchResults.length === 0 && searchQuery.length >= 2 && !searching && (
                <div className="search-dropdown">
                  <div className="no-results">검색 결과가 없습니다</div>
                </div>
              )}
            </div>

            {selectedUser && (
              <div className="selected-user">
                <div className="user-badge">
                  <div className="user-avatar small">
                    {selectedUser.username.charAt(0).toUpperCase()}
                  </div>
                  <span>{selectedUser.username}</span>
                  <button
                    className="remove-user-btn"
                    onClick={() => {
                      setSelectedUser(null)
                      setSearchQuery('')
                    }}
                  >
                    ×
                  </button>
                </div>

                <div className="permission-select">
                  <label>권한:</label>
                  <select
                    value={permission}
                    onChange={(e) => setPermission(Number(e.target.value))}
                  >
                    <option value={PERMISSION_READ_ONLY}>읽기 전용</option>
                    <option value={PERMISSION_READ_WRITE}>읽기/쓰기</option>
                  </select>
                </div>
              </div>
            )}

            <div className="message-input">
              <label>메시지 (선택)</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="공유 시 전달할 메시지를 입력하세요..."
                rows={2}
              />
            </div>

            {error && <p className="error-message">{error}</p>}
            {success && <p className="success-message">{success}</p>}

            <button
              className="btn-primary share-btn"
              onClick={handleShare}
              disabled={loading || !selectedUser}
            >
              {loading ? '공유 중...' : '공유하기'}
            </button>
          </div>

          {/* Current shares section */}
          <div className="share-section">
            <h3>현재 공유 대상</h3>

            {loadingShares ? (
              <p className="loading-text">불러오는 중...</p>
            ) : shares.length === 0 ? (
              <p className="empty-text">아직 공유된 사용자가 없습니다</p>
            ) : (
              <div className="shares-list">
                {shares.map((share) => (
                  <div key={share.id} className="share-item">
                    <div className="share-user">
                      <div className="user-avatar small">
                        {(share.sharedWithUsername || '?').charAt(0).toUpperCase()}
                      </div>
                      <span className="user-name">{share.sharedWithUsername}</span>
                    </div>
                    <div className="share-actions">
                      <select
                        value={share.permissionLevel}
                        onChange={(e) => handleUpdatePermission(share.id, Number(e.target.value))}
                        className="permission-select-inline"
                      >
                        <option value={PERMISSION_READ_ONLY}>{getPermissionLabel(PERMISSION_READ_ONLY)}</option>
                        <option value={PERMISSION_READ_WRITE}>{getPermissionLabel(PERMISSION_READ_WRITE)}</option>
                      </select>
                      <button
                        className="remove-share-btn"
                        onClick={() => handleRemoveShare(share.id)}
                        title="공유 취소"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

export default ShareModal
