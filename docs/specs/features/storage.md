# 스토리지 시스템 명세

## 개요

FileHatch의 스토리지 시스템은 추상화된 `StorageBackend` 인터페이스를 통해 로컬 파일 시스템과 S3 호환 스토리지를 통합 관리한다. `StorageRouter`가 가상 경로를 적절한 백엔드로 라우팅하며, 외부 스토리지 마운트, 스토리지 할당량, 휴지통, 캐시 시스템을 포함한다.

---

## StorageBackend 인터페이스

모든 스토리지 백엔드가 구현해야 하는 공통 인터페이스:

```go
type StorageBackend interface {
    // 백엔드 정보
    Type() string                                        // "local", "s3"
    IsLocal() bool                                       // 로컬 파일 시스템 여부

    // 파일/디렉토리 조회
    Stat(ctx context.Context, path string) (*StorageFileInfo, error)
    List(ctx context.Context, path string) ([]StorageDirEntry, error)
    ReadDir(ctx context.Context, path string) ([]StorageDirEntry, error)
    Exists(ctx context.Context, path string) (bool, error)

    // 파일 읽기/쓰기
    ReadFile(ctx context.Context, path string) (io.ReadCloser, *StorageFileInfo, error)
    WriteFile(ctx context.Context, path string, reader io.Reader, size int64) error

    // 파일/디렉토리 조작
    Delete(ctx context.Context, path string) error
    DeleteAll(ctx context.Context, path string) error
    Mkdir(ctx context.Context, path string) error
    Rename(ctx context.Context, oldPath string, newPath string) error
    Copy(ctx context.Context, src string, dst string) error

    // 탐색 및 유틸리티
    Walk(ctx context.Context, root string, walkFn filepath.WalkFunc) error
    GetRealPath(path string) (string, error)             // LocalBackend 전용
    SetPermissions(ctx context.Context, path string, isDir bool) error
    CalculateSize(ctx context.Context, path string) (int64, error)
}
```

---

## Local 백엔드

### 핵심 구조

| 항목 | 값 |
|------|-----|
| 구현 파일 | `api/handlers/storage_local.go` |
| 기본 경로 | 사용자별 `/data/users/{username}` |
| `Type()` | `"local"` |
| `IsLocal()` | `true` |

### 경로 검증

```go
func (b *LocalBackend) isPathWithinRoot(path string) bool
```

- `filepath.Clean()` 적용 후 기본 경로 접두사 확인
- Path Traversal 공격 방지

### 파일 권한

| 대상 | 권한 | 설명 |
|------|------|------|
| 일반 디렉토리 | `0775` | 소유자/그룹 rwx, 기타 rx |
| 일반 파일 | `0664` | 소유자/그룹 rw, 기타 r |
| 공유 폴더 | GID 100 | 그룹 공유를 위한 GID 설정 |

---

## S3 백엔드

### 핵심 구조

| 항목 | 값 |
|------|-----|
| 구현 파일 | `api/handlers/storage_s3.go` |
| SDK | AWS SDK v2 (`aws-sdk-go-v2/service/s3`) |
| `Type()` | `"s3"` |
| `IsLocal()` | `false` |

### 설정 항목

| 항목 | 설명 |
|------|------|
| `endpoint` | S3 호환 엔드포인트 URL |
| `region` | AWS 리전 |
| `bucket` | 버킷 이름 |
| `access_key` | 접근 키 |
| `secret_key` | 비밀 키 (AES-GCM 암호화 저장) |
| `path_style` | Path-style 주소 사용 여부 (MinIO 등) |
| `prefix` | 버킷 내 경로 접두사 |

### S3 API 매핑

| StorageBackend 메서드 | S3 API |
|----------------------|--------|
| `Stat()` | `HeadObject` |
| `ReadFile()` | `GetObject` |
| `WriteFile()` | `PutObject` |
| `Delete()` | `DeleteObject` |
| `List()` | `ListObjectsV2` |
| `Mkdir()` | `PutObject` (키 끝에 `/` 접미사) |

### 디렉토리 시뮬레이션

S3는 디렉토리 개념이 없으므로, 키 끝에 `/` 접미사를 붙여 디렉토리를 시뮬레이션한다.

### 제약 사항

- `GetRealPath()`는 사용 불가 (`IsLocal()=false`)
- 로컬 파일 시스템 전용 기능(fsnotify 감시 등)은 S3 백엔드에서 동작하지 않는다.

