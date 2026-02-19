# FileHatch 시스템 아키텍처 명세서

> 버전: 0.10.1 | 최종 업데이트: 2026-02-18

---

## 1. 시스템 개요

FileHatch는 **셀프호스팅 파일 관리 플랫폼**으로, 개인 및 팀 환경에서 파일 저장, 공유, 협업을 제공한다.
Docker Compose 기반으로 배포되며, 웹 UI와 SMB(CIFS) 프로토콜을 통한 이중 접근을 지원한다.

### 핵심 특징

- 가상 경로 시스템을 통한 다중 스토리지 백엔드 추상화 (로컬, S3, 외부 마운트)
- tus 프로토콜 기반 이어받기 가능한 대용량 파일 업로드
- WebSocket 실시간 파일 변경 감지 및 전송 진행률 알림
- 서버 사이드 전송 큐 (복사/이동/압축/삭제)
- JWT 인증 + 2FA(TOTP) + SSO(OAuth2/OIDC) 다계층 인증
- SMB/CIFS 파일 서버 통합 (Samba sidecar)
- OnlyOffice 문서 편집 통합 (선택)
- WebDAV 프로토콜 지원

### 기술 스택

| 계층 | 기술 | 버전 |
|------|------|------|
| Backend | Go + Echo framework | Go 1.24, Echo v4.15 |
| Frontend | React + TypeScript + Zustand | React 18.3, TS 5.6, Zustand 5 |
| Server State | TanStack React Query | v5.62 |
| Upload | tus-js-client + tusd | tus-js-client 4.2, tusd v2.4 |
| DB | PostgreSQL | 17 (Alpine) |
| Cache | Valkey (Redis 호환) | 8.1.5 |
| SMB | Samba | Alpine 기반 커스텀 이미지 |
| Document | OnlyOffice Document Server | 9.2.1 (선택) |
| SSO | Keycloak | 26.5.1 (선택) |
| WebSocket | gorilla/websocket + fsnotify | websocket 1.5.3, fsnotify 1.7 |
| WebDAV | golang.org/x/net/webdav | - |

---

## 2. 서비스 구성

### Docker Compose 서비스

| Service | Container | Image | Port | Profile | 역할 |
|---------|-----------|-------|------|---------|------|
| api | fh-api | `svrforum/filehatch-api` | 8080 (내부) | core | Go Echo 백엔드 API 서버 |
| ui | fh-ui | `svrforum/filehatch-ui` | 3000 -> 3080 | core | React SPA + Express 프록시 서버 |
| samba | fh-samba | `svrforum/filehatch-samba` | host network (445, 139) | core | SMB/CIFS 파일 공유 서버 |
| db | fh-db | `postgres:17-alpine` | 5432 (내부) | core | PostgreSQL 데이터베이스 |
| valkey | fh-valkey | `valkey/valkey:8.1.5-alpine` | 6379 (내부) | core | 캐시 및 Brute Force 추적 |
| onlyoffice | fh-onlyoffice | `onlyoffice/documentserver:9.2.1` | 8088 | `--profile office` | 문서 편집 서버 (선택) |
| keycloak | fh-keycloak | `quay.io/keycloak/keycloak:26.5.1` | 8180 | `--profile sso` | SSO IdP 서버 (선택) |

### 서비스 의존성 체인

```
db (healthy) ──┐
               ├──> api (healthy) ──> ui
valkey (healthy) ┘
                     samba (독립 실행, host network)
                     onlyoffice (독립 실행, optional)
                     keycloak (독립 실행, optional)
```

### 볼륨 매핑

| 호스트 경로 | 컨테이너 경로 | 서비스 | 용도 |
|-------------|---------------|--------|------|
| `${DATA_PATH:-./data}` | `/data` | api, samba | 사용자 파일 저장소 |
| `${CONFIG_PATH:-./config}` | `/etc/filehatch` | api, samba | SMB 설정, 인증서 등 |
| `${DATABASE_PATH:-./database}` | `/var/lib/postgresql/data` | db | DB 데이터 |
| `/var/run/docker.sock` | `/var/run/docker.sock:ro` | api | Samba 컨테이너 제어 |

### PostgreSQL 튜닝 (기본값)

```
shared_buffers = 256MB
effective_cache_size = 512MB
work_mem = 16MB
log_min_duration_statement = 1000  # 1초 이상 슬로 쿼리 로깅
```

### DB 연결 풀

```go
db.SetMaxOpenConns(25)
db.SetMaxIdleConns(5)
db.SetConnMaxLifetime(5 * time.Minute)
```

---

## 3. 요청 흐름

### 일반 API 요청

```
Client (Browser)
  │
  ├── GET/POST /api/* ──> UI (Express server.cjs :3000)
  │                          │
  │                          ├── http-proxy-middleware ──> API (Go Echo :8080)
  │                          │     (keep-alive, maxSockets=100)
  │                          │              │
  │                          │              ├──> PostgreSQL :5432
  │                          │              ├──> Valkey :6379
  │                          │              └──> /data (파일시스템)
  │                          │
  │                          └── Static files (React SPA)
  │
  ├── WebSocket /api/ws ──> (프록시 -> API WebSocket Hub)
  │
  ├── WebDAV /webdav/* ──> API (직접 HTTP, Basic Auth)
  │
  └── SMB :445 ──> Samba 컨테이너 ──> /data (직접 파일 접근)
```

