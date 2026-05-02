// 파일 아이콘 유틸리티
// 파일 종류에 따른 아이콘 SVG 컴포넌트 반환

import { FileInfo } from '../api/files'

type IconSize = 'small' | 'medium' | 'large'

const sizeMap = {
  small: 16,
  medium: 24,
  large: 48
}

export function getFileIcon(file: FileInfo, size: IconSize = 'medium') {
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

  // Image files
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']
  if (imageExts.includes(ext || '')) {
    return (
      <svg className="file-icon image" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="2" stroke="#10B981" strokeWidth="2"/>
        <circle cx="8.5" cy="8.5" r="1.5" fill="#10B981"/>
        <path d="M21 15L16 10L5 21" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  }

  // Video files
  const videoExts = ['mp4', 'webm', 'avi', 'mov', 'mkv', 'wmv', 'flv']
  if (videoExts.includes(ext || '')) {
    return (
      <svg className="file-icon video" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <rect x="2" y="4" width="20" height="16" rx="2" stroke="#8B5CF6" strokeWidth="2"/>
        <path d="M10 9L15 12L10 15V9Z" fill="#8B5CF6"/>
      </svg>
    )
  }

  // Audio files
  const audioExts = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma']
  if (audioExts.includes(ext || '')) {
    return (
      <svg className="file-icon audio" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M9 18V5L21 3V16" stroke="#EC4899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="6" cy="18" r="3" stroke="#EC4899" strokeWidth="2"/>
        <circle cx="18" cy="16" r="3" stroke="#EC4899" strokeWidth="2"/>
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

  // Archive files
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz']
  if (archiveExts.includes(ext || '')) {
    return (
      <svg className="file-icon archive" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#F59E0B" stroke="#F59E0B" strokeWidth="1"/>
        <path d="M14 2V8H20" stroke="#D97706" strokeWidth="1"/>
        <rect x="10" y="10" width="4" height="2" fill="white"/>
        <rect x="10" y="13" width="4" height="2" fill="white"/>
        <rect x="10" y="16" width="4" height="2" fill="white"/>
      </svg>
    )
  }

  // Code files
  const codeExts = ['js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'php', 'rb', 'swift', 'kt', 'scala', 'r']
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

  // Text/Log files
  const textExts = ['txt', 'log', 'md', 'markdown', 'readme']
  if (textExts.includes(ext || '')) {
    return (
      <svg className="file-icon text" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#6B7280" strokeWidth="2"/>
        <path d="M14 2V8H20" stroke="#6B7280" strokeWidth="2"/>
        <path d="M8 13H16M8 17H12" stroke="#6B7280" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    )
  }

  // Config files
  const configExts = ['ini', 'conf', 'cfg', 'config', 'yaml', 'yml', 'toml', 'json', 'xml', 'env', 'properties']
  if (configExts.includes(ext || '')) {
    return (
      <svg className="file-icon config" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#8B5CF6" strokeWidth="2"/>
        <path d="M14 2V8H20" stroke="#8B5CF6" strokeWidth="2"/>
        <circle cx="12" cy="15" r="2" stroke="#8B5CF6" strokeWidth="2"/>
        <path d="M12 11V13M12 17V19M9 13L11 15M13 15L15 17M9 17L11 15M13 15L15 13" stroke="#8B5CF6" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    )
  }

  // Executable files
  const execExts = ['exe', 'msi', 'app', 'dmg', 'deb', 'rpm', 'apk']
  if (execExts.includes(ext || '')) {
    return (
      <svg className="file-icon executable" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#EF4444" stroke="#EF4444" strokeWidth="1"/>
        <path d="M14 2V8H20" stroke="#B91C1C" strokeWidth="1"/>
        <path d="M9 13L11 15L9 17" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M13 17H16" stroke="white" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    )
  }

  // Script files
  const scriptExts = ['sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'psm1']
  if (scriptExts.includes(ext || '')) {
    return (
      <svg className="file-icon script" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#1E293B" stroke="#1E293B" strokeWidth="1"/>
        <path d="M14 2V8H20" stroke="#0F172A" strokeWidth="1"/>
        <path d="M8 13L10 15L8 17" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 17H16" stroke="#22C55E" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    )
  }

  // Database files
  const dbExts = ['sql', 'db', 'sqlite', 'sqlite3', 'mdb', 'accdb']
  if (dbExts.includes(ext || '')) {
    return (
      <svg className="file-icon database" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <ellipse cx="12" cy="6" rx="8" ry="3" stroke="#F59E0B" strokeWidth="2"/>
        <path d="M4 6V18C4 19.66 7.58 21 12 21C16.42 21 20 19.66 20 18V6" stroke="#F59E0B" strokeWidth="2"/>
        <path d="M4 12C4 13.66 7.58 15 12 15C16.42 15 20 13.66 20 12" stroke="#F59E0B" strokeWidth="2"/>
      </svg>
    )
  }

  // Font files
  const fontExts = ['ttf', 'otf', 'woff', 'woff2', 'eot']
  if (fontExts.includes(ext || '')) {
    return (
      <svg className="file-icon font" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#EC4899" strokeWidth="2"/>
        <path d="M14 2V8H20" stroke="#EC4899" strokeWidth="2"/>
        <text x="12" y="17" textAnchor="middle" fontSize="8" fill="#EC4899" fontWeight="bold" fontFamily="serif">A</text>
      </svg>
    )
  }

  // Disk image files
  const diskExts = ['iso', 'img', 'bin', 'vhd', 'vmdk', 'vdi']
  if (diskExts.includes(ext || '')) {
    return (
      <svg className="file-icon disk" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="#6366F1" strokeWidth="2"/>
        <circle cx="12" cy="12" r="3" stroke="#6366F1" strokeWidth="2"/>
        <circle cx="12" cy="12" r="1" fill="#6366F1"/>
      </svg>
    )
  }

  // Icon files
  const iconExts = ['ico', 'icns', 'cur']
  if (iconExts.includes(ext || '')) {
    return (
      <svg className="file-icon icon-file" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="3" stroke="#3B82F6" strokeWidth="2"/>
        <rect x="7" y="7" width="10" height="10" rx="2" fill="#3B82F6"/>
        <circle cx="12" cy="12" r="3" fill="white"/>
      </svg>
    )
  }

  // Web files (html)
  const webExts = ['html', 'htm', 'xhtml']
  if (webExts.includes(ext || '')) {
    return (
      <svg className="file-icon html" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#E34F26" stroke="#E34F26" strokeWidth="1"/>
        <path d="M14 2V8H20" stroke="#C63D17" strokeWidth="1"/>
        <path d="M8 13L10 15L8 17M12 13H16" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  }

  // CSS files
  const cssExts = ['css', 'scss', 'sass', 'less']
  if (cssExts.includes(ext || '')) {
    return (
      <svg className="file-icon css" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#264DE4" stroke="#264DE4" strokeWidth="1"/>
        <path d="M14 2V8H20" stroke="#1A3AA5" strokeWidth="1"/>
        <text x="12" y="17" textAnchor="middle" fontSize="6" fill="white" fontWeight="bold">#</text>
      </svg>
    )
  }

  // Subtitle files
  const subtitleExts = ['smi', 'srt', 'ass', 'sub', 'ssa', 'vtt']
  if (subtitleExts.includes(ext || '')) {
    return (
      <svg className="file-icon subtitle" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <rect x="2" y="4" width="20" height="16" rx="2" stroke="#14B8A6" strokeWidth="2"/>
        <rect x="4" y="14" width="16" height="4" rx="1" fill="#14B8A6" opacity="0.3"/>
        <path d="M6 16H18" stroke="#14B8A6" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    )
  }

  // Design files
  const designExts = ['psd', 'ai', 'sketch', 'fig', 'xd', 'indd']
  if (designExts.includes(ext || '')) {
    return (
      <svg className="file-icon design" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#38BDF8" stroke="#38BDF8" strokeWidth="1"/>
        <path d="M14 2V8H20" stroke="#0EA5E9" strokeWidth="1"/>
        <circle cx="10" cy="14" r="2" fill="white"/>
        <circle cx="14" cy="14" r="2" fill="white"/>
        <path d="M10 16C10 17.1 10.9 18 12 18C13.1 18 14 17.1 14 16" stroke="white" strokeWidth="1.5"/>
      </svg>
    )
  }

  // Ebook files
  const ebookExts = ['epub', 'mobi', 'azw', 'azw3']
  if (ebookExts.includes(ext || '')) {
    return (
      <svg className="file-icon ebook" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M4 4C4 2.89543 4.89543 2 6 2H14L20 8V20C20 21.1046 19.1046 22 18 22H6C4.89543 22 4 21.1046 4 20V4Z" fill="#84CC16" stroke="#84CC16" strokeWidth="1"/>
        <path d="M14 2V8H20" stroke="#65A30D" strokeWidth="1"/>
        <path d="M8 13H16M8 17H13" stroke="white" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    )
  }

  // Torrent files
  if (ext === 'torrent') {
    return (
      <svg className="file-icon torrent" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#22C55E" stroke="#22C55E" strokeWidth="1"/>
        <path d="M14 2V8H20" stroke="#16A34A" strokeWidth="1"/>
        <path d="M12 11V17M9 14H15" stroke="white" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    )
  }

  // Library/DLL files
  const libExts = ['dll', 'so', 'dylib', 'a', 'lib']
  if (libExts.includes(ext || '')) {
    return (
      <svg className="file-icon library" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" fill="#A855F7" stroke="#A855F7" strokeWidth="1"/>
        <path d="M14 2V8H20" stroke="#9333EA" strokeWidth="1"/>
        <rect x="8" y="12" width="2" height="6" fill="white"/>
        <rect x="11" y="12" width="2" height="6" fill="white"/>
        <rect x="14" y="12" width="2" height="6" fill="white"/>
      </svg>
    )
  }

  // Calendar files
  const calendarExts = ['ics', 'ical']
  if (calendarExts.includes(ext || '')) {
    return (
      <svg className="file-icon calendar" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="18" rx="2" stroke="#EF4444" strokeWidth="2"/>
        <path d="M3 10H21" stroke="#EF4444" strokeWidth="2"/>
        <path d="M8 2V6M16 2V6" stroke="#EF4444" strokeWidth="2" strokeLinecap="round"/>
        <rect x="7" y="14" width="4" height="4" rx="1" fill="#EF4444"/>
      </svg>
    )
  }

  // Contact files
  const contactExts = ['vcf', 'vcard']
  if (contactExts.includes(ext || '')) {
    return (
      <svg className="file-icon contact" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="2" stroke="#0EA5E9" strokeWidth="2"/>
        <circle cx="12" cy="10" r="3" stroke="#0EA5E9" strokeWidth="2"/>
        <path d="M7 19C7 16.2386 9.23858 14 12 14C14.7614 14 17 16.2386 17 19" stroke="#0EA5E9" strokeWidth="2" strokeLinecap="round"/>
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

export default getFileIcon
