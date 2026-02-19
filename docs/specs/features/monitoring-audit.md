# 시스템 모니터링 & 감사 로그 명세

## 1. 시스템 개요

FileHatch의 시스템 모니터링 및 감사 로그 기능은 관리자에게 시스템 상태 파악, 사용자 활동 추적, 보안 이벤트 감시를 위한 통합 도구를 제공한다.

핵심 구성 요소:

| 구성 요소 | 설명 | 핵심 파일 |
|-----------|------|-----------|
| 감사 로그 시스템 | 비동기 버퍼 기반 이벤트 기록 | `api/handlers/audit.go` |
| SMB 감사 로그 | Samba vfs_full_audit 로그 파싱 및 동기화 | `api/handlers/smb_audit_handler.go` |
| 시스템 정보 모니터링 | CPU, 메모리, 디스크, 폴더 트리 조회 | `api/handlers/system_info.go` |
| 시스템 설정 관리 | 보안 헤더, Rate Limiting, 세션 등 관리 | `api/handlers/settings.go` |

---

## 2. 감사 로그 시스템

### 2.1 아키텍처

감사 로그는 **비동기 버퍼 채널 + 배치 플러시** 구조로 동작한다. 핸들러에서 `LogEventFromContext()`를 호출하면, 이벤트가 버퍼 채널에 즉시 enqueue되고 백그라운드 goroutine이 주기적으로 DB에 배치 삽입한다.

```
[핸들러] --LogEventFromContext()--> [버퍼 채널 (cap: 1000)] --flushLoop()--> [DB audit_logs]
                                          |
                                   최대 50건 또는 500ms 간격으로 배치 플러시
                                          |
                              버퍼 가득 참 시 동기 INSERT 폴백
```

### 2.2 핵심 파라미터

| 파라미터 | 값 | 설명 |
|----------|----|------|
| `auditBufferSize` | 1000 | 버퍼 채널 용량 |
| 배치 크기 | 50 | 한 번에 플러시하는 최대 로그 수 |
| `auditFlushInterval` | 500ms | 배치가 가득 차지 않아도 플러시하는 최대 대기 시간 |
| DB 타임아웃 | 5초 | 배치 INSERT 트랜잭션 컨텍스트 타임아웃 |

### 2.3 배치 처리 상세

```go
// 단건 빠른 경로 (1건일 때 트랜잭션 없이 직접 INSERT)
if len(entries) == 1 {
    db.Exec(`INSERT INTO audit_logs ...`, ...)
    return
}

// 다건 배치 경로 (트랜잭션 + Prepared Statement)
tx, _ := db.BeginTx(ctx, nil)
stmt, _ := tx.PrepareContext(ctx, `INSERT INTO audit_logs ...`)
for _, e := range entries {
    stmt.ExecContext(ctx, ...)
}
tx.Commit()
```

- 단건일 때: 트랜잭션 오버헤드 없이 직접 INSERT (빠른 경로)
- 다건일 때: Prepared Statement + 트랜잭션으로 배치 INSERT
- 채널 가득 참 시: `select default` 분기에서 동기 INSERT로 폴백 (데이터 유실 방지)

### 2.4 Graceful Shutdown

서버 종료 시 `StopAuditLogger()`가 호출되어 채널을 닫고, `flushLoop`가 남은 버퍼를 모두 플러시한 뒤 `done` 채널로 완료를 알린다. `sync.Once`로 중복 호출을 방지한다.

```go
func (h *AuditHandler) StopAuditLogger() {
    h.stopOnce.Do(func() {
        close(h.eventCh)
        <-h.done // flush goroutine 완료 대기
    })
}
```

### 2.5 이벤트 유형

#### 파일 이벤트

| 이벤트 타입 | 상수 | 설명 |
|-------------|------|------|
| `file.view` | `EventFileView` | 파일 조회 (미리보기) |
| `file.download` | `EventFileDownload` | 파일 다운로드 |
| `file.upload` | `EventFileUpload` | 파일 업로드 |
| `file.edit` | `EventFileEdit` | 파일 편집 |
| `file.delete` | `EventFileDelete` | 파일 삭제 |
| `file.rename` | `EventFileRename` | 파일 이름 변경 |
| `file.copy` | `EventFileCopy` | 파일 복사 |
| `file.move` | `EventFileMove` | 파일 이동 |
| `file.overwrite` | `EventFileOverwrite` | 파일 덮어쓰기 |
| `folder.create` | `EventFolderCreate` | 폴더 생성 |
| `folder.delete` | `EventFolderDelete` | 폴더 삭제 |

#### SMB 이벤트

| 이벤트 타입 | 상수 | 설명 |
|-------------|------|------|
| `smb.create` | `EventSMBCreate` | SMB를 통한 파일 생성 |
| `smb.modify` | `EventSMBModify` | SMB를 통한 파일 수정 |
| `smb.delete` | `EventSMBDelete` | SMB를 통한 파일 삭제 |
| `smb.rename` | `EventSMBRename` | SMB를 통한 파일 이름 변경 |

#### 사용자/공유 이벤트

| 이벤트 타입 | 상수 | 설명 |
|-------------|------|------|
| `user.login` | `EventUserLogin` | 사용자 로그인 |
| `user.logout` | `EventUserLogout` | 사용자 로그아웃 |
| `share.create` | `EventShareCreate` | 공유 링크 생성 |
| `share.access` | `EventShareAccess` | 공유 링크 접근 |
| `share.delete` | `EventShareDelete` | 공유 링크 삭제 |

#### 관리자 이벤트

| 이벤트 타입 | 상수 | 설명 |
|-------------|------|------|
| `admin.user.create` | `EventAdminUserCreate` | 관리자: 사용자 생성 |
| `admin.user.update` | `EventAdminUserUpdate` | 관리자: 사용자 수정 |
| `admin.user.delete` | `EventAdminUserDelete` | 관리자: 사용자 삭제 |
| `admin.user.activate` | `EventAdminUserActivate` | 관리자: 사용자 활성화 |
| `admin.user.deactivate` | `EventAdminUserDeactivate` | 관리자: 사용자 비활성화 |
| `admin.smb.enable` | `EventAdminSMBEnable` | 관리자: SMB 활성화 |
| `admin.smb.disable` | `EventAdminSMBDisable` | 관리자: SMB 비활성화 |
| `admin.settings.update` | `EventAdminSettingsUpdate` | 관리자: 설정 변경 |

#### 보안 이벤트

| 이벤트 타입 | 상수 | 설명 |
|-------------|------|------|
| `security.login_failed` | `EventLoginFailed` | 로그인 실패 |
| `security.login_blocked` | `EventLoginBlocked` | 로그인 차단 |
| `security.account_locked` | `EventAccountLocked` | 계정 잠금 |
| `security.account_unlocked` | `EventAccountUnlocked` | 계정 잠금 해제 |
| `security.ip_locked` | `EventIPLocked` | IP 잠금 |
| `security.ip_unlocked` | `EventIPUnlocked` | IP 잠금 해제 |

### 2.6 로그 기록 방법

```go
// 방법 1: Echo 컨텍스트에서 자동으로 사용자/IP 추출
auditHandler.LogEventFromContext(c, EventFileUpload, filePath, map[string]interface{}{
    "filename": filename,
    "size":     fileSize,
    "mime":     mimeType,
})

// 방법 2: 직접 actorID 지정 (SMB 등 비-HTTP 컨텍스트)
auditHandler.LogEvent(&userID, ipAddr, "smb_create", auditPath, map[string]interface{}{
    "smbShare":  shareName,
    "smbClient": hostname,
    "operation": operation,
})
```

### 2.7 로그 조회 (필터링)

`ListAuditLogs` 핸들러가 다음 필터를 지원한다.

| 쿼리 파라미터 | 타입 | 설명 |
|---------------|------|------|
| `category` | string | 카테고리 필터: `file`, `admin`, `user` |
| `eventType` | string | 특정 이벤트 타입 (예: `file.upload`) |
| `resource` | string | 대상 리소스 경로 (LIKE 검색) |
| `startDate` | string | 시작일 (`YYYY-MM-DD` 형식) |
| `endDate` | string | 종료일 (`YYYY-MM-DD` 형식, 해당일 포함) |
| `limit` | int | 조회 수 (기본: 100, 최대: 500) |
| `offset` | int | 페이지네이션 오프셋 |

카테고리별 필터 매핑:

| 카테고리 | 포함 이벤트 패턴 |
|----------|-----------------|
| `file` | `file.%`, `folder.%`, `smb.%`, `smb_%` |
| `admin` | `admin.%` |
| `user` | `user.%`, `share.%` |

응답에는 `logs` 배열과 함께 `total` (전체 건수), `limit`, `offset`이 포함되어 프론트엔드 페이지네이션을 지원한다.

### 2.8 불변성 규칙

감사 로그는 **불변(immutable)** 이다. 한 번 기록된 로그는 수정하거나 삭제할 수 없다. 보관 기간(`audit_log_retention_days`, 기본 365일)이 지난 로그만 자동 정리 대상이다.

---

## 3. 리소스 활동 추적

### 3.1 개요

특정 파일/폴더의 전체 활동 이력을 조회하는 기능이다. 파일별로 누가 언제 어떤 작업을 했는지 추적할 수 있다.

### 3.2 동작 방식

