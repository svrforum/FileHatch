# SimpleCloudVault

엔터프라이즈급 클라우드 파일 공유 시스템

## 프로젝트 개요

SimpleCloudVault는 기업 환경에서 사용할 수 있는 안전하고 기능이 풍부한 파일 공유 시스템입니다. 웹 인터페이스, SMB/CIFS 프로토콜, WebDAV를 통한 다양한 접근 방식을 지원하며, SSO 통합과 2FA 인증으로 보안을 강화했습니다.

## 기술 스택

### Backend (API)
| 기술 | 버전 | 용도 |
|------|------|------|
| Go | 1.23 | 메인 언어 |
| Echo | v4.13 | 웹 프레임워크 |
| PostgreSQL | 17 | 주 데이터베이스 |
| Valkey | 8.1 | 캐시/세션 (Redis 호환) |
| TUS | v2.7 | 재개 가능한 파일 업로드 |
| JWT | v5 | 인증 토큰 |
| Gorilla WebSocket | v1.5 | 실시간 알림 |
| pquerna/otp | v1.4 | TOTP 2단계 인증 |
| golang.org/x/net/webdav | - | WebDAV 지원 |

### Frontend (UI)
| 기술 | 버전 | 용도 |
|------|------|------|
| React | 18.3 | UI 프레임워크 |
| TypeScript | 5.6 | 타입 안전성 |
| Vite | 5.4 | 빌드 도구 |
| Zustand | 5.0 | 상태 관리 |
| TanStack Query | 5.60 | 서버 상태 관리 |
| tus-js-client | 4.2 | 재개 가능한 업로드 |
| Monaco Editor | 0.52 | 코드/텍스트 편집기 |
| react-pdf | 9.1 | PDF 뷰어 |
| qrcode.react | 4.2 | QR 코드 생성 (2FA) |

### 인프라
| 기술 | 용도 |
|------|------|
| Docker & Docker Compose | 컨테이너화 |
| Express.js | UI 리버스 프록시 |
| Samba 4.20 | SMB/CIFS 파일 공유 |
| OnlyOffice | 문서 편집 (선택) |
| Keycloak 26.3 | SSO/OIDC (선택) |

## 주요 기능

### 인증 및 보안
- [x] JWT 기반 인증
- [x] 2단계 인증 (TOTP) - Google Authenticator, Authy 등 호환
- [x] SSO 통합 (OIDC/Keycloak)
- [x] 사용자 등록/관리 (관리자)
- [x] 프로필 관리 및 비밀번호 변경
- [x] 관리자/일반 사용자 역할 분리
- [x] ACL 기반 권한 제어

### 파일 관리
- [x] 파일 업로드 (TUS 재개 가능)
- [x] 파일 다운로드 (진행률 표시)
- [x] ZIP 폴더 다운로드
- [x] 파일 삭제 (휴지통으로 이동)
- [x] 휴지통 기능 (복원, 영구 삭제, 비우기)
- [x] 파일 이름 변경
- [x] 파일/폴더 복사 및 이동
- [x] 폴더 생성/삭제
- [x] 새 파일 생성 (텍스트, Markdown, HTML, JSON, Word, Excel, PowerPoint)
- [x] 파일 검색 (페이지네이션 지원)
- [x] 파일 메타데이터 (태그, 설명)
- [x] 파일 미리보기 (이미지, 텍스트, 비디오, 오디오, PDF)
- [x] 미리보기 캐싱 (성능 최적화)
- [x] 폴더 통계 (파일 수, 용량)

### 문서 편집
- [x] Monaco 기반 텍스트 편집기 (구문 강조)
- [x] OnlyOffice 통합 (선택적)
  - Word 문서 (doc, docx, odt, rtf)
  - Excel 스프레드시트 (xls, xlsx, ods, csv)
  - PowerPoint 프레젠테이션 (ppt, pptx, odp)
  - PDF 뷰어

### 파일 공유

#### 다운로드 링크 (외부 공유)
- [x] 파일/폴더 공유 링크 생성
- [x] 비밀번호 보호
- [x] 만료 시간 설정
- [x] 최대 접근 횟수 제한
- [x] 로그인 필요 여부 설정

#### 업로드 링크 (파일 수집)
- [x] 폴더에 대한 업로드 링크 생성
- [x] 비밀번호 보호
- [x] 만료 시간 설정
- [x] 최대 업로드 횟수 제한
- [x] 최대 파일 크기 제한
- [x] 허용 확장자 제한
- [x] 업로드 진행률 및 속도 표시
- [x] 업로드 취소 기능

