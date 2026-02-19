# 휴지통 (Trash/Recycle Bin) 시스템 명세

## 1. 시스템 개요

파일/폴더의 안전한 삭제를 위한 소프트 삭제(soft delete) 기반 휴지통 시스템이다.
사용자가 삭제한 항목은 즉시 영구 삭제되지 않고 휴지통에 보관되며,
복원 또는 영구 삭제를 선택할 수 있다. 관리자가 설정한 보존 기간이 경과하면
백그라운드 작업에 의해 자동으로 영구 삭제된다.

### 핵심 특성

| 특성 | 설명 |
|------|------|
| 소프트 삭제 | 파일을 즉시 삭제하지 않고 `trash/` 디렉토리로 이동 |
| 메타데이터 기반 추적 | JSON 파일(`.trash_meta.json`)로 삭제 정보 관리 (DB 미사용) |
| SMB 연동 | Samba `vfs_recycle` 모듈로 삭제된 파일도 웹 UI에서 복원 가능 |
| 외부 스토리지 지원 | 외부 마운트(S3, WebDAV 등)의 파일도 휴지통으로 이동 가능 |
| 자동 정리 | 24시간 주기 백그라운드 작업으로 보존 기간 경과 항목 자동 삭제 |
| WebDAV 통합 | WebDAV DELETE 요청도 영구 삭제가 아닌 휴지통 이동으로 처리 |
| 스토리지 추적 | `users.trash_used` 컬럼으로 휴지통 사용량 실시간 추적 |

---

## 2. 아키텍처

### 2.1 파일 시스템 구조

```
/data/
  trash/
    {username}/                    # 사용자별 휴지통 디렉토리
      .trash_meta.json             # 휴지통 메타데이터 (JSON)
      {timestamp}_{filename}       # 실제 삭제된 파일/폴더
      {timestamp}_{filename2}      # ...
      .smb/                        # SMB(Samba)에서 삭제된 파일
        path/to/original/file.txt  # 원본 경로 구조 유지
```

### 2.2 휴지통 ID 체계

| 유형 | ID 형식 | 예시 |
|------|---------|------|
| 웹/WebDAV 삭제 | `{UnixNano}_{filename}` | `1708300800000000000_document.pdf` |
| SMB 삭제 | `smb_{ModTimeNano}_{relPath}` | `smb_1708300800000000000_docs_report.txt` |

- ID는 메타데이터 맵의 키이자, 휴지통 디렉토리 내 파일/폴더명으로 사용된다
- UnixNano 타임스탬프를 접두사로 사용하여 고유성 보장

### 2.3 핸들러 구조

```go
// Handler 구조체에 포함 (DI 패턴)
type Handler struct {
    db           *sql.DB
    dataRoot     string      // /data (휴지통 루트: /data/trash/)
    auditHandler *AuditHandler
    // ... 기타 의존성
}
```

주요 내부 함수:

| 함수 | 역할 |
|------|------|
| `getTrashPath(username)` | 사용자 휴지통 디렉토리 경로 반환 (`/data/trash/{username}`) |
| `getTrashMetaPath(username)` | 메타데이터 파일 경로 반환 (`/data/trash/{username}/.trash_meta.json`) |
| `loadTrashMeta(username)` | 메타데이터 JSON 파일 로드 → `map[string]TrashItem` |
| `saveTrashMeta(username, items)` | 메타데이터 JSON 파일 저장 |
| `syncSMBTrash(username)` | SMB 삭제 파일을 메타데이터에 동기화 |
| `moveOrCopy(src, dst)` | 파일 이동 (cross-device 시 copy+delete 폴백) |

---

## 3. 데이터 모델

### 3.1 TrashItem 구조체 (Go)

```go
type TrashItem struct {
    ID           string    `json:"id"`                       // 고유 ID (타임스탬프_파일명)
    Name         string    `json:"name"`                     // 원본 파일/폴더명
    OriginalPath string    `json:"originalPath"`             // 원본 가상 경로 (예: /home/docs/file.txt)
    Size         int64     `json:"size"`                     // 파일 크기 (바이트, 폴더는 재귀 합산)
    IsDir        bool      `json:"isDir"`                    // 폴더 여부
    DeletedAt    time.Time `json:"deletedAt"`                // 삭제 시간
    StorageType  string    `json:"storageType,omitempty"`    // "home", "shared", "external"
    MountID      string    `json:"mountId,omitempty"`        // 외부 스토리지 ID (복원 시 필요)
}
```

