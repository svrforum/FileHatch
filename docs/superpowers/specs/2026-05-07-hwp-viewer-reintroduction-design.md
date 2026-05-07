# HWP 뷰어/에디터 재도입 디자인 (v0.15.0)

**작성일**: 2026-05-07
**관련 이슈**: FileHatch #35 (HWP 도입), 외부 [edwardkim/rhwp #522](https://github.com/edwardkim/rhwp/issues/522) (race fix)
**관련 커밋**: `0ab8783` (v0.14.1 — HWP 도입 직전), `9b35dc4` (v0.14.2 — 전체 롤백)
**버전 bump**: 0.14.4 → 0.15.0

---

## 1. 배경

v0.14.0 / v0.14.1에서 도입한 rhwp 기반 HWP 뷰어/에디터를 v0.14.2 (`9b35dc4`)에서 전면 롤백했다. 롤백 사유는 rhwp v0.7.x 의 iframe 임베드 환경에서 wasm 초기화 race condition (`'ready' ping 응답이 wasm.initialize() 완료를 보장하지 않음`) 으로 `loadFile` 이 `__wbindgen_malloc undefined` 또는 timeout 으로 실패하는 문제였다.

업스트림이 PR #581 (`initPromise` 캡처 + 모든 RPC 핸들러에 `await initPromise`) 을 cherry-pick하여 main 에 반영, **v0.7.10** 으로 릴리즈 (2026-05-05). 즉, 우리가 우회 코드 (retry / fallback) 로 메꾸려던 race 의 본질 원인이 해소되었다. 이를 전제로 통합을 재도입하되, 죽은 우회 코드를 제거하여 코드를 단순화한다.

## 2. 목표 / 비목표

### In-Scope
- `0ab8783` (v0.14.1 직전 커밋) 시점 파일 구조를 베이스로 복원
- `RhwpEditor.tsx` 에서 race-회피용 죽은 코드 제거
  - `tryLoadFileWithRetry` (~30 줄), `isWbindgenRace` (~10 줄), `'ready' polling 루프` (~15 줄), `readyPollIntervalMs/readyTimeoutMs` props (~6 줄), retry 카운터 표시
- 활성화 정책: 기본 활성 + self-host `/rhwp/` (`RHWP_STUDIO_URL` env 로 override 가능)
- 로드 실패 시 에러 모달 + `[다운로드]` `[닫기]` 버튼 (자동 다운로드 제거)
- 권한 없는 사용자 (shared folder read-only) 에게 저장 버튼 미표시
- automated e2e spec 복구 + Playwright MCP 인수 테스트 (Tier 1+2)
- rhwp-studio mirror = `latest` GH Pages, Dockerfile `|| true` 제거 (mirror 실패 → 빌드 실패)

### Out-of-Scope
- `@rhwp/editor` npm wrapper 마이그레이션 — 본 사이클은 직접 postMessage 프로토콜 유지 (B1)
- rhwp-studio 자산 버전 lock — 현재 공식 버전별 호스팅 경로가 없어 lock 운용 비용이 회귀 비용보다 큼 (Q3 A)
- 자동 다운로드 fallback — race 해소 후의 실패는 진짜 신호이므로 사용자에게 명시 (Q4 A)

## 3. 아키텍처

