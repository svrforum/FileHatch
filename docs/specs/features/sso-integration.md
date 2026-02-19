# SSO/OAuth2 통합 명세

## 개요

FileHatch의 SSO(Single Sign-On) 시스템은 OAuth2/OIDC 프로토콜을 기반으로 외부 인증 프로바이더(Google, GitHub, Azure AD, Keycloak 등)를 통한 로그인을 지원한다. 관리자는 다중 프로바이더를 등록하고 전역/프로바이더별 설정을 관리하며, SSO 전용 모드를 활성화하여 로컬 계정 로그인을 비활성화할 수 있다. 최초 SSO 로그인 시 사용자 계정이 자동으로 생성(프로비저닝)되며, 브루트포스 보호 시스템이 로그인 시도를 추적하여 무차별 대입 공격을 방지한다.

### 핵심 구조

| 항목 | 값 |
|------|-----|
| SSO 핸들러 | `SSOHandler` (`api/handlers/sso.go`, `sso_callback.go`, `sso_admin.go`) |
| 브루트포스 가드 | `BruteForceGuard` (`api/handlers/auth_bruteforce.go`) |
| DB 테이블 | `sso_providers`, `system_settings` (SSO 설정), `users` (프로바이더 연동) |
| 프론트엔드 | `LoginPage.tsx` (SSO 로그인 버튼), `AdminSSOSettings.tsx` (관리자 설정) |
| 지원 프로토콜 | OAuth 2.0, OpenID Connect (OIDC) |
| 지원 프로바이더 | Google, GitHub, Microsoft Azure AD, OIDC 호환 (Keycloak 등) |

### 관련 파일

| 경로 | 설명 |
|------|------|
| `api/handlers/sso.go` | SSOHandler 구조체, 프로바이더 모델, 공개 프로바이더 목록 API |
| `api/handlers/sso_callback.go` | OAuth2 인증 시작, 콜백 처리, 토큰 교환, 사용자 프로비저닝 |
| `api/handlers/sso_admin.go` | 관리자 전용 프로바이더 CRUD, SSO 설정 관리 |
| `api/handlers/auth_bruteforce.go` | 브루트포스 방지 (IP/사용자 잠금) |
| `api/handlers/auth.go` | User 구조체 (provider, provider_id 필드) |
| `api/handlers/crypto.go` | AES-GCM 암호화 (Client Secret 암호화 저장) |
| `api/main.go` | 라우트 등록 |
| `db/init.sql` | sso_providers 테이블, system_settings SSO 항목 |
| `ui/src/api/auth.ts` | SSO 관련 API 호출 함수 및 타입 정의 |
| `ui/src/components/LoginPage.tsx` | SSO 로그인 버튼 렌더링 및 콜백 토큰 처리 |
| `ui/src/components/AdminSSOSettings.tsx` | 관리자 SSO 설정 UI |
| `ui/src/stores/authStore.ts` | `setToken()` - SSO 콜백 후 토큰 저장 |

---

## SSO 프로바이더 관리

### 데이터 모델

#### DB 스키마: `sso_providers` 테이블