#### 사용자 간 공유
- [x] 파일/폴더를 특정 사용자에게 공유
- [x] 공유 권한 설정 (읽기, 읽기+쓰기)
- [x] 공유받은 파일 목록 조회

### 공유 드라이브 (팀 폴더)
- [x] 공유 드라이브 생성/관리
- [x] 멤버 추가/제거
- [x] 권한 관리 (읽기 전용, 읽기/쓰기)
- [x] 사용자 생성 시 공유 드라이브 권한 할당
- [x] 공유 드라이브 검색 (5개 이상일 때)

### 스토리지
- [x] 사용자별 홈 폴더 (`/home`)
- [x] 공유 드라이브 (`/shared-drives`)
- [x] 공유받은 파일 (`/shared-with-me`)
- [x] 실시간 스토리지 사용량 표시
- [x] SMB/CIFS 네트워크 드라이브 접근
- [x] WebDAV 접근
- [x] SMB 사용자 자동 동기화

### 사용자 경험
- [x] 드래그 앤 드롭 업로드 (파일 및 폴더)
- [x] 폴더 구조 유지 업로드
- [x] 다중 파일 선택 (Ctrl+클릭, Shift+클릭)
- [x] 일괄 삭제/다운로드
- [x] 백그라운드 업로드/다운로드
- [x] 전송 진행률 표시 (사이드바)
- [x] 정렬 (이름, 크기, 날짜)
- [x] 컨텍스트 메뉴 (우클릭)
- [x] 파일 상세 정보 패널
- [x] 토스트 알림
- [x] 실시간 파일 변경 알림 (WebSocket)
- [x] 다크 모드 지원

### 관리자 기능
- [x] 사용자 CRUD
- [x] 사용자 활성화/비활성화
- [x] 공유 드라이브 관리
- [x] 감사 로그 (파일 작업, 로그인, 공유)
- [x] SMB 감사 로그 동기화
- [x] SMB 비밀번호 관리

## 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  Browser │  │   SMB    │  │  WebDAV  │  │ Mobile/Desktop   │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘ │
└───────┼─────────────┼─────────────┼─────────────────┼───────────┘
        │             │             │                 │
        ▼             ▼             ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Docker Network                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ :3080                                                        ││
│  │ ┌──────────────┐      ┌──────────────────────────────────┐  ││
│  │ │   UI Server  │◄────►│            API Server            │  ││
│  │ │  (Express)   │      │             (Go Echo)            │  ││
│  │ │              │      │  ┌────────────────────────────┐  │  ││
│  │ │ - Static     │      │  │ Handlers                   │  │  ││
│  │ │ - Proxy API  │      │  │ - Auth (JWT, 2FA, SSO)     │  │  ││
│  │ │ - Proxy WS   │      │  │ - Files & Folders          │  │  ││
│  │ └──────────────┘      │  │ - Shares & Links           │  │  ││
│  │                       │  │ - TUS Upload               │  │  ││
│  │ :445                  │  │ - WebSocket                │  │  ││
│  │ ┌──────────────┐      │  │ - WebDAV                   │  │  ││
│  │ │    Samba     │      │  │ - OnlyOffice               │  │  ││
│  │ │  (SMB/CIFS)  │      │  └────────────────────────────┘  │  ││
│  │ └──────┬───────┘      └────────────────┬─────────────────┘  ││
│  │        │                               │                     ││
│  │        ▼                               ▼                     ││
│  │ ┌──────────────────────────────────────────────────────────┐││
│  │ │                    Shared Volume                          │││
│  │ │  /data/users/     - User home directories                 │││
│  │ │  /data/shared/    - Shared drives                         │││
│  │ └──────────────────────────────────────────────────────────┘││
│  │        │                               │                     ││
│  │        ▼                               ▼                     ││
│  │ ┌──────────────┐      ┌──────────────────────────────────┐  ││
│  │ │  PostgreSQL  │      │            Valkey                │  ││
│  │ │    (DB)      │      │     (Cache/Session)              │  ││
│  │ └──────────────┘      └──────────────────────────────────┘  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  Optional Services:                                              │
│  ┌──────────────┐      ┌──────────────────────────────────┐     │
│  │  OnlyOffice  │      │           Keycloak               │     │
│  │  (Documents) │      │          (SSO/OIDC)              │     │
│  └──────────────┘      └──────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

