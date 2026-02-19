# 사용자 환경설정 및 활동 시스템 명세

## 1. 시스템 개요

사용자별 환경설정, 즐겨찾기(별표), 최근 파일/활동 이력, 숨김 파일 관리 등
개인화 기능을 통합 관리하는 시스템이다.
서버에 저장되는 환경설정은 다중 기기 간 동기화를 지원하며,
Zustand + `persist` 미들웨어를 통해 로컬 캐시도 유지한다.

### 핵심 특성

| 특성 | 설명 |
|------|------|
| 서버 동기화 | 환경설정은 DB(`users.preferences` JSONB)에 저장되어 기기 간 동기화 |
| 낙관적 업데이트 | 프론트엔드에서 즉시 반영 후 서버 저장, 실패 시 롤백 |
| 감사 로그 기반 최근 항목 | `audit_logs` 테이블의 파일 이벤트를 기반으로 최근 활동 추출 |
| 배치 쿼리 | 즐겨찾기 상태 확인 시 다수 파일을 한 번에 조회 (`ANY($2)`) |
| 파일 시스템 연동 | 즐겨찾기/최근 항목에서 실제 파일 존재 여부를 `os.Stat`으로 검증 |

---

## 2. 사용자 환경설정

### 2.1 백엔드 구조

| 항목 | 설명 |
|------|------|
| 파일 | `api/handlers/user_preferences.go` |
| 구조체 | `UserPreferencesHandler` |
| 의존성 | `*sql.DB` |
| 저장 위치 | `users.preferences` (JSONB 컬럼) |

#### Handler 구조체

```go
type UserPreferencesHandler struct {
    db *sql.DB
}
```

#### 데이터 모델

```go
type UserPreferences struct {
    SidebarOrder   []string `json:"sidebarOrder,omitempty"`
    SidebarHidden  []string `json:"sidebarHidden,omitempty"`
    DefaultLanding string   `json:"defaultLanding,omitempty"`
}
```

### 2.2 설정 항목

#### 사이드바 순서 (`sidebarOrder`)

사이드바에 표시되는 섹션의 순서를 정의한다. 유효한 값은 다음 6개이다.

| 섹션 키 | 표시 이름 | 설명 |
|---------|-----------|------|
| `files` | 내 파일 | 사용자의 홈 디렉토리 |
| `recent` | 내 작업 | 최근 활동 및 즐겨찾기 페이지 |
| `shared-drives` | 공유 드라이브 | 공유 폴더 목록 (있을 때만 표시) |
| `external-storages` | 외부 스토리지 | 외부 스토리지 연결 (있을 때만 표시) |
| `sharing` | 공유 | 나에게 공유된/내가 공유한/링크 공유 |
| `trash` | 휴지통 | 삭제된 파일 관리 |

기본 순서는 위 테이블의 나열 순서와 동일하다.

#### 사이드바 숨김 (`sidebarHidden`)

표시하지 않을 섹션 키의 배열이다. 위의 6개 유효 값 중에서 선택 가능하다.

#### 기본 시작 페이지 (`defaultLanding`)

로그인 후 최초로 표시할 페이지를 지정한다.

| 값 | 의미 |
|----|------|
| `""` (빈 문자열) | 내 파일 (기본값) |
| `/files` | 내 파일 |
| `/recent` | 내 작업 |
| `/shared-drive` | 공유 드라이브 |
| `/shared-with-me` | 나에게 공유된 파일 |
| `/trash` | 휴지통 |

### 2.3 API 엔드포인트

#### 환경설정 조회

```
GET /api/user/preferences
```

| 항목 | 설명 |
|------|------|
| 인증 | JWT 필수 |
| 응답 | `UserPreferences` JSON 객체 |

DB에 저장된 `preferences` JSONB가 비어있거나 `{}`인 경우 빈 기본값을 반환한다.

**응답 예시:**

```json
{
  "sidebarOrder": ["files", "recent", "shared-drives", "external-storages", "sharing", "trash"],
  "sidebarHidden": [],
  "defaultLanding": ""
}
```

#### 환경설정 업데이트

```
PUT /api/user/preferences
```

| 항목 | 설명 |
|------|------|
| 인증 | JWT 필수 |
| 요청 바디 | `UserPreferences` JSON 객체 |
| 응답 | 저장된 `UserPreferences` JSON 객체 |