### Express 프록시 (server.cjs)

Express 서버는 다음 역할을 수행한다:

1. **API 프록시**: `/api/*` 요청을 API 서버(`http://api:8080`)로 프록시
2. **TUS 업로드 프록시**: `/upload/*` 요청에 대해 `Location` 헤더 재작성 처리
3. **WebSocket 프록시**: `/api/ws` WebSocket 연결 프록시
4. **SPA 라우팅**: 정적 파일이 아닌 모든 요청에 대해 `index.html` 반환
5. **OnlyOffice 설정 주입**: `/onlyoffice-config.js` 엔드포인트에서 Public URL 주입

### EXTERNAL_URL 우선순위

리버스 프록시 환경에서 올바른 URL 생성을 위한 우선순위:

```
1. EXTERNAL_URL 환경변수 (최우선)
2. X-Forwarded-Proto + X-Forwarded-Host 헤더
3. 요청의 원본 scheme/host (폴백)
```

이 우선순위는 API 서버의 `fixLocationHeader()`와 UI 서버의 `getBaseUrl()` 모두에서 동일하게 적용된다.

---

## 4. 가상 경로 시스템 (Virtual Path System)

FileHatch의 핵심 설계 패턴으로, 모든 파일 접근은 가상 경로를 통해 이루어진다.

### 가상 경로 매핑

| 가상 경로 | 실제 저장 위치 | StorageType | 설명 |
|-----------|---------------|-------------|------|
| `/home/file.txt` | `/data/users/{username}/file.txt` | `home` | 사용자 개인 폴더 |
| `/shared/teamfolder/file.txt` | `/data/shared/teamfolder/file.txt` | `shared` | 팀 공유 드라이브 |
| `/shared-with-me` | (가상, DB 조회) | `shared-with-me` | 나에게 공유된 파일 목록 |
| `/external/mount1/file.txt` | S3 또는 로컬 마운트 경로 | `external` | 외부 스토리지 |
| `/` | (가상 루트) | `root` | 스토리지 타입 목록 |

### StorageRouter 구조

```go
type StorageRouter struct {
    dataRoot         string
    db               *sql.DB
    homeBackends     map[string]*LocalBackend        // username -> backend (캐시)
    homeMu           sync.RWMutex
    sharedBackend    *LocalBackend
    externalBackends map[string]*externalBackendEntry // storageID -> backend (5분 TTL)
    externalMu       sync.RWMutex
}
```

### Resolve 흐름

```go
func (r *StorageRouter) Resolve(virtualPath string, claims *JWTClaims) (*ResolveResult, error)
```

1. `validateAndCleanPath()` - 경로 정리 및 보안 검증 (`..`, null byte, URL 인코딩 공격 차단)
2. 경로의 첫 번째 세그먼트(`home`, `shared`, `external` 등)에 따라 분기
3. 적절한 `StorageBackend` 인스턴스와 상대 경로를 포함한 `ResolveResult` 반환

### ResolveResult

```go
type ResolveResult struct {
    Backend     StorageBackend  // 스토리지 백엔드 인스턴스
    RelPath     string          // 백엔드 내 상대 경로
    StorageType string          // "home", "shared", "shared-with-me", "external", "root"
    DisplayPath string          // UI 표시용 가상 경로
    MountID     string          // 외부 스토리지 ID (내장 스토리지는 빈 문자열)
    IsReadonly  bool            // 읽기 전용 마운트 여부
}
```

### 경로 보안 검증

```go
func validateAndCleanPath(path string) (string, error) {
    // 1. filepath.Clean() 적용
    // 2. ".." 포함 여부 검사 (Path Traversal 방지)
    // 3. null byte (\x00) 검사
    // 4. 위험 패턴 검사: "..\", "..%", "%2e", "%2f", "%5c"
}

func isPathWithinRoot(resolvedPath, allowedRoot string) bool {
    // 심볼릭 링크 탈출 방지
    // 절대 경로 비교로 디렉토리 경계 검증
}
```

---

## 5. 스토리지 백엔드 추상화

### StorageBackend 인터페이스

