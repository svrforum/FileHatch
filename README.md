<p align="center">
  <img src="./File_Hatch_banner.png" alt="FileHatch Banner" width="600">
</p>

# FileHatch

[English](README.en.md) | **한국어**

**자체 호스팅 클라우드 파일 공유 시스템**

> **Beta**: 이 프로젝트는 현재 베타 단계입니다. 프로덕션 사용 전 충분한 테스트를 권장합니다.

[![Go Version](https://img.shields.io/badge/Go-1.23-00ADD8?logo=go)](https://golang.org/)
[![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)](https://www.docker.com/)
[![Status](https://img.shields.io/badge/Status-Beta-yellow.svg)]()

## 개요

FileHatch는 기업 환경에서 사용할 수 있는 안전하고 기능이 풍부한 자체 호스팅 클라우드 스토리지 솔루션입니다. Dropbox, OneDrive, ShareFile과 같은 상용 솔루션을 대체할 수 있으며, 데이터에 대한 완전한 제어권을 유지합니다.

### 주요 특징

- **다중 프로토콜 접근**: 웹 UI, SMB/CIFS, WebDAV 지원
- **강력한 보안**: JWT 인증, 2FA(TOTP), SSO/OIDC 통합, 브루트포스 방지
- **문서 편집**: OnlyOffice 통합으로 브라우저 내 Office 문서 편집
- **팀 협업**: 공유 드라이브, 파일 공유, 실시간 알림
- **PWA 지원**: 모바일/데스크톱 앱처럼 설치 가능
- **완전 컨테이너화**: Docker Compose로 간편한 배포

---

## 기술 스택

### Backend (Go API Server)
| 기술 | 버전 | 용도 |
|------|------|------|
| Go | 1.23 | 메인 언어 |
| Echo | v4.12 | 웹 프레임워크 |
| PostgreSQL | 17 | 주 데이터베이스 |
| Valkey | 8.1 | 캐시/세션 (Redis 호환) |
| TUS | v2.4 | 재개 가능한 파일 업로드 |
| JWT | v5 | 인증 토큰 |
| Gorilla WebSocket | v1.5 | 실시간 알림 |
| pquerna/otp | v1.4 | TOTP 2단계 인증 |
| zerolog | - | 구조화된 로깅 |

### Frontend (React SPA)
| 기술 | 버전 | 용도 |
|------|------|------|
| React | 18.3 | UI 프레임워크 |
| TypeScript | 5.6 | 타입 안전성 |
| Vite | 5.4 | 빌드 도구 |
| Zustand | 5.0 | 상태 관리 |
| TanStack Query | 5.62 | 서버 상태 관리 |
| TanStack Virtual | 3.11 | 가상 스크롤링 |
| tus-js-client | 4.2 | 재개 가능한 업로드 |
| Monaco Editor | 0.52 | 코드/텍스트 편집기 |
| react-pdf | 10.2 | PDF 뷰어 |

### 인프라
| 기술 | 용도 |
|------|------|
| Docker & Docker Compose | 컨테이너 오케스트레이션 |
| Express.js 4.21 | UI 리버스 프록시 |
| Samba 4.20 | SMB/CIFS 파일 공유 |
| OnlyOffice (선택) | Office 문서 편집 |
| Keycloak 26.4 (선택) | SSO/OIDC 인증 |

---

## 기능 상세

### 인증 및 보안
- **JWT 기반 인증**: 안전한 토큰 기반 인증
- **2단계 인증 (TOTP)**: Google Authenticator, Authy 등 호환
  - QR 코드 스캔으로 간편 설정
  - 8개의 백업 코드 제공
- **SSO 통합**: OIDC 프로토콜 지원
  - Keycloak, Google, Azure AD, GitHub 등
  - 자동 사용자 생성 옵션
  - 도메인 제한 설정
- **역할 기반 접근 제어**: 관리자/일반 사용자 분리
- **ACL 기반 권한 관리**: 파일/폴더별 세분화된 권한
- **브루트포스 방지**: 로그인 시도 횟수 제한 및 자동 차단
- **감사 로그**: 모든 작업에 대한 불변 감사 추적

### 파일 관리
- **업로드**
  - TUS 프로토콜 기반 재개 가능한 업로드
  - 드래그 앤 드롭 (파일 및 폴더)
  - 폴더 구조 유지 업로드
  - 업로드 진행률 및 속도 표시
  - 업로드 일시정지/재개/취소
- **다운로드**
  - 개별 파일 다운로드
  - ZIP 폴더 다운로드 (캐싱 지원)
  - 다중 파일 ZIP 압축 다운로드
  - 다운로드 진행률 표시
- **파일 작업**
  - 이름 변경, 복사, 이동
  - 휴지통 (복원, 영구 삭제)
  - 다중 선택 (Ctrl+클릭, Shift+클릭)
  - 일괄 작업 (삭제, 다운로드)
  - 파일 잠금 (동시 편집 방지)
  - 즐겨찾기/별표 기능
- **파일 생성**
  - 텍스트 파일 (txt, md, html, json)
  - Office 문서 (docx, xlsx, pptx)
- **검색**
  - 파일명, 태그, 설명 검색
  - 페이지네이션 지원
  - 실시간 로컬 필터링

### 파일 미리보기 및 편집
- **미리보기 지원**
  - 이미지 (JPEG, PNG, GIF, WebP, SVG)
  - 비디오 (MP4, WebM, MOV)
  - 오디오 (MP3, WAV, OGG)
  - PDF 문서
  - 텍스트/코드 파일
  - ZIP 파일 (내용 탐색 및 압축 해제)
- **썸네일 시스템**
  - 자동 썸네일 생성
  - 반응형 크기 (64px ~ 512px)
  - 디스크 + Valkey 이중 캐싱
- **문서 편집**
  - Monaco Editor 기반 텍스트/코드 편집
  - 구문 강조 지원
  - OnlyOffice 통합 (선택)
    - Word, Excel, PowerPoint 편집
    - 실시간 자동 저장

### 파일 공유

#### 다운로드 링크
외부 사용자와 파일/폴더를 안전하게 공유
- 고유 공유 URL 생성
- 비밀번호 보호 (선택)
- 만료 시간 설정
- 최대 접근 횟수 제한
- 로그인 필수 옵션
- 접근 통계 추적

#### 업로드 링크
외부 사용자로부터 파일 수집
- 폴더 기반 업로드 링크
- 비밀번호 보호
- 파일 크기 제한
- 허용 확장자 설정
- 총 업로드 용량 제한
- 업로드 횟수 제한

#### 사용자 간 공유
시스템 내 사용자와 파일 공유
- 읽기 전용 / 읽기+쓰기 권한
- 공유 메시지 첨부
- 공유받은 파일 목록 (/shared-with-me)
- 공유 알림 (실시간)

### 공유 드라이브 (팀 폴더)
팀 협업을 위한 공유 작업 공간
- 관리자가 드라이브 생성/관리
- 멤버 추가/제거
- 권한 관리 (읽기 전용, 읽기/쓰기)
- 스토리지 쿼터 설정
- 사용자 생성 시 자동 권한 할당
- 드라이브 검색 (5개 이상 시)

### 스토리지 관리
- **사용자별 홈 폴더** (`/home/{username}`)
- **공유 드라이브** (`/shared-drives/{drive-name}`)
- **공유받은 파일** (`/shared-with-me`)
- **스토리지 쿼터**: 사용자별 용량 제한
- **실시간 사용량 표시**
- **SMB/CIFS 접근**: Windows 탐색기, macOS Finder
- **WebDAV 접근**: 데스크톱 앱 연동

### WebDAV 상세 설정

FileHatch는 WebDAV 프로토콜을 완벽하게 지원하여 다양한 클라이언트에서 파일에 접근할 수 있습니다.

| 항목 | 값 |
|------|-----|
| URL | `http://서버:3080/api/webdav/` |
| 인증 | 사용자명/비밀번호 (Basic Auth) |

**클라이언트 설정**
- **Windows**: 네트워크 드라이브 연결 → `http://서버:3080/api/webdav/`
- **macOS**: Finder → 이동 → 서버에 연결 → `http://서버:3080/api/webdav/`
- **Linux**: davfs2, Nautilus, Dolphin 등에서 WebDAV URL 입력
- **데스크톱 앱**: Cyberduck, Mountain Duck, WinSCP 등

> ⚠️ **주의**: URL 끝에 `/`를 포함해야 합니다.

### 사용자 경험
- **실시간 알림**: WebSocket 기반 파일 변경 알림
- **다크 모드**: 시스템 설정 연동
- **반응형 디자인**: 모바일/태블릿 지원
- **가상 스크롤**: 대용량 폴더 성능 최적화 (100+ 파일)
- **컨텍스트 메뉴**: 우클릭 빠른 작업
- **키보드 단축키**: 파일 탐색 및 작업
- **파일 상세 패널**: 메타데이터, 통계 표시
- **토스트 알림**: 작업 결과 피드백

### 관리자 기능
- **사용자 관리**: CRUD, 활성화/비활성화
- **공유 드라이브 관리**: 생성, 멤버 관리
- **시스템 설정**: 휴지통 보관 기간, 기본 쿼터 등
- **SSO 프로바이더 관리**: OIDC 설정
- **감사 로그**: 상세 필터링, 내보내기
- **SMB 관리**: 사용자 동기화, 비밀번호 관리
- **시스템 정보**: 서버 상태, 리소스 사용량

---

## 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                           클라이언트                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────────┐   │
│  │  Browser │  │   SMB    │  │  WebDAV  │  │  Mobile/Desktop    │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────────┬──────────┘   │
└───────┼─────────────┼─────────────┼──────────────────┼──────────────┘
        │             │             │                  │
        ▼             ▼             ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Docker Network                                 │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  :3080 UI Server (Express)  ◄────►  :8080 API Server (Go)    │  │
│  │  ├─ Static files                    ├─ Auth (JWT/2FA/SSO)    │  │
│  │  ├─ API Proxy                       ├─ File Operations       │  │
│  │  └─ WebSocket Proxy                 ├─ Share Management      │  │
│  │                                     ├─ TUS Upload            │  │
│  │  :445 Samba (SMB/CIFS)              ├─ WebSocket             │  │
│  │  └─ Network file sharing            ├─ WebDAV                │  │
│  │                                     └─ OnlyOffice            │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Shared Volume (/data)                      │  │
│  │  ├─ /users/      - 사용자 홈 디렉토리                           │  │
│  │  ├─ /shared/     - 공유 드라이브                                │  │
│  │  └─ /.cache/     - 썸네일/미리보기 캐시                          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────┐  ┌─────────────────────────────────────┐   │
│  │  PostgreSQL (DB)    │  │  Valkey (Cache/Session)             │   │
│  │  └─ 13 tables       │  │  └─ Sessions, thumbnails, stats     │   │
│  └─────────────────────┘  └─────────────────────────────────────┘   │
│                                                                      │
│  Optional Services:                                                  │
│  ┌─────────────────────┐  ┌─────────────────────────────────────┐   │
│  │  OnlyOffice (:8088) │  │  Keycloak (:8180)                   │   │
│  │  └─ Document editing│  │  └─ SSO/OIDC                        │   │
│  └─────────────────────┘  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 빠른 시작

### 요구 사항
- Docker Engine 24.0+
- Docker Compose v2.20+
- 최소 4GB RAM
- 사용 가능한 포트: 3080 (웹), 445/139 (SMB)

### 원라인 설치 (가장 쉬움)

아래 명령어를 복사하여 서버에서 실행하세요:

```bash
mkdir -p filehatch && cd filehatch && \
curl -fsSL https://raw.githubusercontent.com/svrforum/FileHatch/main/.env.example -o .env && \
curl -fsSL https://raw.githubusercontent.com/svrforum/FileHatch/main/docker-compose.yml -o docker-compose.yml && \
mkdir -p config && touch config/smb.conf && \
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env && \
sed -i "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env && \
sed -i "s/DB_PASS=.*/DB_PASS=$(openssl rand -base64 16 | tr -d '=+/')/" .env && \
docker compose up -d && \
echo "✅ FileHatch 설치 완료! http://localhost:3080 에서 접속하세요."
```

### 단계별 설치

```bash
# 1. 설치 디렉토리 생성
mkdir -p filehatch && cd filehatch

# 2. 설정 파일 다운로드
curl -fsSL https://raw.githubusercontent.com/svrforum/FileHatch/main/.env.example -o .env
curl -fsSL https://raw.githubusercontent.com/svrforum/FileHatch/main/docker-compose.yml -o docker-compose.yml

# 3. config 디렉토리 및 SMB 설정 파일 생성
mkdir -p config && touch config/smb.conf

# 4. 보안 키 자동 생성 (중요!)
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env
sed -i "s/DB_PASS=.*/DB_PASS=$(openssl rand -base64 16 | tr -d '=+/')/" .env

# 5. 서비스 시작
docker compose up -d

# 6. 상태 확인
docker compose ps

# 7. 로그 확인
docker compose logs -f
```

### wget 사용 시

```bash
mkdir -p filehatch && cd filehatch && \
wget -q https://raw.githubusercontent.com/svrforum/FileHatch/main/.env.example -O .env && \
wget -q https://raw.githubusercontent.com/svrforum/FileHatch/main/docker-compose.yml && \
mkdir -p config && touch config/smb.conf && \
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env && \
sed -i "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env && \
sed -i "s/DB_PASS=.*/DB_PASS=$(openssl rand -base64 16 | tr -d '=+/')/" .env && \
docker compose up -d
```

### macOS에서 설치

```bash
mkdir -p filehatch && cd filehatch && \
curl -fsSL https://raw.githubusercontent.com/svrforum/FileHatch/main/.env.example -o .env && \
curl -fsSL https://raw.githubusercontent.com/svrforum/FileHatch/main/docker-compose.yml -o docker-compose.yml && \
mkdir -p config && touch config/smb.conf && \
sed -i '' "s/JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env && \
sed -i '' "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env && \
sed -i '' "s/DB_PASS=.*/DB_PASS=$(openssl rand -base64 16 | tr -d '=+/')/" .env && \
docker compose up -d
```

### 소스에서 설치 (개발용)

```bash
# 저장소 클론
git clone https://github.com/svrforum/FileHatch.git
cd FileHatch

# 환경 변수 설정
cp .env.example .env

# 보안 키 생성
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env
sed -i "s/DB_PASS=.*/DB_PASS=$(openssl rand -base64 16 | tr -d '=+/')/" .env

# 모든 서비스 빌드 및 시작
docker compose up -d --build
```

> 💡 **참고**: 데이터베이스 마이그레이션은 API 서버 시작 시 자동으로 실행됩니다.

### 리버스 프록시 사용 시 (NPM, Nginx 등)

외부 도메인으로 접속하는 경우 `.env` 파일에 다음을 설정하세요:

```bash
# 외부 접속 URL (필수 - Mixed Content 에러 방지)
EXTERNAL_URL=https://your-domain.com

# CORS 허용 오리진
CORS_ALLOWED_ORIGINS=https://your-domain.com

# WebSocket 허용 오리진
ALLOWED_ORIGINS=https://your-domain.com
```

> 📖 **상세 가이드**: [리버스 프록시 설정 가이드](./docs/REVERSE_PROXY_SETUP.md)

### 접속 정보

| 프로토콜 | URL | 설명 |
|----------|-----|------|
| 웹 UI | http://localhost:3080 | 메인 웹 인터페이스 |
| SMB (Windows) | `\\localhost\home` | Windows 탐색기에서 접근 |
| SMB (Mac/Linux) | `smb://localhost/home` | Finder/파일관리자에서 접근 |
| WebDAV | http://localhost:3080/api/webdav/ | WebDAV 클라이언트 연동 |

### 기본 계정

```
사용자명: admin
비밀번호: admin1234
```

> 🔐 **초기 설정**: 첫 로그인 시 관리자 계정의 사용자명과 비밀번호를 변경하는 **초기 설정 화면**이 표시됩니다. 이 과정을 완료해야 시스템을 사용할 수 있습니다.

---

## 실행 옵션

### Docker Compose 프로필

FileHatch는 Docker Compose 프로필을 사용하여 선택적 기능을 활성화합니다.

| 실행 명령 | 포함 서비스 | 용도 |
|----------|------------|------|
| `docker compose up -d` | API, UI, DB, Valkey, Samba | 기본 설치 |
| `docker compose --profile office up -d` | 기본 + OnlyOffice | 문서 편집 기능 |
| `docker compose --profile sso up -d` | 기본 + Keycloak | SSO 인증 |
| `docker compose --profile office --profile sso up -d` | 모든 서비스 | 전체 기능 |

### 서비스별 포트

| 서비스 | 포트 | 프로토콜 | 설명 |
|--------|------|----------|------|
| UI | 3080 | HTTP | 웹 인터페이스 |
| SMB | 445, 139 | SMB/CIFS | Windows 파일 공유 |
| WebDAV | 3080/webdav | HTTP | WebDAV 클라이언트 |
| OnlyOffice | 8088 | HTTP | 문서 편집 서버 (--profile office) |
| Keycloak | 8180 | HTTP | SSO 인증 서버 (--profile sso) |
| PostgreSQL | 5432 | TCP | 데이터베이스 (내부) |
| Valkey | 6379 | TCP | 캐시 서버 (내부) |

---

## 고급 설정

### OnlyOffice 문서 편집기 (선택)

브라우저에서 Office 문서 (Word, Excel, PowerPoint)를 직접 편집할 수 있습니다.

> 📖 **상세 가이드**: [OnlyOffice 설정 가이드](./docs/ONLYOFFICE_SETUP.md)

```bash
# OnlyOffice 포함하여 시작
docker compose --profile office up -d

# OnlyOffice 상태 확인
docker compose logs onlyoffice
```

OnlyOffice 설정:
- 내부 URL: `http://onlyoffice` (Docker 네트워크)
- 외부 URL: `http://서버IP:8088`
- 외부 접근이 필요한 경우 `.env`에 `ONLYOFFICE_PUBLIC_URL` 설정

### SSO (Keycloak) 통합 (선택)

OIDC 기반 Single Sign-On을 설정합니다.

> 📖 **상세 가이드**: [SSO 설정 가이드](./docs/SSO_SETUP.md)

```bash
# 1. SSO 프로필로 시작
docker compose --profile sso up -d

# 2. Keycloak이 준비될 때까지 대기 (약 2분)
docker compose logs -f keycloak
# "Running the server" 메시지가 나타나면 준비 완료

# 3. Keycloak 초기 설정 (최초 1회)
./scripts/setup-keycloak.sh
```

Keycloak 관리 콘솔: http://localhost:8180/auth
- 사용자명: `admin`
- 비밀번호: `admin123` (`.env`에서 변경 가능)

> ⚠️ **주의**: 프로덕션에서는 `KEYCLOAK_ADMIN_PASSWORD`를 반드시 변경하세요.

### 모든 기능 활성화

```bash
# OnlyOffice + Keycloak 모두 사용
docker compose --profile office --profile sso up -d

# 상태 확인
docker compose ps
```

### 유용한 명령어

```bash
# 서비스 상태 확인
docker compose ps

# 로그 확인 (실시간)
docker compose logs -f

# 특정 서비스 로그
docker compose logs -f api

# 서비스 재시작
docker compose restart api

# 전체 중지
docker compose down

# 볼륨 포함 전체 삭제 (데이터 삭제됨!)
docker compose down -v

# 이미지 재빌드
docker compose build --no-cache

# API 테스트 실행
./scripts/test-api.sh

# 마이그레이션 상태 확인
./scripts/migrate.sh status

# 백업
./scripts/backup.sh
```

### 환경 변수

#### API 서버
| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DB_HOST` | db | PostgreSQL 호스트 |
| `DB_PORT` | 5432 | PostgreSQL 포트 |
| `DB_USER` | fh_user | 데이터베이스 사용자 |
| `DB_PASS` | fh_password | 데이터베이스 비밀번호 |
| `DB_NAME` | fh_main | 데이터베이스 이름 |
| `VALKEY_HOST` | valkey | Valkey 호스트 |
| `VALKEY_PORT` | 6379 | Valkey 포트 |
| `JWT_SECRET` | (자동생성) | JWT 서명 키 (**프로덕션에서 변경 필수**) |
| `ENCRYPTION_KEY` | (자동생성) | 민감 데이터 암호화 키 |
| `EXTERNAL_URL` | - | 외부 접속 URL (리버스 프록시 사용 시 필수) |
| `CORS_ALLOWED_ORIGINS` | * | 허용된 CORS 오리진 |
| `ALLOWED_ORIGINS` | - | WebSocket 허용 오리진 (리버스 프록시 사용 시 필수) |
| `LOGIN_ATTEMPT_LIMIT` | 5 | 로그인 시도 제한 횟수 |
| `LOGIN_LOCKOUT_DURATION` | 15m | 로그인 차단 시간 |
| `TRASH_RETENTION_DAYS` | 30 | 휴지통 보관 기간 (일) |
| `FILE_LOCK_TIMEOUT` | 30m | 파일 잠금 자동 해제 시간 |

#### UI 서버
| 변수 | 기본값 | 설명 |
|------|--------|------|
| `API_URL` | http://api:8080 | API 서버 내부 URL |
| `ONLYOFFICE_URL` | http://onlyoffice | OnlyOffice 내부 URL |
| `ONLYOFFICE_PUBLIC_URL` | - | OnlyOffice 외부 접근 URL |

---

## 디렉토리 구조

```
FileHatch/
├── api/                          # Go 백엔드
│   ├── handlers/                 # HTTP 핸들러 (~61개 파일)
│   │   ├── auth.go               # 인증 (JWT, Login)
│   │   ├── auth_user.go          # 사용자 CRUD
│   │   ├── handler.go            # 파일/폴더 CRUD
│   │   ├── operations.go         # Rename/Move/Copy
│   │   ├── search.go             # 파일 검색
│   │   ├── share.go              # 다운로드 공유
│   │   ├── upload_share.go       # 업로드 공유
│   │   ├── file_share_handler.go # 사용자 간 공유
│   │   ├── shared_folder_handler.go # 공유 드라이브
│   │   ├── onlyoffice.go         # OnlyOffice 통합
│   │   ├── sso.go                # SSO 핵심
│   │   ├── sso_callback.go       # OAuth 콜백
│   │   ├── trash.go              # 휴지통
│   │   ├── audit.go              # 감사 로그
│   │   ├── websocket.go          # 실시간 알림
│   │   ├── webdav.go             # WebDAV
│   │   ├── thumbnail.go          # 썸네일 생성
│   │   └── ...
│   ├── database/                 # DB 연결
│   ├── main.go                   # 엔트리포인트 (~500줄)
│   └── Dockerfile
├── ui/                           # React 프론트엔드
│   ├── src/
│   │   ├── api/                  # API 클라이언트 (11개)
│   │   │   ├── client.ts         # 공통 API 클라이언트
│   │   │   ├── auth.ts           # 인증 API
│   │   │   ├── files.ts          # 파일 API
│   │   │   └── ...
│   │   ├── components/           # React 컴포넌트 (65+)
│   │   │   ├── FileList.tsx      # 메인 파일 브라우저
│   │   │   ├── filelist/         # FileList 하위 컴포넌트
│   │   │   ├── Admin*.tsx        # 관리자 페이지
│   │   │   └── ...
│   │   ├── hooks/                # 커스텀 훅 (15개)
│   │   │   ├── useToast.ts
│   │   │   ├── useLocalSearch.ts
│   │   │   ├── useFileMetadata.ts
│   │   │   └── ...
│   │   ├── stores/               # Zustand 스토어
│   │   └── styles/               # 글로벌 스타일
│   ├── server.cjs                # Express 서버
│   └── Dockerfile
├── samba/                        # Samba 설정
│   ├── smb.conf.template
│   ├── entrypoint.sh
│   └── Dockerfile
├── db/                           # 데이터베이스
│   └── init.sql                  # 스키마 (13개 테이블)
├── scripts/                      # 유틸리티 스크립트
│   └── setup-keycloak.sh
├── data/                         # 파일 저장소 (볼륨)
├── docker-compose.yml            # 기본 구성
└── docker-compose-sso.yaml       # SSO 구성
```

---

## API 레퍼런스

### 인증

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/auth/login` | 로그인 |
| POST | `/api/auth/2fa/verify` | 2FA 코드 검증 |
| GET | `/api/auth/profile` | 프로필 조회 |
| PUT | `/api/auth/profile` | 프로필 수정 |
| PUT | `/api/auth/password` | 비밀번호 변경 |
| GET | `/api/auth/2fa/status` | 2FA 상태 확인 |
| POST | `/api/auth/2fa/setup` | 2FA 설정 시작 |
| POST | `/api/auth/2fa/enable` | 2FA 활성화 |
| DELETE | `/api/auth/2fa/disable` | 2FA 비활성화 |
| GET | `/api/auth/sso/providers` | SSO 프로바이더 목록 |
| GET | `/api/auth/sso/auth/:id` | SSO 인증 URL |
| GET | `/api/auth/sso/callback/:id` | OAuth 콜백 |

### 파일 관리

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/files` | 파일 목록 (페이지네이션) |
| GET | `/api/files/search` | 파일 검색 |
| GET | `/api/files/recent` | 최근 파일 |
| GET | `/api/files/*` | 파일 다운로드 |
| DELETE | `/api/files/*` | 파일 삭제 |
| POST | `/api/files/rename` | 이름 변경 |
| POST | `/api/files/move` | 이동 |
| POST | `/api/files/copy` | 복사 |
| POST | `/api/files/create` | 새 파일 생성 |
| PUT | `/api/files/content/*` | 파일 내용 저장 |
| POST | `/api/folders` | 폴더 생성 |
| GET | `/api/folders/stats/*` | 폴더 통계 |
| GET | `/api/zip/*` | ZIP 다운로드 |

### 업로드 (TUS 프로토콜)

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/upload/` | 업로드 시작 |
| PATCH | `/api/upload/*` | 청크 업로드 |
| HEAD | `/api/upload/*` | 업로드 상태 |
| DELETE | `/api/upload/*` | 업로드 취소 |

### 파일 잠금

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/files/lock/*` | 파일 잠금 |
| DELETE | `/api/files/lock/*` | 잠금 해제 |
| GET | `/api/files/lock/*` | 잠금 상태 확인 |

### 별표/즐겨찾기

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/starred` | 별표 파일 목록 |
| POST | `/api/starred/*` | 별표 추가 |
| DELETE | `/api/starred/*` | 별표 제거 |

### 공유 링크

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/shares` | 공유 생성 |
| GET | `/api/shares` | 내 공유 목록 |
| DELETE | `/api/shares/:id` | 공유 삭제 |
| GET | `/api/s/:token` | 공유 정보 (공개) |
| GET | `/api/s/:token/download` | 공유 다운로드 |
| GET | `/api/u/:token` | 업로드 공유 정보 |
| POST | `/api/u/:token/upload/` | 업로드 공유로 파일 업로드 |

### 사용자 간 공유

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/file-shares` | 파일 공유 |
| GET | `/api/file-shares/shared-by-me` | 내가 공유한 파일 |
| GET | `/api/file-shares/shared-with-me` | 나에게 공유된 파일 |
| DELETE | `/api/file-shares/:id` | 공유 취소 |

### 공유 드라이브

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/shared-folders` | 내 공유 드라이브 목록 |
| GET | `/api/admin/shared-folders` | 전체 공유 드라이브 (관리자) |
| POST | `/api/admin/shared-folders` | 생성 (관리자) |
| PUT | `/api/admin/shared-folders/:id` | 수정 (관리자) |
| DELETE | `/api/admin/shared-folders/:id` | 삭제 (관리자) |
| POST | `/api/admin/shared-folders/:id/members` | 멤버 추가 |
| DELETE | `/api/admin/shared-folders/:id/members/:userId` | 멤버 제거 |

### 관리자

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/admin/users` | 사용자 목록 |
| POST | `/api/admin/users` | 사용자 생성 |
| PUT | `/api/admin/users/:id` | 사용자 수정 |
| DELETE | `/api/admin/users/:id` | 사용자 삭제 |
| GET | `/api/admin/settings` | 시스템 설정 조회 |
| PUT | `/api/admin/settings` | 시스템 설정 수정 |
| GET | `/api/admin/system-info` | 시스템 정보 |
| GET | `/api/audit/logs` | 감사 로그 |

### 알림

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/notifications` | 알림 목록 |
| PUT | `/api/notifications/:id/read` | 알림 읽음 처리 |
| PUT | `/api/notifications/read-all` | 모든 알림 읽음 |
| DELETE | `/api/notifications/:id` | 알림 삭제 |

### 기타

| Method | Endpoint | 설명 |
|--------|----------|------|
| WS | `/api/ws` | 실시간 알림 WebSocket |
| ANY | `/api/webdav/*` | WebDAV 접근 |
| GET | `/api/storage/usage` | 스토리지 사용량 |
| GET | `/api/thumbnail/*` | 썸네일 조회 |
| GET | `/api/metadata/*` | 파일 메타데이터 |
| PUT | `/api/metadata/*` | 메타데이터 수정 |
| GET | `/api/trash` | 휴지통 목록 |
| POST | `/api/trash/restore/:id` | 휴지통 복원 |
| DELETE | `/api/trash/:id` | 영구 삭제 |

---

## 데이터베이스 스키마

| 테이블 | 설명 | 주요 컬럼 |
|--------|------|----------|
| `users` | 사용자 계정 | id, username, email, password_hash, totp_secret |
| `acl` | 접근 제어 목록 | path, entity_type, entity_id, permission_level |
| `audit_logs` | 감사 로그 (불변) | ts, actor_id, event_type, target_resource, details |
| `shares` | 공유 링크 | token, path, share_type, expires_at, password_hash |
| `shared_folders` | 공유 드라이브 | name, description, storage_quota, created_by |
| `shared_folder_members` | 드라이브 멤버십 | shared_folder_id, user_id, permission_level |
| `file_shares` | 사용자 간 공유 | item_path, owner_id, shared_with_id, permission_level |
| `file_metadata` | 파일 메타데이터 | user_id, file_path, description, tags |
| `notifications` | 알림 | user_id, type, title, message, is_read |
| `system_settings` | 시스템 설정 | key, value, description |
| `sso_providers` | SSO 프로바이더 | name, provider_type, client_id, issuer_url |
| `starred_files` | 별표/즐겨찾기 | user_id, file_path, created_at |
| `file_locks` | 파일 잠금 | file_path, user_id, locked_at, expires_at |

---

## 보안 기능

### 구현된 보안 기능
- JWT 토큰 기반 인증
- TOTP 기반 2FA (백업 코드 포함)
- 비밀번호 해싱 (bcrypt)
- 민감 데이터 암호화 (AES-256-GCM)
- SQL 인젝션 방지 (파라미터화된 쿼리)
- CORS 보호
- 보안 헤더 미들웨어 (HSTS, CSP, X-Frame-Options, X-Content-Type-Options 등)
- XSS 방지
- IP 기반 속도 제한
- 브루트포스 방지 (로그인 시도 제한)
- 감사 로깅 (불변)
- ACL 기반 접근 제어

### ⚠️ 배포 전 필수 변경 사항

프로덕션 배포 전 반드시 아래 항목을 변경하세요:

#### 1. 환경 변수 (.env)

| 변수 | 기본값 | 설명 | 생성 방법 |
|------|--------|------|----------|
| `JWT_SECRET` | 개발용 기본값 | JWT 서명 키 (64자 이상 권장) | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | 개발용 기본값 | AES-256 암호화 키 | `openssl rand -hex 32` |
| `DB_PASS` | `fh_password` | PostgreSQL 비밀번호 | `openssl rand -base64 24` |
| `KEYCLOAK_ADMIN_PASSWORD` | `admin123` | Keycloak 관리자 비밀번호 | 강력한 비밀번호 설정 |

> 💡 **팁**: `./scripts/setup.sh` 실행 시 JWT_SECRET, ENCRYPTION_KEY, DB_PASS가 자동으로 안전한 값으로 생성됩니다.

#### 2. 기본 관리자 계정

| 항목 | 기본값 | 조치 |
|------|--------|------|
| 사용자명 | `admin` | 첫 로그인 후 새 관리자 계정 생성 권장 |
| 비밀번호 | `admin1234` | **첫 로그인 후 즉시 변경 필수** |
| 이메일 | `admin@localhost` | 실제 이메일로 변경 |

#### 3. 보안 체크리스트

```bash
# 배포 전 확인 사항
[ ] .env 파일의 모든 시크릿 값 변경 완료
[ ] admin 비밀번호 변경 완료 (첫 로그인 후)
[ ] CORS_ALLOWED_ORIGINS에 실제 도메인만 설정
[ ] HTTPS 설정 완료 (리버스 프록시)
[ ] 방화벽 설정 (필요한 포트만 개방)
[ ] 백업 스크립트 설정
```

### 권장 프로덕션 설정

```bash
# .env 파일 예시 (프로덕션)
JWT_SECRET=여기에_openssl_rand_hex_32_결과값
ENCRYPTION_KEY=여기에_openssl_rand_hex_32_결과값
DB_PASS=강력한_데이터베이스_비밀번호
CORS_ALLOWED_ORIGINS=https://your-domain.com
```

```yaml
# docker-compose.override.yml (선택)
services:
  api:
    environment:
      - LOG_LEVEL=warn
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
```

---

## 문제 해결

### 일반적인 문제

**Q: Docker 컨테이너가 시작되지 않습니다.**
```bash
# 로그 확인
docker compose logs api db valkey

# 컨테이너 재시작
docker compose down && docker compose up -d
```

**Q: 데이터베이스 연결 오류**
```bash
# DB 컨테이너 상태 확인
docker compose exec db pg_isready -U fh_user -d fh_main
```

**Q: SMB 접근이 안됩니다.**
```bash
# Samba 로그 확인
docker compose logs samba

# 포트 확인 (445가 열려있어야 함)
netstat -an | grep 445
```

**Q: OnlyOffice 문서가 열리지 않습니다.**
- OnlyOffice 프로필로 시작했는지 확인: `docker compose --profile office up -d`
- OnlyOffice 컨테이너 상태 확인: `docker compose logs onlyoffice`

**Q: WebDAV 연결이 안됩니다.**
- URL 끝에 `/` 포함 필수: `http://서버:3080/api/webdav/`
- 인증 방식이 Basic Auth인지 확인
- 사용자명/비밀번호가 올바른지 확인
- Windows의 경우 WebClient 서비스가 실행 중인지 확인

**Q: 로그인이 차단되었습니다 (브루트포스 방지).**
- 15분 후 자동으로 해제됩니다
- 관리자에게 수동 해제를 요청할 수 있습니다
- `LOGIN_LOCKOUT_DURATION` 환경 변수로 차단 시간 조정 가능

**Q: 파일이 잠겨 있어 편집할 수 없습니다.**
- 잠금 소유자가 편집을 완료할 때까지 대기
- 30분 후 자동으로 해제됩니다 (`FILE_LOCK_TIMEOUT`)
- 관리자에게 강제 해제를 요청할 수 있습니다

---

## 개발 가이드

### 로컬 개발 환경

```bash
# Backend (Go)
cd api
go mod download
go run main.go

# Frontend (React)
cd ui
npm install
npm run dev
```

### 테스트 실행

```bash
# Go 테스트
cd api
go test ./handlers/...

# React 테스트
cd ui
npm run test:run
```

### 빌드

```bash
# 전체 빌드
docker compose build

# 개별 서비스 빌드
docker compose build api
docker compose build ui
```

---

## 로드맵

자세한 개발 계획은 [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md)를 참조하세요.

### 단기 계획
- [ ] API 문서화 (OpenAPI/Swagger)
- [ ] E2E 테스트 추가
- [ ] 성능 모니터링 (Prometheus/Grafana)
- [ ] 로그 집계 (ELK Stack)

### 중기 계획
- [ ] 파일 버전 관리 (히스토리)
- [ ] 고급 검색 (Elasticsearch)
- [ ] 모바일 최적화 개선
- [ ] 오프라인 동기화

### 장기 계획
- [ ] 모바일 앱 (iOS/Android)
- [ ] 파일 암호화 (at rest)
- [ ] 워터마크 기능
- [ ] 데스크톱 동기화 클라이언트

---

## 기여

이슈와 풀 리퀘스트를 환영합니다!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 라이선스

이 프로젝트는 아직 라이선스가 지정되지 않았습니다. 추후 업데이트 예정입니다.

---

## 감사의 말

이 프로젝트는 다음 오픈소스 프로젝트들을 사용합니다:

- [Echo](https://echo.labstack.com/) - Go 웹 프레임워크
- [React](https://reactjs.org/) - UI 라이브러리
- [TUS](https://tus.io/) - 재개 가능한 업로드 프로토콜
- [OnlyOffice](https://www.onlyoffice.com/) - 문서 편집기
- [Keycloak](https://www.keycloak.org/) - SSO 솔루션