### 3.2 TrashItem 인터페이스 (TypeScript)

```typescript
export interface TrashItem {
  id: string
  name: string
  originalPath: string
  size: number
  isDir: boolean
  deletedAt: string    // ISO 8601 형식
}
```

### 3.3 요청 DTO

```go
// 배치 휴지통 이동 요청
type BatchMoveToTrashRequest struct {
    Paths []string `json:"paths"`    // 삭제할 가상 경로 배열
}

// 배치 복원/삭제 요청
type BatchTrashRequest struct {
    IDs []string `json:"ids"`        // 휴지통 항목 ID 배열
}

// 배치 이동 결과 (항목별)
type BatchMoveToTrashResult struct {
    Path  string `json:"path"`
    Error string `json:"error,omitempty"`
}
```

### 3.4 DB 스키마 (저장 공간 추적)

```sql
-- users 테이블의 휴지통 관련 컬럼
CREATE TABLE IF NOT EXISTS users (
    -- ... 기타 컬럼
    storage_used  BIGINT DEFAULT 0,     -- 홈 스토리지 사용량
    trash_used    BIGINT DEFAULT 0,     -- 휴지통 사용량
    storage_quota BIGINT DEFAULT 0,     -- 저장 공간 할당량
    -- ...
);

-- system_settings 테이블의 휴지통 설정
INSERT INTO system_settings (key, value, description) VALUES
    ('trash_retention_days', '30', '휴지통 자동 삭제 일수 (기본: 30일)');
```

### 3.5 메타데이터 파일 형식 (`.trash_meta.json`)

```json
{
  "1708300800000000000_document.pdf": {
    "id": "1708300800000000000_document.pdf",
    "name": "document.pdf",
    "originalPath": "/home/documents/document.pdf",
    "size": 1048576,
    "isDir": false,
    "deletedAt": "2024-02-19T00:00:00Z",
    "storageType": "home"
  },
  "smb_1708300800000000000_photos_vacation.jpg": {
    "id": "smb_1708300800000000000_photos_vacation.jpg",
    "name": "vacation.jpg",
    "originalPath": "/home/photos/vacation.jpg",
    "size": 2097152,
    "isDir": false,
    "deletedAt": "2024-02-19T00:00:00Z"
  }
}
```

---

## 4. API 엔드포인트

모든 엔드포인트는 JWT 인증이 필요하며, `OptionalJWTMiddleware`가 적용된다.

### 4.1 휴지통 이동 (소프트 삭제)

#### 단일 항목

| 항목 | 값 |
|------|---|
| Method | `POST` |
| Path | `/api/trash/{path}` |
| Description | 파일 또는 폴더를 휴지통으로 이동 (소프트 삭제) |

**요청**: URL 경로에 삭제할 파일의 가상 경로를 포함

**응답 (200)**:
```json
{
  "success": true,
  "path": "/home/documents/report.pdf",
  "trashId": "1708300800000000000_report.pdf"
}
```

#### 배치 (일괄)

| 항목 | 값 |
|------|---|
| Method | `POST` |
| Path | `/api/trash/batch` |
| Description | 여러 파일/폴더를 한번에 휴지통으로 이동 |

**요청 바디**:
```json
{
  "paths": ["/home/docs/file1.txt", "/home/docs/file2.txt"]
}
```

**응답 (200)**:
```json
{
  "success": ["/home/docs/file1.txt", "/home/docs/file2.txt"],
  "failed": [
    { "path": "/home/docs/locked.txt", "error": "File is locked" }
  ]
}
```

### 4.2 휴지통 목록 조회

| 항목 | 값 |
|------|---|
| Method | `GET` |
| Path | `/api/trash` |
| Description | 사용자 휴지통의 모든 항목 조회 (최신 삭제순 정렬) |

**응답 (200)**:
```json
{
  "items": [
    {
      "id": "1708300800000000000_report.pdf",
      "name": "report.pdf",
      "originalPath": "/home/documents/report.pdf",
      "size": 1048576,
      "isDir": false,
      "deletedAt": "2024-02-19T00:00:00Z",
      "storageType": "home"
    }
  ],
  "total": 1,
  "totalSize": 1048576
}
```

**동작 특이사항**: 목록 조회 시 `syncSMBTrash()`를 자동 호출하여 SMB에서 삭제된 파일도 포함한다.

### 4.3 복원

#### 단일 항목 복원

