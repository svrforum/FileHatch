# HWP 뷰어/에디터 재도입 (v0.15.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v0.14.2 에서 롤백한 rhwp 기반 HWP 뷰어/에디터를 upstream race fix (rhwp v0.7.10) 전제로 재도입한다. v0.14.1 코드를 베이스로 죽은 race-회피 코드를 제거하고 (B1), 기본 활성화 + self-host `/rhwp/`, 로드 실패 시 명시적 에러 모달로 UX 개선한다.

**Architecture:** 부모(우리) ↔ iframe (`/rhwp/`, UI 컨테이너 self-host) 간 직접 postMessage RPC. 부모 측 인증 fetch 후 ArrayBuffer 를 iframe 으로 전달 (PNA 회피). v0.14.1 에 있던 wbindgen race 회피 retry/polling 코드 제거 — upstream 이 `'ready'` 응답이 wasm 초기화 완료를 보장하도록 fix 했으므로 단발 호출로 충분.

**Tech Stack:** Go (Echo 핸들러), React + TypeScript (RhwpEditor 컴포넌트), Vitest (단위), Playwright (e2e), Docker (rhwp-studio mirror stage).

**🚨 사용자 제약 (절대 준수)**

1. **자동 commit / push / 릴리즈 금지**. 모든 task 중간에 `git commit` 호출하지 않음. 변경은 작업 트리에 누적.
2. 모든 task 완료 후 → Docker 빌드 → unit/lint 통과 → e2e spec 통과 → **Playwright MCP 인수 테스트 (Tier 1+2, 11 시나리오) 직접 수행**.
3. 결과 보고 → 사용자 명시 승인 → 그 후에만 commit / push / 태그 단계.

**베이스 커밋:**
- v0.14.1 (HWP 안정화 직전): `0ab8783`
- 현재 main: `cf51cc0` (spec commit)
- 롤백: `9b35dc4`
- HWP 도입한 첫 commit: `62c85d7` (api/main.go 라우트 + handler)

**현재 main 상태 검증 결과 (이미 완료됨):**
- `9b35dc4` → 현재까지 변경된 파일은 `ui/package.json`/`package-lock.json` (버전 bump + @rhwp/editor 제거)뿐
- 따라서 다른 모든 파일은 `git checkout 0ab8783 -- <file>` 으로 깔끔하게 v0.14.1 상태 복원 가능

---

## File Structure

### 새로 생성 (cherry-pick from `0ab8783`)
| Path | Responsibility |
|------|----------------|
| `api/handlers/rhwp.go` | `GetRhwpSettings` 핸들러 (env 기반 studioUrl 응답) |
| `api/handlers/rhwp_test.go` | 핸들러 테스트 (default, env override, trailing slash) |
| `ui/src/components/RhwpEditor.tsx` | iframe 임베드 + postMessage RPC 모달 (B1 단순화 적용) |
| `ui/src/components/RhwpEditor.css` | 모달 스타일 |
| `ui/src/components/__tests__/RhwpEditor.test.tsx` | RhwpEditor 단위 테스트 (B1 변경 반영) |
| `ui/src/api/__tests__/files.hwp.test.ts` | files.ts HWP 헬퍼 테스트 |
| `tests/e2e/files/hwp-viewer.spec.ts` | e2e spec (Tier 1+3 자동화) |
| `tests/e2e/fixtures/sample.hwp` | 테스트용 HWP (rhwp upstream `samples/KTX.hwp`) |
| `tests/e2e/fixtures/SAMPLES_README.md` | fixture 출처/라이선스 |
| `tests/e2e/fixtures/corrupted.hwp` | 손상 fixture (sample.hwp 첫 100바이트 자른 파일) |

### 수정 (`git checkout 0ab8783 -- <file>` 으로 v0.14.1 복원, 그 다음 추가 패치)
| Path | Patch |
|------|-------|
| `api/main.go` | `/api/rhwp/settings` 라우트 등록 |
| `ui/src/api/files.ts` | `RhwpSettings` interface, `getRhwpSettings`, `isHwpSupported`, `saveBinaryFileContent` 추가 |
| `ui/src/components/FileList.tsx` | rhwp settings fetch + 더블클릭 분기 + RhwpEditor mount + `hasWritePermission` 흐름 |
| `ui/src/components/filelist/ContextMenu.tsx` | `onHwpOpen`, `isHwpSupported` props 추가 |
| `ui/src/utils/fileIcons.tsx` | HWP/HWPX SVG 아이콘 |
| `ui/Dockerfile` | rhwp-mirror stage 복원 + `\|\| true` 제거 + 검증 step |
| `ui/server.cjs` | `/rhwp/*` 정적 서빙 |
| `ui/vite.config.ts` | PWA SW `navigateFallbackDenylist` 추가 |
| `docker-compose.yml`, `docker-compose-dev.yaml` | `RHWP_STUDIO_URL=${RHWP_STUDIO_URL:-}` env |
| `docs/specs/features/preview-editing.md` | HWP 섹션 + v0.15.0 정책 |

### B1 단순화 (cherry-pick 후 추가 수정)
| Path | Change |
|------|--------|
| `ui/src/components/RhwpEditor.tsx` | retry/polling 제거, `onFallbackDownload`→`onDownload`, `hasWritePermission` prop, 에러 화면 다운로드 버튼 |
| `ui/src/components/__tests__/RhwpEditor.test.tsx` | 새 동작 반영, retry 테스트 삭제 |
| `api/handlers/rhwp.go` | env 미설정 시 default `/rhwp/` (현재는 `enabled: false`) |
| `api/handlers/rhwp_test.go` | default 케이스 갱신, `enabled:false` 케이스 삭제 |
| `ui/src/components/FileList.tsx` | `resolveWritePermission` + `onDownload` 핸들러 |

### 버전 bump (마지막에)
| Path | Change |
|------|--------|
| `api/version.go` | `0.14.4` → `0.15.0` |
| `ui/package.json` | `0.14.4` → `0.15.0` |
| `ui/package-lock.json` | `npm install` 으로 재생성 |

---

## Task 1: Backend handler cherry-pick + default `/rhwp/` 변경

**Files:**
- Create: `api/handlers/rhwp.go`
- Create: `api/handlers/rhwp_test.go`
- Modify: `api/main.go` (line 397 부근)

- [ ] **Step 1: v0.14.1 핸들러 + 테스트 cherry-pick**

```bash
git checkout 0ab8783 -- api/handlers/rhwp.go api/handlers/rhwp_test.go
```

확인:
```bash
ls -l api/handlers/rhwp.go api/handlers/rhwp_test.go
```
파일 두 개가 존재해야 함.

- [ ] **Step 2: 테스트 갱신 — default = `/rhwp/`**

`api/handlers/rhwp_test.go` 의 default 케이스 (env 미설정 시) 가 현재는 `enabled: false`, `studioUrl: ""` 응답을 검증한다. v0.15.0 에서는 `enabled: true`, `studioUrl: "/rhwp/"` 로 바뀐다. 다음 테스트 코드로 교체:

```go
package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
)

func newRhwpHandler() *Handler { return &Handler{} }

func TestGetRhwpSettings_DefaultsToLocalMirror(t *testing.T) {
	t.Setenv("RHWP_STUDIO_URL", "")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/rhwp/settings", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := newRhwpHandler().GetRhwpSettings(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["enabled"] != true {
		t.Errorf("enabled = %v, want true", body["enabled"])
	}
	if body["studioUrl"] != "/rhwp/" {
		t.Errorf("studioUrl = %v, want /rhwp/", body["studioUrl"])
	}
}

func TestGetRhwpSettings_EnvOverride(t *testing.T) {
	t.Setenv("RHWP_STUDIO_URL", "https://example.com/rhwp/")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/rhwp/settings", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := newRhwpHandler().GetRhwpSettings(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var body map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body["enabled"] != true {
		t.Errorf("enabled = %v, want true", body["enabled"])
	}
	if body["studioUrl"] != "https://example.com/rhwp/" {
		t.Errorf("studioUrl = %v", body["studioUrl"])
	}
}

func TestGetRhwpSettings_AppendsTrailingSlash(t *testing.T) {
	t.Setenv("RHWP_STUDIO_URL", "https://example.com/rhwp")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/rhwp/settings", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	_ = newRhwpHandler().GetRhwpSettings(c)

	var body map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if !strings.HasSuffix(body["studioUrl"].(string), "/") {
		t.Errorf("studioUrl missing trailing slash: %v", body["studioUrl"])
	}
}
```

> **Note**: `Handler` 구조체가 v0.14.1 시점과 현재 시점 간에 시그니처가 다를 수 있다. 빌드 실패 시 `newRhwpHandler()` 의 필드 초기화를 현재 다른 핸들러 테스트의 패턴 (`api/handlers/*_test.go`) 에 맞춰 보강하라.

- [ ] **Step 3: 테스트 실행 → 실패 확인 (RED)**

```bash
sudo docker compose -f docker-compose-dev.yaml exec -T api sh -c "cd /app && go test ./handlers/ -run TestGetRhwpSettings -v"
```

기대: 컴파일 실패 또는 `enabled = false, want true` 같은 메시지 (현재 핸들러는 default 가 `enabled: false`).

- [ ] **Step 4: 핸들러 default 갱신**

`api/handlers/rhwp.go` 의 `GetRhwpSettings` 함수에서 env 미설정 분기 변경. 함수 전체를 다음으로 교체:

```go
func (h *Handler) GetRhwpSettings(c echo.Context) error {
	studioURL := strings.TrimSpace(os.Getenv("RHWP_STUDIO_URL"))
	if studioURL == "" {
		// v0.15.0: race 해소로 기본 활성, UI 컨테이너 self-host /rhwp/ 사용
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

함수 위 doc comment 도 갱신:
```go
// GetRhwpSettings returns rhwp HWP viewer/editor configuration for the frontend.
//
// **v0.15.0**: rhwp v0.7.10 의 wasm 초기화 race fix (PR #581 by @oksure) 가 반영되어
// 기본 활성화로 환원. RHWP_STUDIO_URL 미설정 시 UI 컨테이너 self-host `/rhwp/` 를 사용.
//
// 환경변수 override 예:
//   RHWP_STUDIO_URL=https://edwardkim.github.io/rhwp/   # 외부 CDN (PNA 환경 비권장)
//   RHWP_STUDIO_URL=https://my-internal-host/rhwp/      # 내부 self-host
func (h *Handler) GetRhwpSettings(c echo.Context) error {
```

- [ ] **Step 5: 라우트 등록**

`api/main.go` line 396 직후 (`api.POST("/onlyoffice/callback", h.OnlyOfficeCallback)` 다음 빈 줄에) 추가:

```go
	// rhwp HWP viewer/editor settings (Issue #35, v0.15.0)
	api.GET("/rhwp/settings", h.GetRhwpSettings)
```

확인:
```bash
grep -n 'rhwp/settings' api/main.go
```
정확히 1개 라인 매치되어야 함.

- [ ] **Step 6: 테스트 통과 확인 (GREEN)**

```bash
sudo docker compose -f docker-compose-dev.yaml exec -T api sh -c "cd /app && go test ./handlers/ -run TestGetRhwpSettings -v"
```
3개 모두 PASS.

- [ ] **Step 7: 백엔드 전체 회귀 테스트**

```bash
sudo docker compose -f docker-compose-dev.yaml exec -T api sh -c "cd /app && go test -race ./handlers/..."
```
모든 테스트 PASS. (race detector 켜진 상태에서 통과해야 함 — CI 동일.)

> **No commit. Continue to Task 2.**

---

## Task 2: 프론트엔드 API 레이어 cherry-pick

**Files:**
- Modify: `ui/src/api/files.ts`
- Create: `ui/src/api/__tests__/files.hwp.test.ts`

- [ ] **Step 1: v0.14.1 의 files.ts 변경 추출**

v0.14.1 (`0ab8783`) 의 files.ts 에서 추가된 부분(약 46줄)을 확인:

```bash
git diff 9b35dc4 0ab8783 -- ui/src/api/files.ts
```

추가된 항목:
- `RhwpSettings` interface
- `isHwpSupported()` 함수
- `getRhwpSettings()` 함수
- `saveBinaryFileContent()` 함수
- `getFileIcon` 분기에 `'hwp'/'hwpx'` 매핑 (`return 'hwp'`)

`ui/src/api/files.ts` 가 현재 main 에서 v0.14.1 베이스 와 차이 없음 (verify: `git diff 9b35dc4 HEAD -- ui/src/api/files.ts` 가 빈 출력) — 따라서 그냥 **0ab8783 버전으로 교체**:

```bash
git checkout 0ab8783 -- ui/src/api/files.ts
```

- [ ] **Step 2: 테스트 cherry-pick**

```bash
git checkout 0ab8783 -- ui/src/api/__tests__/files.hwp.test.ts
```

확인:
```bash
ls -l ui/src/api/__tests__/files.hwp.test.ts
```

- [ ] **Step 3: 단위 테스트 실행**

```bash
cd ui && npm run test -- --run src/api/__tests__/files.hwp.test.ts
```
모든 케이스 PASS.

- [ ] **Step 4: 타입 체크**

```bash
cd ui && npx tsc --noEmit
```
0 errors.

> **No commit. Continue to Task 3.**

---

## Task 3: RhwpEditor 컴포넌트 cherry-pick (v0.14.1 그대로)

**Files:**
- Create: `ui/src/components/RhwpEditor.tsx`
- Create: `ui/src/components/RhwpEditor.css`
- Create: `ui/src/components/__tests__/RhwpEditor.test.tsx`

- [ ] **Step 1: 컴포넌트 + 스타일 + 테스트 cherry-pick**

```bash
git checkout 0ab8783 -- \
  ui/src/components/RhwpEditor.tsx \
  ui/src/components/RhwpEditor.css \
  ui/src/components/__tests__/RhwpEditor.test.tsx
```

- [ ] **Step 2: 단위 테스트 실행 (베이스 동작 확인)**

```bash
cd ui && npm run test -- --run src/components/__tests__/RhwpEditor.test.tsx
```
모든 v0.14.1 테스트 PASS — race retry 시나리오까지 포함.

- [ ] **Step 3: 타입 체크**

```bash
cd ui && npx tsc --noEmit
```
0 errors.

> **No commit. Continue to Task 4 (B1 simplification).**

---

## Task 4: RhwpEditor B1 단순화 — 테스트 RED

**Files:**
- Modify: `ui/src/components/__tests__/RhwpEditor.test.tsx`

> 이 task 에서는 v0.14.1 의 retry/polling 시나리오 테스트를 삭제하고, B1 동작을 검증하는 새 테스트를 작성한다. 구현은 다음 task 에서. 테스트 먼저 = TDD RED.

- [ ] **Step 1: 기존 테스트 파일을 B1 패턴으로 교체**

`ui/src/components/__tests__/RhwpEditor.test.tsx` 전체를 다음으로 교체:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RhwpEditor from '../RhwpEditor'

vi.mock('../../api/files', () => ({
  getFileUrl: (p: string) => `/api/files/content${p}`,
  getAuthToken: () => 'test-token',
  saveBinaryFileContent: vi.fn(async () => undefined),
}))

interface PostedMessage {
  type: string
  id: number
  method: string
  params: Record<string, unknown>
}

// iframe contentWindow 의 postMessage 를 가로채서 부모로 응답을 다시 보낸다.
function setupIframeStub(opts: {
  readyResponse?: { delay?: number; ok?: boolean; error?: string }
  loadFileResponse?: { delay?: number; pageCount?: number; error?: string }
  exportResponse?: { delay?: number; bytes?: number[]; error?: string }
}): { posted: PostedMessage[] } {
  const posted: PostedMessage[] = []

  // HTMLIFrameElement.contentWindow.postMessage 가로채기
  const origDescriptor = Object.getOwnPropertyDescriptor(
    HTMLIFrameElement.prototype,
    'contentWindow',
  )
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    get(this: HTMLIFrameElement) {
      const self = this
      return {
        postMessage: (msg: PostedMessage) => {
          posted.push(msg)
          // 적절한 응답 시뮬레이션
          const respond = (
            payload: Partial<{ result: unknown; error: string }>,
            delay = 0,
          ) => {
            setTimeout(() => {
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: { type: 'rhwp-response', id: msg.id, ...payload },
                }),
              )
            }, delay)
          }
          if (msg.method === 'ready') {
            const r = opts.readyResponse ?? { ok: true }
            if (r.error) respond({ error: r.error }, r.delay)
            else respond({ result: r.ok ?? true }, r.delay)
          } else if (msg.method === 'loadFile') {
            const r = opts.loadFileResponse ?? { pageCount: 1 }
            if (r.error) respond({ error: r.error }, r.delay)
            else respond({ result: { pageCount: r.pageCount ?? 1 } }, r.delay)
          } else if (msg.method === 'exportHwp') {
            const r = opts.exportResponse ?? { bytes: [1, 2, 3] }
            if (r.error) respond({ error: r.error }, r.delay)
            else respond({ result: r.bytes ?? [1, 2, 3] }, r.delay)
          }
          // load 이벤트 강제 트리거 (jsdom)
          if (msg === posted[0]) {
            queueMicrotask(() => self.dispatchEvent(new Event('load')))
          }
          void self
        },
      } as unknown as Window
    },
  })

  // fetch mock — 인증된 same-origin fetch 결과 ArrayBuffer
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  })) as unknown as typeof fetch

  return { posted }
}

afterEach(() => {
  vi.restoreAllMocks()
  // contentWindow descriptor 원복
  delete (HTMLIFrameElement.prototype as unknown as { contentWindow?: unknown })
    .contentWindow
})

describe('RhwpEditor — B1 (no retry, single shot)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'queueMicrotask'] })
  })

  it('정상 흐름: ready → fetch → loadFile → ready 상태 + pageCount 표시', async () => {
    const { posted } = setupIframeStub({
      readyResponse: { ok: true },
      loadFileResponse: { pageCount: 3 },
    })

    render(
      <RhwpEditor
        filePath="/docs/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        onClose={() => {}}
      />,
    )

    // iframe load 이벤트 → ready ping 보냄
    await vi.runAllTimersAsync()

    await waitFor(() => {
      expect(screen.getByText('3페이지')).toBeInTheDocument()
    })

    // 정확히 'ready' 1번 + 'loadFile' 1번만 호출되어야 함 (재시도 없음)
    const readyCalls = posted.filter((m) => m.method === 'ready').length
    const loadFileCalls = posted.filter((m) => m.method === 'loadFile').length
    expect(readyCalls).toBe(1)
    expect(loadFileCalls).toBe(1)
  })

  it('loadFile 실패 시 단발 호출만 — 재시도 없음', async () => {
    const { posted } = setupIframeStub({
      readyResponse: { ok: true },
      loadFileResponse: { error: '__wbindgen_malloc undefined' },
    })

    render(
      <RhwpEditor
        filePath="/docs/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        onClose={() => {}}
      />,
    )

    await vi.runAllTimersAsync()

    await waitFor(() => {
      expect(screen.getByText(/한글 문서를 열 수 없습니다/i)).toBeInTheDocument()
    })

    expect(posted.filter((m) => m.method === 'loadFile').length).toBe(1)
  })

  it('에러 화면에 [다운로드] 버튼 — 클릭 시 onDownload 호출', async () => {
    setupIframeStub({
      readyResponse: { error: 'Request timeout: ready' },
    })
    const onDownload = vi.fn()

    render(
      <RhwpEditor
        filePath="/docs/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        onClose={() => {}}
        onDownload={onDownload}
      />,
    )

    await vi.runAllTimersAsync()

    const dlBtn = await screen.findByRole('button', { name: /다운로드/ })
    fireEvent.click(dlBtn)
    expect(onDownload).toHaveBeenCalledOnce()
  })

  it('에러 시 onDownload 가 자동으로 호출되지 않음 (사용자 클릭만)', async () => {
    setupIframeStub({
      readyResponse: { error: 'Request timeout: ready' },
    })
    const onDownload = vi.fn()

    render(
      <RhwpEditor
        filePath="/docs/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        onClose={() => {}}
        onDownload={onDownload}
      />,
    )

    await vi.runAllTimersAsync()
    await screen.findByText(/한글 문서를 열 수 없습니다/i)
    expect(onDownload).not.toHaveBeenCalled()
  })

  it('hasWritePermission=false 일 때 저장 버튼 미렌더', async () => {
    setupIframeStub({
      readyResponse: { ok: true },
      loadFileResponse: { pageCount: 1 },
    })

    render(
      <RhwpEditor
        filePath="/shared/foo/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        hasWritePermission={false}
        onClose={() => {}}
      />,
    )

    await vi.runAllTimersAsync()
    await screen.findByText('1페이지')

    expect(screen.queryByRole('button', { name: /저장/ })).toBeNull()
  })

  it('hasWritePermission=true (기본) 일 때 저장 버튼 렌더', async () => {
    setupIframeStub({
      readyResponse: { ok: true },
      loadFileResponse: { pageCount: 1 },
    })

    render(
      <RhwpEditor
        filePath="/docs/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        onClose={() => {}}
      />,
    )

    await vi.runAllTimersAsync()
    await screen.findByText('1페이지')
    expect(screen.getByRole('button', { name: /저장/ })).toBeInTheDocument()
  })

  it('readOnly=true 일 때 저장 버튼 미렌더 (hasWritePermission 과 무관)', async () => {
    setupIframeStub({
      readyResponse: { ok: true },
      loadFileResponse: { pageCount: 1 },
    })

    render(
      <RhwpEditor
        filePath="/docs/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        readOnly
        onClose={() => {}}
      />,
    )

    await vi.runAllTimersAsync()
    await screen.findByText('1페이지')
    expect(screen.queryByRole('button', { name: /저장/ })).toBeNull()
  })

  it('Ctrl+S → exportHwp + saveBinaryFileContent 호출', async () => {
    const { posted } = setupIframeStub({
      readyResponse: { ok: true },
      loadFileResponse: { pageCount: 1 },
      exportResponse: { bytes: [9, 9, 9] },
    })
    const onSaved = vi.fn()

    render(
      <RhwpEditor
        filePath="/docs/sample.hwp"
        fileName="sample.hwp"
        studioUrl="/rhwp/"
        onClose={() => {}}
        onSaved={onSaved}
      />,
    )

    await vi.runAllTimersAsync()
    await screen.findByText('1페이지')

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await vi.runAllTimersAsync()

    expect(posted.some((m) => m.method === 'exportHwp')).toBe(true)
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: 테스트 실행 → 일부 실패 확인 (RED)**

```bash
cd ui && npm run test -- --run src/components/__tests__/RhwpEditor.test.tsx
```

기대 (현재 v0.14.1 RhwpEditor 구현 기준):
- "재시도 없음" 검증 케이스 — 실패 (현재 retry 가 wbindgen race 시 재시도)
- "에러 시 onDownload 자동 호출 안 됨" — 실패 (현재 catch 절에서 자동 호출)
- "에러 화면 다운로드 버튼" — 실패 (현재 닫기 버튼만 있음)
- "hasWritePermission" 케이스 — 실패 (prop 없음)

> **No commit. Continue to Task 5.**

---

## Task 5: RhwpEditor B1 simplification — 구현 (GREEN)

**Files:**
- Modify: `ui/src/components/RhwpEditor.tsx` (전체 교체)

> v0.14.1 의 retry/polling/onFallbackDownload 자동호출 제거, `onDownload` rename, `hasWritePermission` prop 추가.

- [ ] **Step 1: RhwpEditor.tsx 전체를 B1 버전으로 교체**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { getFileUrl, getAuthToken, saveBinaryFileContent } from '../api/files'
import './RhwpEditor.css'

// rhwp-studio 와 통신 전략 (rhwp v0.7.10+ 전제):
//
// 1. upstream PR #581 fix 로 'ready' 응답이 wasm.initialize() 완료를 보장.
//    재시도 / wbindgen race 회피 코드는 v0.15.0 에서 제거됨.
// 2. ?url= query 방식은 외부 CDN(edwardkim.github.io HTTPS) → LAN(localhost HTTP)
//    의 cross-origin fetch 가 Chrome Private Network Access 정책으로 차단된다.
//    → 부모(우리)가 same-origin fetch 후 postMessage 로 buffer 전달 (PNA 회피).

interface RhwpEditorProps {
  filePath: string
  fileName: string
  studioUrl: string
  readOnly?: boolean
  /** shared folder 등 권한 제어 — false 면 저장 버튼 미표시 (기본 true) */
  hasWritePermission?: boolean
  onClose: () => void
  onError?: (message: string) => void
  onSaved?: () => void
  /** 사용자가 에러 화면의 [다운로드] 버튼 클릭 시 호출 (자동 호출 아님) */
  onDownload?: () => void
}

interface RhwpResponse {
  type: 'rhwp-response'
  id: number
  result?: unknown
  error?: string
}

let requestIdCounter = 0

type LoadState = 'loading' | 'ready' | 'error'

function humanizeError(raw: string): string {
  if (raw.includes('HTTP 401') || raw.includes('HTTP 403')) {
    return '파일에 접근할 권한이 없습니다.'
  }
  if (raw.includes('HTTP 404')) {
    return '파일을 찾을 수 없습니다.'
  }
  if (/HTTP 5\d\d/.test(raw)) {
    return '서버에서 파일을 가져오는 중 오류가 발생했습니다.'
  }
  if (raw.includes('Request timeout: ready')) {
    return '한글 뷰어가 응답하지 않습니다. 브라우저를 새로고침해 주세요.'
  }
  if (raw.includes('Request timeout: loadFile')) {
    return '한글 문서 처리 시간이 초과되었습니다.'
  }
  return raw || '한글 문서를 처리할 수 없습니다.'
}

function RhwpEditor({
  filePath,
  fileName,
  studioUrl,
  readOnly = false,
  hasWritePermission = true,
  onClose,
  onError,
  onSaved,
  onDownload,
}: RhwpEditorProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('rhwp-studio 로딩 중...')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pendingRef = useRef(
    new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>(),
  )
  const isMountedRef = useRef(true)

  const onErrorRef = useRef(onError)
  const onSavedRef = useRef(onSaved)
  onErrorRef.current = onError
  onSavedRef.current = onSaved

  // postMessage 응답 라우터
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data as RhwpResponse | undefined
      if (data?.type !== 'rhwp-response' || data.id == null) return
      const resolver = pendingRef.current.get(data.id)
      if (!resolver) return
      pendingRef.current.delete(data.id)
      if (data.error) resolver.reject(new Error(data.error))
      else resolver.resolve(data.result)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // iframe 으로 요청 → 응답 promise
  const sendRequest = useCallback(
    <T,>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        const id = ++requestIdCounter
        pendingRef.current.set(id, {
          resolve: (v) => resolve(v as T),
          reject,
        })
        const cw = iframeRef.current?.contentWindow
        if (!cw) {
          pendingRef.current.delete(id)
          reject(new Error('iframe 미준비'))
          return
        }
        cw.postMessage({ type: 'rhwp-request', id, method, params }, '*')
        setTimeout(() => {
          if (pendingRef.current.has(id)) {
            pendingRef.current.delete(id)
            reject(new Error(`Request timeout: ${method}`))
          }
        }, timeoutMs)
      })
    },
    [],
  )

  // 메인 흐름: iframe load → ready 단발 → 인증 fetch → loadFile 단발
  useEffect(() => {
    isMountedRef.current = true

    const run = async () => {
      try {
        // 1) ready ping (단발, timeout 30s — upstream race fix 로 단발 충분)
        setStatusMsg('rhwp-studio 로딩 중...')
        await sendRequest<boolean>('ready', {}, 30000)
        if (!isMountedRef.current) return

        // 2) 인증된 same-origin fetch → ArrayBuffer (PNA 회피)
        setStatusMsg('파일 다운로드 중...')
        const token = getAuthToken()
        const fileUrl = getFileUrl(filePath)
        const resp = await fetch(fileUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!resp.ok) throw new Error(`파일 다운로드 실패: HTTP ${resp.status}`)
        const buffer = await resp.arrayBuffer()
        if (!isMountedRef.current) return

        // 3) loadFile 단발 (재시도 없음)
        setStatusMsg('한글 문서 로드 중...')
        const bytes = Array.from(new Uint8Array(buffer))
        const result = await sendRequest<{ pageCount: number }>(
          'loadFile',
          { data: bytes, fileName },
          15000,
        )
        if (!isMountedRef.current) return

        setPageCount(result?.pageCount ?? null)
        setLoadState('ready')
      } catch (err) {
        if (!isMountedRef.current) return
        const raw = err instanceof Error ? err.message : '에디터 로드 실패'
        const friendly = humanizeError(raw)
        setErrorMsg(friendly)
        setLoadState('error')
        onErrorRef.current?.(friendly)
        // 자동 다운로드 fallback 제거 — 사용자가 에러 화면의 [다운로드] 버튼 클릭 시에만
      }
    }

    const iframe = iframeRef.current
    if (!iframe) return

    const onIframeLoad = () => {
      if (isMountedRef.current) run()
    }
    iframe.addEventListener('load', onIframeLoad)

    if (iframe.contentWindow && iframe.contentDocument?.readyState === 'complete') {
      onIframeLoad()
    }

    return () => {
      isMountedRef.current = false
      iframe.removeEventListener('load', onIframeLoad)
      pendingRef.current.clear()
    }
  }, [filePath, fileName, studioUrl, sendRequest])

  const showSaveButton = !readOnly && hasWritePermission

  // 저장 핸들러
  const handleSave = useCallback(async () => {
    if (isSaving || !showSaveButton || loadState !== 'ready') return
    setIsSaving(true)
    try {
      const result = await sendRequest<number[] | Uint8Array>('exportHwp', {}, 30000)
      const bytes = result instanceof Uint8Array ? result : new Uint8Array(result || [])
      const ext = fileName.toLowerCase().endsWith('.hwpx') ? 'hwpx' : 'hwp'
      const mime = ext === 'hwpx' ? 'application/vnd.hancom.hwpx' : 'application/x-hwp'
      await saveBinaryFileContent(filePath, bytes, mime)
      onSavedRef.current?.()
    } catch (err) {
      const raw = err instanceof Error ? err.message : '저장 실패'
      const friendly = humanizeError(raw)
      setErrorMsg(friendly)
      onErrorRef.current?.(friendly)
    } finally {
      setIsSaving(false)
    }
  }, [filePath, fileName, isSaving, showSaveButton, loadState, sendRequest])

  // Ctrl+S / ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (showSaveButton) handleSave()
      }
      if (e.key === 'Escape') {
        if (showSaveButton && loadState === 'ready') {
          if (confirm('편집 내용이 저장되지 않았을 수 있습니다. 닫으시겠습니까?')) {
            onClose()
          }
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave, loadState, onClose, showSaveButton])

  const handleDownload = useCallback(() => {
    onDownload?.()
    onClose()
  }, [onDownload, onClose])

  return (
    <div className="rhwp-overlay">
      <div className="rhwp-container">
        <div className="rhwp-header">
          <span className="rhwp-title">{fileName}</span>
          {pageCount !== null && (
            <span className="rhwp-meta">{pageCount}페이지</span>
          )}
          <span className="rhwp-beta-badge">베타</span>
          <div className="rhwp-actions">
            {showSaveButton && (
              <button
                className="rhwp-btn-save"
                onClick={handleSave}
                disabled={isSaving || loadState !== 'ready'}
              >
                {isSaving ? '저장 중...' : '저장 (Ctrl+S)'}
              </button>
            )}
            <button className="rhwp-btn-close" onClick={onClose} aria-label="닫기">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="rhwp-body">
          {loadState === 'loading' && (
            <div className="rhwp-loading">
              <div className="rhwp-spinner" />
              <p>{statusMsg}</p>
            </div>
          )}
          {loadState === 'error' && (
            <div className="rhwp-error">
              <p className="rhwp-error-title">한글 문서를 열 수 없습니다.</p>
              <p className="rhwp-error-detail">{errorMsg}</p>
              <div className="rhwp-error-actions">
                {onDownload && (
                  <button className="rhwp-btn-save" onClick={handleDownload}>
                    다운로드
                  </button>
                )}
                <button className="rhwp-btn-cancel" onClick={onClose}>
                  닫기
                </button>
              </div>
            </div>
          )}
          <iframe
            ref={iframeRef}
            className="rhwp-iframe"
            src={new URL(studioUrl, window.location.origin).href}
            allow="clipboard-read; clipboard-write"
            title={fileName}
            style={{ display: loadState === 'ready' ? 'block' : 'none' }}
          />
        </div>
      </div>
    </div>
  )
}

export default RhwpEditor
```

- [ ] **Step 2: 에러 화면 새 클래스에 대한 CSS 추가**

`ui/src/components/RhwpEditor.css` 파일 끝에 다음 추가:

```css
.rhwp-error-title {
  font-weight: 600;
  font-size: 16px;
  color: #191f28;
  margin: 0;
}

.rhwp-error-detail {
  font-size: 14px;
  color: #4e5968;
  margin: 0;
  text-align: center;
  max-width: 480px;
}

.rhwp-error-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.rhwp-btn-cancel {
  background: #e5e8eb;
  color: #191f28;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
}

.rhwp-btn-cancel:hover {
  background: #d1d6db;
}
```

기존 `.rhwp-error { color: #f44336; }` 룰은 색상이 너무 강조되어 새 디자인과 안 맞으므로 제거. `.rhwp-error` 의 다른 속성 (position/inset/flex 등) 은 유지.

`ui/src/components/RhwpEditor.css` 의 `.rhwp-error` 룰을 다음으로 교체:
```css
.rhwp-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: #ffffff;
  padding: 32px;
}
```

기존 `.rhwp-error button` 룰 제거 (새 버튼들은 `.rhwp-btn-save`/`.rhwp-btn-cancel` 사용).

- [ ] **Step 3: 단위 테스트 실행 (GREEN)**

```bash
cd ui && npm run test -- --run src/components/__tests__/RhwpEditor.test.tsx
```
모든 케이스 PASS.

- [ ] **Step 4: 타입 체크**

```bash
cd ui && npx tsc --noEmit
```
0 errors.

> **No commit. Continue to Task 6.**

---

## Task 6: FileList / ContextMenu / fileIcons cherry-pick + hasWritePermission

**Files:**
- Modify: `ui/src/components/FileList.tsx`
- Modify: `ui/src/components/filelist/ContextMenu.tsx`
- Modify: `ui/src/utils/fileIcons.tsx`

> v0.14.1 베이스 cherry-pick 후 `hasWritePermission` 흐름 추가 + `onFallbackDownload`/`'한글 뷰어 로딩 실패 (rhwp v0.7.x 베타)' 토스트 호출` 제거.

- [ ] **Step 1: 세 파일 cherry-pick**

```bash
git checkout 0ab8783 -- \
  ui/src/components/FileList.tsx \
  ui/src/components/filelist/ContextMenu.tsx \
  ui/src/utils/fileIcons.tsx
```

- [ ] **Step 2: FileList.tsx 의 RhwpEditor 마운트 부분 패치**

`ui/src/components/FileList.tsx` 의 RhwpEditor mount JSX (line ~1781 근처) 를 다음으로 교체:

```tsx
{/* rhwp HWP Editor Modal */}
{hwpViewingFile && rhwpSettings && (
  <RhwpEditor
    filePath={hwpViewingFile.path}
    fileName={hwpViewingFile.name}
    studioUrl={rhwpSettings.studioUrl}
    hasWritePermission={resolveWritePermission(hwpViewingFile)}
    onClose={() => setHwpViewingFile(null)}
    onError={(msg) => showError(msg)}
    onSaved={() => {
      showInfo('저장되었습니다')
      void refresh()
      setHwpViewingFile(null)
    }}
    onDownload={() => {
      const f = hwpViewingFile
      void downloadFileDirect(f.path, f.name)
    }}
  />
)}
```

(v0.14.1 의 `onFallbackDownload` 자동 호출 + `'한글 뷰어 로딩 실패 (rhwp v0.7.x 베타) — 파일을 대신 다운로드합니다.'` 토스트 호출은 제거. 자동 다운로드는 더 이상 발생하지 않음.)

- [ ] **Step 3: `resolveWritePermission` 헬퍼 함수 추가**

`FileList.tsx` 안에 component 함수 내부 또는 적절한 위치에 다음 헬퍼 추가 (다른 helper 들과 같은 영역에):

```tsx
const resolveWritePermission = useCallback(
  (file: FileInfo): boolean => {
    if (!currentPath.startsWith('/shared/')) return true
    const folderName = currentPath.substring(8).split('/')[0]
    const folder = sharedFolders.find((f) => f.name === folderName)
    if (!folder) return true  // 매칭 실패 시 백엔드 검증에 의존
    return folder.permissionLevel === PERMISSION_READ_WRITE
  },
  [currentPath, sharedFolders],
)
```

`PERMISSION_READ_WRITE` import 가 없다면 `ui/src/api/sharedFolders.ts` 에서 추가:
```tsx
import { ..., PERMISSION_READ_WRITE } from '../api/sharedFolders'
```

> `file: FileInfo` 인자는 현재 사용하지 않지만 향후 file-level 권한 분기 가능성을 위해 시그니처 유지. 미사용 경고 시 `_file` 로 prefix.

- [ ] **Step 4: ContextMenu / fileIcons 는 cherry-pick 그대로 사용**

cherry-pick 한 v0.14.1 버전에 변경 사항 없음. 추가 patch 불필요.

- [ ] **Step 5: 단위 테스트 + 타입 체크**

```bash
cd ui && npm run test
cd ui && npx tsc --noEmit
```

기존 모든 테스트 PASS, type errors 없음.

> **No commit. Continue to Task 7.**

---

## Task 7: 인프라 — Dockerfile / server.cjs / vite.config / docker-compose

**Files:**
- Modify: `ui/Dockerfile`
- Modify: `ui/server.cjs`
- Modify: `ui/vite.config.ts`
- Modify: `docker-compose.yml`
- Modify: `docker-compose-dev.yaml`

- [ ] **Step 1: server.cjs / vite.config.ts / docker-compose 두 개 cherry-pick**

```bash
git checkout 0ab8783 -- \
  ui/server.cjs \
  ui/vite.config.ts \
  docker-compose.yml \
  docker-compose-dev.yaml
```

- [ ] **Step 2: Dockerfile cherry-pick**

```bash
git checkout 0ab8783 -- ui/Dockerfile
```

- [ ] **Step 3: Dockerfile mirror stage 강화 — `|| true` 제거 + 검증 step 추가**

`ui/Dockerfile` 상단 `rhwp-mirror` stage 를 다음으로 교체:

```dockerfile
# rhwp-studio mirror stage — GitHub Pages 정적 자산 mirror
# v0.15.0: race fix 후 기본 활성화. mirror 실패 시 빌드도 실패시킴.
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
# 검증: 핵심 자산이 mirror 되었는지 확인 — 누락 시 빌드 실패
RUN test -f /out/rhwp/index.html
RUN test -d /out/rhwp/assets
RUN ls /out/rhwp/assets/*.js > /dev/null
RUN ls /out/rhwp/assets/*.css > /dev/null
RUN ls -la /out/rhwp/ | head -20
```

(v0.14.1 의 `|| true` 와 `wget … || true` 패턴이 제거되어, 네트워크 실패 시 빌드가 멈춤.)

- [ ] **Step 4: Dockerfile 빌드 검증 (mirror stage 만)**

UI 빌드는 시간이 오래 걸리므로 mirror stage 만 단독 빌드 테스트:

```bash
sudo docker build -f ui/Dockerfile --target rhwp-mirror -t filehatch-rhwp-mirror-test ui/
```

빌드 성공 + 마지막 `ls -la /out/rhwp/` 출력에 `index.html`, `assets` 디렉토리 보여야 함.

성공 시 임시 이미지 제거:
```bash
sudo docker rmi filehatch-rhwp-mirror-test
```

> **No commit. Continue to Task 8.**

---

## Task 8: 문서 업데이트 — preview-editing.md

**Files:**
- Modify: `docs/specs/features/preview-editing.md`

- [ ] **Step 1: v0.14.1 의 HWP 섹션 cherry-pick**

```bash
git checkout 0ab8783 -- docs/specs/features/preview-editing.md
```

- [ ] **Step 2: v0.15.0 변경 사항 반영 패치**

문서 내 HWP 섹션 (rhwp 통합 부분) 의 다음 표현들을 갱신:

| 기존 (v0.14.1) | 변경 (v0.15.0) |
|---------------|----------------|
| "rhwp v0.7.x 베타 — 안정화 작업 중" | "rhwp v0.7.10+ 사용 (race fix 반영, PR #581)" |
| "RHWP_STUDIO_URL 환경변수 미설정 시 비활성" | "기본 `/rhwp/` (UI 컨테이너 self-host) 사용. RHWP_STUDIO_URL 로 override 가능" |
| "로드 실패 시 자동 다운로드 fallback" | "로드 실패 시 모달 내 에러 화면 + [다운로드] 버튼" |
| 버전 표기 v0.14.1 | v0.15.0 |

`grep` 으로 해당 줄들 찾아 직접 수정:
```bash
grep -n 'rhwp\|RHWP\|HWP' docs/specs/features/preview-editing.md
```

> **No commit. Continue to Task 9.**

---

## Task 9: e2e fixture 준비 (sample.hwp + corrupted.hwp)

**Files:**
- Create: `tests/e2e/fixtures/sample.hwp`
- Create: `tests/e2e/fixtures/corrupted.hwp`
- Create: `tests/e2e/fixtures/SAMPLES_README.md`

- [ ] **Step 1: rhwp upstream sample 다운로드**

```bash
curl -fsSL -o tests/e2e/fixtures/sample.hwp \
  "https://raw.githubusercontent.com/edwardkim/rhwp/main/samples/KTX.hwp"
ls -l tests/e2e/fixtures/sample.hwp
```

파일 크기가 0 이 아니어야 함 (정상 hwp 는 보통 수십 KB).

`-f` flag 로 HTTP 에러 시 명령 실패 → 누락 감지.

- [ ] **Step 2: 손상 fixture 생성 (sample.hwp 의 첫 100바이트만)**

```bash
head -c 100 tests/e2e/fixtures/sample.hwp > tests/e2e/fixtures/corrupted.hwp
ls -l tests/e2e/fixtures/corrupted.hwp
```

- [ ] **Step 3: README 작성**

`tests/e2e/fixtures/SAMPLES_README.md` 작성:

```markdown
# Test Fixtures — HWP Samples

## sample.hwp

- 출처: [edwardkim/rhwp samples/KTX.hwp](https://github.com/edwardkim/rhwp/blob/main/samples/KTX.hwp)
- 라이선스: rhwp 저장소 MIT (samples 디렉토리는 동일 라이선스로 배포)
- 용도: HWP 뷰어/에디터 e2e 테스트 정상 흐름 검증
- 갱신: `curl -fsSL -o tests/e2e/fixtures/sample.hwp https://raw.githubusercontent.com/edwardkim/rhwp/main/samples/KTX.hwp`

## corrupted.hwp

- 출처: sample.hwp 의 첫 100바이트만 자른 의도적 손상 파일
- 용도: 로드 실패 시 에러 모달 + 다운로드 버튼 동작 검증
- 갱신: `head -c 100 tests/e2e/fixtures/sample.hwp > tests/e2e/fixtures/corrupted.hwp`
```

> **No commit. Continue to Task 10.**

---

## Task 10: e2e spec 복원 + B1 변경 반영

**Files:**
- Modify: `tests/e2e/files/hwp-viewer.spec.ts` (cherry-pick 후 patch)

- [ ] **Step 1: v0.14.1 spec cherry-pick**

```bash
git checkout 0ab8783 -- tests/e2e/files/hwp-viewer.spec.ts
```

- [ ] **Step 2: B1 변경 반영 — 자동 다운로드 케이스 → 명시적 다운로드 버튼 케이스**

`tests/e2e/files/hwp-viewer.spec.ts` 안에서 다음 변경:

1. **자동 다운로드 토스트 (`'한글 뷰어 로딩 실패 (rhwp v0.7.x 베타)'`) 검증 케이스 → 에러 모달 + 다운로드 버튼 클릭 검증으로 교체**

기존 (예시):
```ts
test('로드 실패 시 자동 다운로드', async ({ page }) => {
  await page.dblclick('text=corrupted.hwp')
  await expect(page.getByText('한글 뷰어 로딩 실패')).toBeVisible()
  // download started
})
```

교체:
```ts
test('로드 실패 시 에러 모달 + 다운로드 버튼', async ({ page }) => {
  await page.dblclick('text=corrupted.hwp')
  // 에러 화면이 표시될 때까지 대기
  await expect(page.getByText('한글 문서를 열 수 없습니다.')).toBeVisible({ timeout: 30000 })
  // [다운로드] 버튼 존재 확인
  const dlBtn = page.getByRole('button', { name: '다운로드' })
  await expect(dlBtn).toBeVisible()
  // 클릭 시 다운로드 트리거 확인
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dlBtn.click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.hwp$/)
})
```

2. **재시도 횟수 검증 시나리오 삭제** — v0.14.1 spec 에 race retry 가시화 검증이 있다면 제거.

3. **테스트 한 번 실행 (시간 오래 걸리므로 마커 grep)**

```bash
grep -n 'test(' tests/e2e/files/hwp-viewer.spec.ts
```

> **No commit. Continue to Task 11.**

---

## Task 11: 버전 bump + 단위/lint/타입 체크

**Files:**
- Modify: `api/version.go`
- Modify: `ui/package.json`

> 버전 bump 는 코드 변경의 마지막 단계. 이후 빌드/테스트.

- [ ] **Step 1: api/version.go bump**

`api/version.go` 의 `Version = "0.14.4"` 를 `Version = "0.15.0"` 으로 교체.

```bash
sed -i 's/Version   = "0.14.4"/Version   = "0.15.0"/' api/version.go
grep 'Version   =' api/version.go
```

- [ ] **Step 2: ui/package.json bump**

`ui/package.json` 의 `"version": "0.14.4"` 를 `"version": "0.15.0"` 으로 교체.

```bash
sed -i 's/"version": "0.14.4"/"version": "0.15.0"/' ui/package.json
grep '"version"' ui/package.json | head -1
```

- [ ] **Step 3: 백엔드 lint + 테스트**

```bash
sudo docker run --rm -v $(pwd)/api:/app -w /app golangci/golangci-lint:latest \
  golangci-lint run --timeout=5m ./...
