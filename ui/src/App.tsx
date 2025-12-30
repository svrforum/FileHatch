import { useState, useCallback, useEffect, Suspense, lazy } from 'react'
import { Routes, Route, useNavigate, useLocation, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from './stores/authStore'
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

function App() {
  const [currentPath, setCurrentPath] = useState('/home')
  const [isUploadModalOpen, setUploadModalOpen] = useState(false)
  const [isFolderModalOpen, setFolderModalOpen] = useState(false)
  const [isProfileOpen, setProfileOpen] = useState(false)
  const [highlightedFilePath, setHighlightedFilePath] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const { refreshProfile, token } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()

  // Determine current view from URL
  const isAdminMode = location.pathname.startsWith('/scvadmin')
  const isTrashView = location.pathname === '/trash'

  // Get admin view from URL
  const getAdminView = (): AdminView => {
    if (location.pathname === '/scvadmin/shared-folders') return 'shared-folders'
    if (location.pathname === '/scvadmin/settings') return 'settings'
    if (location.pathname === '/scvadmin/sso') return 'sso'
    if (location.pathname === '/scvadmin/logs') return 'logs'
    return 'users'
  }
  const adminView = getAdminView()

  // Refresh profile on mount if token exists
  useEffect(() => {
    refreshProfile()
  }, [refreshProfile])

  // Sync currentPath based on URL location (especially for shared-drive routes)
  useEffect(() => {
    const pathname = location.pathname

    // Handle shared-drive routes: /shared-drive/{folderName}/... -> /shared/{folderName}/...
    if (pathname.startsWith('/shared-drive/')) {
      const pathAfterPrefix = pathname.substring('/shared-drive/'.length) // Remove '/shared-drive/'
      const newPath = `/shared/${pathAfterPrefix}`
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
    // Handle /files route - keep existing currentPath if it's a valid path
    else if (pathname === '/files' || pathname === '/') {
      // Only reset to /home if currentPath is a special view that shouldn't persist
      if (currentPath.startsWith('/shared-with-me') ||
          currentPath.startsWith('/shared-by-me') ||
          currentPath.startsWith('/link-shares') ||
          currentPath.startsWith('/shared/')) {
        setCurrentPath('/home')
      }
    }
  }, [location.pathname, currentPath])

  // Handle share access page (public route, no auth required)
  if (location.pathname.startsWith('/s/')) {
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
      const sharedPath = path.substring(8) // Remove '/shared/'
      navigate(`/shared-drive/${sharedPath}`)
    } else {
      navigate('/files')
    }
  }, [navigate])

  const handleFileSelect = useCallback((filePath: string, parentPath: string) => {
    setCurrentPath(parentPath)
    setHighlightedFilePath(filePath)
    navigate('/files')
  }, [navigate])

  const handleAdminClick = useCallback(() => {
    navigate('/scvadmin/users')
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
        />
        <div className="app-container">
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
          />
          <main className="main-content">
            <Suspense fallback={<FileListSkeleton />}>
              <Routes>
              <Route path="/" element={
                <FileList
                  currentPath={currentPath}
                  onNavigate={handleNavigate}
                  onUploadClick={() => setUploadModalOpen(true)}
                  onNewFolderClick={() => setFolderModalOpen(true)}
                  highlightedFilePath={highlightedFilePath}
                  onClearHighlight={() => setHighlightedFilePath(null)}
                />
              } />
              <Route path="/files" element={
                <FileList
                  currentPath={currentPath}
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
              <Route path="/scvadmin/users" element={
                <Suspense fallback={<AdminSkeleton />}>
                  <AdminUserList />
                </Suspense>
              } />
              <Route path="/scvadmin/shared-folders" element={
                <Suspense fallback={<AdminSkeleton />}>
                  <AdminSharedFolders />
                </Suspense>
              } />
              <Route path="/scvadmin/settings" element={
                <Suspense fallback={<AdminSkeleton />}>
                  <AdminSettings />
                </Suspense>
              } />
              <Route path="/scvadmin/sso" element={
                <Suspense fallback={<AdminSkeleton />}>
                  <AdminSSOSettings />
                </Suspense>
              } />
              <Route path="/scvadmin/logs" element={
                <Suspense fallback={<AdminSkeleton />}>
                  <AdminLogs />
                </Suspense>
              } />
              <Route path="/scvadmin" element={
                <Suspense fallback={<AdminSkeleton />}>
                  <AdminUserList />
                </Suspense>
              } />
            </Routes>
          </Suspense>
          </main>
        </div>

        <UploadModal
          isOpen={isUploadModalOpen}
          onClose={() => setUploadModalOpen(false)}
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
