# 검색 및 메타데이터 시스템 명세

## 1. 시스템 개요

파일 검색과 메타데이터(설명, 태그) 관리를 담당하는 시스템이다.
파일명 검색, glob 패턴 매칭, 태그/설명 기반 메타데이터 검색을 지원하며,
병렬 파일 시스템 탐색과 PostgreSQL JSONB 기반 태그 인덱싱을 통해 대규모 파일 시스템에서도 빠른 검색 성능을 제공한다.

### 핵심 특성

| 특성 | 설명 |
|------|------|
| 병렬 검색 | `samber/lo/parallel`을 활용한 디렉토리 단위 병렬 파일 시스템 탐색 |
| 다중 매치 타입 | 파일명(`name`), 태그(`tag`), 설명(`description`) 기반 검색 지원 |
| Glob 패턴 | `*`, `?`, `[` 문자를 사용한 파일명 패턴 매칭 |
| 서버사이드 페이지네이션 | `page`/`limit` 파라미터를 통한 결과 분할 (기본 20개, 최대 100개) |
| 무한 스크롤 | IntersectionObserver 기반 프론트엔드 무한 스크롤 |
| JSONB 태그 | PostgreSQL JSONB + GIN 인덱스를 활용한 고속 태그 검색 |
| 자동완성 | 사용자가 등록한 전체 태그 목록 기반 태그 입력 자동완성 |
| 디바운싱 | 프론트엔드에서 300ms 디바운싱 적용으로 불필요한 API 호출 방지 |

---

## 2. 백엔드 구조

### 2.1 핸들러 파일 및 역할

| 파일 | 구조체 | 역할 |
|------|--------|------|
| `api/handlers/search.go` | `Handler` (기존 파일 핸들러) | 통합 검색 (파일명 + 태그 + 설명) |
| `api/handlers/file_metadata.go` | `FileMetadataHandler` | 메타데이터 CRUD, 태그 목록, 태그 검색, 배치 조회 |

### 2.2 Handler 구조체

```go
// 검색 핸들러 (Handler 구조체 내 메서드)
type Handler struct {
    db           *sql.DB
    dataRoot     string
    // ... 기타 의존성
}

// 메타데이터 전용 핸들러
type FileMetadataHandler struct {
    db *sql.DB
}

func NewFileMetadataHandler(db *sql.DB) *FileMetadataHandler {
    return &FileMetadataHandler{db: db}
}
```

### 2.3 주요 메서드 목록

**검색 (search.go)**

| 메서드 | 설명 | HTTP |
|--------|------|------|
| `SearchFiles` | 통합 검색 (파일명 + 메타데이터) | GET /api/files/search |

**메타데이터 (file_metadata.go)**