`GetResourceHistory` 핸들러가 `target_resource` 컬럼을 기준으로 정확히 일치하는 경로 및 하위 경로를 모두 조회한다.

```sql
SELECT ... FROM audit_logs al
LEFT JOIN users u ON al.actor_id = u.id
WHERE al.target_resource = $1 OR al.target_resource LIKE $2
ORDER BY al.ts DESC
LIMIT 100
```

- 정확한 경로 일치 (`$1`): 해당 리소스 자체의 이벤트
- 하위 경로 (`$2`): 해당 폴더 내부의 모든 이벤트 (예: `/home/admin/docs/` 이하)

### 3.3 경로 변환

사용자에게 보이는 표시 경로(display path)를 실제 파일시스템 경로(real path)로 변환하는 `resolveDisplayPath()` 함수가 제공된다.

| 표시 경로 | 실제 경로 |
|-----------|-----------|
| `/home/{username}/...` | `{baseStoragePath}/users/{username}/...` |
| `/shared/...` | `{baseStoragePath}/shared/...` |
| `/shared-drives/...` | `{baseStoragePath}/shared/...` |

### 3.4 최근 파일 (내 작업)

현재 사용자의 최근 활동 파일 목록을 조회하는 기능이다. `GetRecentFiles` 핸들러가 처리한다.

추적 대상 이벤트 타입:
- `file.upload`, `file.download`, `file.view`, `file.edit`
- `file.copy`, `file.move`, `file.rename`
- `folder.create`, `trash.restore`

특징:
- `DISTINCT ON (target_resource)`으로 파일당 가장 최근 이벤트만 반환
- `hidden_recent_items` 테이블과 LEFT JOIN하여 사용자가 숨긴 항목 제외
- 파일시스템에서 실제 존재 여부를 확인하여 삭제된 파일은 자동 제외
- 파일 크기와 디렉토리 여부는 실제 파일시스템에서 조회

숨기기/전체 삭제:
- `HideRecentItem`: 특정 파일을 최근 목록에서 숨김
- `ClearRecentItems`: 현재 모든 최근 항목을 숨김

---

## 4. SMB 감사 로그

### 4.1 개요

Samba의 `vfs_full_audit` 모듈이 생성한 감사 로그 파일을 주기적으로 파싱하여 FileHatch의 감사 로그 DB에 통합한다.

### 4.2 아키텍처

```
[Samba (vfs_full_audit)] --> /etc/filehatch/smb_audit.log
                                       |
                              [SMBAuditHandler.ProcessAuditLog()]
                                       | (30초 간격 백그라운드 동기화)
                                       v
                              [AuditHandler.LogEvent()] --> [audit_logs DB]
```

### 4.3 로그 형식

rsyslog 형식의 SMB 감사 로그를 파싱한다.

```
2025-12-25T22:57:49.939325+09:00 HOSTNAME smbd_audit: SMB_AUDIT|username|clientIP|hostname|sharename|operation|status|filepath
```

`SMB_AUDIT|` 마커 이후 파이프(`|`) 구분자로 필드를 분리한다.

| 필드 순서 | 내용 | 예시 |
|-----------|------|------|
| 0 | 사용자명 | `admin` |
| 1 | 클라이언트 IP | `192.168.1.100` |
| 2 | 호스트명 | `DESKTOP-ABC` |
| 3 | 공유 이름 | `shared`, `admin` |
| 4 | 작업 | `openat`, `mkdirat`, `unlinkat`, `renameat` |
| 5 | 상태 | `ok`, `fail` |
| 6+ | 파일 경로 (openat: mode + path) | `w`, `/data/users/admin/doc.txt` |

### 4.4 작업 매핑

Samba 4.22+의 작업명을 감사 액션으로 매핑한다.

| SMB 작업 | 감사 액션 | 설명 |
|----------|-----------|------|
| `open`, `openat` | `smb_create` | 파일 열기/생성 (쓰기 모드만 기록) |
| `read`, `close` | `smb_read` | 파일 읽기 (기록에서 제외) |
| `write`, `pwrite` | `smb_write` | 파일 쓰기 |
| `mkdir`, `mkdirat` | `smb_mkdir` | 폴더 생성 |
| `rmdir` | `smb_rmdir` | 폴더 삭제 |
| `unlink`, `unlinkat` | `smb_delete` | 파일 삭제 |
| `rename`, `renameat` | `smb_rename` | 이름 변경 |

### 4.5 노이즈 필터링

다음 작업은 로그에서 자동 제외한다:
- `read` / `close` 작업: 파일 접근 자체는 기록하지 않음
- `openat`의 읽기 모드(`r`): 읽기 전용 열기는 노이즈이므로 제외

### 4.6 경로 변환

SMB 작업의 파일시스템 경로를 FileHatch의 논리 경로로 변환한다.