| 항목 | 값 |
|------|---|
| Method | `POST` |
| Path | `/api/trash/restore/{id}` |
| Description | 휴지통 항목을 원본 위치로 복원 |

**응답 (200)**:
```json
{
  "success": true,
  "restoredPath": "/home/documents/report.pdf"
}
```

#### 배치 복원

| 항목 | 값 |
|------|---|
| Method | `POST` |
| Path | `/api/trash/restore/batch` |
| Description | 여러 항목을 한번에 복원 |

**요청 바디**:
```json
{
  "ids": ["1708300800000000000_file1.txt", "1708300800000000001_file2.txt"]
}
```

**응답 (200)**:
```json
{
  "success": true,
  "restored": ["1708300800000000000_file1.txt"],
  "failed": ["1708300800000000001_file2.txt"],
  "errors": ["1708300800000000001_file2.txt: not found"]
}
```

### 4.4 영구 삭제

#### 단일 항목

| 항목 | 값 |
|------|---|
| Method | `DELETE` |
| Path | `/api/trash/{id}` |
| Description | 휴지통 항목을 영구적으로 삭제 (복구 불가) |

**응답 (200)**:
```json
{
  "success": true
}
```

#### 배치 삭제

| 항목 | 값 |
|------|---|
| Method | `POST` |
| Path | `/api/trash/batch-delete` |
| Description | 여러 항목을 한번에 영구 삭제 |

**요청 바디**:
```json
{
  "ids": ["1708300800000000000_file1.txt", "1708300800000000001_file2.txt"]
}
```

**응답 (200)**:
```json
{
  "success": true,
  "deleted": ["1708300800000000000_file1.txt", "1708300800000000001_file2.txt"],
  "failed": []
}
```

### 4.5 휴지통 비우기

| 항목 | 값 |
|------|---|
| Method | `DELETE` |
| Path | `/api/trash` |
| Description | 휴지통의 모든 항목을 영구 삭제 |

**응답 (200)**:
```json
{
  "success": true,
  "deletedCount": 15
}
```

**동작**: 휴지통 디렉토리 전체를 `os.RemoveAll()` 후 재생성하며, `users.trash_used`를 0으로 초기화한다.

### 4.6 휴지통 통계

| 항목 | 값 |
|------|---|
| Method | `GET` |
| Path | `/api/trash/stats` |
| Description | 휴지통 사용 통계 조회 |

**응답 (200)**:
```json
{
  "itemCount": 25,
  "totalSize": 52428800,
  "retentionDays": 30,
  "oldestItem": "2024-01-15T10:30:00Z",
  "oldestItemDaysLeft": 5,
  "newestItem": "2024-02-18T14:00:00Z"
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `itemCount` | int | 휴지통 내 항목 수 |
| `totalSize` | int64 | 총 크기 (바이트) |
| `retentionDays` | int | 보존 기간 (일) |
| `oldestItem` | time | 가장 오래된 항목의 삭제 시간 |
| `oldestItemDaysLeft` | int | 가장 오래된 항목의 자동 삭제까지 남은 일수 |
| `newestItem` | time | 가장 최근 삭제된 항목의 시간 |

### 4.7 API 라우트 등록 순서

```go
// 배치 라우트가 와일드카드 라우트보다 먼저 등록되어야 한다
api.POST("/trash/batch", h.BatchMoveToTrash)
api.POST("/trash/restore/batch", h.BatchRestoreFromTrash)
api.POST("/trash/batch-delete", h.BatchDeleteFromTrash)
api.POST("/trash/*", h.MoveToTrash)              // 와일드카드: 나중에 등록
api.GET("/trash", h.ListTrash)
api.GET("/trash/stats", h.GetTrashStats)
api.POST("/trash/restore/:id", h.RestoreFromTrash)
api.DELETE("/trash/:id", h.DeleteFromTrash)
api.DELETE("/trash", h.EmptyTrash)
```

---

## 5. 삭제 흐름 (Soft Delete -> Trash -> Permanent Delete)

### 5.1 웹 UI / API 삭제

```
[사용자: 파일 삭제 요청]
    |
    v
POST /api/trash/{path}
    |
    v
[경로 해석] resolveStorageForOperation()
    |
    +-- "root" / "/home" / "/shared" → 403 Forbidden (루트 폴더 삭제 불가)
    |
    v
[권한 검증]
    +-- checkReadonly()         → 읽기 전용 스토리지 검사
    +-- CheckFileLockForOperation()  → 파일 잠금 검사
    +-- CheckFolderLocksForOperation() → 폴더 내 잠금 검사
    |
    v
