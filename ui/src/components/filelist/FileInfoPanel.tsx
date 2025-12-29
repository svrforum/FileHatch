// 파일 상세정보 패널 컴포넌트 - 우측에 표시되는 파일 정보 패널

import { FileInfo, FolderStats, formatFileSize, FileMetadata } from '../../api/files'

interface FileInfoPanelProps {
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
  onDescriptionInputChange: (value: string) => void
  onTagInputChange: (value: string) => void
  onAddTag: (tag: string) => void
  onRemoveTag: (tag: string) => void
  getFileIcon: (file: FileInfo) => React.ReactNode
}

function FileInfoPanel({
  selectedFile,
  thumbnailUrl,
  folderStats,
  loadingStats,
  fileMetadata,
  loadingMetadata,
  editingDescription,
  descriptionInput,
  tagInput,
  tagSuggestions,
  isSpecialShareView,
  onClose,
  onView,
  onDownload,
  onShare,
  onLinkShare,
  onDelete,
  onDescriptionChange,
  onDescriptionSave,
  onDescriptionEdit,
  onDescriptionInputChange,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
  getFileIcon,
}: FileInfoPanelProps) {
  return (
    <div className="file-details-panel" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="details-header">
        <h3>파일 정보</h3>
        <button className="close-details-btn" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {thumbnailUrl ? (
        <div className="details-thumbnail" onClick={() => onView(selectedFile)}>
          <img src={thumbnailUrl} alt={selectedFile.name} />
          <div className="thumbnail-overlay">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M1 12S5 4 12 4S23 12 23 12S19 20 12 20S1 12 1 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </div>
        </div>
      ) : (
        <div className="details-icon">
          {getFileIcon(selectedFile)}
        </div>
      )}

      <div className="details-name">{selectedFile.name}</div>

      <div className="details-list">
        <div className="details-item">
          <span className="details-label">종류</span>
          <span className="details-value">
            {selectedFile.isDir ? '폴더' : (selectedFile.extension ? selectedFile.extension.toUpperCase() + ' 파일' : '파일')}
          </span>
        </div>

        {selectedFile.isDir ? (
          <>
            {loadingStats ? (
              <div className="details-item">
                <span className="details-label">내용</span>
                <span className="details-value">계산 중...</span>
              </div>
            ) : folderStats && (
              <>
                <div className="details-item">
                  <span className="details-label">내용</span>
                  <span className="details-value">
                    폴더 {folderStats.folderCount}개, 파일 {folderStats.fileCount}개
                  </span>
                </div>
                <div className="details-item">
                  <span className="details-label">총 크기</span>
                  <span className="details-value">{formatFileSize(folderStats.totalSize)}</span>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="details-item">
            <span className="details-label">크기</span>
            <span className="details-value">{formatFileSize(selectedFile.size)}</span>
          </div>
        )}

        <div className="details-item">
          <span className="details-label">수정일</span>
          <span className="details-value">{new Date(selectedFile.modTime).toLocaleString('ko-KR')}</span>
        </div>

        <div className="details-item">
          <span className="details-label">경로</span>
          <span className="details-value path">{selectedFile.path}</span>
        </div>
      </div>

      {/* File Metadata Section */}
      {!loadingMetadata && (
        <div className="details-metadata">
          {/* Description */}
          <div className="metadata-row">
            <span className="metadata-label">설명</span>
            {editingDescription ? (
              <div className="metadata-edit-inline">
                <textarea
                  className="description-input"
                  value={descriptionInput}
                  onChange={(e) => onDescriptionInputChange(e.target.value)}
                  placeholder="설명 입력..."
                  rows={2}
                  autoFocus
                  onBlur={() => {
                    if (descriptionInput !== (fileMetadata?.description || '')) {
                      onDescriptionSave()
                    } else {
                      onDescriptionEdit(false)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      onDescriptionSave()
                    } else if (e.key === 'Escape') {
                      onDescriptionEdit(false)
                      onDescriptionChange(fileMetadata?.description || '')
                    }
                  }}
                />
              </div>
            ) : (
              <div
                className={`metadata-value clickable ${!isSpecialShareView ? 'editable' : ''}`}
                onClick={() => {
                  if (!isSpecialShareView) {
                    onDescriptionChange(fileMetadata?.description || '')
                    onDescriptionEdit(true)
                  }
                }}
              >
                {fileMetadata?.description || <span className="placeholder">클릭하여 설명 추가</span>}
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="metadata-row">
            <span className="metadata-label">태그</span>
            <div className="tags-inline">
              {fileMetadata?.tags?.map(tag => (
                <span key={tag} className="tag-chip">
                  #{tag}
                  {!isSpecialShareView && (
                    <button className="tag-remove-btn" onClick={() => onRemoveTag(tag)}>×</button>
                  )}
                </span>
              ))}
              {!isSpecialShareView && (
                <div className="tag-add-inline">
                  <input
                    type="text"
                    className="tag-add-input"
                    placeholder="+ 태그"
                    value={tagInput}
                    onChange={(e) => onTagInputChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        onAddTag(tagInput)
                      }
                    }}
                  />
                  {tagSuggestions.length > 0 && (
                    <div className="tag-dropdown">
                      {tagSuggestions.map(tag => (
                        <button key={tag} onClick={() => onAddTag(tag)}>#{tag}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="details-actions">
        {!selectedFile.isDir && (
          <button className="btn-detail-action" onClick={() => onDownload(selectedFile)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            다운로드
          </button>
        )}
        {!isSpecialShareView && (
          <>
            <button className="btn-detail-action" onClick={() => onShare(selectedFile)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="2"/>
                <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="2"/>
                <path d="M8.59 13.51L15.42 17.49" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M15.41 6.51L8.59 10.49" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              공유
            </button>
            <button className="btn-detail-action" onClick={() => onLinkShare(selectedFile)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              링크 공유
            </button>
          </>
        )}
        <button className="btn-detail-action danger" onClick={() => onDelete(selectedFile)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          삭제
        </button>
      </div>
    </div>
  )
}

export default FileInfoPanel