**서버사이드 검증:**

1. `sidebarOrder` 값이 6개 유효 섹션 키에 포함되는지 확인
2. `sidebarOrder` 내 중복 검사
3. `sidebarHidden` 값이 유효 섹션 키에 포함되는지 확인
4. `defaultLanding` 값이 허용 목록에 포함되는지 확인

**요청 예시:**

```json
{
  "sidebarOrder": ["recent", "files", "sharing", "trash", "shared-drives", "external-storages"],
  "sidebarHidden": ["external-storages"],
  "defaultLanding": "/recent"
}
```

### 2.4 프론트엔드 동기화

프론트엔드에서는 `usePreferencesStore` (Zustand)를 통해 환경설정을 관리한다.

```
[앱 시작 / 토큰 변경]
    |
    v
fetchPreferences() -----> GET /api/user/preferences
    |                            |
    v                            v
로컬 캐시 업데이트       <---- 서버 응답
    |
    v
자동 마이그레이션: 누락된 섹션 추가
(DEFAULT_SIDEBAR_ORDER에 있으나 서버 응답에 없는 항목)
    |
    v
Sidebar 컴포넌트에서 preferences.sidebarOrder 순서로 렌더링
```

**낙관적 업데이트 흐름:**

```
[사용자: 설정 변경]
    |
    v
set({ preferences: updated })  // 즉시 로컬 반영
    |
    v
PUT /api/user/preferences -----> 서버 저장
    |                                |
    +-- 성공: 유지                    |
    +-- 실패: set({ preferences: current })  // 롤백
```

---

## 3. 즐겨찾기/별표 시스템

### 3.1 백엔드 구조

| 항목 | 설명 |
|------|------|
| 파일 | `api/handlers/starred.go` |
| 구조체 | `Handler` (메인 파일 핸들러의 메서드) |
| DB 테이블 | `starred_files` |

#### 데이터 모델

```go
type StarredFile struct {
    ID        string    `json:"id"`
    FilePath  string    `json:"filePath"`
    StarredAt time.Time `json:"starredAt"`
    IsDir     bool      `json:"isDir"`
}

type StarRequest struct {
    Path string `json:"path"`
}
```

### 3.2 API 엔드포인트

#### 즐겨찾기 토글

```
POST /api/starred/toggle
```

| 항목 | 설명 |
|------|------|
| 인증 | JWT 필수 |
| 요청 바디 | `{"path": "/home/documents/file.txt"}` |
| 동작 | 이미 별표된 경우 해제, 아닌 경우 추가 |

**응답 예시 (추가):**

```json
{
  "starred": true,
  "path": "/home/documents/file.txt"
}
```

**응답 예시 (해제):**

```json
{
  "starred": false,
  "path": "/home/documents/file.txt"
}
```

#### 즐겨찾기 목록 조회

```
GET /api/starred
```

| 항목 | 설명 |
|------|------|
| 인증 | JWT 필수 |
| 응답 | 별표 시간 역순 정렬된 `StarredFile` 배열 |

서버에서 각 항목에 대해 `os.Stat`을 호출하여 파일이 디렉토리인지 확인한다 (`IsDir` 필드).

**응답 예시:**

```json
{
  "starred": [
    {
      "id": "uuid-1234",
      "filePath": "/home/documents/report.docx",
      "starredAt": "2025-01-15T10:30:00Z",
      "isDir": false
    }
  ],
  "total": 1
}
```

#### 즐겨찾기 상태 배치 확인

```
POST /api/starred/check
```

| 항목 | 설명 |
|------|------|
| 인증 | JWT 필수 |
| 요청 바디 | `{"paths": ["/home/a.txt", "/home/b.txt"]}` |
| 응답 | 경로별 별표 여부 맵 |

PostgreSQL의 `ANY($2)` 배열 쿼리를 사용하여 단일 쿼리로 다수 파일의 상태를 확인한다.

**응답 예시:**

```json
{
  "starred": {
    "/home/a.txt": true,
    "/home/b.txt": false
  }
}
```

### 3.3 파일 이동/삭제 시 연동

즐겨찾기된 파일이 이동 또는 삭제되면 경로가 자동으로 갱신/제거된다.

