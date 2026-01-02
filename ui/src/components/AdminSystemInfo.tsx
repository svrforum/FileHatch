import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../stores/authStore'
import './AdminSystemInfo.css'

const API_BASE = '/api'

interface MemoryInfo {
  total: number
  used: number
  free: number
  usedPct: number
  formatted: {
    total: string
    used: string
    free: string
  }
}

interface DiskInfo {
  total: number
  used: number
  free: number
  usedPct: number
  formatted: {
    total: string
    used: string
    free: string
  }
}

interface ProjectInfo {
  totalSize: number
  totalFiles: number
  totalFolders: number
  usersCount: number
  sharedFolders: number
  formatted: string
}

interface FolderStat {
  name: string
  path: string
  size: number
  formatted: string
  fileCount: number
  isDir: boolean
  children?: FolderStat[]
  expanded?: boolean
}

interface SystemInfo {
  hostname: string
  os: string
  arch: string
  cpus: number
  goVersion: string
  memory: MemoryInfo
  disk: DiskInfo
  uptime: string
  serverTime: string
  dataPath: string
  projectInfo: ProjectInfo
  folderTree: FolderStat[]
}

function AdminSystemInfo() {
  const { user: currentUser, token } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())

  const loadSystemInfo = useCallback(async () => {
    if (!token) return

    try {
      const response = await fetch(`${API_BASE}/admin/system-info`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!response.ok) {
        throw new Error('Failed to fetch system info')
      }

      const result = await response.json()
      setSystemInfo(result.data)
      setError(null)
    } catch (err) {
      setError('시스템 정보를 불러오는데 실패했습니다.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    loadSystemInfo()
    // Refresh every 30 seconds
    const interval = setInterval(loadSystemInfo, 30000)
    return () => clearInterval(interval)
  }, [loadSystemInfo])

  // ESC key to close expanded folders
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpandedPaths(new Set())
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const toggleFolder = async (path: string) => {
    const newExpanded = new Set(expandedPaths)

    if (newExpanded.has(path)) {
      newExpanded.delete(path)
      setExpandedPaths(newExpanded)
    } else {
      // Load children if not already loaded
      newExpanded.add(path)
      setExpandedPaths(newExpanded)

      // Fetch children for this folder
      setLoadingPaths(prev => new Set([...prev, path]))
      try {
        const response = await fetch(`${API_BASE}/admin/system-info/tree?path=${encodeURIComponent(path)}&depth=1`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (response.ok) {
          const result = await response.json()
          setSystemInfo(prev => {
            if (!prev) return prev
            return {
              ...prev,
              folderTree: updateFolderChildren(prev.folderTree, path, result.data)
            }
          })
        }
      } catch (err) {
        console.error('Failed to load folder children:', err)
      } finally {
        setLoadingPaths(prev => {
          const newSet = new Set(prev)
          newSet.delete(path)
          return newSet
        })
      }
    }
  }

  const updateFolderChildren = (folders: FolderStat[], path: string, children: FolderStat[]): FolderStat[] => {
    return folders.map(folder => {
      if (folder.path === path) {
        return { ...folder, children }
      }
      if (folder.children) {
        return { ...folder, children: updateFolderChildren(folder.children, path, children) }
      }
      return folder
    })
  }

  const renderFolderTree = (folders: FolderStat[], depth: number = 0) => {
    return folders.map(folder => {
      const isExpanded = expandedPaths.has(folder.path)
      const isLoading = loadingPaths.has(folder.path)

      return (
        <div key={folder.path} className="folder-tree-item" style={{ paddingLeft: depth * 20 }}>
          <div
            className={`folder-tree-row ${folder.isDir ? 'is-dir' : ''} ${isExpanded ? 'expanded' : ''}`}
            onClick={() => folder.isDir && toggleFolder(folder.path)}
          >
            <span className="folder-icon">
              {folder.isDir ? (
                isLoading ? (
                  <div className="folder-spinner" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d={isExpanded
                        ? "M19 9L12 16L5 9"
                        : "M9 5L16 12L9 19"
                      }
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span className="folder-name">{folder.name}</span>
            <span className="folder-size">{folder.formatted}</span>
            <span className="folder-count">{folder.fileCount.toLocaleString()} files</span>
          </div>
          {isExpanded && folder.children && folder.children.length > 0 && (
            <div className="folder-children">
              {renderFolderTree(folder.children, depth + 1)}
            </div>
          )}
        </div>
      )
    })
  }

  if (!currentUser?.isAdmin) {
    return (
      <div className="si-container">
        <div className="si-access-denied">
          <div className="si-denied-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M15 9L9 15M9 9L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <h2>접근 권한 없음</h2>
          <p>시스템 정보는 관리자만 확인할 수 있습니다.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="si-container">
        <div className="si-loading">
          <div className="si-loading-spinner" />
          <span>시스템 정보를 불러오는 중...</span>
        </div>
      </div>
    )
  }

  if (error || !systemInfo) {
    return (
      <div className="si-container">
        <div className="si-error">
          <div className="si-error-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 8V12M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <h2>오류 발생</h2>
          <p>{error}</p>
          <button onClick={loadSystemInfo} className="si-retry-btn">다시 시도</button>
        </div>
      </div>
    )
  }

  return (
    <div className="si-container">
      {/* Header */}
      <div className="si-header">
        <div className="si-header-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
            <path d="M8 21H16M12 17V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="si-header-text">
          <h1>서버 정보</h1>
          <p>시스템 상태 및 리소스 사용량을 확인합니다</p>
        </div>
        <button onClick={loadSystemInfo} className="si-refresh-btn" title="새로고침">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M1 4V10H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M23 20V14H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14L18.36 18.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      <div className="si-content">
        {/* Server Overview */}
        <div className="si-section">
          <div className="si-section-header">
            <div className="si-section-icon server">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="2" width="20" height="8" rx="2" stroke="currentColor" strokeWidth="2"/>
                <rect x="2" y="14" width="20" height="8" rx="2" stroke="currentColor" strokeWidth="2"/>
                <circle cx="6" cy="6" r="1" fill="currentColor"/>
                <circle cx="6" cy="18" r="1" fill="currentColor"/>
              </svg>
            </div>
            <div className="si-section-text">
              <h2>서버 개요</h2>
              <p>현재 서버의 기본 정보</p>
            </div>
          </div>
          <div className="si-section-content">
            <div className="si-info-grid">
              <div className="si-info-item">
                <span className="si-info-label">호스트명</span>
                <span className="si-info-value">{systemInfo.hostname}</span>
              </div>
              <div className="si-info-item">
                <span className="si-info-label">운영체제</span>
                <span className="si-info-value">{systemInfo.os} / {systemInfo.arch}</span>
              </div>
              <div className="si-info-item">
                <span className="si-info-label">CPU 코어</span>
                <span className="si-info-value">{systemInfo.cpus}개</span>
              </div>
              <div className="si-info-item">
                <span className="si-info-label">Go 버전</span>
                <span className="si-info-value">{systemInfo.goVersion}</span>
              </div>
              <div className="si-info-item">
                <span className="si-info-label">서버 가동 시간</span>
                <span className="si-info-value">{systemInfo.uptime}</span>
              </div>
              <div className="si-info-item">
                <span className="si-info-label">서버 시간</span>
                <span className="si-info-value">{systemInfo.serverTime}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Resource Usage */}
        <div className="si-section">
          <div className="si-section-header">
            <div className="si-section-icon resource">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M18 20V10M12 20V4M6 20V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="si-section-text">
              <h2>리소스 사용량</h2>
              <p>메모리 및 디스크 사용 현황</p>
            </div>
          </div>
          <div className="si-section-content">
            <div className="si-resource-cards">
              {/* Memory */}
              <div className="si-resource-card">
                <div className="si-resource-header">
                  <div className="si-resource-icon memory">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="2"/>
                      <path d="M9 9H15M9 12H15M9 15H12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <span className="si-resource-title">메모리 (RAM)</span>
                </div>
                <div className="si-resource-bar">
                  <div
                    className="si-resource-bar-fill memory"
                    style={{ width: `${Math.min(systemInfo.memory.usedPct, 100)}%` }}
                  />
                </div>
                <div className="si-resource-stats">
                  <div className="si-resource-stat">
                    <span className="stat-label">사용</span>
                    <span className="stat-value">{systemInfo.memory.formatted.used}</span>
                  </div>
                  <div className="si-resource-stat">
                    <span className="stat-label">여유</span>
                    <span className="stat-value">{systemInfo.memory.formatted.free}</span>
                  </div>
                  <div className="si-resource-stat">
                    <span className="stat-label">전체</span>
                    <span className="stat-value">{systemInfo.memory.formatted.total}</span>
                  </div>
                </div>
                <div className="si-resource-pct">{systemInfo.memory.usedPct.toFixed(1)}% 사용</div>
              </div>

              {/* Disk */}
              <div className="si-resource-card">
                <div className="si-resource-header">
                  <div className="si-resource-icon disk">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <ellipse cx="12" cy="5" rx="9" ry="3" stroke="currentColor" strokeWidth="2"/>
                      <path d="M21 12C21 13.6569 16.9706 15 12 15C7.02944 15 3 13.6569 3 12" stroke="currentColor" strokeWidth="2"/>
                      <path d="M3 5V19C3 20.6569 7.02944 22 12 22C16.9706 22 21 20.6569 21 19V5" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  </div>
                  <span className="si-resource-title">디스크</span>
                </div>
                <div className="si-resource-bar">
                  <div
                    className="si-resource-bar-fill disk"
                    style={{ width: `${Math.min(systemInfo.disk.usedPct, 100)}%` }}
                  />
                </div>
                <div className="si-resource-stats">
                  <div className="si-resource-stat">
                    <span className="stat-label">사용</span>
                    <span className="stat-value">{systemInfo.disk.formatted.used}</span>
                  </div>
                  <div className="si-resource-stat">
                    <span className="stat-label">여유</span>
                    <span className="stat-value">{systemInfo.disk.formatted.free}</span>
                  </div>
                  <div className="si-resource-stat">
                    <span className="stat-label">전체</span>
                    <span className="stat-value">{systemInfo.disk.formatted.total}</span>
                  </div>
                </div>
                <div className="si-resource-pct">{systemInfo.disk.usedPct.toFixed(1)}% 사용</div>
              </div>
            </div>
          </div>
        </div>

        {/* Project Statistics */}
        <div className="si-section">
          <div className="si-section-header">
            <div className="si-section-icon project">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M22 19C22 20.1046 21.1046 21 20 21H4C2.89543 21 2 20.1046 2 19V5C2 3.89543 2.89543 3 4 3H9L11 6H20C21.1046 6 22 6.89543 22 8V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="si-section-text">
              <h2>프로젝트 통계</h2>
              <p>SimpleCloudVault 사용 현황</p>
            </div>
          </div>
          <div className="si-section-content">
            <div className="si-stats-grid">
              <div className="si-stat-card">
                <div className="si-stat-icon files">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2"/>
                    <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </div>
                <div className="si-stat-value">{systemInfo.projectInfo.totalFiles.toLocaleString()}</div>
                <div className="si-stat-label">전체 파일</div>
              </div>
              <div className="si-stat-card">
                <div className="si-stat-icon folders">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M22 19C22 20.1046 21.1046 21 20 21H4C2.89543 21 2 20.1046 2 19V5C2 3.89543 2.89543 3 4 3H9L11 6H20C21.1046 6 22 6.89543 22 8V19Z" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </div>
                <div className="si-stat-value">{systemInfo.projectInfo.totalFolders.toLocaleString()}</div>
                <div className="si-stat-label">전체 폴더</div>
              </div>
              <div className="si-stat-card">
                <div className="si-stat-icon storage">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <ellipse cx="12" cy="5" rx="9" ry="3" stroke="currentColor" strokeWidth="2"/>
                    <path d="M3 5V19C3 20.6569 7.02944 22 12 22C16.9706 22 21 20.6569 21 19V5" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </div>
                <div className="si-stat-value">{systemInfo.projectInfo.formatted}</div>
                <div className="si-stat-label">총 사용량</div>
              </div>
              <div className="si-stat-card">
                <div className="si-stat-icon users">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M17 21V19C17 16.7909 15.2091 15 13 15H5C2.79086 15 1 16.7909 1 19V21" stroke="currentColor" strokeWidth="2"/>
                    <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                    <path d="M23 21V19C22.9986 17.1771 21.765 15.5857 20 15.13" stroke="currentColor" strokeWidth="2"/>
                    <path d="M16 3.13C17.7699 3.58317 19.0078 5.17799 19.0078 7.005C19.0078 8.83201 17.7699 10.4268 16 10.88" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </div>
                <div className="si-stat-value">{systemInfo.projectInfo.usersCount}</div>
                <div className="si-stat-label">등록 사용자</div>
              </div>
              <div className="si-stat-card">
                <div className="si-stat-icon shared">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="2"/>
                    <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                    <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="2"/>
                    <path d="M8.59 13.51L15.42 17.49M15.41 6.51L8.59 10.49" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </div>
                <div className="si-stat-value">{systemInfo.projectInfo.sharedFolders}</div>
                <div className="si-stat-label">공유 폴더</div>
              </div>
            </div>
          </div>
        </div>

        {/* Folder Tree */}
        <div className="si-section">
          <div className="si-section-header">
            <div className="si-section-icon tree">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M3 3V21H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7 14L11 10L15 14L21 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="si-section-text">
              <h2>폴더별 용량</h2>
              <p>데이터 폴더 사용량 분석 (클릭하여 하위 폴더 확인)</p>
            </div>
          </div>
          <div className="si-section-content">
            <div className="si-folder-tree">
              <div className="folder-tree-header">
                <span className="folder-tree-col name">이름</span>
                <span className="folder-tree-col size">크기</span>
                <span className="folder-tree-col count">파일 수</span>
              </div>
              <div className="folder-tree-body">
                {renderFolderTree(systemInfo.folderTree)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminSystemInfo
