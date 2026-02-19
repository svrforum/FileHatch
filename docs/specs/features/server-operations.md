# 서버 사이드 연산 & 아카이브 시스템 명세

## 1. 시스템 개요

파일 복사, 이동, 삭제, 압축/해제 등 대용량 파일 연산을 서버 사이드에서 처리하는 시스템이다.
클라이언트(브라우저) 세션에 의존하지 않고 서버에서 독립적으로 작업을 실행하며,
WebSocket과 SSE(Server-Sent Events)를 통해 실시간 진행률을 제공한다.

### 핵심 특성

| 특성 | 설명 |
|------|------|
| 서버 사이드 전송 큐 | 복사/이동/삭제 작업을 DB 기반 큐로 관리, 브라우저 닫아도 계속 실행 |
| SSE 스트리밍 | 복사/이동/압축 시 Server-Sent Events로 바이트 단위 실시간 진행률 전송 |
| WebSocket 진행률 | 서버 사이드 작업의 진행 상황을 WebSocket `transfer_progress` 이벤트로 브로드캐스트 |
| 취소 지원 | context.WithCancel 기반으로 실행 중인 작업을 즉시 중단 가능 |
| 충돌 해결 | 폴더 병합(merge), 덮어쓰기(overwrite), 건너뛰기(skip), 이름 변경(rename) 지원 |
| 외부 스토리지 호환 | 로컬, S3 등 StorageBackend 인터페이스를 통한 크로스 백엔드 연산 지원 |

### 두 가지 실행 모드

| 모드 | 사용 조건 | 진행률 전달 | 세션 독립성 |
|------|-----------|-------------|-------------|
| **SSE 스트리밍** | 단일 파일/폴더 복사/이동/압축 | SSE (text/event-stream) | 브라우저 탭 닫으면 연결 끊김 |
| **서버 사이드 큐** | 대용량 복사/이동/삭제 (프론트엔드에서 `addServerTransfer`/`addDeletion` 호출) | WebSocket `transfer_progress` | 브라우저 닫아도 서버에서 계속 실행 |

---

## 2. 서버 사이드 전송 큐

### 2.1 DB 스키마

```sql
-- api/database/migrations/007_transfer_jobs.sql
CREATE TABLE IF NOT EXISTS transfer_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,          -- 'copy', 'move', 'compress', 'delete'
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    source_path TEXT NOT NULL,
    destination_path TEXT,
    total_bytes BIGINT DEFAULT 0,
    copied_bytes BIGINT DEFAULT 0,
    total_files INT DEFAULT 0,
    copied_files INT DEFAULT 0,
    current_file TEXT,
    bytes_per_sec BIGINT DEFAULT 0,
    error_message TEXT,
    mode VARCHAR(20),                   -- 'merge', 'overwrite', 'rename'
    file_conflict VARCHAR(20),          -- 'overwrite', 'skip', 'rename'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- api/database/migrations/008_transfer_jobs_delete.sql
-- delete_paths: 삭제 대상 경로 목록 (JSONB)
ALTER TABLE transfer_jobs ADD COLUMN delete_paths JSONB;
```

### 2.2 작업 유형

| 타입 | 설명 | 필수 필드 |
|------|------|-----------|
| `copy` | 파일/폴더 복사 | `sourcePath`, `destinationPath` |
| `move` | 파일/폴더 이동 | `sourcePath`, `destinationPath` |
| `delete` | 일괄 삭제 (휴지통 이동) | `paths` (배열, 최대 10,000개) |

### 2.3 작업 생성 흐름

```
[프론트엔드: addServerTransfer / addDeletion 호출]
    |
    v
POST /api/transfers
    |
    v
DB에 transfer_jobs 레코드 삽입 (status: 'pending')
    |
    v
goroutine으로 executeTransferJob() 실행
    |
    v
status → 'running' 으로 업데이트
    |
    v
실제 작업 수행 (CopyWithProgress / executeTransferDelete)
    |
    v
WebSocket으로 진행률 브로드캐스트 (500ms 간격 DB 업데이트, 실시간 WebSocket 전송)
    |
    v
status → 'completed' | 'error' | 'cancelled'
```

### 2.4 TransferJob 데이터 구조