```sql
CREATE TABLE IF NOT EXISTS sso_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,              -- 표시 이름 (예: "Google", "Company SSO")
    provider_type VARCHAR(50) NOT NULL,      -- 프로바이더 유형 (google, github, azure, oidc)
    client_id VARCHAR(255) NOT NULL,         -- OAuth2 Client ID
    client_secret VARCHAR(500) NOT NULL,     -- OAuth2 Client Secret
    issuer_url VARCHAR(500),                 -- OIDC Issuer URL (Keycloak 등)
    authorization_url VARCHAR(500),          -- 커스텀 Authorization URL (선택)
    token_url VARCHAR(500),                  -- 커스텀 Token URL (선택)
    userinfo_url VARCHAR(500),               -- 커스텀 UserInfo URL (선택)
    scopes VARCHAR(500) DEFAULT 'openid email profile',  -- OAuth2 Scopes
    allowed_domains TEXT,                    -- 허용 이메일 도메인 (쉼표 구분)
    auto_create_user BOOLEAN DEFAULT TRUE,   -- 최초 로그인 시 자동 계정 생성
    default_admin BOOLEAN DEFAULT FALSE,     -- 자동 생성 계정에 관리자 권한 부여
    is_enabled BOOLEAN DEFAULT TRUE,         -- 활성화 여부
    display_order INT DEFAULT 0,             -- 로그인 페이지 표시 순서
    icon_url VARCHAR(500),                   -- 커스텀 아이콘 URL
    button_color VARCHAR(20),               -- 커스텀 버튼 색상
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**인덱스:**

```sql
CREATE INDEX IF NOT EXISTS idx_sso_providers_enabled ON sso_providers(is_enabled);
CREATE INDEX IF NOT EXISTS idx_sso_providers_type ON sso_providers(provider_type);
```

#### Go 구조체: `SSOProvider`

```go
type SSOProvider struct {
    ID               string    `json:"id"`
    Name             string    `json:"name"`
    ProviderType     string    `json:"providerType"`      // google, github, azure, oidc
    ClientID         string    `json:"clientId"`
    ClientSecret     string    `json:"clientSecret,omitempty"`
    IssuerURL        string    `json:"issuerUrl,omitempty"`
    AuthorizationURL string    `json:"authorizationUrl,omitempty"`
    TokenURL         string    `json:"tokenUrl,omitempty"`
    UserinfoURL      string    `json:"userinfoUrl,omitempty"`
    Scopes           string    `json:"scopes"`
    AllowedDomains   string    `json:"allowedDomains,omitempty"`
    AutoCreateUser   bool      `json:"autoCreateUser"`
    DefaultAdmin     bool      `json:"defaultAdmin"`
    IsEnabled        bool      `json:"isEnabled"`
    DisplayOrder     int       `json:"displayOrder"`
    IconURL          string    `json:"iconUrl,omitempty"`
    ButtonColor      string    `json:"buttonColor,omitempty"`
    CreatedAt        time.Time `json:"createdAt"`
    UpdatedAt        time.Time `json:"updatedAt"`
}
```

#### 공개 응답용 구조체: `SSOProviderPublic`

```go
type SSOProviderPublic struct {
    ID           string `json:"id"`
    Name         string `json:"name"`
    ProviderType string `json:"providerType"`
    IconURL      string `json:"iconUrl,omitempty"`
    ButtonColor  string `json:"buttonColor,omitempty"`
}
```

비인증 사용자에게 노출되는 공개 데이터로, Client ID/Secret 등 민감 정보를 포함하지 않는다.

### 프로바이더 유형별 기본 URL

URL이 명시적으로 설정되지 않은 경우 프로바이더 유형에 따라 자동으로 결정된다.

| 유형 | Authorization URL | Token URL | UserInfo URL |
|------|-------------------|-----------|--------------|
| `google` | `https://accounts.google.com/o/oauth2/v2/auth` | `https://oauth2.googleapis.com/token` | `https://www.googleapis.com/oauth2/v3/userinfo` |
| `github` | `https://github.com/login/oauth/authorize` | `https://github.com/login/oauth/access_token` | `https://api.github.com/user` |
| `azure` | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` | `https://login.microsoftonline.com/common/oauth2/v2.0/token` | `https://graph.microsoft.com/v1.0/me` |
| `oidc` | `{issuerUrl}/protocol/openid-connect/auth` | `{issuerUrl}/protocol/openid-connect/token` | `{issuerUrl}/protocol/openid-connect/userinfo` |

### 프로바이더 CRUD (관리자)

#### 생성 (Create)

- **엔드포인트**: `POST /admin/sso/providers`
- **필수 필드**: `name`, `providerType`, `clientId`, `clientSecret`
- **기본값**: Scopes가 비어 있으면 `"openid email profile"` 자동 설정
- DB에 삽입 후 생성된 UUID `id`를 반환한다.

#### 목록 조회 (Read)

- **엔드포인트**: `GET /admin/sso/providers`
- 모든 프로바이더를 `display_order`, `name` 순서로 반환한다.
- **Client Secret은 목록 응답에서 빈 문자열로 대체**하여 민감 정보를 노출하지 않는다.

#### 수정 (Update)

- **엔드포인트**: `PUT /admin/sso/providers/:id`
- `clientSecret` 필드가 비어 있으면 기존 Secret을 유지한다 (Secret 미변경 모드).
- `clientSecret` 필드에 값이 있으면 새로운 Secret으로 업데이트한다.
- `updated_at` 타임스탬프가 자동 갱신된다.

#### 삭제 (Delete)

- **엔드포인트**: `DELETE /admin/sso/providers/:id`
- 프로바이더가 존재하지 않으면 404를 반환한다.
- 삭제 시 해당 프로바이더로 로그인한 기존 사용자 계정에는 영향을 주지 않는다 (이미 연동된 `users.provider`, `users.provider_id`는 유지).

---

## OAuth2/OIDC 인증 흐름

### 전체 시퀀스

```
사용자 ──(1)──> LoginPage (SSO 버튼 클릭)
              │
              ├──(2)──> GET /api/auth/sso/auth/:providerId
              │          → state 생성, Authorization URL 구성
              │          → { authUrl, state } 반환
              │
사용자 <──(3)── 프론트엔드가 authUrl로 window.location.href 리다이렉트
              │
사용자 ──(4)──> OAuth2 프로바이더 (Google, GitHub 등)
              │   → 사용자 인증 및 동의
              │
프로바이더 ──(5)──> GET /api/auth/sso/callback/:providerId?code=XXX&state=YYY
              │
              ├──(6)──> Token Exchange (Authorization Code → Access Token)
              │          POST {tokenUrl} with code, client_id, client_secret, redirect_uri
              │
              ├──(7)──> UserInfo 조회
              │          GET {userinfoUrl} with Bearer access_token
              │
              ├──(8)──> 이메일 도메인 검증 (프로바이더별 + 전역 허용 도메인)
              │
              ├──(9)──> 사용자 조회 또는 생성 (findOrCreateUser)
              │
              ├──(10)──> JWT 토큰 발급 (HS256, 24시간 만료)
              │
사용자 <──(11)── 302 Redirect → /login?sso_token={jwt}
              │
              └──(12)──> LoginPage에서 sso_token 파라미터 감지
                         → localStorage에 저장
                         → useAuthStore.setToken() 호출
                         → / 로 리다이렉트
```

### 1단계: 인증 시작 (`GetAuthURL`)

```go
// GET /api/auth/sso/auth/:providerId
func (h *SSOHandler) GetAuthURL(c echo.Context) error
```

**처리 과정:**

1. `providerId` 파라미터로 DB에서 프로바이더 설정을 조회한다 (`is_enabled = true` 조건).
2. 프로바이더 유형에 따라 Authorization URL을 결정한다 (커스텀 URL 우선, 없으면 기본값 사용).
3. `generateState()`로 32바이트 랜덤 state 값을 생성한다 (CSRF 방지).
4. Callback URI를 `{scheme}://{host}/api/auth/sso/callback/{providerId}` 형식으로 구성한다.

**Redirect URI 결정 우선순위:**

| 우선순위 | 소스 | 설명 |
|----------|------|------|
| 1 | `EXTERNAL_URL` 환경변수 | 리버스 프록시 뒤의 외부 접근 URL |
| 2 | `X-Forwarded-Host` + `X-Forwarded-Proto` 헤더 | 리버스 프록시가 설정 |
| 3 | 요청의 `Host` 헤더 + TLS 여부 | 직접 접근 시 폴백 |

**Google 프로바이더 추가 파라미터:**

```go
params.Set("access_type", "offline")   // Refresh Token 요청
params.Set("prompt", "select_account") // 계정 선택 화면 강제
```

**응답:**

```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...&response_type=code&redirect_uri=...&scope=openid+email+profile&state=...",
  "state": "base64-encoded-random-state"
}
```

### 2단계: OAuth2 콜백 처리 (`HandleCallback`)

```go
// GET /api/auth/sso/callback/:providerId
func (h *SSOHandler) HandleCallback(c echo.Context) error
```

**처리 과정:**

1. **에러 처리**: `code` 파라미터가 없으면 `error`, `error_description` 파라미터를 읽어 프론트엔드로 에러 리다이렉트한다.
2. **프로바이더 조회**: `providerId`로 DB에서 활성화된 프로바이더 설정을 조회한다.
3. **Token Exchange**: Authorization Code를 Access Token으로 교환한다.
4. **UserInfo 조회**: Access Token으로 사용자 정보를 가져온다.
5. **이메일 도메인 검증**: 프로바이더별 `allowed_domains` + 전역 `sso_allowed_domains` 두 가지를 모두 검사한다.
6. **사용자 조회/생성**: `findOrCreateUser()`를 호출한다.
7. **JWT 발급**: FileHatch JWT 토큰을 생성한다 (24시간 만료).
8. **감사 로그**: `sso_login` 이벤트를 기록한다.
9. **리다이렉트**: `/login?sso_token={jwt}` 형태로 프론트엔드에 토큰을 전달한다.

### 3단계: 토큰 교환 (`exchangeCodeForToken`)

```go
func (h *SSOHandler) exchangeCodeForToken(tokenURL, code, clientID, clientSecret, redirectURI string) (*OIDCTokenResponse, error)
```

**요청:**

```
POST {tokenURL}
Content-Type: application/x-www-form-urlencoded
Accept: application/json

grant_type=authorization_code&code=XXX&client_id=YYY&client_secret=ZZZ&redirect_uri=RRR
```

**응답 모델:**

```go
type OIDCTokenResponse struct {
    AccessToken  string `json:"access_token"`
    TokenType    string `json:"token_type"`
    ExpiresIn    int    `json:"expires_in"`
    RefreshToken string `json:"refresh_token,omitempty"`
    IDToken      string `json:"id_token,omitempty"`
}
```

- HTTP 타임아웃: 10초
- 200이 아닌 응답 시 에러 반환

### 4단계: 사용자 정보 조회 (`getUserInfo`)

```go
func (h *SSOHandler) getUserInfo(provider SSOProvider, accessToken string) (*OIDCUserInfo, error)
```

**응답 모델:**

```go
type OIDCUserInfo struct {
    Sub           string `json:"sub"`            // 프로바이더 고유 ID
    Email         string `json:"email"`
    EmailVerified bool   `json:"email_verified"`
    Name          string `json:"name"`
    GivenName     string `json:"given_name"`
    FamilyName    string `json:"family_name"`
    Picture       string `json:"picture"`
}
```

**GitHub 특수 처리:**

GitHub는 표준 OIDC 필드 대신 자체 형식을 사용하므로 별도 매핑을 수행한다.

```go
// GitHub 전용 응답 매핑
type githubUser struct {
    ID    int    `json:"id"`
    Login string `json:"login"`
    Email string `json:"email"`
    Name  string `json:"name"`
}
userInfo.Sub = fmt.Sprintf("%d", githubUser.ID)  // int → string 변환
userInfo.Name = githubUser.Name                   // Name이 없으면 Login 사용
```

### 5단계: 이메일 도메인 검증

이메일 도메인 검증은 **두 단계**로 수행된다.

1. **프로바이더별 검증**: `sso_providers.allowed_domains` (프로바이더 생성/수정 시 설정)
2. **전역 검증**: `system_settings` 테이블의 `sso_allowed_domains` 키