[스토리지 유형 분기]
    |
    +-- 로컬 (home, shared, local-mount external)
    |     |
    |     +-- os.Stat() → 파일 정보 확인
    |     +-- moveOrCopy(realPath, trashItemPath)
    |           |
    |           +-- os.Rename() 시도
    |           +-- 실패 시 (cross-device: EXDEV) → copy + delete 폴백
    |
    +-- 비로컬 외부 스토리지 (S3, WebDAV 등)
          |
          +-- Backend.Stat() → 파일 정보 확인
          +-- downloadFileToLocal() / downloadDirToLocal() → 로컬 trash로 다운로드
          +-- Backend.DeleteAll() → 원본 삭제
    |
    v
[메타데이터 갱신]
    +-- loadTrashMeta() → meta 맵 로드
    +-- meta[trashID] = TrashItem{...} 추가
    +-- saveTrashMeta() → JSON 파일 저장
    |
    v
[후처리]
    +-- RemoveLockByPath() → 파일 잠금 해제
    +-- RemoveLocksUnderPath() → 폴더 내 잠금 해제 (폴더인 경우)
    +-- auditHandler.LogEvent(EventFileDelete, ...) → 감사 로그
    +-- UpdateStorageForMove(userID, size, toTrash=true) → 스토리지 추적 갱신
          +-- storage_used -= size (홈 감소)
          +-- trash_used += size (휴지통 증가)
```

### 5.2 서버사이드 배치 삭제 (전송 큐)

FileList에서 다중 파일 삭제 시, 전송 큐(`transfer_jobs.go`)를 통해 서버사이드에서
처리한다. `executeTransferDelete()` 함수가 개별 파일에 대해 위와 동일한 로직을 수행한다.

### 5.3 WebDAV 삭제

```
[WebDAV 클라이언트: DELETE 요청]
    |
    v
[webdav.go: RemoveAll()]
    |
    v
handler.MoveToTrashInternal(username, userID, virtualPath, realPath)
    |
    v
[동일한 휴지통 이동 로직]
    +-- os.Stat() → 파일 정보
    +-- os.Rename() → 휴지통으로 이동
    +-- 메타데이터 갱신
    +-- 스토리지 추적 갱신
    +-- 감사 로그 (source: "webdav")
```

### 5.4 SMB(Samba) 삭제

SMB 삭제는 Samba의 `vfs_recycle` 모듈이 자체적으로 처리하며, 웹 서버와 비동기적으로 동기화된다.

```
[SMB 클라이언트: 파일 삭제]
    |
    v
[Samba vfs_recycle 모듈]
    |
    v
파일을 /data/trash/{username}/.smb/{originalRelPath} 로 이동
    |
    v (비동기, ListTrash 호출 시)
syncSMBTrash(username) → .smb/ 디렉토리 순회 → 메타데이터에 미등록 파일 추가
```

---

## 6. 복원 기능

### 6.1 복원 흐름

```
[사용자: 복원 요청]
    |
    v
POST /api/trash/restore/{id}
    |
    v
[메타데이터 조회] loadTrashMeta() → meta[trashID]
    |
    v
[SMB 파일 여부 확인] strings.HasPrefix(trashID, "smb_")
    |
    +-- SMB 파일: trashItemPath = /data/trash/{user}/.smb/{relPath}
    +-- 일반 파일: trashItemPath = /data/trash/{user}/{trashID}
    |
    v
[스토리지 유형 분기]
    |
    +-- 외부 비로컬 (StorageExternal + MountID)
    |     +-- resolveStorageForOperation() → 원본 위치 해석
    |     +-- 읽기 전용 검사
    |     +-- uploadFileToBackend() / uploadDirToBackend() → 원격에 업로드
    |     +-- os.RemoveAll(trashItemPath) → 로컬 사본 삭제
    |
    +-- 외부 로컬 마운트 / 홈 / 공유
          +-- resolvePath() → 원본 실제 경로 확인
          +-- 충돌 검사 (os.Stat)
          |     +-- 존재 시: {filename}_restored_{timestamp}{ext} 접미사 추가
          +-- os.MkdirAll(parentDir) → 부모 디렉토리 생성
          +-- moveOrCopy(trashItemPath, realPath) → 복원
    |
    v
