# 업로드 시스템 명세

## 1. 기능 개요

tus 프로토콜 기반의 이어받기(Resumable) 업로드, 서버사이드 전송 큐, 다운로드 추적, 중복 감지를 포함하는 파일 전송 시스템이다.
대용량 파일 업로드 시 네트워크 중단에도 이어받기가 가능하며,
서버사이드에서 복사/이동/삭제/압축 등 장시간 작업을 비동기로 처리한다.

### 핵심 특성

| 특성 | 설명 |
|------|------|
| tus 프로토콜 | 표준 이어받기 업로드 (RFC 기반) |
| 동시 업로드 제한 | 최대 3개 동시 업로드 (`MAX_CONCURRENT_UPLOADS`) |
| 서버사이드 전송 큐 | 복사/이동/삭제/압축 작업을 DB 기반 큐로 관리 |
| 중복 감지 | 업로드 전 동일 파일 존재 여부 확인 및 충돌 해결 |
| 실시간 진행률 | WebSocket으로 서버사이드 작업 진행률 전송 |
| 속도 표시 | 업로드/다운로드 속도 실시간 계산 및 표시 |

---

## 2. tus 업로드 프로토콜 (백엔드)

### 2.1 핸들러 구조

| 항목 | 값 |
|------|----|
| 핸들러 | `UploadHandler` in `api/handlers/upload_handler.go` |
| 라이브러리 | `github.com/tus/tusd/v2` |
| 임시 저장소 | `/data/.uploads/` |
| 최종 이동 | `handleCompletedUploads()` 고루틴이 최종 경로로 이동 |

### 2.2 업로드 흐름

```
[클라이언트: tus-js-client]
    |
    v
POST /api/upload/                         # 1. 업로드 생성
    Headers:
      Upload-Length: <file-size>
      Upload-Metadata: filename <b64>, path <b64>, username <b64>, overwrite <b64>
    |
    v
[서버: Pre-Upload 검증]
    - 저장 공간 할당량(quota) 확인
    - 경로 유효성 검증 (Path Traversal 방지)
    - 파일명 유효성 검증 (ValidateFilename)
    |
    v
201 Created
    Location: /api/upload/{upload-id}
    |
    v
PATCH /api/upload/{upload-id}             # 2. 청크 업로드 (이어받기 가능)
    Headers:
      Upload-Offset: <current-offset>
      Content-Type: application/offset+octet-stream
    Body: <binary-data>
    |
    v (업로드 완료 시)
[서버: handleCompletedUploads() 고루틴]
    - 임시 파일 → 최종 경로로 이동
    - storage_used 업데이트
    - 감사 로그 기록 (EventFileUpload)
    - WebSocket BroadcastFileChange 발송
```

### 2.3 tus 메타데이터

| 키 | 설명 | 인코딩 |
|----|------|--------|
| `filename` | 원본 파일명 | Base64 |
| `path` | 업로드 대상 경로 | Base64 |
| `username` | 업로드 사용자 | Base64 |
| `overwrite` | 덮어쓰기 여부 | Base64 ("true"/"false") |

### 2.4 리버스 프록시 대응

```go
// Location 헤더 수정 (Nginx 등 리버스 프록시 환경)
// EXTERNAL_URL 환경변수 또는 X-Forwarded-* 헤더 기반으로 URL 재작성
if externalURL != "" {
    location = externalURL + "/api/upload/" + uploadID
} else if forwarded := c.Request().Header.Get("X-Forwarded-Proto"); forwarded != "" {
    // X-Forwarded-Proto, X-Forwarded-Host 기반 재작성
}
```

### 2.5 Pre-Upload 검증 상세

```go
// Quota 체크
currentUsage := getUserStorageUsed(userID)
if currentUsage + uploadSize > userQuota {
    return ErrForbidden("storage quota exceeded")
}

// 경로 검증
cleaned := filepath.Clean(path)
if strings.Contains(cleaned, "..") {
    return ErrForbidden("invalid path")
}

// 파일명 검증
if err := ValidateFilename(filename); err != nil {
    return ErrValidation("invalid filename", err.Error())
}
```