```go
type StorageBackend interface {
    Type() string                                                        // "local" | "s3"
    IsLocal() bool                                                       // GetRealPath 지원 여부
    Stat(ctx context.Context, path string) (*StorageFileInfo, error)      // 파일 메타데이터
    List(ctx context.Context, path string) ([]StorageDirEntry, error)     // 디렉토리 목록
    ReadFile(ctx context.Context, path string) (io.ReadCloser, *StorageFileInfo, error)
    WriteFile(ctx context.Context, path string, reader io.Reader, size int64) error
    Delete(ctx context.Context, path string) error                       // 단일 파일 삭제
    DeleteAll(ctx context.Context, path string) error                    // 재귀 삭제
    Mkdir(ctx context.Context, path string) error
    Rename(ctx context.Context, oldPath, newPath string) error
    Copy(ctx context.Context, srcPath, dstPath string) error
    Walk(ctx context.Context, root string, walkFn StorageWalkFunc) error
    Exists(ctx context.Context, path string) (bool, error)
    GetRealPath(path string) (string, error)                             // 로컬 백엔드 전용
    SetPermissions(ctx context.Context, path string, isDir bool) error   // 공유 폴더 권한
    CalculateSize(ctx context.Context, path string) (int64, error)       // 크기 계산 (재귀)
    ReadDir(ctx context.Context, path string) ([]StorageDirEntry, error)
}
```

### 구현체

#### LocalBackend

```go
type LocalBackend struct {
    basePath string  // 기본 경로 (예: /data/users/admin, /data/shared)
    isShared bool    // true이면 공유 폴더 권한(0775/0664, GID 100) 적용
}
```

- 모든 경로 조작은 `resolve()` 메서드를 통해 basePath 내부인지 검증
- 공유 폴더의 경우 `SetPermissions()`에서 GID 100 (users 그룹) 설정으로 SMB 접근 보장

#### S3Backend

```go
type S3Backend struct {
    client *s3.Client
    bucket string
    prefix string  // 버킷 내 키 접두사
}

type S3Config struct {
    Endpoint       string  // MinIO 등 S3 호환 엔드포인트
    Region         string  // 기본: us-east-1
    Bucket         string  // 버킷명 (필수)
    AccessKeyID    string
    SecretAccessKey string
    PathStyle      bool    // MinIO/Ceph: true, AWS: false
    Prefix         string  // 키 접두사
}
```

- 디렉토리 시뮬레이션: `/` 접미사 오브젝트로 표현 (`folder/` 키)
- `ListObjectsV2`의 `Delimiter` 파라미터로 계층 구조 구현

#### CachedBackend (데코레이터)

```go
type CachedBackend struct {
    backend  StorageBackend
    mountID  string
    cacheTTL time.Duration  // 기본: 30초
    mu       sync.RWMutex
    cache    map[string]cacheEntry
}
```

- S3 등 원격 백엔드의 `Stat()`, `List()` 결과를 메모리 캐시
- 쓰기 작업 시 관련 캐시 엔트리 자동 무효화
- TTL 만료 시 자동 재조회

### 외부 스토리지 백엔드 생성 흐름

```
1. DB에서 external_storages 조회 (mount_path로 검색)
2. AES-GCM으로 암호화된 config_encrypted 복호화
3. backend_type에 따라 S3Backend 또는 LocalBackend 생성
4. S3의 경우 CachedBackend로 래핑
5. StorageRouter.externalBackends에 5분 TTL로 캐시
```

---

## 6. 인증 아키텍처

### JWT 인증

```go
type JWTClaims struct {
    UserID     string `json:"userId"`
    Username   string `json:"username"`
    IsAdmin    bool   `json:"isAdmin"`
    RememberMe bool   `json:"rememberMe"`
    jwt.RegisteredClaims
}
```

| 설정 | 값 |
|------|-----|
| 알고리즘 | HS256 |
| 기본 만료 | 24시간 |
| RememberMe | 30일 |
| Issuer | `filehatch` |
| Secret 소스 | `JWT_SECRET` 환경변수 (프로덕션 필수, 최소 32자) |

### 미들웨어 체인

```go
// 필수 인증 (토큰 없으면 401)
authHandler.JWTMiddleware

// 선택적 인증 (토큰 있으면 파싱, 없어도 통과)
authHandler.OptionalJWTMiddleware

// 관리자 전용 (JWTMiddleware 후에 사용)
authHandler.AdminMiddleware
```

**라우트 구성 패턴:**

```
api (공개)
  ├── POST /auth/login
  ├── GET /files (OptionalJWTMiddleware)
  └── GET /s/:token (공유 링크 접근)

authApi (인증 필수) = api + JWTMiddleware
  ├── GET /auth/profile
  ├── POST /shares
  └── GET /notifications

adminApi (관리자 전용) = authApi + AdminMiddleware
  ├── GET /admin/users
  ├── POST /admin/shared-folders
  └── PUT /admin/settings
```

### 2FA (TOTP)

```go
type TOTPHandler struct {
    db           *sql.DB
    encryptKey   []byte       // AES-256 (TOTP 시크릿 암호화)
    auditHandler *AuditHandler
}
```

- 라이브러리: `github.com/pquerna/otp`
- TOTP 시크릿은 AES-GCM으로 암호화하여 DB에 저장
- 백업 코드: 8개의 일회용 코드 (bcrypt 해시 저장)
- 로그인 흐름: `Login -> 2FA required -> Verify2FA -> JWT 발급`

### SSO (OAuth2/OIDC)