```go
// api/handlers/transfer_jobs.go
type TransferJob struct {
    ID              string     `json:"id"`
    UserID          string     `json:"userId"`
    Type            string     `json:"type"`            // copy, move, compress, delete
    Status          string     `json:"status"`          // pending, running, completed, error, cancelled
    SourcePath      string     `json:"sourcePath"`
    DestinationPath string     `json:"destinationPath"`
    TotalBytes      int64      `json:"totalBytes"`
    CopiedBytes     int64      `json:"copiedBytes"`
    TotalFiles      int        `json:"totalFiles"`
    CopiedFiles     int        `json:"copiedFiles"`
    CurrentFile     string     `json:"currentFile,omitempty"`
    BytesPerSec     int64      `json:"bytesPerSec"`
    ErrorMessage    string     `json:"errorMessage,omitempty"`
    Mode            string     `json:"mode,omitempty"`         // merge, overwrite
    FileConflict    string     `json:"fileConflict,omitempty"` // overwrite, skip, rename
    DeletePaths     []string   `json:"deletePaths,omitempty"`
    CreatedAt       time.Time  `json:"createdAt"`
    UpdatedAt       time.Time  `json:"updatedAt"`
    CompletedAt     *time.Time `json:"completedAt,omitempty"`
}
```

---

## 3. 작업 상태 관리

### 3.1 상태 전이 다이어그램

```
                    +-----------+
                    |  pending  |
                    +-----------+
                         |
                         v
                    +-----------+
             +----->|  running  |<-----+
             |      +-----------+      |
             |           |             |
             |      +----+----+        |
             |      |         |        |
             v      v         v        |
       +-----------+ +---------+ +----------+
       | completed | |  error  | | cancelled|
       +-----------+ +---------+ +----------+
```

### 3.2 상태별 설명

| 상태 | 설명 | 전이 조건 |
|------|------|-----------|
| `pending` | 큐에 등록됨, 실행 대기 중 | 작업 생성 직후 |
| `running` | 실행 중, 진행률 갱신 중 | goroutine이 작업 시작 |
| `completed` | 성공적으로 완료 | 모든 파일 처리 완료 |
| `error` | 오류 발생, error_message에 원인 기록 | 파일 접근 실패, 디스크 부족 등 |
| `cancelled` | 사용자가 취소 | context.Cancel 호출 |

### 3.3 취소 메커니즘

```go
// api/handlers/transfer_jobs.go
var transferCancelMap sync.Map // jobID -> context.CancelFunc

// 작업 시작 시
ctx, cancel := context.WithCancel(context.Background())
transferCancelMap.Store(jobID, cancel)

// 취소 요청 시
if cancelFn, ok := transferCancelMap.Load(jobID); ok {
    cancelFn.(context.CancelFunc)()
}

// CopyContext에서 취소 확인
if ctx.Ctx != nil {
    if err := ctx.Ctx.Err(); err != nil {
        return err  // context.Canceled
    }
}
```

취소 시 동작:
- `context.Cancel()` 호출로 실행 중인 goroutine에 취소 신호 전달
- DB 상태를 `cancelled`로 업데이트, `completed_at` 기록
- WebSocket으로 `status: "cancelled"` 이벤트 브로드캐스트
- 프론트엔드에서는 `cancelServerJob(id)` API 호출 -> `DELETE /api/transfers/:id`

### 3.4 진행률 브로드캐스트

```go
// WebSocket을 통한 실시간 진행률 전송
BroadcastTransferProgress(userID, TransferProgressEvent{
    Type:        "transfer_progress",
    JobID:       jobID,
    Status:      "running",
    Progress:    progressPercent,  // 0-100
    TotalFiles:  progress.TotalFiles,
    CopiedFiles: progress.CopiedFiles,
    TotalBytes:  progress.TotalBytes,
    CopiedBytes: progress.CopiedBytes,
    CurrentFile: progress.CurrentFile,
    BytesPerSec: progress.BytesPerSec,
})
```

| 전송 방식 | 간격 | 대상 |
|-----------|------|------|
| WebSocket 브로드캐스트 | 매 진행 이벤트마다 | 해당 사용자의 모든 연결 |
| DB 업데이트 | 500ms 마다 또는 완료/에러 시 | `transfer_jobs` 테이블 |

### 3.5 자동 정리

```go
// api/handlers/transfer_jobs.go
func (h *Handler) StartTransferJobCleanup() {
    // 1시간 간격으로 실행
    // 완료/에러/취소된 작업 중 24시간 경과한 레코드 삭제
    DELETE FROM transfer_jobs
    WHERE status IN ('completed', 'error', 'cancelled')
    AND completed_at < NOW() - INTERVAL '24 hours'
}
```

---

## 4. 동시 실행 제한

### 4.1 프론트엔드 순차 실행

```typescript
// ui/src/stores/transferStore.ts
startTransfers: () => {
    const pendingItems = items.filter(item => item.status === 'pending')
    // 100ms 간격으로 순차 실행
    pendingItems.forEach((item, index) => {
        setTimeout(() => {
            get().executeTransfer(item.id)
        }, index * 100)
    })
}
```