```go
// 이메일에서 도메인 추출
emailDomain := strings.ToLower(strings.Split(userInfo.Email, "@")[1])

// 허용 도메인 목록과 비교 (대소문자 무시)
for _, domain := range strings.Split(allowedDomains, ",") {
    if strings.TrimSpace(strings.ToLower(domain)) == emailDomain {
        allowed = true
        break
    }
}
```

두 검증 중 하나라도 실패하면 `domain_not_allowed` 에러와 함께 로그인 페이지로 리다이렉트된다.

---

## 사용자 프로비저닝

### 계정 조회/생성 플로우 (`findOrCreateUser`)

```
1. provider + provider_id 로 기존 사용자 검색
   ├─ 발견 → 계정 활성 여부 확인 → 이메일 업데이트 → 반환
   └─ 미발견 →
2. auto_create_user (프로바이더별) 또는 sso_auto_register (전역) 확인
   ├─ 비활성 → "auto-registration is disabled" 에러
   └─ 활성 →
3. email로 기존 사용자 검색 (이메일 기반 계정 연동)
   ├─ 발견 → provider/provider_id 연동 → 반환
   └─ 미발견 →
4. 새 사용자 계정 생성
   ├─ 사용자명 생성 (이메일 접두사 기반)
   ├─ 랜덤 비밀번호 생성 (bcrypt 해시, 실제 사용 불가)
   ├─ DB INSERT (provider, provider_id 포함)
   └─ 홈 디렉토리 생성 ({dataRoot}/users/{username})
```

### 사용자명 자동 생성 규칙 (`generateUsername`)

1. 이메일의 `@` 앞 부분을 기본 사용자명으로 사용한다.
2. 소문자 변환 후 영문자, 숫자, `_`, `-`만 허용한다 (나머지는 `_`로 대체).
3. 3자 미만이면 `"user"`로 대체한다.
4. 20자 초과 시 잘라낸다.
5. 사용자명이 이미 존재하면 숫자 접미사를 추가한다 (`user1`, `user2`, ..., `user999`).
6. 999까지 모두 존재하면 Unix 타임스탬프를 접미사로 사용한다 (`user_1708234567`).

### DB 레코드 구조 (SSO 사용자)

```sql
INSERT INTO users (username, email, password_hash, provider, provider_id, is_admin, is_active)
VALUES ('john_doe', 'john@example.com', '$2a$10$...random...', 'google', '1234567890', false, true)
```

| 필드 | 값 | 설명 |
|------|-----|------|
| `provider` | `google`, `github`, `azure`, `oidc` | 프로바이더 유형 |
| `provider_id` | 프로바이더의 `sub` 값 | 프로바이더 내 고유 식별자 |
| `password_hash` | 랜덤 bcrypt 해시 | SSO 사용자는 비밀번호 로그인 불가 |
| `is_admin` | `provider.DefaultAdmin` 값 | 프로바이더 설정에 따라 결정 |

### 이메일 기반 계정 연동

기존에 로컬 계정으로 등록된 이메일과 동일한 이메일로 SSO 로그인 시, 기존 계정에 `provider`와 `provider_id`를 연동한다. 이후 해당 계정은 SSO와 로컬 비밀번호 양쪽으로 모두 로그인할 수 있다.

---

## 브루트포스 보호

### 핵심 구조

| 항목 | 값 |
|------|-----|
| 구현체 | `BruteForceGuard` (싱글톤) |
| 저장소 | Valkey (Redis) + 로컬 캐시 (sync.Map) + PostgreSQL |
| 키 접두사 | `fh:bruteforce:` |
| 설정 소스 | `system_settings` 테이블 (`bruteforce_*` 키) |

### 설정 항목 (`BruteForceConfig`)

| 설정 | DB 키 | 기본값 | 설명 |
|------|-------|--------|------|
| `Enabled` | `bruteforce_enabled` | `true` | 기능 활성화 여부 |
| `MaxAttempts` | `bruteforce_max_attempts` | `5` | 사용자별 최대 로그인 시도 횟수 |
| `WindowDuration` | `bruteforce_window_minutes` | `5분` | 시도 횟수 추적 시간 윈도우 |
| `LockDuration` | `bruteforce_lock_minutes` | `15분` | 사용자 계정 잠금 시간 |
| `IPMaxAttempts` | `bruteforce_ip_max_attempts` | `20` | IP별 최대 시도 횟수 |
| `IPLockDuration` | `bruteforce_ip_lock_minutes` | `30분` | IP 잠금 시간 |

### 3계층 저장소 아키텍처

```
┌──────────────────────┐
│   Valkey (Redis)     │  ← 기본 저장소 (분산 환경 지원)
│   - 시도 카운터      │
│   - IP/사용자 잠금   │
│   - TTL 기반 자동 만료 │
├──────────────────────┤
│   로컬 캐시 (sync.Map)│  ← Valkey 장애 시 폴백
│   - 1분 주기 만료 정리│
├──────────────────────┤
│   PostgreSQL         │  ← 영구 기록 (사용자 계정)
│   - failed_login_count│
│   - last_failed_login │
│   - locked_until     │
└──────────────────────┘
```

- **Valkey 사용 가능**: 시도 카운터와 잠금 상태를 Valkey에 저장하고, 사용자 정보는 DB에도 동기 기록한다.
- **Valkey 장애**: `sync.Map` 기반 로컬 캐시로 폴백하며, 기능은 유지된다 (단, 분산 환경에서 노드별 독립 추적).
- **DB 기록**: 사용자 계정의 `locked_until`, `failed_login_count`, `last_failed_login`은 항상 DB에 영구 기록한다.

