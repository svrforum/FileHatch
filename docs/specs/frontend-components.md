# FileHatch 프론트엔드 컴포넌트 맵

> **현재 버전:** 0.10.1
> **프레임워크:** React 18 + TypeScript + Vite
> **상태 관리:** Zustand (6개 스토어)
> **데이터 페칭:** TanStack React Query v5
> **라우팅:** React Router v6
> **스타일:** Plain CSS (BEM 방법론)

---

## 목차

1. [컴포넌트 트리](#컴포넌트-트리)
2. [진입점 및 프로바이더](#진입점-및-프로바이더)
3. [Zustand 스토어](#zustand-스토어)
4. [커스텀 훅](#커스텀-훅)
5. [라우팅 구조](#라우팅-구조)
6. [테마 시스템](#테마-시스템)
7. [스타일 가이드](#스타일-가이드)
8. [React Query 설정](#react-query-설정)

---

## 컴포넌트 트리

```
main.tsx
├── ThemeProvider (contexts/ThemeContext.tsx)
├── QueryClientProvider (@tanstack/react-query)
├── BrowserRouter (react-router-dom)
├── App.tsx
│   ├── LoginPage.tsx (미인증 시)
│   ├── ShareAccessPage.tsx (/s/:token, /e/:token - 공개, 인증 불필요)
│   ├── UploadShareAccessPage.tsx (/u/:token - 공개, 인증 불필요)
│   └── [인증됨] ErrorBoundary.tsx
│       ├── Header.tsx
│       │   ├── SearchModal.tsx (검색)
│       │   ├── NotificationBell.tsx (알림 벨)
│       │   └── 프로필 메뉴, 테마 토글
│       ├── Sidebar.tsx
│       │   ├── 네비게이션 (파일, 최근, 공유 드라이브, 외부 스토리지, 공유, 휴지통)
│       │   ├── 저장 공간 사용량 표시
│       │   └── 관리자 모드 네비게이션
│       ├── main-content (Routes)
│       │   ├── FileList.tsx (메인 콘텐츠 영역)
│       │   │   ├── filelist/FileListHeader.tsx (경로, 정렬, 뷰 전환)
│       │   │   ├── filelist/VirtualizedFileTable.tsx (테이블 뷰)
│       │   │   ├── filelist/VirtualizedFileGrid.tsx (그리드 뷰)
│       │   │   ├── filelist/FileRow.tsx (테이블 행)
│       │   │   ├── filelist/FileCard.tsx (그리드 카드)
│       │   │   ├── filelist/MultiSelectBar.tsx (다중 선택 액션바)
│       │   │   ├── filelist/ContextMenu.tsx (우클릭 메뉴)
│       │   │   ├── filelist/FileInfoPanel.tsx (파일 정보 패널)
│       │   │   ├── filelist/ShareOptionsDisplay.tsx (공유 상태 표시)
│       │   │   ├── filelist/FileModals.tsx (모달 컨테이너)
│       │   │   ├── FileViewer.tsx (lazy - 파일 미리보기)
│       │   │   ├── TextEditor.tsx (lazy - 텍스트 편집기)
│       │   │   ├── ZipViewer.tsx (ZIP 파일 브라우저)
│       │   │   ├── OnlyOfficeEditor.tsx (Office 문서 편집)
│       │   │   ├── ShareModal.tsx (사용자 간 공유)
│       │   │   ├── LinkShareModal.tsx (링크 공유)
│       │   │   ├── ConflictModal.tsx (파일 충돌 해결)
│       │   │   └── FolderSelectModal.tsx (폴더 선택)
│       │   ├── Trash.tsx (/trash)
│       │   ├── MyActivity.tsx (lazy, /my-activity)
│       │   ├── NotificationCenter.tsx (lazy, /notifications)
│       │   └── Admin (전부 lazy loaded)
│       │       ├── AdminUserList.tsx (/fhadmin/users)
│       │       ├── AdminSettings.tsx (/fhadmin/settings)
│       │       ├── AdminSSOSettings.tsx (/fhadmin/sso)
│       │       ├── AdminLogs.tsx (/fhadmin/logs)
│       │       ├── AdminSharedFolders.tsx (/fhadmin/shared-folders)
│       │       ├── AdminExternalStorages.tsx (/fhadmin/external-storages)
│       │       └── AdminSystemInfo.tsx (/fhadmin/system-info)
│       ├── FileDetailsPanel.tsx (우측 상세 패널 - portal)
│       ├── UploadModal.tsx (파일 업로드)
│       ├── CreateFolderModal.tsx (새 폴더)
│       ├── UploadPanel.tsx (업로드/다운로드 진행 상태)
│       ├── DuplicateModal.tsx (중복 파일 처리)
│       └── UserProfile.tsx (프로필 모달)
└── ToastContainer (components/Toast.tsx)
```

### 파일 위치

| 컴포넌트 | 파일 경로 |
|---------|---------|
| 메인 컴포넌트 | `ui/src/components/*.tsx` |
| FileList 하위 | `ui/src/components/filelist/*.tsx` |
| 스토어 | `ui/src/stores/*.ts` |
| 훅 | `ui/src/hooks/*.ts` |
| API 함수 | `ui/src/api/*.ts` |
| 컨텍스트 | `ui/src/contexts/*.tsx` |
| 스타일 | `ui/src/styles/*.css` |
| 유틸리티 | `ui/src/utils/*.ts` |

### 지연 로딩 (Lazy Loading)

다음 컴포넌트는 `React.lazy()`로 코드 스플리팅됩니다:

```typescript
// 관리자 컴포넌트 (전부 lazy)
const AdminUserList = lazy(() => import('./components/AdminUserList'))
const AdminSettings = lazy(() => import('./components/AdminSettings'))
const AdminSSOSettings = lazy(() => import('./components/AdminSSOSettings'))
const AdminLogs = lazy(() => import('./components/AdminLogs'))
const AdminSharedFolders = lazy(() => import('./components/AdminSharedFolders'))
const AdminExternalStorages = lazy(() => import('./components/AdminExternalStorages'))
const AdminSystemInfo = lazy(() => import('./components/AdminSystemInfo'))

// 일반 사용자 (lazy)
const MyActivity = lazy(() => import('./components/MyActivity'))
const NotificationCenter = lazy(() => import('./components/NotificationCenter'))
```

---

## 진입점 및 프로바이더

```
main.tsx
├── React.StrictMode
│   ├── ThemeProvider         (테마 컨텍스트: light/dark/system)
│   │   ├── QueryClientProvider   (TanStack React Query)
│   │   │   ├── BrowserRouter    (React Router)
│   │   │   │   ├── App          (메인 애플리케이션)
│   │   │   │   └── ToastContainer   (전역 토스트 알림)
```

**파일:** `ui/src/main.tsx`

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,       // 60초 - 데이터 신선도 유지
      gcTime: 1000 * 60 * 5,      // 5분 - 가비지 컬렉션
      retry: 1,                    // 재시도 1회
      refetchOnWindowFocus: false, // 탭 전환 시 리페치 안함
      refetchOnReconnect: true,    // 네트워크 재연결 시 리페치
    },
  },
})
```

---

## Zustand 스토어

6개 스토어를 사용하며, 3개는 localStorage 영속성을 가집니다.

### 1. authStore

> 인증 상태 관리. JWT 토큰, 사용자 정보, 2FA/초기 설정 플로우.

**파일:** `ui/src/stores/authStore.ts`
**영속성 키:** `filehatch-auth` (localStorage)
**영속화 범위:** `token`, `user`만 저장

| 상태 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `token` | `string \| null` | `null` | JWT 토큰 |
| `user` | `User \| null` | `null` | 사용자 정보 |
| `isLoading` | `boolean` | `false` | 로딩 상태 |
| `error` | `string \| null` | `null` | 에러 메시지 |
| `requires2FA` | `boolean` | `false` | 2FA 인증 필요 여부 |
| `pending2FAUserId` | `string \| null` | `null` | 2FA 대기 중인 사용자 ID |
| `pendingRememberMe` | `boolean` | `false` | 2FA 플로우 중 rememberMe 저장 |
| `requiresSetup` | `boolean` | `false` | 초기 설정 필요 여부 |
| `pendingSetupToken` | `string \| null` | `null` | 초기 설정 토큰 |

| 액션 | 시그니처 | 설명 |
|------|---------|------|
| `login` | `(data: LoginRequest) => Promise<'success' \| '2fa' \| 'setup'>` | 로그인 (3가지 결과) |
| `verify2FACode` | `(code: string) => Promise<void>` | 2FA 코드 검증 |
| `cancel2FA` | `() => void` | 2FA 취소 |
| `completeSetup` | `(data: InitialSetupRequest) => Promise<void>` | 초기 설정 완료 |
| `cancelSetup` | `() => void` | 초기 설정 취소 |
| `logout` | `() => void` | 로그아웃 (상태 초기화 + 리다이렉트) |
| `refreshProfile` | `() => Promise<void>` | 프로필 새로고침 |
| `refreshAuthToken` | `() => Promise<boolean>` | 토큰 갱신 |
| `clearError` | `() => void` | 에러 초기화 |
| `setToken` | `(token: string) => void` | SSO 로그인용 토큰 설정 |

### 2. uploadStore

> 업로드/다운로드 상태 관리. tus 프로토콜 기반 이어받기 업로드 지원.

**파일:** `ui/src/stores/uploadStore.ts`
**영속성:** 없음 (in-memory). 단, 중단된 업로드 메타데이터는 `savePendingUploads()`로 별도 저장.

| 상태 | 타입 | 설명 |
|------|------|------|
| `items` | `UploadItem[]` | 업로드 항목 목록 |
| `downloads` | `DownloadItem[]` | 다운로드 항목 목록 |
| `interruptedUploads` | `PendingUploadMeta[]` | 중단된 업로드 (이어받기용) |

| 주요 상수 | 값 | 설명 |
|----------|------|------|
| `MAX_CONCURRENT_UPLOADS` | `3` | 최대 동시 업로드 수 |
| `API_TIMEOUT` | `3000` | API 타임아웃 (ms) |

**UploadItem 상태 전이:**
```
pending -> uploading -> completed
                    -> error
                    -> paused
           duplicate (중복 발견 시)
```

### 3. transferStore

> 파일 이동/복사/압축/삭제 전송 작업 관리. 서버 사이드 전송 큐 사용.

**파일:** `ui/src/stores/transferStore.ts`
**영속성 키:** `filehatch-transfers` (localStorage, 최근 50개만 유지)

| 상태 | 타입 | 설명 |
|------|------|------|
| `items` | `TransferItem[]` | 전송 항목 목록 |

| TransferType | 설명 |
|-------------|------|
| `move` | 파일/폴더 이동 |
| `copy` | 파일/폴더 복사 |
| `compress` | 파일/폴더 압축 |
| `delete` | 파일/폴더 삭제 |

| TransferStatus | 설명 |
|---------------|------|
| `pending` | 대기 중 |
| `transferring` | 전송 중 |
| `completed` | 완료 |
| `error` | 오류 |

### 4. notificationStore

> 알림 상태 관리. 실시간 새로고침 트리거와 최근 알림 저장.

**파일:** `ui/src/stores/notificationStore.ts`
**영속성:** 없음 (in-memory)

| 상태 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `refreshTrigger` | `number` | `0` | 새로고침 카운터 (증가 시 알림 리페치) |
| `lastNotification` | `Notification \| null` | `null` | 마지막 수신 알림 (토스트 표시용) |

| 액션 | 설명 |
|------|------|
| `triggerRefresh` | refreshTrigger 증가 |
| `setLastNotification` | 마지막 알림 설정 |
| `clearLastNotification` | 마지막 알림 초기화 |

### 5. toastStore

> 토스트 알림 관리. 전역 알림 메시지 큐.

**파일:** `ui/src/stores/toastStore.ts`
**영속성:** 없음 (in-memory)

| 상태 | 타입 | 설명 |
|------|------|------|
| `toasts` | `ToastMessage[]` | 활성 토스트 목록 |

| 액션 | 시그니처 | 기본 duration |
|------|---------|-------------|
| `showToast` | `(message, type?, duration?) => void` | 5000ms |
| `showSuccess` | `(message) => void` | 5000ms |
| `showError` | `(message) => void` | 7000ms |
| `showWarning` | `(message) => void` | 5000ms |
| `showInfo` | `(message) => void` | 5000ms |
| `removeToast` | `(id) => void` | - |

| ToastType | 설명 |
|-----------|------|
| `success` | 성공 메시지 |
| `error` | 오류 메시지 |
| `info` | 정보 메시지 |
| `warning` | 경고 메시지 |

### 6. preferencesStore

> 사용자 환경설정 관리. 서버 API와 동기화.

**파일:** `ui/src/stores/preferencesStore.ts`
**영속성 키:** `user-preferences` (localStorage, 오프라인 폴백용)
**영속화 범위:** `preferences`만 저장
**동기화:** 서버 API (`/api/user/preferences`)

| 상태 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `preferences.sidebarOrder` | `string[]` | `['files','recent','shared-drives','external-storages','sharing','trash']` | 사이드바 섹션 순서 |
| `preferences.sidebarHidden` | `string[]` | `[]` | 숨긴 섹션 |
| `preferences.defaultLanding` | `string` | `''` | 기본 랜딩 페이지 |
| `isLoaded` | `boolean` | `false` | 로드 완료 여부 |

| 액션 | 설명 |
|------|------|
| `fetchPreferences` | 서버에서 환경설정 로드 (자동 마이그레이션 포함) |
| `updatePreferences` | 부분 업데이트 (낙관적 + 서버 동기화) |
| `resetPreferences` | 기본값으로 초기화 |

---

## 커스텀 훅

16개 커스텀 훅이 `ui/src/hooks/` 디렉토리에 위치합니다.

### 파일 작업 훅

| 훅 | 파일 | 역할 | 주요 의존성 |
|----|------|------|------------|
| `useFileOperations` | `useFileOperations.ts` | 파일 삭제, 이름변경, 복사, 이동 | queryClient, toastStore, transferStore |
| `useFileWatcher` | `useFileWatcher.ts` | WebSocket 기반 파일 변경 모니터링 | queryClient, authStore |
| `useFileUploadDragDrop` | `useFileUploadDragDrop.ts` | 드래그 앤 드롭 업로드 | uploadStore |
| `useFileDragMove` | `useFileDragMove.ts` | 드래그 앤 드롭 파일 이동 | transferStore |
| `useFileMetadata` | `useFileMetadata.ts` | 태그, 설명, 즐겨찾기 관리 | useQuery, API |
| `useFileHistory` | `useFileHistory.ts` | 파일 작업 히스토리 | useState |

### 데이터 조회 훅

| 훅 | 파일 | 역할 | 주요 의존성 |
|----|------|------|------------|
| `useSharedFolders` | `useSharedFolders.ts` | 공유 폴더 목록 조회 | useQuery |
| `useExternalStorages` | `useExternalStorages.ts` | 외부 스토리지 목록 조회 | useQuery |
| `useNotifications` | `useNotifications.ts` | 알림 조회 및 관리 | authStore, notificationStore |
| `useStarredAndLocked` | `useStarredAndLocked.ts` | 즐겨찾기 및 파일 잠금 상태 | useState |

### UI 인터랙션 훅

| 훅 | 파일 | 역할 | 주요 의존성 |
|----|------|------|------------|
| `useClipboard` | `useClipboard.ts` | 복사/잘라내기/붙여넣기 | useState |
| `useKeyboardNavigation` | `useKeyboardNavigation.ts` | 키보드 단축키 및 파일 탐색 | useRef, type-ahead 검색 |
| `useMarqueeSelection` | `useMarqueeSelection.ts` | 마우스 드래그 범위 선택 | useState, containerRef |
| `useLocalSearch` | `useLocalSearch.ts` | 클라이언트 사이드 파일 필터링 | useState |
| `useToast` | `useToast.ts` | 토스트 헬퍼 (편의 함수) | toastStore |
| `useModalKeyboard` | `useModalKeyboard.ts` | 모달 ESC/Enter 키 처리 | useEffect |

---

## 라우팅 구조

### 공개 라우트 (인증 불필요)

| URL 패턴 | 컴포넌트 | 설명 |
|----------|---------|------|
| `/s/:token` | `ShareAccessPage` | 다운로드 공유 접근 |
| `/e/:token` | `ShareAccessPage` | 편집 공유 접근 (OnlyOffice) |
| `/u/:token` | `UploadShareAccessPage` | 업로드 공유 접근 |

### 인증 필요 라우트

| URL 패턴 | 컴포넌트 | 내부 경로 | 설명 |
|----------|---------|----------|------|
| `/` | `FilesWrapper -> FileList` | `/home` | 홈 디렉토리 |
| `/files` | `FilesWrapper -> FileList` | `/home` | 홈 디렉토리 |
| `/files/*` | `FilesWrapper -> FileList` | `/home/*` | 파일 브라우저 |
| `/shared-with-me` | `FileList` | `/shared-with-me` | 공유 받은 항목 |
| `/shared-by-me` | `FileList` | `/shared-by-me` | 내가 공유한 항목 |
| `/link-shares` | `FileList` | `/link-shares` | 링크 공유 목록 |
| `/shared-drive/:folderName` | `SharedDriveWrapper -> FileList` | `/shared/:folderName` | 공유 드라이브 루트 |
| `/shared-drive/:folderName/*` | `SharedDriveWrapper -> FileList` | `/shared/:folderName/*` | 공유 드라이브 하위 |
| `/external/:mountPath` | `ExternalStorageWrapper -> FileList` | `/external/:mountPath` | 외부 스토리지 루트 |
| `/external/:mountPath/*` | `ExternalStorageWrapper -> FileList` | `/external/:mountPath/*` | 외부 스토리지 하위 |
| `/trash` | `Trash` | - | 휴지통 |
| `/my-activity` | `MyActivity` (lazy) | - | 내 활동 (최근 항목) |
| `/notifications` | `NotificationCenter` (lazy) | - | 알림 센터 |

### 관리자 라우트 (Admin 권한 필요)

| URL 패턴 | 컴포넌트 (lazy) | 설명 |
|----------|----------------|------|
| `/fhadmin` | `AdminUserList` | 관리자 대시보드 (기본: 사용자 관리) |
| `/fhadmin/users` | `AdminUserList` | 사용자 관리 |
| `/fhadmin/shared-folders` | `AdminSharedFolders` | 공유 폴더 관리 |
| `/fhadmin/external-storages` | `AdminExternalStorages` | 외부 스토리지 관리 |
| `/fhadmin/settings` | `AdminSettings` | 시스템 설정 |
| `/fhadmin/sso` | `AdminSSOSettings` | SSO 설정 |
| `/fhadmin/logs` | `AdminLogs` | 감사 로그 |
| `/fhadmin/system-info` | `AdminSystemInfo` | 시스템 정보 |

### URL-내부 경로 매핑

FileHatch는 URL 경로와 내부 파일시스템 경로를 구분합니다:

| URL 경로 | 내부 경로 (currentPath) |
|----------|----------------------|
| `/files` | `/home` |
| `/files/Documents/work` | `/home/Documents/work` |
| `/shared-drive/TeamDrive/subfolder` | `/shared/TeamDrive/subfolder` |
| `/external/nas-backup/media` | `/external/nas-backup/media` |
| `/shared-with-me` | `/shared-with-me` |
| `/shared-by-me` | `/shared-by-me` |
| `/link-shares` | `/link-shares` |

---

## 테마 시스템

### ThemeContext

**파일:** `ui/src/contexts/ThemeContext.tsx`

| 항목 | 값 |
|------|------|
| 테마 옵션 | `light`, `dark`, `system` |
| 저장소 | localStorage (`filehatch-theme`) |
| 적용 방식 | `<html data-theme="light\|dark">` attribute |
| CSS 전환 | CSS 변수 자동 전환 |

### 주요 CSS 변수

```css
/* Light 테마 */
:root[data-theme="light"] {
  --bg-primary: #FFFFFF;
  --bg-secondary: #F4F5F7;
  --text-primary: #191F28;
  --text-secondary: #8B95A1;
  --primary: #3182F6;
  --success: #00C853;
  --error: #F44336;
  --warning: #FF9800;
}

/* Dark 테마 */
:root[data-theme="dark"] {
  --bg-primary: #1A1B1E;
  --bg-secondary: #25262B;
  --text-primary: #C1C2C5;
  --text-secondary: #909296;
  /* ... */
}
```

---

## 스타일 가이드

### CSS 방법론

| 항목 | 규칙 |
|------|------|
| 방법론 | BEM (Block__Element--Modifier) |
| 파일 타입 | Plain CSS (CSS-in-JS 사용하지 않음) |
| 디자인 토큰 | `ui/src/styles/global.css` |
| 반응형 기준점 | `max-width: 768px` |

### 디자인 토큰

| 속성 | 값 |
|------|------|
| Primary Color | `#3182F6` |
| Background | `#FFFFFF` (밝은) / `#F4F5F7` (보조) |
| Text Primary | `#191F28` |
| Text Secondary | `#8B95A1` |
| Success | `#00C853` |
| Error | `#F44336` |
| Border Radius | `8px` ~ `16px` |
| Box Shadow (light) | `0 2px 4px rgba(0,0,0,0.08)` |
| Box Shadow (medium) | `0 4px 16px rgba(0,0,0,0.12)` |
| Transition | `all 0.2s ease` |

### BEM 네이밍 예시

```css
/* Block */
.file-list { }

/* Element */
.file-list__header { }
.file-list__item { }
.file-list__item-name { }

/* Modifier */
.file-list__item--selected { }
.file-list__item--dragging { }
.file-list--grid-view { }
```

### 반응형 디자인

```css
/* 모바일 (768px 이하) */
@media (max-width: 768px) {
  .sidebar { /* 오버레이로 전환 */ }
  .file-list--grid-view { /* 2열 그리드 */ }
  .details-sidebar { /* 숨김 */ }
}
```

---

## React Query 설정

**파일:** `ui/src/main.tsx`

### 기본 옵션

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,          // 60초 - 데이터 신선도 유지
      gcTime: 300_000,            // 5분 - 가비지 컬렉션
      refetchOnWindowFocus: false, // 탭 전환 시 리페치 비활성
      refetchOnReconnect: true,    // 네트워크 재연결 시 리페치
      retry: 1,                    // 1회 재시도
    },
  },
})
```

### 주요 쿼리 키 패턴

| 쿼리 키 | 사용처 | 설명 |
|---------|--------|------|
| `['files', currentPath]` | FileList | 파일/폴더 목록 |
| `['shared-folders']` | useSharedFolders | 공유 폴더 목록 |
| `['external-storages']` | useExternalStorages | 외부 스토리지 목록 |
| `['notifications']` | useNotifications | 알림 목록 |
| `['file-metadata', path]` | useFileMetadata | 파일 메타데이터 |
| `['storage-usage']` | Sidebar | 저장 공간 사용량 |

### 캐시 무효화 타이밍

| 이벤트 | 무효화 대상 |
|--------|------------|
| 파일 업로드 완료 | `['files', currentPath]` |
| 폴더 생성 | `['files', currentPath]` |
| 파일 삭제/이동 | `['files', currentPath]`, `['storage-usage']` |
| WebSocket 파일 변경 | `['files', changedPath]` |
| 공유 폴더 변경 | `['shared-folders']` |

---

## 토큰 갱신 메커니즘

**파일:** `ui/src/App.tsx` (useEffect 내)

1. JWT 토큰의 `exp` 클레임에서 만료 시각 추출
2. 만료 5분 전에 `refreshAuthToken()` 스케줄링
3. 사용자 활동(mousedown/keydown) 감지 시 남은 유효 기간이 50% 미만이면 갱신
4. 활동 기반 갱신은 5분 쿨다운 적용
5. 완전 만료된 토큰은 자동 로그아웃

```
[토큰 생성] ─────────── [50% 경과] ─────── [5분 전] ─── [만료]
                         │                   │            │
                    활동 시 갱신           예약 갱신      로그아웃