```go
type SSOProvider struct {
    ID               string  // UUID
    ProviderType     string  // "oidc", "oauth2"
    ClientID         string
    ClientSecret     string  // AES-GCM 암호화 저장
    IssuerURL        string  // OIDC Discovery
    AuthorizationURL string  // OAuth2 인증 URL
    TokenURL         string  // 토큰 교환 URL
    UserinfoURL      string  // 사용자 정보 URL
    AllowedDomains   string  // 허용 이메일 도메인 (쉼표 구분)
    AutoCreateUser   bool    // 자동 사용자 생성
}
```

- 다중 프로바이더 지원 (Keycloak, Google, GitHub 등)
- OIDC Discovery를 통한 자동 URL 설정
- OAuth2 state 파라미터로 CSRF 방지
- 허용 도메인 필터링

### Brute Force 방지

```go
type BruteForceConfig struct {
    Enabled        bool           // 기본: true
    MaxAttempts    int            // 사용자별 5회
    WindowDuration time.Duration  // 5분 윈도우
    LockDuration   time.Duration  // 15분 잠금
    IPMaxAttempts  int            // IP별 20회
    IPLockDuration time.Duration  // IP 30분 잠금
}
```

- 1차 저장소: Valkey (Redis) - 분산 추적
- 2차 저장소: `sync.Map` - Valkey 장애 시 로컬 폴백
- 잠금 해제: 관리자 API (`DELETE /admin/security/locked-users/:username`)

---

## 7. 실시간 통신

### WebSocket Hub

```
Client (Browser)
  │
  ├── WebSocket /api/ws?token={JWT}
  │
  └── Hub (싱글톤)
       ├── clients map[*Client]bool
       ├── broadcast chan FileChangeEvent (buffer: 100)
       ├── register/unregister chan *Client
       └── 이벤트 유형별 브로드캐스트
```

### Client 구조

```go
type Client struct {
    conn       *websocket.Conn
    send       chan []byte     // 클라이언트별 전송 채널 (buffer: 256)
    userID     string          // 알림 대상 지정용
    username   string
    watchPaths []string        // 감시 중인 가상 경로 목록
}
```

### 이벤트 유형

| 이벤트 | 구조체 | 전달 방식 | 설명 |
|--------|--------|----------|------|
| 파일 변경 | `FileChangeEvent` | 경로 기반 필터링 | type: create/write/remove/rename |
| 전송 진행률 | `TransferProgressEvent` | userID 대상 | 서버 사이드 전송 진행 상태 |
| 알림 | `NotificationEvent` | userID 대상 | 공유, 초대 등 알림 |
| 업로드 에러 | `UploadErrorEvent` | username 대상 | tus 업로드 완료 처리 에러 |

### 경로 기반 이벤트 필터링

```go
func (h *Hub) shouldNotify(client *Client, path string) bool {
    parentPath := filepath.Dir(path)
    for _, watchPath := range client.watchPaths {
        if path == watchPath || parentPath == watchPath || strings.HasPrefix(path, watchPath+"/") {
            return true
        }
    }
    return false
}
```

클라이언트는 `subscribe` 메시지로 감시 경로를 동적 변경 가능:

```json
{ "type": "subscribe", "paths": ["/home", "/shared/teamfolder"] }
```

### FileWatcher (fsnotify)

```go
type FileWatcher struct {
    watcher  *fsnotify.Watcher
    dataRoot string
    db       *sql.DB
}
```

- `/data` 디렉토리 재귀 감시 (`.trash`, `.uploads` 디렉토리 제외)
- 새 디렉토리 생성 시 자동으로 감시 대상 추가
- 스마트 디바운싱:
  - CREATE 직후 WRITE 이벤트 무시 (2초 윈도우)
  - 동일 타입 이벤트 500ms 내 중복 무시
  - 30초마다 디바운스 맵 정리 (메모리 누수 방지)
- 파일시스템 경로를 가상 경로로 변환: `/data/users/{username}/file.txt` -> `/home/file.txt`

---

## 8. 백그라운드 작업

| 작업 | 실행 주기 | 시작 시점 | 구현 위치 | 역할 |
|------|----------|----------|----------|------|
| 스토리지 사용량 재계산 | 시작 후 5초 (1회) | `main.go` | `handler.go` | 모든 사용자 storage_used 동기화 |
| 휴지통 자동 정리 | 24시간 | `main.go` | `trash.go` | 보관 기간 초과 항목 자동 삭제 |
| 전송 작업 정리 | 주기적 | `main.go` | `transfer_jobs.go` | 완료된 오래된 전송 작업 제거 |
| 공유 링크 만료 검사 | 1시간 | `main.go` | `share_expiration.go` | 24시간 내 만료 예정 링크 알림 |
| SMB 감사 로그 동기화 | 30초 | `main.go` | `smb_audit_handler.go` | Samba vfs_full_audit 로그 파싱 |
| 파일 감시 | 연속 (이벤트 기반) | `main.go` | `watcher.go` | fsnotify로 실시간 파일 변경 감지 |
| 웹 업로드 추적 정리 | 주기적 | `main.go` | `upload_tracker.go` | 미완료 업로드 메타데이터 정리 |
| TUS IP 추적 정리 | 주기적 | `main.go` | `upload_tracker.go` | 업로드 클라이언트 IP 매핑 정리 |
| 감사 로그 배치 쓰기 | 500ms 또는 50건 | `audit.go` | `audit.go` | 버퍼링된 감사 로그 DB 일괄 입력 |