### 로그인 시도 검증 플로우 (`CheckAndRecordAttempt`)

```
(1) 기능 비활성화 확인 → 비활성이면 통과

(2) IP 잠금 확인
    ├─ Valkey: fh:bruteforce:locked:ip:{ip} TTL 확인
    └─ 로컬캐시: locked:ip:{ip} 만료 확인
    → 잠김이면 차단 (사유: "IP가 {시각}까지 잠겨 있습니다")

(3) 사용자 잠금 확인 (username이 있는 경우)
    ├─ DB: users.locked_until > NOW() 확인
    ├─ Valkey: fh:bruteforce:locked:user:{username} TTL 확인
    └─ 로컬캐시: locked:user:{username} 만료 확인
    → 잠김이면 차단 (사유: "계정이 {시각}까지 잠겨 있습니다")

(4) IP 시도 횟수 확인
    → IPMaxAttempts(20) 이상이면 IP 잠금 실행

(5) 사용자 시도 횟수 확인 (username이 있는 경우)
    → MaxAttempts(5) 이상이면 사용자 잠금 실행

→ 통과 시 (allowed=true, 남은 시도 횟수 반환)
```

### 실패 기록 (`RecordFailedAttempt`)

```go
// IP 카운터 증가 (Valkey Pipeline: INCR + EXPIRE)
g.incrementAttempt(ctx, "ip:"+ip, g.config.WindowDuration)

// 사용자 카운터 증가
g.incrementAttempt(ctx, "user:"+username, g.config.WindowDuration)

// DB에 영구 기록
UPDATE users SET
    failed_login_count = COALESCE(failed_login_count, 0) + 1,
    last_failed_login = NOW()
WHERE username = $1

// 임계값 도달 시 잠금 실행
```

### 성공 시 리셋 (`RecordSuccessfulLogin`)

로그인 성공 시 모든 저장소에서 해당 IP와 사용자의 카운터 및 잠금 상태를 초기화한다.

```go
// Valkey 키 삭제
g.redis.Del(ctx, g.keyPrefix+"ip:"+ip)
g.redis.Del(ctx, g.keyPrefix+"user:"+username)

// 로컬 캐시 삭제
g.localCache.Delete("ip:" + ip)
g.localCache.Delete("user:" + username)

// DB 초기화
UPDATE users SET
    failed_login_count = 0,
    last_failed_login = NULL,
    locked_until = NULL
WHERE username = $1
```

### 잠금 메커니즘

**사용자 잠금 (`lockUser`):**

1. DB에 `locked_until` 타임스탬프 기록 (영구 저장)
2. Valkey에 `fh:bruteforce:locked:user:{username}` 키 설정 (TTL = LockDuration)
3. 로컬 캐시에 저장

**IP 잠금 (`lockIP`):**

1. Valkey에 `fh:bruteforce:locked:ip:{ip}` 키 설정 (TTL = IPLockDuration)
2. 로컬 캐시에 저장
3. (IP 잠금은 DB에 기록하지 않음)

### 감사 로그 이벤트

| 이벤트 | 상수 | 설명 |
|--------|------|------|
| 계정 잠금 | `security.account_locked` | 사용자 계정 잠금 시 |
| 계정 잠금 해제 | `security.account_unlocked` | 관리자가 잠금 해제 시 |
| IP 잠금 | `security.ip_locked` | IP 주소 잠금 시 |
| IP 잠금 해제 | `security.ip_unlocked` | 관리자가 IP 잠금 해제 시 |
| 로그인 차단 | `security.login_blocked` | 잠금 상태에서 로그인 시도 시 |

### 관리자 잠금 해제

| 대상 | 메서드 | 처리 |
|------|--------|------|
| 사용자 | `AdminUnlockUser` | Valkey 키 삭제 + 로컬 캐시 삭제 + DB `locked_until=NULL`, `failed_login_count=0` |
| IP | `AdminUnlockIP` | Valkey 키 삭제 + 로컬 캐시 삭제 |

### 설정 리로드

`ReloadConfig()` 메서드로 DB에서 설정을 다시 로드할 수 있다. 관리자가 `system_settings`의 `bruteforce_*` 값을 변경한 후 호출한다.

---

## 전역 SSO 설정

`system_settings` 테이블에 저장되는 SSO 관련 전역 설정:

| 키 | 기본값 | 설명 |
|----|--------|------|
| `sso_enabled` | `false` | SSO 로그인 기능 활성화 여부 |
| `sso_only_mode` | `false` | SSO 전용 모드 (활성화 시 로컬 비밀번호 로그인 비활성화) |
| `sso_auto_register` | `true` | SSO 최초 로그인 시 자동 사용자 계정 생성 |
| `sso_allowed_domains` | `""` | SSO 허용 이메일 도메인 (쉼표 구분, 비어있으면 모두 허용) |

### 자동 사용자 생성 조건

자동 사용자 생성은 다음 조건 중 하나를 만족하면 수행된다:

1. **프로바이더별 설정**: `sso_providers.auto_create_user = true`
2. **전역 설정**: `system_settings.sso_auto_register = 'true'`