```
0 issues.

```bash
sudo docker compose -f docker-compose-dev.yaml exec -T api sh -c "cd /app && go test -race ./..."
```
모든 패키지 PASS.

- [ ] **Step 4: 프론트엔드 단위 테스트 + 타입 체크 + lint**

```bash
cd ui && npm run test:run
cd ui && npx tsc --noEmit
cd ui && npm run lint || true  # lint 가 정의되어 있다면
cd ..
```
모두 PASS / 0 errors.

> **No commit. Continue to Task 12.**

---

## Task 12: Docker 빌드 + 부팅 헬스체크

> 코드 변경이 모두 끝난 상태에서 실제 컨테이너 빌드 + 기동 확인.

- [ ] **Step 1: API + UI 빌드 (no-cache)**

```bash
sudo docker compose -f docker-compose-dev.yaml build --no-cache api ui
```

빌드 성공해야 함. 특히 UI 의 `rhwp-mirror` stage 가 `index.html` 검증 step 통과해야 함.

- [ ] **Step 2: 컨테이너 재기동**

```bash
sudo docker compose -f docker-compose-dev.yaml down api ui
sudo docker compose -f docker-compose-dev.yaml up -d api ui
sleep 8
sudo docker compose -f docker-compose-dev.yaml ps
```
api, ui 모두 `Up` / healthy.

- [ ] **Step 3: 헬스체크**

```bash
curl -fsS http://localhost:3080/health
curl -fsS http://localhost:3080/api/version
curl -fsS http://localhost:3080/api/rhwp/settings
curl -fsSI http://localhost:3080/rhwp/ | head -3
```

기대:
- `/health` → 200
- `/api/version` → `{"version":"0.15.0",...}`
- `/api/rhwp/settings` → `{"enabled":true,"studioUrl":"/rhwp/"}`
- `/rhwp/` → 200, `Content-Type: text/html` (rhwp-studio index.html)

- [ ] **Step 4: 로그 확인 (에러 없음)**

```bash
sudo docker compose -f docker-compose-dev.yaml logs --tail=50 api ui | grep -iE 'error|fatal|panic' | head
```
출력 없음 (또는 무관한 라인만).

> **No commit. Continue to Task 13.**

---

## Task 13: e2e spec 자동화 실행 (Tier 1)

> 본 step 은 Playwright 가 dev 환경에 설정되어 있다고 가정. 환경 미설정 시 skip 하고 Task 14 (MCP 인수 테스트) 로 직행.

- [ ] **Step 1: Playwright 환경 점검**

```bash
ls tests/e2e/playwright.config.* 2>&1 | head
cd tests/e2e && npx playwright --version
```

- [ ] **Step 2: HWP spec 만 실행**

```bash
cd tests/e2e && npx playwright test files/hwp-viewer.spec.ts --reporter=line
```

모든 테스트 PASS.

PASS 못하면 결과를 분석하여 root cause fix 후 재실행. (자동 다운로드 spec 이 실패하면 Task 10 의 patch 미적용 — 다시 확인.)

> **No commit. Continue to Task 14.**

---

## Task 14: Playwright MCP 인수 테스트 — Tier 1+2 (11 시나리오)

> **본 task 가 가장 중요**. 사용자가 "Playwright MCP 로 모든 동작 테스트" 를 명시 요구. Claude Code 세션 내에서 `mcp__plugin_playwright_playwright__*` 도구로 직접 수행.

**전제 조건 / 테스트 데이터 준비:**

```bash
# 테스트 사용자로 dev 환경에 로그인 정보 확인
# (기존 테스트 계정 admin / 일반 사용자 사용)

