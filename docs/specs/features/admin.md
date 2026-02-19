# 관리자 기능 명세

## 기능 개요

FileHatch 관리자 기능은 시스템 전반을 관리하기 위한 도구 모음이다.
사용자 관리, 시스템 설정, 감사 로그, SMB 설정, 외부 스토리지, 시스템 정보 기능을 포함한다.

모든 관리자 API는 `auth.AdminMiddleware()`를 거치며, 프론트엔드 라우트는 `/fhadmin/*` 하위에 위치한다.

---

## 사용자 관리

### 개요

관리자가 시스템 내 전체 사용자를 CRUD 방식으로 관리한다.
백엔드는 `AdminHandler` 또는 `auth.go` 내 관리자 전용 엔드포인트에서 처리한다.

### 기능 목록

| 기능 | 설명 | 비고 |
|------|------|------|
| 사용자 목록 조회 | 전체 사용자 리스트 (검색, 페이지네이션) | 카드 뷰/리스트 뷰 전환 가능 |
| 사용자 생성 | 새 사용자 계정 생성 | `ValidateUsername`, `ValidatePassword` 적용 |
| 사용자 편집 | 이름, 이메일 등 기본 정보 수정 | EditUserModal 사용 |
| 사용자 삭제 | 사용자 계정 삭제 | 삭제 전 확인 다이얼로그 필수 |
| 관리자 상태 토글 | 일반 사용자 <-> 관리자 전환 | `is_admin` 필드 |
| 활성 상태 토글 | 계정 활성화/비활성화 | `is_active` 필드 |
| SMB 접근 토글 | SMB 파일 공유 접근 권한 설정 | SMB 활성화 시에만 표시 |
| 스토리지 쿼터 설정 | 사용자별 저장 용량 제한 설정 | 바이트 단위, 0 = 무제한 |
| 비밀번호 초기화 | 관리자가 사용자 비밀번호 강제 변경 | 감사 로그 기록 |
| 2FA 초기화 | 사용자의 2단계 인증 초기화 | TOTP 시크릿 삭제 |

### 인증 및 권한

```go
// 모든 관리자 API에 적용
claims, err := RequireAdmin(c)
if err != nil {
    return RespondError(c, err)
}
```

### 감사 로그 이벤트

| 이벤트 | 설명 |
|--------|------|
| `admin.user.create` | 사용자 생성 |
| `admin.user.update` | 사용자 정보 수정 |
| `admin.user.delete` | 사용자 삭제 |
| `admin.user.toggle_admin` | 관리자 상태 변경 |
| `admin.user.reset_password` | 비밀번호 초기화 |
| `admin.user.reset_2fa` | 2FA 초기화 |

---

## 시스템 설정

### 개요

시스템 전역 설정을 키-값 형태로 관리한다.
DB의 `system_settings` 테이블에 저장하며, 관리자만 조회/수정 가능하다.

### DB 스키마

```sql
CREATE TABLE IF NOT EXISTS system_settings (
    key   VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL
);
```

### 설정 항목

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `sso_enabled` | boolean | `false` | SSO(Single Sign-On) 활성화 |
| `smb_enabled` | boolean | `false` | SMB 파일 공유 서비스 활성화 |
| `security_headers_enabled` | boolean | `true` | 보안 HTTP 헤더 활성화 |
| `hsts_enabled` | boolean | `false` | HSTS(HTTP Strict Transport Security) 활성화 |
| `xss_protection` | boolean | `true` | XSS 보호 헤더 활성화 |
| `x_frame_options` | string | `DENY` | X-Frame-Options 값 (`DENY`, `SAMEORIGIN`) |
| `rate_limit_enabled` | boolean | `true` | API 요청 속도 제한 활성화 |
| `rate_limit_rps` | number | `10` | 초당 허용 요청 수 |
| `audit_log_retention_days` | number | `365` | 감사 로그 보관 기간 (일) |
| `max_upload_size` | number | - | 최대 파일 업로드 크기 (바이트) |

### 설정 변경 흐름

```
1. 관리자가 AdminSettings 페이지에서 설정 변경
2. PUT /api/admin/settings 호출
3. 서버: RequireAdmin() 검증 -> system_settings 테이블 UPDATE
4. 감사 로그 기록 (admin.settings 이벤트)
5. 변경된 설정 즉시 적용 (서버 캐시 갱신)
```

---

## 감사 로그 시스템

### 개요

시스템 내 모든 중요 활동을 비동기적으로 기록하는 감사 추적 시스템이다.
`AuditHandler` (`audit.go`)에서 관리하며, 버퍼 채널 기반 비동기 배치 처리로 성능을 최적화한다.

### 아키텍처

```
[핸들러] --LogEventFromContext()--> [버퍼 채널 (cap: 1000)] --flush--> [DB audit_logs]
                                          |
                                   최대 50건 또는 500ms 간격으로 배치 플러시
```

| 파라미터 | 값 | 설명 |
|----------|----|------|
| 채널 용량 | 1000 | 버퍼드 채널 크기 |
| 배치 크기 | 50 | 한 번에 플러시하는 최대 로그 수 |
| 플러시 간격 | 500ms | 배치가 가득 차지 않아도 플러시하는 최대 대기 시간 |

### 이벤트 타입

| 카테고리 | 이벤트 타입 | 설명 |
|----------|------------|------|
| 파일 | `file.upload` | 파일 업로드 |
| 파일 | `file.download` | 파일 다운로드 |
| 파일 | `file.delete` | 파일 삭제 |
| 파일 | `file.rename` | 파일 이름 변경 |
| 파일 | `file.copy` | 파일 복사 |
| 파일 | `file.move` | 파일 이동 |
| 인증 | `user.login` | 사용자 로그인 |
| 인증 | `user.logout` | 사용자 로그아웃 |
| 공유 | `share.create` | 공유 링크 생성 |
| 공유 | `share.delete` | 공유 링크 삭제 |
| 관리 | `admin.settings` | 시스템 설정 변경 |
| 관리 | `admin.user.create` | 사용자 생성 |
| 관리 | `admin.user.update` | 사용자 수정 |
| 관리 | `admin.user.delete` | 사용자 삭제 |

### DB 스키마

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_id        INTEGER REFERENCES users(id),
    ip_addr         VARCHAR(45),
    event_type      VARCHAR(100) NOT NULL,
    target_resource TEXT,
    details         JSONB
);
```

### 인덱스

```sql
CREATE INDEX IF NOT EXISTS idx_audit_logs_ts ON audit_logs(ts);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_resource);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_ts ON audit_logs(event_type, ts DESC);
```

### 로그 기록 예시 (Go)

```go
auditHandler.LogEventFromContext(c, EventFileUpload, filePath, map[string]interface{}{
    "filename": filename,
    "size":     fileSize,
    "mime":     mimeType,
})
```

### 프론트엔드 필터링

`AdminLogs.tsx`에서 다음 필터를 지원한다.

| 필터 | 타입 | 설명 |
|------|------|------|
| 이벤트 타입 | select | 드롭다운으로 이벤트 타입 선택 |
| 날짜 범위 | date range | 시작일 ~ 종료일 지정 |
| 사용자 | text/select | 특정 사용자 기준 필터링 |

### 불변성 규칙

감사 로그는 **불변(immutable)** 이다. 한 번 기록된 로그는 수정하거나 삭제할 수 없다.
보관 기간(`audit_log_retention_days`)이 지난 로그만 자동 정리된다.

---

## SMB 설정

### 개요

Samba 프로토콜을 통한 파일 공유 기능을 제공한다.
Docker 컨테이너(`fh-samba`)로 Samba 서비스를 운영하며, FileHatch에서 사용자별 SMB 인증을 관리한다.

### 아키텍처

```
[FileHatch API] --> [SMB 해시 생성] --> [fh-samba 컨테이너]
                        |
                  smb_crypto.go
                  (암호화/복호화)
```

### 핵심 파일

| 파일 | 설명 |
|------|------|
| `api/handlers/smb_crypto.go` | SMB 비밀번호 암호화/복호화 |
| `config/smb.conf` | Samba 설정 템플릿 |

### 기능

| 기능 | 설명 |
|------|------|
| SMB 해시 생성 | 사용자별 SMB 접근 인증 정보 생성 |
| 비밀번호 암호화 | `smb_crypto.go`에서 AES 암호화/복호화 |
| 설정 템플릿 | `config/smb.conf`를 기반으로 Samba 설정 생성 |
| 연결 모니터링 | `smbstatus` 명령으로 활성 SMB 연결 조회 |
| 사용자별 접근 제어 | 관리자가 사용자별 SMB 접근 권한 토글 |

---

## 외부 스토리지

### 개요

외부 저장소(S3, WebDAV 등)를 FileHatch에 마운트하여 로컬 파일처럼 접근할 수 있게 한다.
관리자가 외부 스토리지를 등록하면, 지정된 사용자/그룹이 해당 스토리지에 접근 가능하다.

### 프론트엔드

`AdminExternalStorages` 컴포넌트(`/fhadmin/external-storages`)에서 외부 스토리지를 관리한다.

---

## 시스템 정보

### 개요

시스템 상태를 실시간으로 모니터링하는 대시보드이다.

### API

```
GET /api/admin/system-info
```

관리자 전용 엔드포인트로, 서버 상태 정보를 반환한다.

---

## SSO (Single Sign-On)

### 개요

외부 인증 프로바이더(OIDC/OAuth2)를 통한 통합 인증을 지원한다.
`system_settings`의 `sso_enabled` 값이 `true`일 때 활성화된다.

### SSO 프로바이더 API

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/admin/sso/providers` | 등록된 프로바이더 목록 조회 |
| POST | `/api/admin/sso/providers` | 새 프로바이더 등록 |
| PUT | `/api/admin/sso/providers/{id}` | 프로바이더 설정 수정 |
| DELETE | `/api/admin/sso/providers/{id}` | 프로바이더 삭제 |