[후처리]
    +-- SMB 파일: cleanupEmptySMBDirs() → .smb/ 하위 빈 디렉토리 정리
    +-- delete(meta, trashID) → 메타데이터에서 제거
    +-- saveTrashMeta() → 저장
    +-- auditHandler.LogEvent("trash.restore", ...) → 감사 로그
    +-- UpdateStorageForMove(userID, size, toTrash=false) → 스토리지 추적
          +-- storage_used += size (홈 증가)
          +-- trash_used -= size (휴지통 감소)
```

### 6.2 경로 충돌 해결

복원 시 원본 경로에 이미 파일이 존재하면 자동으로 접미사를 추가한다.

| 원본 경로 | 충돌 시 복원 경로 |
|-----------|------------------|
| `/home/docs/report.pdf` | `/home/docs/report_restored_1708300800.pdf` |
| `/home/photos/` | `/home/photos_restored_1708300800/` |

### 6.3 복원 후 네비게이션

프론트엔드에서 복원 성공 시 복원된 파일의 부모 디렉토리로 자동 이동한다.

```typescript
onSuccess: (result) => {
  const parentPath = result.restoredPath.split('/').slice(0, -1).join('/') || '/'
  onNavigate(parentPath)
}
```

---

## 7. 자동 정리 (Retention Policy)

### 7.1 설정

| 항목 | 기본값 | DB 키 |
|------|--------|-------|
| 보존 기간 | 30일 | `system_settings.trash_retention_days` |
| 정리 주기 | 24시간 | 하드코딩 (`TrashAutoCleanupConfig.CleanupPeriod`) |

### 7.2 구현 구조

```go
type TrashAutoCleanupConfig struct {
    RetentionDays int           // 보존 일수 (기본: 30)
    CleanupPeriod time.Duration // 정리 주기 (기본: 24시간)
}
```

### 7.3 자동 정리 흐름

```
[서버 시작]
    |
    v
StartTrashAutoCleanup(config) → goroutine 시작
    |
    v
[즉시 1회 실행] runTrashCleanup(retentionDays)
    |
    v
[24시간 주기 반복] ticker.C
    |
    v
runTrashCleanup(currentRetention)
    |
    v
[정리 로직]
    +-- cutoffTime = now - retentionDays
    +-- /data/trash/ 하위 사용자 디렉토리 순회
    +-- 각 사용자의 .trash_meta.json 로드
    +-- deletedAt < cutoffTime인 항목 필터링
    +-- os.RemoveAll(trashItemPath) → 파일 삭제
    +-- 메타데이터에서 제거 후 저장
    +-- 로그 출력: "[Trash] Auto-cleanup completed: deleted N items (X MB)"
```

### 7.4 설정값 동적 반영

정리 작업 실행 시마다 `GetGlobalSettingsHandler().GetTrashRetentionDays()`를 호출하여
관리자가 런타임에 변경한 보존 기간을 즉시 반영한다.

---

## 8. 배치 처리 (일괄 삭제/복원)

### 8.1 배치 휴지통 이동 (`BatchMoveToTrash`)

- 요청 경로: `POST /api/trash/batch`
- 각 경로에 대해 개별적으로 권한 검증, 잠금 검사, 이동 수행
- 하나의 항목이 실패해도 나머지 항목은 계속 처리 (부분 성공 허용)
- 각 항목마다 감사 로그 기록
- 스토리지 추적은 항목별 개별 갱신

### 8.2 배치 복원 (`BatchRestoreFromTrash`)

- 요청 경로: `POST /api/trash/restore/batch`
- 모든 항목 처리 후 메타데이터 1회 저장 (성능 최적화)
- 스토리지 추적은 전체 합산 후 1회 갱신
- `totalRestoredSize`와 `totalRestoredExternalSize`를 분리 추적

### 8.3 배치 영구 삭제 (`BatchDeleteFromTrash`)

- 요청 경로: `POST /api/trash/batch-delete`
- 모든 항목 처리 후 메타데이터 1회 저장
- `totalDeletedSize` 합산 후 `UpdateUserTrashStorage` 1회 호출

### 8.4 배치 처리 패턴

```
[배치 요청 수신]
    |
    v
메타데이터 로드 (1회)
    |
    v
for _, id := range req.IDs {
    +-- 항목 조회
    +-- 개별 처리 (성공 → restored/deleted 배열, 실패 → failed 배열)
    +-- meta에서 삭제
}
    |
    v
메타데이터 저장 (1회)
    |
    v