---

## StorageRouter

### 핵심 구조

| 항목 | 값 |
|------|-----|
| 구현 파일 | `api/handlers/storage_router.go` |
| 역할 | 가상 경로 → 백엔드 매핑 |
| 동시성 제어 | `sync.RWMutex` |

### Resolve 결과

```go
type ResolveResult struct {
    Backend     StorageBackend // 대상 백엔드 인스턴스
    RelPath     string         // 백엔드 내 상대 경로
    StorageType string         // "local", "s3"
    DisplayPath string         // UI 표시용 경로
    MountID     *int64         // 외부 스토리지 마운트 ID (nullable)
    IsReadonly  bool           // 읽기 전용 여부
}
```

### 가상 경로 라우팅 규칙

| 가상 경로 패턴 | 라우팅 대상 |
|---------------|------------|
| `/home/{username}/...` | 사용자 홈 디렉토리 (Local) |
| `/shared/{folderName}/...` | 공유 폴더 (Local) |
| `/external/{mountPath}/...` | 외부 스토리지 (S3 또는 Local-mount) |

### 백엔드 캐싱

- 사용자별 홈 디렉토리 백엔드: 개별 인스턴스 캐시
- 공유 폴더: 싱글턴 인스턴스
- 스레드 안전: `sync.RWMutex`로 동시 접근 보호

---

## 외부 스토리지

### DB 테이블 구조

#### `external_storages` 테이블

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | `BIGSERIAL` | PK |
| `name` | `VARCHAR` | 표시 이름 |
| `backend_type` | `VARCHAR` | `s3`, `local-mount` |
| `mount_path` | `VARCHAR` | 가상 마운트 경로 |
| `config` | `TEXT` | 설정 (AES-GCM 암호화) |
| `created_at` | `TIMESTAMP` | 생성 시각 |
| `updated_at` | `TIMESTAMP` | 수정 시각 |

#### `external_storage_access` 테이블

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | `BIGSERIAL` | PK |
| `storage_id` | `BIGINT` | FK → `external_storages.id` |
| `user_id` | `UUID` | FK → `users.id` |
| `permission` | `VARCHAR` | 접근 권한 |

### 설정 암호화

- 외부 스토리지 설정(`config`)은 `ENCRYPTION_KEY` 환경변수를 사용하여 AES-GCM으로 암호화 저장
- 민감 정보(S3 secret_key, SMB 비밀번호 등)가 평문으로 DB에 저장되지 않음

### 가상 경로

외부 스토리지는 `/external/{mountPath}/` 형태의 가상 경로로 접근한다.

---

## 스토리지 할당량

### 사용자별 할당량

| DB 컬럼 | 타입 | 설명 |
|---------|------|------|
| `users.storage_quota` | `BIGINT` | 할당량 (0=무제한) |
| `users.storage_used` | `BIGINT` | 사용량 (바이트) |
| `users.trash_used` | `BIGINT` | 휴지통 사용량 (바이트) |

### 공유 폴더별 할당량

| DB 컬럼 | 타입 | 설명 |
|---------|------|------|
| `shared_folders.storage_quota` | `BIGINT` | 할당량 (0=무제한) |
| `shared_folders.storage_used` | `BIGINT` | 사용량 (바이트) |

### 할당량 검사

- **검사 시점**: 업로드 전 (`UploadHandler`에서 사전 검증)
- **검사 대상**: 사용자 할당량 + 공유 폴더 할당량 (해당 시)
- 할당량 초과 시 업로드 요청 거부 (400 Bad Request)

### 사용량 재계산

```go
RecalculateAllUsersStorage()
```

- **실행 시점**: API 서버 시작 시
- 실제 파일 시스템을 순회하여 정확한 사용량을 계산하고 DB를 업데이트한다.

### 프론트엔드 표시

- `getStorageUsage()` API 호출
- 사이드바에 스토리지 사용량 막대(progress bar) 표시

---

## 휴지통 시스템

### 동작 방식

| 항목 | 설명 |
|------|------|
| 삭제 방식 | 소프트 삭제 (Soft Delete) |
| 이동 경로 | `/.trash/{username}/` 디렉토리 |
| 메타데이터 | 원본 경로, 타임스탬프 보존 (복원용) |
| 할당량 반영 | 휴지통 파일도 사용자 할당량에 포함 |

### 자동 정리