```
┌────────────────────────────────────────────────────────────────────┐
│ FileList.tsx                                                        │
│  · double-click .hwp/.hwpx → setHwpViewingFile(file)                │
│  · isHwpSupported(ext) gate (rhwpSettings.enabled 기본 true)        │
│  · hasWritePermission 계산 → RhwpEditor 에 prop 전달                 │
└────────────────────────────────────────────────────────────────────┘
                          │ mount
                          ▼
┌────────────────────────────────────────────────────────────────────┐
│ RhwpEditor.tsx (~180 줄, v0.14.1 대비 -100 줄)                      │
│  1. iframe 로드 → 'ready' 단일 ping (timeout 30s)                    │
│  2. 인증 fetch → ArrayBuffer (PNA 회피, 부모 측 same-origin)          │
│  3. postMessage 'loadFile' 단일 호출 (재시도 없음)                    │
│  4-A. 결과 → pageCount 표시, iframe 노출                              │
│  4-B. 실패 → 에러 모달 + [다운로드] [닫기]                            │
│  Save: hasWritePermission 일 때만 버튼 → 'exportHwp' → PUT             │
└────────────────────────────────────────────────────────────────────┘
                          │ postMessage (same-origin)
                          ▼
┌────────────────────────────────────────────────────────────────────┐
│ <iframe src="/rhwp/" />                                             │
│   UI 컨테이너의 self-host (UI Dockerfile 빌드 시 mirror 수집)         │
└────────────────────────────────────────────────────────────────────┘
```

### 핵심 변경 요약

| 항목 | v0.14.1 | v0.15.0 |
|------|---------|---------|
| 활성화 정책 | opt-in (env 미설정 시 disabled) | 기본 활성 + `/rhwp/` 기본값 |
| race 회피 retry | `tryLoadFileWithRetry` (8단계) | 제거 — 단발 호출 |
| ready 확인 | polling (300ms 간격, 30s deadline) | 단일 ping (timeout 30s) |
| 로드 실패 시 | 자동 다운로드 + 토스트 | 에러 모달 + 다운로드 버튼 |
| 저장 버튼 | 항상 표시 (`!readOnly`) | `hasWritePermission` 조건 추가 |
| 베타 배지 | 표시 | 표시 (유지 — v1.0 도달 후 제거) |
| Dockerfile mirror | `wget … \|\| true` | `wget …` + 결과 검증 |

## 4. 컴포넌트 / 파일별 변경

### 4.1 `ui/src/components/RhwpEditor.tsx` (수정 — v0.14.1 베이스 단순화)

**제거**:
- `tryLoadFileWithRetry` 함수 전체
- `isWbindgenRace` 헬퍼
- `'ready' polling 루프` (`while (Date.now() < readyDeadline)`)
- `readyPollIntervalMs`, `readyTimeoutMs` props
- "재시도 N" 상태 메시지 갱신
- `onFallbackDownload` prop의 `자동 호출` (catch 절)

**리네임**:
- `onFallbackDownload` → `onDownload` (의미 변경: 사용자 클릭 시에만 호출)

**추가**:
- prop `hasWritePermission?: boolean` (default `true`)
- 에러 화면에 `[다운로드]` 버튼 (`onDownload?.()` 호출 후 `onClose()`)

**최종 메인 흐름**:
```ts
const run = async () => {
  try {
    setStatusMsg('rhwp-studio 로딩 중...')
    await sendRequest<boolean>('ready', {}, 30000)  // 단발

    setStatusMsg('파일 다운로드 중...')
    const buffer = await fetchAuthenticated(filePath)

    setStatusMsg('한글 문서 로드 중...')
    const result = await sendRequest<{pageCount:number}>(
      'loadFile', { data: Array.from(new Uint8Array(buffer)), fileName }, 15000
    )
    setPageCount(result.pageCount)
    setLoadState('ready')
  } catch (err) {
    setErrorMsg(humanizeError(err))
    setLoadState('error')
    onError?.(err.message)
  }
}
```

### 4.2 `ui/src/components/FileList.tsx` (수정 — v0.14.1 베이스 + 권한 흐름)

- `getRhwpSettings()` 1회 fetch + `rhwpSettings` 상태 (v0.14.1 동일)
- 더블클릭 분기: `else if (rhwpSettings?.enabled && isHwpSupported(file.extension))` → `setHwpViewingFile(file)` (v0.14.1 동일)
- 모달 마운트 시:
  ```tsx
  {hwpViewingFile && rhwpSettings && (
    <RhwpEditor
      filePath={hwpViewingFile.path}
      fileName={hwpViewingFile.name}
      studioUrl={rhwpSettings.studioUrl}
      hasWritePermission={resolveWritePermission(hwpViewingFile)}
      onClose={() => setHwpViewingFile(null)}
      onError={(msg) => showError(msg)}
      onSaved={() => { showInfo('저장되었습니다'); refresh() }}
      onDownload={() => downloadFileDirect(hwpViewingFile.path, hwpViewingFile.name)}
    />
  )}
  ```