# HWP 파일들이 dev 환경에 업로드되어 있어야 함:
#   - sample.hwp (정상)
#   - sample.hwpx (정상 — sample.hwp 와 동일 파일을 .hwpx 로 업로드)
#   - corrupted.hwp (손상)
#   - sample.txt (non-HWP, 회귀 검증용)
#
# 또는 테스트 시작 시 MCP 로 직접 업로드.
```

- [ ] **Step 1: T1 — `.hwp` 더블클릭 → 모달 + 페이지 수**

```
1. mcp browser_navigate http://localhost:3080
2. 로그인 (admin)
3. /home/admin/ 등 hwp 파일 위치로 이동
4. browser_click "sample.hwp" (더블클릭)
5. browser_wait_for 텍스트 "페이지" 가 나타날 때까지
6. browser_snapshot — 모달 가시 + 페이지 카운트 표시 확인
7. browser_console_messages — 에러 없음 확인
```

기대: 모달 표시, "N페이지" 라벨 보임, 콘솔 에러 없음.

- [ ] **Step 2: T2 — `.hwpx` 더블클릭 → 동일 동작**

T1 과 동일 절차, 파일은 `sample.hwpx`. 결과 동일 기대.

- [ ] **Step 3: T3 — 편집 후 Ctrl+S → 저장 → 재오픈 보존**

```
1. T1 완료 상태에서 iframe 내부에서 텍스트 수정 시도 (browser_type)
2. browser_press_key Ctrl+S
3. browser_wait_for 텍스트 "저장되었습니다"
4. browser_press_key Escape  (모달 닫기)
5. 같은 파일 재오픈 (browser_click 더블클릭)
6. browser_snapshot — 변경 내용 보존 확인 (시각 확인 또는 페이지 수 변화)
```

> 주의: rhwp v0.7.10 의 편집 안정성에 따라 일부 편집 동작이 제한될 수 있음. 텍스트 입력 불가능 시 "저장 후 페이지 수가 동일" 정도로 약화.

- [ ] **Step 4: T4 — ESC 동작 (미편집 즉시 / 편집 후 confirm)**

```
1. .hwp 더블클릭 → 모달 오픈
2. browser_press_key Escape  → 모달 즉시 닫힘 (편집 안 됨)
3. browser_snapshot — 모달 사라짐 확인
4. 다시 .hwp 더블클릭 → 모달 오픈
5. iframe 내 편집 시도 → browser_press_key Escape
6. browser_handle_dialog accept → 모달 닫힘
   또는 browser_handle_dialog dismiss → 모달 유지
