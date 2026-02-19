# FileHatch 인프라/DevOps 명세

> **현재 버전:** 0.10.1
> **컨테이너 런타임:** Docker Compose v2
> **CI/CD:** GitHub Actions
> **레지스트리:** Docker Hub (`svrforum/filehatch-*`)
> **플랫폼:** linux/amd64

---

## 목차

1. [Docker 서비스](#docker-서비스)
2. [Docker 이미지 빌드](#docker-이미지-빌드)
3. [CI/CD 워크플로우](#cicd-워크플로우)
4. [스크립트](#스크립트)
5. [환경변수](#환경변수)
6. [볼륨 및 데이터 경로](#볼륨-및-데이터-경로)
7. [네트워크 구성](#네트워크-구성)
8. [테스트 인프라](#테스트-인프라)
9. [배포 절차](#배포-절차)

---

## Docker 서비스

### 서비스 요약

| # | 서비스 | 컨테이너명 | 이미지 (프로덕션) | 이미지 (개발) | 포트 | 필수 |
|---|--------|-----------|-----------------|-------------|------|------|
| 1 | `api` | `fh-api` | `svrforum/filehatch-api` | 로컬 빌드 (`./api`) | 8080 (내부) | 필수 |
| 2 | `ui` | `fh-ui` | `svrforum/filehatch-ui` | 로컬 빌드 (`./ui`) | 3000 -> 3080 | 필수 |
| 3 | `samba` | `fh-samba` | `svrforum/filehatch-samba` | 로컬 빌드 (`./samba`) | Host network | 필수 |
| 4 | `db` | `fh-db` | `postgres:17-alpine` | 동일 | 5432 (내부) | 필수 |
| 5 | `valkey` | `fh-valkey` | `valkey/valkey:8.1.5-alpine` | 동일 | 6379 (내부) | 필수 |
| 6 | `onlyoffice` | `fh-onlyoffice` | `onlyoffice/documentserver:9.2.1` | 동일 | 8088 | 선택 (profile: office) |
| 7 | `keycloak` | `fh-keycloak` | `quay.io/keycloak/keycloak:26.5.1` | 동일 | 8180 | 선택 (profile: sso) |

### 서비스 상세

#### 1. api (Go 백엔드)

```yaml
# 의존성
depends_on:
  db: { condition: service_healthy }
  valkey: { condition: service_healthy }

# 헬스체크
healthcheck:
  test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080/health"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 10s

# 볼륨
volumes:
  - ${DATA_PATH:-./data}:/data                           # 사용자 파일 데이터
  - ${CONFIG_PATH:-./config}:/etc/filehatch              # 설정 파일
  - /var/run/docker.sock:/var/run/docker.sock:ro          # Docker 소켓 (시스템 정보용)
```

#### 2. ui (React + Express)

```yaml
# 포트 매핑
ports:
  - "${UI_PORT:-3080}:3000"     # 외부 3080 -> 내부 3000

# 의존성
depends_on:
  api: { condition: service_healthy }

# 헬스체크
healthcheck:
  test: ["CMD", "wget", "-q", "--spider", "http://127.0.0.1:3000"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 10s
```

#### 3. samba (SMB 서비스)

```yaml
# 네트워크 모드: host (SMB 프로토콜 요구)
network_mode: host

# 헬스체크
healthcheck:
  test: ["CMD-SHELL", "pgrep -x smbd > /dev/null && pgrep -x nmbd > /dev/null"]
  interval: 15s
  timeout: 10s
  retries: 5
  start_period: 30s

# 볼륨
volumes:
  - ${DATA_PATH:-./data}:/data
  - ${CONFIG_PATH:-./config}:/etc/filehatch
```

#### 4. db (PostgreSQL)

```yaml
image: postgres:17-alpine

# 성능 튜닝 (커맨드)
command:
  - "postgres"
  - "-c" "shared_buffers=256MB"
  - "-c" "effective_cache_size=512MB"
  - "-c" "work_mem=16MB"
  - "-c" "log_min_duration_statement=1000"   # 1초 이상 슬로우 쿼리 로깅

# 헬스체크
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-fh_user} -d ${DB_NAME:-fh_main}"]
  interval: 5s
  timeout: 5s
  retries: 5
```

#### 5. valkey (캐시 서버)

```yaml
image: valkey/valkey:8.1.5-alpine

# 헬스체크
healthcheck:
  test: ["CMD", "valkey-cli", "ping"]
  interval: 5s
  timeout: 3s
  retries: 5
```

#### 6. onlyoffice (문서 편집기) -- 선택

```yaml
image: onlyoffice/documentserver:9.2.1
profiles: [office]    # docker compose --profile office up -d

ports:
  - "${ONLYOFFICE_PORT:-8088}:80"

environment:
  - JWT_ENABLED=false
  - ALLOW_PRIVATE_IP_ADDRESS=true
  - ALLOW_META_IP_ADDRESS=true
  - USE_UNAUTHORIZED_STORAGE=true
  - WOPI_ENABLED=false

# 볼륨 (Named)
volumes:
  - onlyoffice_data:/var/www/onlyoffice/Data
  - onlyoffice_log:/var/log/onlyoffice
```

#### 7. keycloak (SSO 서버) -- 선택

```yaml
image: quay.io/keycloak/keycloak:26.5.1
profiles: [sso]    # docker compose --profile sso up -d

ports:
  - "${KEYCLOAK_PORT:-8180}:8080"

command: start-dev

# 헬스체크
healthcheck:
  test: ["CMD-SHELL", "exec 3<>/dev/tcp/localhost/8080 && ..."]
  interval: 30s
  timeout: 10s
  retries: 10
  start_period: 120s     # Keycloak 초기화 시간 고려

# 볼륨 (Named)
volumes:
  - keycloak_data:/opt/keycloak/data
```

### Docker Compose 파일 구분

| 파일 | 용도 | 이미지 소스 |
|------|------|------------|
| `docker-compose.yml` | 프로덕션 배포 | Docker Hub (`svrforum/filehatch-*`) |
| `docker-compose-dev.yaml` | 개발/테스트 | 로컬 빌드 (`./api`, `./ui`, `./samba`) |
| `docker-compose-sso.yaml` | SSO 전용 설정 | - |
| `docker-compose.override.example.yml` | 오버라이드 예시 | - |

### 프로필 사용법

```bash
# 코어 서비스만
docker compose up -d

# OnlyOffice 포함
docker compose --profile office up -d

# SSO (Keycloak) 포함
docker compose --profile sso up -d

# 전부 포함
docker compose --profile office --profile sso up -d
```

---

## Docker 이미지 빌드

### API (Go)

**파일:** `api/Dockerfile`

```
빌드 스테이지 (golang:1.24-alpine):
  1. go mod tidy && go mod download
  2. CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o main .

런타임 스테이지 (alpine:3.23):
  1. ca-certificates, tzdata, docker-cli, ffmpeg, libwebp-tools 설치
  2. 바이너리 복사
  3. /data, /etc/filehatch 디렉토리 생성
  4. EXPOSE 8080
  5. CMD ["./main"]
```

| 빌드 옵션 | 값 | 설명 |
|----------|------|------|
| `CGO_ENABLED` | `0` | 정적 바이너리 (C 라이브러리 불필요) |
| `GOOS` | `linux` | 리눅스 타겟 |
| `-trimpath` | - | 디버그 경로 제거 |
| `-ldflags="-s -w"` | - | 심볼/디버그 정보 제거 (이미지 크기 최소화) |

**런타임 패키지:**
| 패키지 | 용도 |
|--------|------|
| `ca-certificates` | HTTPS 인증서 |
| `tzdata` | 타임존 데이터 |
| `docker-cli` | 시스템 정보 (Docker 소켓 접근) |
| `ffmpeg` | 비디오 썸네일 생성 |
| `libwebp-tools` | WebP 이미지 변환 |

### UI (React)

**파일:** `ui/Dockerfile`

```
빌드 스테이지 (node:20-alpine):
  1. npm install (devDependencies 포함)
  2. npm run build (Vite)

런타임 스테이지 (node:20-alpine):
  1. npm install --omit=dev (프로덕션 의존성만)
  2. dist/ 복사
  3. server.cjs 복사
  4. EXPOSE 3000
  5. CMD ["node", "server.cjs"]
```

`server.cjs`는 Express.js 서버로 다음 기능을 수행합니다:
- 정적 파일 서빙 (`dist/`)
- API 프록시 (`/api/*`, `/ws/*`, `/tus/*` -> api:8080)
- SPA 폴백 (모든 라우트 -> `index.html`)

---

## CI/CD 워크플로우

### test.yml (PR 테스트)

**트리거:** Pull Request -> `main`, `develop` 브랜치

```
┌─────────────────┐     ┌─────────────────┐
│ backend-tests   │     │ frontend-tests  │     ┌─────────┐
│ (Go test -race) │     │ (npm test:cov)  │     │  lint   │
└────────┬────────┘     └────────┬────────┘     └─────────┘
         │                       │                    │
         └───────────┬───────────┘                    │
                     │                                │
              ┌──────┴──────┐                         │
              │    build    │                         │
              │ (Go+Node+  │                         │
              │  Docker)   │                         │
              └──────┬──────┘                         │
           ┌─────────┼─────────┐                      │
           │         │         │                      │
    ┌──────┴──┐ ┌────┴─────┐ ┌┴──────────────┐       │
    │ e2e     │ │ docker   │ │ security-scan │       │
    │ tests   │ │ health   │ │ (gosec)       │       │
    └─────────┘ └──────────┘ └───────────────┘       │
```

| Job | 설명 | 주요 명령 |
|-----|------|---------|
| `backend-tests` | Go 유닛 테스트 | `go test -v -race -coverprofile=coverage.out -covermode=atomic ./...` |
| `frontend-tests` | React 유닛 테스트 | `npm run test:coverage` |
| `build` | 빌드 검증 | `go build` + `npm run build` + `docker compose build` |
| `e2e-tests` | E2E 테스트 (Playwright) | `npx playwright test --project=chromium` |
| `security-scan` | 보안 스캔 | `gosec -exclude=G104 -fmt=sarif ./api/...` |
| `lint` | 린트 검사 | `golangci-lint run --timeout=5m` + `tsc --noEmit` |
| `docker-health` | 헬스 체크 | Docker Compose 실행 -> `/health` 확인 |

### release.yml (릴리즈)

**트리거:** Tag push (`v*`)

```
┌───────────────┐  ┌───────────────┐  ┌──────┐
│ test-backend  │  │ test-frontend │  │ lint │
└───────┬───────┘  └───────┬───────┘  └──┬───┘
        │                  │              │
        └──────────┬───────┘──────────────┘
                   │
            ┌──────┴──────┐
            │   detect    │   (소스 해시 vs 이미지 다이제스트 비교)
            │  changes    │
            └──────┬──────┘
       ┌───────────┼───────────┐
       │           │           │
  ┌────┴────┐ ┌────┴────┐ ┌───┴─────┐
  │build-api│ │build-ui │ │build-   │   (변경된 컴포넌트만 빌드)
  │         │ │         │ │samba    │
  └────┬────┘ └────┬────┘ └───┬─────┘
       │           │           │
       └───────────┼───────────┘
                   │
            ┌──────┴──────┐
            │   release   │   (GitHub Release + Changelog)
            └─────────────┘
```

| Job | 설명 |
|-----|------|
| `test-backend` | Go 테스트 (`go test -v -race ./...`) |
| `test-frontend` | React 테스트 (`npm run test:coverage`) |
| `lint` | Go 린트 (`golangci-lint`) |
| `detect` | 변경 감지 (소스 파일 해시 vs Docker 이미지 다이제스트) |
| `build-api` | API 이미지 빌드 및 푸시 (조건부: api 변경 시만) |
| `build-ui` | UI 이미지 빌드 및 푸시 (조건부: ui 변경 시만) |
| `build-samba` | Samba 이미지 빌드 및 푸시 (조건부: samba 변경 시만) |
| `release` | GitHub Release 생성 (changelog, Docker 이미지 태그 포함) |

### Docker 이미지 태깅

```bash
# 버전 태그 + latest 태그
svrforum/filehatch-api:{version}
svrforum/filehatch-api:latest

svrforum/filehatch-ui:{version}
svrforum/filehatch-ui:latest

svrforum/filehatch-samba:{version}
svrforum/filehatch-samba:latest
```

### 빌드 캐시

GitHub Actions cache를 사용한 Docker 빌드 캐시:

```yaml
cache-from: type=gha,scope=api
cache-to: type=gha,mode=max,scope=api
```

---

## 스크립트

스크립트 위치: `scripts/`

### test.sh

> 전체 테스트 실행 (린트 + 테스트 + 빌드 검증)

```bash
./scripts/test.sh                  # 전체 실행
./scripts/test.sh --backend-only   # Go 테스트만
./scripts/test.sh --frontend-only  # React 테스트만
./scripts/test.sh --no-build       # 빌드 검증 스킵
./scripts/test.sh --verbose        # 상세 출력
```

**실행 순서:**
1. Go 린트 (golangci-lint)
2. Go 테스트 (`go test -v -race ./...`)
3. Go 빌드 검증
4. TypeScript 타입 체크 (`tsc --noEmit`)
5. React 테스트 (`npm run test:run`)
6. React 빌드 검증 (`npm run build`)

### setup.sh

> 초기 환경 설정

```bash
./scripts/setup.sh
```

**수행 작업:**
1. `.env` 파일 생성 (`.env.example`에서 복사)
2. 시크릿 키 자동 생성 (JWT_SECRET, ENCRYPTION_KEY)
3. 데이터 디렉토리 생성 (`data/`, `config/`, `database/`)
4. Docker 이미지 빌드

### backup.sh

> 백업 및 복원

```bash
./scripts/backup.sh db              # DB 백업
./scripts/backup.sh files           # 파일 백업
./scripts/backup.sh config          # 설정 백업
./scripts/backup.sh all             # 전체 백업
./scripts/backup.sh all -o /backup  # 출력 디렉토리 지정
./scripts/backup.sh all -k 5        # 최근 5개만 유지
```

### restore.sh

> 백업 복원

```bash
./scripts/restore.sh <backup-file>
```

### migrate.sh

> DB 마이그레이션

```bash
./scripts/migrate.sh status    # 마이그레이션 상태 확인
./scripts/migrate.sh migrate   # 마이그레이션 실행
./scripts/migrate.sh           # 기본: migrate
```

### setup-keycloak.sh

> Keycloak SSO 설정 자동화

```bash
./scripts/setup-keycloak.sh
```

**수행 작업:**
1. Keycloak 관리자 토큰 획득
2. FileHatch Realm 생성
3. Client 등록
4. SSO 프로바이더 자동 설정

### test-api.sh

> API 통합 테스트 (curl 기반)

```bash
./scripts/test-api.sh
```

---

## 환경변수

### 필수 환경변수

| 변수 | 기본값 | 설명 | 생성 방법 |
|------|--------|------|---------|
| `JWT_SECRET` | - (필수) | JWT 서명 키 (32자 이상) | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | - (필수) | AES-256 암호화 키 (64자 hex) | `openssl rand -hex 32` |

### 데이터베이스 설정

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DB_HOST` | `db` | PostgreSQL 호스트 |
| `DB_PORT` | `5432` | PostgreSQL 포트 |
| `DB_USER` | `fh_user` | DB 사용자명 |
| `DB_PASS` | `fh_password` | DB 비밀번호 |
| `DB_NAME` | `fh_main` | DB 이름 |

### 캐시 설정

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `VALKEY_HOST` | `valkey` | Valkey 호스트 |
| `VALKEY_PORT` | `6379` | Valkey 포트 |

### 네트워크/보안 설정

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `CORS_ALLOWED_ORIGINS` | `*` | CORS 허용 출처 (프로덕션에서는 도메인 지정 권장) |
| `ALLOWED_ORIGINS` | - | WebSocket 허용 출처 (쉼표 구분) |
| `EXTERNAL_URL` | - | 외부 접근 URL (리버스 프록시 시 필수) |

### 포트 설정

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `UI_PORT` | `3080` | 웹 UI 외부 포트 |
| `ONLYOFFICE_PORT` | `8088` | OnlyOffice 포트 |
| `KEYCLOAK_PORT` | `8180` | Keycloak 포트 |

### 파일 스토리지 설정

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DATA_PATH` | `./data` | 사용자 파일 데이터 경로 |
| `CONFIG_PATH` | `./config` | 설정 파일 경로 |
| `DATABASE_PATH` | `./database` | PostgreSQL 데이터 경로 |

### 성능/로깅 설정

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `LOG_LEVEL` | `info` | 로그 레벨 (debug/info/warn/error) |
| `MAX_UPLOAD_SIZE` | `10737418240` | 최대 업로드 크기 (10GB) |
| `THUMBNAIL_CACHE_SIZE_MB` | `500` | 썸네일 캐시 크기 (MB) |
| `AUDIT_LOG_RETENTION_DAYS` | `365` | 감사 로그 보존 기간 (일) |

### OnlyOffice 설정

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `ONLYOFFICE_URL` | `http://onlyoffice` | OnlyOffice 내부 URL (Docker 네트워크) |
| `ONLYOFFICE_PUBLIC_URL` | - | OnlyOffice 외부 URL (브라우저 접근용) |

### SSO/Keycloak 설정

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `KEYCLOAK_ADMIN` | `admin` | Keycloak 관리자 계정 |
| `KEYCLOAK_ADMIN_PASSWORD` | `admin123` | Keycloak 관리자 비밀번호 |
| `KEYCLOAK_HOSTNAME` | `localhost` | Keycloak 호스트명 |

### 기타 설정

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `TZ` | `Asia/Seoul` | 타임존 |
| `SMB_WORKGROUP` | `WORKGROUP` | SMB 워크그룹 |
| `IMAGE_TAG` | `latest` | Docker 이미지 태그 (프로덕션) |
| `DEV_MODE` | `false` | 개발 모드 (상세 에러 메시지) |

---

## 볼륨 및 데이터 경로

### 바인드 마운트 (호스트 -> 컨테이너)

| 호스트 경로 | 컨테이너 경로 | 서비스 | 설명 |
|------------|-------------|--------|------|
| `${DATA_PATH:-./data}` | `/data` | api, samba | 사용자 파일 데이터 |
| `${CONFIG_PATH:-./config}` | `/etc/filehatch` | api, samba | 설정 파일 |
| `${DATABASE_PATH:-./database}` | `/var/lib/postgresql/data` | db | PostgreSQL 데이터 |
| `/var/run/docker.sock` | `/var/run/docker.sock` (ro) | api | Docker 소켓 (시스템 정보) |

### Named 볼륨

| 볼륨 | 서비스 | 설명 |
|------|--------|------|
| `onlyoffice_data` | onlyoffice | OnlyOffice 데이터 |
| `onlyoffice_log` | onlyoffice | OnlyOffice 로그 |
| `keycloak_data` | keycloak | Keycloak 데이터 |

### /data 디렉토리 구조

```
/data/
├── home/                  # 사용자별 홈 디렉토리
│   ├── {username}/        # 각 사용자의 파일
│   └── ...
├── shared/                # 공유 드라이브
│   ├── {folder-name}/     # 각 공유 폴더
│   └── ...
├── trash/                 # 휴지통
│   ├── {username}/        # 사용자별 휴지통
│   └── ...
├── uploads/               # 업로드 임시 디렉토리
│   ├── {username}/        # tus 업로드 임시 파일
│   └── ...
├── shares/                # 업로드 공유 임시 저장소
└── thumbnails/            # 썸네일 캐시
```

---

## 네트워크 구성

### Docker 내부 네트워크

```
                        ┌─────────────┐
                        │   Browser   │
                        └──────┬──────┘
                               │ :3080
                        ┌──────┴──────┐
                        │     ui      │ (Express proxy)
                        │  :3000      │
                        └──────┬──────┘
                               │ :8080
                        ┌──────┴──────┐
              ┌─────────│     api     │─────────┐
              │         │  :8080      │         │
              │         └─────────────┘         │
              │                                 │
       ┌──────┴──────┐                  ┌───────┴──────┐
       │     db      │                  │    valkey    │
       │  :5432      │                  │   :6379     │
       └─────────────┘                  └──────────────┘
```

### 외부 포트 매핑

| 서비스 | 내부 포트 | 외부 포트 | 프로토콜 |
|--------|----------|----------|---------|
| ui | 3000 | `${UI_PORT:-3080}` | HTTP |
| onlyoffice | 80 | `${ONLYOFFICE_PORT:-8088}` | HTTP |
| keycloak | 8080 | `${KEYCLOAK_PORT:-8180}` | HTTP |
| samba | 445, 139 | Host network | SMB |

### UI 프록시 라우팅 (server.cjs)

| URL 패턴 | 프록시 대상 | 설명 |
|----------|------------|------|
| `/api/*` | `http://api:8080` | REST API |
| `/ws/*` | `http://api:8080` | WebSocket |
| `/tus/*` | `http://api:8080` | tus 업로드 프로토콜 |
| `/*` | `dist/index.html` | SPA 폴백 |

---

## 테스트 인프라

### 백엔드 테스트 (Go)

| 항목 | 값 |
|------|------|
| 프레임워크 | Go `testing` 패키지 |
| 어서션 | `testify/assert` |
| DB 모킹 | `DATA-DOG/go-sqlmock` |
| 실행 명령 | `go test -v -race ./...` |
| 커버리지 | `go test -coverprofile=coverage.out -covermode=atomic ./...` |
| 테스트 위치 | `api/handlers/*_test.go` |

### 프론트엔드 테스트 (React)

| 항목 | 값 |
|------|------|
| 프레임워크 | Vitest |
| DOM | JSDOM |
| 유틸리티 | `@testing-library/react` |
| 실행 명령 | `npm run test:run` (단일 실행) / `npm test` (watch) |
| 커버리지 | `npm run test:coverage` |
| 타입 체크 | `npx tsc --noEmit` |
| 테스트 위치 | `ui/src/hooks/__tests__/*.test.ts` |

### E2E 테스트 (Playwright)

| 항목 | 값 |
|------|------|
| 프레임워크 | Playwright |
| 테스트 위치 | `tests/e2e/` |
| 설정 파일 | `tests/e2e/playwright.config.ts` |
| 브라우저 | Chromium (CI), Chromium + Firefox + WebKit (전체) |
| 프로젝트 | chromium, firefox, webkit, mobile, admin, unauthenticated |
| Base URL | `http://localhost:3080` |

### 커버리지 통합

| 서비스 | 플래그 | 커버리지 파일 |
|--------|--------|-------------|
| Codecov | `backend` | `api/coverage.out` |
| Codecov | `frontend` | `ui/coverage/coverage-final.json` |

---

## 배포 절차

### 프로덕션 배포

```bash
# 1. 코드 검증
./scripts/test.sh

# 2. 린트 검증
docker run --rm -v $(pwd)/api:/app -w /app golangci/golangci-lint:latest golangci-lint run --timeout=5m ./...

# 3. 버전 동기화 확인
grep 'Version.*=' api/version.go
grep '"version"' ui/package.json

# 4. 마이그레이션 파일 검증
for f in api/database/migrations/*.sql; do
  if ! grep -q "INSERT INTO schema_migrations" "$f"; then
    echo "누락: $f"
  fi
done

# 5. Docker 빌드 확인
docker compose -f docker-compose-dev.yaml build api ui

# 6. 태그 생성 및 푸시 (CI 자동 빌드 트리거)
git tag -a v{version} -m "릴리즈 설명"
git push origin v{version}

# 7. 프로덕션 서버에서 업데이트
docker compose pull
docker compose up -d
```

### 개발 서버 배포

```bash
# 코드 수정 후 로컬 빌드 및 재시작
docker compose -f docker-compose-dev.yaml build --no-cache api ui
docker compose -f docker-compose-dev.yaml down api ui
docker compose -f docker-compose-dev.yaml up -d api ui

# 서비스 상태 확인
curl -s http://localhost:3080/health
curl -s http://localhost:3080/api/version

# 로그 확인
docker compose -f docker-compose-dev.yaml logs -f api ui
```

### 신규 설치

```bash
# 1. 초기 설정
./scripts/setup.sh

# 2. .env 수정 (시크릿, 도메인 등)
vi .env

# 3. 서비스 시작
docker compose up -d

# 4. 첫 접속 (admin / admin1234)
# -> 초기 설정 모달에서 비밀번호 변경 필수
```

### 업그레이드

```bash
# 1. 백업
./scripts/backup.sh all

# 2. 이미지 업데이트
docker compose pull

# 3. 서비스 재시작 (마이그레이션 자동 적용)
docker compose up -d

# 4. 헬스 체크
curl -s http://localhost:3080/health
curl -s http://localhost:3080/api/version
```

---

## 보안 고려사항

### Docker 보안

| 항목 | 설정 |
|------|------|
| Docker 소켓 | 읽기 전용 마운트 (`:ro`) |
| 네트워크 격리 | 기본 Docker bridge (내부 통신만) |
| 이미지 출처 | Docker Hub 공식 이미지 + 자체 빌드 |
| 정적 바이너리 | `CGO_ENABLED=0` (공격 표면 최소화) |

### PostgreSQL 보안

| 항목 | 권장 설정 |
|------|---------|
| 비밀번호 | 프로덕션에서 강력한 비밀번호 사용 |
| 포트 노출 | 외부 포트 노출하지 않음 (내부 네트워크만) |
| 슬로우 쿼리 | `log_min_duration_statement=1000` (1초 이상 로깅) |

### 암호화

| 대상 | 알고리즘 | 키 출처 |
|------|---------|--------|
| JWT 토큰 | HS256 | `JWT_SECRET` 환경변수 |
| SSO Client Secret | AES-256-GCM | `ENCRYPTION_KEY` 환경변수 |
| 외부 스토리지 설정 | AES-256-GCM | `ENCRYPTION_KEY` 환경변수 |
| 사용자 비밀번호 | bcrypt | - |
