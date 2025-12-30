// 컨텍스트 메뉴 컴포넌트
// 파일/폴더 우클릭 시 표시되는 메뉴

import React from 'react'
import { FileInfo } from '../../api/files'
import { ContextMenuType } from './types'

// 파일 타입 옵션
interface FileTypeOption {
  type: string
  name: string
  icon: string
}

interface ContextMenuProps {
  contextMenu: ContextMenuType | null
  contextMenuPosition: { x: number; y: number } | null
  contextMenuRef: React.RefObject<HTMLDivElement>
  isSpecialShareView: boolean
  isSharedWithMeView: boolean
  isSharedByMeView: boolean
  isLinkSharesView: boolean
  showNewFileSubmenu: boolean
  fileTypeOptions: FileTypeOption[]
  onlyOfficeAvailable: boolean
  onClose: () => void
  onUploadClick: () => void
  onNewFolderClick: () => void
  onNewFileSelect: (type: string) => void
  onSetShowNewFileSubmenu: (show: boolean) => void
  onNavigateToOriginal: (path: string) => void
  onDownload: (file: FileInfo) => void
  onMultiDownload: (paths: string[]) => void
  onEdit: (file: FileInfo) => void
  onOnlyOfficeEdit: (file: FileInfo) => void
  onView: (file: FileInfo) => void
  onRename: (file: FileInfo) => void
  onCopy: (file: FileInfo) => void
  onMoveTo: (paths: string[]) => void
  onCopyTo: (paths: string[]) => void
  onCompress: (paths: string[]) => void
  onExtract: (file: FileInfo) => void
  onShare: (file: FileInfo) => void
  onLinkShare: (file: FileInfo) => void
  onDelete: (file: FileInfo) => void
  onUnshare: (shareId: number) => Promise<void>
  onDeleteLink: (linkId: string) => Promise<void>
  onCopyLink: (token: string) => void
  isEditableFile: (file: FileInfo) => boolean
  isViewableFile: (file: FileInfo) => boolean
  isOnlyOfficeSupported: (ext?: string) => boolean
}