- SSE 기반 복사/이동은 프론트엔드에서 순차 실행 (100ms 딜레이)
- 서버 사이드 작업은 각각 독립 goroutine으로 실행
- 압축 작업은 `addCompression` 호출 시 100ms 후 자동 실행

### 4.2 서버 사이드 동시 실행

- 서버 사이드 전송 큐는 별도의 동시 실행 제한이 없음
- 각 작업은 독립 goroutine으로 실행
- 삭제 작업 시 연속 3회 실패하면 자동 중단 (프론트엔드 클라이언트사이드 삭제)
- 삭제 경로 배열 최대 10,000개 제한

### 4.3 조회 범위 제한

```sql
-- 활성(pending/running) + 최근 1시간 이내 완료된 작업만 조회
WHERE user_id = $1
  AND (status IN ('pending', 'running')
       OR completed_at > NOW() - INTERVAL '1 hour')
ORDER BY created_at DESC
LIMIT 50
```

---

## 5. 배치 파일 연산

### 5.1 일괄 복사/이동

프론트엔드에서 다중 파일 선택 후 `Ctrl+C` / `Ctrl+X` → `Ctrl+V` 시:

```
[FileList: 다중 선택 + Ctrl+V]
    |
    v
useClipboard.paste() → 선택된 항목별로
    |
    v
transferStore.addServerTransfer(type, sourcePath, sourceName, destination)
    |
    v
POST /api/transfers (각 항목별 서버 사이드 작업 생성)
    |
    v
서버에서 goroutine으로 실행 → WebSocket 진행률
```

#### 충돌 해결 모드

| 모드 | `mode` | `fileConflict` | 동작 |
|------|--------|----------------|------|
| 기본 | (없음) | (없음) | 이름 변경으로 중복 회피 (`file (1).txt`) |
| 병합 | `merge` | `rename` | 폴더 내용을 병합, 파일 충돌 시 이름 변경 |
| 병합+덮어쓰기 | `merge` | `overwrite` | 폴더 병합, 파일 충돌 시 덮어쓰기 |
| 병합+건너뛰기 | `merge` | `skip` | 폴더 병합, 파일 충돌 시 건너뛰기 |
| 덮어쓰기 | (없음) | (없음) | `overwrite=true`, 기존 항목 완전 교체 |

#### 안전한 덮어쓰기 (SafeOverwrite)

```go
// api/handlers/operations_helpers.go
func SafeOverwrite(destPath string, isDir bool, operation func() error) error {
    // 1. 기존 파일을 .filehatch-overwrite-backup으로 임시 이름 변경
    backupPath := destPath + ".filehatch-overwrite-backup"
    os.Rename(destPath, backupPath)

    // 2. 실제 작업 수행
    if err := operation(); err != nil {
        // 3a. 실패 시: 백업에서 복원
        os.Rename(backupPath, destPath)
        return err
    }

    // 3b. 성공 시: 백업 삭제
    os.RemoveAll(backupPath)
    return nil
}
```

#### 폴더 병합 (CopyDirWithMerge)

```go
// api/handlers/operations_helpers.go
func (ctx *CopyContext) CopyDirWithMerge(src, dst, fileConflict string) error {
    // 대상 폴더가 없으면 일반 복사
    // 대상 폴더가 있으면 항목별로:
    //   - 하위 폴더: 재귀적 병합
    //   - 파일 충돌 시:
    //     - "overwrite": SafeOverwrite로 교체
    //     - "skip": 건너뛰기 (copiedFiles만 증가)
    //     - "rename": GenerateUniquePath로 고유 이름 생성 후 복사
}
```

### 5.2 일괄 삭제

```
[FileList: 다중 선택 + Delete 키]
    |
    v
transferStore.addDeletion(paths, names)
    |
    v
POST /api/transfers { type: "delete", paths: [...] }
    |
    v
서버: executeTransferDelete()
    |
    v
각 경로에 대해:
  1. resolveStorageForOperation()으로 경로 해석
  2. 읽기 전용/잠금 확인
  3. 휴지통 디렉토리 생성
  4. 파일/폴더를 .trash/로 이동
  5. 메타데이터(TrashItem) 저장
  6. 감사 로그 기록
  7. WebSocket으로 진행률 전송
```

#### 삭제 진행률 계산

- 폴더는 내부 파일 수 기준으로 카운트 (빈 폴더는 1로 계산)
- `countFilesForDelete()`로 사전 계산: 각 경로를 `os.Stat` 또는 `Backend.Stat`으로 확인
- 재귀적으로 `CalculateTotalSize` / `CalculateTotalSizeBackend` 호출