## 디렉토리 구조

```
SimpleCloudVault/
├── api/                        # Go 백엔드
│   ├── handlers/               # HTTP 핸들러 (37개)
│   │   ├── auth.go             # 인증 (로그인, 2FA, SSO)
│   │   ├── handler.go          # 파일/폴더 CRUD
│   │   ├── share.go            # 공유 링크 (다운로드)
│   │   ├── upload_share.go     # 업로드 링크
│   │   ├── file_share_handler.go  # 사용자 간 공유
│   │   ├── shared_folder.go    # 공유 드라이브
│   │   ├── onlyoffice.go       # OnlyOffice 통합
│   │   ├── operations.go       # 파일 작업
│   │   ├── trash.go            # 휴지통
│   │   ├── metadata.go         # 파일 메타데이터
│   │   ├── preview_cache.go    # 미리보기 캐시
│   │   ├── zip_download.go     # ZIP 다운로드
│   │   ├── acl.go              # 접근 제어
│   │   ├── audit.go            # 감사 로그
│   │   ├── websocket.go        # 실시간 알림
│   │   ├── webdav.go           # WebDAV 지원
│   │   └── ...
│   ├── database/               # DB 연결
│   ├── main.go                 # 엔트리포인트
│   └── Dockerfile
├── ui/                         # React 프론트엔드
│   ├── src/
│   │   ├── api/                # API 클라이언트 (11개)
│   │   ├── components/         # React 컴포넌트 (60+)
│   │   ├── stores/             # Zustand 스토어
│   │   └── styles/             # 글로벌 스타일
│   ├── server.cjs              # Express 서버
│   └── Dockerfile
├── samba/                      # Samba 설정
│   ├── smb.conf.template
│   ├── entrypoint.sh
│   └── Dockerfile
├── db/                         # 데이터베이스
│   └── init.sql                # 스키마 (10개 테이블)
├── scripts/                    # 유틸리티 스크립트
│   └── setup-keycloak.sh       # SSO 설정
├── data/                       # 파일 저장소
│   ├── users/                  # 사용자 홈 폴더
│   └── shared/                 # 공유 폴더
├── docker-compose.yml          # 기본 구성
└── docker-compose-sso.yaml     # SSO 구성
```

## 설치 및 실행

### 요구 사항
- Docker & Docker Compose v2
- 최소 4GB RAM
- 포트: 3080 (웹), 445/139 (SMB)

### 기본 설치

```bash
# 저장소 클론
git clone <repository-url>
cd SimpleCloudVault

# 모든 서비스 빌드 및 시작
docker compose up -d --build

# 로그 확인
docker compose logs -f
```

### OnlyOffice 문서 편집기 (선택)

```bash
# OnlyOffice 포함하여 시작
docker compose --profile office up -d
```

### SSO (Keycloak) 통합 (선택)

```bash
# SSO 프로필로 시작
docker compose -f docker-compose.yml -f docker-compose-sso.yaml up -d

# Keycloak 초기 설정 (최초 1회)
./scripts/setup-keycloak.sh
```

Keycloak 관리 콘솔: http://localhost:8180/auth (admin/admin)

### 접속

| 프로토콜 | URL |
|----------|-----|
| 웹 UI | http://localhost:3080 |
| SMB (Windows) | `\\localhost\home` |
| SMB (Mac/Linux) | `smb://localhost/home` |
| WebDAV | `http://localhost:3080/api/webdav/` |

### 기본 계정

```
사용자명: admin
비밀번호: admin1234
```

## API 엔드포인트

### 인증
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/auth/login` | 로그인 |
| POST | `/api/auth/login/sso` | SSO 로그인 |
| GET | `/api/auth/profile` | 프로필 조회 |
| PUT | `/api/auth/profile` | 프로필 수정 |
| GET | `/api/auth/2fa/status` | 2FA 상태 확인 |
| POST | `/api/auth/2fa/setup` | 2FA 설정 시작 |
| POST | `/api/auth/2fa/verify` | 2FA 코드 검증 |
| POST | `/api/auth/2fa/disable` | 2FA 비활성화 |

### 파일 관리
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/files` | 파일 목록 (페이지네이션) |
| GET | `/api/files/search` | 파일 검색 |
| GET | `/api/files/*` | 파일 다운로드 |
| DELETE | `/api/files/*` | 파일 삭제 |
| PUT | `/api/files/rename/*` | 이름 변경 |
| PUT | `/api/files/move/*` | 이동 |
| POST | `/api/files/copy/*` | 복사 |
| POST | `/api/files/create` | 새 파일 생성 |
| POST | `/api/folders` | 폴더 생성 |
| GET | `/api/folders/stats/*` | 폴더 통계 |
| GET | `/api/zip/*` | ZIP 다운로드 |

### 업로드 (TUS)
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/upload/` | 업로드 시작 |
| PATCH | `/api/upload/*` | 청크 업로드 |
| HEAD | `/api/upload/*` | 업로드 상태 |

### 공유 링크 (다운로드)
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/shares` | 공유 생성 |
| GET | `/api/shares` | 공유 목록 |
| DELETE | `/api/shares/:id` | 공유 삭제 |
| GET | `/api/s/:token` | 공유 정보 조회 |
| GET | `/api/s/:token/download` | 공유 다운로드 |

### 업로드 링크
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/u/:token` | 업로드 공유 정보 |
| POST | `/api/u/:token` | 업로드 공유 검증 |
| POST | `/api/u/:token/upload/` | 파일 업로드 (TUS) |

### 파일 메타데이터
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/metadata/*` | 메타데이터 조회 |
| PUT | `/api/metadata/*` | 메타데이터 수정 |

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
| GET | `/api/shared-folders` | 목록 조회 |
| POST | `/api/shared-folders` | 생성 |
| DELETE | `/api/shared-folders/:id` | 삭제 |
| POST | `/api/shared-folders/:id/members` | 멤버 추가 |
| DELETE | `/api/shared-folders/:id/members/:userId` | 멤버 제거 |

### 관리자
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/admin/users` | 사용자 목록 |
| POST | `/api/admin/users` | 사용자 생성 |
| PUT | `/api/admin/users/:id` | 사용자 수정 |
| DELETE | `/api/admin/users/:id` | 사용자 삭제 |
| GET | `/api/audit/logs` | 감사 로그 |

### 기타
| Method | Endpoint | 설명 |
|--------|----------|------|
| WS | `/api/ws` | 실시간 알림 |
| ANY | `/api/webdav/*` | WebDAV 접근 |
| GET | `/api/storage/usage` | 스토리지 사용량 |

## 환경 변수

### API 서버
| 변수 | 기본값 | 설명 |
|------|--------|------|
| DB_HOST | db | PostgreSQL 호스트 |
| DB_PORT | 5432 | PostgreSQL 포트 |
| DB_USER | scv | 데이터베이스 사용자 |
| DB_PASS | scv_password | 데이터베이스 비밀번호 |
| DB_NAME | scv | 데이터베이스 이름 |
| VALKEY_HOST | valkey | Valkey 호스트 |
| VALKEY_PORT | 6379 | Valkey 포트 |
| JWT_SECRET | - | JWT 서명 키 |
| OIDC_ISSUER | - | SSO 발급자 URL |
| OIDC_CLIENT_ID | - | SSO 클라이언트 ID |
| OIDC_CLIENT_SECRET | - | SSO 클라이언트 시크릿 |

### UI 서버
| 변수 | 기본값 | 설명 |
|------|--------|------|
| API_URL | http://api:8080 | API 서버 URL |

## 데이터베이스 스키마

| 테이블 | 설명 |
|--------|------|
| users | 사용자 계정 |
| acl | 접근 제어 목록 |
| audit_logs | 감사 로그 |
| shares | 공유 링크 |
| shared_folders | 공유 드라이브 |
| shared_folder_members | 공유 드라이브 멤버 |
| file_shares | 사용자 간 공유 |
| trash_items | 휴지통 |
| file_metadata | 파일 메타데이터 |
| preview_cache | 미리보기 캐시 |

## 향후 개선 사항

### 기능
- [ ] 파일 버전 관리 (히스토리)
- [ ] 오프라인 동기화 클라이언트
- [ ] 모바일 앱 (iOS/Android)
- [ ] 파일 암호화 (at rest)
- [ ] 워터마크 기능
- [ ] 공유 링크 분석/통계

### 성능
- [ ] 썸네일 생성 최적화
- [ ] 대용량 폴더 가상 스크롤
- [ ] CDN 통합

### 보안
- [ ] IP 화이트리스트
- [ ] 로그인 시도 제한 (Rate Limiting)
- [ ] 파일 바이러스 스캔
- [ ] 세션 관리 UI

## 라이선스

MIT License

## 기여

이슈와 풀 리퀘스트를 환영합니다.