### 감사 로그 비동기 쓰기

```go
type AuditHandler struct {
    db              *sql.DB
    baseStoragePath string
    eventCh         chan auditEntry  // buffer: 1000
    stopOnce        sync.Once
    done            chan struct{}
}
```

- 채널 기반 비동기 처리: 요청 핸들러가 감사 로그 쓰기를 기다리지 않음
- 배치 쓰기: 500ms 간격 또는 50건 누적 시 DB에 일괄 INSERT
- Graceful shutdown: `StopAuditLogger()`로 채널 닫고 잔여 버퍼 플러시

---

## 9. 핵심 Go 패턴

### Handler DI 패턴

모든 핸들러는 의존성 주입(DI) 패턴을 따른다:

```go
// 메인 핸들러 (파일 작업)
type Handler struct {
    db            *sql.DB
    dataRoot      string
    auditHandler  *AuditHandler
    storageRouter *StorageRouter
}

func NewHandler(db *sql.DB) *Handler {
    dataRoot := "/data"
    return &Handler{
        db:            db,
        dataRoot:      dataRoot,
        auditHandler:  NewAuditHandler(db, dataRoot),
        storageRouter: NewStorageRouter(dataRoot, db),
    }
}

// 공유 핸들러 (별도 의존성)
type ShareHandler struct {
    db                  *sql.DB
    dataRoot            string
    auditHandler        *AuditHandler
    notificationService *NotificationService
    storageRouter       *StorageRouter
}

// 업로드 핸들러 (tus 통합)
type UploadHandler struct {
    tusHandler     *tusd.UnroutedHandler
    dataRoot       string
    db             *sql.DB
    auditHandler   *AuditHandler
    storageRouter  *StorageRouter
}
```

### 에러 처리 패턴

```go
// 표준 에러 코드 (handlers/errors.go)
const (
    ErrCodeUnauthorized    ErrorCode = "UNAUTHORIZED"      // 401
    ErrCodeForbidden       ErrorCode = "FORBIDDEN"          // 403
    ErrCodeNotFound        ErrorCode = "NOT_FOUND"          // 404
    ErrCodeBadRequest      ErrorCode = "BAD_REQUEST"        // 400
    ErrCodeQuotaExceeded   ErrorCode = "QUOTA_EXCEEDED"     // 403
    ErrCodeFileLocked      ErrorCode = "FILE_LOCKED"        // 409
    ErrCodeInternal        ErrorCode = "INTERNAL_ERROR"     // 500
)

// APIError 구조체
type APIError struct {
    Code    ErrorCode   `json:"code"`
    Message string      `json:"message"`
    Details interface{} `json:"details,omitempty"`
}

// 편의 헬퍼 함수
RespondSuccess(c, data)     // 200 OK
RespondCreated(c, data)     // 201 Created
RespondError(c, apiError)   // 에러 코드에 맞는 HTTP 상태
```

### 인증 헬퍼

```go
// JWT Claims 추출
claims := GetClaims(c)              // nil 가능 (OptionalJWT에서 사용)
claims, err := RequireClaims(c)     // 인증 필수 (없으면 401)
claims, err := RequireAdmin(c)      // 관리자 필수 (아니면 403)
```

### 미들웨어 체인 구성 (main.go)

```go
// 글로벌 미들웨어
e.Use(middleware.RequestLogger(...))         // 요청 로깅
e.Use(middleware.Recover())                  // 패닉 복구
e.Use(middleware.CORSWithConfig(...))        // CORS
e.Use(middleware.SecureWithConfig(...))       // 보안 헤더 (설정에 따라)
e.Use(middleware.RateLimiter(...))           // 속도 제한 (설정에 따라)

// 라우트 그룹별 미들웨어
api := e.Group("/api")                       // 공개 API
authApi := api.Group("", JWTMiddleware)      // 인증 필수
adminApi := authApi.Group("", AdminMiddleware) // 관리자 전용
```

### 입력 검증 (handlers/validation.go)

```go
ValidateUsername(s)   // 3-50자, 영문/숫자/_
ValidatePassword(s)   // 8자+, 대소문자+숫자
ValidateFilename(s)   // 위험문자 < > : " / \ | ? * 금지
ValidatePath(s)       // Path Traversal 방지
```

---

## 10. 핵심 프론트엔드 패턴

### Zustand 스토어 (6개)