#### 삭제 실패 처리

```go
if len(failures) > 0 {
    successCount := len(paths) - len(failures)
    if successCount == 0 {
        return fmt.Errorf("all %d items failed to delete", len(failures))
    }
    return fmt.Errorf("%d succeeded, %d failed", successCount, len(failures))
}
```

- 일부 항목 실패해도 나머지 계속 처리
- 최종 결과를 성공/실패 카운트로 보고

### 5.3 이름 변경 (RenameItem)

```go
// api/handlers/operations.go
func (h *Handler) RenameItem(c echo.Context) error {
    // 검증: 파일명에 /\:*?"<>| 문자 금지
    // 읽기 전용/잠금 확인
    // 로컬: os.Rename()
    // 외부 스토리지: Backend.Rename()
    // 잠금 경로 업데이트
    // 감사 로그 기록
}
```

### 5.4 고유 경로 생성

```go
// api/handlers/operations_helpers.go
func GenerateUniquePath(destDir, baseName string, isDir, allowSameFilename bool) string {
    // 파일: "document (1).txt", "document (2).txt" ...
    // 폴더: "folder (1)", "folder (2)" ...
    // 확장자를 분리하여 번호를 이름과 확장자 사이에 삽입
}
```

---

## 6. ZIP 압축/해제

### 6.1 ZIP 압축 (CompressFiles)

동기 방식으로 ZIP 파일을 생성한다. SSE 스트리밍 버전(`CompressFilesStream`)도 지원한다.

```
POST /api/files/compress
{
    "paths": ["/home/user/documents", "/home/user/photo.jpg"],
    "outputName": "archive"      // 선택, 미지정 시 자동 생성
}
```

#### 출력 파일명 규칙

| 조건 | 파일명 |
|------|--------|
| `outputName` 지정 | `{outputName}.zip` |
| 단일 항목 | `{항목명}.zip` |
| 다중 항목 | `archive_20260218_143500.zip` |
| 중복 존재 | `archive (1).zip`, `archive (2).zip` ... |

#### 외부 스토리지 처리

1. 임시 디렉토리 `{dataRoot}/.tmp/`에 ZIP 파일 생성
2. `uploadFileToBackend()`로 외부 스토리지에 업로드
3. 임시 파일 자동 삭제

### 6.2 ZIP 압축 (스트리밍 - CompressFilesStream)

SSE를 통해 실시간 진행률을 전송하면서 압축을 수행한다.

```
GET /api/files/compress-stream?paths={path1},{path2}&outputName={name}
```

#### CompressionContext

```go
// api/handlers/compress.go
type CompressionContext struct {
    Ctx              context.Context  // 취소 지원 (클라이언트 연결 끊김 감지)
    TotalBytes       int64
    TotalFiles       int
    CompressedBytes  int64
    ProcessedFiles   int
    StartTime        time.Time
    LastProgressTime time.Time        // 200ms 스로틀링
    SendProgress     CompressionProgressSender
}
```

#### 진행률 이벤트

```json
// SSE data:
{
    "status": "progress",
    "totalBytes": 1073741824,
    "compressedBytes": 536870912,
    "currentFile": "photo.jpg",
    "totalFiles": 150,
    "processedFiles": 75,
    "bytesPerSec": 52428800
}
```

| 상태 | 설명 |
|------|------|
| `started` | 압축 시작, 전체 크기/파일 수 정보 |
| `progress` | 진행 중, 200ms 간격으로 전송 |
| `completed` | 완료, outputPath/outputName/outputSize 포함 |
| `error` | 오류 또는 취소 (`ErrCompressionCancelled`) |

#### 취소 처리

- `c.Request().Context()`를 사용하여 클라이언트 연결 끊김 시 자동 취소
- 1MB 버퍼 단위로 `IsCancelled()` 확인
- 취소 시 생성 중인 ZIP 파일 자동 삭제 (`os.Remove`)
- 디스크 부족(`no space left`), 권한 거부(`permission denied`) 시 즉시 중단

### 6.3 ZIP 압축 해제 (ExtractZip)

```
POST /api/files/extract
{
    "path": "/home/user/archive.zip",
    "outputPath": "/home/user/extracted"   // 선택, 미지정 시 ZIP 파일 위치
}
```

#### 해제 절차

1. `.zip` 확장자 확인
2. 암호화 여부 확인 (`isZipEncrypted`)
   - PKWARE 전통 암호화: `Flags & 0x1`
   - WinZip AES 암호화: `Method == 99`
   - 암호화된 파일은 해제 거부 (에러 메시지: "암호가 걸린 압축파일은 해제할 수 없습니다")