---

## 3. 업로드 스토어 (프론트엔드)

### 3.1 상태 머신

```
UploadItem 상태 전이:

pending ──────> uploading ──────> completed
    |               |
    |               +──────> error
    |               |
    |               +──────> paused ──> uploading (재개)
    |
    +──────> duplicate (중복 감지)
                |
                +──> overwrite ──> uploading
                +──> rename ──> uploading
                +──> cancel
```

### 3.2 uploadStore 구조

```typescript
interface UploadItem {
    id: string;               // 고유 ID
    file: File;               // File 객체
    path: string;             // 업로드 대상 경로
    status: UploadStatus;     // pending | uploading | completed | error | paused | duplicate
    progress: number;         // 0-100 진행률
    speed: number;            // bytes/sec 업로드 속도
    error?: string;           // 에러 메시지
    tusUpload?: tus.Upload;   // tus Upload 인스턴스
}

// Zustand Store
interface UploadStoreState {
    items: UploadItem[];
    addFiles: (files: File[], path: string) => void;
    startUpload: (id: string) => void;
    pauseUpload: (id: string) => void;
    resumeUpload: (id: string) => void;
    cancelUpload: (id: string) => void;
    retryUpload: (id: string) => void;
    clearCompleted: () => void;
}
```

### 3.3 tus-js-client 설정

| 설정 | 값 | 설명 |
|------|----|------|
| `retryDelays` | `[0, 1000, 3000, 5000]` | 재시도 간격 (ms) |
| `chunkSize` | 자동 | tus 서버 기본값 사용 |
| `fingerprint` | `file.name + file.size + path` | 이어받기 식별자 |
| `storeFingerprintForResuming` | `true` | localStorage에 URL 저장 |
| `removeFingerprintOnSuccess` | `true` | 완료 시 fingerprint 제거 |

### 3.4 동시 업로드 관리

```typescript
const MAX_CONCURRENT_UPLOADS = 3;

// 큐 처리 로직
function processQueue() {
    const uploading = items.filter(i => i.status === 'uploading');
    const pending = items.filter(i => i.status === 'pending');

    while (uploading.length < MAX_CONCURRENT_UPLOADS && pending.length > 0) {
        const next = pending.shift();
        startUpload(next.id);
    }
}
```

### 3.5 진행률 추적

| 항목 | 설명 |
|------|------|
| 업데이트 주기 | 200ms 스로틀링 |
| 속도 계산 | 최근 1초간 전송량 기반 |
| 남은 시간 | `(totalBytes - uploadedBytes) / speed` |
| 표시 형식 | `45.2 MB / 120.0 MB (37%) - 2.3 MB/s` |

### 3.6 중단된 업로드 복원

```typescript
// localStorage에 저장되는 메타데이터
interface SavedUploadMetadata {
    filename: string;
    path: string;
    size: number;
    tusUrl: string;       // 이어받기 URL
    lastModified: number; // 파일 수정 시간
}

// 세션 복원 시
// 1. localStorage에서 미완료 업로드 목록 조회
// 2. tus HEAD 요청으로 서버 측 오프셋 확인
// 3. 유효한 업로드만 resumableUrlStorage에 등록
```

---

## 4. 중복 감지

### 4.1 감지 흐름

```
[파일 업로드 시작 전]
    |
    v
checkAndStartUpload()
    |
    +-- Quota 확인 (GET /api/files/storage-usage, 3초 타임아웃)
    |
    +-- 파일 존재 확인 (GET /api/files/check?path=...&filename=...)
    |       |
    |       +-- 존재하지 않음 → 즉시 업로드 시작
    |       |
    |       +-- 존재함 → DuplicateModal 표시
    |
    v
[DuplicateModal]
```