```

- [ ] **Step 5: T5 — ✕ 닫기 버튼**

```
1. .hwp 더블클릭 → 모달 오픈
2. browser_click [aria-label="닫기"]
3. browser_snapshot — 모달 사라짐
```

- [ ] **Step 6: T6 — Non-HWP (.txt) 회귀 차단**

```
1. browser_click "sample.txt" (더블클릭)
2. browser_snapshot — RhwpEditor 모달이 안 나타남, 텍스트 에디터(다른 컴포넌트)가 열림
3. browser_console_messages — RhwpEditor 관련 에러/import 없음
```

- [ ] **Step 7: T7 — 로드 실패 (corrupted.hwp) → 에러 모달 + 다운로드 버튼**

```
1. browser_click "corrupted.hwp" (더블클릭)
2. browser_wait_for 텍스트 "한글 문서를 열 수 없습니다"
3. browser_snapshot — 에러 화면 확인, [다운로드] 버튼 보임
4. browser_click [다운로드]
5. browser_network_requests — 다운로드 요청 발생 확인
6. browser_snapshot — 모달 닫힘
```

- [ ] **Step 8: T8 — Shared folder read-only 멤버 → 저장 버튼 미표시**

```
1. 일반 사용자로 로그인 (read-only 권한 보유 shared folder 멤버)
2. /shared/<폴더명>/ 으로 이동
3. .hwp 파일 더블클릭
4. browser_snapshot — 모달 헤더에 [저장] 버튼이 없어야 함 (X 닫기 버튼만)
```

> 사전 준비: read-only 권한의 shared folder 와 거기에 hwp 파일이 있어야 함. 없으면 admin 으로 미리 setup.

- [ ] **Step 9: T9 — 컨텍스트 메뉴 "한글로 열기" — HWP 만**

```
1. .hwp 파일 우클릭 → context menu 표시
2. browser_snapshot — "한글로 열기" 항목 보임
3. .txt 파일 우클릭 → context menu
4. browser_snapshot — "한글로 열기" 항목 부재
```

- [ ] **Step 10: T10 — `RHWP_STUDIO_URL` 미설정 — 기본 `/rhwp/`**

이미 dev 환경이 미설정 상태일 가능성이 높음 (docker-compose-dev.yaml 의 `${RHWP_STUDIO_URL:-}` → 빈 문자열). 확인:

```bash
sudo docker compose -f docker-compose-dev.yaml exec api sh -c 'echo "$RHWP_STUDIO_URL"'
# 빈 문자열 출력 기대
```

```
1. browser_navigate /api/rhwp/settings (또는 fetch in console)
2. 응답 확인: {"enabled":true,"studioUrl":"/rhwp/"}
3. .hwp 더블클릭 → 정상 동작
4. browser_network_requests — iframe src 가 same-origin /rhwp/ 인지 확인
```

- [ ] **Step 11: T11 — 다중 파일 (A 열기 → 닫기 → B 열기)**

```
1. fileA.hwp 더블클릭 → 모달 열림 → 페이지 수 확인
2. ✕ 닫기
3. fileB.hwp 더블클릭 → 모달 열림 → fileB 의 페이지 수 표시
4. browser_snapshot — fileB 의 fileName / pageCount 가 제대로 갱신되었는지
5. (state 잔여물 검증) browser_console_messages — pendingRef 정리 안 된 경고 없음
```

- [ ] **Step 12: 결과 보고서 작성**

11 시나리오 결과를 표로 작성하여 사용자에게 제시:

```markdown
## Playwright MCP 인수 테스트 결과 — v0.15.0