| 스토어 | 파일 | Persist | 역할 |
|--------|------|---------|------|
| `useAuthStore` | `authStore.ts` | O | JWT 토큰, 사용자 정보, 로그인/로그아웃, 2FA/SSO 흐름 |
| `useUploadStore` | `uploadStore.ts` | X | tus 업로드 큐, 진행률, 일시정지/재개, 중복 검사 |
| `useTransferStore` | `transferStore.ts` | O | 서버 사이드 전송 작업 (복사/이동/압축/삭제) 상태 |
| `useNotificationStore` | `notificationStore.ts` | X | WebSocket 알림 수신, 새 알림 트리거 |
| `usePreferencesStore` | `preferencesStore.ts` | O | 사이드바 순서, 숨김 항목, 기본 랜딩 페이지 |
| `useToastStore` | `toastStore.ts` | X | 토스트 메시지 큐 (success/error/warning/info) |

### React Query 설정

- 서버 상태 관리: `@tanstack/react-query` v5
- `staleTime`: 60초 (기본값)
- `gcTime`: 5분 (가비지 컬렉션)
- 주요 쿼리 키: `files`, `shares`, `notifications`, `sharedFolders`, `audit`

### Custom Hooks (16개)

| Hook | 파일 | 역할 |
|------|------|------|
| `useFileOperations` | `useFileOperations.ts` | 파일 CRUD 작업 (생성, 이름변경, 삭제, 이동, 복사) |
| `useFileWatcher` | `useFileWatcher.ts` | WebSocket 기반 실시간 파일 변경 감시 |
| `useFileUploadDragDrop` | `useFileUploadDragDrop.ts` | 드래그 앤 드롭 파일/폴더 업로드 |
| `useFileDragMove` | `useFileDragMove.ts` | 드래그 앤 드롭으로 파일 이동 |
| `useFileHistory` | `useFileHistory.ts` | 경로 탐색 히스토리 (뒤로/앞으로) |
| `useFileMetadata` | `useFileMetadata.ts` | 파일 설명, 태그 관리 |
| `useNotifications` | `useNotifications.ts` | 알림 목록 조회/읽음 처리 |
| `useSharedFolders` | `useSharedFolders.ts` | 공유 폴더 목록/권한 관리 |
| `useExternalStorages` | `useExternalStorages.ts` | 외부 스토리지 목록 |
| `useStarredAndLocked` | `useStarredAndLocked.ts` | 즐겨찾기 및 파일 잠금 상태 |
| `useLocalSearch` | `useLocalSearch.ts` | 클라이언트 사이드 파일 검색/필터 |
| `useKeyboardNavigation` | `useKeyboardNavigation.ts` | 키보드 파일 탐색 (방향키, Enter, Backspace) |
| `useMarqueeSelection` | `useMarqueeSelection.ts` | 마우스 드래그 범위 선택 |
| `useClipboard` | `useClipboard.ts` | Ctrl+C/V 파일 복사/붙여넣기 |
| `useModalKeyboard` | `useModalKeyboard.ts` | 모달 키보드 상호작용 (Escape, Enter) |
| `useToast` | `useToast.ts` | 토스트 메시지 표시 |

### API Layer 패턴 (`ui/src/api/`)

```typescript
const API_BASE = '/api'

function getAuthHeaders(): HeadersInit {
    const token = useAuthStore.getState().token
    return token ? { 'Authorization': `Bearer ${token}` } : {}
}

export async function apiFunction(params: T): Promise<R> {
    const res = await fetch(`${API_BASE}/endpoint`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    })
    if (!res.ok) throw new Error('Failed')
    return res.json()
}
```

### 가상화 (대용량 파일 목록)

- `@tanstack/react-virtual` v3 사용
- `FixedSizeList` 기반 가상 스크롤링
- 수천 개 파일이 있는 디렉토리에서도 일정한 렌더링 성능

### 업로드 아키텍처

```
사용자 파일 선택/드래그
  │
  ├── 중복 검사 (API: /files/check)
  │     ├── 중복 → 사용자에게 덮어쓰기/건너뛰기/이름변경 선택
  │     └── 신규 → 업로드 큐 추가
  │
  ├── 쿼터 사전 검사 (캐시된 storage_used vs quota)
  │
  └── tus 업로드 시작
        ├── POST /api/upload/ (업로드 생성, Location 헤더로 ID 수신)
        ├── PATCH /api/upload/{id} (청크 전송, Upload-Offset)
        ├── 이어받기: URL Storage에 업로드 ID 저장
        │     └── 브라우저 새로고침 후 HEAD 요청으로 이어받기
        └── 완료 시: 서버에서 .uploads/ -> 최종 경로로 이동
              └── WebSocket으로 FileChangeEvent 브로드캐스트
```

**동시 업로드**: 최대 3개 (`MAX_CONCURRENT_UPLOADS`)

---

## 11. 데이터베이스 스키마

### 마이그레이션 시스템

- 위치: `api/database/migrations/`
- 자동 실행: API 시작 시 `database.RunMigrations(db)` 호출
- 순서: `schema_migrations` 테이블의 version 값 기준 정렬
- 멱등성: 모든 DDL에 `IF NOT EXISTS`, `ON CONFLICT DO NOTHING` 사용

### 마이그레이션 파일 목록