프로바이더별 설정(`auto_create_user`)이 `false`인 경우에도 전역 설정이 `true`이면 계정이 생성된다.

---

## API 엔드포인트

### 공개 API (인증 불필요)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/auth/sso/providers` | 활성화된 SSO 프로바이더 공개 목록 조회 |
| `GET` | `/auth/sso/auth/:providerId` | SSO 인증 시작 (Authorization URL 반환) |
| `GET` | `/auth/sso/callback/:providerId` | OAuth2 콜백 처리 (토큰 교환 및 JWT 발급) |

#### `GET /auth/sso/providers` 응답

```json
{
  "enabled": true,
  "ssoOnlyMode": false,
  "providers": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Google",
      "providerType": "google",
      "iconUrl": null,
      "buttonColor": null
    }
  ]
}
```

- `enabled = false`인 경우 빈 프로바이더 목록을 반환한다.
- `ssoOnlyMode = true`인 경우 프론트엔드에서 로컬 로그인 폼을 숨긴다.

#### `GET /auth/sso/auth/:providerId` 응답

```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...&response_type=code&redirect_uri=...&scope=openid+email+profile&state=...",
  "state": "dGhpcyBpcyBhIHJhbmRvbSBzdGF0ZQ=="
}
```

#### `GET /auth/sso/callback/:providerId`

- 성공 시: `302 Redirect → /login?sso_token={jwt}`
- 에러 시: `302 Redirect → /login?error={error_code}&message={description}`

### 관리자 API (Admin 미들웨어 필요)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/admin/sso/providers` | 전체 프로바이더 목록 (Secret 제외) |
| `POST` | `/admin/sso/providers` | 프로바이더 생성 |
| `PUT` | `/admin/sso/providers/:id` | 프로바이더 수정 |
| `DELETE` | `/admin/sso/providers/:id` | 프로바이더 삭제 |
| `GET` | `/admin/sso/settings` | SSO 전역 설정 조회 |
| `PUT` | `/admin/sso/settings` | SSO 전역 설정 수정 |

### 보안 관리 API (Admin 미들웨어 필요)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/admin/security/locked-users` | 잠긴 사용자 목록 |
| `DELETE` | `/admin/security/locked-users/:username` | 사용자 잠금 해제 |
| `GET` | `/admin/security/bruteforce-stats` | 브루트포스 통계 |

#### `GET /admin/security/locked-users` 응답

```json
{
  "lockedUsers": [
    {
      "username": "john",
      "lockedUntil": "2024-01-15T10:30:00Z",
      "failedCount": 5,
      "lastFailedAt": "2024-01-15T10:15:00Z",
      "remainingTime": "14m 30s"
    }
  ],
  "total": 1
}
```

#### `GET /admin/security/bruteforce-stats` 응답

```json
{
  "trackedIPs": 3,
  "trackedUsers": 2,
  "lockedUsers": 1,
  "config": {
    "enabled": true,
    "maxAttempts": 5,
    "windowMinutes": 5,
    "lockMinutes": 15,
    "ipMaxAttempts": 20,
    "ipLockMinutes": 30
  }
}
```

---

## 관리자 설정 UI

### 컴포넌트: `AdminSSOSettings`

`ui/src/components/AdminSSOSettings.tsx`에 구현된 관리자 SSO 설정 페이지.

### 전역 설정 섹션

| 항목 | UI 유형 | 동작 |
|------|---------|------|
| SSO 활성화 | 토글 스위치 | `sso_enabled` 즉시 저장 |
| SSO 전용 모드 | 토글 스위치 | `sso_only_mode` 즉시 저장 (활성화 시 로컬 로그인 숨김) |
| 자동 사용자 생성 | 토글 스위치 | `sso_auto_register` 즉시 저장 |
| 허용 도메인 | 텍스트 입력 | `sso_allowed_domains` 즉시 저장 (쉼표 구분) |

- SSO 비활성화 상태에서는 하위 설정이 숨겨진다.
- 각 설정 변경 시 `PUT /admin/sso/settings` API가 즉시 호출된다.

### 프로바이더 관리 섹션

- **프로바이더 목록**: 카드 형태로 표시, 유형 배지, Client ID (30자 초과 시 말줄임), 활성/비활성 상태 표시
- **추가/수정 모달**: 프로바이더 유형 선택, 필수 필드 입력, OIDC 유형 선택 시 Issuer URL 및 커스텀 URL 필드 추가 표시
- **삭제**: 확인 다이얼로그 후 삭제

### 프로바이더 유형 선택

| 값 | 라벨 | 설명 |
|----|------|------|
| `google` | Google | Google OAuth2 |
| `github` | GitHub | GitHub OAuth App |
| `azure` | Microsoft Azure | Azure AD OAuth2 |
| `oidc` | OIDC (Keycloak, etc.) | 범용 OIDC 프로바이더 |

### 모달 폼 필드

