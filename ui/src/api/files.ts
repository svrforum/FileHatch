import { api, apiUrl, getAuthHeaders, getAuthToken as _getAuthToken } from './client'

export interface FileInfo {
  name: string
  path: string
  size: number
  isDir: boolean
  modTime: string
  extension?: string
  mimeType?: string
  // Search result fields
  matchType?: 'name' | 'tag' | 'description' | 'trash'
  matchedTag?: string
  description?: string
  tags?: string[]
  // Trash-related fields
  inTrash?: boolean
  trashId?: string
  originalPath?: string
  deletedAt?: string
}

export interface ListFilesResponse {
  path: string
  storageType?: string
  files: FileInfo[]
  total: number
  totalSize: number
}

const API_BASE = '/api'

export async function fetchFiles(
  path: string = '/',
  sort: string = 'name',
  order: string = 'asc'
): Promise<ListFilesResponse> {
  return api.get<ListFilesResponse>(apiUrl.withParams('/files', { path, sort, order }))
}

export async function downloadFile(
  path: string,
  onProgress?: (progress: number) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  // Remove leading slash and encode each path segment separately
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const url = `${API_BASE}/files/${encodedPath}?download=true`

  // Use fetch with auth header to download the file
  const response = await fetch(url, {
    headers: getAuthHeaders(),
    signal: abortSignal,
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Download failed' }))
    throw new Error(data.error || 'Failed to download file')
  }

  // Get filename from Content-Disposition header or path
  const disposition = response.headers.get('Content-Disposition')
  let filename = path.split('/').pop() || 'download'
  if (disposition) {
    const match = disposition.match(/filename="?([^"]+)"?/)
    if (match) {
      filename = match[1]
    }
  }

  // Get content length for progress tracking
  const contentLength = response.headers.get('Content-Length')
  const totalSize = contentLength ? parseInt(contentLength, 10) : 0

  // If we have a body reader, track progress
  if (response.body && totalSize > 0 && onProgress) {
    const reader = response.body.getReader()
    const chunks: BlobPart[] = []
    let receivedLength = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      chunks.push(value)
      receivedLength += value.length
      const progress = Math.round((receivedLength / totalSize) * 100)
      onProgress(progress)
    }

    const blob = new Blob(chunks)
    triggerDownload(blob, filename)
  } else {
    // Fallback for when we can't track progress
    const blob = await response.blob()
    triggerDownload(blob, filename)
    onProgress?.(100)
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const blobUrl = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(blobUrl)
}

// Download with progress tracking via store
export async function downloadFileWithProgress(
  path: string,
  size: number,
  store: {
    addDownload: (filename: string, size: number) => string
    updateDownloadProgress: (id: string, progress: number) => void
    setDownloadStatus: (id: string, status: 'downloading' | 'completed' | 'error', error?: string) => void
    setDownloadController: (id: string, controller: AbortController) => void
  }
): Promise<void> {
  const filename = path.split('/').pop() || 'download'
  const downloadId = store.addDownload(filename, size)
  const abortController = new AbortController()
  store.setDownloadController(downloadId, abortController)

  try {
    await downloadFile(
      path,
      (progress) => store.updateDownloadProgress(downloadId, progress),
      abortController.signal
    )
    store.setDownloadStatus(downloadId, 'completed')
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Download was cancelled, already handled
      return
    }
    store.setDownloadStatus(downloadId, 'error', err instanceof Error ? err.message : 'Download failed')
    throw err
  }
}

export async function deleteFile(path: string): Promise<void> {
  await api.delete(`/files/${apiUrl.encodePath(path)}`)
}

export async function createFolder(path: string, name: string): Promise<void> {
  await api.post('/folders', { path, name })
}

export async function deleteFolder(path: string, force: boolean = false): Promise<void> {
  const url = force
    ? apiUrl.withParams(`/folders/${apiUrl.encodePath(path)}`, { force: true })
    : `/folders/${apiUrl.encodePath(path)}`
  await api.delete(url)
}

export interface PreviewData {
  type: 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'unsupported'
  mimeType: string
  content?: string
  url?: string
  size?: number
  truncated?: boolean
}