| 메서드 | 설명 | HTTP |
|--------|------|------|
| `GetFileMetadata` | 단일 파일 메타데이터 조회 | GET /api/file-metadata/* |
| `UpdateFileMetadata` | 메타데이터 생성/수정 (UPSERT) | PUT /api/file-metadata/* |
| `DeleteFileMetadata` | 메타데이터 삭제 | DELETE /api/file-metadata/* |
| `ListUserTags` | 사용자 전체 태그 목록 | GET /api/file-metadata/tags |
| `SearchByTag` | 특정 태그로 파일 검색 | GET /api/file-metadata/search |
| `GetBatchMetadata` | 다수 파일 메타데이터 일괄 조회 | POST /api/file-metadata/batch |

### 2.4 인증 요구사항

| 엔드포인트 | 미들웨어 | 비고 |
|------------|----------|------|
| `GET /api/files/search` | `OptionalJWTMiddleware` | 비인증 시 공유 폴더만 검색, 인증 시 홈+공유 모두 검색 |
| `GET/PUT/DELETE /api/file-metadata/*` | `JWTMiddleware` | 인증 필수, 사용자별 메타데이터 격리 |
| `GET /api/file-metadata/tags` | `JWTMiddleware` | 인증 필수 |
| `GET /api/file-metadata/search` | `JWTMiddleware` | 인증 필수 |
| `POST /api/file-metadata/batch` | `JWTMiddleware` | 인증 필수 |

---

## 3. API 엔드포인트

### 3.1 통합 검색

```
GET /api/files/search?q={query}&path={path}&page={page}&limit={limit}&matchType={matchType}
```

**쿼리 파라미터**

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `q` | string | O | - | 검색어 (2자 이상 권장) |
| `path` | string | X | `/` | 검색 범위 경로 (`/`, `/home`, `/shared` 등) |
| `page` | int | X | `1` | 페이지 번호 (1부터 시작) |
| `limit` | int | X | `20` | 페이지당 결과 수 (최대 100) |
| `matchType` | string | X | `all` | 매치 타입 필터: `all`, `name`, `tag`, `description` |

**응답 (200 OK)**

```json
{
  "query": "report",
  "results": [
    {
      "name": "report-2024.xlsx",
      "path": "/home/documents/report-2024.xlsx",
      "size": 102400,
      "isDir": false,
      "modTime": "2024-12-01T10:30:00Z",
      "extension": "xlsx",
      "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "matchType": "name"
    },
    {
      "name": "quarterly.pdf",
      "path": "/home/documents/quarterly.pdf",
      "size": 204800,
      "isDir": false,
      "modTime": "2024-11-15T09:00:00Z",
      "extension": "pdf",
      "mimeType": "application/pdf",
      "matchType": "tag",
      "matchedTag": "report",
      "description": "2024 분기별 보고서",
      "tags": ["report", "2024", "quarterly"]
    }
  ],
  "total": 15,
  "page": 1,
  "limit": 20,
  "hasMore": false,
  "matchType": "all"
}
```

**에러 응답**

| 상태 코드 | 조건 |
|-----------|------|
| 400 | `q` 파라미터 누락 |
| 400 | `path`가 루트(`/`)가 아닌 잘못된 경로 |

### 3.2 파일 메타데이터 조회

```
GET /api/file-metadata/{filePath}
```

**경로 파라미터**

| 파라미터 | 설명 |
|----------|------|
| `filePath` | URL 인코딩된 파일 경로 (예: `home/documents/report.pdf`) |

**응답 (200 OK) - 메타데이터 존재 시**

```json
{
  "id": 42,
  "filePath": "/home/documents/report.pdf",
  "description": "2024년 연간 보고서",
  "tags": ["report", "2024", "annual"],
  "createdAt": "2024-06-01T12:00:00Z",
  "updatedAt": "2024-12-01T10:30:00Z"
}
```

**응답 (200 OK) - 메타데이터 미존재 시**

```json
{
  "filePath": "/home/documents/report.pdf",
  "description": "",
  "tags": []
}
```

메타데이터가 DB에 없는 경우에도 404가 아닌 200으로 빈 메타데이터를 반환한다. 이는 프론트엔드에서 별도 에러 처리 없이 항상 일관된 구조로 처리할 수 있게 하기 위함이다.

### 3.3 메타데이터 수정 (UPSERT)

```
PUT /api/file-metadata/{filePath}
```

**요청 바디**

```json
{
  "description": "2024년 연간 보고서",
  "tags": ["report", "2024", "annual"]
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `description` | string* (pointer) | X | 파일 설명 (null 시 기존 값 유지) |
| `tags` | string[] | X | 태그 배열 (null 시 빈 배열로 초기화) |

**동작 방식**: `INSERT ... ON CONFLICT DO UPDATE` (UPSERT)
- 메타데이터가 없으면 새로 생성
- 이미 존재하면 업데이트
- `description`이 null인 경우 `COALESCE`로 기존 값 유지
- `updated_at`은 항상 `NOW()`로 갱신

**응답 (200 OK)**

```json
{
  "id": 42,
  "filePath": "/home/documents/report.pdf",
  "description": "2024년 연간 보고서",
  "tags": ["report", "2024", "annual"],
  "createdAt": "2024-06-01T12:00:00Z",
  "updatedAt": "2024-12-15T14:00:00Z"
}
```

### 3.4 메타데이터 삭제

```
DELETE /api/file-metadata/{filePath}
```

**응답 (200 OK)**

```json
{
  "success": true
}
```

### 3.5 사용자 태그 목록 조회

```
GET /api/file-metadata/tags
```

사용자가 등록한 모든 고유 태그를 알파벳 순으로 반환한다. 프론트엔드 태그 자동완성에 사용된다.

**응답 (200 OK)**

```json
{
  "tags": ["2024", "annual", "important", "project", "report"],
  "total": 5
}
```

**SQL 구현**:
```sql
SELECT DISTINCT jsonb_array_elements_text(tags) as tag
FROM file_metadata
WHERE user_id = $1
ORDER BY tag
```

### 3.6 태그 기반 파일 검색

```
GET /api/file-metadata/search?tag={tag}
```

**쿼리 파라미터**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `tag` | string | O | 정확히 일치하는 태그명 |

**응답 (200 OK)**

```json
{
  "files": [
    {
      "id": 42,
      "filePath": "/home/documents/report.pdf",
      "description": "2024년 연간 보고서",
      "tags": ["report", "2024", "annual"],
      "createdAt": "2024-06-01T12:00:00Z",
      "updatedAt": "2024-12-01T10:30:00Z"
    }
  ],
  "total": 1,
  "tag": "report"
}
```

**SQL 구현**: PostgreSQL `?` 연산자로 JSONB 배열 내 정확한 태그 존재 여부 확인
```sql
SELECT ... FROM file_metadata
WHERE user_id = $1 AND tags ? $2
ORDER BY file_path
```

### 3.7 배치 메타데이터 조회

```
POST /api/file-metadata/batch
```

여러 파일의 메타데이터를 한 번에 조회한다. 파일 목록 표시 시 각 파일의 태그/설명을 한꺼번에 로드할 때 사용한다.

**요청 바디**

```json
{
  "paths": [
    "/home/documents/report.pdf",
    "/home/images/photo.jpg",
    "/home/notes.txt"
  ]
}
```

**응답 (200 OK)**

```json
{
  "metadata": {
    "/home/documents/report.pdf": {
      "id": 42,
      "filePath": "/home/documents/report.pdf",
      "description": "연간 보고서",
      "tags": ["report", "2024"],
      "createdAt": "2024-06-01T12:00:00Z",
      "updatedAt": "2024-12-01T10:30:00Z"
    },
    "/home/images/photo.jpg": {
      "id": 55,
      "filePath": "/home/images/photo.jpg",
      "description": "",
      "tags": ["vacation"],
      "createdAt": "2024-07-01T08:00:00Z",
      "updatedAt": "2024-07-01T08:00:00Z"
    }
  }
}
```

메타데이터가 없는 경로는 결과 맵에서 생략된다. 현재 구현은 N+1 쿼리 방식(경로별 개별 쿼리)이다.

---

## 4. 검색 기능 상세

### 4.1 검색 방식

검색은 두 단계로 수행되며, 결과를 병합한다.

```
[SearchFiles 호출]
    |
    +-- 1단계: 파일 시스템 검색 (파일명 매칭)
    |     |
    |     +-- matchTypeFilter == "all" 또는 "name" 인 경우만 실행
    |     |
    |     +-- path == "/" → parallelSearch (home + shared 병렬)
    |     +-- path != "/" → searchInDirParallel (지정 경로만)
    |
    +-- 2단계: 메타데이터 검색 (태그/설명 매칭)
    |     |
    |     +-- matchTypeFilter == "all", "tag", "description" 인 경우만 실행
    |     +-- DB 쿼리로 file_metadata 테이블 검색
    |
    +-- 결과 병합 (중복 경로 제거)
    |
    +-- 페이지네이션 적용
    |
    v
[SearchResponse 반환]
```

### 4.2 파일명 검색

#### 일반 검색 (substring match)
검색어에 glob 문자(`*`, `?`, `[`)가 없으면 대소문자 무시 부분 문자열 매칭을 수행한다.

```go
// 예: "report" → "Annual_Report_2024.xlsx" 매칭
strings.Contains(strings.ToLower(filename), queryLower)
```

#### Glob 패턴 검색
검색어에 `*`, `?`, `[` 문자가 포함되면 `filepath.Match`를 사용한 glob 패턴 매칭으로 전환된다.

```go
// 예: "*.pdf" → 모든 PDF 파일 매칭
// 예: "report-202?" → report-2024, report-2025 등 매칭
filepath.Match(queryLower, filenameLower)
```

| 패턴 문자 | 설명 | 예시 |
|-----------|------|------|
| `*` | 0개 이상의 임의 문자 | `*.pdf` - 모든 PDF 파일 |
| `?` | 정확히 1개의 임의 문자 | `report-202?.xlsx` |
| `[...]` | 문자 클래스 | `[abc]*` - a, b, c로 시작하는 파일 |

### 4.3 병렬 검색 아키텍처

루트(`/`) 경로 검색 시 `parallelSearch`가 호출되며, home 디렉토리와 shared 디렉토리를 동시에 탐색한다.

```
parallelSearch
    |
    +-- [goroutine 1] searchInDirParallel(/data/users/{username}, "/home", ...)
    +-- [goroutine 2] searchInDirParallel(/data/shared, "/shared", ...)
    |
    v
결과 병합 (최대 500개)
```

`searchInDirParallel` 내부에서도 하위 디렉토리를 병렬로 탐색한다.

```
searchInDirParallel(realPath)
    |
    +-- 1. 숨김 파일 필터링 (IsHiddenFile)
    +-- 2. 파일/디렉토리 분리
    +-- 3. 최상위 파일 순차 처리 (빠름)
    +-- 4. 하위 디렉토리 병렬 처리 (lop.ForEach)
    |     |
    |     +-- [goroutine] filepath.Walk(dir1) + matchFileName
    |     +-- [goroutine] filepath.Walk(dir2) + matchFileName
    |     +-- ...
    |
    +-- mutex 기반 결과 수집 (maxResults 도달 시 filepath.SkipAll)
```

**성능 제한 설정**

| 설정 | 값 | 설명 |
|------|----|------|
| `maxResults` | 500 | 내부 최대 수집 결과 수 (페이지네이션 전) |
| `limit` 최대값 | 100 | 클라이언트 요청 최대 페이지 크기 |
| 숨김 파일 | 제외 | dotfile 및 시스템 파일 검색 대상에서 제외 |

### 4.4 메타데이터 검색

`searchInMetadataFiltered` 메서드가 DB에서 태그/설명 기반 검색을 수행한다.

**matchType별 SQL 쿼리**

| matchType | SQL 조건 |
|-----------|----------|
| `tag` | `EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) AS tag WHERE LOWER(tag) LIKE '%' \|\| $2 \|\| '%')` |
| `description` | `LOWER(description) LIKE '%' \|\| $2 \|\| '%'` |
| `all` | 태그 OR 설명 중 하나라도 매칭 |

메타데이터 검색 결과는 파일 시스템에서 실제 파일 존재 여부를 확인(`os.Stat`)한 후에만 결과에 포함된다. 삭제된 파일의 메타데이터는 자동으로 제외된다.

### 4.5 검색 결과 매치 타입

| matchType | 설명 | 추가 필드 |
|-----------|------|-----------|
| `name` | 파일명 매칭 | - |
| `tag` | 태그 매칭 | `matchedTag`: 매칭된 태그명 |
| `description` | 설명 매칭 | `description`: 파일 설명 |
| `trash` | 휴지통 내 파일 | `inTrash`, `trashId`, `originalPath`, `deletedAt` |

### 4.6 결과 중복 제거

파일명 검색과 메타데이터 검색 결과를 병합할 때, 동일 경로의 중복 결과를 제거한다. 파일명 검색 결과가 우선 유지되며, 메타데이터 검색에서 동일 경로가 나온 경우 해당 결과는 추가하지 않는다.

---

## 5. 태그 시스템

### 5.1 태그 저장 구조

태그는 `file_metadata` 테이블의 `tags` 컬럼에 JSONB 배열로 저장된다.

```sql
-- 저장 형식 예시
tags = '["report", "2024", "quarterly"]'::jsonb
```

### 5.2 태그 CRUD 흐름

#### 태그 추가

```
[사용자: FileInfoPanel에서 태그 입력]
    |
    v
useFileMetadata.addTag(tag)
    |
    v
기존 태그 중복 확인 (클라이언트)
    |
    +-- 중복 → 입력 초기화, API 호출 없음
    |
    +-- 신규 → updateFileMetadata(path, { description, tags: [...existing, newTag] })
              |
              v
         PUT /api/file-metadata/{path}
              |
              v
         DB UPSERT → 응답 반환 → UI 업데이트
              |
              v
         allUserTags에 신규 태그 추가 (자동완성 목록 갱신)
```

#### 태그 삭제

```
[사용자: 태그 칩의 X 버튼 클릭]
    |
    v
useFileMetadata.removeTag(tagToRemove)
    |
    v
tags.filter(t => t !== tagToRemove)
    |
    v
updateFileMetadata(path, { description, tags: filteredTags })
    |
    v
PUT /api/file-metadata/{path} → DB 업데이트 → UI 업데이트
```

### 5.3 태그 정규화

- 태그는 추가 시 `trim().toLowerCase()`로 정규화된다 (프론트엔드)
- 동일 태그의 중복 추가를 클라이언트에서 방지한다
- DB에서는 JSONB 배열 전체를 교체하는 방식이므로 서버사이드 중복 제거는 클라이언트에 의존한다

### 5.4 태그 자동완성

```
[컴포넌트 마운트]
    |
    v
useFileMetadata 초기화 → getUserTags() → GET /api/file-metadata/tags
    |
    v
allUserTags 상태 저장
    |
    v
[사용자: 태그 입력 필드에 타이핑]
    |
    v
tagInput 변경 → useEffect 트리거
    |
    v
allUserTags 필터링:
  1. 입력값과 부분 일치 (대소문자 무시)
  2. 현재 파일에 이미 있는 태그 제외
  3. 최대 5개까지 표시
    |
    v
tagSuggestions 상태 업데이트 → 드롭다운 표시
```

### 5.5 태그 검색

태그로 검색하는 방식은 두 가지가 있다.

| 방식 | 엔드포인트 | 매칭 방식 | 용도 |
|------|-----------|-----------|------|
| 통합 검색 | `GET /api/files/search?matchType=tag` | LIKE (부분 일치) | SearchModal 전체 검색 |
| 전용 검색 | `GET /api/file-metadata/search?tag=xxx` | `?` 연산자 (정확 일치) | 태그 기반 파일 목록 |

---

## 6. 파일 설명 기능

### 6.1 설명 편집 흐름

```
[FileInfoPanel: "클릭하여 설명 추가" 또는 기존 설명 클릭]
    |
    v
editingDescription = true → textarea 표시 (autoFocus)
    |
    v
[사용자 입력]
    |
    +-- Enter (Shift 없이): 저장 실행
    +-- Escape: 편집 취소, 원래 값 복원
    +-- 포커스 해제 (onBlur):
    |     +-- 값 변경됨 → 저장 실행
    |     +-- 값 미변경 → 편집 모드 종료
    |
    v
saveDescription()
    |
    v
updateFileMetadata(path, { description: descriptionInput, tags: currentTags })
    |
    v
PUT /api/file-metadata/{path} → 성공 시 "설명이 저장되었습니다." 토스트
```

### 6.2 설명 저장 동작

설명 업데이트 시 태그도 함께 전송된다. 서버의 UPSERT 쿼리에서 `description`은 `COALESCE`를 사용하여 null 전달 시 기존 값을 유지한다.

```sql
INSERT INTO file_metadata (user_id, file_path, description, tags, updated_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (user_id, file_path) DO UPDATE SET
    description = COALESCE($3, file_metadata.description),
    tags = $4,
    updated_at = NOW()
RETURNING id, created_at, updated_at
```

### 6.3 공유 뷰에서의 제한

`isSpecialShareView`가 true인 경우 (다른 사용자의 공유 파일을 볼 때):
- 설명 편집 불가 (클릭 이벤트 바인딩 없음)
- 태그 추가/삭제 UI 숨김
- 읽기 전용으로 설명과 태그 표시

---

## 7. 프론트엔드 구현

### 7.1 컴포넌트 계층

```
FileList.tsx                              # 메인 컨테이너
  +-- SearchModal.tsx                     # 전체 검색 모달 (전체, 파일명, 설명, 태그 탭)
  +-- filelist/FileInfoPanel.tsx          # 파일 상세 패널 (설명/태그 편집)
  |     +-- 설명 영역 (textarea / 읽기전용 텍스트)
  |     +-- 태그 영역 (tag-chip 목록 + 태그 입력 + 자동완성 드롭다운)
  +-- (useLocalSearch에 의한 인라인 검색 바)
```

### 7.2 커스텀 훅

#### useLocalSearch

현재 디렉토리 내 파일명 기반 서버사이드 검색을 수행하는 훅이다.

```typescript
interface UseLocalSearchOptions {
  currentPath: string        // 검색 범위 경로
  debounceMs?: number        // 디바운스 지연 (기본 300ms)
  limit?: number             // 결과 수 제한 (기본 100)
  disabled?: boolean         // 검색 비활성화 여부
}

interface UseLocalSearchReturn {
  query: string              // 현재 검색어
  results: FileInfo[]        // 검색 결과
  isSearching: boolean       // 검색 진행 중 여부
  showSearch: boolean        // 검색 UI 표시 여부
  inputRef: RefObject<HTMLInputElement>
  setQuery: (query: string) => void
  openSearch: () => void
  closeSearch: () => void
  clearSearch: () => void
}
```

**주요 동작**:
- `Ctrl+F` / `Cmd+F` 단축키로 검색 UI 열기
- `Escape`로 검색 UI 닫기 및 초기화
- 경로 변경 시 자동으로 검색 상태 초기화
- `matchType: 'name'`으로 고정하여 파일명만 검색
- 서버 API(`searchFiles`) 호출 시 현재 `currentPath`를 전달하여 범위 제한

#### useFileMetadata

선택된 파일의 메타데이터(설명, 태그)를 관리하는 훅이다.

```typescript
interface UseFileMetadataOptions {
  selectedFile: FileInfo | null   // 선택된 파일
  onSuccess?: (message: string) => void
  onError?: (message: string) => void
}

interface UseFileMetadataReturn {
  metadata: FileMetadata | null
  isLoading: boolean
  // 설명 편집
  editingDescription: boolean
  descriptionInput: string
  setEditingDescription: (editing: boolean) => void
  setDescriptionInput: (value: string) => void
  saveDescription: () => Promise<void>
  // 태그 관리
  tagInput: string
  setTagInput: (value: string) => void
  tagSuggestions: string[]      // 필터링된 자동완성 제안 (최대 5개)
  allUserTags: string[]         // 전체 사용자 태그 목록
  addTag: (tag: string) => Promise<void>
  removeTag: (tag: string) => Promise<void>
}
```

**주요 동작**:
- `selectedFile` 변경 시 `getFileMetadata` API 호출
- 컴포넌트 마운트 시 `getUserTags`로 전체 태그 목록 1회 로드
- 태그 입력 시 `allUserTags`에서 실시간 필터링하여 자동완성 제안
- 태그 추가 시 `allUserTags`에도 즉시 반영 (재조회 없이)

### 7.3 SearchModal 컴포넌트

전체 검색을 위한 모달 컴포넌트이다.

```typescript
interface SearchModalProps {
  isOpen: boolean
  onClose: () => void
  initialQuery: string
  onNavigate?: (path: string) => void       // 폴더 이동
  onFileSelect?: (filePath: string, parentPath: string) => void  // 파일 선택
}
```

**탭 구성**

| 탭 | key | 설명 |
|----|-----|------|
| 전체 | `all` | 파일명 + 태그 + 설명 통합 검색 |
| 파일명 | `name` | 파일명만 검색 |
| 설명 | `description` | 파일 설명만 검색 |
| 태그 | `tag` | 태그만 검색 |

**무한 스크롤 구현**

```typescript
// IntersectionObserver로 스크롤 감지
const observer = new IntersectionObserver(
  entries => {
    if (entries[0].isIntersecting && hasMore && !isLoading) {
      loadMore()  // 다음 페이지 로드
    }
  },
  { threshold: 0.1 }
)
```

- 초기 로드: page=1, limit=20
- 추가 로드: page 증가, 기존 결과에 append
- 모든 결과 로드 완료 시 "총 N개의 검색 결과" 메시지 표시

**결과 항목 표시 정보**

| 요소 | 표시 조건 | 설명 |
|------|-----------|------|
| 파일/폴더 아이콘 | 항상 | `isDir` 기반 아이콘 분기 |
| 파일명 | 항상 | `.search-item-name` |
| 매치 타입 배지 | `matchType !== 'name'` | 태그: `#태그명`, 설명: `설명` |
| 경로 | 항상 | 전체 가상 경로 |
| 파일 설명 | `matchType === 'description'` | 이탤릭체 표시 |
| 태그 목록 | `matchType === 'tag'` | 최대 5개 태그 칩 표시 |
| 파일 크기 | 파일인 경우 | `formatFileSize` |
| 수정일 | 항상 | 한국어 날짜 포맷 |

**결과 클릭 동작**

| 결과 유형 | 동작 |
|-----------|------|
| 폴더 | `onNavigate(file.path)` - 해당 폴더로 이동 |
| 파일 (onFileSelect 제공) | `onFileSelect(file.path, parentPath)` |
| 파일 (onFileSelect 미제공) | `onNavigate(parentPath)` - 부모 폴더로 이동 |

### 7.4 FileInfoPanel 메타데이터 섹션

파일 상세 정보 패널 내 메타데이터 영역의 UI 구조이다.

```
[details-metadata]
    |
    +-- [metadata-row: 설명]
    |     +-- metadata-label: "설명"
    |     +-- (편집 모드) textarea.description-input
    |     +-- (읽기 모드) metadata-value.clickable.editable
    |           +-- 설명 텍스트 또는 "클릭하여 설명 추가" placeholder
    |
    +-- [metadata-row: 태그]
          +-- metadata-label: "태그"
          +-- [tags-inline]
                +-- tag-chip (#태그명 + X 버튼) * N개
                +-- [tag-add-inline]
                      +-- input.tag-add-input (placeholder: "+ 태그")
                      +-- [tag-dropdown] (자동완성 제안 목록)
                            +-- button (#태그명) * 최대 5개
```

---

## 8. 캐싱 전략

### 8.1 서버사이드

현재 서버사이드에서는 검색 결과에 대한 별도 캐싱을 수행하지 않는다. 모든 검색 요청은 파일 시스템 탐색과 DB 쿼리를 실시간으로 수행한다.

**성능 최적화 요소**:
- 병렬 디렉토리 탐색 (`lop.ForEach`, `lop.Map`)
- `maxResults` 제한 (500개)으로 조기 종료 (`filepath.SkipAll`)
- 숨김 디렉토리 진입 시 `filepath.SkipDir`로 전체 하위 트리 스킵
- PostgreSQL GIN 인덱스를 통한 JSONB 태그 검색 최적화

### 8.2 프론트엔드

| 항목 | 캐싱 방식 | 갱신 시점 |
|------|-----------|-----------|
| 사용자 태그 목록 (`allUserTags`) | `useFileMetadata` 훅 내 `useState` | 컴포넌트 마운트 시 1회 로드, 태그 추가 시 로컬 갱신 |
| 파일 메타데이터 | `useFileMetadata` 훅 내 `useState` | `selectedFile` 변경 시 재조회 |
| 검색 결과 | SearchModal 내 `useState` | 검색어/탭 변경 시 재조회, 모달 닫기 시 초기화 |
| 로컬 검색 결과 | `useLocalSearch` 내 `useState` | 경로 변경 시 초기화, 검색어 변경 시 디바운스 후 재조회 |

프론트엔드 검색은 React Query를 사용하지 않고 `useState`와 직접 API 호출로 구현되어 있다. 따라서 검색 결과의 자동 캐싱이나 stale-while-revalidate 패턴은 적용되지 않는다.

---

## 9. 데이터 모델

### 9.1 DB 테이블: file_metadata

```sql
CREATE TABLE IF NOT EXISTS file_metadata (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path   VARCHAR(1024) NOT NULL,
    description TEXT,
    tags        JSONB DEFAULT '[]',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, file_path)
);

COMMENT ON TABLE file_metadata IS 'File descriptions and tags for organization';
```

**컬럼 상세**

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|----------|------|
| `id` | BIGSERIAL | PK | 자동 증가 ID |
| `user_id` | UUID | FK → users(id), ON DELETE CASCADE, NOT NULL | 소유 사용자 |
| `file_path` | VARCHAR(1024) | NOT NULL, UNIQUE(user_id와 복합) | 가상 파일 경로 (예: `/home/documents/report.pdf`) |
| `description` | TEXT | nullable | 파일 설명 |
| `tags` | JSONB | DEFAULT '[]' | 태그 배열 (예: `["report", "2024"]`) |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | 메타데이터 생성 시각 |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | 메타데이터 최종 수정 시각 |

**복합 유니크 제약**: `UNIQUE(user_id, file_path)` - 동일 사용자의 동일 파일에 대해 하나의 메타데이터 레코드만 존재한다.

### 9.2 인덱스

```sql
CREATE INDEX IF NOT EXISTS idx_file_metadata_user ON file_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_path ON file_metadata(file_path);
CREATE INDEX IF NOT EXISTS idx_file_metadata_tags ON file_metadata USING GIN(tags);
```

| 인덱스 | 타입 | 대상 컬럼 | 용도 |
|--------|------|-----------|------|
| `idx_file_metadata_user` | B-Tree | `user_id` | 사용자별 메타데이터 조회 |
| `idx_file_metadata_path` | B-Tree | `file_path` | 경로별 메타데이터 조회 |
| `idx_file_metadata_tags` | GIN | `tags` (JSONB) | 태그 검색 (`?` 연산자, `jsonb_array_elements_text`) |

### 9.3 TypeScript 타입 정의

```typescript
// 검색 관련 타입 (ui/src/api/files.ts)

export interface FileInfo {
  name: string
  path: string
  size: number
  isDir: boolean
  modTime: string
  extension?: string
  mimeType?: string
  // 검색 결과 전용 필드
  matchType?: 'name' | 'tag' | 'description' | 'trash'
  matchedTag?: string
  description?: string
  tags?: string[]
  // 휴지통 관련 필드
  inTrash?: boolean
  trashId?: string
  originalPath?: string
  deletedAt?: string
}

export type MatchType = 'all' | 'name' | 'tag' | 'description'

export interface SearchResponse {
  query: string
  results: FileInfo[]
  total: number
  page: number
  limit: number
  hasMore: boolean
  matchType?: MatchType
}

export interface SearchOptions {
  path?: string
  page?: number
  limit?: number
  matchType?: MatchType
}

export interface FileMetadata {
  id?: number
  filePath: string
  description: string
  tags: string[]
  createdAt?: string
  updatedAt?: string
}
```

### 9.4 Go 구조체

```go
// 검색 결과 (api/handlers/search.go)
type SearchResult struct {
    Name         string     `json:"name"`
    Path         string     `json:"path"`
    Size         int64      `json:"size"`
    IsDir        bool       `json:"isDir"`
    ModTime      time.Time  `json:"modTime"`
    Extension    string     `json:"extension,omitempty"`
    MimeType     string     `json:"mimeType,omitempty"`
    MatchType    string     `json:"matchType,omitempty"`
    MatchedTag   string     `json:"matchedTag,omitempty"`
    Description  string     `json:"description,omitempty"`
    Tags         []string   `json:"tags,omitempty"`
    InTrash      bool       `json:"inTrash,omitempty"`
    TrashID      string     `json:"trashId,omitempty"`
    OriginalPath string     `json:"originalPath,omitempty"`
    DeletedAt    *time.Time `json:"deletedAt,omitempty"`
}

type SearchResponse struct {
    Query     string         `json:"query"`
    Results   []SearchResult `json:"results"`
    Total     int            `json:"total"`
    Page      int            `json:"page"`
    Limit     int            `json:"limit"`
    HasMore   bool           `json:"hasMore"`
    MatchType string         `json:"matchType,omitempty"`
}

// 파일 메타데이터 (api/handlers/file_metadata.go)
type FileMetadata struct {
    ID          int64     `json:"id"`
    FilePath    string    `json:"filePath"`
    Description string    `json:"description"`
    Tags        []string  `json:"tags"`
    CreatedAt   time.Time `json:"createdAt"`
    UpdatedAt   time.Time `json:"updatedAt"`
}

type UpdateFileMetadataRequest struct {
    Description *string  `json:"description,omitempty"`
    Tags        []string `json:"tags,omitempty"`
}
```

---

## 10. 관련 파일 참조

### 백엔드

| 파일 경로 | 설명 |
|-----------|------|
| `api/handlers/search.go` | 통합 검색 핸들러 (SearchFiles, parallelSearch, searchInDirParallel, searchInMetadataFiltered) |
| `api/handlers/file_metadata.go` | 메타데이터 CRUD 핸들러 (FileMetadataHandler) |
| `api/handlers/handler.go` | getMimeType 헬퍼 함수 |
| `api/handlers/hidden_files.go` | IsHiddenFile 헬퍼 함수 |
| `api/main.go` | 라우트 등록 (line 339, 517-522) |
| `db/init.sql` | file_metadata 테이블 DDL (line 147-156) |
| `db/migrations/001_initial_schema.sql` | file_metadata 마이그레이션 (line 116-125) |

### 프론트엔드

| 파일 경로 | 설명 |
|-----------|------|
| `ui/src/api/files.ts` | API 함수 (searchFiles, getFileMetadata, updateFileMetadata, getUserTags, searchByTag) |
| `ui/src/hooks/useLocalSearch.ts` | 인라인 검색 훅 (디바운싱, Ctrl+F 단축키) |
| `ui/src/hooks/useFileMetadata.ts` | 메타데이터 관리 훅 (설명 편집, 태그 CRUD, 자동완성) |
| `ui/src/components/SearchModal.tsx` | 검색 모달 컴포넌트 (탭, 무한 스크롤, 결과 표시) |
| `ui/src/components/SearchModal.css` | 검색 모달 스타일 (반응형, 모바일 바텀시트) |
| `ui/src/components/filelist/FileInfoPanel.tsx` | 파일 정보 패널 (메타데이터 표시/편집 UI) |
| `ui/src/components/FileList.tsx` | 메인 컨테이너 (useFileMetadata 훅 사용, line 498-516) |
