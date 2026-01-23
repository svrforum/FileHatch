// FileList 관련 공유 타입 정의

import { FileInfo, FolderStats, OnlyOfficeConfig, FileMetadata } from '../../api/files'
import { SharedFolderWithPermission } from '../../api/sharedFolders'

export type SortField = 'name' | 'size' | 'date'
export type SortOrder = 'asc' | 'desc'
export type ViewMode = 'list' | 'grid'

export type ContextMenuType =
  | { type: 'file'; x: number; y: number; file: FileInfo; selectedPaths: string[] }
  | { type: 'background'; x: number; y: number }
  | null

export type HistoryAction = {
  type: 'move' | 'copy' | 'delete' | 'rename'
  sourcePaths: string[]
  destPaths?: string[]
  destination?: string
  oldName?: string
  newName?: string
}

export type ToastItem = {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

// 공유 파일 확장 타입
export interface SharedFileInfo extends FileInfo {
  sharedBy?: string
  sharedWith?: string
  permissionLevel?: number
  shareId?: number
  // Link share fields
  linkToken?: string
  linkId?: string
  accessCount?: number
  maxAccess?: number
  expiresAt?: string
  hasPassword?: boolean
  isActive?: boolean
  requireLogin?: boolean
  shareType?: 'download' | 'upload' | 'edit'
}

export interface FileListState {
  sortBy: SortField
  sortOrder: SortOrder
  viewMode: ViewMode
  focusedIndex: number
  contextMenu: ContextMenuType
  deleteTarget: FileInfo | null
  renameTarget: FileInfo | null
  newName: string
  copyTarget: FileInfo | null
  selectedFile: FileInfo | null
  selectedFiles: Set<string>
  folderStats: FolderStats | null
  loadingStats: boolean
  toasts: ToastItem[]
  isDraggingFiles: boolean
  editingFile: FileInfo | null
  viewingFile: FileInfo | null
  thumbnailUrl: string | null
  onlyOfficeAvailable: boolean
  onlyOfficePublicUrl: string | null
  onlyOfficeFile: FileInfo | null
  onlyOfficeConfig: OnlyOfficeConfig | null
  showNewFileModal: boolean
  newFileType: string
  newFileName: string
  showNewFileSubmenu: boolean
  shareTarget: FileInfo | null
  linkShareTarget: FileInfo | null
  sharedFolders: SharedFolderWithPermission[]
  showCompressModal: boolean
  compressFileName: string
  pathsToCompress: string[]
  clipboard: { files: FileInfo[]; mode: 'copy' | 'cut' } | null
  draggedFiles: FileInfo[]
  dropTargetPath: string | null
  isMarqueeSelecting: boolean
  marqueeStart: { x: number; y: number } | null
  marqueeEnd: { x: number; y: number } | null
  historyState: { actions: HistoryAction[]; index: number }
  fileMetadata: FileMetadata | null
  loadingMetadata: boolean
  editingDescription: boolean
  descriptionInput: string
  tagInput: string
  allUserTags: string[]
  tagSuggestions: string[]
  searchBuffer: string
}

export interface FileRowProps {
  file: FileInfo
  index: number
  isSelected: boolean
  isFocused: boolean
  isDropTarget: boolean
  isDragging: boolean
  isCut: boolean
  isSharedWithMeView: boolean
  isSharedByMeView: boolean
  isLinkSharesView: boolean
  onSelect: (file: FileInfo, e: React.MouseEvent) => void
  onDoubleClick: (file: FileInfo) => void
  onContextMenu: (e: React.MouseEvent, file: FileInfo) => void
  onDragStart: (e: React.DragEvent, file: FileInfo) => void
  onDragEnd: () => void
  onFolderDragOver?: (e: React.DragEvent, folder: FileInfo) => void
  onFolderDragLeave?: (e: React.DragEvent) => void
  onFolderDrop?: (e: React.DragEvent, folder: FileInfo) => void
  onUnshare?: (file: SharedFileInfo) => void
  onCopyLink?: (file: SharedFileInfo) => void
  onDeleteLink?: (file: SharedFileInfo) => void
  getFileIcon: (file: FileInfo) => React.ReactNode
  formatDate: (date: string) => string
}

export interface ShareOptionsDisplayProps {
  file: SharedFileInfo
}

export interface FileInfoPanelProps {
  selectedFile: FileInfo
  thumbnailUrl: string | null
  folderStats: FolderStats | null
  loadingStats: boolean
  fileMetadata: FileMetadata | null
  loadingMetadata: boolean
  editingDescription: boolean
  descriptionInput: string
  tagInput: string
  tagSuggestions: string[]
  isSpecialShareView: boolean
  onClose: () => void
  onView: (file: FileInfo) => void
  onDownload: (file: FileInfo) => void
  onShare: (file: FileInfo) => void
  onLinkShare: (file: FileInfo) => void
  onDelete: (file: FileInfo) => void
  onDescriptionChange: (value: string) => void
  onDescriptionSave: () => void
  onDescriptionEdit: (editing: boolean) => void
  onTagInputChange: (value: string) => void
  onAddTag: (tag: string) => void
  onRemoveTag: (tag: string) => void
  getFileIcon: (file: FileInfo) => React.ReactNode
}
