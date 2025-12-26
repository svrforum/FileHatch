import { useState, useCallback, useEffect, Suspense, lazy } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
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
import FileListSkeleton from './components/FileListSkeleton'
import ErrorBoundary from './components/ErrorBoundary'
import './styles/app.css'

// Lazy load admin components for better initial load performance
const AdminUserList = lazy(() => import('./components/AdminUserList'))
const AdminSettings = lazy(() => import('./components/AdminSettings'))
const AdminLogs = lazy(() => import('./components/AdminLogs'))
const AdminSharedFolders = lazy(() => import('./components/AdminSharedFolders'))

// Admin loading skeleton
function AdminSkeleton() {
  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ height: '32px', width: '200px', background: '#e0e0e0', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />
      <div style={{ height: '200px', background: '#f5f5f5', borderRadius: '8px', animation: 'pulse 1.5s infinite' }} />
    </div>
  )
}

function App() {
  const [currentPath, setCurrentPath] = useState('/home')
  const [isUploadModalOpen, setUploadModalOpen] = useState(false)
  const [isFolderModalOpen, setFolderModalOpen] = useState(false)
  const [isProfileOpen, setProfileOpen] = useState(false)
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
    if (location.pathname === '/scvadmin/logs') return 'logs'
    return 'users'
  }
  const adminView = getAdminView()

  // Refresh profile on mount if token exists
  useEffect(() => {
    refreshProfile()
  }, [refreshProfile])

  // Handle share access page (public route, no auth required)
  if (location.pathname.startsWith('/s/')) {
    return <ShareAccessPage />
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
          currentPath={currentPath}
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
                />
              } />
              <Route path="/files" element={
                <FileList
                  currentPath={currentPath}
                  onNavigate={handleNavigate}
                  onUploadClick={() => setUploadModalOpen(true)}
                  onNewFolderClick={() => setFolderModalOpen(true)}
                />
              } />
              <Route path="/trash" element={
                <Trash onNavigate={handleNavigate} />
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