| 메서드 | 호출 시점 | 동작 |
|--------|-----------|------|
| `RemoveStarredByPath(userID, path)` | 파일 삭제 시 | 해당 경로의 즐겨찾기 제거 |
| `UpdateStarredPath(userID, oldPath, newPath)` | 파일 이름 변경/이동 시 | 경로 업데이트 |

### 3.4 프론트엔드 통합

#### useStarredAndLocked 훅

파일 목록에서 각 파일의 즐겨찾기/잠금 상태를 관리하는 훅이다.

```typescript
interface UseStarredAndLockedOptions {
  filePaths: string[]
  currentUserId?: string
  enabled?: boolean
}
```

| 반환값 | 타입 | 설명 |
|--------|------|------|
| `starred` | `Record<string, boolean>` | 경로별 별표 상태 |
| `isStarred(path)` | `(string) => boolean` | 특정 파일 별표 여부 |
| `toggleStar(path)` | `(string) => Promise` | 별표 토글 |
| `refetchStarred` | `() => void` | 상태 새로고침 |

**React Query 설정:**

| 설정 | 값 | 설명 |
|------|----|------|
| queryKey | `['starred-status', pathsKey]` | 경로 목록 기반 캐시 키 |
| staleTime | 30000ms | 30초간 데이터 신선도 유지 |
| enabled | `filePaths.length > 0` | 파일이 있을 때만 쿼리 |

정렬된 경로 문자열을 캐시 키로 사용하여, 파일 순서 변경 시 불필요한 캐시 미스를 방지한다.

---

## 4. 최근 파일/활동

### 4.1 백엔드 구조

| 항목 | 설명 |
|------|------|
| 파일 | `api/handlers/audit.go` |
| 구조체 | `AuditHandler` |
| 데이터 소스 | `audit_logs` 테이블 |
| 필터 테이블 | `hidden_recent_items` |

최근 파일 목록은 별도 테이블이 아닌, `audit_logs`에 기록된 파일 이벤트를
집계(DISTINCT ON + 윈도우 함수)하여 생성한다.

#### 데이터 모델

```go
type RecentFile struct {
    Path      string    `json:"path"`
    Name      string    `json:"name"`
    EventType string    `json:"eventType"`
    Timestamp time.Time `json:"timestamp"`
    IsDir     bool      `json:"isDir"`
    Size      int64     `json:"size"`
}

type HideRecentItemRequest struct {
    FilePath string `json:"file_path"`
}
```

### 4.2 API 엔드포인트

#### 최근 파일 조회

```
GET /api/files/recent?limit=100
```

| 항목 | 설명 |
|------|------|
| 인증 | JWT 필수 |
| 쿼리 파라미터 | `limit` (기본 100, 최대 500) |
| 응답 | `RecentFile` 배열 (최신순 정렬) |

**내부 동작:**

1. CTE(`WITH ranked_files`)로 `audit_logs`에서 사용자의 파일 이벤트 추출
2. `ROW_NUMBER() OVER (PARTITION BY target_resource ORDER BY ts DESC)`로 파일별 최신 이벤트만 선택
3. `hidden_recent_items` 테이블과 LEFT JOIN하여 숨김 처리된 항목 제외
4. 숨김 시점(`hidden_at`)이 이벤트 시점(`ts`)보다 이후인 경우에만 제외 (숨긴 후 새 이벤트 발생 시 다시 표시)
5. 결과의 각 경로에 대해 `os.Stat`으로 실제 파일 존재 여부 검증 (삭제/이동된 파일 자동 제외)
6. 파일 시스템에서 `IsDir`와 `Size` 정보를 실시간으로 취득

**대상 이벤트 유형:**

| 이벤트 | 상수 |
|--------|------|
| 파일 업로드 | `file.upload` |
| 파일 다운로드 | `file.download` |
| 파일 조회 | `file.view` |
| 파일 편집 | `file.edit` |
| 파일 복사 | `file.copy` |
| 파일 이동 | `file.move` |
| 파일 이름 변경 | `file.rename` |
| 폴더 생성 | `folder.create` |
| 휴지통 복원 | `trash.restore` |

**SQL 핵심 쿼리:**