| # | Tier | 시나리오 | 결과 | 비고 |
|---|------|---------|------|------|
| 1 | 1 | .hwp 더블클릭 → 모달 + 페이지 수 | ✓/✗ | ... |
| 2 | 1 | .hwpx 동일 동작 | ✓/✗ | ... |
| 3 | 1 | 편집 → Ctrl+S → 보존 | ✓/✗ | ... |
| 4 | 1 | ESC (미편집/편집 후) | ✓/✗ | ... |
| 5 | 1 | ✕ 닫기 | ✓/✗ | ... |
| 6 | 1 | non-HWP 회귀 | ✓/✗ | ... |
| 7 | 1 | 손상 파일 → 에러 모달 + 다운로드 | ✓/✗ | ... |
| 8 | 2 | read-only 저장 버튼 숨김 | ✓/✗ | ... |
| 9 | 2 | 컨텍스트 메뉴 항목 | ✓/✗ | ... |
| 10 | 2 | RHWP_STUDIO_URL 미설정 동작 | ✓/✗ | ... |
| 11 | 2 | 다중 파일 잔여 없음 | ✓/✗ | ... |

콘솔 에러: 없음 / 있음 (있으면 상세)
스크린샷: 첨부 (각 시나리오 별)
```

✗ 발견 시 → 즉시 수정 → 해당 시나리오 재실행.

> **No commit. Continue to Task 15.**

---

## Task 15: 사용자 보고 + 승인 대기

> 본 task 는 자동 commit/push/release 절대 금지. 사용자 명시 승인을 받아야 진행.

- [ ] **Step 1: 변경 요약 작성**

```bash
git status --short
git diff --stat HEAD
```

출력 결과를 정리해서 사용자에게 제시:
- 새 파일: 8개 (rhwp.go, rhwp_test.go, RhwpEditor.tsx, RhwpEditor.css, RhwpEditor.test.tsx, files.hwp.test.ts, hwp-viewer.spec.ts, sample.hwp, corrupted.hwp, SAMPLES_README.md)
- 수정 파일: 11개 (main.go, files.ts, FileList.tsx, ContextMenu.tsx, fileIcons.tsx, Dockerfile, server.cjs, vite.config.ts, docker-compose.yml, docker-compose-dev.yaml, preview-editing.md, version.go, package.json)
- 라인 수: `git diff --stat HEAD | tail -1` 출력 그대로 보고 (예: `21 files changed, 1234 insertions(+), 56 deletions(-)`)

- [ ] **Step 2: 사용자에게 승인 요청 메시지 출력**

```
✓ 모든 단위/회귀/e2e/MCP 인수 테스트 통과

