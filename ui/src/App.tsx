import { useState, useCallback, useEffect, Suspense, lazy } from 'react'
import { Routes, Route, useNavigate, useLocation, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from './stores/authStore'
import { useUploadStore } from './stores/uploadStore'
import Header from './components/Header'
import Sidebar, { AdminView } from './components/Sidebar'
import FileList from './components/FileList'
import Trash from './components/Trash'
import UploadModal from './components/UploadModal'
import CreateFolderModal from './components/CreateFolderModal'
import UploadPanel from './components/UploadPanel'
import DuplicateModal from './components/DuplicateModal'
import UserProfile from './components/UserProfile'
import LoginPage from './components/LoginPage'
import ShareAccessPage from './components/ShareAccessPage'
import UploadShareAccessPage from './components/UploadShareAccessPage'
import FileListSkeleton from './components/FileListSkeleton'
import ErrorBoundary from './components/ErrorBoundary'
import './styles/app.css'

// Lazy load admin components for better initial load performance
const AdminUserList = lazy(() => import('./components/AdminUserList'))
const AdminSettings = lazy(() => import('./components/AdminSettings'))
const AdminSSOSettings = lazy(() => import('./components/AdminSSOSettings'))
const AdminLogs = lazy(() => import('./components/AdminLogs'))
const AdminSharedFolders = lazy(() => import('./components/AdminSharedFolders'))
const AdminSystemInfo = lazy(() => import('./components/AdminSystemInfo'))
const MyActivity = lazy(() => import('./components/MyActivity'))
const NotificationCenter = lazy(() => import('./components/NotificationCenter'))

// Admin loading skeleton
function AdminSkeleton() {
  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ height: '32px', width: '200px', background: '#e0e0e0', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />
      <div style={{ height: '200px', background: '#f5f5f5', borderRadius: '8px', animation: 'pulse 1.5s infinite' }} />
    </div>
  )
}

// Wrapper component for shared drive routes
interface SharedDriveWrapperProps {
  onNavigate: (path: string) => void
  onUploadClick: () => void
  onNewFolderClick: () => void
  highlightedFilePath: string | null
  onClearHighlight: () => void
}

function SharedDriveWrapper({ onNavigate, onUploadClick, onNewFolderClick, highlightedFilePath, onClearHighlight }: SharedDriveWrapperProps) {
  const { folderName, '*': subPath } = useParams()
  const currentPath = subPath ? `/shared/${folderName}/${subPath}` : `/shared/${folderName}`

  return (
    <FileList
      currentPath={currentPath}
      onNavigate={onNavigate}
      onUploadClick={onUploadClick}
      onNewFolderClick={onNewFolderClick}
      highlightedFilePath={highlightedFilePath}
      onClearHighlight={onClearHighlight}
    />
  )
}

// Wrapper component for files routes with path in URL
interface FilesWrapperProps {
  onNavigate: (path: string) => void
  onUploadClick: () => void
  onNewFolderClick: () => void
  highlightedFilePath: string | null
  onClearHighlight: () => void
}

function FilesWrapper({ onNavigate, onUploadClick, onNewFolderClick, highlightedFilePath, onClearHighlight }: FilesWrapperProps) {
  const { '*': subPath } = useParams()
  // /files -> /home, /files/xxx -> /home/xxx
  const currentPath = subPath ? `/home/${subPath}` : '/home'

  return (
    <FileList
      currentPath={currentPath}
      onNavigate={onNavigate}
      onUploadClick={onUploadClick}
      onNewFolderClick={onNewFolderClick}
      highlightedFilePath={highlightedFilePath}
      onClearHighlight={onClearHighlight}
    />
  )
}

// Parse JWT token to get expiration time
function getTokenExpiration(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp ? payload.exp * 1000 : null // Convert to milliseconds
  } catch {
    return null
  }
}