```sql
WITH ranked_files AS (
    SELECT
        target_resource, event_type, ts,
        ROW_NUMBER() OVER (PARTITION BY target_resource ORDER BY ts DESC) as rn
    FROM audit_logs
    WHERE actor_id = $1
      AND event_type IN ('file.upload', 'file.download', ...)
      AND target_resource IS NOT NULL
)
SELECT rf.target_resource, rf.event_type, rf.ts
FROM ranked_files rf
LEFT JOIN hidden_recent_items hri
    ON hri.user_id = $1::uuid
    AND hri.file_path = rf.target_resource
    AND hri.hidden_at >= rf.ts
WHERE rf.rn = 1
  AND hri.id IS NULL
ORDER BY rf.ts DESC
LIMIT $2
```

#### 최근 항목 개별 숨기기

```
POST /api/files/recent/hide
```

| 항목 | 설명 |
|------|------|
| 인증 | JWT 필수 |
| 요청 바디 | `{"file_path": "/home/documents/file.txt"}` |
| 동작 | `hidden_recent_items`에 레코드 삽입 (UPSERT) |

`ON CONFLICT (user_id, file_path) DO NOTHING`으로 중복 삽입을 방지한다.

#### 최근 항목 전체 정리

```
DELETE /api/files/recent
```

| 항목 | 설명 |
|------|------|
| 인증 | JWT 필수 |
| 동작 | 현재 모든 최근 항목을 `hidden_recent_items`에 일괄 삽입 |
| 응답 | `{"message": "ok", "hidden_count": 42}` |

**내부 동작:**

```sql
INSERT INTO hidden_recent_items (user_id, file_path)
SELECT $1::uuid, rf.target_resource
FROM (
    SELECT DISTINCT ON (target_resource) target_resource
    FROM audit_logs
    WHERE actor_id = $1
      AND event_type IN (...)
      AND target_resource IS NOT NULL
) rf
ON CONFLICT (user_id, file_path) DO NOTHING
```

기존 `audit_logs` 레코드는 삭제하지 않고, `hidden_recent_items`에 숨김 마커만 추가한다.
이후 새로운 이벤트가 발생하면 해당 파일은 다시 최근 항목에 나타난다.

### 4.3 경로 해석 (resolveDisplayPath)

`audit_logs`에 저장된 표시 경로(display path)를 실제 파일 시스템 경로로 변환한다.

| 표시 경로 패턴 | 실제 경로 |
|---------------|-----------|
| `/home/{username}/...` | `{dataRoot}/users/{username}/...` |
| `/home/...` (username 없음) | `{dataRoot}/users/{currentUser}/...` |
| `/shared/...` | `{dataRoot}/shared/...` |
| `/shared-drives/...` | `{dataRoot}/shared/...` |
| 기타 | `{dataRoot}/users/{currentUser}/{path}` |

---

## 5. 숨김 파일 관리

### 5.1 백엔드 구조

| 항목 | 설명 |
|------|------|
| 파일 | `api/handlers/hidden_files.go` |
| 함수 | `IsHiddenFile(name string) bool` |
| 용도 | 파일 목록 조회 시 시스템 파일 자동 필터링 |

### 5.2 기본 숨김 패턴

OS 및 파일 시스템에서 생성하는 시스템/썸네일 파일을 자동으로 숨긴다.

| 패턴 | 출처/설명 |
|------|-----------|
| `Thumbs.db` | Windows 썸네일 캐시 |
| `desktop.ini` | Windows 폴더 설정 |
| `.DS_Store` | macOS 폴더 메타데이터 |
| `@eaDir` | Synology NAS 확장 속성 디렉토리 |
| `.@__thumb` | Synology NAS 썸네일 |
| `.Spotlight-V100` | macOS Spotlight 인덱스 |
| `.fseventsd` | macOS 파일 시스템 이벤트 |
| `.Trashes` | macOS 휴지통 |
| `$RECYCLE.BIN` | Windows 휴지통 |
| `System Volume Information` | Windows 시스템 볼륨 정보 |

### 5.3 판별 로직

```
[파일명 입력]
    |
    v
점(.)으로 시작하는가? ---- 예 --> 숨김
    |
    아니오
    v
DefaultHiddenPatterns와 대소문자 무시 비교
    |
    +-- 정확히 일치 --> 숨김
    +-- glob 패턴 일치 --> 숨김
    +-- 불일치 --> 표시
```