3. 출력 폴더 생성 (ZIP 파일명에서 `.zip` 제거한 이름)
   - 동일 이름 폴더 존재 시 `_1`, `_2` 접미사 추가
4. Zip Slip 공격 방지: 추출 경로가 대상 디렉토리 밖을 가리키면 건너뛰기
5. 각 파일 추출 → 스토리지 사용량 업데이트
6. 감사 로그 기록

#### 외부 스토리지 해제 흐름

```
[외부 스토리지 ZIP]
    |
    v
downloadFileToLocal() → 임시 ZIP 파일
    |
    v
zip.OpenReader() → 로컬 임시 디렉토리에 해제
    |
    v
uploadDirToBackend() → 외부 스토리지에 업로드
    |
    v
임시 파일/디렉토리 자동 삭제
```

### 6.4 ZIP 미리보기 (PreviewZip)

```
GET /api/zip/preview/{path}
```

ZIP 파일을 열지 않고 내부 파일 목록을 조회한다.

#### 응답 구조

```json
{
    "fileName": "archive.zip",
    "totalFiles": 42,
    "totalSize": 1073741824,
    "isEncrypted": false,
    "files": [
        {
            "name": "document.pdf",
            "path": "docs/document.pdf",
            "size": 1048576,
            "compressedSize": 524288,
            "isDir": false,
            "modTime": "2026-02-18T14:30:00Z"
        }
    ]
}
```

### 6.5 ZIP 다운로드

#### 다중 파일 ZIP 다운로드

```
POST /api/download/zip
{
    "paths": ["/home/user/file1.txt", "/home/user/folder1"]
}
```

- 스트리밍 방식: `zip.NewWriter(c.Response())`로 직접 HTTP 응답에 ZIP 데이터 작성
- 메모리에 전체 ZIP 파일을 올리지 않고 파일 단위로 스트리밍
- ZIP 파일명: 단일 항목이면 `{항목명}.zip`, 다중이면 `download_{날짜시간}.zip`

#### 폴더 ZIP 다운로드

```
GET /api/download/folder/{path}
```

- 단일 폴더를 ZIP으로 스트리밍 다운로드
- `filepath.Walk()`으로 재귀 탐색하며 ZIP에 추가
- 외부 스토리지: `Backend.Walk()`로 스트리밍

---

## 7. API 엔드포인트

### 7.1 서버 사이드 전송 작업

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/api/transfers` | JWT 필수 | 활성 + 최근 1시간 내 작업 조회 (최대 50개) |
| GET | `/api/transfers/:id` | JWT 필수 | 특정 작업 상세 조회 |
| POST | `/api/transfers` | JWT 필수 | 새 전송 작업 생성 |
| DELETE | `/api/transfers/:id` | JWT 필수 | 작업 취소 |

#### POST /api/transfers 요청

```json
// 복사
{
    "type": "copy",
    "sourcePath": "/home/user/large-folder",
    "destinationPath": "/home/user/backup",
    "mode": "merge",
    "fileConflict": "rename"
}

// 이동
{
    "type": "move",
    "sourcePath": "/home/user/old-location/file.zip",
    "destinationPath": "/home/user/new-location"
}

// 삭제
{
    "type": "delete",
    "sourcePath": "/home/user/file1.txt",
    "paths": [
        "/home/user/file1.txt",
        "/home/user/file2.txt",
        "/home/user/folder1"
    ]
}
```

#### POST /api/transfers 응답

```json
{
    "success": true,
    "data": { "id": "550e8400-e29b-41d4-a716-446655440000" }
}
```

### 7.2 SSE 스트리밍 연산

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/api/files/copy-stream/{path}` | 선택적 JWT | 복사 + 실시간 진행률 (SSE) |
| GET | `/api/files/move-stream/{path}` | 선택적 JWT | 이동 + 실시간 진행률 (SSE) |
| GET | `/api/files/compress-stream` | 선택적 JWT | 압축 + 실시간 진행률 (SSE) |

#### SSE 쿼리 파라미터

| 파라미터 | 적용 대상 | 설명 |
|----------|-----------|------|
| `destination` | copy-stream, move-stream | 대상 경로 |
| `retry` | copy-stream | `true`이면 동일 크기 파일 건너뛰기 (이어받기) |
| `overwrite` | copy-stream, move-stream | `true`이면 기존 파일 덮어쓰기 |
| `mode` | copy-stream | `merge`이면 폴더 병합 모드 |
| `fileConflict` | copy-stream | 병합 시 파일 충돌 처리 (`overwrite`, `skip`, `rename`) |
| `paths` | compress-stream | 쉼표 구분 경로 목록 |
| `outputName` | compress-stream | 출력 ZIP 파일명 |