| 파일 | 설명 |
|------|------|
| `000_schema_migrations.sql` | 마이그레이션 추적 테이블 |
| `001_initial_schema.sql` | 핵심 테이블 (users, shares, shared_folders 등) |
| `002_default_data.sql` | 기본 시스템 설정 |
| `003_external_storages.sql` | 외부 스토리지 테이블 |
| `004_fix_external_storage_fk.sql` | FK 수정 |
| `005_user_preferences.sql` | 사용자 환경설정 |
| `006_hidden_recent_items.sql` | 최근 항목 숨기기 |
| `007_transfer_jobs.sql` | 서버 사이드 전송 작업 |
| `008_transfer_jobs_delete.sql` | 전송 작업 삭제 지원 |

### 핵심 테이블 관계

```
users
  ├── 1:N ── shares (공유 링크)
  ├── 1:N ── file_shares (사용자 간 파일 공유)
  ├── 1:N ── shared_folder_members (공유 폴더 멤버십)
  ├── 1:N ── notifications
  ├── 1:N ── audit_logs
  ├── 1:N ── user_preferences
  ├── 1:N ── starred_files
  ├── 1:N ── file_locks
  ├── 1:N ── file_metadata
  ├── 1:N ── trash_items
  ├── 1:N ── transfer_jobs
  └── 1:N ── external_storage_access

shared_folders
  └── 1:N ── shared_folder_members

external_storages
  └── 1:N ── external_storage_access

sso_providers (독립)
system_settings (key-value)
```

---

## 12. 보안 아키텍처

### 인증 체계 요약

```
1단계: 사용자명/비밀번호 (bcrypt)
  └── 또는 SSO (OAuth2/OIDC)
2단계: 2FA TOTP (선택, pquerna/otp)
  └── 백업 코드 (bcrypt 해시)
결과: JWT 토큰 발급 (HS256, 24h/30d)
```

### API 보안 미들웨어

```
요청 → Rate Limiter → CORS → Security Headers → JWT Auth → Handler
```

| 미들웨어 | 설정 |
|---------|------|
| Rate Limiter | 설정 가능 RPS (기본 비활성) |
| CORS | `CORS_ALLOWED_ORIGINS` 환경변수 |
| Security Headers | CSP, HSTS, X-Frame-Options, XSS Protection (관리자 설정으로 토글) |
| JWT | HS256, `JWT_SECRET` 환경변수 |

### 암호화

| 대상 | 알고리즘 | 키 소스 |
|------|---------|--------|
| JWT 토큰 서명 | HS256 | `JWT_SECRET` 환경변수 |
| 비밀번호 해시 | bcrypt | - |
| TOTP 시크릿 | AES-256-GCM | `TOTP_ENCRYPTION_KEY` 또는 `JWT_SECRET` |
| SSO Client Secret | AES-256-GCM | `ENCRYPTION_KEY` 환경변수 |
| 외부 스토리지 설정 | AES-256-GCM | `ENCRYPTION_KEY` 환경변수 |
| SMB 비밀번호 | AES-256-GCM | `SMB_ENCRYPTION_KEY` 환경변수 |

### 경로 보안 검증 체크리스트

1. `filepath.Clean()` 적용
2. `..` 문자열 포함 여부 확인
3. null byte (`\x00`) 포함 여부 확인
4. URL 인코딩 우회 시도 검사 (`%2e`, `%2f`, `%5c`)
5. `isPathWithinRoot()` - 절대 경로가 허용된 루트 내에 있는지 검증
6. 심볼릭 링크 탈출 방지

---

## 13. 접근 프로토콜

### HTTP/WebSocket (웹 UI)

| 경로 패턴 | 메서드 | 인증 | 설명 |
|-----------|--------|------|------|
| `/api/files` | GET | Optional JWT | 파일 목록 |
| `/api/files/*` | GET/DELETE | Optional JWT | 파일 다운로드/삭제 |
| `/api/upload/` | POST/PATCH/HEAD | TUS 메타데이터 | 이어받기 업로드 |
| `/api/transfers` | GET/POST/DELETE | JWT | 서버 사이드 전송 |
| `/api/ws` | WebSocket | Query param token | 실시간 이벤트 |
| `/api/s/:token` | GET/POST | Optional JWT | 공유 링크 접근 |
| `/api/u/:token` | GET/POST | Optional JWT | 업로드 링크 접근 |
| `/api/e/:token` | GET/POST | Optional JWT | 편집 공유 링크 |

### WebDAV

```
/webdav/{home,shared,external}/* - Basic Auth (application password)
```

- `golang.org/x/net/webdav` 기반
- HTTP Basic Auth (사용자별 application password)
- 라우팅: Echo 이전에 `combinedHandler`에서 `/webdav` 경로 분기
- macOS Finder, Windows Explorer, Linux 파일 관리자에서 직접 마운트 가능

### SMB/CIFS

```
\\{server}\{username}  - 개인 홈 폴더
\\{server}\shared      - 공유 드라이브
```