- `resolveWritePermission(file)` 정의:
  ```ts
  function resolveWritePermission(file: FileInfo): boolean {
    if (!currentPath.startsWith('/shared/')) return true
    const folderName = currentPath.substring(8).split('/')[0]  // /shared/{name}/...
    const folder = sharedFolders.find(f => f.name === folderName)  // SharedFolderWithPermission[]
    if (!folder) return true  // 데이터 없으면 백엔드 검증에 의존 (안전 측 폐기 X)
    return folder.permissionLevel === PERMISSION_READ_WRITE  // 2 = read-write
  }
  ```
  `useSharedFolders()` 훅이 이미 `FileList.tsx:105` 에서 사용 중이므로 추가 fetch 없음. `sharedFolders` 가 빈 배열이거나 매칭되지 않을 경우 `true` 반환 (저장 버튼 표시) — 클릭 시 백엔드 403 으로 차단되며 토스트 표시. 보수적 차단보다 가용성 우선.

### 4.3 `ui/src/components/filelist/ContextMenu.tsx` (복원)
- props: `onHwpOpen?`, `isHwpSupported`
- 항목: "한글로 열기" — HWP/HWPX 한정 표시

### 4.4 `ui/src/api/files.ts` (복원)
- `RhwpSettings` interface
- `getRhwpSettings()` — `GET /api/rhwp/settings`
- `isHwpSupported(ext)` — `.hwp`/`.hwpx` 검사
- `saveBinaryFileContent(path, bytes, mime)` — `PUT /api/files/content/*`

### 4.5 `ui/src/utils/fileIcons.tsx` (복원)
- HWP/HWPX SVG 아이콘 블록

### 4.6 `api/handlers/rhwp.go` (수정 — 기본값 변경)

```go
func (h *Handler) GetRhwpSettings(c echo.Context) error {
    studioURL := strings.TrimSpace(os.Getenv("RHWP_STUDIO_URL"))
    if studioURL == "" {
        // v0.15.0: race 해소로 기본 활성, self-host /rhwp/ 사용
        studioURL = "/rhwp/"
    }
    if !strings.HasSuffix(studioURL, "/") {
        studioURL += "/"
    }
    return c.JSON(http.StatusOK, map[string]any{
        "enabled":   true,
        "studioUrl": studioURL,
    })
}
```

(`enabled: false` 분기 제거 — 항상 `true`)

### 4.7 `api/main.go` (복원)
- `e.GET("/api/rhwp/settings", h.GetRhwpSettings)` 라우트 등록

### 4.8 `api/handlers/rhwp_test.go` (수정)
- 기본값 `/rhwp/` 케이스 추가
- env override 케이스 유지 (절대 URL, 상대 URL, trailing slash 정규화)
- `enabled: false` 케이스 삭제 (해당 분기 사라짐)

## 5. 인프라

### 5.1 `ui/Dockerfile`
v0.14.1 의 `rhwp-mirror` stage 복원 + 강화:

```dockerfile
FROM alpine:latest AS rhwp-mirror
RUN apk add --no-cache wget
WORKDIR /rhwp-mirror
RUN mkdir -p /out/rhwp && \
    wget --quiet --recursive --no-parent \
         --reject "*.html?*,*.html?" \
         --directory-prefix=/out/rhwp \
         --no-host-directories \
         --cut-dirs=1 \
         https://edwardkim.github.io/rhwp/
# 검증: 핵심 파일이 mirror 되었는지 확인 (실패 시 빌드 실패)
RUN test -f /out/rhwp/index.html && \
    test -d /out/rhwp/assets && \
    ls /out/rhwp/assets/*.js /out/rhwp/assets/*.css >/dev/null
```

