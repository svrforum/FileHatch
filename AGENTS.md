# AGENTS.md

## 목적
이 파일은 이 저장소에서 AI/사람이 작업할 때 먼저 읽는 작업 지도다. 목표는 빠른 수정이 아니라, 요청 범위 안에서 계획-문서화-구현-검증 흐름을 지키며 기존 동작을 깨지 않는 것이다.

## 저장소 지도
- 백엔드 진입점: `api/main.go`
- HTTP/API 구현: `api/handlers/` (인증, 파일·폴더, 공유, 관리자, WebDAV, SSO, 알림 등)
- DB 연결·마이그레이션: `api/database/`, `api/database/migrations/`
- 백엔드 API 문서 산출물: `api/docs/`
- 프론트엔드 진입점: `ui/src/main.tsx`, `ui/src/App.tsx`
- 프론트엔드 화면: `ui/src/components/` (`Admin*.tsx` 관리자 화면, `filelist/` 파일 목록 하위 컴포넌트)
- 프론트엔드 상태·통신·공통 로직: `ui/src/stores/`, `ui/src/api/`, `ui/src/hooks/`, `ui/src/contexts/`, `ui/src/utils/`
- 프론트엔드 스타일: `ui/src/styles/`, `ui/src/components/*.css`
- 프론트엔드 빌드·서버: `ui/vite.config.ts`, `ui/server.cjs`, `ui/Dockerfile`
- Samba 사이드카: `samba/` (`entrypoint.sh`, `smb.conf.template`, `Dockerfile`)
- 컨테이너 구성: `docker-compose.yml`(배포 이미지), `docker-compose-dev.yaml`(로컬 소스 빌드), `docker-compose-sso.yaml`(SSO 확장)
- 테스트: `api/**/*_test.go`, `ui/src/**/*.test.*`, `tests/e2e/`(Playwright)
- 문서·계획: `docs/specs/`, `docs/plans/`, `docs/superpowers/`
- 운영·설치 스크립트: `scripts/`
- 런타임 데이터·설정: `data/`, `database/`, `config/`, `logs/` (소스 코드와 구분하고 변경 시 데이터 보존 주의)

## 기본 작업 흐름
사용자가 계획 기반 작업, 기능 구현, 운영 절차 변경, 구조 변경을 요청하면 아래 순서로 진행한다.

1. 계획: `rg`로 관련 파일/호출 경로를 먼저 찾고, 기존 구현 재사용 가능성을 확인한다.
2. 문서화: 실행 계획을 `docs/active/YYYY-MM-DD_<task>_plan.md`에 작성한다.
3. 코드 구현: 문서화된 계획 범위 안에서 최소 변경으로 구현한다.
4. 검증: 문법 검사, 로그 확인, 수동 검증 결과를 `logs/YYYY-MM-DD_<task>_<check>.log`에 남긴다. 로그에는 실행 명령, 검증 대상 파일, 확인한 동작, 결과, 실패 시 원인과 다음 조치를 반드시 포함한다.
5. 완료 정리: 구현이 끝난 계획 문서는 `docs/complete/`로 이동하고, 계획 대비 실제 변경 사항과 검증 결과를 사용자에게 보고한다.

단순 오타, 작은 CSS 조정, 명확한 1파일 수정은 사용자가 별도 계획을 요청하지 않은 경우 문서화를 생략할 수 있다. 다만 실행/배포/운영 가이드가 필요한 작업은 먼저 `docs/active/`에 문서화한 뒤 구현한다.

## 문서화 규칙
- `docs/active/`: 진행 중 계획, 설계 메모, 실행 가이드를 저장한다.
- `docs/complete/`: 구현 완료 후 확정된 문서를 이동한다.
- 문서에는 목적, 대상 파일, 구현 단계, 검증 방법, 롤백 고려사항을 짧게 기록한다.
- 계획 문서는 추상적인 목표만 쓰지 말고, 파일별로 어떤 함수/라우트/템플릿/문구를 바꿀지와 변경 후 확인할 동작을 명시한다.
- 구현이 끝난 뒤에는 계획 문서에 실제 수정 결과를 보강하거나 완료 문서로 옮기면서 변경된 항목을 정확히 남긴다.
- 문서화되지 않은 실행 가이드로 코드나 설정을 바꾸지 않는다. 필요한 내용이 없으면 먼저 문서부터 작성한다.
- 문서와 사용자 노출 문구는 한국어를 기본으로 한다.
- 환경변수 추가/변경, 기능 게이트 기본값 변경, 스케줄러 자동기동 정책 변경 시에는 로컬 `.env`와 운영 환경 설정 파일(`DOCKGE_compose.yaml` 등 실제 배포 설정) 반영 여부를 문서에 분리해 기록한다.

## 검증 로그 규칙
- 검증 로그는 `logs/`에 저장한다.
- 파일명 예: `logs/2026-04-28_admin_email_css_node-check.log`
- 로그에는 실행 명령, 대상 파일, 성공/실패 결과, 실패 시 원인과 다음 조치를 남긴다.
- 문법 검사 로그는 `무엇을 검사했는지`, `어떤 파일이 통과했는지`, `어떤 경고가 남았는지`까지 적는다.
- 수동 검증 로그는 `입력값`, `재현 절차`, `기대 결과`, `실제 결과`, `남은 리스크`를 적는다.
- 민감 정보, 토큰, 비밀번호, 개인정보가 로그에 남지 않도록 마스킹한다.
- Docker 확인이 필요하면 `docker compose logs --tail=120 web`처럼 범위를 제한한다.