- Samba 컨테이너가 host network 모드로 실행
- 포트: 445 (SMB), 139 (NetBIOS)
- 인증: Samba 자체 사용자 DB (API를 통해 관리)
- 감사: `vfs_full_audit` + API의 `SMBAuditHandler`가 30초마다 로그 동기화
- 권한: 공유 폴더는 GID 100 (users 그룹), 0775/0664 퍼미션

---

## 14. 환경 변수 참조

### 필수 (프로덕션)

| 변수 | 설명 | 예시 |
|------|------|------|
| `JWT_SECRET` | JWT 서명 키 (32자 이상) | `your-random-secret-key-here` |
| `DB_PASS` | PostgreSQL 비밀번호 | `strong-password` |
| `ENCRYPTION_KEY` | AES 암호화 키 | `32-byte-encryption-key-here` |

### 선택

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DB_HOST` | `db` | PostgreSQL 호스트 |
| `DB_PORT` | `5432` | PostgreSQL 포트 |
| `DB_USER` | `fh_user` | PostgreSQL 사용자 |
| `DB_NAME` | `fh_main` | PostgreSQL 데이터베이스명 |
| `VALKEY_HOST` | `valkey` | Valkey 호스트 |
| `VALKEY_PORT` | `6379` | Valkey 포트 |
| `EXTERNAL_URL` | (없음) | 외부 접근 URL (리버스 프록시) |
| `CORS_ALLOWED_ORIGINS` | `*` (prod: 없음) | CORS 허용 오리진 (쉼표 구분) |
| `ALLOWED_ORIGINS` | (없음) | WebSocket 허용 오리진 |
| `ONLYOFFICE_INTERNAL_URL` | `http://onlyoffice` | OnlyOffice 내부 URL |
| `ONLYOFFICE_PUBLIC_URL` | (없음) | OnlyOffice 공개 URL |
| `UI_PORT` | `3080` | UI 외부 포트 |
| `FH_ENV` | (없음) | `production`으로 설정 시 보안 강화 |
| `TZ` | `Asia/Seoul` | 타임존 |
| `IMAGE_TAG` | `latest` | Docker 이미지 태그 |

---

## 15. 디렉토리 구조 참조

```
FileHatch/
├── api/
│   ├── main.go                    # 엔트리포인트, 라우트 정의
│   ├── version.go                 # 버전 정보 (0.10.1)
│   ├── database/
│   │   ├── database.go            # DB 연결
│   │   └── migrations/            # SQL 마이그레이션 파일
│   ├── handlers/
│   │   ├── handler.go             # 메인 핸들러 (Handler struct, ListFiles, resolvePath)
│   │   ├── auth.go                # 인증 (AuthHandler, JWT, 로그인/등록)
│   │   ├── auth_bruteforce.go     # Brute Force 방지 (Valkey 기반)
│   │   ├── totp.go                # 2FA TOTP (pquerna/otp)
│   │   ├── sso.go                 # SSO/OIDC 프로바이더
│   │   ├── storage_router.go      # 가상 경로 -> 백엔드 라우팅
│   │   ├── storage_backend.go     # StorageBackend 인터페이스
│   │   ├── storage_local.go       # LocalBackend 구현
│   │   ├── storage_s3.go          # S3Backend 구현
│   │   ├── storage_cache.go       # CachedBackend 데코레이터
│   │   ├── upload.go              # tus 업로드 핸들러
│   │   ├── transfer_jobs.go       # 서버 사이드 전송 큐
│   │   ├── websocket.go           # WebSocket Hub, Client
│   │   ├── watcher.go             # fsnotify 파일 감시
│   │   ├── share.go               # 공유 링크
│   │   ├── file_share_handler.go  # 사용자 간 파일 공유
│   │   ├── shared_folder_handler.go # 팀 공유 폴더
│   │   ├── trash.go               # 휴지통
│   │   ├── audit.go               # 감사 로그 (비동기 배치)
│   │   ├── notification_service.go # 알림 서비스
│   │   ├── errors.go              # 표준 에러 코드/응답
│   │   ├── validation.go          # 입력 검증
│   │   ├── permissions.go         # 권한 체크
│   │   ├── webdav.go              # WebDAV 핸들러
│   │   ├── onlyoffice.go          # OnlyOffice 통합
│   │   └── smb*.go                # SMB 관련 핸들러
│   └── go.mod                     # Go 모듈 정의
│
├── ui/
│   ├── server.cjs                 # Express 프록시 서버
│   ├── package.json               # npm 의존성 (v0.10.1)
│   └── src/
│       ├── api/                   # API 호출 함수
│       ├── stores/                # Zustand 스토어 (6개)
│       ├── hooks/                 # Custom Hooks (16개)
│       └── components/            # React 컴포넌트
│
├── docker-compose.yml             # 프로덕션 Docker Compose
├── docker-compose-dev.yaml        # 개발용 Docker Compose
├── db/init.sql                    # DB 스키마 (레거시, 마이그레이션으로 대체)
└── scripts/test.sh                # 테스트 스크립트
```