### 4.2 충돌 해결 옵션

| 옵션 | 설명 | tus metadata |
|------|------|--------------|
| `overwrite` | 기존 파일 덮어쓰기 | `overwrite: "true"` |
| `rename` | 새 이름으로 업로드 (예: `file (1).txt`) | `filename: "file (1).txt"` |
| `cancel` | 해당 파일 업로드 취소 | - |
| `overwrite_all` | 남은 모든 중복 파일 덮어쓰기 | `overwrite: "true"` (배치) |

### 4.3 overwriteAll 모드

```typescript
// 배치 업로드 시 overwrite_all 선택하면
// 이후 동일 배치 내 모든 중복 파일에 자동 적용
let overwriteAllMode = false;

function handleDuplicateResponse(response: DuplicateResponse) {
    if (response === 'overwrite_all') {
        overwriteAllMode = true;
        // 현재 파일 + 남은 모든 파일에 overwrite 적용
    }
}
```

---

## 5. 서버사이드 전송 큐

### 5.1 DB 스키마 (transfer_jobs 테이블)

```sql
CREATE TABLE IF NOT EXISTS transfer_jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     INTEGER REFERENCES users(id),
    type        VARCHAR(20) NOT NULL,      -- copy, move, delete, compress
    status      VARCHAR(20) NOT NULL,      -- pending, running, completed, error, cancelled
    source_path TEXT NOT NULL,
    dest_path   TEXT,
    total_bytes BIGINT DEFAULT 0,
    copied_bytes BIGINT DEFAULT 0,
    total_files INTEGER DEFAULT 0,
    copied_files INTEGER DEFAULT 0,
    current_file TEXT,                     -- 현재 처리 중인 파일명
    bytes_per_sec BIGINT DEFAULT 0,       -- 현재 전송 속도
    conflict_mode VARCHAR(20),            -- overwrite, skip, rename
    error_message TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### 5.2 전송 작업 상태 전이

```
pending ──────> running ──────> completed
                    |
                    +──────> error
                    |
                    +──────> cancelled (사용자 취소)
```

### 5.3 작업 유형별 처리

| 유형 | 설명 | 서버 동작 |
|------|------|-----------|
| `copy` | 파일/폴더 복사 | 재귀적 파일 복사, 바이트 단위 진행률 추적 |
| `move` | 파일/폴더 이동 | 같은 볼륨이면 rename, 다른 볼륨이면 copy+delete |
| `delete` | 파일/폴더 삭제 | 재귀적 삭제, 파일 수 기반 진행률 |
| `compress` | ZIP 압축 | 다중 파일/폴더를 ZIP으로 압축 |

### 5.4 WebSocket 진행률 알림

```go
// TransferProgressEvent 구조
type TransferProgressEvent struct {
    JobID       string  `json:"jobId"`
    Status      string  `json:"status"`
    TotalBytes  int64   `json:"totalBytes"`
    CopiedBytes int64   `json:"copiedBytes"`
    TotalFiles  int     `json:"totalFiles"`
    CopiedFiles int     `json:"copiedFiles"`
    CurrentFile string  `json:"currentFile"`
    BytesPerSec int64   `json:"bytesPerSec"`
    Error       string  `json:"error,omitempty"`
}
```

### 5.5 충돌 해결 모드

| 모드 | 설명 |
|------|------|
| `overwrite` | 대상 경로에 동일 파일 존재 시 덮어쓰기 |
| `skip` | 동일 파일 건너뛰기 |
| `rename` | 자동 이름 변경 (예: `file (1).txt`) |

### 5.6 동시 실행 제한

```go
// 서버에서 동시 실행 가능한 전송 작업 수 제한
const MAX_CONCURRENT_TRANSFERS = 2 // (설정 기반)

