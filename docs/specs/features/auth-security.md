# 인증 및 보안 명세

## 개요

FileHatch의 인증 및 보안 시스템은 JWT 기반 인증, 2FA(TOTP), SSO(OAuth2/OIDC), 브루트포스 방지, 입력 검증, 보안 헤더, 암호화를 포함한다.

---

## JWT 인증

### 핵심 구조

| 항목 | 값 |
|------|-----|
| 핸들러 | `AuthHandler` (`api/handlers/auth.go`) |
| 서명 알고리즘 | HS256 |
| 비밀키 환경변수 | `JWT_SECRET` (최소 32자) |
| 폴백 비밀키 | `fh-dev-secret-not-for-production-use` (개발 전용) |
| 발급자 (Issuer) | `filehatch` |

### Claims 구조

```go
type Claims struct {
    UserID     string // UUID
    Username   string
    IsAdmin    bool
    RememberMe bool
    jwt.RegisteredClaims
}
```

### 토큰 만료 정책

| 조건 | 만료 시간 |
|------|-----------|
| 기본 | 24시간 |
| RememberMe 활성화 | 30일 |

### 토큰 갱신

- **엔드포인트**: `POST /auth/refresh`
- 기존 토큰의 Claims를 기반으로 새로운 만료 시간이 적용된 토큰을 발급한다.
- 프론트엔드에서 만료 5분 전 또는 사용자 활동 시(50% 임계값) 자동 갱신을 수행한다.

### 프론트엔드 토큰 관리

- **스토어**: `useAuthStore` (Zustand + persist)
- **저장소**: `localStorage` (키: `filehatch-auth`)
- 자동 갱신 로직이 만료 임박 시 백그라운드에서 토큰을 교체한다.

---

## 미들웨어 체인

```go
JWTMiddleware()         // 필수 인증 - Bearer 토큰 추출 및 검증
OptionalJWTMiddleware() // 선택적 인증 - 익명 접근 허용
AdminMiddleware()       // 관리자 전용 - JWT + claims.IsAdmin == true 요구
```

### 미들웨어 적용 패턴

| 미들웨어 | 용도 | 실패 시 |
|----------|------|---------|
| `JWTMiddleware()` | 인증이 필요한 모든 API | 401 Unauthorized |
| `OptionalJWTMiddleware()` | 공개 공유 링크 등 | Claims가 nil (익명) |
| `AdminMiddleware()` | 관리자 전용 API | 403 Forbidden |

### 인증 헬퍼 함수

```go
claims := GetClaims(c)           // JWT Claims 반환 (nil 가능, Optional 미들웨어용)
claims, err := RequireClaims(c)  // 필수 인증 (nil이면 에러)
claims, err := RequireAdmin(c)   // 관리자 필수 (IsAdmin=false면 에러)
```

---

## 2FA (TOTP)

### 기술 스택

| 항목 | 값 |
|------|-----|
| 라이브러리 | `github.com/pquerna/otp` |
| 표준 | RFC 6238 (TOTP) |
| 비밀키 저장 | `users.totp_secret` (AES-GCM 암호화) |

### 설정 플로우

```
1. GET /auth/2fa/setup
   → 응답: { secret, qrCodeUrl, accountName, issuer }
   → 사용자가 인증 앱(Google Authenticator 등)에 QR 코드 스캔

2. POST /auth/2fa/enable
   → 요청: { code: "123456" }
   → 서버가 TOTP 코드 검증 후 totp_enabled=true 설정
```

### 로그인 플로우 (2FA 활성화된 계정)

```
1. POST /auth/login
   → 응답: { requires2fa: true, tempToken: "..." }

2. POST /auth/2fa/verify
   → 요청: { code: "123456", tempToken: "..." }
   → 검증 성공 시 정식 JWT 토큰 발급
```

### 비활성화

- `POST /auth/2fa/disable`
- 요구 사항: 현재 비밀번호 + TOTP 코드 동시 검증

