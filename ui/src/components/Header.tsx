import { useState, useCallback, useRef, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { searchFiles, FileInfo, formatFileSize } from '../api/files'
import { getMySharedFolders, SharedFolderWithPermission } from '../api/sharedFolders'
import SearchModal from './SearchModal'
import { NotificationBell } from './NotificationBell'
import './Header.css'

interface HeaderProps {
  onProfileClick: () => void
  onNavigate?: (path: string) => void
  onFileSelect?: (filePath: string, parentPath: string) => void
  currentPath?: string
  isAdminMode?: boolean
}

function Header({ onProfileClick, onNavigate, onFileSelect, currentPath = '/', isAdminMode = false }: HeaderProps) {
  const { user } = useAuthStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FileInfo[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [sharedFolders, setSharedFolders] = useState<SharedFolderWithPermission[]>([])
  const [isSearchModalOpen, setSearchModalOpen] = useState(false)
  const [searchModalQuery, setSearchModalQuery] = useState('')
  const searchRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch shared folders for breadcrumb display
  useEffect(() => {
    if (!user) return
    getMySharedFolders()
      .then(setSharedFolders)
      .catch(() => {})
  }, [user])

  // Handle search
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      setShowResults(false)
      return
    }

    setIsSearching(true)
    try {
      const result = await searchFiles(query)
      setSearchResults(result.results || [])
      setShowResults(true)
    } catch {
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }, [])

  // Debounced search
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    setSearchQuery(query)

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      handleSearch(query)
    }, 300)
  }, [handleSearch])

  // Handle result click
  const handleResultClick = useCallback((file: FileInfo) => {
    const parentPath = file.path.split('/').slice(0, -1).join('/') || '/'

    if (file.isDir) {
      // For directories, just navigate
      onNavigate?.(file.path)
    } else if (onFileSelect) {
      // For files, use onFileSelect to show file details
      onFileSelect(file.path, parentPath)
    } else if (onNavigate) {
      // Fallback: navigate to parent folder
      onNavigate(parentPath)
    }

    setShowResults(false)
    setSearchQuery('')
  }, [onNavigate, onFileSelect])

  // Open search modal
  const openSearchModal = useCallback(() => {
    if (searchQuery.trim()) {
      setSearchModalQuery(searchQuery)
      setSearchModalOpen(true)
      setShowResults(false)
    }
  }, [searchQuery])

  // Handle key down on search input
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      e.preventDefault()
      openSearchModal()
    }
  }, [searchQuery, openSearchModal])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Build breadcrumb items
  const getBreadcrumbs = useCallback(() => {
    if (!currentPath || currentPath === '/') return []

    const parts = currentPath.split('/').filter(Boolean)
    const items: { label: string; path: string }[] = []

    let accumulatedPath = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      accumulatedPath += '/' + part
      let label = part

      if (accumulatedPath === '/home') {
        label = '내 파일'
      } else if (accumulatedPath === '/shared') {
        label = '공유 드라이브'
      } else if (accumulatedPath === '/shared-with-me') {
        label = '공유받은 파일'
      } else if (parts[0] === 'shared' && i === 1) {
        // This is a shared drive folder - check if it's a known folder
        const folder = sharedFolders.find(f => f.name === part)
        if (folder) {
          label = folder.name
        }
      }

      items.push({ label, path: accumulatedPath })
    }

    return items
  }, [currentPath, sharedFolders])

  const breadcrumbs = getBreadcrumbs()

  return (
    <header className="header">
      <div className="header-left">
        <div className="logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#3182F6"/>
            <path d="M10 16L14 20L22 12" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="logo-text">SimpleCloudVault</span>
        </div>
        {breadcrumbs.length > 0 && (
          <nav className="header-breadcrumb">
            <span className="breadcrumb-separator">/</span>
            {breadcrumbs.map((item, index) => (
              <span key={item.path} className="breadcrumb-item-wrapper">
                <button
                  className={`breadcrumb-link ${index === breadcrumbs.length - 1 ? 'current' : ''}`}
                  onClick={() => onNavigate?.(item.path)}
                >
                  {item.label}
                </button>
                {index < breadcrumbs.length - 1 && (
                  <span className="breadcrumb-separator">/</span>
                )}
              </span>
            ))}
          </nav>
        )}
      </div>
      {!isAdminMode && (
        <div className="header-center" ref={searchRef}>
          <div className="search-box">
            <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
              <path d="M20 20L16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              placeholder="파일 검색... (Enter로 전체 검색)"
              className="search-input"
              value={searchQuery}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={() => searchResults.length > 0 && setShowResults(true)}
            />
            {isSearching && <div className="search-spinner" />}
            {searchQuery.trim() && !isSearching && (
              <button className="search-expand-btn" onClick={openSearchModal} title="전체 검색">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
          {showResults && searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((file) => (
                <div
                  key={file.path}
                  className="search-result-item"
                  onClick={() => handleResultClick(file)}
                >
                  <svg className={`result-icon ${file.isDir ? 'folder' : 'file'}`} width="16" height="16" viewBox="0 0 24 24" fill="none">
                    {file.isDir ? (
                      <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" fill="#3182F6"/>
                    ) : (
                      <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2"/>
                    )}
                  </svg>
                  <div className="result-info">
                    <div className="result-name-row">
                      <span className="result-name">{file.name}</span>
                      {file.matchType && file.matchType !== 'name' && (
                        <span className={`match-badge ${file.matchType}`}>
                          {file.matchType === 'tag' ? `#${file.matchedTag || '태그'}` : '설명'}
                        </span>
                      )}
                    </div>
                    <span className="result-path">{file.path}</span>
                    {file.matchType === 'description' && file.description && (
                      <span className="result-description">{file.description}</span>
                    )}
                  </div>
                  <div className="result-meta">
                    {!file.isDir && <span className="result-size">{formatFileSize(file.size)}</span>}
                    <span className="result-date">{new Date(file.modTime).toLocaleDateString('ko-KR')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {showResults && searchQuery && searchResults.length === 0 && !isSearching && (
            <div className="search-results">
              <div className="search-no-results">검색 결과가 없습니다</div>
            </div>
          )}
        </div>
      )}
      <div className="header-right">
        <NotificationBell />
        {user && (
          <button className="avatar-btn" onClick={onProfileClick} title={user.username}>
            <div className="avatar">
              <span>{user.username.charAt(0).toUpperCase()}</span>
            </div>
          </button>
        )}
      </div>

      <SearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        initialQuery={searchModalQuery}
        onNavigate={onNavigate}
        onFileSelect={onFileSelect}
      />
    </header>
  )
}

export default Header