이 함수는 파일 목록 조회(`ListFiles`) 시 서버사이드에서 호출되어,
사용자에게 불필요한 시스템 파일이 노출되지 않도록 한다.

---

## 6. 프론트엔드 구현

### 6.1 스토어

#### usePreferencesStore

| 파일 | `ui/src/stores/preferencesStore.ts` |
|------|------|
| 상태 관리 | Zustand + persist 미들웨어 |
| 로컬 스토리지 키 | `user-preferences` |

**상태 인터페이스:**

```typescript
interface PreferencesState {
  preferences: UserPreferences
  isLoaded: boolean
  fetchPreferences: () => Promise<void>
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>
  resetPreferences: () => Promise<void>
}
```

**기본값 (`DEFAULT_SIDEBAR_ORDER`):**

```typescript
['files', 'recent', 'shared-drives', 'external-storages', 'sharing', 'trash']
```

**자동 마이그레이션:**

서버에서 받은 `sidebarOrder`에 `DEFAULT_SIDEBAR_ORDER`에 있는 새 항목이 누락된 경우,
누락된 항목을 배열 끝에 자동 추가한다. 이를 통해 새 섹션이 추가될 때
기존 사용자의 설정이 자연스럽게 업데이트된다.

**persist 미들웨어:**

```typescript
persist((set, get) => ({...}), {
  name: 'user-preferences',
  partialize: (state) => ({
    preferences: state.preferences,
  }),
})
```

`isLoaded` 상태는 로컬 스토리지에 저장하지 않고, `preferences`만 영속화한다.

### 6.2 컴포넌트

#### MyActivity 컴포넌트

| 파일 | `ui/src/components/MyActivity.tsx` |
|------|------|
| 경로 | `/my-activity` |
| 기능 | 즐겨찾기 + 최근 항목 통합 뷰 |

**컴포넌트 구조:**

```
MyActivity.tsx
  |
  +-- 탭 (즐겨찾기 / 최근 항목)
  |
  +-- 툴바 (검색, 정렬, 뷰모드 전환)
  |
  +-- 파일 종류 필터 바
  |
  +-- 파일 목록
  |     +-- VirtualizedFileTable (list 모드, 대량 파일)
  |     +-- FileRow (list 모드, 소량 파일)
  |     +-- FileCard (grid 모드)
  |
  +-- FileInfoPanel (상세 패널, Portal)
  |
  +-- 컨텍스트 메뉴
  |
  +-- FileViewer / TextEditor (파일 미리보기/편집)
  |
  +-- 전체 지우기 확인 다이얼로그
```

**탭 구조:**

| 탭 | 데이터 소스 | 로딩 |
|----|------------|------|
| 즐겨찾기 (`starred`) | `getStarredFiles()` | 탭 전환 시 |
| 최근 항목 (`recent`) | `getRecentFiles(100)` | 컴포넌트 마운트 시 |

**파일 종류 필터:**

| 필터 ID | 라벨 | 대상 확장자 |
|---------|------|------------|
| `all` | 전체 | 모든 파일 |
| `document` | 문서 | doc, docx, pdf, txt, md, hwp, rtf, odt |
| `spreadsheet` | 스프레드시트 | xls, xlsx, csv, ods |
| `presentation` | 프레젠테이션 | ppt, pptx, odp |
| `image` | 이미지 | jpg, jpeg, png, gif, webp, svg, bmp, ico, tiff |
| `video` | 동영상 | mp4, mkv, avi, mov, webm, wmv, flv, m4v |
| `audio` | 오디오 | mp3, wav, flac, m4a, aac, ogg, wma |
| `archive` | 압축파일 | zip, rar, 7z, tar, gz, bz2, xz |
| `folder` | 폴더 | 디렉토리만 |

**정렬 옵션:**

| 값 | 라벨 |
|----|------|
| `newest` | 최신순 |
| `oldest` | 오래된순 |
| `name-asc` | 이름 (ㄱ-ㅎ) |
| `name-desc` | 이름 (ㅎ-ㄱ) |

**뷰 모드:**

| 모드 | 저장 위치 |
|------|-----------|
| `list` | `localStorage('myActivityViewMode')` |
| `grid` | `localStorage('myActivityViewMode')` |

가상 스크롤은 `VIRTUALIZATION_THRESHOLD` 이상의 파일이 있을 때 활성화된다.

**컨텍스트 메뉴 항목:**

