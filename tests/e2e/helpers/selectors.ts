/**
 * Common UI Selectors for E2E Tests
 *
 * Centralized selector definitions to maintain consistency
 * and simplify test maintenance when UI changes.
 */

export const Selectors = {
  // Header & Navigation
  header: {
    avatarBtn: '.avatar-btn',
    adminBtn: '.admin-btn:has-text("관리자 모드")',
    notificationBtn: '.notification-btn, [data-testid="notification-btn"]',
    /*
     * The avatar button opens the profile modal directly - Header.tsx wires it
     * straight to onProfileClick. There is no intermediate dropdown, so the
     * old userDropdown/profileBtn pair matched nothing and every profile test
     * timed out on the second click.
     */
    profileModalTrigger: '.avatar-btn',
    logoutBtn: '.user-profile-modal button:has-text("로그아웃")',
    searchExpandBtn: '.search-expand-btn',
    searchInput: 'input[placeholder*="검색"], input[placeholder*="search"], input[type="search"]',
  },

  // Sidebar Navigation - Updated to match FileHatch actual UI
  sidebar: {
    container: '.sidebar, .nav-sidebar',
    myFiles: ':text("내 파일")',
    myTasks: ':text("내 작업")',
    sharingSection: ':text("공유")',
    sharedWithMe: ':text("나에게 공유된 파일")',
    sharedByMe: ':text("다른사용자에 공유된 파일")',
    sharedViaLink: ':text("링크로 공유된 파일")',
    trash: ':text("휴지통")',
    adminMode: ':text("관리자 모드")',
    transferStatus: ':text("전송 현황")',
  },

  // File List
  fileList: {
    wrapper: '.file-list-wrapper',
    container: '.file-list-container',
    item: '.file-list-item, .file-row',
    fileName: '.file-name',
    fileSize: '.file-size',
    fileDate: '.file-date',
    uploadBtn: '.upload-btn',
    newFolderBtn: '.new-folder-btn',
    breadcrumb: '.breadcrumb, [data-testid="breadcrumb"]',
    breadcrumbHome: '.breadcrumb-home, .breadcrumb >> text=홈',
  },

  // Context Menu
  contextMenu: {
    container: '.context-menu',
    download: '.context-menu >> text=다운로드',
    rename: '.context-menu >> text=이름 변경',
    share: 'text=링크로 공유',
    userShare: ':text("사용자와 공유"), :text("사용자에게 공유")',
    uploadLink: 'text=업로드 링크',
    compress: '.context-menu >> text=압축',
    extract: '.context-menu >> text=압축 해제',
    delete: '.context-menu >> .context-menu-item.danger',
    favorite: '.context-menu >> text=즐겨찾기',
    properties: '.context-menu >> text=속성',
    lock: '.context-menu >> text=잠금',
    unlock: '.context-menu >> text=잠금 해제',
    tags: '.context-menu >> text=태그',
  },

  // Upload - FileHatch opens modal with file/folder selection
  upload: {
    mainBtn: 'button.upload-btn',
    modal: ':text("파일 업로드"):visible',
    selectFileBtn: 'button:has-text("파일 선택")',
    selectFolderBtn: 'button:has-text("폴더 선택")',
    dropZone: '.file-list-container, .drop-zone',
    progressPanel: '.transfer-panel, .upload-progress',
    progressItem: '.transfer-item, .upload-item',
    transferStatus: '.transfer-status, :text("전송 현황")',
  },

  /*
   * Upload modal. Verified against the running app: the modal exposes only
   * "파일 선택" / "폴더 선택" - there is no start-upload control, because the
   * transfer begins as soon as files are chosen and the modal closes itself.
   */
  uploadModal: {
    overlay: '.modal-overlay',
    container: '.upload-modal',
    selectFileBtn: 'button.upload-select-btn:has-text("파일 선택")',
    selectFolderBtn: 'button.upload-select-btn:has-text("폴더 선택")',
  },

  /*
   * Confirmation dialog (ConfirmModal.tsx). Scope every lookup to the dialog:
   * unscoped `button:has-text("삭제")` also matches the delete button sitting
   * in the detail panel behind the overlay, and Playwright then waits out the
   * full timeout on a click the overlay keeps intercepting.
   */
  confirmModal: {
    container: '.confirm-modal',
    confirmBtn: '.confirm-modal .confirm-actions button.btn-danger, .confirm-modal .confirm-actions button.btn-primary',
    cancelBtn: '.confirm-modal .confirm-actions button.btn-secondary',
  },

  // Share Modal
  shareModal: {
    container: '[data-testid="share-modal"], .share-modal, .modal',
    createLinkBtn: 'button:has-text("링크 생성"), button:has-text("Create Link")',
    shareLink: 'input[readonly], input[value*="http"], .share-link',
    copyBtn: 'button:has-text("복사"), button[aria-label="Copy"]',
    deleteBtn: 'button:has-text("삭제"), button:has-text("Delete")',
    closeBtn: 'button:has-text("닫기"), button:has-text("Close"), .modal-close',
    passwordCheckbox: 'input[type="checkbox"]:near(:text("비밀번호")), label:has-text("비밀번호") input',
    passwordInput: 'input[type="password"], input[placeholder*="비밀번호"]',
    expirationSelect: 'select:near(:text("만료")), select[name*="expir"]',
  },

  // Modals (Generic)
  modal: {
    container: '.modal, [role="dialog"]',
    title: '.modal-title, h2',
    closeBtn: '.modal-close, button:has-text("닫기")',
    confirmBtn: 'button:has-text("확인"), button:has-text("Confirm")',
    cancelBtn: 'button:has-text("취소"), button:has-text("Cancel")',
    submitBtn: 'button[type="submit"]',
  },

  // Multi-select
  multiSelect: {
    bar: '[data-testid="multi-select-bar"], .multi-select-bar, .selection-bar',
    count: '.selection-count',
    deleteBtn: '.selection-delete-btn',
    downloadBtn: '.selection-download-btn',
    shareBtn: '.selection-share-btn',
    clearBtn: '.selection-clear-btn',
  },

  // Notifications
  notifications: {
    bell: '.notification-btn, [data-testid="notification-btn"]',
    dropdown: '.notification-dropdown',
    item: '.notification-item',
    unreadBadge: '.notification-badge',
    markAllRead: 'button:has-text("모두 읽음")',
    clearAll: 'button:has-text("모두 삭제")',
  },

  // Admin Panel
  admin: {
    page: '.admin-page',
    navItem: '.nav-item, .admin-nav-item',
    userManagement: 'a[href="/fhadmin/users"], .nav-item:has-text("사용자 관리")',
    sharedFolders: 'a[href="/fhadmin/shared-folders"], .nav-item:has-text("공유 드라이브")',
    systemSettings: 'a[href="/fhadmin/settings"], .nav-item:has-text("시스템 설정")',
    auditLogs: 'a[href="/fhadmin/logs"], .nav-item:has-text("감사 로그")',
    ssoSettings: 'a[href="/fhadmin/sso"], .nav-item:has-text("SSO 설정")',
  },

  // Admin User Management
  adminUsers: {
    searchBox: '.search-box input',
    addUserBtn: '.btn-primary:has-text("사용자 추가")',
    userCard: '.user-card',
    editBtn: '.btn-action.edit, button:has-text("수정")',
    deleteBtn: '.btn-action.delete, button:has-text("삭제")',
    adminBadge: '.badge.admin',
    tfaBadge: '.badge.twofa',
  },

  // Profile & Settings
  /*
   * "내 프로필" is a modal (UserProfile.tsx), not a page, and its sections are
   * tabs inside it. Scope lookups to the modal so they cannot match the file
   * list rendered behind the overlay.
   */
  profile: {
    container: '.user-profile-modal',
    closeBtn: '.user-profile-modal .close-btn',
    tabs: {
      profile: '.profile-tabs button:has-text("프로필")',
      password: '.profile-tabs button:has-text("비밀번호")',
      appPassword: '.profile-tabs button:has-text("애플리케이션 암호")',
      twoFactor: '.profile-tabs button:has-text("2FA 보안")',
      sidebar: '.profile-tabs button:has-text("사이드바")',
    },
    usernameInput: '.user-profile-modal input[name="username"]',
    emailInput: '.user-profile-modal input[type="email"]',
    saveBtn: '.user-profile-modal button.primary-btn',
    themeToggle: '.user-profile-modal .theme-toggle-btn',
    message: '.user-profile-modal .message, .user-profile-modal .field-error',
  },

  // Trash
  trash: {
    container: '.trash-page, .trash-container',
    item: '.trash-item',
    restoreBtn: 'button:has-text("복원"), button:has-text("Restore")',
    permanentDeleteBtn: 'button:has-text("영구 삭제"), button:has-text("Permanent Delete")',
    emptyTrashBtn: 'button:has-text("휴지통 비우기"), button:has-text("Empty Trash")',
  },

  // Login Page
  login: {
    usernameInput: 'input[name="username"], input[type="text"]',
    passwordInput: 'input[name="password"], input[type="password"]',
    submitBtn: 'button[type="submit"]',
    errorMessage: '.error, .alert-error, [role="alert"]',
    ssoButton: '.sso-btn',
  },

  // Initial Setup
  initialSetup: {
    modal: '.initial-setup-modal',
    usernameInput: '#newUsername',
    passwordInput: '#newPassword',
    confirmPasswordInput: '#confirmPassword',
    submitBtn: '.initial-setup-submit',
  },

  // Toast/Alerts
  toast: {
    container: '.toast, .toast-container, [role="alert"]',
    success: '.toast-success',
    error: '.toast-error',
    closeBtn: '.toast-close',
  },
} as const;

/**
 * Common text patterns for locating elements
 */
export const TextPatterns = {
  // Korean UI text
  ko: {
    create: '생성',
    save: '저장',
    cancel: '취소',
    delete: '삭제',
    confirm: '확인',
    close: '닫기',
    upload: '업로드',
    download: '다운로드',
    share: '공유',
    rename: '이름 변경',
    properties: '속성',
    trash: '휴지통',
    restore: '복원',
    search: '검색',
    loading: '불러오는 중',
    success: '완료',
    error: '오류',
    expired: '만료',
    notFound: '찾을 수 없',
    password: '비밀번호',
  },
  // English UI text
  en: {
    create: 'Create',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    confirm: 'Confirm',
    close: 'Close',
    upload: 'Upload',
    download: 'Download',
    share: 'Share',
    rename: 'Rename',
    properties: 'Properties',
    trash: 'Trash',
    restore: 'Restore',
    search: 'Search',
    loading: 'Loading',
    success: 'Success',
    error: 'Error',
    expired: 'Expired',
    notFound: 'Not Found',
    password: 'Password',
  },
} as const;