function ContextMenu({
  contextMenu,
  contextMenuPosition,
  contextMenuRef,
  isSpecialShareView,
  isSharedWithMeView,
  isSharedByMeView,
  isLinkSharesView,
  showNewFileSubmenu,
  fileTypeOptions,
  onlyOfficeAvailable,
  onClose,
  onUploadClick,
  onNewFolderClick,
  onNewFileSelect,
  onSetShowNewFileSubmenu,
  onNavigateToOriginal,
  onDownload,
  onMultiDownload,
  onEdit,
  onOnlyOfficeEdit,
  onView,
  onRename,
  onCopy,
  onMoveTo,
  onCopyTo,
  onCompress,
  onExtract,
  onShare,
  onLinkShare,
  onDelete,
  onUnshare,
  onDeleteLink,
  onCopyLink,
  isEditableFile,
  isViewableFile,
  isOnlyOfficeSupported,
}: ContextMenuProps) {
  if (!contextMenu) return null

  const renderFileTypeIcon = (icon: string) => {
    switch (icon) {
      case 'text':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2"/>
            <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2"/>
            <path d="M8 13H16M8 17H12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        )
      case 'markdown':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="2"/>
            <path d="M6 8V16M6 12L9 8V16M14 12L16 8L18 12M14 16V12M18 16V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )
      case 'html':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2"/>
            <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2"/>
            <path d="M8 13L10 15L8 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M16 13L14 15L16 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )
      case 'json':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2"/>
            <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2"/>
            <path d="M8 12C8 11 9 11 9 12V13C9 14 8 14 8 14M8 16C8 17 9 17 9 16V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M16 12C16 11 15 11 15 12V13C15 14 16 14 16 14M16 16C16 17 15 17 15 16V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )
      case 'word':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="#2B579A" strokeWidth="2"/>
            <path d="M14 2V8H20" stroke="#2B579A" strokeWidth="2"/>
            <text x="12" y="16" textAnchor="middle" fontSize="6" fill="#2B579A" fontWeight="bold">W</text>
          </svg>
        )
      case 'excel':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="#217346" strokeWidth="2"/>
            <path d="M14 2V8H20" stroke="#217346" strokeWidth="2"/>
            <text x="12" y="16" textAnchor="middle" fontSize="6" fill="#217346" fontWeight="bold">X</text>
          </svg>
        )
      case 'powerpoint':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="#D24726" strokeWidth="2"/>
            <path d="M14 2V8H20" stroke="#D24726" strokeWidth="2"/>
            <text x="12" y="16" textAnchor="middle" fontSize="6" fill="#D24726" fontWeight="bold">P</text>
          </svg>
        )
      default:
        return null
    }
  }

  return (
    <div
      ref={contextMenuRef}
      className="context-menu"
      style={{
        top: contextMenuPosition?.y ?? contextMenu.y,
        left: contextMenuPosition?.x ?? contextMenu.x,
        visibility: contextMenuPosition ? 'visible' : 'hidden'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {contextMenu.type === 'background' ? (
        isSpecialShareView ? (
          <div className="context-menu-item disabled">
            {isSharedWithMeView ? '나에게 공유된 파일에서는 작업을 할 수 없습니다' :
             isSharedByMeView ? '다른사용자에 공유된 파일에서는 작업을 할 수 없습니다' :
             '링크로 공유된 파일에서는 작업을 할 수 없습니다'}
          </div>
        ) : (
          <>
            <button className="context-menu-item" onClick={() => { onClose(); onUploadClick(); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              파일 업로드
            </button>
            <button className="context-menu-item" onClick={() => { onClose(); onNewFolderClick(); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 11V17M9 14H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              새 폴더
            </button>
            <div className="context-menu-divider" />
            <div
              className="context-menu-item has-submenu"
              onMouseEnter={() => onSetShowNewFileSubmenu(true)}
              onMouseLeave={() => onSetShowNewFileSubmenu(false)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 18V12M9 15H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              새 파일
              <svg className="submenu-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {showNewFileSubmenu && (
                <div className="context-submenu">
                  {fileTypeOptions.map((option) => (
                    <button
                      key={option.type}
                      className="context-menu-item"
                      onClick={() => onNewFileSelect(option.type)}
                    >
                      {renderFileTypeIcon(option.icon)}
                      {option.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )
      ) : isSpecialShareView ? (
        <>
          {/* Share view file context menu */}
          <button className="context-menu-item" onClick={() => { onNavigateToOriginal(contextMenu.file.path.substring(0, contextMenu.file.path.lastIndexOf('/'))); onClose(); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="2"/>
            </svg>
            원본 위치로 이동
          </button>
          {!contextMenu.file.isDir && (
            <button className="context-menu-item" onClick={() => onDownload(contextMenu.file)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              다운로드
            </button>
          )}
          {isLinkSharesView && (
            <button className="context-menu-item" onClick={() => {
              const file = contextMenu.file as FileInfo & { linkToken?: string }
              if (file.linkToken) {
                onCopyLink(file.linkToken)
              }
              onClose()
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
                <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" strokeWidth="2"/>
              </svg>
              링크 복사
            </button>
          )}
          <div className="context-menu-divider" />
          {isSharedByMeView && (
            <button className="context-menu-item danger" onClick={async () => {
              const file = contextMenu.file as FileInfo & { shareId?: number }
              if (file.shareId) {
                await onUnshare(file.shareId)
              }
              onClose()
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M19 6V20C19 21.1 18.1 22 17 22H7C5.9 22 5 21.1 5 20V6" stroke="currentColor" strokeWidth="2"/>
              </svg>
              공유 해제
            </button>
          )}
          {isLinkSharesView && (
            <button className="context-menu-item danger" onClick={async () => {
              const file = contextMenu.file as FileInfo & { linkId?: string }
              if (file.linkId) {
                await onDeleteLink(file.linkId)
              }
              onClose()
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M19 6V20C19 21.1 18.1 22 17 22H7C5.9 22 5 21.1 5 20V6" stroke="currentColor" strokeWidth="2"/>
              </svg>
              링크 삭제
            </button>
          )}
        </>
      ) : (
        <>
          {!contextMenu.file.isDir && isEditableFile(contextMenu.file) && (
            <button className="context-menu-item" onClick={() => { onEdit(contextMenu.file); onClose(); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              편집
            </button>
          )}
          {!contextMenu.file.isDir && onlyOfficeAvailable && isOnlyOfficeSupported(contextMenu.file.extension) && (
            <button className="context-menu-item" onClick={() => { onOnlyOfficeEdit(contextMenu.file); onClose(); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 13H16M8 17H12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              Office 편집
            </button>
          )}
          {!contextMenu.file.isDir && isViewableFile(contextMenu.file) && (
            <button className="context-menu-item" onClick={() => { onView(contextMenu.file); onClose(); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M1 12S5 4 12 4S23 12 23 12S19 20 12 20S1 12 1 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
              </svg>
              미리보기
            </button>
          )}
          {/* Download button - shows modal for multiple files */}
          {!contextMenu.file.isDir && (
            <button className="context-menu-item" onClick={() => {
              if (contextMenu.selectedPaths.length > 1) {
                onMultiDownload(contextMenu.selectedPaths)
              } else {
                onDownload(contextMenu.file)
              }
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {contextMenu.selectedPaths.length > 1 ? `${contextMenu.selectedPaths.length}개 다운로드` : '다운로드'}
            </button>
          )}
          <button className="context-menu-item" onClick={() => onRename(contextMenu.file)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            이름 변경
          </button>
          <button className="context-menu-item" onClick={() => onCopy(contextMenu.file)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
              <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" strokeWidth="2"/>
            </svg>
            복사
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => {
            onMoveTo(contextMenu.selectedPaths.length > 0 ? contextMenu.selectedPaths : [contextMenu.file.path])
            onClose()
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M5 9L2 12L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H11C10.4696 21 9.96086 20.7893 9.58579 20.4142C9.21071 20.0391 9 19.5304 9 19V5C9 4.46957 9.21071 3.96086 9.58579 3.58579C9.96086 3.21071 10.4696 3 11 3H16L22 9V19Z" stroke="currentColor" strokeWidth="2"/>
              <path d="M16 3V9H22" stroke="currentColor" strokeWidth="2"/>
            </svg>
            {contextMenu.selectedPaths.length > 1 ? `${contextMenu.selectedPaths.length}개 이동...` : '이동...'}
          </button>
          <button className="context-menu-item" onClick={() => {
            onCopyTo(contextMenu.selectedPaths.length > 0 ? contextMenu.selectedPaths : [contextMenu.file.path])
            onClose()
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
              <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 14V18M10 16H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            {contextMenu.selectedPaths.length > 1 ? `${contextMenu.selectedPaths.length}개 복사...` : '복사...'}
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => {
            onCompress(contextMenu.selectedPaths)
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M21 8V21H3V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M23 3H1V8H23V3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M10 12H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {contextMenu.selectedPaths.length > 1 ? `${contextMenu.selectedPaths.length}개 압축` : '압축'}
          </button>
          {/* Extract button - only for zip files */}
          {contextMenu.file.name.toLowerCase().endsWith('.zip') && (
            <button className="context-menu-item" onClick={() => onExtract(contextMenu.file)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M21 8V21H3V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M23 3H1V8H23V3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 11V17M12 17L9 14M12 17L15 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              압축풀기
            </button>
          )}
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => { onShare(contextMenu.file); onClose(); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="2"/>
              <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
              <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="2"/>
              <path d="M8.59 13.51L15.42 17.49M15.41 6.51L8.59 10.49" stroke="currentColor" strokeWidth="2"/>
            </svg>
            사용자에게 공유
          </button>
          <button className="context-menu-item" onClick={() => { onLinkShare(contextMenu.file); onClose(); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            링크로 공유
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-item danger" onClick={() => onDelete(contextMenu.file)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            삭제
          </button>
        </>
      )}
    </div>
  )
}

export default ContextMenu
