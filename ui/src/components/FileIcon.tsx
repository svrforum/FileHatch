import { FileInfo } from '../api/files'

interface FileIconProps {
  file: FileInfo
  size?: 'small' | 'medium' | 'large'
}

function FileIcon({ file, size = 'medium' }: FileIconProps) {
  const sizeMap = {
    small: 16,
    medium: 24,
    large: 48
  }
  const iconSize = sizeMap[size]

  if (file.isDir) {
    // Special icons for root storage folders
    if (file.path === '/home') {
      return (
        <svg className="file-icon folder home" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
          <path d="M3 9L12 2L21 9V20C21 20.5304 20.7893 21.0391 20.4142 21.4142C20.0391 21.7893 19.5304 22 19 22H5C4.46957 22 3.96086 21.7893 3.58579 21.4142C3.21071 21.0391 3 20.5304 3 20V9Z" fill="#10B981" stroke="#10B981" strokeWidth="2"/>
          <path d="M9 22V12H15V22" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )
    }
    if (file.path === '/shared') {
      return (
        <svg className="file-icon folder shared" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
          <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" fill="#8B5CF6"/>
          <circle cx="9" cy="7" r="4" fill="#8B5CF6"/>
          <path d="M23 21V19C22.9993 18.1137 22.7044 17.2528 22.1614 16.5523C21.6184 15.8519 20.8581 15.3516 20 15.13M16 3.13C16.8604 3.35031 17.623 3.85071 18.1676 4.55232C18.7122 5.25392 19.0078 6.11683 19.0078 7.005C19.0078 7.89318 18.7122 8.75608 18.1676 9.45769C17.623 10.1593 16.8604 10.6597 16 10.88" stroke="#8B5CF6" strokeWidth="2"/>
        </svg>
      )
    }
    return (
      <svg className="file-icon folder" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" fill="#3182F6" stroke="#3182F6" strokeWidth="2"/>
      </svg>
    )
  }

  const ext = file.extension?.toLowerCase()
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']
  const videoExts = ['mp4', 'webm', 'avi', 'mov', 'mkv']

  if (imageExts.includes(ext || '')) {
    return (
      <svg className="file-icon image" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="2" stroke="#10B981" strokeWidth="2"/>
        <circle cx="8.5" cy="8.5" r="1.5" fill="#10B981"/>
        <path d="M21 15L16 10L5 21" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  }

  if (videoExts.includes(ext || '')) {
    return (
      <svg className="file-icon video" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <rect x="2" y="4" width="20" height="16" rx="2" stroke="#8B5CF6" strokeWidth="2"/>
        <path d="M10 9L15 12L10 15V9Z" fill="#8B5CF6"/>
      </svg>
    )
  }

  // Word documents
  const wordExts = ['doc', 'docx', 'odt', 'rtf']
  if (wordExts.includes(ext || '')) {
    return (
      <svg className="file-icon word" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#2B579A" stroke="#2B579A" strokeWidth="1"/>
        <path d="M14 2V8H20" stroke="#1A3A6B" strokeWidth="1"/>
        <text x="12" y="17" textAnchor="middle" fontSize="7" fill="white" fontWeight="bold">W</text>
      </svg>
    )
  }

  // Excel spreadsheets
  const excelExts = ['xls', 'xlsx', 'ods', 'csv']
  if (excelExts.includes(ext || '')) {
    return (
      <svg className="file-icon excel" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#217346" stroke="#217346" strokeWidth="1"/>
        <path d="M14 2V8H20" stroke="#165232" strokeWidth="1"/>
        <text x="12" y="17" textAnchor="middle" fontSize="7" fill="white" fontWeight="bold">X</text>
      </svg>
    )
  }

  // PowerPoint presentations
  const pptExts = ['ppt', 'pptx', 'odp']
  if (pptExts.includes(ext || '')) {
    return (
      <svg className="file-icon powerpoint" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#D24726" stroke="#D24726" strokeWidth="1"/>
        <path d="M14 2V8H20" stroke="#A33B1E" strokeWidth="1"/>
        <text x="12" y="17" textAnchor="middle" fontSize="7" fill="white" fontWeight="bold">P</text>
      </svg>
    )
  }

  // PDF files
  if (ext === 'pdf') {
    return (
      <svg className="file-icon pdf" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#E53935" stroke="#E53935" strokeWidth="1"/>
        <path d="M14 2V8H20" stroke="#B71C1C" strokeWidth="1"/>
        <text x="12" y="17" textAnchor="middle" fontSize="5" fill="white" fontWeight="bold">PDF</text>
      </svg>
    )
  }

  // Audio files
  const audioExts = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg']
  if (audioExts.includes(ext || '')) {
    return (
      <svg className="file-icon audio" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M9 18V5L21 3V16" stroke="#EC4899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="6" cy="18" r="3" stroke="#EC4899" strokeWidth="2"/>
        <circle cx="18" cy="16" r="3" stroke="#EC4899" strokeWidth="2"/>
      </svg>
    )
  }

  // Archive files
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2']
  if (archiveExts.includes(ext || '')) {
    return (
      <svg className="file-icon archive" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#F59E0B" strokeWidth="2"/>
        <path d="M14 2V8H20" stroke="#F59E0B" strokeWidth="2"/>
        <path d="M10 9H14M10 13H14M10 17H14" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    )
  }

  // Code files
  const codeExts = ['js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'php', 'rb', 'swift']
  if (codeExts.includes(ext || '')) {
    return (
      <svg className="file-icon code" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#06B6D4" strokeWidth="2"/>
        <path d="M14 2V8H20" stroke="#06B6D4" strokeWidth="2"/>
        <path d="M8 13L10 15L8 17" stroke="#06B6D4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M16 13L14 15L16 17" stroke="#06B6D4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  }

  // Default file icon
  return (
    <svg className="file-icon" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export default FileIcon
