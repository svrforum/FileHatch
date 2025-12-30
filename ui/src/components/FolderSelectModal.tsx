// 폴더 선택 모달 - 파일 이동/복사 시 대상 폴더 선택
import { useState, useEffect, useCallback } from 'react'
import { fetchFiles } from '../api/files'
import { getMySharedFolders } from '../api/sharedFolders'
import './FolderSelectModal.css'

interface FolderSelectModalProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (path: string) => void
  title: string
  actionLabel: string
  excludePaths?: string[]  // 이동할 수 없는 경로들 (자기 자신 등)
}

interface FolderNode {
  path: string
  name: string
  isExpanded: boolean
  isLoading: boolean
  children: FolderNode[]
  type: 'home' | 'shared'
}

export default function FolderSelectModal({
  isOpen,
  onClose,
  onSelect,
  title,
  actionLabel,
  excludePaths = [],
}: FolderSelectModalProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [homeFolders, setHomeFolders] = useState<FolderNode[]>([])
  const [sharedFolders, setSharedFolders] = useState<FolderNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['/home']))
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [homeExpanded, setHomeExpanded] = useState(true)
  const [sharedExpanded, setSharedExpanded] = useState(false)

  // 홈 폴더 로드
  const loadHomeFolders = useCallback(async (path: string) => {
    if (loadingPaths.has(path)) return

    setLoadingPaths(prev => new Set(prev).add(path))
    try {
      const response = await fetchFiles(path)
      const folders = response.files
        .filter(f => f.isDir)
        .map(f => ({
          path: f.path,
          name: f.name,
          isExpanded: false,
          isLoading: false,
          children: [],
          type: 'home' as const,
        }))

      if (path === '/home') {
        setHomeFolders(folders)
      } else {
        // 하위 폴더 업데이트
        setHomeFolders(prev => updateChildren(prev, path, folders))
      }
    } catch (error) {
      console.error('Failed to load folders:', error)
    } finally {
      setLoadingPaths(prev => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }
  }, [loadingPaths])

  // 공유 폴더 로드
  const loadSharedFolders = useCallback(async () => {
    try {
      const folders = await getMySharedFolders()
      setSharedFolders(folders.map(f => ({
        path: `/shared/${f.name}`,
        name: f.name,
        isExpanded: false,
        isLoading: false,
        children: [],
        type: 'shared' as const,
      })))
    } catch (error) {
      console.error('Failed to load shared folders:', error)
    }
  }, [])

  // 공유 폴더 하위 로드
  const loadSharedSubfolders = useCallback(async (path: string) => {
    if (loadingPaths.has(path)) return

    setLoadingPaths(prev => new Set(prev).add(path))
    try {
      const response = await fetchFiles(path)
      const folders = response.files
        .filter(f => f.isDir)
        .map(f => ({
          path: f.path,
          name: f.name,
          isExpanded: false,
          isLoading: false,
          children: [],
          type: 'shared' as const,
        }))

      setSharedFolders(prev => updateChildren(prev, path, folders))
    } catch (error) {
      console.error('Failed to load folders:', error)
    } finally {
      setLoadingPaths(prev => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }
  }, [loadingPaths])

  // 하위 폴더 업데이트 헬퍼
  const updateChildren = (nodes: FolderNode[], parentPath: string, children: FolderNode[]): FolderNode[] => {
    return nodes.map(node => {
      if (node.path === parentPath) {
        return { ...node, children, isExpanded: true }
      }
      if (node.children.length > 0) {
        return { ...node, children: updateChildren(node.children, parentPath, children) }
      }
      return node
    })
  }

  // 초기 로드
  useEffect(() => {
    if (isOpen) {
      loadHomeFolders('/home')
      loadSharedFolders()
      setSelectedPath(null)
    }
  }, [isOpen])

  // 폴더 확장/축소
  const toggleExpand = useCallback((path: string, type: 'home' | 'shared') => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
        // 하위 폴더 로드
        if (type === 'home') {
          loadHomeFolders(path)
        } else {
          loadSharedSubfolders(path)
        }
      }
      return next
    })
  }, [loadHomeFolders, loadSharedSubfolders])

  // 경로가 제외 대상인지 확인
  const isExcluded = (path: string) => {
    return excludePaths.some(excludePath =>
      path === excludePath || path.startsWith(excludePath + '/')
    )
  }

  // 폴더 노드 렌더링
  const renderFolderNode = (node: FolderNode, depth: number = 0) => {
    const isExpanded = expandedPaths.has(node.path)
    const isLoading = loadingPaths.has(node.path)
    const isSelected = selectedPath === node.path
    const excluded = isExcluded(node.path)

    return (
      <div key={node.path} className="folder-node">
        <div
          className={`folder-item ${isSelected ? 'selected' : ''} ${excluded ? 'excluded' : ''}`}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
          onClick={() => !excluded && setSelectedPath(node.path)}
        >
          <button
            className="expand-btn"
            onClick={(e) => {
              e.stopPropagation()
              toggleExpand(node.path, node.type)
            }}
          >
            {isLoading ? (
              <svg className="spinner" width="14" height="14" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="31.4" strokeDashoffset="10" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
              >
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
          <svg className="folder-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2" fill={isExpanded ? 'rgba(49, 130, 246, 0.1)' : 'none'}/>
          </svg>
          <span className="folder-name">{node.name}</span>
          {excluded && <span className="excluded-badge">이동 불가</span>}
        </div>
        {isExpanded && node.children.length > 0 && (
          <div className="folder-children">
            {node.children.map(child => renderFolderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="folder-select-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="folder-tree">
          {/* 내 파일 섹션 */}
          <div className="tree-section">
            <div
              className="section-header"
              onClick={() => setHomeExpanded(!homeExpanded)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                style={{ transform: homeExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
              >
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M3 9L12 2L21 9V20C21 20.5304 20.7893 21.0391 20.4142 21.4142C20.0391 21.7893 19.5304 22 19 22H5C4.46957 22 3.96086 21.7893 3.58579 21.4142C3.21071 21.0391 3 20.5304 3 20V9Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 22V12H15V22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>내 파일</span>
            </div>
            {homeExpanded && (
              <div className="section-content">
                {homeFolders.length === 0 && !loadingPaths.has('/home') ? (
                  <div className="empty-message">폴더가 없습니다</div>
                ) : (
                  homeFolders.map(node => renderFolderNode(node, 1))
                )}
              </div>
            )}
          </div>

          {/* 공유 드라이브 섹션 */}
          <div className="tree-section">
            <div
              className="section-header"
              onClick={() => setSharedExpanded(!sharedExpanded)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                style={{ transform: sharedExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
              >
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="2"/>
                <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="2"/>
                <path d="M8.59 13.51L15.42 17.49M15.41 6.51L8.59 10.49" stroke="currentColor" strokeWidth="2"/>
              </svg>
              <span>공유 드라이브</span>
            </div>
            {sharedExpanded && (
              <div className="section-content">
                {sharedFolders.length === 0 ? (
                  <div className="empty-message">공유 드라이브가 없습니다</div>
                ) : (
                  sharedFolders.map(node => renderFolderNode(node, 1))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <div className="selected-path">
            {selectedPath ? (
              <>
                <span className="label">선택된 위치:</span>
                <span className="path">{selectedPath}</span>
              </>
            ) : (
              <span className="placeholder">폴더를 선택하세요</span>
            )}
          </div>
          <div className="modal-actions">
            <button className="cancel-btn" onClick={onClose}>취소</button>
            <button
              className="confirm-btn"
              disabled={!selectedPath}
              onClick={() => selectedPath && onSelect(selectedPath)}
            >
              {actionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
