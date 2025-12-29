// 공유 옵션 표시 컴포넌트
// 링크 공유의 각종 옵션들을 아이콘과 함께 표시

import { SharedFileInfo } from './types'

interface ShareOptionsDisplayProps {
  file: SharedFileInfo
}

function ShareOptionsDisplay({ file }: ShareOptionsDisplayProps) {
  const formatExpiry = (expiresAt: string): string => {
    const expiry = new Date(expiresAt)
    const now = new Date()
    const diff = expiry.getTime() - now.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    if (diff < 0) return '만료됨'
    if (days > 0) return `${days}일`
    return `${hours}시간`
  }

  const hasAnyOption = file.hasPassword || file.requireLogin || file.expiresAt || file.maxAccess

  return (
    <div className="share-options-list">
      {file.hasPassword && (
        <span className="share-option password" title="비밀번호 보호됨">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="2"/>
          </svg>
          비밀번호
        </span>
      )}

      {file.requireLogin && (
        <span className="share-option login" title="로그인 필요">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2"/>
            <path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke="currentColor" strokeWidth="2"/>
          </svg>
          로그인
        </span>
      )}

      {file.expiresAt && (
        <span
          className="share-option expiry"
          title={`만료: ${new Date(file.expiresAt).toLocaleString('ko-KR')}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
            <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          {formatExpiry(file.expiresAt)}
        </span>
      )}

      {file.maxAccess && (
        <span className="share-option access" title="접근 횟수 제한">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M1 12S5 4 12 4S23 12 23 12S19 20 12 20S1 12 1 12Z" stroke="currentColor" strokeWidth="2"/>
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
          </svg>
          {file.accessCount || 0}/{file.maxAccess}
        </span>
      )}

      {!hasAnyOption && (
        <span className="share-option public">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
            <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" stroke="currentColor" strokeWidth="2"/>
          </svg>
          공개
        </span>
      )}
    </div>
  )
}

export default ShareOptionsDisplay
