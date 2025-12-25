import { useState, useCallback, useEffect } from 'react'
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
import AdminUserList from './components/AdminUserList'
import AdminSettings from './components/AdminSettings'
import AdminLogs from './components/AdminLogs'
import AdminSharedFolders from './components/AdminSharedFolders'
import LoginPage from './components/LoginPage'
import ShareAccessPage from './components/ShareAccessPage'
import './styles/app.css'

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
            <Route path="/scvadmin/users" element={<AdminUserList />} />
            <Route path="/scvadmin/shared-folders" element={<AdminSharedFolders />} />
            <Route path="/scvadmin/settings" element={<AdminSettings />} />
            <Route path="/scvadmin/logs" element={<AdminLogs />} />
            <Route path="/scvadmin" element={<AdminUserList />} />
          </Routes>
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
  )
}

export default App