### 7.3 동기 파일 연산

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| POST | `/api/files/compress` | 선택적 JWT | ZIP 압축 (진행률 없음) |
| POST | `/api/files/extract` | 선택적 JWT | ZIP 해제 |
| POST | `/api/rename/{path}` | 선택적 JWT | 이름 변경 |
| POST | `/api/move/{path}` | 선택적 JWT | 이동 (진행률 없음) |
| POST | `/api/copy/{path}` | 선택적 JWT | 복사 (진행률 없음) |

### 7.4 다운로드

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| POST | `/api/download/zip` | 선택적 JWT | 다중 파일 ZIP 스트리밍 다운로드 |
| GET | `/api/download/folder/{path}` | 선택적 JWT | 폴더 ZIP 스트리밍 다운로드 |
| GET | `/api/zip/preview/{path}` | 선택적 JWT | ZIP 내부 파일 목록 미리보기 |

---

## 8. 프론트엔드 구현

### 8.1 전송 스토어 (transferStore)

```typescript
// ui/src/stores/transferStore.ts
interface TransferItem {
    id: string
    type: TransferType           // 'move' | 'copy' | 'compress' | 'delete'
    sourcePath: string
    sourceName: string
    destination: string
    status: TransferStatus       // 'pending' | 'transferring' | 'completed' | 'error'
    // 진행률
    totalBytes?: number
    copiedBytes?: number
    currentFile?: string
    totalFiles?: number
    copiedFiles?: number
    bytesPerSec?: number
    progress?: number            // 0-100
    cancel?: () => void
    // 서버 사이드 작업
    serverJobId?: string
    isServerSide?: boolean
    // 충돌 해결
    overwrite?: boolean
    mergeMode?: string           // 'merge'
    fileConflict?: string        // 'overwrite' | 'skip' | 'rename'
    // 압축
    compressPaths?: string[]
    outputName?: string
    outputPath?: string
    outputSize?: number
    // 삭제
    deletePaths?: string[]
    deleteNames?: string[]
}
```

### 8.2 주요 액션

| 액션 | 설명 | 실행 방식 |
|------|------|-----------|
| `addTransfer(type, sources, destination)` | SSE 기반 이동/복사 항목 추가 | 프론트엔드 SSE |
| `addServerTransfer(type, sourcePath, ...)` | 서버 사이드 이동/복사 작업 생성 | POST /api/transfers |
| `addCompression(paths, outputName)` | 압축 작업 추가 → 100ms 후 자동 실행 | SSE compress-stream |
| `addDeletion(paths, names)` | 서버 사이드 삭제 작업 생성 | POST /api/transfers |
| `executeTransfer(id)` | pending 항목 실행 | SSE 연결 |
| `handleTransferProgress(event)` | WebSocket 진행률 처리 | WebSocket 이벤트 |
| `cancelServerJob(id)` | 서버 사이드 작업 취소 | DELETE /api/transfers/:id |
| `retryTransfer(id)` | 실패한 작업 재시도 | 작업 재생성 |
| `loadServerJobs()` | 페이지 로드 시 활성 작업 복원 | GET /api/transfers |
| `clearCompleted()` | 완료/에러 항목 일괄 제거 | 로컬 상태 |

### 8.3 전송 패널 (UploadPanel)

`UploadPanel.tsx`에서 업로드/다운로드/전송/압축/삭제를 통합 관리한다.

```
UploadPanel.tsx
  |-- 업로드 섹션 (useUploadStore)
  |-- 다운로드 섹션 (useUploadStore.downloads)
  |-- 전송 섹션 (useTransferStore: move/copy)
  |-- 압축 섹션 (useTransferStore: compress)
  |-- 삭제 섹션 (useTransferStore: delete)
```

#### 패널 상태

- `isPanelOpen`: 패널 열림/닫힘 (ESC 키로 닫기)
- `isPanelMinimized`: 최소화 상태
- 작업 추가 시 자동으로 패널 열림
- 에러 발생 시 자동으로 패널 열림 + 최소화 해제

#### 표시 정보

| 작업 유형 | 표시 내용 |
|-----------|-----------|
| 이동/복사 | 파일명, 진행률 %, 현재 파일, 처리 속도 (B/s, KB/s, MB/s), 전체/처리 바이트 |
| 압축 | 파일명, 진행률 %, 현재 압축 중인 파일, 처리 속도, 출력 파일 크기 |
| 삭제 | 항목 수, 진행률 %, 현재 삭제 중인 파일 |

