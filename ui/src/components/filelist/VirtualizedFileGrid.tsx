// 가상 스크롤이 적용된 파일 그리드 컴포넌트
// 100개 이상의 파일이 있을 때 자동으로 가상화 적용

import React, { useRef, useState, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FileInfo } from '../../api/files'
import FileCard from './FileCard'
import { VIRTUALIZATION_THRESHOLD } from './VirtualizedFileTable'

// 그리드 아이템 최소 너비 (CSS의 minmax(140px, 1fr)과 일치)
const CARD_MIN_WIDTH = 140
// 그리드 갭 (var(--spacing-md) = 16px)
const GRID_GAP = 16
// 그리드 패딩 (var(--spacing-lg) = 24px)
const GRID_PADDING = 24
// 행 높이 (카드 높이 + 갭) - 아이콘 64px + 패딩 + 텍스트
const ROW_HEIGHT = 130

export interface VirtualizedFileGridProps {
  files: FileInfo[]
  selectedFiles: Set<string>
  focusedIndex: number
  dropTargetPath: string | null
  draggedFiles: FileInfo[]
  clipboard: { files: FileInfo[]; mode: 'copy' | 'cut' } | null
  highlightedPath?: string | null
  // Handlers
  onSelect: (file: FileInfo, e: React.MouseEvent) => void
  onDoubleClick: (file: FileInfo) => void
  onContextMenu: (e: React.MouseEvent, file: FileInfo) => void
  onDragStart: (e: React.DragEvent, file: FileInfo) => void
  onDragEnd: () => void
  onFolderDragOver: (e: React.DragEvent, folder: FileInfo) => void
  onFolderDragLeave: (e: React.DragEvent) => void
  onFolderDrop: (e: React.DragEvent, folder: FileInfo) => void
  // Utilities
  getFileIcon: (file: FileInfo) => React.ReactNode
  setFocusedIndex: (index: number) => void
  // Ref for file rows
  fileRowRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
}

export default function VirtualizedFileGrid({
  files,
  selectedFiles,
  focusedIndex,
  dropTargetPath,
  draggedFiles,
  clipboard,
  highlightedPath,
  onSelect,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  getFileIcon,
  setFocusedIndex,
  fileRowRefs,
}: VirtualizedFileGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  // 컨테이너 너비 측정
  useEffect(() => {
    const updateWidth = () => {
      if (scrollRef.current) {
        setContainerWidth(scrollRef.current.clientWidth)
      }
    }

    updateWidth()

    const resizeObserver = new ResizeObserver(updateWidth)
    if (scrollRef.current) {
      resizeObserver.observe(scrollRef.current)
    }

    return () => resizeObserver.disconnect()
  }, [])

  // 열 수 계산
  const availableWidth = containerWidth - (GRID_PADDING * 2)
  const columnsCount = Math.max(1, Math.floor((availableWidth + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)))

  // 행 수 계산
  const rowsCount = Math.ceil(files.length / columnsCount)

  // 가상화 사용 여부 결정
  const shouldVirtualize = files.length > VIRTUALIZATION_THRESHOLD

  const virtualizer = useVirtualizer({
    count: rowsCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5, // 위아래 5행씩 추가 렌더링
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalHeight = virtualizer.getTotalSize()

  // 하이라이트된 파일로 스크롤
  useEffect(() => {
    if (highlightedPath && shouldVirtualize && columnsCount > 0) {
      const fileIndex = files.findIndex((f) => f.path === highlightedPath)
      if (fileIndex !== -1) {
        const rowIndex = Math.floor(fileIndex / columnsCount)
        virtualizer.scrollToIndex(rowIndex, { align: 'center' })
      }
    }
  }, [highlightedPath, files, shouldVirtualize, columnsCount, virtualizer])

  // 행 내 파일 가져오기
  const getFilesForRow = useCallback((rowIndex: number): FileInfo[] => {
    const startIdx = rowIndex * columnsCount
    const endIdx = Math.min(startIdx + columnsCount, files.length)
    return files.slice(startIdx, endIdx)
  }, [files, columnsCount])

  // 파일 인덱스 가져오기
  const getFileIndex = useCallback((rowIndex: number, colIndex: number): number => {
    return rowIndex * columnsCount + colIndex
  }, [columnsCount])

  // 카드 렌더링
  const renderCard = useCallback((file: FileInfo, rowIndex: number, colIndex: number) => {
    const index = getFileIndex(rowIndex, colIndex)
    const isSelected = selectedFiles.has(file.path)
    const isFocused = focusedIndex === index
    const isDropTarget = dropTargetPath === file.path
    const isDragging = draggedFiles.some(f => f.path === file.path)
    const isCut = clipboard?.mode === 'cut' && clipboard.files.some(f => f.path === file.path)

    return (
      <FileCard
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
        onSelect={onSelect}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onFolderDragOver={onFolderDragOver}
        onFolderDragLeave={onFolderDragLeave}
        onFolderDrop={onFolderDrop}
        getFileIcon={getFileIcon}
        setFocusedIndex={setFocusedIndex}
      />
    )
  }, [
    getFileIndex, selectedFiles, focusedIndex, dropTargetPath, draggedFiles, clipboard,
    onSelect, onDoubleClick, onContextMenu, onDragStart, onDragEnd,
    onFolderDragOver, onFolderDragLeave, onFolderDrop, getFileIcon, setFocusedIndex, fileRowRefs,
  ])

  // 가상 행 렌더링
  const renderVirtualRow = useCallback((virtualRow: { index: number; start: number; size: number }) => {
    const { index, start, size } = virtualRow
    const rowFiles = getFilesForRow(index)

    return (
      <div
        key={index}
        className="file-grid-virtual-row"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: `${size}px`,
          transform: `translateY(${start}px)`,
          display: 'grid',
          gridTemplateColumns: `repeat(${columnsCount}, 1fr)`,
          gap: `${GRID_GAP}px`,
          padding: `0 ${GRID_PADDING}px`,
          alignItems: 'start',
        }}
      >
        {rowFiles.map((file, colIndex) => renderCard(file, index, colIndex))}
      </div>
    )
  }, [getFilesForRow, columnsCount, renderCard])

  // 가상화 비활성화 시 일반 렌더링
  if (!shouldVirtualize) {
    return (
      <div className="file-grid">
        {files.map((file, index) => {
          const isSelected = selectedFiles.has(file.path)
          const isFocused = focusedIndex === index
          const isDropTarget = dropTargetPath === file.path
          const isDragging = draggedFiles.some(f => f.path === file.path)
          const isCut = clipboard?.mode === 'cut' && clipboard.files.some(f => f.path === file.path)

          return (
            <FileCard
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
              onSelect={onSelect}
              onDoubleClick={onDoubleClick}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onFolderDragOver={onFolderDragOver}
              onFolderDragLeave={onFolderDragLeave}
              onFolderDrop={onFolderDrop}
              getFileIcon={getFileIcon}
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
      className="file-grid file-grid-virtual"
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

      {/* 가상화 활성화 표시 (개발/디버깅용) */}
      <div
        style={{
          position: 'fixed',
          bottom: '80px',
          right: '20px',
          background: 'rgba(0, 0, 0, 0.7)',
          color: '#fff',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '11px',
          zIndex: 1000,
          pointerEvents: 'none',
        }}
      >
        가상 그리드 ({files.length}개 중 {virtualItems.length * columnsCount}개 렌더링)
      </div>
    </div>
  )
}