### 백업 코드

- 2FA 설정 시 자동 생성 (일회용)
- DB에 암호화 저장
- 사용된 코드는 즉시 무효화

---

## SSO (OAuth2/OIDC)

### 핵심 구조

| 항목 | 값 |
|------|-----|
| 핸들러 | `SSOHandler` (`api/handlers/sso_handler.go`) |
| DB 테이블 | `sso_providers` |
| 다중 프로바이더 | 지원 (Google, GitHub, Keycloak 등) |

### 인증 플로우

```
1. GET /auth/sso/auth/:providerId
   → State 파라미터 생성 (Redis/메모리 저장, CSRF 방지)
   → OAuth2 프로바이더로 리다이렉트

2. GET /auth/sso/callback/:providerId
   → Authorization Code 수신
   → Token Exchange (code → access_token)
   → UserInfo 조회
   → 사용자 생성/매칭
   → JWT 발급 후 프론트엔드로 리다이렉트
```

### 프로바이더 설정 옵션

| 옵션 | 설명 |
|------|------|
| `auto_create_user` | `true`면 최초 로그인 시 자동 계정 생성 |
| `allowed_domains` | 허용된 이메일 도메인 목록으로 접근 제한 |
| `client_secret` | AES-GCM으로 암호화 저장 |

### 프론트엔드

- `LoginPage.tsx`: `getSSOProviders()` 호출하여 SSO 버튼 동적 렌더링
- 각 프로바이더별 아이콘 및 이름 표시

---

## 브루트포스 방지

### 핵심 구조

| 항목 | 값 |
|------|-----|
| 구현체 | `BruteForceGuard` (`api/handlers/auth_bruteforce.go`) |
| 실패 허용 횟수 | 5회 |
| 잠금 시간 | 15분 (지수 백오프) |

### DB 필드

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `failed_login_count` | `integer` | 연속 실패 횟수 |
| `last_failed_login` | `timestamp` | 마지막 실패 시각 |
| `locked_until` | `timestamp` | 잠금 해제 시각 |

### 관리자 잠금 해제

```
DELETE /admin/security/locked-users/:username
```

관리자가 잠긴 계정을 수동으로 해제할 수 있다.

---

## 입력 검증

`api/handlers/validation.go`에 정의된 검증 함수:

| 함수 | 규칙 |
|------|------|
| `ValidateUsername` | 3~50자, 영문자/숫자/밑줄(`_`)만 허용 |
| `ValidatePassword` | 8자 이상, 대문자 + 소문자 + 숫자 + 특수문자 필수 |
| `ValidateEmail` | 기본 이메일 형식 검사 |
| `ValidateFilename` | `< > : " / \ \| ? *` 금지, 최대 255자 |
| `ValidatePath` | `..` 포함 금지, null 바이트 금지, `filepath.Clean` + 접두사 검사 |

### Path Traversal 방지 패턴

```go
cleaned := filepath.Clean(path)
if strings.Contains(cleaned, "..") {
    return ErrForbidden("path traversal not allowed")
}
absPath := filepath.Join(dataRoot, cleaned)
if !strings.HasPrefix(absPath, dataRoot) {
    return ErrForbidden("path outside root")
}
```

---

## 보안 헤더

`system_settings` 테이블을 통해 관리자가 설정 가능:

| 헤더 | 기본값 | 설정 가능 여부 |
|------|--------|---------------|
| `X-Content-Type-Options` | `nosniff` | 항상 적용 |
| `X-XSS-Protection` | `1; mode=block` | 토글 가능 |
| `X-Frame-Options` | `DENY` | `DENY` / `SAMEORIGIN` / `ALLOW-FROM` 선택 |
| `Strict-Transport-Security` | `max-age=31536000` | 토글 가능 |
| `Content-Security-Policy` | 아래 참조 | 설정 가능 |