#### 카운트 최적화

```typescript
// 단일 패스로 모든 카운트 계산 (13+ filter 호출 대신)
const counts = useMemo(() => {
    let uploading = 0, completed = 0, pending = 0, error = 0
    for (const i of items) { ... }
    // transferring, compressing, deleting 등 세분화
    return { uploadingCount, transferringCount, compressingCount, ... }
}, [items, transferItems])
```

### 8.4 WebSocket 통합

```typescript
// ui/src/stores/transferStore.ts
// 브라우저 window 이벤트로 WebSocket transfer_progress 수신
window.addEventListener('transfer-progress', ((event: CustomEvent<TransferProgressEvent>) => {
    useTransferStore.getState().handleTransferProgress(event.detail)
}) as EventListener)
```

#### 다른 세션에서 시작된 작업 처리

```typescript
handleTransferProgress: (event) => {
    const existingItem = items.find(i => i.serverJobId === event.jobId)
    if (!existingItem) {
        // 다른 세션/탭에서 시작된 작업 → API로 상세 정보 조회 후 항목 추가
        getTransferJob(event.jobId).then(job => {
            // TransferItem 생성하여 목록에 추가
        })
    } else {
        // 기존 항목 진행률 업데이트
    }
}
```

### 8.5 상태 영속화

```typescript
// Zustand persist 미들웨어
persist((set, get) => ({ ... }), {
    name: 'transfer-storage',
    partialize: (state) => ({
        // 완료/에러 항목만 영속화 (활성 전송은 복원 불가)
        items: state.items
            .filter(i => i.status === 'completed' || i.status === 'error')
            .slice(-50)                           // 최근 50개만
            .map(({ cancel, ...rest }) => rest),  // cancel 함수 제외
    }),
})
```

### 8.6 프론트엔드 API 클라이언트

```typescript
// ui/src/api/transfers.ts
listTransferJobs()                   // GET /api/transfers
getTransferJob(id)                   // GET /api/transfers/:id
createTransferJob(req)               // POST /api/transfers
cancelTransferJob(id)                // DELETE /api/transfers/:id

// ui/src/api/files.ts (SSE 기반)
moveItemStream(path, dest, onProgress, overwrite?)
copyItemStream(path, dest, onProgress, retry?, overwrite?, mode?, fileConflict?)
compressFilesStream(paths, outputName, onProgress)
```

SSE 함수는 `{ cancel: () => void; promise: Promise<T> }` 형태를 반환하여 취소 지원.

---

## 9. 에러 처리 & 재시도

### 9.1 에러 유형

| 에러 | HTTP 코드 | 처리 |
|------|-----------|------|
| 경로 없음 | 404 | `ErrNotFound("Source"/"Destination")` |
| 권한 부족 | 403 | `ErrForbidden`, `checkReadonly()` |
| 파일 잠금 | 409 | `CheckFileLockForOperation()` |
| 이름 중복 | 409 | `ErrAlreadyExists` |
| 유효하지 않은 경로 | 400 | `ErrBadRequest`, `ErrInvalidPath` |
| 디스크 부족 | 500 | 압축 시 `no space left` 감지 → 즉시 중단 |
| 암호화된 ZIP | 400 | `isZipEncrypted()` → 해제 거부 |
| 작업 취소 | - | `context.Canceled` → status: 'cancelled' |

### 9.2 서버 사이드 에러 처리

```go
// api/handlers/transfer_jobs.go - executeTransferJob
if jobErr != nil {
    if ctx.Err() != nil {
        // 사용자 취소 → status: 'cancelled'
        UPDATE transfer_jobs SET status = 'cancelled', error_message = 'Cancelled by user'
    } else {
        // 실제 에러 → status: 'error', error_message 기록
        UPDATE transfer_jobs SET status = 'error', error_message = errMsg
    }
    // WebSocket으로 에러/취소 이벤트 브로드캐스트
}
```

### 9.3 삭제 작업 부분 실패

- 개별 항목 실패해도 나머지 계속 처리
- 실패 항목 경로와 에러 메시지를 `failures` 배열에 수집
- 최종 결과: `"{성공 수} succeeded, {실패 수} failed"`
- 전체 실패 시: `"all {N} items failed to delete"`

### 9.4 프론트엔드 재시도