```

---

## 추가 컴포넌트

### 기타 독립 컴포넌트

| 컴포넌트 | 파일 | 설명 |
|---------|------|------|
| `LoginPage` | `LoginPage.tsx` | 로그인 페이지 (일반/SSO/2FA/초기설정) |
| `InitialSetupModal` | `InitialSetupModal.tsx` | 첫 로그인 시 초기 설정 모달 |
| `AuthModal` | `AuthModal.tsx` | 인증 관련 모달 |
| `EditUserModal` | `EditUserModal.tsx` | 사용자 편집 모달 (관리자) |
| `CreateUserModal` | `CreateUserModal.tsx` | 사용자 생성 모달 (관리자) |
| `ConfirmModal` | `ConfirmModal.tsx` | 확인 대화상자 |
| `UserManagement` | `UserManagement.tsx` | 사용자 관리 컴포넌트 |
| `SMBSettings` | `SMBSettings.tsx` | SMB/Samba 설정 |
| `MobileFAB` | `MobileFAB.tsx` | 모바일 플로팅 액션 버튼 |
| `FileListSkeleton` | `FileListSkeleton.tsx` | 파일 목록 로딩 스켈레톤 |
| `NotificationBell` | `NotificationBell.tsx` | 헤더 알림 벨 아이콘 |