| 공유 이름 | 파일시스템 경로 | 논리 경로 |
|-----------|----------------|-----------|
| `shared` | `/data/shared/...` | `/shared-drives/...` |
| 기타 (사용자 이름) | `/data/users/{username}/...` | `/home/{username}/...` |

### 4.7 백그라운드 동기화

`StartBackgroundSync()`가 30초 간격으로 `ProcessAuditLog()`를 호출한다.

| 항목 | 값 |
|------|----|
| 동기화 간격 | 30초 |
| 로그 파일 위치 | `/etc/filehatch/smb_audit.log` |
| 위치 추적 | `lastPosition` (마지막 읽기 위치) |
| 로그 로테이션 대응 | Seek 실패 시 처음부터 다시 읽기 |

- `mutex`로 동시 처리 방지
- `context.Context`를 통한 graceful shutdown 지원
- 로그 파일 미존재 시 오류 없이 무시 (`os.IsNotExist`)

### 4.8 수동 동기화

관리자가 즉시 동기화를 트리거할 수 있다.

```
POST /api/admin/smb/audit/sync
```

응답: `{ "processed": 15, "message": "Processed 15 SMB audit entries" }`

---

## 5. 시스템 정보 모니터링

### 5.1 개요

관리자 전용 시스템 상태 대시보드로, 서버의 하드웨어/소프트웨어 정보와 프로젝트 통계를 실시간으로 제공한다.

### 5.2 수집 정보

#### 서버 기본 정보

| 항목 | 소스 | 설명 |
|------|------|------|
| `hostname` | `os.Hostname()` | 서버 호스트명 |
| `os` | `runtime.GOOS` | 운영체제 (`linux`) |
| `arch` | `runtime.GOARCH` | 아키텍처 (`amd64`) |
| `cpus` | `runtime.NumCPU()` | CPU 코어 수 |
| `goVersion` | `runtime.Version()` | Go 런타임 버전 |
| `uptime` | `time.Since(startTime)` | 프로세스 가동 시간 |
| `serverTime` | `time.Now()` | 현재 서버 시간 (`2006-01-02 15:04:05 MST`) |

#### 메모리 정보 (`MemoryInfo`)

Linux의 `/proc/meminfo`에서 읽는다. 읽기 실패 시 Go 런타임의 `runtime.MemStats`로 폴백한다.

| 필드 | 소스 | 설명 |
|------|------|------|
| `total` | `MemTotal` | 전체 물리 메모리 (bytes) |
| `free` | `MemAvailable` (우선) 또는 `MemFree` | 사용 가능 메모리 |
| `used` | `total - free` | 사용 중 메모리 |
| `usedPct` | `used / total * 100` | 사용률 (%) |
| `formatted` | `formatBytes()` | 사람이 읽기 쉬운 형식 (예: "4.52 GB") |

#### 디스크 정보 (`DiskInfo`)

`syscall.Statfs()`를 사용하여 데이터 루트 경로의 디스크 사용량을 조회한다.

| 필드 | 소스 | 설명 |
|------|------|------|
| `total` | `Blocks * Bsize` | 전체 디스크 용량 |
| `free` | `Bavail * Bsize` | 사용 가능 용량 |
| `used` | `total - free` | 사용 중 용량 |
| `usedPct` | `used / total * 100` | 사용률 (%) |

#### 프로젝트 통계 (`ProjectInfo`)

| 필드 | 소스 | 설명 |
|------|------|------|
| `totalFiles` | `filepath.Walk` | 전체 파일 수 |
| `totalFolders` | `filepath.Walk` | 전체 폴더 수 |
| `totalSize` | `filepath.Walk` | 전체 사용 용량 (bytes) |
| `usersCount` | `SELECT COUNT(*) FROM users` | 등록된 사용자 수 |
| `sharedFolders` | `SELECT COUNT(*) FROM shared_folders WHERE is_active = true` | 활성 공유 폴더 수 |

### 5.3 폴더 트리 (`FolderStat`)

데이터 루트 하위의 폴더 구조와 용량을 트리 형태로 제공한다.

동작 방식:
- 초기 로드: 최대 2단계 깊이로 조회
- 동적 확장: 관리자가 폴더 클릭 시 하위 1단계를 API로 추가 조회 (최대 5단계)
- 숨김 파일(`.`으로 시작) 자동 제외
- 크기 기준 내림차순 정렬

```typescript
interface FolderStat {
  name: string       // 폴더/파일명
  path: string       // 절대 경로
  size: number       // 바이트 크기
  formatted: string  // 사람이 읽기 쉬운 크기 (예: "1.23 GB")
  fileCount: number  // 내부 파일 수
  isDir: boolean     // 디렉토리 여부
  children?: FolderStat[]  // 하위 항목
}
```