다음 단계는 commit/push/태그입니다. 사용자 명시 승인 필요:
- (1) commit 만 하고 푸시 보류
- (2) commit + push (origin main 만, 태그 없음)
- (3) commit + push + v0.15.0 태그 (태그 푸시 → CI 자동 릴리즈 발동)
- (4) 보류 — 추가 검토 / 변경 후 재시도

선택: __
```

- [ ] **Step 3: 사용자 응답 대기 후 액션**

선택지에 따라:
- (1): `git add` + `git commit` (메시지: `feat(rhwp): HWP 뷰어/에디터 재도입 (v0.15.0, Issue #35)`)
- (2): (1) + `git push origin main`
- (3): (2) + `git tag -a v0.15.0 -m "HWP 뷰어 재도입 — rhwp v0.7.10 race fix 반영"` + `git push origin v0.15.0`
- (4): 변경 사항 working tree 에 보관, 사용자 다음 지시 대기

> **End of plan.**

---

## Self-review (작성자가 plan 직후 수행)

이 plan 은 spec (`docs/superpowers/specs/2026-05-07-hwp-viewer-reintroduction-design.md`) 의 모든 In-Scope 항목을 다음과 같이 cover:

| Spec 요구 | Task |
|----------|------|
| §2 In-Scope: B1 단순화 | Task 4-5 |
| §2 In-Scope: 기본 활성 + `/rhwp/` 기본값 | Task 1 (Step 4-5) |
| §2 In-Scope: 에러 모달 + 다운로드 버튼 | Task 5 (Step 1-2) |
| §2 In-Scope: hasWritePermission | Task 5, 6 |
| §2 In-Scope: e2e spec + MCP Tier 1+2 | Task 10, 14 |
| §2 In-Scope: rhwp-studio mirror, `\|\| true` 제거 | Task 7 |
| §3 아키텍처 다이어그램 | Task 5, 7 (정확한 흐름 구현) |
| §4.1 RhwpEditor 변경 | Task 4-5 |
| §4.2 FileList 통합 + resolveWritePermission | Task 6 |
| §4.6 rhwp.go 기본값 | Task 1 |
| §5 인프라 (Dockerfile, server.cjs, vite.config, docker-compose) | Task 7 |
| §6 에러 핸들링 | Task 5 (humanizeError) |
| §7 테스팅 (backend, unit, e2e, MCP) | Task 1, 2, 5, 13, 14 |
| §9 버전 bump (코드만, commit 없음) | Task 11 |

**Out-of-Scope 확인 (plan 에 들어가지 않은 것):**
- @rhwp/editor wrapper 마이그레이션 — plan 에 없음 ✓
- 자동 커밋/푸시/릴리즈 — Task 15 에서 사용자 승인 후에만 ✓
- 버전 lock — plan 에 없음 ✓

**Placeholder scan**: 없음. 모든 step 에 구체 명령/코드 제공.

**Type consistency**:
- `RhwpEditor` props: `onDownload`, `hasWritePermission` — Task 4 (test), Task 5 (impl), Task 6 (caller) 모두 일치
- `RhwpSettings` interface — Task 2 (cherry-pick) 그대로
- `getFileUrl/getAuthToken/saveBinaryFileContent` — Task 2 cherry-pick 후 Task 5 mock 과 일치
