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
    /*
     * The "전체 검색" button is only rendered once the inline box has a query,
     * so a test has to type before it can reach for it.
     */
    searchExpandBtn: '.search-expand-btn',
    searchInput: 'input[placeholder*="파일 검색"]',
    searchResults: '.search-results',
  },

  // Sidebar Navigation - Updated to match FileHatch actual UI
  /*
   * Scope every entry to the nav list. Bare `:text("휴지통")` also matched
   * the footer's storage breakdown ("휴지통: 23 B"), so navigation clicks
   * died on a strict-mode violation.
   */
  sidebar: {
    container: '.sidebar, .nav-sidebar',
    myFiles: '.nav-menu .nav-item:has-text("내 파일")',
    myTasks: '.nav-menu .nav-item:has-text("내 작업")',
    // ":has-text" is substring-based and "공유" appears in three sibling
    // entries, so this one has to match the label exactly.
    sharingSection: '.nav-menu .nav-item:text-is("공유")',
    sharedWithMe: '.nav-menu .nav-item:has-text("나에게 공유된 파일")',
    sharedByMe: '.nav-menu .nav-item:has-text("다른사용자에 공유된 파일")',
    sharedViaLink: '.nav-menu .nav-item:has-text("링크로 공유된 파일")',
    trash: '.nav-menu .nav-item:has-text("휴지통")',
    adminMode: '.nav-menu .nav-item:has-text("관리자 모드")',
    transferStatus: '.nav-menu .nav-item:has-text("전송 현황")',
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
    // Folder-scoped filter in the toolbar. The list is virtualised, so this is
    // the reliable way to bring a specific file into the DOM.
    localSearchToggle: '.search-toggle-btn',
    localSearchInput: '.local-search-container input',
    newFolderBtn: '.new-folder-btn',
    breadcrumb: '.breadcrumb, [data-testid="breadcrumb"]',
    breadcrumbHome: '.breadcrumb-home, .breadcrumb >> text=홈',
  },

  // Context Menu
  /*
   * Every entry is a <button class="context-menu-item"> holding an icon plus
   * its label, so :has-text on the button is what matches; a bare text engine
   * lookup does not. Scoping to .context-menu also keeps these from hitting
   * same-named controls in the page behind the menu.
   */
  contextMenu: {
    container: '.context-menu',
    item: '.context-menu button.context-menu-item',
    download: '.context-menu button:has-text("다운로드")',
    rename: '.context-menu button:has-text("이름 변경")',
    share: '.context-menu button:has-text("링크로 공유")',
    userShare: '.context-menu button:has-text("사용자에게 공유")',
    uploadLink: '.context-menu button:has-text("업로드 링크")',
    compress: '.context-menu button:has-text("압축"):not(:has-text("해제"))',
    extract: '.context-menu button:has-text("압축 해제")',
    delete: '.context-menu button.context-menu-item.danger, .context-menu button:has-text("삭제")',
    favorite: '.context-menu button:has-text("즐겨찾기")',
    properties: '.context-menu button:has-text("속성")',
    lock: '.context-menu button:has-text("잠금"):not(:has-text("해제"))',
    unlock: '.context-menu button:has-text("잠금 해제")',
    tags: '.context-menu button:has-text("태그")',
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

  /*
   * LinkShareModal.tsx. Options are checkbox labels that reveal their own
   * input when ticked, and the create button stays disabled until a ticked
   * option is filled in. Created links land in "기존 공유 링크" below.
   */
  linkShareModal: {
    container: '.link-share-modal',
    createBtn: '.link-share-modal button.create-link-btn',
    option: {
      password: '.link-share-modal label:has-text("암호 설정")',
      expiry: '.link-share-modal label:has-text("만료 시간")',
      accessLimit: '.link-share-modal label:has-text("접근 횟수 제한")',
      requireLogin: '.link-share-modal label:has-text("로그인 필요")',
    },
    passwordInput: '.link-share-modal input[type="password"]',
    createdUrl: '.link-share-modal input[readonly]',
    copyBtn: '.link-share-modal button.copy-btn',
    existingSection: '.link-share-modal .existing-links-section',
    existingCopyBtn: '.link-share-modal button.link-copy-btn',
    existingDeleteBtn: '.link-share-modal button.link-delete-btn',
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
    /*
     * No component renders a bare ".modal" class or role="dialog";
     * every dialog is an overlay div wrapping its own panel.
     */
    container: '.modal-overlay',
    title: '.modal-title, h2',
    closeBtn: '.modal-close, button:has-text("닫기")',
    confirmBtn: '.confirm-modal .confirm-actions button.btn-danger, .confirm-modal .confirm-actions button.btn-primary',
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
  /*
   * NotificationBell.tsx uses BEM class names, and its two dropdown actions
   * are icon-only buttons - addressable by aria-label, not by text.
   */
  notifications: {
    bell: '.notification-bell__button',
    dropdown: '.notification-dropdown',
    item: '.notification-item',
    itemTitle: '.notification-item__title',
    itemDelete: '.notification-item__delete',
    unreadBadge: '.notification-bell__badge',
    emptyState: '.notification-dropdown__empty',
    markAllRead: '.notification-dropdown__actions button[aria-label="모두 읽음 처리"]',
    clearAll: '.notification-dropdown__actions button[aria-label="읽은 알림 삭제"]',
    viewAll: '.notification-dropdown__view-all',
  },

  // Admin Panel
  admin: {
    /*
     * Each admin screen has its own root class - only the user list uses
     * ".admin-page". Waiting on that one after navigating to settings,
     * logs or shared drives never resolved.
     */
    page: '.admin-page, .admin-logs-page, .admin-shared-folders-page, .admin-external-storages-page, .as-container, .si-container',
    userListPage: '.admin-page',
    logsPage: '.admin-logs-page',
    sharedFoldersPage: '.admin-shared-folders-page',
    settingsPage: '.as-container',
    systemInfoPage: '.si-container',
    logRow: '.logs-table tbody tr',
    logsTab: {
      file: '.tab-btn:has-text("파일 감사 로그")',
      user: '.tab-btn:has-text("접속 이력")',
      admin: '.tab-btn:has-text("관리자 로그")',
      system: '.tab-btn:has-text("시스템 로그")',
    },
    emptyState: '.empty-state',
    navItem: '.nav-item, .admin-nav-item',
    userManagement: 'a[href="/fhadmin/users"], .nav-item:has-text("사용자 관리")',
    sharedFolders: 'a[href="/fhadmin/shared-folders"], .nav-item:has-text("공유 드라이브")',
    systemSettings: 'a[href="/fhadmin/settings"], .nav-item:has-text("시스템 설정")',
    auditLogs: 'a[href="/fhadmin/logs"], .nav-item:has-text("감사 로그")',
    ssoSettings: 'a[href="/fhadmin/sso"], .nav-item:has-text("SSO 설정")',
  },

  // Admin User Management
  /*
   * AdminSharedFolders.tsx. The dialog's inputs carry no name attribute, so
   * they are addressed by placeholder; "새 공유 드라이브" appears twice (header
   * and empty state), hence .first() at the call sites.
   */
  adminSharedFolders: {
    page: '.admin-shared-folders-page',
    list: '.folders-grid, .folders-list',
    card: '.folder-card',
    emptyState: '.empty-state',
    createBtn: 'button:has-text("새 공유 드라이브")',
    dialog: {
      name: '.modal-overlay input[placeholder*="마케팅팀"]',
      description: '.modal-overlay textarea',
      quota: '.modal-overlay input[type="number"]',
      submit: '.modal-overlay button:has-text("생성")',
      cancel: '.modal-overlay button:has-text("취소")',
    },
  },

  /*
   * AdminUserList.tsx and its two dialogs. None of the dialog inputs carry a
   * name attribute, so they are addressed by type and placeholder. Note that
   * the edit dialog has no email field at all - only password, quota and the
   * two permission toggles are editable there.
   */
  adminUsers: {
    searchBox: '.search-box input',
    addUserBtn: 'button:has-text("사용자 추가")',
    userCard: '.user-card',
    otherUserCard: '.user-card:not(:has-text("나"))',
    userName: '.user-name',
    editBtn: '.btn-action.edit',
    deactivateBtn: '.btn-action.deactivate',
    deleteBtn: '.btn-action.delete',
    adminBadge: '.badge.admin',
    tfaBadge: '.badge.twofa',
    createDialog: {
      username: '.modal-overlay input[type="text"][placeholder*="영문"]',
      email: '.modal-overlay input[type="email"]',
      password: '.modal-overlay input[type="password"][placeholder*="8자"]',
      passwordConfirm: '.modal-overlay input[type="password"][placeholder*="재입력"]',
      submit: '.modal-overlay button:has-text("사용자 생성")',
    },
    editDialog: {
      newPassword: '.modal-overlay input[type="password"][placeholder*="변경 시"]',
      passwordConfirm: '.modal-overlay input[type="password"][placeholder*="재입력"]',
      quota: '.modal-overlay input[type="number"]',
      // The checkbox itself is covered by .toggle-slider, so it never becomes
      // clickable; the surrounding label is what a user actually hits.
      isAdminToggle: '.modal-overlay label.toggle-item:has-text("관리자 권한")',
      isActiveToggle: '.modal-overlay label.toggle-item:has-text("계정 활성화")',
      submit: '.modal-overlay button:has-text("변경사항 저장")',
    },
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