## 개발/실행 명령
- `docker compose up -d`: PostgreSQL + Flask 컨테이너 실행
- `docker compose up -d --build`: 이미지 재빌드 후 실행
- `docker compose logs -f web`: 웹 앱 로그 확인
- `docker compose down`: 로컬 스택 종료
- `python -m venv venv; .\venv\Scripts\activate; pip install -r requirements.txt`: Windows 로컬 환경 구성
- `python app.py`: 비도커 로컬 실행(DB 설정 필요)

## 코드 스타일
- Python: PEP 8, 4칸 들여쓰기, `snake_case`/`UPPER_CASE`
- Flask Blueprint는 도메인 단위로 유지한다.
- 신규 로직은 기존 `blueprints + services + templates/.../sections + static` 패턴을 우선 따른다.
- CSS/JS는 인라인보다 `static/css`, `static/js` 파일로 분리한다.
- 템플릿/정적 파일 이름은 기존 `snake_case` 또는 `kebab-case` 규칙을 따른다.
- 사용자 노출 문구, 주석, 문서화 설명은 한국어 일관성을 유지한다.
- 한글 저장 시 UTF-8을 사용하고, 문자열 종료/이스케이프/인코딩 깨짐을 재확인한다.

## Skills 사용 기준
- Go 구현/리뷰: `golang-code-style`
- Go 테스트 작성/개선: `golang-testing`
- Go 인증·파일 경로·네트워크·DB 보안 검토: `golang-security`
- React 컴포넌트 구현/성능 개선: `vercel-react-best-practices`
- Playwright E2E 테스트 작성/디버깅: `playwright-best-practices`
- 브라우저 기반 수동 UI 검증: `playwright`
- Python 구현/리뷰: `python-expert`
- 보안/품질/PR 리뷰: `code-reviewer`
- 데이터 분석/SQL/pandas: `data-analyst`
- UI/UX 개선/반응형/접근성: `ui-ux-pro-max`
- 사용자 흐름/정보 구조/UX 리서치: `ux-designer`
- 블로그·소개·마케팅 콘텐츠 작성: `content-creator`
- 큰 작업 분해/로드맵: `project-planner`

작업과 직접 관련된 Skill만 사용한다. Skill 지침이 현재 코드베이스와 충돌하면 저장소 패턴과 사용자 요청을 우선한다.

## 구현 전 체크리스트
1. `rg`로 관련 라우트, 템플릿, JS, CSS, 서비스 호출을 찾는다.
2. 기존 함수/유틸/핸들러 재사용 가능성을 확인한다.
3. 변경 범위를 사용자 요청에 맞게 제한한다.
4. 필요한 경우 `docs/active/`에 계획 문서를 먼저 만든다.
5. 파일 인코딩과 한글 문자열 위험 구간을 확인한다.
6. 환경변수/시크릿/자동기동 플래그를 추가하거나 기본값을 바꾸는 작업이면 `.env`, compose, 배포 설정 중 어떤 파일을 함께 갱신해야 하는지 먼저 적는다.

## 구현 후 검증
- JS: `node --check <file>`
- Python: `python -m py_compile <file>`
- Docker: `docker compose ps`, `docker compose logs --tail=120 web`
- UI 변경: 화면 동작, 모바일/데스크톱 레이아웃, 텍스트 겹침, 캐시 영향(`?v=` 필요 여부)
- DB/업로드 변경: 마이그레이션 영향, 파일 경로, 권한, 용량 제한
- 환경변수/스케줄러 변경: `.env` 반영 여부, 운영 설정 반영 여부, 앱 시작 로그, 후속 실행 로그를 각각 확인하고 로그에 남긴다.
- 검증 결과는 가능한 한 `logs/`에 남기고 최종 답변에 요약한다.
- 최종 답변에는 수정한 파일과 실제 변경 내용을 함께 적어, 계획 문서와 로그만 보고도 무엇이 바뀌었는지 추적 가능해야 한다.

## 강제 금지 사항
- 요청 범위 밖 대규모 리팩터링, 전면 포맷팅, 관련 없는 파일 변경 금지
- 확인되지 않은 추측성 수정 금지
- 사용자 변경분 되돌리기 금지
- 민감 정보 하드코딩 금지
- 실행/배포/운영 절차를 문서화 없이 변경 금지
- 검증 없이 완료 보고 금지
- 전역 네임스페이스(`window`) 오염을 유발하는 신규 공통 함수 추가 금지
- 인라인 CSS/JS 남발 금지
- 파괴적 명령(`git reset --hard`, 무차별 삭제 등) 금지

## 커밋/PR 기준
- 커밋은 한 가지 논리 변경만 포함한다.
- 제목 권장 형식: `영역: 변경내용` (예: `admin: 세션 만료 처리 수정`)
- PR에는 변경 목적, 주요 파일, 검증 방법, UI 변경 시 스크린샷, 관련 이슈를 포함한다.