### 5.4 자동 새로고침

프론트엔드(`AdminSystemInfo`)에서 **30초 간격**으로 자동 새로고침한다.

```typescript
const interval = setInterval(loadSystemInfo, 30000)
```

---

## 6. 시스템 로그 (Docker 컨테이너 로그)

### 6.1 개요

Docker 컨테이너의 실시간 로그를 관리자 대시보드에서 확인할 수 있다.

### 6.2 지원 컨테이너

| 별칭 | 컨테이너 이름 | 설명 |
|------|--------------|------|
| `api` | `fh-api` | FileHatch API 서버 |
| `ui` | `fh-ui` | 프론트엔드 서버 |
| `db` | `fh-db` | PostgreSQL 데이터베이스 |
| `valkey` | `fh-valkey` | Valkey (Redis 호환) 캐시 |

### 6.3 로그 레벨 감지

로그 메시지에서 자동으로 레벨을 감지한다.

1. **Echo 액세스 로그 (JSON)**: HTTP 상태 코드 기반
   - `status >= 500`: `error`
   - `status >= 400`: `warn`
   - `error` 필드 존재: `error`
   - 그 외: `info`
2. **일반 로그**: 정규식 `(?i)^.*?\b(fatal|error|warn(?:ing)?|info|debug)\b`으로 레벨 추출

### 6.4 필터링

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `container` | string | 전체 | 컨테이너 필터 (`api`, `ui`, `db`, `valkey`) |
| `level` | string | 전체 | 로그 레벨 필터 (`info`, `warn`, `error`, `fatal`) |
| `tail` | int | 200 | 조회할 로그 줄 수 (최대 1000) |

### 6.5 동작 방식

내부적으로 `docker logs --tail {N} --timestamps {container}` 명령을 실행하여 로그를 수집한다. 여러 컨테이너의 로그를 타임스탬프 기준 내림차순으로 병합하여 반환한다.

---

## 7. 시스템 설정 관리

### 7.1 개요

시스템 전역 설정을 키-값 형태로 관리한다. DB의 `system_settings` 테이블에 저장하며, **인메모리 캐시** (TTL 5분)로 읽기 성능을 최적화한다.

### 7.2 캐시 구조

```go
type settingsCacheEntry struct {
    value     string
    expiresAt time.Time  // 5분 TTL
}
```

- `GetSetting()`: 캐시 우선 조회 -> 만료 시 DB 조회 후 캐시 갱신
- `InvalidateCache()`: 설정 변경 시 해당 키 캐시 즉시 삭제
- `sync.RWMutex`로 동시 접근 보호

### 7.3 설정 항목 전체 목록

#### 저장소 설정

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `trash_retention_days` | int | `30` | 휴지통 자동 삭제 일수 |
| `default_storage_quota` | int64 | `10737418240` (10GB) | 기본 사용자 저장 공간 할당량 (바이트) |
| `max_file_size` | int64 | `10737418240` (10GB) | 최대 파일 업로드 크기 (바이트) |

#### 인증/세션 설정

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `session_timeout_hours` | int | `24` | 세션 만료 시간 (시간, 최대 720시간 = 30일) |

#### 보안 헤더 설정

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `security_headers_enabled` | bool | `true` | 보안 HTTP 헤더 전체 활성화 (마스터 스위치) |
| `xss_protection_enabled` | bool | `true` | `X-XSS-Protection: 1; mode=block` 헤더 |
| `hsts_enabled` | bool | `true` | HSTS 헤더 (`max-age=31536000`, 1년) |
| `csp_enabled` | bool | `true` | Content Security Policy 헤더 |
| `x_frame_options` | string | `SAMEORIGIN` | `X-Frame-Options` 값 (`DENY` 또는 `SAMEORIGIN`) |

#### Rate Limiting 설정

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `rate_limit_enabled` | bool | `true` | IP별 요청 속도 제한 활성화 |
| `rate_limit_rps` | int | `100` | 초당 허용 요청 수 (IP당) |

#### SMB 설정

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `smb_enabled` | bool | `false` | SMB 파일 공유 서비스 활성화 |

#### SSO 설정

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `sso_enabled` | bool | `false` | SSO 로그인 활성화 |
| `sso_only_mode` | bool | `false` | SSO 전용 모드 (로컬 로그인 비활성화) |
| `sso_auto_register` | bool | `true` | SSO 최초 로그인 시 자동 사용자 생성 |
| `sso_allowed_domains` | string | (빈 문자열) | SSO 허용 이메일 도메인 (쉼표 구분) |

