import { useState, useEffect, useCallback } from 'react'
import {
  listExternalStorages,
  getExternalStorage,
  createExternalStorage,
  updateExternalStorage,
  deleteExternalStorage,
  testExternalStorage,
  listExternalStorageAccess,
  grantExternalStorageAccess,
  updateExternalStorageAccess as updateAccess,
  revokeExternalStorageAccess,
  ExternalStorage,
  ExternalStorageAccess,
  formatStorageSize,
  getBackendTypeLabel,
  getStatusLabel,
  PERMISSION_READ,
  PERMISSION_READ_WRITE,
} from '../api/externalStorages'
import { api } from '../api/client'
import './AdminExternalStorages.css'

interface User {
  id: string
  username: string
  email: string
  isAdmin: boolean
}

async function getUsers(): Promise<User[]> {
  const data = await api.get<{ users: User[] }>('/admin/users')
  return data.users
}

function AdminExternalStorages() {
  const [storages, setStorages] = useState<ExternalStorage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Create/Edit Modal
  const [showModal, setShowModal] = useState(false)
  const [editingStorage, setEditingStorage] = useState<ExternalStorage | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    mountPath: '',
    backendType: 's3' as 's3' | 'local-mount',
    isReadonly: false,
    storageQuota: 0,
    storageQuotaUnit: 'GB' as 'MB' | 'GB' | 'TB',
    // S3 config
    s3Endpoint: '',
    s3Region: 'us-east-1',
    s3Bucket: '',
    s3AccessKeyId: '',
    s3SecretAccessKey: '',
    s3PathStyle: true,
    s3Prefix: '',
    // Local mount config
    localPath: '',
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Test connection
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latencyMs?: number } | null>(null)

  // Access Modal
  const [showAccessModal, setShowAccessModal] = useState(false)
  const [selectedStorage, setSelectedStorage] = useState<ExternalStorage | null>(null)
  const [accessList, setAccessList] = useState<ExternalStorageAccess[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loadingAccess, setLoadingAccess] = useState(false)
  const [addingAccess, setAddingAccess] = useState(false)
  const [accessSearch, setAccessSearch] = useState('')

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingStorage, setDeletingStorage] = useState<ExternalStorage | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Stats
  const stats = {
    total: storages.length,
    active: storages.filter(s => s.status === 'active').length,
    s3Count: storages.filter(s => s.backendType === 's3').length,
    localCount: storages.filter(s => s.backendType === 'local-mount').length,
  }

  // Load storages
  const loadStorages = useCallback(async () => {
    try {
      setLoading(true)
      const data = await listExternalStorages()
      setStorages(data)
      setError(null)
    } catch {
      setError('외부 스토리지를 불러오는데 실패했습니다')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStorages()
  }, [loadStorages])

  // ESC key to close modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDeleteConfirm) {
          setShowDeleteConfirm(false)
          setDeletingStorage(null)
        } else if (showAccessModal) {
          setShowAccessModal(false)
          setSelectedStorage(null)
        } else if (showModal) {
          setShowModal(false)
          setEditingStorage(null)
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showModal, showAccessModal, showDeleteConfirm])

  // Filter storages
  const filteredStorages = storages.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.mountPath.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.backendType.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Open create modal
  const handleCreate = () => {
    setEditingStorage(null)
    setFormData({
      name: '',
      mountPath: '',
      backendType: 's3',
      isReadonly: false,
      storageQuota: 0,
      storageQuotaUnit: 'GB',
      s3Endpoint: '',
      s3Region: 'us-east-1',
      s3Bucket: '',
      s3AccessKeyId: '',
      s3SecretAccessKey: '',
      s3PathStyle: true,
      s3Prefix: '',
      localPath: '',
    })
    setFormError(null)
    setTestResult(null)
    setShowModal(true)
  }

  // Open edit modal
  const handleEdit = async (storage: ExternalStorage) => {
    setEditingStorage(storage)
    setFormError(null)
    setTestResult(null)
    setShowModal(true)

    // Fetch full storage details including config
    try {
      const detail = await getExternalStorage(storage.id)
      const config = detail.config || {}

      let quota = detail.storageQuota
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
        name: detail.name,
        mountPath: detail.mountPath,
        backendType: detail.backendType as 's3' | 'local-mount',
        isReadonly: detail.isReadonly,
        storageQuota: quota,
        storageQuotaUnit: unit,
        s3Endpoint: (config.endpoint as string) || '',
        s3Region: (config.region as string) || 'us-east-1',
        s3Bucket: (config.bucket as string) || '',
        s3AccessKeyId: '',
        s3SecretAccessKey: '',
        s3PathStyle: config.path_style !== false,
        s3Prefix: (config.prefix as string) || '',
        localPath: (config.path as string) || '',
      })
    } catch {
      setFormData(prev => ({
        ...prev,
        name: storage.name,
        mountPath: storage.mountPath,
        backendType: storage.backendType as 's3' | 'local-mount',
        isReadonly: storage.isReadonly,
      }))
      setFormError('설정 정보를 불러오지 못했습니다')
    }
  }

  // Save storage
  const handleSave = async () => {
    if (!formData.name.trim()) {
      setFormError('이름을 입력하세요')
      return
    }
    if (!editingStorage && !formData.mountPath.trim()) {
      setFormError('마운트 경로를 입력하세요')
      return
    }

    let quotaBytes = formData.storageQuota
    if (quotaBytes > 0) {
      switch (formData.storageQuotaUnit) {
        case 'MB': quotaBytes *= 1024 * 1024; break
        case 'GB': quotaBytes *= 1024 * 1024 * 1024; break
        case 'TB': quotaBytes *= 1024 * 1024 * 1024 * 1024; break
      }
    }

    setSaving(true)
    try {
      if (editingStorage) {
        const updateData: Record<string, unknown> = {
          name: formData.name.trim(),
          storageQuota: quotaBytes,
          isReadonly: formData.isReadonly,
        }
        if (formData.backendType === 's3') {
          const config: Record<string, unknown> = {
            endpoint: formData.s3Endpoint.trim(),
            region: formData.s3Region.trim(),
            bucket: formData.s3Bucket.trim(),
            path_style: formData.s3PathStyle,
            prefix: formData.s3Prefix.trim(),
          }
          if (formData.s3AccessKeyId) config.access_key_id = formData.s3AccessKeyId.trim()
          if (formData.s3SecretAccessKey) config.secret_access_key = formData.s3SecretAccessKey.trim()
          updateData.config = config
        } else {
          updateData.config = { path: formData.localPath.trim() }
        }
        await updateExternalStorage(editingStorage.id, updateData)
      } else {
        const config = formData.backendType === 's3'
          ? {
              endpoint: formData.s3Endpoint.trim(),
              region: formData.s3Region.trim(),
              bucket: formData.s3Bucket.trim(),
              access_key_id: formData.s3AccessKeyId.trim(),
              secret_access_key: formData.s3SecretAccessKey.trim(),
              path_style: formData.s3PathStyle,
              prefix: formData.s3Prefix.trim(),
            }
          : { path: formData.localPath.trim() }

        await createExternalStorage({
          name: formData.name.trim(),
          mountPath: formData.mountPath.trim(),
          backendType: formData.backendType,
          config,
          storageQuota: quotaBytes,
          isReadonly: formData.isReadonly,
        })
      }
      setShowModal(false)
      loadStorages()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  // Test connection
  const handleTest = async (storageId: string) => {
    setTesting(storageId)
    setTestResult(null)
    try {
      const result = await testExternalStorage(storageId)
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : '연결 테스트 실패' })
    } finally {
      setTesting(null)
    }
  }

  // Delete storage
  const handleDelete = async () => {
    if (!deletingStorage) return
    setDeleting(true)
    try {
      await deleteExternalStorage(deletingStorage.id)
      setShowDeleteConfirm(false)
      setDeletingStorage(null)
      loadStorages()
    } catch (err) {
      alert(err instanceof Error ? err.message : '삭제에 실패했습니다')
    } finally {
      setDeleting(false)
    }
  }

  // Open access modal
  const handleManageAccess = async (storage: ExternalStorage) => {
    setSelectedStorage(storage)
    setLoadingAccess(true)
    setShowAccessModal(true)
    setAccessSearch('')

    try {
      const [accessData, usersData] = await Promise.all([
        listExternalStorageAccess(storage.id),
        getUsers(),
      ])
      setAccessList(accessData)
      setUsers(usersData)
    } catch {
      alert('접근 권한을 불러오는데 실패했습니다')
    } finally {
      setLoadingAccess(false)
    }
  }

  // Grant access
  const handleGrantAccess = async (userId: string, permission: number) => {
    if (!selectedStorage) return
    setAddingAccess(true)
    try {
      await grantExternalStorageAccess(selectedStorage.id, userId, permission)
      const updated = await listExternalStorageAccess(selectedStorage.id)
      setAccessList(updated)
    } catch (err) {
      alert(err instanceof Error ? err.message : '권한 추가에 실패했습니다')
    } finally {
      setAddingAccess(false)
    }
  }

  // Update access permission
  const handleUpdateAccess = async (userId: string, level: number) => {
    if (!selectedStorage) return
    try {
      await updateAccess(selectedStorage.id, userId, level)
      const updated = await listExternalStorageAccess(selectedStorage.id)
      setAccessList(updated)
    } catch (err) {
      alert(err instanceof Error ? err.message : '권한 수정에 실패했습니다')
    }
  }

  // Revoke access
  const handleRevokeAccess = async (userId: string) => {
    if (!selectedStorage) return
    if (!confirm('이 사용자의 접근 권한을 제거하시겠습니까?')) return
    try {
      await revokeExternalStorageAccess(selectedStorage.id, userId)
      const updated = await listExternalStorageAccess(selectedStorage.id)
      setAccessList(updated)
    } catch (err) {
      alert(err instanceof Error ? err.message : '권한 제거에 실패했습니다')
    }
  }

  const availableUsers = users.filter(u => !accessList.some(a => a.userId === u.id))
  const filteredAvailableUsers = availableUsers.filter(u =>
    u.username.toLowerCase().includes(accessSearch.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(accessSearch.toLowerCase())
  )
  const filteredAccess = accessList.filter(a =>
    (a.username || '').toLowerCase().includes(accessSearch.toLowerCase())
  )

  if (loading) {
    return (
      <div className="admin-external-storages-page">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>외부 스토리지를 불러오는 중...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-external-storages-page">
      {/* Header */}
      <div className="page-header">
        <div className="header-content">
          <div className="header-icon es-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M22 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5.45 5.11L2 12V18C2 18.5304 2.21071 19.0391 2.58579 19.4142C2.96086 19.7893 3.46957 20 4 20H20C20.5304 20 21.0391 19.7893 21.4142 19.4142C21.7893 19.0391 22 18.5304 22 18V12L18.55 5.11C18.3844 4.77679 18.1292 4.49637 17.813 4.30028C17.4967 4.10419 17.1321 4.0002 16.76 4H7.24C6.86792 4.0002 6.50326 4.10419 6.18704 4.30028C5.87083 4.49637 5.61558 4.77679 5.45 5.11Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <h1>외부 스토리지</h1>
            <p>S3 호환 스토리지 및 로컬 마운트를 관리합니다.</p>
          </div>
        </div>
        <button className="create-btn" onClick={handleCreate}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          외부 스토리지 추가
        </button>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-icon total">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M22 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <path d="M5.45 5.11L2 12V18C2 18.5304 2.21071 19.0391 2.58579 19.4142C2.96086 19.7893 3.46957 20 4 20H20C20.5304 20 21.0391 19.7893 21.4142 19.4142C21.7893 19.0391 22 18.5304 22 18V12L18.55 5.11C18.3844 4.77679 18.1292 4.49637 17.813 4.30028C17.4967 4.10419 17.1321 4.0002 16.76 4H7.24" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats.total}</span>
            <span className="stat-label">전체 스토리지</span>
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
            <span className="stat-label">활성 스토리지</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon s3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M21 16V8a2 2 0 0 0-1-1.73L13 2.27a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats.s3Count} / {stats.localCount}</span>
            <span className="stat-label">S3 / 로컬</span>
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
            placeholder="스토리지 검색..."
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
      </div>

      {/* Storages List */}
      {filteredStorages.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
              <path d="M22 12H2" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M5.45 5.11L2 12V18C2 18.5304 2.21071 19.0391 2.58579 19.4142C2.96086 19.7893 3.46957 20 4 20H20C20.5304 20 21.0391 19.7893 21.4142 19.4142C21.7893 19.0391 22 18.5304 22 18V12L18.55 5.11C18.3844 4.77679 18.1292 4.49637 17.813 4.30028C17.4967 4.10419 17.1321 4.0002 16.76 4H7.24" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
          </div>
          <h3>{searchQuery ? '검색 결과가 없습니다' : '외부 스토리지가 없습니다'}</h3>
          <p>{searchQuery ? '다른 검색어로 시도해보세요' : 'S3 호환 스토리지나 로컬 마운트를 추가하세요.'}</p>
          {!searchQuery && (
            <button className="create-btn" onClick={handleCreate}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              외부 스토리지 추가
            </button>
          )}
        </div>
      ) : (
        <div className="es-list">
          {filteredStorages.map(storage => (
            <div key={storage.id} className={`es-card ${storage.status !== 'active' ? 'inactive' : ''}`}>
              <div className="es-card-header">
                <div className="es-type-badge-wrapper">
                  <span className={`es-type-badge ${storage.backendType}`}>
                    {storage.backendType === 's3' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73L13 2.27a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" stroke="currentColor" strokeWidth="2"/>
                        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" stroke="currentColor" strokeWidth="2"/>
                        <circle cx="6" cy="6" r="1" fill="currentColor"/>
                        <circle cx="6" cy="18" r="1" fill="currentColor"/>
                      </svg>
                    )}
                    {getBackendTypeLabel(storage.backendType)}
                  </span>
                </div>
                <div className="es-status-group">
                  {storage.isReadonly && (
                    <span className="es-readonly-badge">읽기전용</span>
                  )}
                  <span className={`status-badge ${storage.status}`}>
                    {getStatusLabel(storage.status)}
                  </span>
                </div>
              </div>

              <div className="es-info">
                <h3 className="es-name">{storage.name}</h3>
                <p className="es-mount-path">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                  /external/{storage.mountPath}
                </p>
                {storage.statusMessage && storage.status === 'error' && (
                  <p className="es-error-message">{storage.statusMessage}</p>
                )}
              </div>

              <div className="es-meta">
                <div className="es-stat">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M22 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M5.45 5.11L2 12V18C2 18.5304 2.21071 19.0391 2.58579 19.4142C2.96086 19.7893 3.46957 20 4 20H20C20.5304 20 21.0391 19.7893 21.4142 19.4142C21.7893 19.0391 22 18.5304 22 18V12L18.55 5.11" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                  <span>
                    {storage.storageQuota > 0
                      ? `${formatStorageSize(storage.storageUsed)} / ${formatStorageSize(storage.storageQuota)}`
                      : formatStorageSize(storage.storageUsed)
                    }
                  </span>
                </div>
                {storage.lastCheckedAt && (
                  <div className="es-stat">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                      <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <span>{new Date(storage.lastCheckedAt).toLocaleString()}</span>
                  </div>
                )}
              </div>

              <div className="es-actions">
                <button
                  className="action-btn test"
                  onClick={() => handleTest(storage.id)}
                  disabled={testing === storage.id}
                  title="연결 테스트"
                >
                  {testing === storage.id ? (
                    <div className="btn-spinner"></div>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      <path d="M22 4L12 14.01L9 11.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  테스트
                </button>
                <button
                  className="action-btn members"
                  onClick={() => handleManageAccess(storage)}
                  title="접근 권한"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                  권한
                </button>
                <button
                  className="action-btn edit"
                  onClick={() => handleEdit(storage)}
                  title="수정"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <button
                  className="action-btn delete"
                  onClick={() => { setDeletingStorage(storage); setShowDeleteConfirm(true) }}
                  title="삭제"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>

              {/* Test result inline */}
              {testResult && testing === null && selectedStorage?.id !== storage.id && (
                <div className={`es-test-result ${testResult.success ? 'success' : 'error'}`}
                  style={{ display: testResult ? 'flex' : 'none' }}
                  onClick={() => setTestResult(null)}
                >
                  {testResult.success ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M22 4L12 14.01L9 11.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  )}
                  <span>{testResult.message}</span>
                  {testResult.latencyMs !== undefined && <span className="latency">({testResult.latencyMs}ms)</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="es-modal create-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <div className="modal-icon es-modal-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M22 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M5.45 5.11L2 12V18C2 18.5304 2.21071 19.0391 2.58579 19.4142C2.96086 19.7893 3.46957 20 4 20H20C20.5304 20 21.0391 19.7893 21.4142 19.4142C21.7893 19.0391 22 18.5304 22 18V12L18.55 5.11" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </div>
                <h2>{editingStorage ? '외부 스토리지 수정' : '외부 스토리지 추가'}</h2>
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
                  <label>이름 *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    placeholder="예: 회사 S3, NAS 백업"
                  />
                </div>

                {!editingStorage && (
                  <div className="form-group">
                    <label>마운트 경로 *</label>
                    <div className="mount-path-input">
                      <span className="mount-prefix">/external/</span>
                      <input
                        type="text"
                        value={formData.mountPath}
                        onChange={e => setFormData({ ...formData, mountPath: e.target.value.replace(/[^a-zA-Z0-9-_]/g, '') })}
                        placeholder="company-s3"
                      />
                    </div>
                    <span className="form-hint">영문, 숫자, 하이픈, 언더스코어만 사용 가능합니다.</span>
                  </div>
                )}

                {!editingStorage && (
                  <div className="form-group">
                    <label>스토리지 타입</label>
                    <select
                      value={formData.backendType}
                      onChange={e => setFormData({ ...formData, backendType: e.target.value as 's3' | 'local-mount' })}
                    >
                      <option value="s3">S3 호환 스토리지</option>
                      <option value="local-mount">로컬 마운트</option>
                    </select>
                  </div>
                )}

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

                <div className="form-group">
                  <label className="toggle-label">
                    <span>읽기 전용</span>
                    <div className={`toggle-switch ${formData.isReadonly ? 'active' : ''}`}>
                      <input
                        type="checkbox"
                        checked={formData.isReadonly}
                        onChange={e => setFormData({ ...formData, isReadonly: e.target.checked })}
                      />
                      <span className="toggle-slider"></span>
                    </div>
                  </label>
                </div>
              </div>

              {/* S3 Config */}
              {formData.backendType === 's3' && (
                <div className="form-section">
                  <h3 className="form-section-title">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73L13 2.27a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                    S3 설정
                  </h3>
                  <div className="es-guide-box s3-guide">
                    <div className="es-guide-header">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                        <path d="M12 16V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <circle cx="12" cy="8" r="1" fill="currentColor"/>
                      </svg>
                      S3 호환 스토리지 연결 가이드
                    </div>
                    <div className="es-guide-content">
                      AWS S3, MinIO, Ceph RGW, Wasabi, Cloudflare R2, IDrive e2 등 S3 호환 API를 지원하는 스토리지를 연결할 수 있습니다.
                      <ul>
                        <li><strong>Endpoint</strong>: S3 API URL (예: <code>https://s3.amazonaws.com</code>, <code>https://minio.local:9000</code>)</li>
                        <li><strong>Path Style</strong>: MinIO, Ceph 등 자체 호스팅 시 활성화 필요</li>
                        <li><strong>Prefix</strong>: 버킷 내 특정 폴더만 사용 시 입력 (예: <code>documents/</code>)</li>
                      </ul>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Endpoint *</label>
                    <input
                      type="text"
                      value={formData.s3Endpoint}
                      onChange={e => setFormData({ ...formData, s3Endpoint: e.target.value })}
                      placeholder="https://s3.amazonaws.com 또는 https://minio.local:9000"
                    />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Region</label>
                      <input
                        type="text"
                        value={formData.s3Region}
                        onChange={e => setFormData({ ...formData, s3Region: e.target.value })}
                        placeholder="us-east-1"
                      />
                    </div>
                    <div className="form-group">
                      <label>Bucket *</label>
                      <input
                        type="text"
                        value={formData.s3Bucket}
                        onChange={e => setFormData({ ...formData, s3Bucket: e.target.value })}
                        placeholder="my-bucket"
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Access Key ID {!editingStorage && '*'}</label>
                    <input
                      type="text"
                      value={formData.s3AccessKeyId}
                      onChange={e => setFormData({ ...formData, s3AccessKeyId: e.target.value })}
                      placeholder={editingStorage ? '변경하지 않으려면 비워두세요' : 'AKIA...'}
                    />
                  </div>
                  <div className="form-group">
                    <label>Secret Access Key {!editingStorage && '*'}</label>
                    <input
                      type="password"
                      value={formData.s3SecretAccessKey}
                      onChange={e => setFormData({ ...formData, s3SecretAccessKey: e.target.value })}
                      placeholder={editingStorage ? '변경하지 않으려면 비워두세요' : '시크릿 키'}
                    />
                  </div>
                  <div className="form-group">
                    <label>Prefix (선택)</label>
                    <input
                      type="text"
                      value={formData.s3Prefix}
                      onChange={e => setFormData({ ...formData, s3Prefix: e.target.value })}
                      placeholder="documents/"
                    />
                    <span className="form-hint">버킷 내 특정 경로만 사용할 때 입력합니다.</span>
                  </div>
                  <div className="form-group">
                    <label className="toggle-label">
                      <span>Path Style (MinIO/Ceph)</span>
                      <div className={`toggle-switch ${formData.s3PathStyle ? 'active' : ''}`}>
                        <input
                          type="checkbox"
                          checked={formData.s3PathStyle}
                          onChange={e => setFormData({ ...formData, s3PathStyle: e.target.checked })}
                        />
                        <span className="toggle-slider"></span>
                      </div>
                    </label>
                    <span className="form-hint">MinIO, Ceph 등 자체 호스팅 S3의 경우 활성화합니다.</span>
                  </div>
                </div>
              )}

              {/* Local Mount Config */}
              {formData.backendType === 'local-mount' && (
                <div className="form-section">
                  <h3 className="form-section-title">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" stroke="currentColor" strokeWidth="2"/>
                      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                    로컬 마운트 설정
                  </h3>
                  <div className="es-guide-box">
                    <div className="es-guide-header">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                        <path d="M12 16V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <circle cx="12" cy="8" r="1" fill="currentColor"/>
                      </svg>
                      로컬 마운트 연결 가이드
                    </div>
                    <div className="es-guide-content">
                      서버에 이미 마운트된 NFS, SMB/CIFS, 외장 디스크 등을 연결합니다. Docker 환경에서는 호스트 경로를 컨테이너에 볼륨 마운트해야 합니다.
                      <div className="es-docker-guide">
{`# docker-compose.yml 예시
services:
  api:
    volumes:
      - /mnt/nas-share:/mnt/nas-share`}
                      </div>
                      <ul>
                        <li>호스트에서 먼저 NFS/SMB를 마운트한 후 경로를 입력하세요</li>
                        <li>컨테이너 내부 경로와 위 입력 경로가 일치해야 합니다</li>
                        <li>해당 경로의 읽기/쓰기 권한이 필요합니다</li>
                      </ul>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>서버 경로 *</label>
                    <input
                      type="text"
                      value={formData.localPath}
                      onChange={e => setFormData({ ...formData, localPath: e.target.value })}
                      placeholder="/mnt/nas-share"
                    />
                    <span className="form-hint">Docker 컨테이너 내부에서 접근 가능한 경로를 입력합니다.</span>
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
                  editingStorage ? '수정' : '생성'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Access Modal */}
      {showAccessModal && selectedStorage && (
        <div className="modal-overlay" onClick={() => setShowAccessModal(false)}>
          <div className="es-modal members-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <div className="modal-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </div>
                <div>
                  <h2>접근 권한 관리</h2>
                  <p className="modal-subtitle">{selectedStorage.name}</p>
                </div>
              </div>
              <button className="close-btn" onClick={() => setShowAccessModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              {loadingAccess ? (
                <div className="loading-container small">
                  <div className="spinner"></div>
                  <p>권한을 불러오는 중...</p>
                </div>
              ) : (
                <>
                  <div className="member-search-box" style={{ marginBottom: '20px' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                      <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <input
                      type="text"
                      placeholder="사용자 검색..."
                      value={accessSearch}
                      onChange={e => setAccessSearch(e.target.value)}
                    />
                    {accessSearch && (
                      <button className="clear-btn" onClick={() => setAccessSearch('')}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Add user section */}
                  <div className="add-member-section">
                    <h3>사용자 추가 {filteredAvailableUsers.length > 0 && <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>({filteredAvailableUsers.length}명)</span>}</h3>
                    {filteredAvailableUsers.length === 0 ? (
                      <div className="no-users">
                        {accessSearch ? '검색 결과가 없습니다' : '추가 가능한 사용자가 없습니다'}
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
                                onClick={() => handleGrantAccess(user.id, PERMISSION_READ)}
                                disabled={addingAccess}
                                title="읽기 전용"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                  <path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                                </svg>
                              </button>
                              <button
                                className="add-btn readwrite"
                                onClick={() => handleGrantAccess(user.id, PERMISSION_READ_WRITE)}
                                disabled={addingAccess}
                                title="읽기/쓰기"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                  <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2"/>
                                  <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2"/>
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

                  {/* Current access list */}
                  <div className="members-section">
                    <h3>현재 접근 권한 ({accessList.length}){accessSearch && filteredAccess.length !== accessList.length && <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}> - {filteredAccess.length}명 표시</span>}</h3>
                    {accessList.length === 0 ? (
                      <div className="no-members">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                          <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/>
                        </svg>
                        <p>접근 권한이 부여된 사용자가 없습니다</p>
                      </div>
                    ) : filteredAccess.length === 0 ? (
                      <div className="no-members">
                        <p>검색 결과가 없습니다</p>
                      </div>
                    ) : (
                      <div className="members-list">
                        {filteredAccess.map(access => (
                          <div key={access.id} className="member-item">
                            <div className="member-info">
                              <div className="member-avatar">
                                {(access.username || '??').slice(0, 2).toUpperCase()}
                              </div>
                              <span className="member-name">{access.username || '알 수 없음'}</span>
                            </div>
                            <div className="member-actions">
                              <select
                                value={access.permissionLevel}
                                onChange={e => handleUpdateAccess(access.userId, Number(e.target.value))}
                                className="permission-select"
                              >
                                <option value={PERMISSION_READ}>읽기 전용</option>
                                <option value={PERMISSION_READ_WRITE}>읽기/쓰기</option>
                              </select>
                              <button
                                className="remove-member-btn"
                                onClick={() => handleRevokeAccess(access.userId)}
                                title="권한 제거"
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
      {showDeleteConfirm && deletingStorage && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="es-modal confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="confirm-content">
              <div className="confirm-icon danger">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M10.29 3.86L1.82 18C1.64 18.3 1.55 18.6 1.55 19C1.55 19.4 1.64 19.7 1.82 20C2.0 20.3 2.25 20.6 2.55 20.8C2.85 21.0 3.18 21.1 3.55 21.1H20.49C20.86 21.1 21.19 21.0 21.49 20.8C21.79 20.6 22.04 20.3 22.22 20C22.4 19.7 22.49 19.4 22.49 19C22.49 18.6 22.4 18.3 22.22 18L13.75 3.86C13.57 3.56 13.32 3.33 13.02 3.15C12.72 2.97 12.38 2.88 12.02 2.88C11.66 2.88 11.32 2.97 11.02 3.15C10.72 3.33 10.47 3.56 10.29 3.86Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 9V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="17" r="1" fill="currentColor"/>
                </svg>
              </div>
              <h2>외부 스토리지 삭제</h2>
              <p>
                <strong>{deletingStorage.name}</strong> 스토리지를 삭제하시겠습니까?
              </p>
              <p className="warning-text">
                이 작업은 되돌릴 수 없습니다. 스토리지 연결만 제거되며, 원본 데이터는 영향받지 않습니다.
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

export default AdminExternalStorages