// 새 작업 생성 시
// running 상태 작업 수 확인 → MAX 미만이면 즉시 실행, 아니면 pending 대기
```

---

## 6. 프론트엔드 전송 스토어 (transferStore)

### 6.1 구조

```typescript
interface TransferItem {
    id: string;
    type: 'copy' | 'move' | 'delete' | 'compress';
    status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
    sourcePath: string;
    destPath?: string;
    totalBytes: number;
    copiedBytes: number;
    totalFiles: number;
    copiedFiles: number;
    currentFile: string;
    bytesPerSec: number;
    error?: string;
    isServerSide: boolean;  // 서버사이드 작업 여부
}
```

### 6.2 클라이언트/서버 통합

```
[사용자 작업 요청]
    |
    v
작업 크기 판단
    |
    +-- 소규모 (단일 파일, 작은 폴더) → 클라이언트에서 직접 API 호출
    |
    +-- 대규모 (다중 파일, 대용량) → POST /api/transfers 서버사이드 큐
                                        |
                                        v
                                  WebSocket으로 진행률 수신
                                        |
                                        v
                                  transferStore 업데이트 → UI 반영
```

---

## 7. 다운로드 시스템

### 7.1 단일 파일 다운로드

```typescript
// ReadableStream 기반 진행률 추적
const response = await fetch('/api/files/download?path=...');
const reader = response.body.getReader();
const contentLength = +response.headers.get('Content-Length');

let receivedLength = 0;
while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedLength += value.length;
    updateProgress(receivedLength / contentLength * 100);
}
```

### 7.2 다중 파일 ZIP 다운로드

```
POST /api/files/download-zip
Body: { paths: ["/path/file1.txt", "/path/file2.txt"] }
Response: application/zip 스트리밍
```

### 7.3 다운로드 취소

```typescript
// AbortController 사용
const controller = new AbortController();
const response = await fetch(url, { signal: controller.signal });

// 취소 시
controller.abort();
```

### 7.4 downloadStore

```typescript
interface DownloadItem {
    id: string;
    filename: string;
    totalBytes: number;
    downloadedBytes: number;
    speed: number;          // bytes/sec
    status: 'downloading' | 'completed' | 'error' | 'cancelled';
    abortController: AbortController;
}
```

---

## 8. 프론트엔드 UI 컴포넌트

### 8.1 컴포넌트 역할

| 컴포넌트 | 설명 |
|----------|------|
| `UploadModal.tsx` | 파일 선택 다이얼로그 (드래그 앤 드롭 영역 포함) |
| `UploadPanel.tsx` | 전송 큐 표시 패널 (업로드, 다운로드, 전송 통합) |
| `DuplicateModal.tsx` | 파일 중복 감지 시 충돌 해결 다이얼로그 |
| `ConflictModal.tsx` | 폴더 병합 시 충돌 해결 다이얼로그 |

### 8.2 UploadPanel 구조

```
UploadPanel.tsx
    +-- 탭: 업로드 | 다운로드 | 전송
    |
    +-- 업로드 탭
    |     +-- 진행 중인 업로드 목록
    |     +-- 대기 중인 업로드 목록
    |     +-- 완료된 업로드 목록
    |     +-- [일시정지] [재개] [취소] [모두 지우기] 버튼
    |
    +-- 다운로드 탭
    |     +-- 진행 중인 다운로드 목록
    |     +-- [취소] 버튼
    |
    +-- 전송 탭
          +-- 서버사이드 전송 작업 목록
          +-- 실시간 진행률 바
          +-- [취소] 버튼
```

### 8.3 드래그 앤 드롭 업로드

```typescript
// FileList.tsx에서 드래그 앤 드롭 처리
onDragOver: (e) => {
    e.preventDefault();
    setDragOver(true);
};

