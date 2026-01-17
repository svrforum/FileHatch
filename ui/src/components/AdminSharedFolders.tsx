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
import { api } from '../api/client'
import './AdminSharedFolders.css'

interface User {
  id: string
  username: string
  email: string
  isAdmin: boolean
}

interface InitialMember {
  userId: string
  username: string
  email: string
  permission: number
}

async function getUsers(): Promise<User[]> {
  const data = await api.get<{ users: User[] }>('/admin/users')
  return data.users
}

function AdminSharedFolders() {
  const [folders, setFolders] = useState<SharedFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem('filehatch-shared-folders-view') as 'grid' | 'list') || 'grid'
  })

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

  // Initial members for create modal
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [initialMembers, setInitialMembers] = useState<InitialMember[]>([])
  const [memberSearchQuery, setMemberSearchQuery] = useState('')

  // Members Modal
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState<SharedFolder | null>(null)
  const [members, setMembers] = useState<SharedFolderMember[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [addingMember, setAddingMember] = useState(false)
  const [newMemberUserId, setNewMemberUserId] = useState('')
  const [newMemberPermission, setNewMemberPermission] = useState(PERMISSION_READ_ONLY)
  const [memberModalSearch, setMemberModalSearch] = useState('')

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingFolder, setDeletingFolder] = useState<SharedFolder | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Stats
  const stats = {
    total: folders.length,
    active: folders.filter(f => f.isActive).length,
    totalMembers: folders.reduce((sum, f) => sum + (f.memberCount || 0), 0),
  }

  // Load folders
  const loadFolders = useCallback(async () => {
    try {
      setLoading(true)
      const data = await getAllSharedFolders()
      setFolders(data)
      setError(null)
    } catch (err) {
      setError('공유 드라이브를 불러오는데 실패했습니다')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFolders()
  }, [loadFolders])

  // ESC key to close modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDeleteConfirm) {
          setShowDeleteConfirm(false)
          setDeletingFolder(null)
        } else if (showMembersModal) {
          setShowMembersModal(false)
          setSelectedFolder(null)
        } else if (showModal) {
          setShowModal(false)
          setEditingFolder(null)
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showModal, showMembersModal, showDeleteConfirm])

  // Filter folders
  const filteredFolders = folders.filter(folder =>
    folder.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (folder.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Handle view mode change
  const handleViewModeChange = (mode: 'grid' | 'list') => {
    setViewMode(mode)
    localStorage.setItem('filehatch-shared-folders-view', mode)
  }

  // Load users for create modal
  const loadAllUsers = async () => {
    setLoadingUsers(true)
    try {
      const usersData = await getUsers()
      setAllUsers(usersData)
    } catch (err) {
      console.error('Failed to load users:', err)
    } finally {
      setLoadingUsers(false)
    }
  }

  // Open create modal
  const handleCreate = async () => {
    setEditingFolder(null)
    setFormData({
      name: '',
      description: '',
      storageQuota: 0,
      storageQuotaUnit: 'GB',
      isActive: true,
    })
    setFormError(null)
    setInitialMembers([])
    setMemberSearchQuery('')
    setShowModal(true)
    await loadAllUsers()
  }

  // Open edit modal
  const handleEdit = async (folder: SharedFolder) => {
    setEditingFolder(folder)
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
    setInitialMembers([])
    setMemberSearchQuery('')
    setShowModal(true)
  }

  // Add initial member (for create modal)
  const handleAddInitialMember = (user: User, permission: number) => {
    if (initialMembers.some(m => m.userId === user.id)) return
    setInitialMembers([...initialMembers, {
      userId: user.id,
      username: user.username,
      email: user.email,
      permission,
    }])
  }

  // Remove initial member
  const handleRemoveInitialMember = (userId: string) => {
    setInitialMembers(initialMembers.filter(m => m.userId !== userId))
  }

  // Update initial member permission
  const handleUpdateInitialMemberPermission = (userId: string, permission: number) => {
    setInitialMembers(initialMembers.map(m =>
      m.userId === userId ? { ...m, permission } : m
    ))
  }

  // Filter available users for initial member selection
  const availableUsersForInitial = allUsers.filter(u =>
    !initialMembers.some(m => m.userId === u.id) &&
    (u.username.toLowerCase().includes(memberSearchQuery.toLowerCase()) ||
     (u.email || '').toLowerCase().includes(memberSearchQuery.toLowerCase()))
  )

  // Save folder
  const handleSave = async () => {
    if (!formData.name.trim()) {
      setFormError('이름을 입력하세요')
      return
    }

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
        // Create new folder
        const newFolder = await createSharedFolder({
          name: formData.name.trim(),
          description: formData.description.trim(),
          storageQuota: quotaBytes,
        })

        // Add initial members if any
        if (initialMembers.length > 0 && newFolder?.id) {
          for (const member of initialMembers) {
            try {
              await addSharedFolderMember(newFolder.id, member.userId, member.permission)
            } catch (err) {
              console.error(`Failed to add member ${member.username}:`, err)
            }
          }
        }
      }
      setShowModal(false)
      loadFolders()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  // Delete folder
  const handleDelete = async () => {
    if (!deletingFolder) return
    setDeleting(true)
    try {
      await deleteSharedFolder(deletingFolder.id)
      setShowDeleteConfirm(false)
      setDeletingFolder(null)
      loadFolders()
    } catch (err) {
      alert(err instanceof Error ? err.message : '삭제에 실패했습니다')
    } finally {
      setDeleting(false)
    }
  }

  // Open members modal
  const handleManageMembers = async (folder: SharedFolder) => {
    setSelectedFolder(folder)
    setLoadingMembers(true)
    setShowMembersModal(true)
    setMemberModalSearch('')
    setNewMemberUserId('')

    try {
      const [membersData, usersData] = await Promise.all([
        getSharedFolderMembers(folder.id),
        getUsers(),
      ])
      setMembers(membersData)
      setUsers(usersData)
    } catch (err) {
      alert('멤버를 불러오는데 실패했습니다')
    } finally {
      setLoadingMembers(false)
    }
  }

  // Add member
  const handleAddMember = async (userId?: string, permission?: number) => {
    const targetUserId = userId || newMemberUserId
    const targetPermission = permission !== undefined ? permission : newMemberPermission
    if (!selectedFolder || !targetUserId) return
    setAddingMember(true)
    try {
      await addSharedFolderMember(selectedFolder.id, targetUserId, targetPermission)
      const updated = await getSharedFolderMembers(selectedFolder.id)
      setMembers(updated)
      setNewMemberUserId('')
      setNewMemberPermission(PERMISSION_READ_ONLY)
      // Reload folders to update member count
      loadFolders()
    } catch (err) {
      alert(err instanceof Error ? err.message : '멤버 추가에 실패했습니다')
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
      alert(err instanceof Error ? err.message : '권한 수정에 실패했습니다')
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
      // Reload folders to update member count
      loadFolders()
    } catch (err) {
      alert(err instanceof Error ? err.message : '멤버 제거에 실패했습니다')
    }
  }

  const availableUsers = users.filter(u => !members.some(m => m.userId === u.id))

  // Filter for member modal search
  const filteredAvailableUsers = availableUsers.filter(u =>
    u.username.toLowerCase().includes(memberModalSearch.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(memberModalSearch.toLowerCase())
  )

  const filteredMembers = members.filter(m =>
    (m.username || '').toLowerCase().includes(memberModalSearch.toLowerCase())
  )

  const getUsagePercent = (folder: SharedFolder) => {
    if (!folder.storageQuota || folder.storageQuota === 0) return 0
    return Math.min(100, ((folder.usedStorage || 0) / folder.storageQuota) * 100)
  }

  if (loading) {
    return (
      <div className="admin-shared-folders-page">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>공유 드라이브를 불러오는 중...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-shared-folders-page">
      {/* Header */}
      <div className="page-header">
        <div className="header-content">
          <div className="header-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <h1>공유 드라이브</h1>
            <p>팀원들과 파일을 공유할 수 있는 드라이브를 관리합니다.</p>
          </div>
        </div>
        <button className="create-btn" onClick={handleCreate}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          새 공유 드라이브
        </button>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-icon total">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats.total}</span>
            <span className="stat-label">전체 드라이브</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon active">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49707C5.79935 3.85782 7.69279 2.71538 9.79619 2.24015C11.8996 1.76491 14.1003 1.98234 16.07 2.86" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M22 4L12 14.01L9 11.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats.active}</span>
            <span className="stat-label">활성 드라이브</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon members">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
              <path d="M23 21V19C22.9993 18.1137 22.7044 17.2528 22.1614 16.5523C21.6184 15.8519 20.8581 15.3516 20 15.13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M16 3.13C16.8604 3.35031 17.623 3.85071 18.1676 4.55232C18.7122 5.25392 19.0078 6.11683 19.0078 7.005C19.0078 7.89318 18.7122 8.75608 18.1676 9.45769C17.623 10.1593 16.8604 10.6597 16 10.88" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats.totalMembers}</span>
            <span className="stat-label">전체 멤버</span>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Toolbar */}
      <div className="toolbar">
        <div className="search-box">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
            <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder="드라이브 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-search" onClick={() => setSearchQuery('')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
        <div className="view-toggle">
          <button
            className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('grid')}
            title="그리드 뷰"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2"/>
              <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2"/>
              <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2"/>
              <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </button>
          <button
            className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('list')}
            title="리스트 뷰"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M8 6H21M8 12H21M8 18H21M3 6H3.01M3 12H3.01M3 18H3.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Folders Grid/List */}
      {filteredFolders.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
              <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
          </div>
          <h3>{searchQuery ? '검색 결과가 없습니다' : '공유 드라이브가 없습니다'}</h3>
          <p>{searchQuery ? '다른 검색어로 시도해보세요' : '새 공유 드라이브를 생성하여 팀원들과 파일을 공유하세요.'}</p>
          {!searchQuery && (
            <button className="create-btn" onClick={handleCreate}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              새 공유 드라이브
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="folders-grid">
          {filteredFolders.map(folder => (
            <div key={folder.id} className={`folder-card ${!folder.isActive ? 'inactive' : ''}`}>
              <div className="folder-card-header">
                <div className="folder-icon-wrapper">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" fill="#3B82F6" stroke="#3B82F6" strokeWidth="2"/>
                  </svg>
                </div>
                <div className="folder-status">
                  <span className={`status-badge ${folder.isActive ? 'active' : 'inactive'}`}>
                    {folder.isActive ? '활성' : '비활성'}
                  </span>
                </div>
              </div>

              <div className="folder-info">
                <h3 className="folder-name">{folder.name}</h3>
                <p className="folder-description">{folder.description || '설명 없음'}</p>
              </div>

              <div className="folder-stats">
                <div className="folder-stat">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                  <span>{folder.memberCount || 0}명</span>
                </div>
                <div className="folder-stat">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M22 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M5.45 5.11L2 12V18C2 18.5304 2.21071 19.0391 2.58579 19.4142C2.96086 19.7893 3.46957 20 4 20H20C20.5304 20 21.0391 19.7893 21.4142 19.4142C21.7893 19.0391 22 18.5304 22 18V12L18.55 5.11C18.3844 4.77679 18.1292 4.49637 17.813 4.30028C17.4967 4.10419 17.1321 4.0002 16.76 4H7.24C6.86792 4.0002 6.50326 4.10419 6.18704 4.30028C5.87083 4.49637 5.61558 4.77679 5.45 5.11Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>
                    {folder.storageQuota > 0
                      ? `${formatStorageSize(folder.usedStorage || 0)} / ${formatStorageSize(folder.storageQuota)}`
                      : '무제한'
                    }
                  </span>
                </div>
              </div>

              {folder.storageQuota > 0 && (
                <div className="storage-progress">
                  <div
                    className={`storage-bar ${getUsagePercent(folder) > 90 ? 'danger' : getUsagePercent(folder) > 70 ? 'warning' : ''}`}
                    style={{ width: `${getUsagePercent(folder)}%` }}
                  />
                </div>
              )}

              <div className="folder-actions">
                <button
                  className="action-btn members"
                  onClick={() => handleManageMembers(folder)}
                  title="멤버 관리"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                    <path d="M23 21V19C22.9993 18.1137 22.7044 17.2528 22.1614 16.5523C21.6184 15.8519 20.8581 15.3516 20 15.13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M16 3.13C16.8604 3.35031 17.623 3.85071 18.1676 4.55232C18.7122 5.25392 19.0078 6.11683 19.0078 7.005C19.0078 7.89318 18.7122 8.75608 18.1676 9.45769C17.623 10.1593 16.8604 10.6597 16 10.88" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  멤버
                </button>
                <button
                  className="action-btn edit"
                  onClick={() => handleEdit(folder)}
                  title="수정"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <button
                  className="action-btn delete"
                  onClick={() => { setDeletingFolder(folder); setShowDeleteConfirm(true) }}
                  title="삭제"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="folders-list">
          {filteredFolders.map(folder => (
            <div key={folder.id} className={`folder-row ${!folder.isActive ? 'inactive' : ''}`}>
              <div className="folder-row-main">
                <div className="folder-icon-sm">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" fill="#3B82F6" stroke="#3B82F6" strokeWidth="2"/>
                  </svg>
                </div>
                <div className="folder-row-info">
                  <span className="folder-row-name">{folder.name}</span>
                  <span className="folder-row-desc">{folder.description || '설명 없음'}</span>
                </div>
              </div>
              <div className="folder-row-meta">
                <span className="meta-item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2"/>
                    <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                  {folder.memberCount || 0}
                </span>
                <span className="meta-item">
                  {folder.storageQuota > 0
                    ? `${formatStorageSize(folder.usedStorage || 0)} / ${formatStorageSize(folder.storageQuota)}`
                    : '무제한'
                  }
                </span>
                <span className={`status-pill ${folder.isActive ? 'active' : 'inactive'}`}>
                  {folder.isActive ? '활성' : '비활성'}
                </span>
              </div>
              <div className="folder-row-actions">
                <button className="row-action-btn" onClick={() => handleManageMembers(folder)} title="멤버 관리">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2"/>
                    <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </button>
                <button className="row-action-btn" onClick={() => handleEdit(folder)} title="수정">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2"/>
                    <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </button>
                <button className="row-action-btn danger" onClick={() => { setDeletingFolder(folder); setShowDeleteConfirm(true) }} title="삭제">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M19 6V20C19 21.1046 18.1046 22 17 22H7C5.89543 22 5 21.1046 5 20V6" stroke="currentColor" strokeWidth="2"/>
                    <path d="M8 6V4C8 2.89543 8.89543 2 10 2H14C15.1046 2 16 2.89543 16 4V6" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="sf-modal create-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <div className="modal-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </div>
                <h2>{editingFolder ? '공유 드라이브 수정' : '새 공유 드라이브'}</h2>
              </div>
              <button className="close-btn" onClick={() => setShowModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              {formError && <div className="form-error">{formError}</div>}

              <div className="form-section">
                <h3 className="form-section-title">기본 정보</h3>
                <div className="form-group">
                  <label>드라이브 이름 *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    placeholder="예: 마케팅팀 공유폴더"
                  />
                </div>

                <div className="form-group">
                  <label>설명</label>
                  <textarea
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                    placeholder="이 드라이브의 용도를 설명해주세요 (선택사항)"
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
                      placeholder="0"
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
                    <label className="toggle-label">
                      <span>활성화 상태</span>
                      <div className={`toggle-switch ${formData.isActive ? 'active' : ''}`}>
                        <input
                          type="checkbox"
                          checked={formData.isActive}
                          onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                        />
                        <span className="toggle-slider"></span>
                      </div>
                    </label>
                  </div>
                )}
              </div>

              {/* Initial Members Section - Only for Create */}
              {!editingFolder && (
                <div className="form-section">
                  <h3 className="form-section-title">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                    초기 멤버 할당
                    <span className="section-badge">{initialMembers.length}명</span>
                  </h3>

                  {/* Selected Members */}
                  {initialMembers.length > 0 && (
                    <div className="initial-members-list">
                      {initialMembers.map(member => (
                        <div key={member.userId} className="initial-member-item">
                          <div className="member-info">
                            <div className="member-avatar">
                              {member.username.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="member-details">
                              <span className="member-name">{member.username}</span>
                              {member.email && <span className="member-email">{member.email}</span>}
                            </div>
                          </div>
                          <div className="member-actions">
                            <select
                              value={member.permission}
                              onChange={e => handleUpdateInitialMemberPermission(member.userId, Number(e.target.value))}
                              className="permission-select"
                            >
                              <option value={PERMISSION_READ_ONLY}>읽기 전용</option>
                              <option value={PERMISSION_READ_WRITE}>읽기/쓰기</option>
                            </select>
                            <button
                              className="remove-btn"
                              onClick={() => handleRemoveInitialMember(member.userId)}
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

                  {/* Add Members */}
                  <div className="add-member-section">
                    <div className="member-search-box">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                        <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      <input
                        type="text"
                        placeholder="사용자 검색..."
                        value={memberSearchQuery}
                        onChange={e => setMemberSearchQuery(e.target.value)}
                      />
                      {memberSearchQuery && (
                        <button className="clear-btn" onClick={() => setMemberSearchQuery('')}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                          </svg>
                        </button>
                      )}
                    </div>

                    {loadingUsers ? (
                      <div className="users-loading">
                        <div className="spinner small"></div>
                        <span>사용자 목록을 불러오는 중...</span>
                      </div>
                    ) : (
                      <div className="available-users-list">
                        {availableUsersForInitial.length === 0 ? (
                          <div className="no-users">
                            {memberSearchQuery ? '검색 결과가 없습니다' : '추가 가능한 사용자가 없습니다'}
                          </div>
                        ) : (
                          availableUsersForInitial.slice(0, 5).map(user => (
                            <div key={user.id} className="available-user-item">
                              <div className="user-info">
                                <div className="user-avatar">
                                  {user.username.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="user-details">
                                  <span className="user-name">{user.username}</span>
                                  {user.email && <span className="user-email">{user.email}</span>}
                                </div>
                              </div>
                              <div className="user-actions">
                                <button
                                  className="add-btn readonly"
                                  onClick={() => handleAddInitialMember(user, PERMISSION_READ_ONLY)}
                                  title="읽기 전용으로 추가"
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                    <path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                                  </svg>
                                  읽기
                                </button>
                                <button
                                  className="add-btn readwrite"
                                  onClick={() => handleAddInitialMember(user, PERMISSION_READ_WRITE)}
                                  title="읽기/쓰기로 추가"
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                    <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                  편집
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                        {availableUsersForInitial.length > 5 && (
                          <div className="more-users-hint">
                            + {availableUsersForInitial.length - 5}명 더 있음 (검색하여 찾기)
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowModal(false)}>취소</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <div className="btn-spinner"></div>
                    저장 중...
                  </>
                ) : (
                  editingFolder ? '수정' : '생성'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members Modal */}
      {showMembersModal && selectedFolder && (
        <div className="modal-overlay" onClick={() => setShowMembersModal(false)}>
          <div className="sf-modal members-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <div className="modal-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </div>
                <div>
                  <h2>멤버 관리</h2>
                  <p className="modal-subtitle">{selectedFolder.name}</p>
                </div>
              </div>
              <button className="close-btn" onClick={() => setShowMembersModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              {loadingMembers ? (
                <div className="loading-container small">
                  <div className="spinner"></div>
                  <p>멤버를 불러오는 중...</p>
                </div>
              ) : (
                <>
                  {/* Search box */}
                  <div className="member-search-box" style={{ marginBottom: '20px' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                      <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <input
                      type="text"
                      placeholder="멤버 또는 사용자 검색..."
                      value={memberModalSearch}
                      onChange={e => setMemberModalSearch(e.target.value)}
                    />
                    {memberModalSearch && (
                      <button className="clear-btn" onClick={() => setMemberModalSearch('')}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Add member section */}
                  <div className="add-member-section">
                    <h3>멤버 추가 {filteredAvailableUsers.length > 0 && <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>({filteredAvailableUsers.length}명)</span>}</h3>
                    {filteredAvailableUsers.length === 0 ? (
                      <div className="no-users">
                        {memberModalSearch ? '검색 결과가 없습니다' : '추가 가능한 사용자가 없습니다'}
                      </div>
                    ) : (
                      <div className="available-users-list">
                        {filteredAvailableUsers.slice(0, 10).map(user => (
                          <div key={user.id} className="available-user-item">
                            <div className="user-info">
                              <div className="user-avatar">
                                {user.username.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="user-details">
                                <span className="user-name">{user.username}</span>
                              </div>
                            </div>
                            <div className="user-actions">
                              <button
                                className="add-btn readonly"
                                onClick={() => handleAddMember(user.id, PERMISSION_READ_ONLY)}
                                disabled={addingMember}
                                title="읽기 전용으로 추가"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                  <path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                                </svg>
                              </button>
                              <button
                                className="add-btn readwrite"
                                onClick={() => handleAddMember(user.id, PERMISSION_READ_WRITE)}
                                disabled={addingMember}
                                title="읽기/쓰기로 추가"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                  <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))}
                        {filteredAvailableUsers.length > 10 && (
                          <div className="more-users-hint">
                            + {filteredAvailableUsers.length - 10}명 더 있음
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Members list */}
                  <div className="members-section">
                    <h3>현재 멤버 ({members.length}){memberModalSearch && filteredMembers.length !== members.length && <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}> - {filteredMembers.length}명 표시</span>}</h3>
                    {members.length === 0 ? (
                      <div className="no-members">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                          <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/>
                        </svg>
                        <p>아직 멤버가 없습니다</p>
                      </div>
                    ) : filteredMembers.length === 0 ? (
                      <div className="no-members">
                        <p>검색 결과가 없습니다</p>
                      </div>
                    ) : (
                      <div className="members-list">
                        {filteredMembers.map(member => (
                          <div key={member.id} className="member-item">
                            <div className="member-info">
                              <div className="member-avatar">
                                {(member.username || '??').slice(0, 2).toUpperCase()}
                              </div>
                              <span className="member-name">{member.username || '알 수 없음'}</span>
                            </div>
                            <div className="member-actions">
                              <select
                                value={member.permissionLevel}
                                onChange={e => handleUpdatePermission(member.userId, Number(e.target.value))}
                                className="permission-select"
                              >
                                <option value={PERMISSION_READ_ONLY}>{getPermissionLabel(PERMISSION_READ_ONLY)}</option>
                                <option value={PERMISSION_READ_WRITE}>{getPermissionLabel(PERMISSION_READ_WRITE)}</option>
                              </select>
                              <button
                                className="remove-member-btn"
                                onClick={() => handleRemoveMember(member.userId)}
                                title="멤버 제거"
                              >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
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
          <div className="sf-modal confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="confirm-content">
              <div className="confirm-icon danger">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M10.29 3.86L1.82 18C1.64 18.3 1.55 18.6 1.55 19C1.55 19.4 1.64 19.7 1.82 20C2.0 20.3 2.25 20.6 2.55 20.8C2.85 21.0 3.18 21.1 3.55 21.1H20.49C20.86 21.1 21.19 21.0 21.49 20.8C21.79 20.6 22.04 20.3 22.22 20C22.4 19.7 22.49 19.4 22.49 19C22.49 18.6 22.4 18.3 22.22 18L13.75 3.86C13.57 3.56 13.32 3.33 13.02 3.15C12.72 2.97 12.38 2.88 12.02 2.88C11.66 2.88 11.32 2.97 11.02 3.15C10.72 3.33 10.47 3.56 10.29 3.86Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 9V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="17" r="1" fill="currentColor"/>
                </svg>
              </div>
              <h2>공유 드라이브 삭제</h2>
              <p>
                <strong>{deletingFolder.name}</strong> 드라이브를 삭제하시겠습니까?
              </p>
              <p className="warning-text">
                이 작업은 되돌릴 수 없으며, 모든 파일이 영구적으로 삭제됩니다.
              </p>
            </div>
            <div className="confirm-actions">
              <button className="btn-secondary" onClick={() => setShowDeleteConfirm(false)}>취소</button>
              <button className="btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminSharedFolders
