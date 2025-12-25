# SimpleCloudVault

엔터프라이즈급 클라우드 파일 공유 시스템

## 프로젝트 개요

SimpleCloudVault는 기업 환경에서 사용할 수 있는 안전하고 기능이 풍부한 파일 공유 시스템입니다. 웹 인터페이스와 SMB/CIFS 프로토콜을 통한 네트워크 드라이브 접근을 모두 지원합니다.

## 기술 스택

### Backend (API)
- **언어**: Go 1.23
- **프레임워크**: Echo v4
- **데이터베이스**: PostgreSQL 17
- **캐시/큐**: Valkey (Redis 호환)
- **인증**: JWT + bcrypt
- **파일 업로드**: TUS 프로토콜 (재개 가능한 대용량 업로드)
- **파일 공유**: SMB/CIFS (Samba)

### Frontend (UI)
- **프레임워크**: React 18
- **언어**: TypeScript
- **빌드 도구**: Vite
- **상태 관리**: Zustand
- **데이터 페칭**: TanStack React Query
- **파일 업로드**: tus-js-client
- **스타일링**: CSS3 (CSS Variables)

### 인프라
- **컨테이너화**: Docker & Docker Compose
- **리버스 프록시**: Express.js (UI 서버)
- **파일 시스템**: 로컬 볼륨 마운트

## 주요 기능

### 인증 및 사용자 관리
- [x] JWT 기반 인증
- [x] 사용자 등록/관리 (관리자)
- [x] 프로필 관리 및 비밀번호 변경
- [x] 관리자/일반 사용자 역할 분리
- [x] 관리자 모드 UI

### 파일 관리
- [x] 파일 업로드 (TUS 재개 가능)
- [x] 파일 다운로드 (진행률 표시)
- [x] 파일 삭제 (휴지통으로 이동)
- [x] 휴지통 기능 (복원, 영구 삭제, 비우기)
- [x] 파일 이름 변경
- [x] 파일/폴더 복사
- [x] 파일/폴더 이동 (API)
- [x] 폴더 생성/삭제
- [x] 새 파일 생성 (텍스트, Markdown, HTML, JSON, Word, Excel, PowerPoint)
- [x] 파일 검색
- [x] 파일 미리보기 (이미지, 텍스트, 비디오, 오디오, PDF)
- [x] 폴더 통계 (파일 수, 용량)

### 문서 편집
- [x] 텍스트 파일 편집기 (내장)
- [x] OnlyOffice 통합 (선택적)
  - Word 문서 (doc, docx, odt, rtf)
  - Excel 스프레드시트 (xls, xlsx, ods, csv)
  - PowerPoint 프레젠테이션 (ppt, pptx, odp)
  - PDF 뷰어

### 공유 드라이브 (팀 폴더)
- [x] 공유 드라이브 생성/관리
- [x] 멤버 추가/제거
- [x] 권한 관리 (읽기 전용, 읽기/쓰기)
- [x] 사용자 생성 시 공유 드라이브 권한 할당
- [x] 공유 드라이브 검색 (5개 이상일 때)

### 파일/폴더 공유
- [x] 사용자 간 파일/폴더 공유
- [x] 공유 권한 설정 (읽기, 읽기+쓰기)
- [x] 공유받은 파일 목록 조회
- [x] 공유 링크 생성 (외부 공유)
- [x] 링크 만료 설정
- [x] 비밀번호 보호 공유
- [x] 접근 횟수 제한
- [x] 공유 링크 자동 복사

### 스토리지
- [x] 사용자별 홈 폴더 (`/home`)
- [x] 공유 드라이브 (`/shared-drives`)
- [x] 공유받은 파일 (`/shared-with-me`)
- [x] 실시간 스토리지 사용량 표시
- [x] SMB/CIFS 네트워크 드라이브 접근
- [x] SMB 사용자 자동 동기화
- [x] SMB 감사 로깅 (파일 작업 추적)

### 사용자 경험
- [x] 드래그 앤 드롭 업로드 (업로드 모달 및 파일 목록에서)
- [x] 폴더 드래그 앤 드롭 업로드 (폴더 구조 유지)
- [x] 파일 탐색기에서 웹으로 직접 드래그 업로드
- [x] 다중 파일 선택 (Ctrl+클릭, Shift+클릭)
- [x] 일괄 삭제 (휴지통으로 이동)
- [x] 백그라운드 업로드/다운로드
- [x] 전송 진행률 표시 (사이드바)
- [x] 정렬 (이름, 크기, 날짜)
- [x] 컨텍스트 메뉴 (우클릭)
- [x] 파일 상세 정보 패널
- [x] 토스트 알림
- [x] 실시간 파일 변경 알림 (WebSocket)

### 관리자 기능
- [x] 사용자 CRUD (생성 모달 UI)
- [x] 사용자 활성화/비활성화
- [x] 사용자 생성 시 공유 드라이브 권한 설정
- [x] SMB 비밀번호 관리
- [x] 공유 드라이브 관리
- [x] 감사 로그 (파일 작업, 로그인, SMB 작업)
- [x] SMB 감사 로그 동기화

## 디렉토리 구조

```
SimpleCloudVault/
├── api/                    # Go 백엔드
│   ├── handlers/           # HTTP 핸들러
│   │   ├── handler.go      # 파일/폴더 핸들러
│   │   ├── auth.go         # 인증 핸들러
│   │   ├── share.go        # 공유 드라이브/파일 공유
│   │   ├── file_share_handler.go  # 사용자 간 파일 공유
│   │   ├── onlyoffice.go   # OnlyOffice 통합
│   │   ├── operations.go   # 파일 작업 (이동, 복사, 검색)
│   │   ├── trash.go        # 휴지통 핸들러
│   │   ├── smb_audit_handler.go   # SMB 감사 로그
│   │   ├── websocket.go    # 실시간 알림
│   │   └── utils.go        # 유틸리티 함수
│   ├── database/           # DB 연결
│   ├── main.go             # 엔트리포인트
│   └── Dockerfile
├── ui/                     # React 프론트엔드
│   ├── src/
│   │   ├── api/            # API 클라이언트
│   │   ├── components/     # React 컴포넌트
│   │   ├── stores/         # Zustand 스토어
│   │   └── styles/         # 글로벌 스타일
│   ├── server.cjs          # Express 서버
│   └── Dockerfile
├── samba/                  # Samba 설정 (SMB/CIFS)
│   ├── smb.conf.template   # Samba 설정 템플릿
│   ├── entrypoint.sh       # 사용자 동기화 + 감사 로깅
│   └── Dockerfile          # ghcr.io/servercontainers/samba 기반
├── db/                     # 데이터베이스 초기화
│   └── init.sql
├── config/                 # 설정 파일
│   └── smb.conf
├── data/                   # 파일 저장소
│   ├── users/              # 사용자 홈 폴더
│   └── shared/             # 공유 폴더
└── docker-compose.yml
```

## 설치 및 실행

### 요구 사항
- Docker & Docker Compose
- 포트 3080 (웹 UI), 445/139 (SMB)

### 설치

```bash
# 저장소 클론
git clone <repository-url>
cd SimpleCloudVault

# 모든 서비스 빌드 및 시작
docker compose up -d --build

# 로그 확인
docker compose logs -f
```

### OnlyOffice 문서 편집기 (선택 사항)

OnlyOffice Document Server를 사용하면 Word, Excel, PowerPoint 문서를 웹 브라우저에서 직접 편집할 수 있습니다.

```bash
# OnlyOffice 포함하여 시작
docker compose --profile office up -d

# OnlyOffice 없이 시작 (기본)
docker compose up -d
```

OnlyOffice가 활성화되면 컨텍스트 메뉴에 "Office 편집" 옵션이 표시됩니다.

### 접속

- **웹 UI**: http://localhost:3080
- **SMB**: `\\localhost\home` (Windows) 또는 `smb://localhost/home` (Mac/Linux)

### 기본 계정

```
사용자명: admin
비밀번호: admin1234
```

## API 엔드포인트

### 인증
- `POST /api/auth/login` - 로그인
- `GET /api/auth/profile` - 프로필 조회
- `PUT /api/auth/profile` - 프로필 수정

### 파일
- `GET /api/files` - 파일 목록
- `GET /api/files/search?q=` - 파일 검색
- `GET /api/files/*` - 파일 다운로드
- `DELETE /api/files/*` - 파일 삭제
- `PUT /api/files/rename/*` - 이름 변경
- `PUT /api/files/move/*` - 이동
- `POST /api/files/copy/*` - 복사

### 폴더
- `POST /api/folders` - 폴더 생성
- `DELETE /api/folders/*` - 폴더 삭제
- `GET /api/folders/stats/*` - 폴더 통계
- `POST /api/files/create` - 새 파일 생성

### OnlyOffice
- `GET /api/onlyoffice/config/*` - 문서 편집기 설정
- `POST /api/onlyoffice/callback` - 문서 저장 콜백

### 업로드 (TUS)
- `POST /api/upload/` - 업로드 시작
- `PATCH /api/upload/*` - 청크 업로드
- `HEAD /api/upload/*` - 업로드 상태

### 공유 링크
- `POST /api/shares` - 공유 링크 생성
- `GET /api/shares` - 공유 목록
- `DELETE /api/shares/:id` - 공유 삭제
- `GET /api/s/:token` - 공유 접근
- `GET /api/s/:token/download` - 공유 다운로드

### 파일 공유 (사용자 간)
- `POST /api/file-shares` - 파일을 사용자에게 공유
- `GET /api/file-shares/shared-by-me` - 내가 공유한 파일
- `GET /api/file-shares/shared-with-me` - 나에게 공유된 파일
- `PUT /api/file-shares/:id` - 공유 권한 수정
- `DELETE /api/file-shares/:id` - 공유 취소

### 공유 드라이브
- `GET /api/shared-folders` - 공유 드라이브 목록
- `POST /api/shared-folders` - 공유 드라이브 생성
- `PUT /api/shared-folders/:id` - 공유 드라이브 수정
- `DELETE /api/shared-folders/:id` - 공유 드라이브 삭제
- `POST /api/shared-folders/:id/members` - 멤버 추가
- `DELETE /api/shared-folders/:id/members/:userId` - 멤버 제거

### 스토리지
- `GET /api/storage/usage` - 사용량 조회

### SMB 감사
- `GET /api/smb/audit` - SMB 감사 로그 조회
- `POST /api/smb/audit/sync` - SMB 로그 동기화

### WebSocket
- `WS /api/ws` - 실시간 파일 변경 알림

### 휴지통
- `GET /api/trash` - 휴지통 목록
- `POST /api/trash/*` - 휴지통으로 이동
- `POST /api/trash/restore/:id` - 복원
- `DELETE /api/trash/:id` - 영구 삭제
- `DELETE /api/trash` - 휴지통 비우기

### 관리자
- `GET /api/admin/users` - 사용자 목록
- `POST /api/admin/users` - 사용자 생성
- `PUT /api/admin/users/:id` - 사용자 수정
- `DELETE /api/admin/users/:id` - 사용자 삭제

## 환경 변수

### API
- `DB_HOST` - PostgreSQL 호스트
- `DB_PORT` - PostgreSQL 포트
- `DB_USER` - 데이터베이스 사용자
- `DB_PASS` - 데이터베이스 비밀번호
- `DB_NAME` - 데이터베이스 이름
- `VALKEY_HOST` - Valkey 호스트
- `VALKEY_PORT` - Valkey 포트

### UI
- `API_URL` - API 서버 URL

## 라이선스

MIT License

## 기여

이슈와 풀 리퀘스트를 환영합니다.
