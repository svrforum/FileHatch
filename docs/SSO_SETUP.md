# SSO (Single Sign-On) 설정 가이드

FileHatch에서 SSO(Single Sign-On)를 설정하는 방법을 상세히 설명합니다.

---

## 목차

1. [개요](#1-개요)
2. [사전 요구사항](#2-사전-요구사항)
3. [Keycloak 설치 및 시작](#3-keycloak-설치-및-시작)
4. [Keycloak 초기 설정](#4-keycloak-초기-설정)
5. [자동 설정 스크립트 사용](#5-자동-설정-스크립트-사용)
6. [FileHatch SSO 프로바이더 등록](#6-filehatch-sso-프로바이더-등록)
7. [다른 SSO 프로바이더 설정](#7-다른-sso-프로바이더-설정)
8. [고급 설정](#8-고급-설정)
9. [문제 해결](#9-문제-해결)
10. [프로덕션 권장 사항](#10-프로덕션-권장-사항)

---

## 1. 개요

### SSO(Single Sign-On)란?

SSO는 사용자가 한 번의 로그인으로 여러 애플리케이션에 접근할 수 있게 해주는 인증 방식입니다. FileHatch는 OAuth 2.0 / OpenID Connect(OIDC) 프로토콜을 지원하여 다양한 ID 프로바이더와 연동할 수 있습니다.

### 지원하는 프로바이더

| 프로바이더 | 타입 | 설명 |
|-----------|------|------|
| **Keycloak** | `oidc` | 오픈소스 IAM 솔루션, 자체 호스팅 가능 |
| **Google** | `google` | Google Workspace 계정 연동 |
| **GitHub** | `github` | GitHub 계정 연동 |
| **Microsoft Azure AD** | `azure` | Microsoft 365 / Azure AD 연동 |
| **기타 OIDC** | `oidc` | 표준 OIDC를 지원하는 모든 프로바이더 |

### SSO 인증 흐름

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   사용자     │      │  FileHatch  │      │ SSO Provider│
│  (브라우저)  │      │   (API)     │      │ (Keycloak)  │
└──────┬──────┘      └──────┬──────┘      └──────┬──────┘
       │                    │                    │
       │ 1. SSO 로그인 클릭  │                    │
       │───────────────────>│                    │
       │                    │                    │
       │ 2. 인증 URL 반환    │                    │
       │<───────────────────│                    │
       │                    │                    │
       │ 3. 프로바이더로 리다이렉트                │
       │────────────────────────────────────────>│
       │                    │                    │
       │ 4. 사용자 로그인 (ID/PW 입력)            │
       │<───────────────────────────────────────>│
       │                    │                    │
       │ 5. 콜백 URL로 리다이렉트 (인증 코드 포함)  │
       │<────────────────────────────────────────│
       │                    │                    │
       │ 6. 인증 코드 전달   │                    │
       │───────────────────>│                    │
       │                    │ 7. 토큰 교환        │
       │                    │───────────────────>│
       │                    │                    │
       │                    │ 8. 액세스 토큰 반환  │
       │                    │<───────────────────│
       │                    │                    │
       │                    │ 9. 사용자 정보 조회  │
       │                    │───────────────────>│
       │                    │                    │
       │                    │ 10. 사용자 정보 반환 │
       │                    │<───────────────────│
       │                    │                    │
       │ 11. JWT 토큰 발급 및 로그인 완료          │
       │<───────────────────│                    │
       │                    │                    │
```

---

## 2. 사전 요구사항

### 필수 요구사항

- **Docker Engine** 24.0 이상
- **Docker Compose** v2.20 이상
- **네트워크**: Keycloak 포트 (기본: 8180) 접근 가능
- **메모리**: Keycloak 실행에 최소 1GB 추가 필요

### 중요: 호스트명 설정

> ⚠️ **SSO 설정에서 가장 중요한 부분입니다!**

SSO가 올바르게 작동하려면 **브라우저**와 **API 서버** 모두 **동일한 호스트명**으로 Keycloak에 접근해야 합니다. 이는 토큰 발급자(Issuer) 검증 때문입니다.

**올바른 예:**
```
브라우저 접근: http://192.168.1.100:8180/auth
API 서버 접근: http://192.168.1.100:8180/auth
→ 토큰 Issuer가 일치하여 검증 성공
```

**잘못된 예:**
```
브라우저 접근: http://192.168.1.100:8180/auth
API 서버 접근: http://localhost:8180/auth  (Docker 내부)
→ 토큰 Issuer 불일치로 검증 실패
```

---

## 3. Keycloak 설치 및 시작

### 3.1 환경 변수 설정

`.env` 파일에서 Keycloak 관련 설정을 확인하고 필요시 수정합니다:

```bash
# Keycloak 설정
KEYCLOAK_PORT=8180                    # Keycloak 접속 포트
KEYCLOAK_ADMIN=admin                  # 관리자 계정
KEYCLOAK_ADMIN_PASSWORD=admin123      # 관리자 비밀번호 (프로덕션에서 변경 필수!)
KEYCLOAK_HOSTNAME=192.168.1.100       # 외부 접근 호스트명 (중요!)
```

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `KEYCLOAK_PORT` | 8180 | Keycloak 웹 콘솔 포트 |
| `KEYCLOAK_ADMIN` | admin | 관리자 사용자명 |
| `KEYCLOAK_ADMIN_PASSWORD` | admin123 | 관리자 비밀번호 |
| `KEYCLOAK_HOSTNAME` | localhost | **중요!** 외부 접근 호스트명 |

### 3.2 Keycloak 시작

```bash
# SSO 프로필로 서비스 시작
docker compose --profile sso up -d

# 또는 OnlyOffice와 함께 시작
docker compose --profile sso --profile office up -d
```

### 3.3 시작 상태 확인

Keycloak은 시작하는 데 약 **1-2분**이 소요됩니다.

```bash
# 로그 확인 (실시간)
docker compose logs -f keycloak

# "Running the server" 메시지가 나타나면 준비 완료
# 또는 헬스체크 확인
docker compose ps keycloak
```

**정상 시작 로그 예시:**
```
keycloak  | 2024-01-15 10:00:00,000 INFO  [org.keycloak.quarkus.runtime.hostname.DefaultHostnameProvider] Hostname settings: ...
keycloak  | 2024-01-15 10:00:05,000 INFO  [io.quarkus] Keycloak 26.4.0 on JVM started in 15.234s
keycloak  | 2024-01-15 10:00:05,100 INFO  [io.quarkus] Running the server in development mode...
```

### 3.4 관리 콘솔 접속

브라우저에서 다음 URL로 접속합니다:

```
http://{KEYCLOAK_HOSTNAME}:{KEYCLOAK_PORT}/auth
예: http://192.168.1.100:8180/auth
```

**로그인 정보:**
- 사용자명: `admin` (또는 `KEYCLOAK_ADMIN` 값)
- 비밀번호: `admin123` (또는 `KEYCLOAK_ADMIN_PASSWORD` 값)

---

## 4. Keycloak 초기 설정

Keycloak 관리 콘솔에서 FileHatch 연동을 위한 설정을 진행합니다.

### 4.1 Realm 생성

1. 좌측 상단 드롭다운 메뉴에서 **"Create realm"** 클릭
2. Realm 정보 입력:
   - **Realm name**: `filehatch` (또는 원하는 이름)
3. **Create** 버튼 클릭

> 💡 **Realm**이란? Keycloak에서 사용자, 클라이언트, 역할 등을 격리하는 단위입니다. 각 Realm은 독립적인 인증 영역입니다.

### 4.2 Client 생성

1. 좌측 메뉴에서 **Clients** 클릭
2. **Create client** 버튼 클릭
3. **General Settings**:
   - **Client type**: OpenID Connect
   - **Client ID**: `filehatch` (원하는 ID)
   - **Next** 클릭
4. **Capability config**:
   - **Client authentication**: ON (활성화)
   - **Authorization**: OFF
   - **Authentication flow**: Standard flow 체크
   - **Next** 클릭
5. **Login settings**:
   - **Valid redirect URIs**: `http://localhost:3080/api/auth/sso/callback/*`
     - 실제 서버 URL로 변경 필요 (예: `https://files.company.com/api/auth/sso/callback/*`)
   - **Web origins**: `+` (모든 redirect URI 허용) 또는 구체적인 origin
   - **Save** 클릭

### 4.3 Client Secret 확인

1. 생성된 Client 클릭
2. **Credentials** 탭 클릭
3. **Client secret** 값을 복사하여 저장

> ⚠️ 이 값은 FileHatch에 SSO 프로바이더를 등록할 때 필요합니다.

### 4.4 테스트 사용자 생성

1. 좌측 메뉴에서 **Users** 클릭
2. **Add user** 버튼 클릭
3. 사용자 정보 입력:
   - **Username**: `testuser`
   - **Email**: `testuser@example.com`
   - **Email verified**: ON
   - **First name**: `Test`
   - **Last name**: `User`
4. **Create** 클릭
5. **Credentials** 탭에서 비밀번호 설정:
   - **Set password** 클릭
   - 비밀번호 입력
   - **Temporary**: OFF (영구 비밀번호)
   - **Save** 클릭

---

## 5. 자동 설정 스크립트 사용

수동 설정 대신 제공되는 스크립트를 사용하면 자동으로 Realm, Client, 테스트 사용자를 생성할 수 있습니다.

### 5.1 스크립트 실행

```bash
# Keycloak이 실행 중인지 확인
docker compose ps keycloak

# 자동 설정 스크립트 실행
./scripts/setup-keycloak.sh
```

### 5.2 환경 변수 커스터마이징

스크립트 실행 전 환경 변수로 설정을 변경할 수 있습니다:

```bash
# 예: 커스텀 설정으로 실행
HOST_IP=192.168.1.100 \
FH_URL=http://192.168.1.100:3080 \
REALM_NAME=mycompany \
CLIENT_ID=filehatch \
./scripts/setup-keycloak.sh
```

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `HOST_IP` | 자동 감지 | Keycloak 호스트 IP |
| `FH_URL` | http://localhost:3080 | FileHatch URL |
| `REALM_NAME` | filehatch | Keycloak Realm 이름 |
| `CLIENT_ID` | filehatch | OAuth Client ID |
| `CLIENT_SECRET` | 자동 생성 | OAuth Client Secret |

### 5.3 생성되는 리소스

스크립트 실행 후 생성되는 리소스:

1. **Realm**: `filehatch` (또는 지정한 이름)
2. **Client**: `filehatch` (Confidential)
3. **테스트 사용자**: `testuser` / `test1234`
4. **FileHatch SSO 프로바이더** 자동 등록

---

## 6. FileHatch SSO 프로바이더 등록

### 6.1 관리자 페이지에서 설정 (권장)

1. FileHatch에 관리자 계정으로 로그인
2. 우측 상단 프로필 아이콘 클릭 → **관리자 설정**
3. 좌측 메뉴에서 **SSO 설정** 클릭
4. **SSO 활성화** 토글 ON
5. **새 프로바이더 추가** 버튼 클릭
6. 프로바이더 정보 입력

### 6.2 각 필드 상세 설명

| 필드 | 설명 | 예시 |
|------|------|------|
| **프로바이더 이름** | 로그인 버튼에 표시될 이름 | `회사 SSO` |
| **프로바이더 타입** | 프로바이더 종류 | `oidc` (Keycloak) |
| **Client ID** | OAuth 클라이언트 ID | `filehatch` |
| **Client Secret** | OAuth 클라이언트 시크릿 | Keycloak에서 복사한 값 |
| **Issuer URL** | OIDC 발급자 URL | `http://192.168.1.100:8180/auth/realms/filehatch` |
| **Authorization URL** | 인증 엔드포인트 (자동 파생 가능) | (비워두면 Issuer에서 파생) |
| **Token URL** | 토큰 엔드포인트 (자동 파생 가능) | (비워두면 Issuer에서 파생) |
| **Userinfo URL** | 사용자 정보 엔드포인트 (자동 파생 가능) | (비워두면 Issuer에서 파생) |
| **Scopes** | 요청할 OAuth 스코프 | `openid email profile` |
| **허용 도메인** | 허용할 이메일 도메인 (쉼표 구분) | `company.com,partner.com` |
| **자동 사용자 생성** | 첫 로그인 시 자동 계정 생성 | ON |
| **기본 관리자** | 자동 생성 시 관리자 권한 부여 | OFF (주의!) |

### 6.3 중요: Issuer URL 형식

```
http://{KEYCLOAK_HOSTNAME}:{KEYCLOAK_PORT}/auth/realms/{REALM_NAME}

예시:
- http://192.168.1.100:8180/auth/realms/filehatch
- https://sso.company.com/auth/realms/company
```

### 6.4 curl을 이용한 API 설정

관리자 JWT 토큰을 먼저 획득한 후:

```bash
# 1. 관리자 로그인하여 JWT 토큰 획득
TOKEN=$(curl -s -X POST http://localhost:3080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' | jq -r '.token')

# 2. SSO 프로바이더 등록
curl -X POST http://localhost:3080/api/admin/sso/providers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Keycloak SSO",
    "providerType": "oidc",
    "clientId": "filehatch",
    "clientSecret": "YOUR_CLIENT_SECRET",
    "issuerUrl": "http://192.168.1.100:8180/auth/realms/filehatch",
    "scopes": "openid email profile",
    "autoCreateUser": true,
    "isEnabled": true
  }'

# 3. SSO 활성화
curl -X PUT http://localhost:3080/api/admin/sso/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sso_enabled": "true"
  }'
```

---

## 7. 다른 SSO 프로바이더 설정

### 7.1 Google OAuth 2.0

#### Google Cloud Console 설정

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 프로젝트 선택 또는 새 프로젝트 생성
3. **API 및 서비스** → **OAuth 동의 화면** 설정:
   - 사용자 유형: 외부 (또는 내부)
   - 앱 이름, 사용자 지원 이메일 입력
   - 스코프 추가: `email`, `profile`, `openid`
4. **사용자 인증 정보** → **사용자 인증 정보 만들기** → **OAuth 클라이언트 ID**:
   - 애플리케이션 유형: 웹 애플리케이션
   - 승인된 리디렉션 URI: `http://localhost:3080/api/auth/sso/callback/{PROVIDER_ID}`

#### FileHatch 등록

```json
{
  "name": "Google 로그인",
  "providerType": "google",
  "clientId": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
  "clientSecret": "YOUR_GOOGLE_CLIENT_SECRET",
  "scopes": "openid email profile",
  "autoCreateUser": true,
  "isEnabled": true
}
```

> 💡 Google의 경우 Issuer URL, Authorization URL 등은 자동으로 설정됩니다.

### 7.2 GitHub OAuth

#### GitHub Developer Settings

1. [GitHub Developer Settings](https://github.com/settings/developers) 접속
2. **OAuth Apps** → **New OAuth App**:
   - Application name: `FileHatch`
   - Homepage URL: `http://localhost:3080`
   - Authorization callback URL: `http://localhost:3080/api/auth/sso/callback/{PROVIDER_ID}`
3. **Register application** 클릭
4. **Generate a new client secret** 클릭하여 시크릿 생성

#### FileHatch 등록

```json
{
  "name": "GitHub 로그인",
  "providerType": "github",
  "clientId": "YOUR_GITHUB_CLIENT_ID",
  "clientSecret": "YOUR_GITHUB_CLIENT_SECRET",
  "scopes": "user:email",
  "autoCreateUser": true,
  "isEnabled": true
}
```

### 7.3 Microsoft Azure AD

#### Azure Portal 앱 등록

1. [Azure Portal](https://portal.azure.com/) 접속
2. **Azure Active Directory** → **앱 등록** → **새 등록**:
   - 이름: `FileHatch`
   - 지원되는 계정 유형: 조직 디렉터리만 (또는 모든 조직)
   - 리디렉션 URI: 웹 → `http://localhost:3080/api/auth/sso/callback/{PROVIDER_ID}`
3. **인증서 및 비밀** → **새 클라이언트 암호** 생성
4. **API 권한** → 다음 권한 추가:
   - `openid`
   - `email`
   - `profile`

#### FileHatch 등록

```json
{
  "name": "Microsoft 로그인",
  "providerType": "azure",
  "clientId": "YOUR_AZURE_CLIENT_ID",
  "clientSecret": "YOUR_AZURE_CLIENT_SECRET",
  "scopes": "openid email profile",
  "autoCreateUser": true,
  "isEnabled": true
}
```

---

## 8. 고급 설정

### 8.1 SSO 전용 모드

로컬 로그인을 비활성화하고 SSO 로그인만 허용:

```bash
curl -X PUT http://localhost:3080/api/admin/sso/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sso_enabled": "true",
    "sso_only_mode": "true"
  }'
```

> ⚠️ **주의**: SSO 전용 모드 활성화 전 반드시 SSO 로그인이 정상 작동하는지 확인하세요. 그렇지 않으면 시스템에 접근할 수 없게 됩니다.

### 8.2 이메일 도메인 제한

특정 도메인의 이메일만 허용:

**프로바이더별 설정:**
```json
{
  "allowedDomains": "company.com,partner.com"
}
```

**전역 설정:**
```bash
curl -X PUT http://localhost:3080/api/admin/sso/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sso_allowed_domains": "company.com,partner.com"
  }'
```

### 8.3 자동 사용자 생성

첫 SSO 로그인 시 자동으로 FileHatch 계정 생성:

```json
{
  "autoCreateUser": true,
  "defaultAdmin": false  // true로 설정하면 관리자 권한 부여 (주의!)
}
```

### 8.4 커스텀 버튼 스타일

```json
{
  "iconUrl": "https://your-domain.com/my-icon.svg",
  "buttonColor": "#4285F4"
}
```

---

## 9. 문제 해결

### 9.1 "Invalid token issuer" 오류

**증상:** SSO 로그인 후 "Invalid token issuer" 또는 "Token validation failed" 오류

**원인:** 브라우저가 접근하는 Keycloak URL과 API 서버가 검증하는 Issuer URL이 불일치

**해결 방법:**

1. `.env`에서 `KEYCLOAK_HOSTNAME` 확인:
   ```bash
   # 잘못된 예
   KEYCLOAK_HOSTNAME=localhost

   # 올바른 예 (실제 IP 또는 도메인)
   KEYCLOAK_HOSTNAME=192.168.1.100
   ```

2. FileHatch SSO 프로바이더의 Issuer URL 확인:
   ```
   # 브라우저에서 접근하는 URL과 동일해야 함
   http://192.168.1.100:8180/auth/realms/filehatch
   ```

3. Keycloak 재시작 후 확인:
   ```bash
   docker compose restart keycloak
   ```

### 9.2 콜백 URL 불일치 오류

**증상:** "Invalid redirect_uri" 또는 "Redirect URI mismatch" 오류

**해결 방법:**

1. Keycloak Client 설정에서 **Valid redirect URIs** 확인:
   ```
   http://localhost:3080/api/auth/sso/callback/*
   https://files.company.com/api/auth/sso/callback/*
   ```

2. 와일드카드(`*`) 사용하여 모든 프로바이더 ID 허용

### 9.3 CORS 관련 오류

**증상:** 브라우저 콘솔에 CORS 오류 표시

**해결 방법:**

1. Keycloak Client 설정에서 **Web origins** 확인:
   - `+` 입력 시 모든 redirect URI origin 허용
   - 또는 구체적인 origin: `http://localhost:3080`

2. FileHatch `.env`에서 CORS 설정 확인:
   ```bash
   CORS_ALLOWED_ORIGINS=http://localhost:3080,https://files.company.com
   ```

### 9.4 사용자 생성 실패

**증상:** SSO 로그인은 성공하지만 FileHatch 사용자 생성 실패

**확인 사항:**

1. 이메일 도메인 제한 설정 확인
2. 자동 사용자 생성 활성화 여부 확인
3. API 서버 로그 확인:
   ```bash
   docker compose logs -f api | grep -i sso
   ```

### 9.5 로그 확인 방법

```bash
# FileHatch API 로그
docker compose logs -f api

# Keycloak 로그
docker compose logs -f keycloak

# SSO 관련 로그만 필터링
docker compose logs -f api 2>&1 | grep -iE "(sso|oauth|oidc)"
```

---

## 10. 프로덕션 권장 사항

### 10.1 HTTPS 필수 설정

프로덕션 환경에서는 **반드시 HTTPS**를 사용해야 합니다:

```bash
# .env 설정
KEYCLOAK_HOSTNAME=sso.company.com

# Keycloak 앞에 리버스 프록시 (Nginx/Traefik) 배치
# SSL 인증서 설정
```

### 10.2 비밀번호 변경

기본 비밀번호를 반드시 변경하세요:

```bash
# .env 파일
KEYCLOAK_ADMIN_PASSWORD=매우_강력한_비밀번호_여기에

# Client Secret도 주기적으로 교체 권장
```

### 10.3 리버스 프록시 설정 (Nginx 예시)

```nginx
server {
    listen 443 ssl;
    server_name sso.company.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /auth {
        proxy_pass http://localhost:8180;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;

        # WebSocket 지원
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 10.4 백업 전략

Keycloak 데이터 정기 백업:

```bash
# Docker 볼륨 백업
docker run --rm -v filehatch_keycloak_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/keycloak-backup-$(date +%Y%m%d).tar.gz /data

# 또는 realm 내보내기 (관리 콘솔에서)
# Realm 설정 → Action → Export
```

### 10.5 보안 체크리스트

```
[ ] HTTPS 적용 완료
[ ] 기본 관리자 비밀번호 변경
[ ] Client Secret을 안전하게 저장
[ ] 허용 도메인 제한 설정
[ ] 자동 관리자 권한 부여 비활성화
[ ] 정기적인 백업 설정
[ ] 로그 모니터링 설정
```

---

## 관련 문서

- [메인 README](../README.md)
- [OnlyOffice 설정 가이드](./ONLYOFFICE_SETUP.md)
- [Keycloak 공식 문서](https://www.keycloak.org/documentation)
- [OAuth 2.0 사양](https://oauth.net/2/)
- [OpenID Connect 사양](https://openid.net/connect/)