```typescript
retryTransfer: (id) => {
    const item = items.find(i => i.id === id)
    if (!item || item.status !== 'error') return

    // 서버 사이드 삭제: 작업 제거 후 새로 생성
    if (item.type === 'delete' && item.isServerSide) {
        set(state => ({ items: state.items.filter(i => i.id !== id) }))
        get().addDeletion(item.deletePaths, item.deleteNames)
        return
    }

    // SSE 기반 작업: 상태를 pending으로 리셋 후 재실행
    // copy 재시도 시 isRetry=true → 동일 크기 파일 건너뛰기 (이어받기)
    set(state => ({
        items: state.items.map(i =>
            i.id === id ? { ...i, status: 'pending', isRetry: (i.type === 'copy') } : i
        ),
    }))
    get().executeTransfer(id)
}
```

### 9.5 복사 이어받기 (RetryMode)

```go
// api/handlers/operations_helpers.go - CopyFileWithProgress
if ctx.RetryMode {
    if dstInfo, err := os.Stat(dst); err == nil && dstInfo.Size() == srcStat.Size() {
        // 파일이 이미 존재하고 크기가 같으면 건너뛰기
        ctx.CopiedBytes += srcStat.Size()
        ctx.CopiedFiles++
        return nil
    }
}
```

### 9.6 보안 검증

모든 파일 연산에 다음 보안 검증이 적용된다:

| 검증 | 적용 시점 | 실패 시 |
|------|-----------|---------|
| 경로 검증 (`resolveStorageForOperation`) | 모든 연산 | 400 Bad Request |
| 읽기 전용 확인 (`checkReadonly`) | 쓰기 연산 | 403 Forbidden |
| 파일 잠금 확인 (`CheckFileLockForOperation`) | 수정/삭제 | 409 Conflict |
| 폴더 잠금 확인 (`CheckFolderLocksForOperation`) | 폴더 연산 | 409 Conflict |
| 소유자 확인 (`user_id` 비교) | 작업 조회/취소 | 403 Forbidden |
| Zip Slip 방지 | ZIP 해제 | 해당 파일 건너뛰기 |
| 루트 폴더 보호 | 이동/삭제/이름변경 | 400 Bad Request |

### 9.7 감사 로그

| 이벤트 | 상수 | 추가 정보 |
|--------|------|-----------|
| 파일 복사 | `EventFileCopy` | destination, serverSide |
| 파일 이동 | `EventFileMove` | destination, serverSide |
| 파일 삭제 | `EventFileDelete` | isDir, size, trashId, serverSide |
| 파일 이름변경 | `EventFileRename` | newName, newPath, isDir |
| 파일 압축 | `file.compress` | sourceCount, sources, outputSize |
| 파일 해제 | `file.extract` | extractedTo, extractedCount, extractedSize |

---

## 10. 관련 파일 참조

### 백엔드

| 파일 경로 | 설명 |
|-----------|------|
| `api/handlers/transfer_jobs.go` | 서버 사이드 전송 큐 (TransferJob CRUD, 실행, 취소, 정리) |
| `api/handlers/operations.go` | 이름변경, 이동, 복사, SSE 스트리밍 (CopyItemStream, MoveItemStream) |
| `api/handlers/operations_helpers.go` | CopyContext, ProgressSender, SetupSSE, SafeOverwrite, GenerateUniquePath |
| `api/handlers/compress.go` | ZIP 압축 (동기/SSE 스트리밍), ZIP 해제, CompressionContext |
| `api/handlers/zip_download.go` | ZIP 다운로드 (다중 파일, 폴더), ZIP 미리보기 |
| `api/handlers/errors.go` | 에러 처리/응답 헬퍼 |
| `api/handlers/permissions.go` | 권한 체크, 파일 잠금 |
| `api/handlers/audit.go` | 감사 로그 |
| `api/database/migrations/007_transfer_jobs.sql` | transfer_jobs 테이블 생성 |
| `api/database/migrations/008_transfer_jobs_delete.sql` | delete_paths 컬럼 추가 |

### 프론트엔드

| 파일 경로 | 설명 |
|-----------|------|
| `ui/src/stores/transferStore.ts` | 전송 상태 관리 (Zustand, persist) |
| `ui/src/api/transfers.ts` | 서버 사이드 전송 작업 API 클라이언트 |
| `ui/src/api/files.ts` | SSE 스트리밍 함수 (moveItemStream, copyItemStream, compressFilesStream) |
| `ui/src/components/UploadPanel.tsx` | 통합 전송 패널 UI (업로드/다운로드/전송/압축/삭제) |
| `ui/src/components/FileList.tsx` | 파일 목록에서 전송/삭제/압축 호출 |
| `ui/src/components/ZipViewer.tsx` | ZIP 아카이브 탐색기 |
| `ui/src/components/Sidebar.tsx` | 사이드바 전송 상태 표시 |
