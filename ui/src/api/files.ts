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

// Helper to get auth headers
function getAuthHeaders(): HeadersInit {
  const stored = localStorage.getItem('scv-auth')
  if (stored) {
    try {
      const { state } = JSON.parse(stored)
      if (state?.token) {
        return { 'Authorization': `Bearer ${state.token}` }
      }
    } catch {
      // Ignore parse errors
    }
  }
  return {}
}

export async function fetchFiles(
  path: string = '/',
  sort: string = 'name',
  order: string = 'asc'
): Promise<ListFilesResponse> {
  const params = new URLSearchParams({ path, sort, order })
  const response = await fetch(`${API_BASE}/files?${params}`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch files')
  }

  return response.json()
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
    const chunks: Uint8Array[] = []
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
  // Remove leading slash and encode each path segment separately
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const response = await fetch(`${API_BASE}/files/${encodedPath}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to delete file')
  }
}

export async function createFolder(path: string, name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ path, name }),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to create folder')
  }
}

export async function deleteFolder(path: string, force: boolean = false): Promise<void> {
  // Remove leading slash and encode each path segment separately
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const url = `${API_BASE}/folders/${encodedPath}${force ? '?force=true' : ''}`
  const response = await fetch(url, { method: 'DELETE', headers: getAuthHeaders() })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to delete folder')
  }
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
  const params = new URLSearchParams({ path, filename })
  const response = await fetch(`${API_BASE}/files/check?${params}`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to check file existence')
  }

  return response.json()
}

export interface FolderStats {
  path: string
  fileCount: number
  folderCount: number
  totalSize: number
}

export async function getFolderStats(path: string): Promise<FolderStats> {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const response = await fetch(`${API_BASE}/folders/stats/${encodedPath}`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to get folder stats')
  }

  return response.json()
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

// Rename file or folder
export async function renameItem(path: string, newName: string): Promise<{ success: boolean; newPath: string }> {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const response = await fetch(`${API_BASE}/files/rename/${encodedPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ newName }),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to rename item')
  }

  return response.json()
}

// Move file or folder
export async function moveItem(path: string, destination: string): Promise<{ success: boolean; newPath: string }> {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const response = await fetch(`${API_BASE}/files/move/${encodedPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ destination }),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to move item')
  }

  return response.json()
}

// Copy file or folder
export async function copyItem(path: string, destination: string): Promise<{ success: boolean; newPath: string }> {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const response = await fetch(`${API_BASE}/files/copy/${encodedPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ destination }),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to copy item')
  }

  return response.json()
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
  const params = new URLSearchParams({
    q: query,
    path,
    page: String(page),
    limit: String(limit),
    matchType,
  })
  const response = await fetch(`${API_BASE}/files/search?${params}`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to search files')
  }

  return response.json()
}

// Get storage usage
export interface StorageUsage {
  homeUsed: number
  sharedUsed: number
  totalUsed: number
  quota: number
}

export async function getStorageUsage(): Promise<StorageUsage> {
  const response = await fetch(`${API_BASE}/storage/usage`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to get storage usage')
  }

  return response.json()
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
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const response = await fetch(`${API_BASE}/trash/${encodedPath}`, {
    method: 'POST',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to move to trash')
  }

  return response.json()
}

// List trash items
export async function listTrash(): Promise<TrashListResponse> {
  const response = await fetch(`${API_BASE}/trash`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to list trash')
  }

  return response.json()
}

// Restore from trash
export async function restoreFromTrash(trashId: string): Promise<{ success: boolean; restoredPath: string }> {
  const response = await fetch(`${API_BASE}/trash/restore/${encodeURIComponent(trashId)}`, {
    method: 'POST',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to restore from trash')
  }

  return response.json()
}

// Delete from trash permanently
export async function deleteFromTrash(trashId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/trash/${encodeURIComponent(trashId)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to delete from trash')
  }
}

// Empty trash
export async function emptyTrash(): Promise<{ success: boolean; deletedCount: number }> {
  const response = await fetch(`${API_BASE}/trash`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to empty trash')
  }

  return response.json()
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

// Get auth token for file URLs
export function getAuthToken(): string {
  const stored = localStorage.getItem('scv-auth')
  if (stored) {
    try {
      const { state } = JSON.parse(stored)
      return state?.token || ''
    } catch {
      return ''
    }
  }
  return ''
}

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
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const response = await fetch(`${API_BASE}/onlyoffice/config/${encodedPath}`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to get OnlyOffice config')
  }

  return response.json()
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
  const response = await fetch(`${API_BASE}/files/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ path, filename, fileType }),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to create file')
  }

  return response.json()
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
  const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, '/')
  const response = await fetch(`${API_BASE}/file-metadata/${encodedPath}`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to get file metadata')
  }

  return response.json()
}

// Update file metadata
export async function updateFileMetadata(
  filePath: string,
  data: { description?: string; tags?: string[] }
): Promise<FileMetadata> {
  const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, '/')
  const response = await fetch(`${API_BASE}/file-metadata/${encodedPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    throw new Error('Failed to update file metadata')
  }

  return response.json()
}

// Get all user tags for autocomplete
export async function getUserTags(): Promise<{ tags: string[]; total: number }> {
  const response = await fetch(`${API_BASE}/file-metadata/tags`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to get tags')
  }

  return response.json()
}

// Search files by tag
export async function searchByTag(tag: string): Promise<{ files: FileMetadata[]; total: number }> {
  const response = await fetch(`${API_BASE}/file-metadata/search?tag=${encodeURIComponent(tag)}`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to search by tag')
  }

  return response.json()
}

// Recent files
export interface RecentFile {
  path: string
  name: string
  eventType: string
  timestamp: string
  isDir: boolean
}

export async function getRecentFiles(limit: number = 10): Promise<RecentFile[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  const response = await fetch(`${API_BASE}/files/recent?${params}`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error('Failed to get recent files')
  }

  return response.json()
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
  const response = await fetch(`${API_BASE}/files/compress`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ paths, outputName }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || 'Failed to compress files')
  }

  return response.json()
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
  const response = await fetch(`${API_BASE}/files/extract`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, outputPath }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || 'Failed to extract zip file')
  }

  return response.json()
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
  const encodedPath = path.startsWith('/') ? path.slice(1) : path
  const response = await fetch(`${API_BASE}/zip/preview/${encodedPath}`, {
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || 'Failed to preview zip file')
  }

  return response.json()
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

  const chunks: Uint8Array[] = []
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