`|| true` 제거 → mirror 실패가 빌드를 통과시키지 않음.

`COPY --from=rhwp-mirror /out/rhwp ./rhwp-studio` 단계 (UI 최종 stage) 동일.

### 5.2 `ui/server.cjs`
v0.14.1 의 `/rhwp/*` 정적 서빙 복원:
```js
const rhwpStudioDir = path.join(__dirname, 'rhwp-studio');
if (fs.existsSync(rhwpStudioDir)) {
  app.use('/rhwp', express.static(rhwpStudioDir, {
    fallthrough: false,
    maxAge: '1d',
  }));
}
```

### 5.3 `ui/vite.config.ts`
PWA SW `navigateFallbackDenylist` 에 패턴 복원:
```ts
navigateFallbackDenylist: [/^\/api/, /^\/rhwp/, /^\/rhwp-studio/, ...]
```

### 5.4 `docker-compose.yml` / `docker-compose-dev.yaml`
API 서비스에 env 복원:
```yaml
environment:
  - RHWP_STUDIO_URL=${RHWP_STUDIO_URL:-}
```
미설정 시 백엔드가 자동으로 `/rhwp/` 기본값 응답.

### 5.5 `ui/package.json`
**`@rhwp/editor` 의존성 추가하지 않음** (B1 결정 — wrapper 미사용). bundle 부풀리기 방지.

### 5.6 `docs/specs/features/preview-editing.md`
HWP 섹션 복원 + v0.15.0 정책 반영 (기본 활성, `/rhwp/` 기본 URL, race 해소 사실).

## 6. 에러 핸들링

`loadState`: `'loading' | 'ready' | 'error'`

```
loading 상태 메시지:
  - 'rhwp-studio 로딩 중...' (ready ping 대기 중)
  - '파일 다운로드 중...'    (인증 fetch 진행 중)
  - '한글 문서 로드 중...'   (loadFile 진행 중)

ready: iframe 표시

error: 에러 화면
  ┌────────────────────────────────────┐
  │   [⚠]                              │
  │                                    │
  │   한글 문서를 열 수 없습니다.        │
  │   {errorMsg}                        │
  │                                    │
  │   [다운로드]      [닫기]            │
  └────────────────────────────────────┘
```

### 메시지 분류 (`humanizeError`)

| 원본 에러 | 사용자 메시지 |
|-----------|---------------|
| `fetch ... HTTP 401/403` | 파일에 접근할 권한이 없습니다. |
| `fetch ... HTTP 404` | 파일을 찾을 수 없습니다. |
| `fetch ... HTTP 5xx` | 서버에서 파일을 가져오는 중 오류가 발생했습니다. |
| `Request timeout: ready` | 한글 뷰어가 응답하지 않습니다. 브라우저를 새로고침해 주세요. |
| `Request timeout: loadFile` | 한글 문서 처리 시간이 초과되었습니다. |
| 그 외 (`error.message` 보존) | 한글 문서를 처리할 수 없습니다. (원본 메시지 보조 표시) |

`onError(message)` 콜백은 부모에서 토스트로 표시 (v0.14.1 동일).

## 7. 테스팅

### 7.1 Backend (Go)
`api/handlers/rhwp_test.go`:
- `TestGetRhwpSettings_DefaultsToLocalMirror` — env 미설정 시 `studioUrl="/rhwp/"`, `enabled=true`
- `TestGetRhwpSettings_EnvOverride` — `RHWP_STUDIO_URL=https://example.com/rhwp/` 시 그대로 응답
- `TestGetRhwpSettings_AppendsTrailingSlash` — `RHWP_STUDIO_URL=https://example.com/rhwp` (slash 없음) 시 자동 추가

