import { useState, useEffect, useCallback } from 'react'
import {
  getAllSharedFolders,
  createSharedFolder,
  updateSharedFolder,
  deleteSharedFolder,
  getSharedFolderMembers,
  addSharedFolderMember,
  updateMemberPermission,
  removeSharedFolderMember,
  SharedFolder,
  SharedFolderMember,
  formatStorageSize,
  getPermissionLabel,
  PERMISSION_READ_ONLY,
  PERMISSION_READ_WRITE,
} from '../api/sharedFolders'
import './AdminSharedFolders.css'

interface User {
  id: string
  username: string
  email: string
  isAdmin: boolean
}

// Simple API to get users list
async function getUsers(): Promise<User[]> {
  const stored = localStorage.getItem('scv-auth')
  let headers: HeadersInit = {}
  if (stored) {
    try {
      const { state } = JSON.parse(stored)
      if (state?.token) {
        headers = { 'Authorization': `Bearer ${state.token}` }
      }
    } catch {}
  }

  const response = await fetch('/api/admin/users', { headers })
  if (!response.ok) throw new Error('Failed to fetch users')
  const data = await response.json()
  return data.users
}

function AdminSharedFolders() {
  const [folders, setFolders] = useState<SharedFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create/Edit Modal
  const [showModal, setShowModal] = useState(false)
  const [editingFolder, setEditingFolder] = useState<SharedFolder | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    storageQuota: 0,
    storageQuotaUnit: 'GB' as 'MB' | 'GB' | 'TB',
    isActive: true,
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Members Modal
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState<SharedFolder | null>(null)
  const [members, setMembers] = useState<SharedFolderMember[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [addingMember, setAddingMember] = useState(false)
  const [newMemberUserId, setNewMemberUserId] = useState('')
  const [newMemberPermission, setNewMemberPermission] = useState(PERMISSION_READ_ONLY)

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingFolder, setDeletingFolder] = useState<SharedFolder | null>(null)

  // Load folders
  const loadFolders = useCallback(async () => {
    try {
      setLoading(true)
      const data = await getAllSharedFolders()
      setFolders(data)
      setError(null)
    } catch (err) {
      setError('Failed to load shared folders')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFolders()
  }, [loadFolders])

  // Open create modal
  const handleCreate = () => {
    setEditingFolder(null)
    setFormData({
      name: '',
      description: '',
      storageQuota: 0,
      storageQuotaUnit: 'GB',
      isActive: true,
    })
    setFormError(null)
    setShowModal(true)
  }

  // Open edit modal
  const handleEdit = (folder: SharedFolder) => {
    setEditingFolder(folder)
    // Convert bytes to appropriate unit
    let quota = folder.storageQuota
    let unit: 'MB' | 'GB' | 'TB' = 'GB'
    if (quota >= 1024 * 1024 * 1024 * 1024) {
      quota = quota / (1024 * 1024 * 1024 * 1024)
      unit = 'TB'
    } else if (quota >= 1024 * 1024 * 1024) {
      quota = quota / (1024 * 1024 * 1024)
      unit = 'GB'
    } else if (quota > 0) {
      quota = quota / (1024 * 1024)
      unit = 'MB'
    } else {
      quota = 0
      unit = 'GB'
    }

    setFormData({
      name: folder.name,
      description: folder.description || '',
      storageQuota: quota,
      storageQuotaUnit: unit,
      isActive: folder.isActive,
    })
    setFormError(null)
    setShowModal(true)
  }

  // Save folder
  const handleSave = async () => {
    if (!formData.name.trim()) {
      setFormError('이름을 입력하세요')
      return
    }

    // Convert quota to bytes
    let quotaBytes = formData.storageQuota
    if (quotaBytes > 0) {
      switch (formData.storageQuotaUnit) {
        case 'MB':
          quotaBytes *= 1024 * 1024
          break
        case 'GB':
          quotaBytes *= 1024 * 1024 * 1024
          break
        case 'TB':
          quotaBytes *= 1024 * 1024 * 1024 * 1024
          break
      }
    }

    setSaving(true)
    try {
      if (editingFolder) {
        await updateSharedFolder(editingFolder.id, {
          name: formData.name.trim(),
          description: formData.description.trim(),
          storageQuota: quotaBytes,
          isActive: formData.isActive,
        })
      } else {
        await createSharedFolder({
          name: formData.name.trim(),
          description: formData.description.trim(),
          storageQuota: quotaBytes,
        })
      }
      setShowModal(false)
      loadFolders()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // Delete folder
  const handleDelete = async () => {
    if (!deletingFolder) return
    try {
      await deleteSharedFolder(deletingFolder.id)
      setShowDeleteConfirm(false)
      setDeletingFolder(null)
      loadFolders()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  // Open members modal
  const handleManageMembers = async (folder: SharedFolder) => {
    setSelectedFolder(folder)
    setLoadingMembers(true)
    setShowMembersModal(true)

    try {
      const [membersData, usersData] = await Promise.all([
        getSharedFolderMembers(folder.id),
        getUsers(),
      ])
      setMembers(membersData)
      setUsers(usersData)
    } catch (err) {
      alert('Failed to load members')
    } finally {
      setLoadingMembers(false)
    }
  }

  // Add member
  const handleAddMember = async () => {
    if (!selectedFolder || !newMemberUserId) return
    setAddingMember(true)
    try {
      await addSharedFolderMember(selectedFolder.id, newMemberUserId, newMemberPermission)
      const updated = await getSharedFolderMembers(selectedFolder.id)
      setMembers(updated)
      setNewMemberUserId('')
      setNewMemberPermission(PERMISSION_READ_ONLY)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add member')
    } finally {
      setAddingMember(false)
    }
  }

  // Update member permission
  const handleUpdatePermission = async (userId: string, level: number) => {
    if (!selectedFolder) return
    try {
      await updateMemberPermission(selectedFolder.id, userId, level)
      const updated = await getSharedFolderMembers(selectedFolder.id)
      setMembers(updated)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update permission')
    }
  }

  // Remove member
  const handleRemoveMember = async (userId: string) => {
    if (!selectedFolder) return
    if (!confirm('이 멤버를 제거하시겠습니까?')) return
    try {
      await removeSharedFolderMember(selectedFolder.id, userId)
      const updated = await getSharedFolderMembers(selectedFolder.id)
      setMembers(updated)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove member')
    }
  }

  // Get available users (not already members)
  const availableUsers = users.filter(u => !members.some(m => m.userId === u.id))

  if (loading) {
    return (
      <div className="admin-shared-folders">
        <div className="loading">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="admin-shared-folders">
      <div className="page-header">
        <h1>공유 드라이브 관리</h1>
        <button className="btn-primary" onClick={handleCreate}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          새 공유 드라이브
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {folders.length === 0 ? (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2"/>
          </svg>
          <h3>공유 드라이브가 없습니다</h3>
          <p>새 공유 드라이브를 생성하여 팀원들과 파일을 공유하세요.</p>
        </div>
      ) : (
        <div className="folders-table">
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>설명</th>
                <th>용량</th>
                <th>멤버</th>
                <th>상태</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {folders.map(folder => (
                <tr key={folder.id} className={!folder.isActive ? 'inactive' : ''}>
                  <td className="name-cell">
                    <div className="folder-name">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" fill="#3182F6" stroke="#3182F6" strokeWidth="2"/>
                      </svg>
                      <span>{folder.name}</span>
                    </div>
                  </td>
                  <td className="desc-cell">{folder.description || '-'}</td>
                  <td className="quota-cell">
                    {folder.storageQuota > 0 ? (
                      <div className="quota-info">
                        <span>{formatStorageSize(folder.usedStorage || 0)}</span>
                        <span className="quota-sep">/</span>
                        <span>{formatStorageSize(folder.storageQuota)}</span>
                      </div>
                    ) : (
                      <span className="unlimited">무제한</span>
                    )}
                  </td>
                  <td className="members-cell">
                    <button className="members-btn" onClick={() => handleManageMembers(folder)}>
                      {folder.memberCount || 0}명
                    </button>
                  </td>
                  <td className="status-cell">
                    <span className={`status-badge ${folder.isActive ? 'active' : 'inactive'}`}>
                      {folder.isActive ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td className="actions-cell">
                    <button className="action-btn" onClick={() => handleEdit(folder)} title="수정">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    <button
                      className="action-btn danger"
                      onClick={() => { setDeletingFolder(folder); setShowDeleteConfirm(true) }}
                      title="삭제"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingFolder ? '공유 드라이브 수정' : '새 공유 드라이브'}</h2>
              <button className="close-btn" onClick={() => setShowModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              {formError && <div className="form-error">{formError}</div>}
              <div className="form-group">
                <label>이름 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="공유 드라이브 이름"
                />
              </div>
              <div className="form-group">
                <label>설명</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="선택사항"
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label>용량 제한</label>
                <div className="quota-input">
                  <input
                    type="number"
                    min="0"
                    value={formData.storageQuota}
                    onChange={e => setFormData({ ...formData, storageQuota: Number(e.target.value) })}
                    placeholder="0 = 무제한"
                  />
                  <select
                    value={formData.storageQuotaUnit}
                    onChange={e => setFormData({ ...formData, storageQuotaUnit: e.target.value as 'MB' | 'GB' | 'TB' })}
                  >
                    <option value="MB">MB</option>
                    <option value="GB">GB</option>
                    <option value="TB">TB</option>
                  </select>
                </div>
                <span className="form-hint">0을 입력하면 용량 제한이 없습니다.</span>
              </div>
              {editingFolder && (
                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.isActive}
                      onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                    />
                    <span>활성화</span>
                  </label>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowModal(false)}>취소</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '저장 중...' : editingFolder ? '수정' : '생성'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members Modal */}
      {showMembersModal && selectedFolder && (
        <div className="modal-overlay" onClick={() => setShowMembersModal(false)}>
          <div className="modal members-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>멤버 관리 - {selectedFolder.name}</h2>
              <button className="close-btn" onClick={() => setShowMembersModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              {loadingMembers ? (
                <div className="loading">로딩 중...</div>
              ) : (
                <>
                  {/* Add member section */}
                  <div className="add-member-section">
                    <h3>멤버 추가</h3>
                    <div className="add-member-form">
                      <select
                        value={newMemberUserId}
                        onChange={e => setNewMemberUserId(e.target.value)}
                        disabled={availableUsers.length === 0}
                      >
                        <option value="">사용자 선택...</option>
                        {availableUsers.map(user => (
                          <option key={user.id} value={user.id}>
                            {user.username} ({user.email || 'no email'})
                          </option>
                        ))}
                      </select>
                      <select
                        value={newMemberPermission}
                        onChange={e => setNewMemberPermission(Number(e.target.value))}
                      >
                        <option value={PERMISSION_READ_ONLY}>읽기 전용</option>
                        <option value={PERMISSION_READ_WRITE}>읽기/쓰기</option>
                      </select>
                      <button
                        className="btn-primary"
                        onClick={handleAddMember}
                        disabled={!newMemberUserId || addingMember}
                      >
                        추가
                      </button>
                    </div>
                  </div>

                  {/* Members list */}
                  <div className="members-list">
                    <h3>현재 멤버 ({members.length})</h3>
                    {members.length === 0 ? (
                      <div className="no-members">멤버가 없습니다</div>
                    ) : (
                      <table>
                        <thead>
                          <tr>
                            <th>사용자</th>
                            <th>권한</th>
                            <th>작업</th>
                          </tr>
                        </thead>
                        <tbody>
                          {members.map(member => (
                            <tr key={member.id}>
                              <td>{member.username}</td>
                              <td>
                                <select
                                  value={member.permissionLevel}
                                  onChange={e => handleUpdatePermission(member.userId, Number(e.target.value))}
                                >
                                  <option value={PERMISSION_READ_ONLY}>{getPermissionLabel(PERMISSION_READ_ONLY)}</option>
                                  <option value={PERMISSION_READ_WRITE}>{getPermissionLabel(PERMISSION_READ_WRITE)}</option>
                                </select>
                              </td>
                              <td>
                                <button
                                  className="action-btn danger"
                                  onClick={() => handleRemoveMember(member.userId)}
                                  title="제거"
                                >
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && deletingFolder && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>공유 드라이브 삭제</h2>
            </div>
            <div className="modal-body">
              <p>
                <strong>{deletingFolder.name}</strong> 공유 드라이브를 삭제하시겠습니까?
              </p>
              <p className="warning">이 작업은 되돌릴 수 없으며, 모든 파일이 영구적으로 삭제됩니다.</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowDeleteConfirm(false)}>취소</button>
              <button className="btn-danger" onClick={handleDelete}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminSharedFolders
