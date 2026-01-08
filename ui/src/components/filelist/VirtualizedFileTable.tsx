// 가상 스크롤이 적용된 파일 테이블 컴포넌트
// 100개 이상의 파일이 있을 때 자동으로 가상화 적용

import React, { useRef, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FileInfo } from '../../api/files'
import FileRow from './FileRow'
import { SharedFileInfo } from './types'

// 가상화 임계값 - 이 수 이상일 때만 가상 스크롤 적용
const VIRTUALIZATION_THRESHOLD = 100

// 행 높이 (px) - CSS의 .file-row 높이와 일치해야 함
const ROW_HEIGHT = 44

// File lock info interface
interface FileLockInfo {
  username: string
  lockedAt: string
}

export interface VirtualizedFileTableProps {
  files: FileInfo[]
  selectedFiles: Set<string>
  focusedIndex: number
  dropTargetPath: string | null
  draggedFiles: FileInfo[]
  clipboard: { files: FileInfo[]; mode: 'copy' | 'cut' } | null
  isSharedWithMeView: boolean
  isSharedByMeView: boolean
  isLinkSharesView: boolean
  highlightedPath?: string | null
  // Starred and lock status
  starredFiles?: Record<string, boolean>
  lockedFiles?: Record<string, FileLockInfo>
  // Handlers
  onSelect: (file: FileInfo, e: React.MouseEvent) => void
  onDoubleClick: (file: FileInfo) => void
  onContextMenu: (e: React.MouseEvent, file: FileInfo) => void
  onDragStart: (e: React.DragEvent, file: FileInfo) => void
  onDragEnd: () => void
  onFolderDragOver: (e: React.DragEvent, folder: FileInfo) => void
  onFolderDragLeave: (e: React.DragEvent) => void
  onFolderDrop: (e: React.DragEvent, folder: FileInfo) => void
  onUnshare?: (file: SharedFileInfo) => void
  onCopyLink?: (file: SharedFileInfo) => void
  onDeleteLink?: (file: SharedFileInfo) => void
  onToggleStar?: (file: FileInfo) => void
  // Utilities
  getFileIcon: (file: FileInfo) => React.ReactNode
  formatDate: (date: string) => string
  getFullDateTime: (date: string) => string
  setFocusedIndex: (index: number) => void
  // Ref for file rows
  fileRowRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
}