스토리지 추적 갱신 (합산 후 1회)
```

---

## 9. 스토리지 추적

### 9.1 추적 함수

```go
// 홈 <-> 휴지통 이동 시 양쪽 사용량 갱신
func (h *Handler) UpdateStorageForMove(userID string, fileSize int64, toTrash bool) error {
    if toTrash {
        // 홈 → 휴지통: storage_used -= size, trash_used += size
        h.UpdateUserStorage(userID, -fileSize)
        return h.UpdateUserTrashStorage(userID, fileSize)
    }
    // 휴지통 → 홈: storage_used += size, trash_used -= size
    h.UpdateUserStorage(userID, fileSize)
    return h.UpdateUserTrashStorage(userID, -fileSize)
}

// 영구 삭제 시 휴지통 사용량만 감소
func (h *Handler) UpdateUserTrashStorage(userID string, delta int64) error {
    // UPDATE users SET trash_used = GREATEST(0, COALESCE(trash_used, 0) + $1) WHERE id = $2
}
```

### 9.2 스토리지 흐름 요약

| 동작 | `storage_used` | `trash_used` |
|------|:---:|:---:|
| 휴지통 이동 | -size | +size |
| 복원 | +size | -size |
| 영구 삭제 | 변동 없음 | -size |
| 휴지통 비우기 | 변동 없음 | → 0 |

### 9.3 외부 스토리지 예외

외부 스토리지(`StorageExternal`)의 파일은 스토리지 추적에서 제외된다.
외부 스토리지의 파일을 휴지통으로 이동하면 로컬에 사본이 생기지만,
사용자의 `storage_used`/`trash_used`에는 반영하지 않는다.

---

## 10. SMB(Samba) 연동

### 10.1 Samba 설정 (`samba/smb.conf.template`)

```ini
# VFS modules: recycle (trash) + audit
vfs objects = recycle full_audit

# Recycle bin settings - integrates with web UI trash
recycle:repository = /data/trash/%U/.smb    # 사용자별 SMB 휴지통 경로
recycle:keeptree = yes                       # 원본 디렉토리 구조 유지
recycle:versions = yes                       # 버전 관리 (Copy #N of file.ext)
recycle:touch = yes                          # 삭제 시간을 mtime으로 기록
recycle:maxsize = 0                          # 크기 제한 없음
recycle:exclude = *.tmp, ~$*, .DS_Store, Thumbs.db   # 제외 파일
recycle:exclude_dir = .Trash, @eaDir         # 제외 디렉토리
```

### 10.2 동기화 흐름 (`syncSMBTrash`)

```
[ListTrash 호출 시]
    |
    v
syncSMBTrash(username)
    |
    v
/data/trash/{username}/.smb/ 디렉토리 존재 확인
    |
    v
filepath.Walk(.smb/) → 모든 파일 순회 (디렉토리는 건너뜀)
    |
    v
각 파일에 대해:
    +-- trashID = "smb_{modTimeNano}_{relPath에서 /를 _로 변환}"
    +-- 이미 메타데이터에 있는지 확인 (knownIDs, originalPath 중복 검사)
    +-- 없으면 메타데이터에 추가
    |     +-- Name: 원본 파일명 ("Copy #N of" 접두사 제거)
    |     +-- OriginalPath: "/home/{relPath}" (SMB 경로 → 가상 경로 변환)
    |     +-- Size: 파일 크기
    |     +-- DeletedAt: 파일의 mtime (recycle:touch=yes로 삭제 시간 반영)
    |
    v
변경 사항 있으면 메타데이터 저장
```

### 10.3 SMB 파일 복원 시 특이사항

- 복원 파일 경로: `/data/trash/{user}/.smb/{relPath}` (일반 파일과 다름)
- 복원 후 `cleanupEmptySMBDirs()` 호출하여 `.smb/` 하위 빈 디렉토리 정리
- 빈 디렉토리 정리는 복원 파일 위치에서 `.smb/` 루트까지 상향 순회

### 10.4 SMB 버전 관리

Samba `recycle:versions=yes`로 동일 파일명 삭제 시 "Copy #N of filename.ext" 형태로 저장된다.
`syncSMBTrash()`에서 이 접두사를 감지하여 원본 파일명을 추출한다:

```go
if strings.HasPrefix(fileName, "Copy #") {
    if idx := strings.Index(fileName, " of "); idx > 0 {
        originalName = fileName[idx+4:]
    }
}
```

---

## 11. 프론트엔드 구현

### 11.1 컴포넌트 구조

```
Trash.tsx                              # 메인 휴지통 컴포넌트
  +-- 헤더 (제목, 항목 수, 전체 크기, 비우기 버튼)
  +-- 검색/필터 툴바
  |     +-- 텍스트 검색 (이름, 경로)
  |     +-- 날짜 필터 (전체/오늘/7일/30일)
  |     +-- 유형 필터 (전체/파일/폴더)
  |     +-- 정렬 (최근 삭제/오래된순/이름/크기)
  +-- 항목 리스트
  |     +-- 아이콘 (파일/폴더)
  |     +-- 이름, 원본 경로, 삭제 시간
  |     +-- 크기
  |     +-- 복원/영구 삭제 버튼 (hover 시 표시)
  +-- 컨텍스트 메뉴 (우클릭)
  +-- 다중 선택 액션 바 (2개 이상 선택 시)
  +-- 확인 모달 (비우기, 단일 삭제, 배치 삭제)
