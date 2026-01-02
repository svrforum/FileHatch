# SimpleCloudVault 개발 로드맵 및 개선 계획

## 목차
1. [완료된 개선 사항](#1-완료된-개선-사항)
2. [신규 기능 개발 계획](#2-신규-기능-개발-계획)
3. [성능 최적화](#3-성능-최적화)
4. [보안 강화](#4-보안-강화)
5. [코드 품질 개선](#5-코드-품질-개선)
6. [인프라 및 DevOps](#6-인프라-및-devops)
7. [사용자 경험 개선](#7-사용자-경험-개선)
8. [구현 우선순위](#8-구현-우선순위)

---

## 1. 완료된 개선 사항

### 1.1 백엔드 코드 리팩토링

#### operations.go 분할 ✅
- **이전**: 2171줄
- **이후**: 4개 파일로 분할
  | 파일 | 줄 수 | 기능 |
  |------|-------|------|
  | `operations.go` | 1061 | Rename/Move/Copy |
  | `search.go` | 671 | 파일 검색 |
  | `storage.go` | 117 | 스토리지 사용량 |
  | `compress.go` | 356 | ZIP 압축/해제 |

#### auth.go 분할 ✅
- **이전**: 971줄
- **이후**: 3개 파일로 분할
  | 파일 | 줄 수 | 기능 |
  |------|-------|------|
  | `auth.go` | 633 | JWT, Login, Middleware |
  | `auth_user.go` | 260 | 사용자 CRUD |
  | `auth_storage.go` | 98 | 스토리지 관리 |

#### sso.go 분할 ✅
- **이전**: 952줄
- **이후**: 3개 파일로 분할
  | 파일 | 줄 수 | 기능 |
  |------|-------|------|
  | `sso.go` | 158 | 핵심 타입, 유틸리티 |
  | `sso_callback.go` | 516 | OAuth 콜백 처리 |
  | `sso_admin.go` | 297 | SSO 관리자 CRUD |

#### 에러 응답 표준화 ✅
- 모든 핸들러에서 `RespondError`, `RespondSuccess`, `RespondCreated` 사용
- `RequireClaims`, `RequireAdmin` 헬퍼 함수 적용

### 1.2 프론트엔드 리팩토링

#### FileList.tsx 개선 ✅
- **이전**: 1705줄 → **이후**: 1516줄 (189줄 감소)
- 새 hooks 추출:
  - `useToast.ts`: 토스트 알림 관리
  - `useLocalSearch.ts`: 로컬 검색 기능
  - `useFileMetadata.ts`: 파일 메타데이터 관리

#### API 클라이언트 추상화 ✅
- `ui/src/api/client.ts` 생성
- `ApiError` 클래스, `api.get/post/put/delete` 메서드
- `apiUrl` 헬퍼 (withParams, encodePath, filePath)
- 리팩토링된 API 파일:
  - `auth.ts`: 466줄 → 383줄 (17% 감소)
  - `sharedFolders.ts`, `notifications.ts`, `smb.ts`, `fileShares.ts`

#### 가상 스크롤링 ✅
- 테이블 뷰: `VirtualizedFileTable.tsx`
- 그리드 뷰: `VirtualizedFileGrid.tsx` (신규)
- 100개 이상 파일 시 자동 가상화 적용
- @tanstack/react-virtual 사용

### 1.3 테스트 코드 ✅
- **Go API 테스트**: `api/handlers/auth_test.go` (14개 테스트)
  - Login, Register, GetProfile, JWT 미들웨어 테스트
  - sqlmock을 사용한 DB mocking
- **React Hook 테스트**: Vitest + React Testing Library
  - `useToast.test.ts` (9개 테스트)
  - `useLocalSearch.test.ts` (11개 테스트)

---

## 2. 신규 기능 개발 계획

### 2.1 파일 버전 관리 (우선순위: 높음)

파일 변경 히스토리를 추적하고 이전 버전을 복원할 수 있는 기능

#### 요구사항
- 파일 저장 시 이전 버전 자동 보관
- 버전 목록 조회 (타임라인 UI)
- 특정 버전으로 복원
- 버전 간 비교 (텍스트 파일)
- 보관 정책 설정 (최대 버전 수, 보관 기간)

#### 구현 계획
```
데이터베이스:
- file_versions 테이블
  - id, file_path, version_number
  - size, hash, created_at
  - created_by, change_note

스토리지:
- /data/.versions/{hash_prefix}/{hash}
- 중복 제거 (동일 hash 재사용)

API:
- GET /api/files/versions/* - 버전 목록
- GET /api/files/versions/*/v/:version - 특정 버전 다운로드
- POST /api/files/versions/*/restore/:version - 버전 복원
- DELETE /api/files/versions/*/v/:version - 버전 삭제
```

### 2.2 고급 검색 (Elasticsearch) (우선순위: 중간)

전문 검색(Full-text search)과 고급 필터링 기능

#### 요구사항
- 파일 내용 검색 (텍스트, Office 문서)
- 고급 필터 (날짜 범위, 파일 타입, 크기)
- 검색 결과 하이라이팅
- 자동완성/추천

#### 구현 계획
```
인프라:
- Elasticsearch 8.x 컨테이너 추가
- 인덱싱 워커 (백그라운드 처리)

스키마:
- files 인덱스: path, name, content, metadata
- 한국어 형태소 분석기 (nori)

API:
- GET /api/search/advanced - 고급 검색
- GET /api/search/suggest - 자동완성
```

### 2.3 파일 암호화 (at rest) (우선순위: 중간)

저장된 파일의 암호화로 보안 강화

#### 요구사항
- 폴더 단위 암호화 설정
- 클라이언트 사이드 암호화 옵션
- 키 관리 (사용자별 키)
- 암호화된 파일 공유 시 키 전달

#### 구현 계획
```
암호화:
- AES-256-GCM (서버 사이드)
- 또는 클라이언트 사이드 E2E 암호화

키 관리:
- 마스터 키 + 파일별 키
- 키 래핑 (사용자 비밀번호 기반)

저장:
- 암호화된 파일: /data/.encrypted/{hash}
- 키 저장: encrypted_keys 테이블
```

### 2.4 댓글 및 주석 기능 (우선순위: 낮음)

파일에 댓글을 달고 협업할 수 있는 기능

#### 요구사항
- 파일별 댓글 스레드
- @멘션 기능
- 댓글 알림
- 이미지 파일의 영역 지정 주석

#### 구현 계획
```
데이터베이스:
- file_comments 테이블
  - id, file_path, parent_id (스레드)
  - user_id, content, position (좌표)
  - created_at, updated_at

API:
- GET /api/comments/* - 댓글 목록
- POST /api/comments/* - 댓글 작성
- PUT /api/comments/:id - 댓글 수정
- DELETE /api/comments/:id - 댓글 삭제
```

### 2.5 워크플로우 및 승인 (우선순위: 낮음)

파일 승인 워크플로우 기능

#### 요구사항
- 승인 요청 생성
- 다단계 승인 프로세스
- 승인/거부 알림
- 승인 이력 추적

---

## 3. 성능 최적화

### 3.1 썸네일 생성 최적화 (우선순위: 높음)

#### 현재 상태
- 동기적 썸네일 생성
- 대용량 이미지 처리 시 지연

#### 개선 방안
```go
// 비동기 썸네일 생성 워커
type ThumbnailWorker struct {
    queue chan ThumbnailJob
    cache *ThumbnailCache
}

// 우선순위 큐
// - 현재 보이는 파일 우선
// - 백그라운드에서 나머지 처리
```

#### 구현 계획
1. 썸네일 생성 워커 풀 (goroutine pool)
2. 요청 큐 (Valkey 기반)
3. 진행 상태 WebSocket 알림
4. 플레이스홀더 이미지 (생성 중 표시)

### 3.2 데이터베이스 쿼리 최적화 (우선순위: 중간)

#### 분석 필요 영역
- 대용량 파일 목록 조회
- 복잡한 ACL 검사
- 감사 로그 조회

#### 개선 방안
```sql
-- 복합 인덱스 추가
CREATE INDEX idx_files_path_type ON files(path, file_type);
CREATE INDEX idx_audit_user_time ON audit_logs(actor_id, ts DESC);

-- 쿼리 최적화
-- EXPLAIN ANALYZE 사용하여 병목 지점 분석
```

### 3.3 캐싱 전략 개선 (우선순위: 중간)

#### 현재 캐싱
- 썸네일 캐시 (디스크 + Valkey)
- 폴더 통계 캐시 (Valkey)
- 세션 캐시 (Valkey)

#### 추가 캐싱 대상
```
1. 파일 목록 캐시
   - 키: file_list:{path}:{user_id}:{page}
   - TTL: 60초 (파일 변경 시 무효화)

2. 권한 캐시
   - 키: acl:{path}:{user_id}
   - TTL: 300초

3. 공유 폴더 멤버십 캐시
   - 키: membership:{user_id}
   - TTL: 600초 (멤버십 변경 시 무효화)
```

### 3.4 프론트엔드 번들 최적화 (우선순위: 중간)

#### 현재 상태
- index.js: 1,086KB (gzip: 308KB)
- 청크 분할 경고 발생

#### 개선 방안
```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-ui': ['@tanstack/react-query', 'zustand'],
          'vendor-editor': ['@monaco-editor/react'],
          'vendor-pdf': ['react-pdf'],
        }
      }
    }
  }
})
```

---

## 4. 보안 강화

### 4.1 로그인 시도 제한 (우선순위: 높음)

#### 요구사항
- 연속 실패 시 계정 잠금
- IP 기반 속도 제한
- CAPTCHA 통합 (선택)

#### 구현 계획
```go
type LoginAttempt struct {
    FailCount int
    LastAttempt time.Time
    LockedUntil *time.Time
}

// Valkey에 시도 횟수 저장
// 키: login_attempt:{username}
// 5회 실패 시 15분 잠금
```

### 4.2 세션 관리 UI (우선순위: 중간)

#### 요구사항
- 활성 세션 목록 조회
- 원격 세션 종료
- 세션 상세 정보 (IP, User-Agent, 위치)

#### 구현 계획
```
데이터베이스:
- sessions 테이블
  - id, user_id, token_hash
  - ip_addr, user_agent
  - created_at, last_active, expires_at

API:
- GET /api/auth/sessions - 내 세션 목록
- DELETE /api/auth/sessions/:id - 세션 종료
- DELETE /api/auth/sessions/all - 모든 세션 종료 (현재 제외)
```

### 4.3 IP 화이트리스트/블랙리스트 (우선순위: 중간)

#### 요구사항
- 관리자 IP 화이트리스트
- 악성 IP 블랙리스트
- 지역 기반 차단 (GeoIP)

#### 구현 계획
```
시스템 설정:
- ip_whitelist: ["192.168.1.0/24", "10.0.0.0/8"]
- ip_blacklist: ["1.2.3.4"]
- geo_block: ["CN", "RU"] (선택)

미들웨어:
- 요청 IP 검사
- 블랙리스트 우선 적용
- 화이트리스트 바이패스
```

### 4.4 파일 바이러스 스캔 (우선순위: 낮음)

#### 요구사항
- 업로드 시 자동 스캔
- ClamAV 통합
- 감염 파일 격리

#### 구현 계획
```
인프라:
- ClamAV 컨테이너 추가
- clamd 소켓 연결

워크플로우:
1. 파일 업로드 완료
2. 스캔 큐에 추가
3. 백그라운드 스캔
4. 감염 시 격리 + 알림
```

---

## 5. 코드 품질 개선

### 5.1 API 문서화 (OpenAPI/Swagger) (우선순위: 높음)

#### 요구사항
- OpenAPI 3.0 스펙 생성
- Swagger UI 통합
- API 변경 시 자동 업데이트

#### 구현 계획
```go
// swaggo/swag 사용
// main.go에 주석 추가
// @title SimpleCloudVault API
// @version 1.0
// @description Enterprise cloud file sharing API

// 핸들러에 주석 추가
// @Summary List files
// @Tags files
// @Param path query string true "Directory path"
// @Success 200 {object} FileListResponse
```

### 5.2 E2E 테스트 (우선순위: 중간)

#### 요구사항
- 주요 사용자 시나리오 테스트
- CI/CD 통합
- 스크린샷 캡처

#### 구현 계획
```
도구: Playwright 또는 Cypress

테스트 시나리오:
1. 로그인 → 파일 업로드 → 공유 → 다운로드
2. 2FA 활성화 → 로그인 → 비활성화
3. 공유 드라이브 생성 → 멤버 추가 → 파일 작업
4. 휴지통 이동 → 복원 → 영구 삭제
```

### 5.3 타입 안전성 강화 (우선순위: 중간)

#### 현재 상태
- 일부 API 응답 타입 누락
- `any` 타입 사용 지점 존재

#### 개선 방안
```typescript
// 공통 타입 정의
// ui/src/types/

// API 응답 타입
interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
}

// 파일 타입
interface FileItem {
  name: string
  path: string
  size: number
  isDir: boolean
  modTime: string
  // ...
}

// strict 모드 활성화
// tsconfig.json: "strict": true
```

### 5.4 핸들러 추가 분할 (우선순위: 낮음)

#### 대상 파일
| 파일 | 현재 줄 수 | 목표 |
|------|-----------|------|
| `handler.go` | 1000+ | < 500 |
| `FileList.tsx` | 1516 | < 1000 |
| `AdminSharedFolders.tsx` | 1115 | < 800 |

---

## 6. 인프라 및 DevOps

### 6.1 성능 모니터링 (Prometheus/Grafana) (우선순위: 높음)

#### 요구사항
- API 응답 시간 모니터링
- 시스템 리소스 사용량
- 에러율 추적
- 알림 설정

#### 구현 계획
```yaml
# docker-compose-monitoring.yaml
services:
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"
```

```go
// Go 메트릭 수집
import "github.com/prometheus/client_golang/prometheus"

var httpRequestsTotal = prometheus.NewCounterVec(
    prometheus.CounterOpts{
        Name: "http_requests_total",
    },
    []string{"method", "endpoint", "status"},
)
```

### 6.2 로그 집계 (ELK/Loki) (우선순위: 중간)

#### 요구사항
- 중앙화된 로그 수집
- 로그 검색 및 분석
- 대시보드

#### 구현 계획
```yaml
# Loki + Grafana 스택 (경량)
services:
  loki:
    image: grafana/loki

  promtail:
    image: grafana/promtail
    volumes:
      - /var/log:/var/log
```

### 6.3 CI/CD 파이프라인 (우선순위: 중간)

#### 요구사항
- 자동 테스트 실행
- 이미지 빌드 및 푸시
- 자동 배포 (staging/production)

#### 구현 계획
```yaml
# .github/workflows/ci.yml
name: CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Go tests
        run: cd api && go test ./...
      - name: Run React tests
        run: cd ui && npm test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Build and push Docker images
        # ...
```

### 6.4 백업 및 복구 (우선순위: 높음)

#### 요구사항
- 데이터베이스 자동 백업
- 파일 스토리지 백업
- 복구 절차 문서화

#### 구현 계획
```bash
# 백업 스크립트
#!/bin/bash
# backup.sh

# PostgreSQL 백업
docker compose exec db pg_dump -U scv_user scv_main > backup_$(date +%Y%m%d).sql

# 파일 백업 (증분)
rsync -avz --delete /data/ /backup/data/

# S3 업로드 (선택)
aws s3 sync /backup s3://scv-backup/
```

---

## 7. 사용자 경험 개선

### 7.1 모바일 최적화 (우선순위: 높음)

#### 현재 상태
- 기본 반응형 디자인 적용
- 일부 터치 인터랙션 미흡

#### 개선 방안
1. 터치 제스처 지원
   - 스와이프로 삭제/공유
   - 핀치 줌 (이미지)
   - 롱 프레스 다중 선택

2. 모바일 전용 UI
   - 바텀 시트 (컨텍스트 메뉴)
   - 풀 스크린 미리보기
   - 간소화된 툴바

3. PWA 지원
   - 오프라인 캐싱
   - 설치 프롬프트
   - 푸시 알림

### 7.2 키보드 단축키 확장 (우선순위: 낮음)

#### 현재 지원
- 기본 탐색 (화살표)
- 선택 (Space, Ctrl+A)

#### 추가 계획
```
Ctrl+C: 복사
Ctrl+V: 붙여넣기
Ctrl+X: 잘라내기
Delete: 삭제
F2: 이름 변경
Ctrl+N: 새 폴더
Ctrl+U: 업로드
Ctrl+F: 검색
```

### 7.3 접근성 개선 (우선순위: 중간)

#### 요구사항
- WCAG 2.1 AA 준수
- 스크린 리더 지원
- 키보드 탐색 완전 지원
- 고대비 모드

#### 구현 계획
1. ARIA 레이블 추가
2. 포커스 관리 개선
3. 색상 대비 검증
4. 접근성 테스트 도구 통합

### 7.4 국제화 (i18n) (우선순위: 낮음)

#### 현재 상태
- 한국어 하드코딩

#### 개선 방안
```typescript
// react-i18next 사용
import { useTranslation } from 'react-i18next';

const { t } = useTranslation();

// 사용
<Button>{t('common.save')}</Button>

// 언어 파일
// locales/ko.json, locales/en.json
```

---

## 8. 구현 우선순위

### Phase 5: 단기 (1-2개월)

| 항목 | 우선순위 | 예상 공수 |
|------|----------|-----------|
| API 문서화 (Swagger) | 높음 | 1주 |
| 로그인 시도 제한 | 높음 | 3일 |
| 백업 자동화 | 높음 | 2일 |
| 모바일 최적화 | 높음 | 2주 |
| 썸네일 생성 최적화 | 높음 | 1주 |

### Phase 6: 중기 (3-4개월)

| 항목 | 우선순위 | 예상 공수 |
|------|----------|-----------|
| 파일 버전 관리 | 높음 | 3주 |
| 성능 모니터링 | 높음 | 1주 |
| E2E 테스트 | 중간 | 2주 |
| 세션 관리 UI | 중간 | 1주 |
| IP 화이트리스트 | 중간 | 3일 |

### Phase 7: 장기 (6개월+)

| 항목 | 우선순위 | 예상 공수 |
|------|----------|-----------|
| 고급 검색 (ES) | 중간 | 4주 |
| 파일 암호화 | 중간 | 4주 |
| 바이러스 스캔 | 낮음 | 2주 |
| 댓글 기능 | 낮음 | 2주 |
| 워크플로우 | 낮음 | 4주 |
| 모바일 앱 | 낮음 | 8주+ |

---

## 9. 성공 지표

| 지표 | 현재 | 목표 | 측정 방법 |
|------|------|------|-----------|
| API 응답 시간 (p95) | 측정 필요 | < 200ms | Prometheus |
| 에러율 | 측정 필요 | < 0.1% | 감사 로그 |
| 테스트 커버리지 | 낮음 | > 60% | Jest/go test |
| Lighthouse 점수 | 측정 필요 | > 80 | Chrome DevTools |
| 최대 파일 줄 수 | 1516 | < 1000 | 코드 분석 |
| TypeScript strict | 부분 | 100% | TSC |

---

## 10. 결론

SimpleCloudVault는 이미 엔터프라이즈급 기능을 갖춘 완성도 높은 프로젝트입니다.
위의 개선 계획을 통해 더욱 안정적이고 확장 가능한 시스템으로 발전시킬 수 있습니다.

**핵심 우선순위:**
1. **안정성**: 모니터링, 백업, 보안 강화
2. **사용성**: 모바일 최적화, API 문서화
3. **확장성**: 파일 버전 관리, 고급 검색
4. **유지보수성**: 테스트, 코드 품질 개선

---

*마지막 업데이트: 2026-01-02*