export async function getPreview(path: string): Promise<PreviewData> {
  // Remove leading slash and encode each path segment separately
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const response = await fetch(`${API_BASE}/preview/${encodedPath}`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to get preview')
  }

  // If it's an image, the response is the image itself
  const contentType = response.headers.get('content-type') || ''
  if (contentType.startsWith('image/')) {
    return {
      type: 'image',
      mimeType: contentType,
      url: `${API_BASE}/preview/${encodedPath}`,
    }
  }

  return response.json()
}

export interface FileExistsResponse {
  exists: boolean
  path: string
  filename: string
}

export async function checkFileExists(path: string, filename: string): Promise<FileExistsResponse> {
  return api.get<FileExistsResponse>(apiUrl.withParams('/files/check', { path, filename }))
}

export interface FolderStats {
  path: string
  fileCount: number
  folderCount: number
  totalSize: number
}

export async function getFolderStats(path: string): Promise<FolderStats> {
  return api.get<FolderStats>(`/folders/stats/${apiUrl.encodePath(path)}`)
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

// Rename file or folder
export async function renameItem(path: string, newName: string): Promise<{ success: boolean; newPath: string }> {
  return api.put<{ success: boolean; newPath: string }>(`/files/rename/${apiUrl.encodePath(path)}`, { newName })
}

// Move file or folder
export async function moveItem(path: string, destination: string): Promise<{ success: boolean; newPath: string }> {
  return api.put<{ success: boolean; newPath: string }>(`/files/move/${apiUrl.encodePath(path)}`, { destination })
}

// Copy file or folder
export async function copyItem(path: string, destination: string): Promise<{ success: boolean; newPath: string }> {
  return api.post<{ success: boolean; newPath: string }>(`/files/copy/${apiUrl.encodePath(path)}`, { destination })
}

// Progress callback type for streaming operations
export interface TransferProgress {
  status: 'started' | 'progress' | 'completed' | 'error'
  totalBytes: number
  copiedBytes: number
  currentFile?: string
  totalFiles?: number
  copiedFiles?: number
  error?: string
  newPath?: string
  bytesPerSec?: number
}

// Move file or folder with streaming progress
export function moveItemStream(
  path: string,
  destination: string,
  onProgress: (progress: TransferProgress) => void
): { cancel: () => void; promise: Promise<string> } {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const encodedDest = encodeURIComponent(destination)

  const token = _getAuthToken()
  const url = `${API_BASE}/files/move-stream/${encodedPath}?destination=${encodedDest}${token ? `&token=${token}` : ''}`

  let eventSource: EventSource | null = null
  let rejectFn: ((reason: Error) => void) | null = null

  const promise = new Promise<string>((resolve, reject) => {
    rejectFn = reject
    eventSource = new EventSource(url)

    eventSource.onmessage = (event) => {
      try {
        const progress: TransferProgress = JSON.parse(event.data)
        onProgress(progress)

        if (progress.status === 'completed') {
          eventSource?.close()
          resolve(progress.newPath || '')
        } else if (progress.status === 'error') {
          eventSource?.close()
          reject(new Error(progress.error || 'Move failed'))
        }
      } catch (e) {
        console.error('Failed to parse progress:', e)
      }
    }

    eventSource.onerror = () => {
      eventSource?.close()
      reject(new Error('Connection error during move'))
    }
  })

  return {
    cancel: () => {
      eventSource?.close()
      if (rejectFn) rejectFn(new Error('Operation cancelled'))
    },
    promise
  }
}

// Copy file or folder with streaming progress
export function copyItemStream(
  path: string,
  destination: string,
  onProgress: (progress: TransferProgress) => void
): { cancel: () => void; promise: Promise<string> } {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const encodedDest = encodeURIComponent(destination)

  const token = _getAuthToken()
  const url = `${API_BASE}/files/copy-stream/${encodedPath}?destination=${encodedDest}${token ? `&token=${token}` : ''}`

  let eventSource: EventSource | null = null
  let rejectFn: ((reason: Error) => void) | null = null

  const promise = new Promise<string>((resolve, reject) => {
    rejectFn = reject
    eventSource = new EventSource(url)

    eventSource.onmessage = (event) => {
      try {
        const progress: TransferProgress = JSON.parse(event.data)
        onProgress(progress)

        if (progress.status === 'completed') {
          eventSource?.close()
          resolve(progress.newPath || '')
        } else if (progress.status === 'error') {
          eventSource?.close()
          reject(new Error(progress.error || 'Copy failed'))
        }
      } catch (e) {
        console.error('Failed to parse progress:', e)
      }
    }

    eventSource.onerror = () => {
      eventSource?.close()
      reject(new Error('Connection error during copy'))
    }
  })

  return {
    cancel: () => {
      eventSource?.close()
      if (rejectFn) rejectFn(new Error('Operation cancelled'))
    },
    promise
  }
}

// Search files
export type MatchType = 'all' | 'name' | 'tag' | 'description'

export interface SearchResponse {
  query: string
  results: FileInfo[]
  total: number
  page: number
  limit: number
  hasMore: boolean
  matchType?: MatchType
}

export interface SearchOptions {
  path?: string
  page?: number
  limit?: number
  matchType?: MatchType
}

export async function searchFiles(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResponse> {
  const { path = '/', page = 1, limit = 20, matchType = 'all' } = options
  return api.get<SearchResponse>(
    apiUrl.withParams('/files/search', { q: query, path, page, limit, matchType })
  )
}

// Get storage usage
export interface StorageUsage {
  homeUsed: number
  sharedUsed: number
  trashUsed: number
  totalUsed: number
  quota: number
}

export async function getStorageUsage(): Promise<StorageUsage> {
  return api.get<StorageUsage>('/storage/usage')
}

// Trash types and functions
export interface TrashItem {
  id: string
  name: string
  originalPath: string
  size: number
  isDir: boolean
  deletedAt: string
}

export interface TrashListResponse {
  items: TrashItem[]
  total: number
  totalSize: number
}

// Move file or folder to trash
export async function moveToTrash(path: string): Promise<{ success: boolean; trashId: string }> {
  return api.post<{ success: boolean; trashId: string }>(`/trash/${apiUrl.encodePath(path)}`)
}

// List trash items
export async function listTrash(): Promise<TrashListResponse> {
  return api.get<TrashListResponse>('/trash')
}

// Restore from trash
export async function restoreFromTrash(trashId: string): Promise<{ success: boolean; restoredPath: string }> {
  return api.post<{ success: boolean; restoredPath: string }>(`/trash/restore/${encodeURIComponent(trashId)}`)
}

// Delete from trash permanently
export async function deleteFromTrash(trashId: string): Promise<void> {
  await api.delete(`/trash/${encodeURIComponent(trashId)}`)
}

// Empty trash
export async function emptyTrash(): Promise<{ success: boolean; deletedCount: number }> {
  return api.delete<{ success: boolean; deletedCount: number }>('/trash')
}

// Read text file content
export async function readFileContent(path: string): Promise<string> {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const response = await fetch(`${API_BASE}/files/${encodedPath}?t=${Date.now()}`, {
    headers: {
      ...getAuthHeaders(),
      'Cache-Control': 'no-cache',
    },
  })

  if (!response.ok) {
    throw new Error('Failed to read file')
  }

  return response.text()
}

// Save text file content
export async function saveFileContent(path: string, content: string): Promise<void> {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const response = await fetch(`${API_BASE}/files/content/${encodedPath}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/plain',
      ...getAuthHeaders()
    },
    body: content,
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Failed to save file' }))
    throw new Error(data.error || 'Failed to save file')
  }
}

// Get file URL for viewing (images, PDFs, etc.)
export function getFileUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  return `${API_BASE}/files/${encodedPath}`
}

// Re-export getAuthToken from client for backwards compatibility
export { getAuthToken } from './client'

export function getFileTypeIcon(file: FileInfo): string {
  if (file.isDir) return 'folder'

  const ext = file.extension?.toLowerCase()
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']
  const videoExts = ['mp4', 'webm', 'avi', 'mov', 'mkv']
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'm4a']
  const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']
  const codeExts = ['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'md', 'py', 'go', 'rs']
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz']

  if (imageExts.includes(ext || '')) return 'image'
  if (videoExts.includes(ext || '')) return 'video'
  if (audioExts.includes(ext || '')) return 'audio'
  if (docExts.includes(ext || '')) return 'document'
  if (codeExts.includes(ext || '')) return 'code'
  if (archiveExts.includes(ext || '')) return 'archive'

  return 'file'
}

// OnlyOffice related functions

export interface OnlyOfficeStatus {
  available: boolean
  publicUrl: string | null
}

// Check if OnlyOffice is available
export async function checkOnlyOfficeStatus(): Promise<OnlyOfficeStatus> {
  try {
    const response = await fetch(`${API_BASE}/onlyoffice/status`)
    if (!response.ok) {
      return { available: false, publicUrl: null }
    }
    return response.json()
  } catch {
    return { available: false, publicUrl: null }
  }
}

// OnlyOffice document configuration
export interface OnlyOfficeConfig {
  documentType: 'word' | 'cell' | 'slide'
  document: {
    fileType: string
    key: string
    title: string
    url: string
  }
  editorConfig: {
    callbackUrl: string
    user: {
      id: string
      name: string
    }
    lang: string
    customization: {
      autosave: boolean
      forcesave: boolean
    }
  }
}

// Get OnlyOffice editor configuration for a file
export async function getOnlyOfficeConfig(path: string): Promise<OnlyOfficeConfig> {
  return api.get<OnlyOfficeConfig>(`/onlyoffice/config/${apiUrl.encodePath(path)}`)
}

// Check if file type is supported by OnlyOffice
export function isOnlyOfficeSupported(extension: string | undefined): boolean {
  if (!extension) return false
  const ext = extension.toLowerCase()
  const supported = [
    // Document formats (txt excluded - use built-in text editor instead)
    'doc', 'docx', 'odt', 'rtf',
    // Spreadsheet formats
    'xls', 'xlsx', 'ods', 'csv',
    // Presentation formats
    'ppt', 'pptx', 'odp',
    // PDF
    'pdf'
  ]
  return supported.includes(ext)
}

// File type options for creating new files
export interface FileTypeOption {
  type: string
  name: string
  extension: string
  icon: string
}

export const fileTypeOptions: FileTypeOption[] = [
  { type: 'txt', name: '텍스트 파일', extension: '.txt', icon: 'text' },
  { type: 'md', name: 'Markdown', extension: '.md', icon: 'markdown' },
  { type: 'html', name: 'HTML', extension: '.html', icon: 'html' },
  { type: 'json', name: 'JSON', extension: '.json', icon: 'json' },
  { type: 'docx', name: 'Word 문서', extension: '.docx', icon: 'word' },
  { type: 'xlsx', name: 'Excel 스프레드시트', extension: '.xlsx', icon: 'excel' },
  { type: 'pptx', name: 'PowerPoint 프레젠테이션', extension: '.pptx', icon: 'powerpoint' },
]

// Create a new file
export async function createFile(path: string, filename: string, fileType: string): Promise<{ success: boolean; path: string }> {
  return api.post<{ success: boolean; path: string }>('/files/create', { path, filename, fileType })
}

// File Metadata types
export interface FileMetadata {
  id?: number
  filePath: string
  description: string
  tags: string[]
  createdAt?: string
  updatedAt?: string
}

// Get file metadata (description and tags)
export async function getFileMetadata(filePath: string): Promise<FileMetadata> {
  // Remove leading slash to avoid double slash in URL
  const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath
  const encodedPath = encodeURIComponent(normalizedPath).replace(/%2F/g, '/')
  return api.get<FileMetadata>(`/file-metadata/${encodedPath}`)
}

// Update file metadata
export async function updateFileMetadata(
  filePath: string,
  data: { description?: string; tags?: string[] }
): Promise<FileMetadata> {
  // Remove leading slash to avoid double slash in URL
  const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath
  const encodedPath = encodeURIComponent(normalizedPath).replace(/%2F/g, '/')
  return api.put<FileMetadata>(`/file-metadata/${encodedPath}`, data)
}

// Get all user tags for autocomplete
export async function getUserTags(): Promise<{ tags: string[]; total: number }> {
  return api.get<{ tags: string[]; total: number }>('/file-metadata/tags')
}

// Search files by tag
export async function searchByTag(tag: string): Promise<{ files: FileMetadata[]; total: number }> {
  return api.get<{ files: FileMetadata[]; total: number }>(
    apiUrl.withParams('/file-metadata/search', { tag })
  )
}

// Recent files
export interface RecentFile {
  path: string
  name: string
  eventType: string
  timestamp: string
  isDir: boolean
  size: number
}

export async function getRecentFiles(limit: number = 10): Promise<RecentFile[]> {
  const result = await api.get<{ data: RecentFile[] }>(apiUrl.withParams('/files/recent', { limit }))
  return result.data || []
}

// Compress files/folders into a zip archive
export interface CompressResponse {
  success: boolean
  outputPath: string
  outputName: string
  size: number
}

export async function compressFiles(
  paths: string[],
  outputName?: string
): Promise<CompressResponse> {
  return api.post<CompressResponse>('/files/compress', { paths, outputName })
}

// Extract zip response
export interface ExtractResponse {
  success: boolean
  extractedPath: string
  extractedCount: number
}

// Extract a zip file
export async function extractZip(
  path: string,
  outputPath?: string
): Promise<ExtractResponse> {
  return api.post<ExtractResponse>('/files/extract', { path, outputPath })
}

// ZIP preview types
export interface ZipFileEntry {
  name: string
  path: string
  size: number
  compressedSize: number
  isDir: boolean
  modTime: string
}

export interface ZipPreviewResponse {
  fileName: string
  totalFiles: number
  totalSize: number
  files: ZipFileEntry[]
}

// Preview ZIP file contents
export async function previewZip(path: string): Promise<ZipPreviewResponse> {
  return api.get<ZipPreviewResponse>(`/zip/preview/${apiUrl.encodePath(path)}`)
}

// Download multiple files as ZIP archive
export async function downloadAsZip(
  paths: string[],
  onProgress?: (progress: number) => void
): Promise<void> {
  const response = await fetch(`${API_BASE}/download/zip`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ paths }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || 'Failed to download as ZIP')
  }

  // Get filename from Content-Disposition header
  const contentDisposition = response.headers.get('Content-Disposition')
  let filename = 'download.zip'
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="(.+)"/)
    if (match) filename = match[1]
  }

  // Get total size for progress
  const contentLength = response.headers.get('Content-Length')
  const total = contentLength ? parseInt(contentLength, 10) : 0

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Failed to read response')
  }

  const chunks: BlobPart[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    chunks.push(value)
    received += value.length

    if (onProgress && total > 0) {
      onProgress(Math.round((received / total) * 100))
    }
  }

  // Combine chunks and download
  const blob = new Blob(chunks, { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ==========================================
// Starred Files API
// ==========================================

export interface StarredFile {
  id: string
  filePath: string
  starredAt: string
  isDir: boolean
}

// Toggle star status for a file
export async function toggleStar(path: string): Promise<{ starred: boolean; path: string }> {
  return api.post<{ starred: boolean; path: string }>('/starred/toggle', { path })
}

// Get all starred files
export async function getStarredFiles(): Promise<{ starred: StarredFile[]; total: number }> {
  return api.get<{ starred: StarredFile[]; total: number }>('/starred')
}

// Check starred status for multiple files
export async function checkStarred(paths: string[]): Promise<{ starred: Record<string, boolean> }> {
  return api.post<{ starred: Record<string, boolean> }>('/starred/check', { paths })
}

// ==========================================
// File Locks API
// ==========================================

export interface FileLock {
  id: string
  filePath: string
  lockedBy: string
  username: string
  lockedAt: string
  expiresAt?: string
  lockType: string
  reason?: string
}

export interface LockResponse {
  locked: boolean
  path: string
  lockId?: string
  expiresAt?: string
  extended?: boolean
  error?: string
  lockedBy?: string
  lockedAt?: string
}

// Lock a file
export async function lockFile(
  path: string,
  duration?: number,
  reason?: string
): Promise<LockResponse> {
  return api.post<LockResponse>('/files/lock', { path, duration, reason })
}

// Unlock a file
export async function unlockFile(
  path: string,
  force: boolean = false
): Promise<{ unlocked: boolean; path: string; message?: string }> {
  return api.post<{ unlocked: boolean; path: string; message?: string }>('/files/unlock', { path, force })
}

// Get lock status for a single file
export async function getFileLock(path: string): Promise<{ locked: boolean; path: string; lock?: FileLock }> {
  return api.get<{ locked: boolean; path: string; lock?: FileLock }>(
    apiUrl.withParams('/files/lock', { path })
  )
}

// Check lock status for multiple files
export interface FileLockInfo {
  lockedBy: string
  username: string
  lockedAt: string
  expiresAt?: string
}

export async function checkFileLocks(paths: string[]): Promise<{ locks: Record<string, FileLockInfo> }> {
  return api.post<{ locks: Record<string, FileLockInfo> }>('/files/locks/check', { paths })
}

// Get all my locks
export async function getMyLocks(): Promise<{ locks: FileLock[]; total: number }> {
  return api.get<{ locks: FileLock[]; total: number }>('/files/locks/my')
}