기존 핸들러 테스트는 회귀 없음 확인.

### 7.2 Frontend Unit (Vitest)
`ui/src/components/__tests__/RhwpEditor.test.tsx`:
- 정상 흐름: `ready ping → fetch → loadFile → ready 상태 + pageCount 표시`
- `ready` timeout → `error` 상태 + `[다운로드]` 버튼 렌더
- `fetch` 실패 (401/404/5xx) → 메시지별 `humanizeError` 매핑
- `loadFile` 실패 (단발 — retry 없음) → `error` 상태
- `hasWritePermission=false` → 저장 버튼 미렌더
- `hasWritePermission=true` + `loadState='ready'` → 저장 버튼 활성
- ESC 키: 미편집 즉시 close, 편집 후 confirm prompt
- Ctrl+S: 저장 호출, 저장 중 비활성

`ui/src/api/__tests__/files.hwp.test.ts`:
- `getRhwpSettings` 응답 파싱
- `isHwpSupported` 케이스 (대문자/소문자/.hwp/.hwpx/.docx)
- `saveBinaryFileContent` 요청 형성 (PUT, mime, body)

### 7.3 Frontend E2E Spec (CI 자동화)
`tests/e2e/files/hwp-viewer.spec.ts`:
- T1: `.hwp` 더블클릭 → 모달 오픈 → `[role=dialog]` + 페이지 수 표시
- T2: `.hwpx` 더블클릭 → 동일
- T3: 편집 후 Ctrl+S → 저장 토스트 → 모달 재오픈 시 변경 보존
- T4: ESC 미편집 → 즉시 닫힘 / ESC 편집 후 → confirm
- T5: ✕ 닫기
- T6: `.txt` 파일 더블클릭 → 모달 안 열림 (회귀 차단)
- T7: 의도적 깨진 파일 (또는 권한 차단) → 에러 모달 + `[다운로드]` 동작
- T12 (Tier3): 모바일 뷰포트 (375×667) → 모달 가시성
- T13 (Tier3): SW 가 `/rhwp/*` 가로채지 않음 (network response 검증)

Fixture: `tests/e2e/fixtures/sample.hwp` — rhwp upstream `samples/KTX.hwp` 사용 (rhwp 저장소 MIT, 짧고 단순한 공공 문서). 가져오는 명령:
```bash
curl -L -o tests/e2e/fixtures/sample.hwp \
  "https://raw.githubusercontent.com/edwardkim/rhwp/main/samples/KTX.hwp"
```
fixture 디렉토리 내에 출처/라이선스 표기 (`tests/e2e/fixtures/SAMPLES_README.md`). 손상 fixture 가 필요한 시나리오 (T7) 는 `sample.hwp` 의 첫 100바이트만 잘라낸 `corrupted.hwp` 를 사용 — 별도 다운로드 불필요, fixture 생성 스크립트로 처리.

### 7.4 Playwright MCP 인수 테스트 (1회 수동, 본 세션)
구현 완료 직후 본 Claude Code 세션에서 Playwright MCP (`mcp__plugin_playwright_playwright__*`) 로 직접 수행.

**범위: Tier 1+2 (총 11 시나리오)**

| # | Tier | 시나리오 |
|---|------|---------|
| 1 | 1 | `.hwp` 더블클릭 → 모달 오픈 → 로딩 → 페이지 수 표시 |
| 2 | 1 | `.hwpx` 더블클릭 → 동일 동작 |
| 3 | 1 | 편집 후 Ctrl+S → 저장 → 재오픈 시 변경 보존 |
| 4 | 1 | ESC 미편집 → 즉시 닫힘 / 편집 후 ESC → confirm |
| 5 | 1 | ✕ 닫기 버튼 → 닫힘 |
| 6 | 1 | Non-HWP (.txt) 더블클릭 → 모달 안 열림 (회귀) |
| 7 | 1 | 로드 실패 (의도적 손상 파일) → 에러 모달 + 다운로드 버튼 동작 |
| 8 | 2 | shared folder read-only 멤버 → 저장 버튼 미표시 |
| 9 | 2 | 컨텍스트 메뉴 "한글로 열기" — HWP만, 그 외 부재 |
| 10 | 2 | `RHWP_STUDIO_URL` 미설정 — 기본 `/rhwp/` 동작 |
| 11 | 2 | 다중 파일: A 열기 → 닫기 → B 열기 (state 잔여 없음) |