### CSP 기본값

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
img-src data: blob:;
```

### Rate Limiting

- 설정키: `rate_limit_rps`
- 기본값: 100 RPS
- `system_settings` 테이블에서 관리자가 변경 가능

---

## 암호화

### AES-GCM 암호화

| 항목 | 값 |
|------|-----|
| 환경변수 | `ENCRYPTION_KEY` (32바이트 16진수) |
| 알고리즘 | AES-256-GCM |
| 구현 파일 | `api/handlers/crypto.go` |

### 암호화 대상

| 대상 | 저장 위치 |
|------|-----------|
| SSO 클라이언트 비밀키 | `sso_providers.client_secret` |
| SMB 비밀번호 | 외부 스토리지 설정 |
| TOTP 비밀키 | `users.totp_secret` |
| 외부 스토리지 설정 | `external_storages.config` |

### 함수

```go
func EncryptAESGCM(plaintext string, key []byte) (string, error)
func DecryptAESGCM(ciphertext string, key []byte) (string, error)
```

---

## CORS 설정

| 항목 | 값 |
|------|-----|
| 환경변수 | `CORS_ALLOWED_ORIGINS` |
| 개발 환경 기본값 | `localhost:3000`, `localhost:3080`, `localhost:5173` |
| 허용 메서드 | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` |
| 허용 헤더 | 표준 헤더 + `Upload-*` / `Tus-*` (TUS 프로토콜용) |

---

## 프론트엔드 컴포넌트

| 컴포넌트 | 파일 | 역할 |
|----------|------|------|
| `LoginPage` | `LoginPage.tsx` | 로그인 폼, SSO 버튼, Remember Me |
| `AuthModal` | `AuthModal.tsx` | 2FA 코드 입력 모달 |
| `InitialSetupModal` | `InitialSetupModal.tsx` | 최초 설치 시 관리자 계정 생성 마법사 |
| `UserProfile` | `UserProfile.tsx` | 비밀번호 변경, 2FA 설정/해제 |

---

## API 엔드포인트

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| `POST` | `/auth/login` | 없음 | 로그인 (아이디/비밀번호) |
| `POST` | `/auth/refresh` | JWT | 토큰 갱신 |
| `GET` | `/auth/profile` | JWT | 사용자 프로필 조회 |
| `PUT` | `/auth/profile` | JWT | 사용자 프로필 수정 |
| `GET` | `/auth/2fa/setup` | JWT | 2FA 설정 정보 (QR코드, 비밀키) |
| `POST` | `/auth/2fa/enable` | JWT | 2FA 활성화 |
| `POST` | `/auth/2fa/verify` | 없음 | 2FA 코드 검증 (로그인 2단계) |
| `POST` | `/auth/2fa/disable` | JWT | 2FA 비활성화 |
| `GET` | `/auth/sso/providers` | 없음 | SSO 프로바이더 목록 조회 |
| `GET` | `/auth/sso/auth/:id` | 없음 | SSO 인증 시작 (프로바이더 리다이렉트) |
| `GET` | `/auth/sso/callback/:id` | 없음 | SSO 콜백 (토큰 교환 및 JWT 발급) |

---

## 관련 파일

| 경로 | 설명 |
|------|------|
| `api/handlers/auth.go` | AuthHandler - 로그인, 토큰 갱신, 프로필 |
| `api/handlers/auth_bruteforce.go` | BruteForceGuard - 브루트포스 방지 |
| `api/handlers/sso_handler.go` | SSOHandler - OAuth2/OIDC SSO |
| `api/handlers/crypto.go` | AES-GCM 암호화/복호화 |
| `api/handlers/validation.go` | 입력 검증 함수 |
| `api/handlers/errors.go` | 에러 응답, 인증 체크 헬퍼 |
| `api/middleware/auth/` | JWT, Admin 미들웨어 |
| `ui/src/stores/authStore.ts` | 인증 상태 관리 (Zustand) |
| `ui/src/pages/LoginPage.tsx` | 로그인 페이지 |
| `ui/src/components/UserProfile.tsx` | 사용자 프로필 |