function App() {
  const [currentPath, setCurrentPath] = useState('/home')
  const [isUploadModalOpen, setUploadModalOpen] = useState(false)
  const [isFolderModalOpen, setFolderModalOpen] = useState(false)
  const [isProfileOpen, setProfileOpen] = useState(false)
  const [highlightedFilePath, setHighlightedFilePath] = useState<string | null>(null)
  const [isMobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const queryClient = useQueryClient()
  const { refreshProfile, refreshAuthToken, token, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()

  // Determine current view from URL
  const isAdminMode = location.pathname.startsWith('/fhadmin')
  const isTrashView = location.pathname === '/trash'

  // Get admin view from URL
  const getAdminView = (): AdminView => {
    if (location.pathname === '/fhadmin/shared-folders') return 'shared-folders'
    if (location.pathname === '/fhadmin/settings') return 'settings'
    if (location.pathname === '/fhadmin/sso') return 'sso'
    if (location.pathname === '/fhadmin/logs') return 'logs'
    if (location.pathname === '/fhadmin/system-info') return 'system-info'
    return 'users'
  }
  const adminView = getAdminView()

  // Refresh profile on mount if token exists
  useEffect(() => {
    refreshProfile()
  }, [refreshProfile])

  // Automatic token refresh - refresh token 5 minutes before expiration
  useEffect(() => {
    if (!token) return

    const expiration = getTokenExpiration(token)
    if (!expiration) return

    // Calculate time until we should refresh (5 minutes before expiration)
    const refreshBuffer = 5 * 60 * 1000 // 5 minutes in ms
    const now = Date.now()
    const timeUntilRefresh = expiration - now - refreshBuffer

    // If token is already expired or about to expire, try to refresh immediately
    if (timeUntilRefresh <= 0) {
      // Check if token is completely expired
      if (expiration <= now) {
        console.log('[Auth] Token expired, logging out')
        logout()
        return
      }
      // Token is about to expire, refresh immediately
      console.log('[Auth] Token about to expire, refreshing now')
      refreshAuthToken()
      return
    }

    // Schedule token refresh
    console.log(`[Auth] Scheduling token refresh in ${Math.round(timeUntilRefresh / 1000 / 60)} minutes`)
    const refreshTimer = setTimeout(async () => {
      console.log('[Auth] Refreshing token')
      const success = await refreshAuthToken()
      if (!success) {
        console.log('[Auth] Token refresh failed')
      }
    }, timeUntilRefresh)

    // Also set up periodic activity-based refresh (refresh on user activity if token is old)
    const activityRefresh = () => {
      const remaining = expiration - Date.now()
      // If less than 50% of original duration remains, refresh on activity
      if (remaining < (expiration - now) / 2 && remaining > refreshBuffer) {
        refreshAuthToken()
      }
    }

    // Listen for user activity events
    window.addEventListener('mousedown', activityRefresh)
    window.addEventListener('keydown', activityRefresh)

    return () => {
      clearTimeout(refreshTimer)
      window.removeEventListener('mousedown', activityRefresh)
      window.removeEventListener('keydown', activityRefresh)
    }
  }, [token, refreshAuthToken, logout])

  // Sync currentPath based on URL location
  useEffect(() => {
    const pathname = location.pathname

    // Handle shared-drive routes: /shared-drive/{folderName}/... -> /shared/{folderName}/...
    if (pathname.startsWith('/shared-drive/')) {
      const pathAfterPrefix = decodeURIComponent(pathname.substring('/shared-drive/'.length))
      const newPath = `/shared/${pathAfterPrefix}`
      if (currentPath !== newPath) {
        setCurrentPath(newPath)
      }
    }
    // Handle files routes: /files/xxx -> /home/xxx
    else if (pathname.startsWith('/files/')) {
      const pathAfterPrefix = decodeURIComponent(pathname.substring('/files/'.length))
      const newPath = `/home/${pathAfterPrefix}`
      if (currentPath !== newPath) {
        setCurrentPath(newPath)
      }
    }
    // Handle special share views
    else if (pathname === '/shared-with-me' || pathname === '/shared-by-me' || pathname === '/link-shares') {
      if (currentPath !== pathname) {
        setCurrentPath(pathname)
      }
    }
    // Handle /files or / route -> /home
    else if (pathname === '/files' || pathname === '/') {
      if (currentPath !== '/home') {
        setCurrentPath('/home')
      }
    }
  }, [location.pathname, currentPath])

  // Handle share access page (public route, no auth required)
  if (location.pathname.startsWith('/s/')) {
    return <ShareAccessPage />
  }

  // Handle edit share access page (public route with OnlyOffice, no auth required)
  if (location.pathname.startsWith('/e/')) {
    return <ShareAccessPage />
  }

  // Handle upload share access page (public route, no auth required)
  if (location.pathname.startsWith('/u/')) {
    return <UploadShareAccessPage />
  }

  // Show login page if not authenticated
  if (!token) {
    return <LoginPage />
  }

  const handleUploadComplete = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
  }, [queryClient, currentPath])

  const handleFolderCreated = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
    setFolderModalOpen(false)
  }, [queryClient, currentPath])

  const handleNavigate = useCallback((path: string) => {
    setCurrentPath(path)
    setHighlightedFilePath(null)
    // Special share views have their own routes
    if (path === '/shared-with-me' || path === '/shared-by-me' || path === '/link-shares') {
      navigate(path)
    } else if (path.startsWith('/shared/')) {
      // Shared drive paths: /shared/{folderName}/... -> /shared-drive/{folderName}/...
      const sharedPath = path.substring('/shared/'.length)
      navigate(`/shared-drive/${sharedPath}`)
    } else if (path.startsWith('/home/')) {
      // Home paths: /home/xxx -> /files/xxx
      const subPath = path.substring('/home/'.length)
      navigate(`/files/${subPath}`)
    } else if (path === '/home') {
      navigate('/files')
    } else {
      navigate('/files')
    }
  }, [navigate])

  const handleFileSelect = useCallback((filePath: string, parentPath: string) => {
    setCurrentPath(parentPath)
    setHighlightedFilePath(filePath)
    // Navigate to appropriate route based on path type
    if (parentPath.startsWith('/shared/')) {
      // Shared drive folder - navigate to /shared-drive/:folderName/*
      const sharedPath = parentPath.substring('/shared/'.length)
      navigate(`/shared-drive/${sharedPath}`)
    } else if (parentPath.startsWith('/home/')) {
      // Home paths: /home/xxx -> /files/xxx
      const subPath = parentPath.substring('/home/'.length)
      navigate(`/files/${subPath}`)
    } else {
      navigate('/files')
    }
  }, [navigate])

  const handleAdminClick = useCallback(() => {
    navigate('/fhadmin/users')
  }, [navigate])

  const handleExitAdminMode = useCallback(() => {
    navigate('/files')
  }, [navigate])

  return (
    <ErrorBoundary>
      <div className="app">
        <Header
          onProfileClick={() => setProfileOpen(true)}
          onNavigate={handleNavigate}
          onFileSelect={handleFileSelect}
          currentPath={currentPath}
          isAdminMode={isAdminMode}
          onMenuClick={() => setMobileSidebarOpen(true)}
        />
        <div className={`app-container ${isAdminMode || isTrashView ? 'no-details-panel' : ''}`}>
          <Sidebar
            currentPath={currentPath}
            onNavigate={handleNavigate}
            onUploadClick={() => setUploadModalOpen(true)}
            onNewFolderClick={() => setFolderModalOpen(true)}
            onAdminClick={handleAdminClick}
            isTrashView={isTrashView}
            isAdminMode={isAdminMode}
            adminView={adminView}
            onExitAdminMode={handleExitAdminMode}
            isMobileOpen={isMobileSidebarOpen}
            onMobileClose={() => setMobileSidebarOpen(false)}
          />
          <main className="main-content">
            <Suspense fallback={<FileListSkeleton />}>
              <Routes>
              <Route path="/" element={
                <FilesWrapper
                  onNavigate={handleNavigate}
                  onUploadClick={() => setUploadModalOpen(true)}
                  onNewFolderClick={() => setFolderModalOpen(true)}
                  highlightedFilePath={highlightedFilePath}
                  onClearHighlight={() => setHighlightedFilePath(null)}
                />
              } />
              <Route path="/files" element={
                <FilesWrapper
                  onNavigate={handleNavigate}
                  onUploadClick={() => setUploadModalOpen(true)}
                  onNewFolderClick={() => setFolderModalOpen(true)}
                  highlightedFilePath={highlightedFilePath}
                  onClearHighlight={() => setHighlightedFilePath(null)}
                />
              } />
              <Route path="/files/*" element={
                <FilesWrapper
                  onNavigate={handleNavigate}
                  onUploadClick={() => setUploadModalOpen(true)}
                  onNewFolderClick={() => setFolderModalOpen(true)}
                  highlightedFilePath={highlightedFilePath}
                  onClearHighlight={() => setHighlightedFilePath(null)}
                />
              } />
              <Route path="/shared-with-me" element={
                <FileList
                  currentPath="/shared-with-me"
                  onNavigate={handleNavigate}
                  onUploadClick={() => setUploadModalOpen(true)}
                  onNewFolderClick={() => setFolderModalOpen(true)}
                  highlightedFilePath={highlightedFilePath}
                  onClearHighlight={() => setHighlightedFilePath(null)}
                />
              } />
              <Route path="/shared-by-me" element={
                <FileList
                  currentPath="/shared-by-me"
                  onNavigate={handleNavigate}
                  onUploadClick={() => setUploadModalOpen(true)}
                  onNewFolderClick={() => setFolderModalOpen(true)}
                  highlightedFilePath={highlightedFilePath}
                  onClearHighlight={() => setHighlightedFilePath(null)}
                />
              } />
              <Route path="/link-shares" element={
                <FileList
                  currentPath="/link-shares"
                  onNavigate={handleNavigate}
                  onUploadClick={() => setUploadModalOpen(true)}
                  onNewFolderClick={() => setFolderModalOpen(true)}
                  highlightedFilePath={highlightedFilePath}
                  onClearHighlight={() => setHighlightedFilePath(null)}
                />
              } />
              <Route path="/shared-drive/:folderName/*" element={
                <SharedDriveWrapper
                  onNavigate={handleNavigate}
                  onUploadClick={() => setUploadModalOpen(true)}
                  onNewFolderClick={() => setFolderModalOpen(true)}
                  highlightedFilePath={highlightedFilePath}
                  onClearHighlight={() => setHighlightedFilePath(null)}
                />
              } />
              <Route path="/shared-drive/:folderName" element={
                <SharedDriveWrapper
                  onNavigate={handleNavigate}
                  onUploadClick={() => setUploadModalOpen(true)}
                  onNewFolderClick={() => setFolderModalOpen(true)}
                  highlightedFilePath={highlightedFilePath}
                  onClearHighlight={() => setHighlightedFilePath(null)}
                />
              } />
              <Route path="/trash" element={
                <Trash onNavigate={handleNavigate} />
              } />
              <Route path="/my-activity" element={
                <Suspense fallback={<FileListSkeleton />}>
                  <MyActivity onNavigate={handleNavigate} onFileSelect={handleFileSelect} />
                </Suspense>
              } />
              <Route path="/notifications" element={
                <Suspense fallback={<FileListSkeleton />}>
                  <NotificationCenter />
                </Suspense>
              } />
              <Route path="/fhadmin/users" element={
                <Suspense fallback={<AdminSkeleton />}>
                  <AdminUserList />
                </Suspense>
              } />
              <Route path="/fhadmin/shared-folders" element={
                <Suspense fallback={<AdminSkeleton />}>
                  <AdminSharedFolders />
                </Suspense>
              } />
              <Route path="/fhadmin/settings" element={
                <Suspense fallback={<AdminSkeleton />}>
                  <AdminSettings />
                </Suspense>
              } />
              <Route path="/fhadmin/sso" element={
                <Suspense fallback={<AdminSkeleton />}>
                  <AdminSSOSettings />
                </Suspense>
              } />
              <Route path="/fhadmin/logs" element={
                <Suspense fallback={<AdminSkeleton />}>
                  <AdminLogs />
                </Suspense>
              } />
              <Route path="/fhadmin/system-info" element={
                <Suspense fallback={<AdminSkeleton />}>
                  <AdminSystemInfo />
                </Suspense>
              } />
              <Route path="/fhadmin" element={
                <Suspense fallback={<AdminSkeleton />}>
                  <AdminUserList />
                </Suspense>
              } />
            </Routes>
          </Suspense>
          </main>
          {/* Portal target for FileDetailsPanel - only shown when not in admin/trash mode */}
          {!isAdminMode && !isTrashView && (
            <div id="details-sidebar-root" className="details-sidebar" />
          )}
        </div>

        <UploadModal
          isOpen={isUploadModalOpen}
          onClose={() => {
            setUploadModalOpen(false)
            useUploadStore.getState().clearCompleted()
          }}
          currentPath={currentPath}
          onUploadComplete={handleUploadComplete}
        />

        <CreateFolderModal
          isOpen={isFolderModalOpen}
          onClose={() => setFolderModalOpen(false)}
          currentPath={currentPath}
          onCreated={handleFolderCreated}
        />

        <UploadPanel />
        <DuplicateModal />

        <UserProfile
          isOpen={isProfileOpen}
          onClose={() => setProfileOpen(false)}
        />
      </div>
    </ErrorBoundary>
  )
}

export default App