export default function VirtualizedFileTable({
  files,
  selectedFiles,
  focusedIndex,
  dropTargetPath,
  draggedFiles,
  clipboard,
  isSharedWithMeView,
  isSharedByMeView,
  isLinkSharesView,
  highlightedPath,
  starredFiles,
  lockedFiles,
  onSelect,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  onUnshare,
  onCopyLink,
  onDeleteLink,
  onToggleStar,
  getFileIcon,
  formatDate,
  getFullDateTime,
  setFocusedIndex,
  fileRowRefs,
}: VirtualizedFileTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // 가상화 사용 여부 결정
  const shouldVirtualize = files.length > VIRTUALIZATION_THRESHOLD

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15, // 위아래 15개씩 추가 렌더링 (스크롤 시 깜빡임 방지)
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalHeight = virtualizer.getTotalSize()

  // 하이라이트된 파일로 스크롤
  useEffect(() => {
    if (highlightedPath && shouldVirtualize) {
      const index = files.findIndex((f) => f.path === highlightedPath)
      if (index !== -1) {
        virtualizer.scrollToIndex(index, { align: 'center' })
      }
    }
  }, [highlightedPath, files, shouldVirtualize, virtualizer])

  // 행 렌더링 함수
  const renderVirtualRow = useCallback((virtualRow: { index: number; start: number; size: number }) => {
    const { index, start, size } = virtualRow
    const file = files[index]
    if (!file) return null

    const isSelected = selectedFiles.has(file.path)
    const isFocused = focusedIndex === index
    const isDropTarget = dropTargetPath === file.path
    const isDragging = draggedFiles.some(f => f.path === file.path)
    const isCut = clipboard?.mode === 'cut' && clipboard.files.some(f => f.path === file.path)
    const isStarred = starredFiles?.[file.path] ?? false
    const lockInfo = lockedFiles?.[file.path]
    const isLocked = !!lockInfo

    return (
      <div
        key={file.path}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: `${size}px`,
          transform: `translateY(${start}px)`,
        }}
      >
        <FileRow
          ref={(el) => {
            if (el) fileRowRefs.current.set(file.path, el)
            else fileRowRefs.current.delete(file.path)
          }}
          file={file}
          index={index}
          isSelected={isSelected}
          isFocused={isFocused}
          isDropTarget={isDropTarget}
          isDragging={isDragging}
          isCut={isCut}
          isSharedWithMeView={isSharedWithMeView}
          isSharedByMeView={isSharedByMeView}
          isLinkSharesView={isLinkSharesView}
          isStarred={isStarred}
          isLocked={isLocked}
          lockInfo={lockInfo}
          onSelect={onSelect}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onFolderDragOver={onFolderDragOver}
          onFolderDragLeave={onFolderDragLeave}
          onFolderDrop={onFolderDrop}
          onUnshare={onUnshare}
          onCopyLink={onCopyLink}
          onDeleteLink={onDeleteLink}
          onToggleStar={onToggleStar}
          getFileIcon={getFileIcon}
          formatDate={formatDate}
          getFullDateTime={getFullDateTime}
          setFocusedIndex={setFocusedIndex}
        />
      </div>
    )
  }, [
    files, selectedFiles, focusedIndex, dropTargetPath, draggedFiles, clipboard,
    isSharedWithMeView, isSharedByMeView, isLinkSharesView, starredFiles, lockedFiles,
    onSelect, onDoubleClick, onContextMenu, onDragStart, onDragEnd,
    onFolderDragOver, onFolderDragLeave, onFolderDrop, onUnshare, onCopyLink,
    onDeleteLink, onToggleStar, getFileIcon, formatDate, getFullDateTime, setFocusedIndex, fileRowRefs,
  ])

  // 가상화 비활성화 시 일반 렌더링
  if (!shouldVirtualize) {
    return (
      <div className="file-table-body">
        {files.map((file, index) => {
          const isSelected = selectedFiles.has(file.path)
          const isFocused = focusedIndex === index
          const isDropTarget = dropTargetPath === file.path
          const isDragging = draggedFiles.some(f => f.path === file.path)
          const isCut = clipboard?.mode === 'cut' && clipboard.files.some(f => f.path === file.path)
          const isStarred = starredFiles?.[file.path] ?? false
          const lockInfo = lockedFiles?.[file.path]
          const isLocked = !!lockInfo

          return (
            <FileRow
              key={file.path}
              ref={(el) => {
                if (el) fileRowRefs.current.set(file.path, el)
                else fileRowRefs.current.delete(file.path)
              }}
              file={file}
              index={index}
              isSelected={isSelected}
              isFocused={isFocused}
              isDropTarget={isDropTarget}
              isDragging={isDragging}
              isCut={isCut}
              isSharedWithMeView={isSharedWithMeView}
              isSharedByMeView={isSharedByMeView}
              isLinkSharesView={isLinkSharesView}
              isStarred={isStarred}
              isLocked={isLocked}
              lockInfo={lockInfo}
              onSelect={onSelect}
              onDoubleClick={onDoubleClick}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onFolderDragOver={onFolderDragOver}
              onFolderDragLeave={onFolderDragLeave}
              onFolderDrop={onFolderDrop}
              onUnshare={onUnshare}
              onCopyLink={onCopyLink}
              onDeleteLink={onDeleteLink}
              onToggleStar={onToggleStar}
              getFileIcon={getFileIcon}
              formatDate={formatDate}
              getFullDateTime={getFullDateTime}
              setFocusedIndex={setFocusedIndex}
            />
          )
        })}
      </div>
    )
  }

  // 가상화 활성화 시
  return (
    <div
      ref={scrollRef}
      className="file-table-body file-table-body-virtual"
    >
      {/* 전체 콘텐츠 높이를 나타내는 컨테이너 */}
      <div
        style={{
          height: `${totalHeight}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map(renderVirtualRow)}
      </div>
    </div>
  )
}

export { VIRTUALIZATION_THRESHOLD }