| 항목 | 조건 | 동작 |
|------|------|------|
| 열기 | 편집/미리보기 가능 파일 | FileViewer 또는 TextEditor 열기 |
| 다운로드 | 파일만 (폴더 제외) | `downloadFile(path)` |
| 파일 위치로 가기 | 항상 | 부모 디렉토리로 이동 |
| 경로 복사 | 항상 | 클립보드에 경로 복사 |
| 최근 항목에서 제거 | 최근 항목 탭에서만 | `hideRecentItem(path)` |

#### UserProfile 컴포넌트 (사이드바 설정 탭)

| 파일 | `ui/src/components/UserProfile.tsx` |
|------|------|
| 탭 | 프로필, 비밀번호, 애플리케이션 암호, 2FA 보안, **사이드바** |

**사이드바 설정 기능:**

| 기능 | 설명 |
|------|------|
| 드래그 앤 드롭 순서 변경 | HTML5 Drag API로 섹션 순서 변경 |
| 위/아래 버튼 | 접근성을 위한 순서 조정 버튼 |
| 표시/숨김 토글 | 체크박스로 섹션 표시 여부 전환 |
| 기본 시작 페이지 | 드롭다운으로 선택 |
| 저장 | `updatePreferences()` 호출 |
| 초기화 | `resetPreferences()` 호출, 모든 설정을 기본값으로 복원 |

#### Sidebar 컴포넌트

| 파일 | `ui/src/components/Sidebar.tsx` |
|------|------|
| 역할 | 환경설정에 따른 사이드바 렌더링 |

`preferences.sidebarOrder` 순서로 섹션을 렌더링하며,
`preferences.sidebarHidden`에 포함된 섹션은 건너뛴다.

```typescript
{(preferences.sidebarOrder.length > 0
  ? preferences.sidebarOrder
  : ['files', 'recent', 'shared-drives', 'external-storages', 'sharing', 'trash']
).map(section => {
  if (preferences.sidebarHidden.includes(section)) return null
  switch (section) {
    case 'files': return /* 내 파일 링크 */
    case 'recent': return /* 내 작업 링크 */
    // ...
  }
})}
```

환경설정은 앱 시작 시 `token`이 존재하면 자동으로 `fetchPreferences()`를 호출하여 로드한다.

### 6.3 API 레이어

| 파일 | `ui/src/api/files.ts` |
|------|------|

**타입 정의:**

```typescript
export interface RecentFile {
  path: string
  name: string
  eventType: string
  timestamp: string
  isDir: boolean
  size: number
}

export interface StarredFile {
  id: string
  filePath: string
  starredAt: string
  isDir: boolean
}
```

**API 함수:**

| 함수 | HTTP | 엔드포인트 |
|------|------|-----------|
| `getRecentFiles(limit)` | GET | `/api/files/recent?limit={limit}` |
| `hideRecentItem(filePath)` | POST | `/api/files/recent/hide` |
| `clearAllRecentItems()` | DELETE | `/api/files/recent` |
| `toggleStar(path)` | POST | `/api/starred/toggle` |
| `getStarredFiles()` | GET | `/api/starred` |
| `checkStarred(paths)` | POST | `/api/starred/check` |

### 6.4 커스텀 훅

#### useStarredAndLocked

| 파일 | `ui/src/hooks/useStarredAndLocked.ts` |
|------|------|
| 역할 | 파일 목록에서 즐겨찾기/잠금 상태를 배치 관리 |

이 훅은 `FileList` 컴포넌트에서 현재 디렉토리의 파일 경로 목록을 전달받아,
해당 파일들의 즐겨찾기 및 잠금 상태를 한 번에 조회한다.
`toggleStar` 호출 시 로컬 상태를 즉시 업데이트하고,
`['starred-files']` 쿼리를 무효화하여 MyActivity 페이지와 동기화한다.

---

## 7. 데이터 모델

### 7.1 users 테이블 (환경설정 관련)

```sql
-- 마이그레이션: 005_user_preferences
ALTER TABLE users ADD COLUMN preferences JSONB DEFAULT '{}';
```

| 컬럼 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `preferences` | JSONB | `'{}'` | 사용자 환경설정 JSON |

JSONB 저장 구조:

```json
{
  "sidebarOrder": ["files", "recent", "shared-drives", "external-storages", "sharing", "trash"],
  "sidebarHidden": [],
  "defaultLanding": ""
}
```

### 7.2 starred_files 테이블

```sql
-- 마이그레이션: 004_starred_and_locks
CREATE TABLE IF NOT EXISTS starred_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path VARCHAR(1024) NOT NULL,
    starred_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, file_path)
);
```

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | UUID | PK, 자동 생성 |
| `user_id` | UUID | FK -> users(id), CASCADE 삭제 |
| `file_path` | VARCHAR(1024) | 가상 경로 (예: `/home/documents/file.txt`) |
| `starred_at` | TIMESTAMPTZ | 별표 시점 |

**인덱스:**

| 인덱스 | 컬럼 |
|--------|------|
| `idx_starred_files_user` | `user_id` |
| `idx_starred_files_path` | `file_path` |

**제약 조건:**

- `UNIQUE(user_id, file_path)`: 같은 사용자가 같은 파일을 중복 별표할 수 없음

### 7.3 hidden_recent_items 테이블

```sql
-- 마이그레이션: 006_hidden_recent_items
CREATE TABLE IF NOT EXISTS hidden_recent_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path VARCHAR(1024) NOT NULL,
    hidden_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, file_path)
);
```

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | UUID | PK, 자동 생성 |
| `user_id` | UUID | FK -> users(id), CASCADE 삭제 |
| `file_path` | VARCHAR(1024) | 숨김 처리된 파일 경로 |
| `hidden_at` | TIMESTAMPTZ | 숨김 처리 시점 |

**인덱스:**

| 인덱스 | 컬럼 |
|--------|------|
| `idx_hidden_recent_user` | `user_id` |

**제약 조건:**

- `UNIQUE(user_id, file_path)`: 중복 숨김 방지 (UPSERT 시 `ON CONFLICT DO NOTHING`)

**숨김 시점 비교 로직:**

`hidden_at >= ts` 조건을 통해, 숨김 처리 이후 새로운 이벤트가 발생하면
해당 파일이 최근 항목에 다시 나타나도록 설계되어 있다.

### 7.4 audit_logs 테이블 (최근 파일 데이터 소스)

최근 파일 기능은 별도 테이블이 아닌 `audit_logs`를 데이터 소스로 사용한다.

| 참조 컬럼 | 용도 |
|-----------|------|
| `actor_id` | 사용자별 필터링 |
| `event_type` | 파일 관련 이벤트 필터링 |
| `target_resource` | 파일 경로 (가상 경로) |
| `ts` | 이벤트 시간 (정렬/숨김 비교) |

---

## 8. 관련 파일 참조

### 백엔드

| 파일 경로 | 설명 |
|-----------|------|
| `api/handlers/user_preferences.go` | 환경설정 핸들러 (GET/PUT) |
| `api/handlers/starred.go` | 즐겨찾기 핸들러 (토글, 조회, 배치 확인, 경로 갱신) |
| `api/handlers/hidden_files.go` | 숨김 파일 패턴 판별 |
| `api/handlers/audit.go` | 최근 파일 조회, 개별 숨기기, 전체 정리 |
| `api/database/migrations/004_starred_and_locks.sql` | 즐겨찾기 테이블 마이그레이션 |
| `api/database/migrations/005_user_preferences.sql` | 환경설정 컬럼 마이그레이션 |
| `api/database/migrations/006_hidden_recent_items.sql` | 숨김 최근 항목 테이블 마이그레이션 |

### 프론트엔드

| 파일 경로 | 설명 |
|-----------|------|
| `ui/src/stores/preferencesStore.ts` | 환경설정 Zustand 스토어 |
| `ui/src/hooks/useStarredAndLocked.ts` | 즐겨찾기/잠금 상태 관리 훅 |
| `ui/src/components/MyActivity.tsx` | 내 작업 페이지 (즐겨찾기 + 최근 항목) |
| `ui/src/components/MyActivity.css` | 내 작업 페이지 스타일 |
| `ui/src/components/UserProfile.tsx` | 사용자 프로필 (사이드바 설정 탭 포함) |
| `ui/src/components/Sidebar.tsx` | 환경설정 기반 사이드바 렌더링 |
| `ui/src/api/files.ts` | 즐겨찾기/최근 파일 API 함수 |
