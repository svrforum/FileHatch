// 날짜 관련 유틸리티 함수

/**
 * 상대적 시간 포맷 (예: "방금 전", "5분 전", "3시간 전")
 * 24시간 이상 지난 경우 날짜로 표시
 */
export function formatRelativeDate(date: string): string {
  const now = new Date()
  const fileDate = new Date(date)
  const diffMs = now.getTime() - fileDate.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

  // Within 24 hours - show relative time
  if (diffMs < 24 * 60 * 60 * 1000 && diffMs >= 0) {
    if (diffMinutes < 1) {
      return '방금 전'
    } else if (diffMinutes < 60) {
      return `${diffMinutes}분 전`
    } else {
      return `${diffHours}시간 전`
    }
  }

  // Older than 24 hours - show date
  return fileDate.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * 전체 날짜/시간 포맷 (툴팁용)
 */
export function formatFullDateTime(date: string): string {
  return new Date(date).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