```

### 11.2 상태 관리

```typescript
// 선택 상태
const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)

// 필터/검색 상태
const [searchQuery, setSearchQuery] = useState('')
const [dateFilter, setDateFilter] = useState<DateFilter>('all')
const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
const [sortOption, setSortOption] = useState<SortOption>('newest')

// 확인 모달 상태
const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)
const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false)

// 컨텍스트 메뉴 상태
const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
```

### 11.3 React Query 통합

| 쿼리/뮤테이션 | queryKey | 함수 |
|---------------|----------|------|
| 목록 조회 | `['trash']` | `listTrash()` |
| 통계 조회 | `['trash-stats']` | `getTrashStats()` |
| 단일 복원 | - | `restoreFromTrash(id)` |
| 단일 삭제 | - | `deleteFromTrash(id)` |
| 배치 복원 | - | `batchRestoreFromTrash(ids)` |
| 배치 삭제 | - | `batchDeleteFromTrash(ids)` |
| 비우기 | - | `emptyTrash()` |

**캐시 무효화 전략**: 모든 뮤테이션 성공 시 아래 쿼리를 무효화한다.

```typescript
queryClient.invalidateQueries({ queryKey: ['trash'] })
queryClient.invalidateQueries({ queryKey: ['trash-stats'] })
queryClient.invalidateQueries({ queryKey: ['storage-usage'] })
// 복원 시 추가:
queryClient.invalidateQueries({ queryKey: ['files'] })
```

### 11.4 선택 기능

| 동작 | 설명 |
|------|------|
| 클릭 | 해당 항목만 선택 |
| Ctrl+클릭 | 개별 토글 선택 |
| Shift+클릭 | 범위 선택 (마지막 선택 항목부터) |
| Ctrl+A | 필터링된 전체 항목 선택 |
| Escape | 선택 해제 또는 컨텍스트 메뉴 닫기 |
| Delete | 선택된 항목 영구 삭제 확인 모달 |
| 빈 영역 클릭 | 선택 해제 |

### 11.5 필터링 및 정렬

**클라이언트 사이드 필터링** (서버 요청 없이 useMemo로 처리):

```typescript
const filteredItems = useMemo(() => {
  let items = [...allItems]

  // 검색: 이름 또는 원본 경로에 포함
  if (searchQuery.trim()) {
    items = items.filter(item =>
      item.name.toLowerCase().includes(query) ||
      item.originalPath.toLowerCase().includes(query)
    )
  }

  // 날짜 필터: 오늘 / 최근 7일 / 최근 30일
  // 유형 필터: 파일만 / 폴더만
  // 정렬: 최근 삭제순 / 오래된순 / 이름순 / 크기순

  return items
}, [allItems, searchQuery, dateFilter, typeFilter, sortOption])
```

### 11.6 컨텍스트 메뉴

우클릭 시 나타나는 메뉴:

| 메뉴 항목 | 동작 |
|-----------|------|
| 복원 | 선택된 항목(들) 복원 (단일/배치 자동 분기) |
| 영구 삭제 | 선택된 항목(들) 영구 삭제 확인 모달 |

- 뷰포트 경계 감지: 메뉴가 화면 밖으로 넘어가지 않도록 위치 보정
- 다중 선택 시: "N개 복원", "N개 영구 삭제"로 표시
- 선택되지 않은 항목을 우클릭하면 해당 항목만 선택

### 11.7 다중 선택 액션 바

2개 이상 선택 시 화면 하단에 플로팅 바 표시:

```
┌──────────────────────────────────────────────┐
│ 3개 선택됨 │ [복원] [영구 삭제] [선택 해제] │
└──────────────────────────────────────────────┘
```

- `position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%)`
- 진입 애니메이션: `trashSlideUp` (0.2s ease, 아래에서 위로)

### 11.8 삭제 시간 표시

상대적 시간 표시:

| 경과 시간 | 표시 |
|-----------|------|
| < 1시간 | "N분 전" |
| < 24시간 | "N시간 전" |
| 1일 | "어제" |
| < 7일 | "N일 전" |
| 7일 이상 | "YYYY. M. D." (한국어 로케일) |

### 11.9 사이드바 연동

```typescript
// Sidebar.tsx
const { data: trashStats } = useQuery({
  queryKey: ['trash-stats'],
  queryFn: getTrashStats,
  refetchInterval: 30000,     // 30초마다 갱신
  enabled: !!token,
})
```

- 휴지통에 항목이 있으면 사이드바 아이콘에 점(dot) 표시 (`trash-dot` CSS)
- 스토리지 섹션에 휴지통 사용량 표시: "휴지통: {size}"
- 사이드바 순서에서 `trash` 섹션으로 관리 (사용자 환경설정으로 순서/숨김 가능)

---

## 12. 보안

### 12.1 접근 제어

| 검증 | 설명 |
|------|------|
| JWT 인증 | 모든 API에 JWT 토큰 필수 |
| 사용자 격리 | 각 사용자는 자신의 휴지통만 접근 가능 (`trash/{username}/`) |
| 루트 폴더 보호 | `/home`, `/shared` 등 루트 가상 폴더는 삭제 불가 |
| 파일 잠금 존중 | 다른 사용자가 잠근 파일은 삭제 불가 |
| 읽기 전용 검사 | 읽기 전용 스토리지의 파일은 삭제 불가 |

### 12.2 삭제 후 잠금 정리

```go
// 휴지통 이동 성공 후 잠금 자동 해제
_ = h.RemoveLockByPath(displayPath)
if isDir {
    _ = h.RemoveLocksUnderPath(displayPath)  // 폴더 내 모든 잠금 해제
}
```

### 12.3 감사 로그

| 이벤트 | 상수 | 기록 정보 |
|--------|------|-----------|
| 휴지통 이동 | `EventFileDelete` | isDir, size, trashId |
| 복원 | `"trash.restore"` | trashId |
| WebDAV 삭제 | `EventFileDelete` | isDir, size, trashId, source: "webdav" |

---

## 13. 관련 파일 참조

### 백엔드

| 파일 경로 | 설명 |
|-----------|------|
| `api/handlers/trash.go` | 휴지통 핸들러 (이동, 복원, 삭제, 자동 정리, SMB 동기화) |
| `api/handlers/storage.go` | 스토리지 추적 (`UpdateStorageForMove`, `UpdateUserTrashStorage`) |
| `api/handlers/transfer_jobs.go` | 서버사이드 배치 삭제 (`executeTransferDelete`) |
| `api/handlers/webdav.go` | WebDAV DELETE → `MoveToTrashInternal` 호출 |
| `api/handlers/settings.go` | `GetTrashRetentionDays()` 설정 조회 |
| `api/handlers/logger.go` | `TrashLogger` 구조체 (자동 정리 로깅) |
| `api/handlers/watcher.go` | 파일 감시에서 `.trash` 디렉토리 이벤트 무시 |
| `api/main.go` | 라우트 등록, `StartTrashAutoCleanup()` 호출 |
| `samba/smb.conf.template` | Samba vfs_recycle 설정 |

### 프론트엔드

| 파일 경로 | 설명 |
|-----------|------|
| `ui/src/components/Trash.tsx` | 메인 휴지통 UI 컴포넌트 |
| `ui/src/components/Trash.css` | 휴지통 스타일시트 |
| `ui/src/components/Sidebar.tsx` | 사이드바 휴지통 링크 및 통계 표시 |
| `ui/src/components/FileList.tsx` | 파일 목록에서 삭제 → trash 캐시 무효화 |
| `ui/src/api/files.ts` | 휴지통 API 함수 (`moveToTrash`, `listTrash`, `restoreFromTrash` 등) |
| `ui/src/stores/toastStore.ts` | 성공/실패 토스트 알림 |

### DB 스키마

| 파일 경로 | 설명 |
|-----------|------|
| `db/init.sql` | `users.trash_used` 컬럼, `system_settings.trash_retention_days` |
| `api/database/migrations/002_default_data.sql` | `trash_retention_days` 기본값 삽입 |