| 항목 | 값 |
|------|-----|
| 실행 주기 | 24시간마다 |
| 보존 기간 | 설정 가능 (기본 30일) |
| 정리 대상 | 보존 기간 초과 항목 |

### 휴지통 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/files/trash` | 파일/폴더를 휴지통으로 이동 |
| `POST` | `/api/files/restore` | 휴지통에서 원본 위치로 복원 |
| `GET` | `/api/files/trash-stats` | 휴지통 통계 (파일 수, 크기) |
| `DELETE` | `/api/files/trash/empty` | 휴지통 비우기 (영구 삭제) |

### 프론트엔드

- `Trash.tsx`: 휴지통 목록 뷰, 복원/영구삭제 액션 지원

---

## 캐시 시스템

### StorageCache

| 항목 | 값 |
|------|-----|
| 구현 파일 | `api/handlers/storage_cache.go` |
| 용도 | 파일 stat 정보 캐시 |
| TTL | 5분 |

파일 메타데이터(크기, 수정일 등) 조회 결과를 캐시하여 반복 조회 시 파일 시스템 접근을 줄인다.

### PermissionCache

| 항목 | 값 |
|------|-----|
| 구현 파일 | `api/handlers/permissions_cache.go` |
| 용도 | ACL(접근 제어 목록) 캐시 |
| TTL | 5분 |
| 캐시 키 | `(userID, folderName)` 조합 |

공유 폴더 접근 권한 조회 결과를 캐시하여 매 요청마다 DB 조회를 하지 않도록 한다.

### 캐시 무효화

| 방식 | 설명 |
|------|------|
| 자동 (TTL) | 5분 경과 시 자동 만료 |
| 수동 | 파일 변경, 권한 변경 시 해당 캐시 항목 즉시 무효화 |

---

## 프론트엔드 컴포넌트

| 컴포넌트/Hook | 역할 |
|--------------|------|
| `useExternalStorages` | 마운트된 외부 스토리지 목록 조회 |
| 사이드바 | 스토리지 사용량 막대, 외부 마운트 목록 표시 |
| `Trash.tsx` | 휴지통 뷰 (복원/삭제 액션) |

---

## API 엔드포인트

### 스토리지 사용량

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| `GET` | `/api/files/storage-usage` | JWT | 사용자 스토리지 사용량 조회 |

### 휴지통

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| `GET` | `/api/files/trash-stats` | JWT | 휴지통 통계 조회 |
| `POST` | `/api/files/trash` | JWT | 파일/폴더를 휴지통으로 이동 |
| `POST` | `/api/files/restore` | JWT | 휴지통에서 복원 |
| `DELETE` | `/api/files/trash/empty` | JWT | 휴지통 비우기 (영구 삭제) |

### 외부 스토리지

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| `GET` | `/api/external-storages` | JWT | 사용자에게 허용된 외부 스토리지 목록 |
| `POST` | `/api/admin/external-storages` | Admin | 외부 스토리지 생성 |
| `PUT` | `/api/admin/external-storages/{id}` | Admin | 외부 스토리지 수정 |
| `DELETE` | `/api/admin/external-storages/{id}` | Admin | 외부 스토리지 삭제 |
| `POST` | `/api/admin/external-storages/test` | Admin | 외부 스토리지 연결 테스트 |

---

## 관련 파일

| 경로 | 설명 |
|------|------|
| `api/handlers/storage_local.go` | LocalBackend 구현 |
| `api/handlers/storage_s3.go` | S3Backend 구현 |
| `api/handlers/storage_router.go` | StorageRouter - 가상 경로 라우팅 |
| `api/handlers/storage_cache.go` | StorageCache - 파일 stat 캐시 |
| `api/handlers/permissions_cache.go` | PermissionCache - ACL 캐시 |
| `api/handlers/file_handler.go` | 파일 CRUD 핸들러 |
| `api/handlers/upload_handler.go` | 업로드 핸들러 (할당량 검사 포함) |
| `api/handlers/crypto.go` | AES-GCM 암호화 (외부 스토리지 설정) |
| `api/database/migrations/003_external_storages.sql` | 외부 스토리지 마이그레이션 |
| `ui/src/hooks/useExternalStorages.ts` | 외부 스토리지 Hook |
| `ui/src/components/Trash.tsx` | 휴지통 UI |
| `ui/src/components/Sidebar.tsx` | 사이드바 (스토리지 사용량 표시) |
