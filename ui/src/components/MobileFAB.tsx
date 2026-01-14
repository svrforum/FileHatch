import { useState } from 'react';
import './MobileFAB.css';

interface MobileFABProps {
  onUploadClick: () => void;
  onNewFolderClick: () => void;
}

export default function MobileFAB({ onUploadClick, onNewFolderClick }: MobileFABProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleUploadClick = () => {
    setIsOpen(false);
    onUploadClick();
  };

  const handleNewFolderClick = () => {
    setIsOpen(false);
    onNewFolderClick();
  };

  const handleOverlayClick = () => {
    setIsOpen(false);
  };

  return (
    <div className={`mobile-fab-container ${isOpen ? 'open' : ''}`}>
      {isOpen && (
        <div className="mobile-fab-overlay" onClick={handleOverlayClick} />
      )}

      <div className="mobile-fab-actions">
        <button
          className="mobile-fab-action"
          onClick={handleNewFolderClick}
          aria-label="새 폴더 만들기"
        >
          <span className="mobile-fab-action-label">새 폴더</span>
          <span className="mobile-fab-action-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </span>
        </button>

        <button
          className="mobile-fab-action"
          onClick={handleUploadClick}
          aria-label="파일 업로드"
        >
          <span className="mobile-fab-action-label">업로드</span>
          <span className="mobile-fab-action-icon upload">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </span>
        </button>
      </div>

      <button
        className="mobile-fab-main"
        onClick={handleToggle}
        aria-label={isOpen ? '메뉴 닫기' : '새 항목 추가'}
        aria-expanded={isOpen}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