| 필드 | 필수 | 조건 | 설명 |
|------|------|------|------|
| 프로바이더 유형 | 예 | 항상 | 드롭다운 선택 |
| 표시 이름 | 예 | 항상 | 로그인 버튼에 표시될 이름 |
| Client ID | 예 | 항상 | OAuth2 Client ID |
| Client Secret | 생성시 예 / 수정시 선택 | 항상 | 비어있으면 기존 값 유지 |
| Issuer URL | 예 (OIDC) | `providerType === 'oidc'` | OIDC Discovery URL |
| Authorization URL | 아니오 | `providerType === 'oidc'` | 자동 생성됨 (커스텀 가능) |
| Token URL | 아니오 | `providerType === 'oidc'` | 자동 생성됨 (커스텀 가능) |
| Scopes | 아니오 | 항상 | 기본값: `openid email profile` |
| 허용 도메인 | 아니오 | 항상 | 쉼표 구분, 비어있으면 모두 허용 |
| 자동 사용자 생성 | 아니오 | 항상 | 체크박스 |
| 기본 관리자 권한 | 아니오 | 항상 | 체크박스 |
| 활성화 | 아니오 | 항상 | 체크박스 |

### 설정 가이드 섹션

관리자 UI 하단에 프로바이더별 설정 가이드를 제공한다:

- **Google**: Google Cloud Console OAuth 2.0 클라이언트 설정 링크
- **GitHub**: GitHub Developer Settings OAuth App 설정 링크
- **Keycloak / OIDC**: Issuer URL 형식 안내 (`https://keycloak.example.com/realms/REALM_NAME`)
- **Callback URL**: `{현재 도메인}/api/auth/sso/callback/[PROVIDER_ID]` 형식으로 프로바이더에 등록해야 함을 안내

---

## 로그인 페이지 SSO 통합

### 프론트엔드 플로우 (`LoginPage.tsx`)

#### 1. 프로바이더 목록 로드

페이지 마운트 시 `getSSOProviders()` 호출:

```typescript
const [ssoProviders, setSSOProviders] = useState<SSOProviderPublic[]>([])
const [ssoEnabled, setSSOEnabled] = useState(false)
const [ssoOnlyMode, setSSOOnlyMode] = useState(false)
```

#### 2. SSO 버튼 렌더링

- `ssoEnabled && ssoProviders.length > 0`일 때 SSO 버튼 섹션을 렌더링한다.
- 프로바이더별 아이콘 및 색상을 표시한다 (커스텀 `iconUrl` 우선, 없으면 유형별 기본 아이콘).
- 버튼 텍스트: `"{프로바이더명}으로 로그인"`

#### 3. SSO 로그인 실행

```typescript
const handleSSOLogin = async (provider: SSOProviderPublic) => {
  const { authUrl } = await getSSOAuthURL(provider.id)
  window.location.href = authUrl  // OAuth2 프로바이더로 리다이렉트
}
```

#### 4. 콜백 토큰 처리

페이지 마운트 시 URL 파라미터를 확인한다:

```typescript
const ssoToken = params.get('sso_token')
if (ssoToken) {
  // localStorage에 직접 저장 (Zustand persist와 동기화)
  localStorage.setItem('filehatch-auth', JSON.stringify({
    state: { token: ssoToken, user: null },
    version: 0
  }))
  // Zustand 상태 업데이트
  setToken(ssoToken)
  // 100ms 후 메인 페이지로 이동
  setTimeout(() => { window.location.href = '/' }, 100)
}
```

#### 5. 조건부 UI 표시

| 조건 | 표시 | 숨김 |
|------|------|------|
| SSO 활성, 프로바이더 있음, SSO 전용 모드 아님 | SSO 버튼 + 구분선("또는") + 로컬 로그인 폼 | - |
| SSO 활성, 프로바이더 있음, SSO 전용 모드 | SSO 버튼 + SSO 전용 안내 메시지 | 로컬 로그인 폼 |
| SSO 비활성 | 로컬 로그인 폼 | SSO 버튼 |

### 프로바이더별 기본 버튼 스타일

| 유형 | 색상 |
|------|------|
| `google` | `#ffffff` (흰색 배경) |
| `github` | `#24292e` (어두운 배경) |
| `azure` | `#0078d4` (파란색 배경) |
| `oidc` 등 기타 | `#6366f1` (보라색 배경) |

프로바이더의 `buttonColor` 필드가 설정되어 있으면 기본 색상을 오버라이드한다.

---

## 보안 고려사항

### CSRF 방지

- OAuth2 `state` 파라미터를 32바이트 암호학적 랜덤 값으로 생성한다 (`crypto/rand`).
- Base64 URL 인코딩하여 Authorization URL에 포함한다.

### Client Secret 보호

- DB에 저장 시 일반 텍스트로 저장된다 (향후 AES-GCM 암호화 적용 가능).
- 관리자 API 목록 응답에서 Client Secret은 빈 문자열로 대체된다.
- 수정 시 Secret 필드가 비어있으면 기존 값을 유지한다.

### Redirect URI 검증

- Callback URI는 서버에서 동적으로 구성되며, `EXTERNAL_URL` 환경변수를 우선 사용한다.
- 프로바이더에 등록된 Redirect URI와 정확히 일치해야 한다.

### 이메일 도메인 제한

- 프로바이더별 + 전역 두 단계의 도메인 검증을 수행한다.
- 대소문자를 무시하고 비교한다.

### SSO 전용 모드 주의사항