#### 브루트포스 방어 설정

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `bruteforce_enabled` | bool | `true` | 브루트포스 방어 활성화 |
| `bruteforce_max_attempts` | int | `5` | 사용자별 최대 로그인 시도 횟수 |
| `bruteforce_window_minutes` | int | `5` | 시도 횟수 추적 시간 (분) |
| `bruteforce_lock_minutes` | int | `15` | 계정 잠금 시간 (분) |
| `bruteforce_ip_max_attempts` | int | `20` | IP별 최대 로그인 시도 횟수 |
| `bruteforce_ip_lock_minutes` | int | `30` | IP 잠금 시간 (분) |

### 7.4 보안 헤더 적용 방식

보안 헤더는 서버 시작 시 `echo.Middleware`로 적용된다. 설정 변경 후 **서버 재시작이 필요**하다.

```go
// main.go 서버 시작 시 보안 헤더 미들웨어 구성
if settingsHandler.IsSecurityHeadersEnabled() {
    secureConfig := middleware.SecureConfig{
        ContentTypeNosniff: "nosniff",  // 항상 활성화
    }

    // XSS Protection
    if settingsHandler.IsXSSProtectionEnabled() {
        secureConfig.XSSProtection = "1; mode=block"
    }

    // X-Frame-Options (DENY 또는 SAMEORIGIN만 허용)
    secureConfig.XFrameOptions = settingsHandler.GetXFrameOptions()

    // HSTS (max-age=31536000, 1년)
    if settingsHandler.IsHSTSEnabled() {
        secureConfig.HSTSMaxAge = 31536000
    }

    // CSP
    if settingsHandler.IsCSPEnabled() {
        secureConfig.ContentSecurityPolicy = "default-src 'self'; script-src 'self' ..."
    }

    e.Use(middleware.SecureWithConfig(secureConfig))
}
```