onDrop: (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    uploadStore.addFiles(files, currentPath);
};
```

---

## 9. API 엔드포인트

### 9.1 tus 업로드

| 메서드 | 경로 | 헤더 | 설명 |
|--------|------|------|------|
| POST | `/api/upload/` | Upload-Length, Upload-Metadata | 업로드 세션 생성 |
| HEAD | `/api/upload/{id}` | - | 현재 오프셋 조회 (이어받기용) |
| PATCH | `/api/upload/{id}` | Upload-Offset, Content-Type | 청크 데이터 전송 |

### 9.2 서버사이드 전송

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| POST | `/api/transfers` | JWT | 전송 작업 생성 |
| GET | `/api/transfers` | JWT | 내 전송 작업 목록 |
| GET | `/api/transfers/{id}` | JWT | 특정 작업 상태 조회 |
| DELETE | `/api/transfers/{id}` | JWT | 작업 취소 |

### 9.3 전송 작업 생성 요청

```json
// POST /api/transfers
{
    "type": "copy",                    // copy, move, delete, compress
    "sourcePaths": ["/path/file1.txt", "/path/folder1/"],
    "destPath": "/path/destination/",  // delete 시 불필요
    "conflictMode": "overwrite"        // overwrite, skip, rename
}
```

### 9.4 전송 작업 상태 응답

```json
// GET /api/transfers/{id}
{
    "id": "uuid",
    "type": "copy",
    "status": "running",
    "sourcePath": "/path/source/",
    "destPath": "/path/dest/",
    "totalBytes": 1073741824,
    "copiedBytes": 536870912,
    "totalFiles": 150,
    "copiedFiles": 75,
    "currentFile": "document.pdf",
    "bytesPerSec": 52428800,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:01:00Z"
}
```

---

## 10. 에러 처리

### 10.1 업로드 에러 종류

| 에러 | 원인 | 처리 |
|------|------|------|
| Quota 초과 | 저장 공간 부족 | 업로드 차단, 사용자에게 알림 |
| 네트워크 중단 | 연결 끊김 | tus 자동 재시도 (retryDelays) |
| 파일명 유효하지 않음 | 금지 문자 포함 | 업로드 거부, 에러 메시지 |
| 경로 유효하지 않음 | Path Traversal 시도 | 403 Forbidden |
| 서버 오류 | 디스크 풀 등 | 500 에러, 사용자에게 알림 |

### 10.2 전송 큐 에러 처리

```
[전송 작업 에러 발생]
    |
    v
status → 'error', error_message 저장
    |
    v
WebSocket TransferProgressEvent (status: 'error') 전송
    |
    v
[프론트엔드]
    +-- 에러 토스트 알림
    +-- UploadPanel에서 에러 상태 표시
    +-- 사용자가 재시도 또는 취소 선택 가능
```

---

## 11. 관련 파일 참조

### 백엔드

| 파일 경로 | 설명 |
|-----------|------|
| `api/handlers/upload_handler.go` | tus 업로드 핸들러 |
| `api/handlers/transfer_handler.go` | 서버사이드 전송 큐 핸들러 |
| `api/handlers/file_handler.go` | 파일 다운로드 등 |

### 프론트엔드

| 파일 경로 | 설명 |
|-----------|------|
| `ui/src/stores/uploadStore.ts` | 업로드 상태 관리 (Zustand) |
| `ui/src/stores/transferStore.ts` | 전송 상태 관리 (Zustand) |
| `ui/src/stores/downloadStore.ts` | 다운로드 상태 관리 (Zustand) |
| `ui/src/components/UploadModal.tsx` | 파일 선택 다이얼로그 |
| `ui/src/components/UploadPanel.tsx` | 전송 큐 패널 |
| `ui/src/components/DuplicateModal.tsx` | 중복 감지 모달 |
| `ui/src/components/ConflictModal.tsx` | 폴더 병합 충돌 모달 |
| `ui/src/api/files.ts` | 파일 관련 API 함수 |
| `ui/src/api/transfers.ts` | 전송 작업 API 함수 |