- `sso_only_mode = true` 설정 시 관리자 계정도 SSO로만 로그인 가능하다.
- SSO 프로바이더 장애 시 로그인이 불가능해질 수 있으므로, 최소 1개의 관리자 계정은 SSO 연동이 완료된 상태에서 활성화해야 한다.

### JWT 토큰 전달 보안

- SSO 콜백 후 JWT 토큰이 URL 쿼리 파라미터(`?sso_token=...`)로 전달된다.
- 프론트엔드에서 즉시 `window.history.replaceState()`로 URL에서 토큰을 제거한다.
- 토큰은 `localStorage`에 저장되며, 이후 API 요청에 `Authorization: Bearer` 헤더로 사용된다.

### 비밀번호 보호

- SSO로 생성된 계정의 비밀번호는 32바이트 랜덤 값으로 설정되어 비밀번호 로그인이 사실상 불가능하다.
- 관리자가 해당 계정의 비밀번호를 별도로 설정하면 로컬 + SSO 양쪽 로그인이 가능해진다.

### 감사 로그

SSO 로그인 성공 시 `audit_logs` 테이블에 기록한다:

```sql
INSERT INTO audit_logs (actor_id, ip_addr, event_type, target_resource, details)
VALUES ($1, $2, 'sso_login', $3, '{"provider": "google", "email": "user@example.com"}')
```

---

## Keycloak 연동 예시

### 1. Keycloak 설정

1. Keycloak Admin Console에서 Realm을 생성하거나 기존 Realm을 사용한다.
2. **Clients** 메뉴에서 새 Client를 생성한다:
   - Client ID: `filehatch` (임의 지정)
   - Client Protocol: `openid-connect`
   - Root URL: `https://files.example.com`
3. Client 설정에서:
   - **Access Type**: `confidential`
   - **Valid Redirect URIs**: `https://files.example.com/api/auth/sso/callback/*`
   - **Web Origins**: `https://files.example.com`
4. **Credentials** 탭에서 Client Secret을 복사한다.

### 2. FileHatch SSO 프로바이더 등록

관리자 대시보드 > SSO 설정 > 프로바이더 추가:

| 필드 | 값 |
|------|-----|
| 프로바이더 유형 | OIDC (Keycloak, etc.) |
| 표시 이름 | Company SSO |
| Client ID | `filehatch` |
| Client Secret | (Keycloak에서 복사한 값) |
| Issuer URL | `https://keycloak.example.com/realms/my-realm` |
| Scopes | `openid email profile` |
| 자동 사용자 생성 | 활성화 |
| 활성화 | 활성화 |

### 3. URL 자동 생성

Issuer URL을 설정하면 다음 URL이 자동으로 생성된다:

| 항목 | URL |
|------|-----|
| Authorization URL | `https://keycloak.example.com/realms/my-realm/protocol/openid-connect/auth` |
| Token URL | `https://keycloak.example.com/realms/my-realm/protocol/openid-connect/token` |
| UserInfo URL | `https://keycloak.example.com/realms/my-realm/protocol/openid-connect/userinfo` |

커스텀 URL을 입력하면 자동 생성된 URL 대신 해당 값이 사용된다.

### 4. 환경변수 설정

```bash
# docker-compose.yml 또는 .env
EXTERNAL_URL=https://files.example.com
```

`EXTERNAL_URL`은 리버스 프록시 뒤에서 운영할 때 콜백 URL을 올바르게 생성하기 위해 필수적이다. 이 값이 설정되지 않으면 요청 헤더(`X-Forwarded-Host`, `Host`)를 기반으로 URL이 구성된다.

### 5. 테스트

1. SSO 전역 설정에서 **SSO 활성화**를 켠다.
2. 로그인 페이지에서 **Company SSO로 로그인** 버튼이 나타나는지 확인한다.
3. 버튼 클릭 시 Keycloak 로그인 페이지로 리다이렉트되는지 확인한다.
4. Keycloak 인증 후 FileHatch로 돌아와 자동 로그인되는지 확인한다.
5. 자동 생성된 계정의 사용자명과 이메일이 올바른지 확인한다.

### 6. 도메인 제한 (선택)

특정 이메일 도메인만 SSO 로그인을 허용하려면:

- **프로바이더별**: 프로바이더 수정 > 허용 도메인에 `company.com, subsidiary.co.kr` 입력
- **전역**: SSO 전역 설정 > 허용 도메인에 동일하게 입력

---

## 제한사항 및 향후 개선

| 항목 | 현재 상태 | 향후 계획 |
|------|-----------|-----------|
| State 검증 | 생성만 하고 콜백 시 검증하지 않음 | Redis에 state를 저장하고 콜백 시 비교 검증 |
| PKCE | 미지원 | Authorization Code Flow with PKCE 지원 |
| Client Secret 암호화 | DB에 일반 텍스트 저장 | AES-GCM 암호화 저장 |
| Refresh Token | 미사용 (발급만 받음) | Access Token 갱신에 활용 |
| 그룹/역할 매핑 | 미지원 | Keycloak 그룹 → FileHatch 관리자/일반 사용자 자동 매핑 |
| OIDC Discovery | URL 패턴 기반 추론 | `.well-known/openid-configuration` 자동 검색 |
| SSO 로그아웃 | 미지원 | 프로바이더 측 로그아웃 연동 (Back-Channel Logout) |