CSP 정책 상세:

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' ws: wss:;
frame-src 'self' *;
```

### 7.5 SMB 컨테이너 제어

`smb_enabled` 설정 변경 시 Docker 명령으로 Samba 컨테이너를 자동 시작/정지한다.

```go
if key == "smb_enabled" {
    if value == "true" {
        exec.Command("docker", "start", "fh-samba")
    } else {
        exec.Command("docker", "stop", "fh-samba")
    }
}
```

### 7.6 설정 변경 흐름

```
1. 관리자가 AdminSettings 페이지에서 설정 변경
2. PUT /api/admin/settings { "settings": { "key": "value", ... } }
3. 서버: JWT 인증 검증 -> system_settings UPSERT (ON CONFLICT 처리)
4. 인메모리 캐시 무효화 (InvalidateCache)
5. SMB 설정인 경우 Docker 컨테이너 제어
6. 보안 헤더/Rate Limiting 변경 시: 서버 재시작 후 적용
```

---

## 8. API 엔드포인트

### 8.1 감사 로그 API (인증 필요)

| Method | Path | 핸들러 | 설명 |
|--------|------|--------|------|
| GET | `/api/audit/logs` | `AuditHandler.ListAuditLogs` | 감사 로그 목록 조회 (필터링, 페이지네이션) |
| GET | `/api/audit/resource/*` | `AuditHandler.GetResourceHistory` | 특정 리소스의 활동 이력 |
| GET | `/api/audit/system` | `AuditHandler.GetSystemLogs` | Docker 컨테이너 시스템 로그 |

### 8.2 최근 파일 API (인증 필요)

| Method | Path | 핸들러 | 설명 |
|--------|------|--------|------|
| GET | `/api/files/recent` | `AuditHandler.GetRecentFiles` | 최근 접근 파일 목록 |
| POST | `/api/files/recent/hide` | `AuditHandler.HideRecentItem` | 최근 파일 숨기기 |
| DELETE | `/api/files/recent` | `AuditHandler.ClearRecentItems` | 모든 최근 파일 숨기기 |

### 8.3 관리자 전용 API (`AdminMiddleware` 적용)

| Method | Path | 핸들러 | 설명 |
|--------|------|--------|------|
| GET | `/api/admin/settings` | `SettingsHandler.GetAllSettings` | 전체 설정 조회 |
| PUT | `/api/admin/settings` | `SettingsHandler.UpdateSettings` | 설정 일괄 변경 |
| GET | `/api/admin/system-info` | `Handler.GetSystemInfo` | 시스템 정보 조회 |
| GET | `/api/admin/system-info/tree` | `Handler.GetFolderTreeAPI` | 폴더 트리 하위 조회 |
| GET | `/api/admin/smb/audit` | `SMBAuditHandler.GetSMBAuditLogs` | SMB 감사 로그 조회 |
| POST | `/api/admin/smb/audit/sync` | `SMBAuditHandler.SyncSMBAuditLogs` | SMB 감사 로그 수동 동기화 |

---

## 9. 프론트엔드 구현

### 9.1 AdminLogs (감사 로그 뷰어)

파일: `ui/src/components/AdminLogs.tsx`
라우트: `/fhadmin/logs`

#### 탭 구성

| 탭 | 카테고리 | 포함 이벤트 |
|----|----------|-------------|
| 파일 감사로그 | `file` | 파일/폴더 CRUD, SMB 이벤트 |
| 접속 이력 | `user` | 로그인/로그아웃, 공유 접근 |
| 관리자 로그 | `admin` | 사용자 관리, 설정 변경 |
| 시스템 로그 | `system` | Docker 컨테이너 로그 (별도 API) |

#### 필터 기능

| 필터 | 적용 대상 | UI 요소 |
|------|-----------|---------|
| 텍스트 검색 | 사용자명, 이벤트 타입, 대상, IP | 검색 입력 필드 |
| 이벤트 타입 | 감사 로그 탭 | 드롭다운 선택 |
| 날짜 범위 프리셋 | 감사 로그 탭 | 오늘/어제/최근 7일/최근 30일/직접 선택 |
| 커스텀 날짜 | 감사 로그 탭 | 시작일/종료일 date input |
| 로그 레벨 | 시스템 로그 탭 | Fatal/Error/Warning/Info |
| 컨테이너 | 시스템 로그 탭 | API/UI/Database |

#### 통계 카드

감사 로그 탭에서는 상단에 3개의 통계 카드를 표시한다:
- **전체 로그**: 필터 조건에 맞는 전체 건수 (`total`)
- **오늘**: 오늘 날짜 이후의 로그 건수
- **이번 주**: 7일 이내의 로그 건수

#### 페이지네이션

- 페이지당 50건 (`ITEMS_PER_PAGE = 50`)
- 서버 사이드 페이지네이션 (offset/limit)
- 최대 5개 페이지 번호 표시, 생략 부호 (`...`) 사용

#### 이벤트 타입 한글 라벨

```typescript
const labels: Record<string, string> = {
    'file.view': '파일 조회',
    'file.download': '파일 다운로드',
    'file.upload': '파일 업로드',
    'file.delete': '파일 삭제',
    'file.rename': '파일 이름변경',
    'folder.create': '폴더 생성',
    'folder.delete': '폴더 삭제',
    'smb_create': 'SMB 파일 생성',
    'smb_write': 'SMB 파일 쓰기',
    'smb_delete': 'SMB 삭제',
    'smb_rename': 'SMB 이름변경',
    'user.login': '로그인',
    'user.logout': '로그아웃',
    'share.create': '공유 생성',
    'share.access': '공유 접근',
    'share.delete': '공유 삭제',
    'admin.user.create': '사용자 생성',
    'admin.user.update': '사용자 수정',
    'admin.user.delete': '사용자 삭제',
    'admin.settings.update': '설정 변경',
    // ...
}
```

#### IP 주소 표시

- IP가 비어있는 경우 "SMB"로 표시 (SMB를 통한 작업은 IP가 별도 형식)
- 공유 업로드(`source === "share_upload"`)인 경우 사용자명을 "업로드 링크"로 표시

#### 시간 표시

상대 시간 형식 우선, 오래된 항목은 절대 시간 표시:
- 1분 미만: "방금 전"
- 1시간 미만: "N분 전"
- 24시간 미만: "N시간 전"
- 그 이상: `ko-KR` 로케일 날짜/시간

### 9.2 AdminSystemInfo (시스템 정보 대시보드)

파일: `ui/src/components/AdminSystemInfo.tsx`
라우트: `/fhadmin/system-info`

#### 섹션 구성

| 섹션 | 내용 |
|------|------|
| 서버 개요 | 호스트명, OS/아키텍처, CPU 코어, Go 버전, 가동 시간, 서버 시간 |
| 리소스 사용량 | 메모리(RAM) 프로그레스 바 + 수치, 디스크 프로그레스 바 + 수치 |
| 프로젝트 통계 | 전체 파일 수, 전체 폴더 수, 총 사용량, 등록 사용자, 공유 폴더 |
| 폴더별 용량 | 트리 구조 폴더 탐색기 (클릭하여 하위 폴더 확장) |

#### 폴더 트리 동적 로딩

- 초기 로드: 2단계 깊이
- 폴더 클릭: API 호출하여 해당 폴더 하위 1단계 추가 로드
- ESC 키: 모든 확장 폴더 축소
- 로딩 상태: 폴더별 개별 스피너 표시

#### 접근 제어

관리자 권한 확인 (`currentUser?.isAdmin`), 미인증 시 "접근 권한 없음" 표시.

### 9.3 AdminSettings (시스템 설정)

파일: `ui/src/components/AdminSettings.tsx`
라우트: `/fhadmin/settings`

#### 설정 섹션 구성

| 섹션 | 설정 항목 |
|------|-----------|
| 휴지통 설정 | 자동 삭제 기간 (일) |
| 저장소 설정 | 기본 할당량 (GB), 최대 파일 크기 (GB) |
| 보안 설정 | 세션 만료 시간 (시간) |
| Rate Limiting | 활성화 토글, 초당 요청 제한 (req/s) |
| 보안 헤더 | 전체 활성화 토글 -> XSS, HSTS, CSP, X-Frame-Options |
| SMB/CIFS 설정 | SMB 서버 활성화 토글 |

#### UI 패턴

- 토글 스위치: boolean 설정 (활성화/비활성화)
- 숫자 입력: 수치 설정 (최소/최대 범위 제한)
- 드롭다운 선택: 열거형 설정 (예: X-Frame-Options)
- 조건부 표시: 마스터 토글이 켜져 있을 때만 하위 설정 표시
- 바이트/GB 변환: 저장소 관련 설정은 UI에서 GB 단위, API에서 바이트 단위

---

## 10. 데이터 모델

### 10.1 audit_logs 테이블

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    ts              TIMESTAMPTZ DEFAULT NOW(),
    actor_id        UUID,
    ip_addr         INET,
    event_type      VARCHAR(50) NOT NULL,
    target_resource VARCHAR(1000),
    details         JSONB
);
```

COMMENT: `Immutable audit trail for all actions`

#### 인덱스

| 인덱스 | 컬럼 | 용도 |
|--------|------|------|
| `idx_audit_ts` | `ts` | 시간순 정렬/필터 |
| `idx_audit_target` | `target_resource` | 리소스별 이력 조회 |
| `idx_audit_actor` | `actor_id` | 사용자별 활동 조회 |
| `idx_audit_type_ts` | `event_type, ts DESC` | 카테고리+시간 복합 필터 |
| `idx_audit_security_events` | `event_type, ts DESC` (부분: `WHERE event_type LIKE 'security.%'`) | 보안 이벤트 전용 빠른 조회 |

### 10.2 system_settings 테이블

```sql
CREATE TABLE IF NOT EXISTS system_settings (
    key         VARCHAR(100) PRIMARY KEY,
    value       TEXT NOT NULL,
    description TEXT,
    updated_by  UUID REFERENCES users(id),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

COMMENT: `System-wide configuration settings`

#### 인덱스

| 인덱스 | 컬럼 | 용도 |
|--------|------|------|
| `idx_system_settings_key` | `key` | 키 기반 빠른 조회 (PK와 중복이나 명시적 생성) |

### 10.3 hidden_recent_items 테이블

```sql
CREATE TABLE IF NOT EXISTS hidden_recent_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path   VARCHAR(1024) NOT NULL,
    hidden_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, file_path)
);
```

COMMENT: `Hidden items from recent activity list per user`

#### 인덱스

| 인덱스 | 컬럼 | 용도 |
|--------|------|------|
| `idx_hidden_recent_user` | `user_id` | 사용자별 숨김 항목 조회 |

---

## 11. 관련 파일

### 백엔드

| 파일 | 설명 |
|------|------|
| `api/handlers/audit.go` | 감사 로그 핸들러 (버퍼 채널, 배치 플러시, 이벤트 기록, 로그 조회, 최근 파일) |
| `api/handlers/smb_audit_handler.go` | SMB 감사 로그 (vfs_full_audit 파싱, 백그라운드 동기화) |
| `api/handlers/system_info.go` | 시스템 정보 (CPU, 메모리, 디스크, 폴더 트리) |
| `api/handlers/settings.go` | 시스템 설정 (캐시, CRUD, 보안 헬퍼, SMB 컨테이너 제어) |
| `api/main.go` | 서버 초기화 (보안 미들웨어 설정, Rate Limiting, 라우트 등록) |
| `db/init.sql` | DB 스키마 (audit_logs, system_settings, hidden_recent_items) |

### 프론트엔드

| 파일 | 설명 |
|------|------|
| `ui/src/components/AdminLogs.tsx` | 감사 로그 뷰어 (4탭, 필터, 페이지네이션) |
| `ui/src/components/AdminLogs.css` | 감사 로그 스타일 |
| `ui/src/components/AdminSystemInfo.tsx` | 시스템 정보 대시보드 (리소스 사용량, 폴더 트리) |
| `ui/src/components/AdminSystemInfo.css` | 시스템 정보 스타일 |
| `ui/src/components/AdminSettings.tsx` | 시스템 설정 관리 (보안 헤더, Rate Limiting, SMB) |
| `ui/src/components/AdminSettings.css` | 시스템 설정 스타일 |