---

## 보안: 계정 잠금 해제

### 개요

로그인 시도 실패가 임계값을 초과하면 계정이 자동 잠기며, 관리자가 수동으로 잠금을 해제할 수 있다.

### API

```
DELETE /api/admin/security/locked-users/{username}
```

---

## 프론트엔드 컴포넌트

모든 관리자 컴포넌트는 **lazy loading** 으로 로드된다.

| 컴포넌트 | 라우트 | 설명 |
|----------|--------|------|
| `AdminUserList` | `/fhadmin/users` | 사용자 목록 (카드/리스트 뷰 전환) |
| `CreateUserModal` | - (모달) | 새 사용자 생성 폼 |
| `EditUserModal` | - (모달) | 사용자 편집 폼 |
| `AdminSettings` | `/fhadmin/settings` | 시스템 설정 패널 |
| `AdminSSOSettings` | `/fhadmin/sso` | SSO 프로바이더 관리 |
| `AdminLogs` | `/fhadmin/logs` | 감사 로그 뷰어 (필터링) |
| `AdminSharedFolders` | `/fhadmin/shared-folders` | 공유 폴더 관리 |
| `AdminExternalStorages` | `/fhadmin/external-storages` | 외부 스토리지 관리 |
| `AdminSystemInfo` | `/fhadmin/system-info` | 시스템 정보 대시보드 |
| `SMBSettings` | `/fhadmin/smb` | SMB 설정 및 모니터링 |

---

## API 엔드포인트 전체 목록

모든 엔드포인트에 `auth.AdminMiddleware()` 적용.

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/admin/users` | 사용자 목록 조회 |
| POST | `/api/admin/users` | 사용자 생성 |
| PUT | `/api/admin/users/{id}` | 사용자 수정 |
| DELETE | `/api/admin/users/{id}` | 사용자 삭제 |
| GET | `/api/admin/settings` | 시스템 설정 조회 |
| PUT | `/api/admin/settings` | 시스템 설정 수정 |
| GET | `/api/admin/audit-logs` | 감사 로그 조회 (필터링 지원) |
| GET | `/api/admin/system-info` | 시스템 정보 조회 |
| GET | `/api/admin/sso/providers` | SSO 프로바이더 목록 |
| POST | `/api/admin/sso/providers` | SSO 프로바이더 추가 |
| PUT | `/api/admin/sso/providers/{id}` | SSO 프로바이더 수정 |
| DELETE | `/api/admin/sso/providers/{id}` | SSO 프로바이더 삭제 |
| DELETE | `/api/admin/security/locked-users/{username}` | 계정 잠금 해제 |

---

## 관련 파일

### 백엔드

| 파일 | 설명 |
|------|------|
| `api/handlers/admin.go` | 관리자 핸들러 (사용자 관리) |
| `api/handlers/audit.go` | 감사 로그 핸들러 |
| `api/handlers/auth.go` | 인증/인가 미들웨어 |
| `api/handlers/smb_crypto.go` | SMB 비밀번호 암호화 |
| `api/handlers/permissions.go` | 권한 검사 |
| `api/handlers/errors.go` | 에러 헬퍼 (RequireAdmin 등) |
| `config/smb.conf` | Samba 설정 템플릿 |

### 프론트엔드

| 파일 | 설명 |
|------|------|
| `ui/src/components/admin/AdminUserList.tsx` | 사용자 관리 |
| `ui/src/components/admin/AdminSettings.tsx` | 시스템 설정 |
| `ui/src/components/admin/AdminLogs.tsx` | 감사 로그 |
| `ui/src/components/admin/AdminSSOSettings.tsx` | SSO 설정 |
| `ui/src/components/admin/AdminSharedFolders.tsx` | 공유 폴더 |
| `ui/src/components/admin/AdminExternalStorages.tsx` | 외부 스토리지 |
| `ui/src/components/admin/AdminSystemInfo.tsx` | 시스템 정보 |
| `ui/src/components/admin/SMBSettings.tsx` | SMB 설정 |