각 시나리오 절차:
```
1. browser_navigate → 로그인 → HWP 폴더 이동
2. browser_click / browser_press_key 로 액션
3. browser_snapshot 으로 결과 확인
4. browser_console_messages 로 콘솔 에러 없음 확인
```

결과 보고: 시나리오별 ✓/✗ + 이슈 발견 시 즉시 수정 후 재검증.

### 7.5 게이팅 룰 (사용자 명시 요구)
1. 7.1 ~ 7.4 모두 통과
2. **그 후에도 자동 commit / push / 릴리즈 금지**
3. 사용자 명시적 승인 후에만 commit / push / release 단계 진입

## 8. 작업 순서

1. v0.14.1 시점 파일들 cherry-pick: `git checkout 0ab8783 -- <list>`
2. `RhwpEditor.tsx` B1 단순화 (retry/polling 제거, `onDownload` 리네임, `hasWritePermission` prop 추가)
3. `FileList.tsx` 에 `hasWritePermission` 흐름 + `onDownload` 핸들러
4. `api/handlers/rhwp.go` 기본값 `/rhwp/` 변경
5. `ui/Dockerfile` `|| true` 제거 + mirror 검증 step
6. 단위 테스트 갱신 (B1 변경 반영)
7. e2e spec 복구 + sample.hwp fixture 복원
8. Docker 빌드 (api + ui 모두) + 부팅 헬스체크 (`curl /health`, `curl /api/version`, `curl /rhwp/`)
9. **Playwright MCP Tier 1+2 인수 테스트 11 시나리오**
10. 결과 보고 → 사용자 승인 대기

## 9. 버전 / 릴리즈 (사용자 승인 후)

- `api/version.go`: `0.14.4` → `0.15.0`
- `ui/package.json`: `0.14.4` → `0.15.0`
- `docs/specs/features/preview-editing.md` 업데이트
- 사용자 승인 후에만 commit + tag + push (CLAUDE.md 릴리즈 체크리스트 따름)

## 10. 리스크 & 완화

| 리스크 | 완화 |
|--------|------|
| 업스트림 GH Pages 회귀 (latest mirror) | v0.14.2 롤백 절차 검증됨 → 빠른 대응. 빌드 시 mirror 핵심 파일 검증으로 부분 차단 |
| `/rhwp/` 정적 서빙 미설정 환경 | server.cjs 가 `fs.existsSync` 체크 후 라우트 등록. UI Dockerfile mirror stage 가 표준 빌드의 일부이므로 누락 시 빌드 실패 |
| sample.hwp 라이선스 | rhwp upstream 의 공개 샘플 사용 시 라이선스 확인 후 attribution 추가 |
| Playwright MCP 환경 차이 | 로컬 dev 컨테이너 사용 (CLAUDE.md 메모리: OnlyOffice는 `--profile office` 별도 기동). 본 작업은 OnlyOffice 무관 |

## 11. 참고

- 외부 이슈 fix: [edwardkim/rhwp#522](https://github.com/edwardkim/rhwp/issues/522), [PR#581](https://github.com/edwardkim/rhwp/pull/581)
- 본 저장소 관련 이슈: [#35](https://github.com/svrforum/FileHatch/issues/35) (HWP 도입), [#36](https://github.com/svrforum/FileHatch/issues/36) (직전 폴더 업로드 fix)
- 롤백 커밋 본문: `9b35dc4` (제거 범위 / 한계점 / 후속 절차)
