# HWP/HWPX 미리보기 + 편집/저장 (rhwp 통합) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한컴 HWP/HWPX 문서를 FileHatch 안에서 직접 미리보기·편집·저장할 수 있도록 [rhwp](https://github.com/edwardkim/rhwp) (Rust + WASM 기반 HWP 뷰어/에디터) 를 OnlyOffice 통합 패턴 그대로 임베드한다 (Issue #35).

**Architecture:**
1. `@rhwp/editor` npm 패키지(iframe 기반 wrapper)를 UI 에 추가, 별도 Docker 사이드카 없이 외부 CDN(`https://edwardkim.github.io/rhwp/`) 또는 self-host URL 을 가리키게 한다.
2. 신규 `RhwpEditor.tsx` 컴포넌트가 OnlyOffice 패턴을 미러링 — 모달 오버레이 + iframe 마운트 + 파일 로드/저장 핸들러.
3. 저장은 기존 `PUT /api/files/content/*` 엔드포인트를 재사용 (스트리밍 본문이라 바이너리 OK), 추가 백엔드 변경은 신규 settings 엔드포인트 1개뿐.
4. `RHWP_STUDIO_URL` 환경 변수로 (1) 외부 CDN 사용, (2) 폐쇄망 self-host 둘 다 지원.

**Tech Stack:** Go/Echo (백엔드 1개 핸들러 추가), React 18 + TypeScript + Vite (UI 컴포넌트), `@rhwp/editor@^0.7.9` (iframe wrapper, MIT), Vitest + Playwright (테스트).

**Risk note (사용자 합의됨):**
- rhwp 는 v0.7.x (뼈대) 단계 — 조판 품질이 한컴보다 일부 떨어질 수 있음. 일반 문서는 정상.
- HWPX 출처 문서 저장은 rhwp 자체적으로 비활성화(#196). HWP 저장은 동작하나 라운드트립 100% 미보장.
- 사용자가 "읽기+편집+저장 한번에" 요구 → 구현하되 UI 에 베타 안내 노출.

---

## 변경 파일 맵

| 파일 | 작업 | 책임 |
|------|------|------|
| `api/handlers/rhwp.go` | **신규** | `GET /api/rhwp/settings` 핸들러 — `RHWP_STUDIO_URL` 환경 변수 노출 |
| `api/handlers/rhwp_test.go` | **신규** | settings 핸들러 단위 테스트 |
| `api/main.go` | 수정 | `/api/rhwp/settings` 라우트 등록 |
| `api/version.go` | 수정 | `0.13.3` → `0.14.0` (minor — 새 기능) |
| `ui/package.json` | 수정 | `@rhwp/editor: ^0.7.9` 추가, 버전 `0.14.0` |
| `ui/src/api/files.ts` | 수정 | `isHwpSupported()`, `getRhwpSettings()`, `saveBinaryFileContent()`, `RhwpSettings` 타입 추가; `getFileTypeIcon()` 에 `hwp` 분기 추가 |
| `ui/src/components/RhwpEditor.tsx` | **신규** | 모달 컴포넌트 — iframe 마운트, 파일 로드/저장, 충돌 처리, 닫기 확인 |
| `ui/src/components/RhwpEditor.css` | **신규** | 스타일 (OnlyOffice CSS 패턴 미러) |
| `ui/src/components/__tests__/RhwpEditor.test.tsx` | **신규** | 단위 테스트 — 마운트, 저장, 에러 케이스 |
| `ui/src/components/FileList.tsx` | 수정 | `handleItemDoubleClick` 분기 + `<RhwpEditor>` 모달 마운트 + 사용 가능 여부 fetch |
| `ui/src/components/filelist/ContextMenu.tsx` | 수정 | "한글 문서로 열기" 항목 추가 |
| `ui/vite.config.ts` | 수정 | PWA `navigateFallbackDenylist` 에 `/rhwp-studio/` 추가 (self-host 시 대비) |
| `tests/e2e/files/hwp-viewer.spec.ts` | **신규** | E2E — HWP 업로드 → 더블클릭 → 뷰어 → 저장 → 다운로드 검증 |
| `docker-compose.yml` | 수정 | `RHWP_STUDIO_URL` env 추가 (api+ui 양쪽) |
| `docker-compose-dev.yaml` | 수정 | 동일 |
| `docs/specs/features/preview-editing.md` | 수정 | HWP 섹션 추가 |
| `CLAUDE.md` | 수정 | 테스트 명령에 HWP E2E 포함 안내 |

---

## Task 1: 백엔드 — `/api/rhwp/settings` 핸들러

**Files:**
- Create: `api/handlers/rhwp.go`
- Create: `api/handlers/rhwp_test.go`
- Modify: `api/main.go` (라우트 등록)

- [ ] **Step 1: 실패 테스트 작성**

`api/handlers/rhwp_test.go`:

```go
package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
)

func TestGetRhwpSettings_DefaultStudioUrl(t *testing.T) {
	t.Setenv("RHWP_STUDIO_URL", "")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/rhwp/settings", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := &Handler{}
	if err := h.GetRhwpSettings(c); err != nil {
		t.Fatalf("handler returned error: %v", err)
	}

	assert.Equal(t, http.StatusOK, rec.Code)

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	assert.Equal(t, true, body["enabled"])
	assert.Equal(t, "https://edwardkim.github.io/rhwp/", body["studioUrl"])
}

func TestGetRhwpSettings_OverrideViaEnv(t *testing.T) {
	t.Setenv("RHWP_STUDIO_URL", "https://hwp.example.com/")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/rhwp/settings", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := &Handler{}
	if err := h.GetRhwpSettings(c); err != nil {
		t.Fatalf("handler returned error: %v", err)
	}

	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	assert.Equal(t, "https://hwp.example.com/", body["studioUrl"])
}
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
sudo docker compose -f docker-compose-dev.yaml exec -T api sh -c "cd /app && go test ./handlers/ -run TestGetRhwpSettings -v"
```

기대: `undefined: GetRhwpSettings` 컴파일 에러.

- [ ] **Step 3: 핸들러 작성**

`api/handlers/rhwp.go`:

```go
package handlers

import (
	"net/http"
	"os"
	"strings"

	"github.com/labstack/echo/v4"
)

const defaultRhwpStudioURL = "https://edwardkim.github.io/rhwp/"

// GetRhwpSettings returns rhwp HWP viewer/editor configuration for the frontend.
// studioUrl 은 사용자 브라우저가 iframe 으로 로드하는 정적 자산 경로다.
// 폐쇄망/self-host 시 RHWP_STUDIO_URL 환경 변수로 대체할 수 있다.
func (h *Handler) GetRhwpSettings(c echo.Context) error {
	studioURL := strings.TrimSpace(os.Getenv("RHWP_STUDIO_URL"))
	if studioURL == "" {
		studioURL = defaultRhwpStudioURL
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

- [ ] **Step 4: 라우트 등록**

`api/main.go` — OnlyOffice 라우트(393~396줄) 바로 다음에 추가:

```go
	// rhwp HWP viewer/editor settings (Issue #35)
	api.GET("/rhwp/settings", h.GetRhwpSettings)
```

- [ ] **Step 5: 테스트 재실행 → 통과 확인**

```bash
sudo docker compose -f docker-compose-dev.yaml exec -T api sh -c "cd /app && go test ./handlers/ -run TestGetRhwpSettings -v"
```

기대: `--- PASS: TestGetRhwpSettings_DefaultStudioUrl` + `--- PASS: TestGetRhwpSettings_OverrideViaEnv`

- [ ] **Step 6: 통합 테스트 (curl)**

```bash
sudo docker compose -f docker-compose-dev.yaml restart api
sleep 3
curl -s http://localhost:3080/api/rhwp/settings
```

기대: `{"enabled":true,"studioUrl":"https://edwardkim.github.io/rhwp/"}`

- [ ] **Step 7: 커밋**

```bash
git add api/handlers/rhwp.go api/handlers/rhwp_test.go api/main.go
git commit -m "feat(api): rhwp HWP 뷰어/에디터 settings 엔드포인트 추가 (Issue #35)"
```

---

## Task 2: 프론트엔드 — API 래퍼 + 타입 추가

**Files:**
- Modify: `ui/src/api/files.ts`

- [ ] **Step 1: 타입 + 함수 추가 (파일 끝, fileTypeOptions 뒤)**

`ui/src/api/files.ts` 파일 끝에 추가:

```typescript
// rhwp HWP viewer/editor settings
export interface RhwpSettings {
  enabled: boolean
  studioUrl: string
}

// HWP/HWPX 확장자 검사
export function isHwpSupported(extension: string | undefined): boolean {
  if (!extension) return false
  const ext = extension.toLowerCase().replace(/^\./, '')
  return ext === 'hwp' || ext === 'hwpx'
}

// rhwp settings 조회
export async function getRhwpSettings(): Promise<RhwpSettings> {
  const response = await fetch(`${API_BASE}/rhwp/settings`)
  if (!response.ok) {
    throw new Error('Failed to fetch rhwp settings')
  }
  return response.json()
}

// 바이너리 파일 저장 (HWP 등) — PUT /api/files/content/* 재사용
// 기존 SaveFileContent 핸들러는 c.Request().Body 를 스트림으로 읽으므로 바이너리 OK
export async function saveBinaryFileContent(
  path: string,
  data: ArrayBuffer | Uint8Array,
  mimeType: string,
): Promise<void> {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const encodedPath = cleanPath.split('/').map(s => encodeURIComponent(s)).join('/')
  const response = await fetch(`${API_BASE}/files/content/${encodedPath}`, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      ...getAuthHeaders(),
    },
    body: data instanceof ArrayBuffer ? new Uint8Array(data) : data,
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to save file' }))
    throw new Error(err.error || 'Failed to save file')
  }
}
```

- [ ] **Step 2: getFileTypeIcon 에 hwp 분기 추가**

`ui/src/api/files.ts:613` `getFileTypeIcon()` 함수 안, `audioExts` 다음 줄에 추가:

```typescript
  if (ext === 'hwp' || ext === 'hwpx') return 'hwp'
```

(이미지 매핑은 Task 7 에서 별도 처리)

- [ ] **Step 3: 타입 체크**

```bash
cd /opt/stacks/FileHatch/ui && npx tsc --noEmit
```

기대: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add ui/src/api/files.ts
git commit -m "feat(ui): rhwp settings/저장 API 래퍼 + isHwpSupported 추가"
```

---

## Task 3: `@rhwp/editor` 의존성 추가

**Files:**
- Modify: `ui/package.json`

- [ ] **Step 1: 패키지 설치**

```bash
cd /opt/stacks/FileHatch/ui && npm install @rhwp/editor@^0.7.9
```

기대: `package.json` 의 `dependencies` 에 `"@rhwp/editor": "^0.7.9"` 추가.

- [ ] **Step 2: 의존성 확인**

```bash
cd /opt/stacks/FileHatch/ui && grep '@rhwp/editor' package.json package-lock.json | head -3
```

기대: 두 파일 모두에 진입 확인.

- [ ] **Step 3: 빌드 영향 확인**

```bash
cd /opt/stacks/FileHatch/ui && npm run build 2>&1 | tail -20
```

기대: 기존 빌드 성공 (rhwp 사용처 없으므로 번들 변화 미미).

- [ ] **Step 4: 커밋**

```bash
git add ui/package.json ui/package-lock.json
git commit -m "feat(ui): @rhwp/editor 0.7.9 의존성 추가"
```

---

## Task 4: `RhwpEditor` 컴포넌트 — 마운트 + 파일 로드

**Files:**
- Create: `ui/src/components/RhwpEditor.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`ui/src/components/RhwpEditor.tsx`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import { createEditor, type RhwpEditor as RhwpEditorInstance } from '@rhwp/editor'
import { getFileUrl, getAuthToken, saveBinaryFileContent } from '../api/files'
import './RhwpEditor.css'

interface RhwpEditorProps {
  filePath: string
  fileName: string
  studioUrl: string
  readOnly?: boolean
  onClose: () => void
  onError?: (message: string) => void
  onSaved?: () => void
}

type LoadState = 'loading' | 'ready' | 'error'

function RhwpEditor({
  filePath,
  fileName,
  studioUrl,
  readOnly = false,
  onClose,
  onError,
  onSaved,
}: RhwpEditorProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<RhwpEditorInstance | null>(null)
  const isMountedRef = useRef(true)

  // 콜백을 ref 로 보관해 useEffect 재실행 방지
  const onErrorRef = useRef(onError)
  const onSavedRef = useRef(onSaved)
  onErrorRef.current = onError
  onSavedRef.current = onSaved

  // 1) 에디터 마운트 + 파일 로드
  useEffect(() => {
    isMountedRef.current = true

    const initAndLoad = async () => {
      if (!containerRef.current) return

      try {
        const editor = await createEditor(containerRef.current, {
          studioUrl,
          width: '100%',
          height: '100%',
        })
        if (!isMountedRef.current) {
          editor.destroy()
          return
        }
        editorRef.current = editor

        // 인증된 다운로드 → ArrayBuffer
        const token = getAuthToken()
        const fileUrl = getFileUrl(filePath)
        const resp = await fetch(fileUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!resp.ok) {
          throw new Error(`파일 다운로드 실패: HTTP ${resp.status}`)
        }
        const buffer = await resp.arrayBuffer()
        if (!isMountedRef.current) return

        const result = await editor.loadFile(buffer, fileName)
        if (!isMountedRef.current) return

        setPageCount(result.pageCount)
        setLoadState('ready')
      } catch (err) {
        if (!isMountedRef.current) return
        const msg = err instanceof Error ? err.message : '에디터 로드 실패'
        setErrorMsg(msg)
        setLoadState('error')
        onErrorRef.current?.(msg)
      }
    }

    initAndLoad()

    return () => {
      isMountedRef.current = false
      if (editorRef.current) {
        try {
          editorRef.current.destroy()
        } catch {
          // 무시
        }
        editorRef.current = null
      }
    }
  }, [filePath, fileName, studioUrl])

  // 2) 저장 핸들러 (Task 5 에서 구현 채움)
  const handleSave = useCallback(async () => {
    if (!editorRef.current || isSaving || readOnly) return
    setIsSaving(true)
    try {
      const bytes = await editorRef.current.exportHwp()
      const ext = fileName.toLowerCase().endsWith('.hwpx') ? 'hwpx' : 'hwp'
      const mime = ext === 'hwpx' ? 'application/vnd.hancom.hwpx' : 'application/x-hwp'
      await saveBinaryFileContent(filePath, bytes, mime)
      setIsDirty(false)
      onSavedRef.current?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '저장 실패'
      setErrorMsg(msg)
      onErrorRef.current?.(msg)
    } finally {
      setIsSaving(false)
    }
  }, [filePath, fileName, isSaving, readOnly])

  // 3) Ctrl+S 키바인딩
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!readOnly) handleSave()
      }
      if (e.key === 'Escape') {
        if (isDirty && !readOnly) {
          if (confirm('저장하지 않은 변경사항이 있습니다. 정말 닫으시겠습니까?')) {
            onClose()
          }
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave, isDirty, onClose, readOnly])

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
            {!readOnly && (
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
              <p>한글 문서 로딩 중...</p>
            </div>
          )}
          {loadState === 'error' && (
            <div className="rhwp-error">
              <p>{errorMsg ?? '알 수 없는 오류'}</p>
              <button onClick={onClose}>닫기</button>
            </div>
          )}
          <div
            ref={containerRef}
            className="rhwp-iframe-wrap"
            style={{ display: loadState === 'ready' ? 'block' : 'none' }}
          />
        </div>
      </div>
    </div>
  )
}

export default RhwpEditor
```

- [ ] **Step 2: 타입 체크**

```bash
cd /opt/stacks/FileHatch/ui && npx tsc --noEmit
```

기대: 에러 없음 (CSS 파일 미존재 경고는 다음 Task 에서 해소).

- [ ] **Step 3: 커밋 (CSS 다음 task 와 같이 묶음)**

→ Task 6 마지막에 함께 커밋.

---

## Task 5: 저장 충돌 감지 (`isDirty` 추적)

> Task 4 의 `handleSave` 는 동작하나 `isDirty` 가 항상 false → 항상 저장 가능. rhwp iframe 의 변경 이벤트는 노출되지 않으므로 사용자가 명시적으로 "저장" 버튼을 눌러야 한다는 가정으로 단순화.
>
> 대안 (rhwp 0.8+ 에서 `editor.on('change')` 이벤트가 노출되면): postMessage 리스너 추가. 본 Task 에서는 **저장 버튼은 항상 활성**으로 두고 `isDirty` 추적은 후속 작업으로 미룬다.

**Files:**
- Modify: `ui/src/components/RhwpEditor.tsx`

- [ ] **Step 1: `isDirty` 의도 단순화**

Task 4 의 코드에서 `isDirty` 를 그대로 두되, 닫기 확인 다이얼로그는 **편집 모드일 때만 표시**하도록 안전하게 변경 (사용자가 의도하지 않은 닫기 방지):

`useEffect(() => { const onKey = ...` 안의 Escape 분기를 다음으로 교체:

```typescript
      if (e.key === 'Escape') {
        // rhwp 가 변경 이벤트를 노출하지 않으므로 편집 모드에선 항상 확인
        if (!readOnly && loadState === 'ready') {
          if (confirm('편집 내용이 저장되지 않았을 수 있습니다. 닫으시겠습니까?')) {
            onClose()
          }
        } else {
          onClose()
        }
      }
```

`useEffect` 의존성에 `loadState` 도 추가.

- [ ] **Step 2: 타입 체크**

```bash
cd /opt/stacks/FileHatch/ui && npx tsc --noEmit
```

---

## Task 6: `RhwpEditor.css` — 스타일

**Files:**
- Create: `ui/src/components/RhwpEditor.css`

- [ ] **Step 1: CSS 작성 (OnlyOffice CSS 패턴 준수)**

`ui/src/components/RhwpEditor.css`:

```css
.rhwp-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.5);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rhwp-container {
  width: 95vw;
  height: 95vh;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.rhwp-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: #f4f5f7;
  border-bottom: 1px solid #e5e8eb;
}

.rhwp-title {
  font-weight: 600;
  font-size: 14px;
  color: #191f28;
  flex-shrink: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rhwp-meta {
  font-size: 12px;
  color: #8b95a1;
  white-space: nowrap;
}

.rhwp-beta-badge {
  font-size: 11px;
  font-weight: 600;
  color: #ffffff;
  background: #ff9800;
  padding: 2px 8px;
  border-radius: 8px;
  white-space: nowrap;
}

.rhwp-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.rhwp-btn-save {
  background: #3182f6;
  color: #ffffff;
  border: none;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.rhwp-btn-save:hover:not(:disabled) {
  background: #1b64da;
}

.rhwp-btn-save:disabled {
  background: #c6cdd4;
  cursor: not-allowed;
}

.rhwp-btn-close {
  background: transparent;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  color: #8b95a1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.rhwp-btn-close:hover {
  background: #e5e8eb;
  color: #191f28;
}

.rhwp-body {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.rhwp-iframe-wrap {
  width: 100%;
  height: 100%;
}

.rhwp-iframe-wrap iframe {
  width: 100%;
  height: 100%;
  border: 0;
}

.rhwp-loading,
.rhwp-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.rhwp-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #e5e8eb;
  border-top-color: #3182f6;
  border-radius: 50%;
  animation: rhwp-spin 1s linear infinite;
}

@keyframes rhwp-spin {
  to { transform: rotate(360deg); }
}

.rhwp-error {
  color: #f44336;
}

.rhwp-error button {
  background: #3182f6;
  color: #ffffff;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
}
```

- [ ] **Step 2: 타입 체크 + 빌드 (CSS 파일 인식)**

```bash
cd /opt/stacks/FileHatch/ui && npx tsc --noEmit && npm run build 2>&1 | tail -10
```

기대: 빌드 성공.

- [ ] **Step 3: 커밋 (Task 4-6 일괄)**

```bash
git add ui/src/components/RhwpEditor.tsx ui/src/components/RhwpEditor.css
git commit -m "feat(ui): RhwpEditor 컴포넌트 추가 — HWP/HWPX 미리보기 + 편집/저장"
```

---

## Task 7: 파일 아이콘 — `getFileTypeIcon` + 시각 자산

**Files:**
- Modify: `ui/src/components/FileList.tsx` 또는 `ui/src/api/files.ts` (이미 Task 2 에서 'hwp' 반환 추가됨)
- Modify: 아이콘 매핑 위치 (FileList.tsx 의 `getFileIcon()` switch 또는 CSS class) — 코드를 읽고 결정

- [ ] **Step 1: 기존 아이콘 매핑 위치 파악**

```bash
grep -n "case 'word'\|case 'excel'\|getFileTypeIcon\|file-icon-" /opt/stacks/FileHatch/ui/src/components/FileList.tsx | head -10
grep -rn "file-icon-word\|file-icon-excel" /opt/stacks/FileHatch/ui/src/ | head -10
```

- [ ] **Step 2: `hwp` 아이콘 매핑 추가**

`getFileTypeIcon()` 결과를 사용하는 모든 곳을 찾아 `case 'hwp':` 분기 추가. 단순히 **emoji 또는 텍스트 라벨**로 시작하고, 후속 작업에서 SVG 로 교체 가능:

`ui/src/api/files.ts:613` `getFileTypeIcon()` 함수에 (Task 2 에서 이미 추가됨, 확인만):

```typescript
  if (ext === 'hwp' || ext === 'hwpx') return 'hwp'
```

`ui/src/components/FileList.tsx` 의 아이콘 렌더 함수에 'hwp' 분기 추가 (구현 위치는 Step 1 결과에 맞춤):

```typescript
case 'hwp':
  return <span className="file-icon file-icon-hwp">📄</span>  // 임시 — 후속에서 SVG
```

- [ ] **Step 3: 타입 체크**

```bash
cd /opt/stacks/FileHatch/ui && npx tsc --noEmit
```

- [ ] **Step 4: 커밋**

```bash
git add ui/src/api/files.ts ui/src/components/FileList.tsx
git commit -m "feat(ui): HWP/HWPX 파일 아이콘 매핑 추가"
```

---

## Task 8: `FileList` 라우팅 통합

**Files:**
- Modify: `ui/src/components/FileList.tsx`

- [ ] **Step 1: import 추가 (FileList.tsx 상단)**

기존 import 블록에 추가:

```typescript
import RhwpEditor from './RhwpEditor'
import { getRhwpSettings, isHwpSupported, type RhwpSettings } from '../api/files'
```

- [ ] **Step 2: state + 설정 fetch**

`FileList` 함수 컴포넌트 내부, 다른 useState 들과 함께:

```typescript
  const [hwpViewingFile, setHwpViewingFile] = useState<FileInfo | null>(null)
  const [rhwpSettings, setRhwpSettings] = useState<RhwpSettings | null>(null)

  // rhwp 설정 1회 fetch
  useEffect(() => {
    let cancelled = false
    getRhwpSettings()
      .then(s => { if (!cancelled) setRhwpSettings(s) })
      .catch(() => { /* enabled=false 와 동일 처리 */ })
    return () => { cancelled = true }
  }, [])
```

- [ ] **Step 3: 더블클릭 분기 추가**

`handleItemDoubleClick` (612~626줄) 의 OnlyOffice 분기 **앞**에 HWP 분기 추가:

```typescript
  const handleItemDoubleClick = useCallback((file: FileInfo) => {
    if (file.isDir) {
      onNavigate(file.path)
    } else if (isZipFile(file)) {
      setZipViewingFile(file)
    } else if (isEditableFile(file)) {
      setEditingFile(file)
    } else if (isViewableFile(file)) {
      setViewingFile(file)
    } else if (rhwpSettings?.enabled && isHwpSupported(file.extension)) {
      setHwpViewingFile(file)
    } else if (onlyOfficeAvailable && isOnlyOfficeSupported(file.extension)) {
      handleOnlyOfficeEdit(file)
    } else {
      downloadFileDirect(file.path)
    }
  }, [onNavigate, isEditableFile, isViewableFile, isZipFile, onlyOfficeAvailable, handleOnlyOfficeEdit, rhwpSettings])
```

- [ ] **Step 4: 모달 마운트**

`<OnlyOfficeEditor>` 가 마운트되는 영역(1731~1757줄 부근) 옆에 추가:

```tsx
        {hwpViewingFile && rhwpSettings && (
          <RhwpEditor
            filePath={hwpViewingFile.path}
            fileName={hwpViewingFile.name}
            studioUrl={rhwpSettings.studioUrl}
            onClose={() => setHwpViewingFile(null)}
            onError={(msg) => showError(msg)}
            onSaved={() => {
              showSuccess('저장 완료')
              queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
            }}
          />
        )}
```

(`showSuccess`, `queryClient`, `currentPath` 변수가 컴포넌트에 이미 존재하는지 확인. 없으면 OnlyOffice 부근의 동일 패턴을 그대로 차용.)

- [ ] **Step 5: 빌드 + 타입 체크**

```bash
cd /opt/stacks/FileHatch/ui && npx tsc --noEmit && npm run build 2>&1 | tail -5
```

- [ ] **Step 6: 커밋**

```bash
git add ui/src/components/FileList.tsx
git commit -m "feat(ui): FileList HWP 더블클릭 라우팅 + RhwpEditor 모달 마운트"
```

---

## Task 9: 컨텍스트 메뉴 — "한글 문서로 열기"

**Files:**
- Modify: `ui/src/components/filelist/ContextMenu.tsx`

- [ ] **Step 1: 컨텍스트 메뉴 props 확인**

```bash
grep -n "onOnlyOffice\|isOnlyOfficeSupported\|isHwpSupported" /opt/stacks/FileHatch/ui/src/components/filelist/ContextMenu.tsx /opt/stacks/FileHatch/ui/src/components/filelist/types.ts | head -10
```

- [ ] **Step 2: ContextMenu props 에 `onHwpOpen?: () => void` 추가**

`ContextMenu.tsx` interface 와 부모 사용처 모두에 prop 추가.

```typescript
interface ContextMenuProps {
  // 기존 props...
  onHwpOpen?: () => void
  isHwpSupported?: (ext: string | undefined) => boolean
}
```

- [ ] **Step 3: 메뉴 항목 렌더 (OnlyOffice 항목 옆)**

```tsx
        {file && !file.isDir && isHwpSupported?.(file.extension) && onHwpOpen && (
          <button className="context-menu-item" onClick={() => { onHwpOpen(); onClose(); }}>
            <span>한글 문서로 열기</span>
          </button>
        )}
```

- [ ] **Step 4: `FileList.tsx` 에서 prop 전달 (1630줄 부근 ContextMenu 마운트 지점)**

```tsx
            isHwpSupported={isHwpSupported}
            onHwpOpen={() => contextMenu?.file && setHwpViewingFile(contextMenu.file)}
```

- [ ] **Step 5: 타입 체크**

```bash
cd /opt/stacks/FileHatch/ui && npx tsc --noEmit
```

- [ ] **Step 6: 커밋**

```bash
git add ui/src/components/filelist/ContextMenu.tsx ui/src/components/FileList.tsx
git commit -m "feat(ui): 컨텍스트 메뉴에 '한글 문서로 열기' 추가"
```

---

## Task 10: PWA Service Worker — `/rhwp-studio/` 차단

**Files:**
- Modify: `ui/vite.config.ts`

- [ ] **Step 1: navigateFallbackDenylist 업데이트**

`ui/vite.config.ts:50`:

```typescript
        navigateFallbackDenylist: [/^\/api\//, /^\/onlyoffice\//, /^\/webdav/, /^\/rhwp-studio\//]
```

> 외부 CDN(`https://edwardkim.github.io/rhwp/`) 사용 시에는 영향 없음 (cross-origin). self-host 시 `/rhwp-studio/*` 경로를 SW 가 가로채지 않도록 사전 등록 (OnlyOffice 사고 #25 와 동일 예방).

- [ ] **Step 2: PWA 빌드 확인**

```bash
cd /opt/stacks/FileHatch/ui && npm run build 2>&1 | grep -E "(workbox|sw|denylist)" | head -5
```

- [ ] **Step 3: 커밋**

```bash
git add ui/vite.config.ts
git commit -m "chore(ui): PWA SW denylist 에 /rhwp-studio/ 추가"
```

---

## Task 11: docker-compose 환경 변수

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose-dev.yaml`

- [ ] **Step 1: docker-compose.yml — api 서비스 environment 에 추가**

`docker-compose.yml` 의 `api` 서비스 environment 끝 (`EXTERNAL_URL` 다음 줄):

```yaml
      - RHWP_STUDIO_URL=${RHWP_STUDIO_URL:-}
```

- [ ] **Step 2: docker-compose-dev.yaml 도 동일 변경**

같은 위치에 `RHWP_STUDIO_URL=${RHWP_STUDIO_URL:-}` 추가.

- [ ] **Step 3: 재시작 + 검증**

```bash
sudo docker compose -f docker-compose-dev.yaml up -d api
sleep 3
curl -s http://localhost:3080/api/rhwp/settings
```

기대: 기본값 응답 정상 (`https://edwardkim.github.io/rhwp/`).

```bash
RHWP_STUDIO_URL='https://hwp.example.com/' sudo docker compose -f docker-compose-dev.yaml up -d api
sleep 3
curl -s http://localhost:3080/api/rhwp/settings
```

기대: `studioUrl` 이 override 됨.

```bash
# 원복
sudo docker compose -f docker-compose-dev.yaml up -d api
```

- [ ] **Step 4: 커밋**

```bash
git add docker-compose.yml docker-compose-dev.yaml
git commit -m "chore: RHWP_STUDIO_URL 환경 변수 docker-compose 등록"
```

---

## Task 12: 단위 테스트 — RhwpEditor 컴포넌트

**Files:**
- Create: `ui/src/components/__tests__/RhwpEditor.test.tsx`

- [ ] **Step 1: 테스트 작성**

`ui/src/components/__tests__/RhwpEditor.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import RhwpEditor from '../RhwpEditor'

// @rhwp/editor 모킹
vi.mock('@rhwp/editor', () => ({
  createEditor: vi.fn(),
}))

// API 모킹
vi.mock('../../api/files', () => ({
  getFileUrl: (p: string) => `/api/files/${p}`,
  getAuthToken: () => 'test-token',
  saveBinaryFileContent: vi.fn(),
}))

import { createEditor } from '@rhwp/editor'
import { saveBinaryFileContent } from '../../api/files'

const mockCreateEditor = createEditor as ReturnType<typeof vi.fn>
const mockSave = saveBinaryFileContent as ReturnType<typeof vi.fn>

function makeFakeEditor() {
  return {
    loadFile: vi.fn().mockResolvedValue({ pageCount: 3 }),
    pageCount: vi.fn().mockResolvedValue(3),
    getPageSvg: vi.fn(),
    exportHwp: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    element: document.createElement('iframe'),
    destroy: vi.fn(),
  }
}

describe('RhwpEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // fetch 모킹 — 인증된 다운로드 시뮬레이션
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response)
  })

  it('마운트 시 createEditor + loadFile 을 호출하고 페이지 수를 표시', async () => {
    const fake = makeFakeEditor()
    mockCreateEditor.mockResolvedValue(fake)

    render(
      <RhwpEditor
        filePath="/home/user/sample.hwp"
        fileName="sample.hwp"
        studioUrl="https://edwardkim.github.io/rhwp/"
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(mockCreateEditor).toHaveBeenCalledTimes(1)
      expect(fake.loadFile).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText('3페이지')).toBeInTheDocument()
    expect(screen.getByText('베타')).toBeInTheDocument()
  })

  it('저장 버튼 클릭 시 exportHwp + saveBinaryFileContent 를 호출', async () => {
    const fake = makeFakeEditor()
    mockCreateEditor.mockResolvedValue(fake)
    mockSave.mockResolvedValue(undefined)
    const onSaved = vi.fn()

    render(
      <RhwpEditor
        filePath="/home/user/sample.hwp"
        fileName="sample.hwp"
        studioUrl="https://edwardkim.github.io/rhwp/"
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    )

    const btn = await screen.findByText(/저장/, { exact: false })
    btn.click()

    await waitFor(() => {
      expect(fake.exportHwp).toHaveBeenCalledTimes(1)
      expect(mockSave).toHaveBeenCalledWith(
        '/home/user/sample.hwp',
        expect.any(Uint8Array),
        'application/x-hwp',
      )
      expect(onSaved).toHaveBeenCalled()
    })
  })

  it('readOnly=true 일 때 저장 버튼이 렌더링되지 않음', async () => {
    const fake = makeFakeEditor()
    mockCreateEditor.mockResolvedValue(fake)

    render(
      <RhwpEditor
        filePath="/sample.hwp"
        fileName="sample.hwp"
        studioUrl="https://edwardkim.github.io/rhwp/"
        readOnly
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(mockCreateEditor).toHaveBeenCalled())
    expect(screen.queryByText(/저장/)).not.toBeInTheDocument()
  })

  it('createEditor 실패 시 에러 메시지 표시 + onError 콜백', async () => {
    mockCreateEditor.mockRejectedValue(new Error('iframe load failed'))
    const onError = vi.fn()

    render(
      <RhwpEditor
        filePath="/sample.hwp"
        fileName="sample.hwp"
        studioUrl="https://edwardkim.github.io/rhwp/"
        onClose={vi.fn()}
        onError={onError}
      />
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('iframe load failed')
    })
    expect(await screen.findByText('iframe load failed')).toBeInTheDocument()
  })

  it('hwpx 확장자는 application/vnd.hancom.hwpx MIME 으로 저장', async () => {
    const fake = makeFakeEditor()
    mockCreateEditor.mockResolvedValue(fake)
    mockSave.mockResolvedValue(undefined)

    render(
      <RhwpEditor
        filePath="/foo.hwpx"
        fileName="foo.hwpx"
        studioUrl="https://edwardkim.github.io/rhwp/"
        onClose={vi.fn()}
      />
    )

    const btn = await screen.findByText(/저장/, { exact: false })
    btn.click()

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        '/foo.hwpx',
        expect.any(Uint8Array),
        'application/vnd.hancom.hwpx',
      )
    })
  })
})
```

- [ ] **Step 2: 테스트 실행**

```bash
cd /opt/stacks/FileHatch/ui && npx vitest run src/components/__tests__/RhwpEditor.test.tsx
```

기대: 5/5 통과.

- [ ] **Step 3: 커밋**

```bash
git add ui/src/components/__tests__/RhwpEditor.test.tsx
git commit -m "test(ui): RhwpEditor 단위 테스트 (마운트/저장/readOnly/에러/MIME)"
```

---

## Task 13: 단위 테스트 — `isHwpSupported` + `saveBinaryFileContent`

**Files:**
- Create: `ui/src/api/__tests__/files.hwp.test.ts`

- [ ] **Step 1: 테스트 작성**

`ui/src/api/__tests__/files.hwp.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isHwpSupported, saveBinaryFileContent } from '../files'

describe('isHwpSupported', () => {
  it.each([
    ['hwp', true],
    ['hwpx', true],
    ['HWP', true],
    ['.hwp', true],
    ['.HWPX', true],
    ['docx', false],
    ['pdf', false],
    [undefined, false],
    ['', false],
  ])('확장자 %s → %s', (ext, expected) => {
    expect(isHwpSupported(ext)).toBe(expected)
  })
})

describe('saveBinaryFileContent', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('PUT /api/files/content/<path> 에 바이너리 본문 + Content-Type 으로 호출', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response)
    global.fetch = fetchMock

    const data = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) // OLE2 매직 바이트
    await saveBinaryFileContent('/home/user/a b/sample.hwp', data, 'application/x-hwp')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/files/content/home/user/a%20b/sample.hwp')
    expect(opts.method).toBe('PUT')
    expect(opts.headers['Content-Type']).toBe('application/x-hwp')
    expect(opts.body).toBeInstanceOf(Uint8Array)
  })

  it('실패 시 서버 에러 메시지를 throw', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: '권한 없음' }),
    } as Response)

    await expect(
      saveBinaryFileContent('/x.hwp', new Uint8Array(0), 'application/x-hwp'),
    ).rejects.toThrow('권한 없음')
  })
})
```

- [ ] **Step 2: 실행**

```bash
cd /opt/stacks/FileHatch/ui && npx vitest run src/api/__tests__/files.hwp.test.ts
```

- [ ] **Step 3: 커밋**

```bash
git add ui/src/api/__tests__/files.hwp.test.ts
git commit -m "test(ui): isHwpSupported + saveBinaryFileContent 단위 테스트"
```

---

## Task 14: E2E 테스트 — 업로드 → 더블클릭 → 뷰어 → 저장

**Files:**
- Create: `tests/e2e/files/hwp-viewer.spec.ts`
- Create: `tests/e2e/fixtures/sample.hwp` (또는 기존 fixture 재사용)

- [ ] **Step 1: 샘플 HWP 파일 준비**

```bash
# rhwp 저장소에서 샘플 HWP 다운로드 (LICENSE: MIT)
curl -L -o /opt/stacks/FileHatch/tests/e2e/fixtures/sample.hwp \
  https://raw.githubusercontent.com/edwardkim/rhwp/main/samples/basic.hwp
ls -la /opt/stacks/FileHatch/tests/e2e/fixtures/sample.hwp
```

기대: 파일 존재 + 크기 > 1KB. (실패 시 별도 샘플 확보 필요 — 단순 빈 파일도 OK, 단 rhwp 가 거부할 수 있음)

- [ ] **Step 2: E2E 스펙 작성**

`tests/e2e/files/hwp-viewer.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: path.join(__dirname, '../playwright/.auth/admin.json') })

test('HWP 파일을 더블클릭하면 RhwpEditor 모달이 열린다', async ({ page }) => {
  await page.goto('/')

  // 1) 샘플 HWP 업로드
  const fixturePath = path.join(__dirname, '../fixtures/sample.hwp')
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(fixturePath)
  await expect(page.getByText('sample.hwp')).toBeVisible({ timeout: 10000 })

  // 2) 더블클릭 → RhwpEditor 오픈
  await page.getByText('sample.hwp').dblclick()
  await expect(page.locator('.rhwp-overlay')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.rhwp-title')).toContainText('sample.hwp')
  await expect(page.locator('.rhwp-beta-badge')).toBeVisible()

  // 3) iframe 로드 대기
  const iframe = page.frameLocator('.rhwp-iframe-wrap iframe').first()
  // rhwp-studio 의 menu-bar 가 로드되는지로 도달 검증
  await expect(iframe.locator('#menu-bar, #studio-root').first()).toBeVisible({
    timeout: 30000,
  })

  // 4) 닫기 버튼
  await page.locator('.rhwp-btn-close').click()
  await expect(page.locator('.rhwp-overlay')).not.toBeVisible()

  // 5) 정리
  await page.getByText('sample.hwp').click({ button: 'right' })
  await page.getByText('삭제').click()
  await page.getByText('확인').click()
})

test('저장 버튼 클릭 시 PUT /api/files/content/* 가 호출된다', async ({ page }) => {
  await page.goto('/')

  // 업로드 (위와 동일)
  const fixturePath = path.join(__dirname, '../fixtures/sample.hwp')
  await page.locator('input[type="file"]').setInputFiles(fixturePath)
  await expect(page.getByText('sample.hwp')).toBeVisible({ timeout: 10000 })

  // 더블클릭
  await page.getByText('sample.hwp').dblclick()
  await expect(page.locator('.rhwp-overlay')).toBeVisible({ timeout: 5000 })
  // iframe 준비 대기
  const iframe = page.frameLocator('.rhwp-iframe-wrap iframe').first()
  await expect(iframe.locator('#menu-bar, #studio-root').first()).toBeVisible({
    timeout: 30000,
  })

  // 저장 요청 인터셉트
  const savePromise = page.waitForRequest(
    req => req.method() === 'PUT' && req.url().includes('/api/files/content/'),
    { timeout: 10000 },
  )
  await page.locator('.rhwp-btn-save').click()
  const saveReq = await savePromise

  expect(saveReq.headers()['content-type']).toContain('application/x-hwp')

  // 정리
  await page.locator('.rhwp-btn-close').click()
  await page.getByText('sample.hwp').click({ button: 'right' })
  await page.getByText('삭제').click()
  await page.getByText('확인').click()
})
```

- [ ] **Step 3: E2E 실행**

```bash
cd /opt/stacks/FileHatch/tests/e2e && npx playwright test files/hwp-viewer.spec.ts --reporter=line
```

기대: 2/2 통과 (rhwp CDN 접근 가능 환경 한정).

- [ ] **Step 4: 커밋**

```bash
git add tests/e2e/files/hwp-viewer.spec.ts tests/e2e/fixtures/sample.hwp
git commit -m "test(e2e): HWP 뷰어 — 업로드/뷰어 표시/저장 흐름 검증"
```

---

## Task 15: 스펙 문서 업데이트

**Files:**
- Modify: `docs/specs/features/preview-editing.md`

- [ ] **Step 1: 지원 포맷 표에 HWP 행 추가**

`docs/specs/features/preview-editing.md` 2.1 절 표에 추가:

```markdown
| 한글 | hwp, hwpx | `application/x-hwp`, `application/vnd.hancom.hwpx` | rhwp 임베드 (iframe) | - |
```

- [ ] **Step 2: 새 섹션 추가 (OnlyOffice 섹션 뒤)**

```markdown
## N. rhwp HWP 뷰어/에디터 (Issue #35)

### 개요

[rhwp](https://github.com/edwardkim/rhwp) (Rust + WASM 기반 오픈소스 HWP 엔진, MIT) 의 `@rhwp/editor` npm 패키지를 iframe 임베드 방식으로 통합한다. OnlyOffice 와 달리 별도 Docker 컨테이너 없이 정적 자산만 호스팅한다.

### 구성

- **백엔드**: `GET /api/rhwp/settings` 가 `studioUrl` 노출 (`RHWP_STUDIO_URL` 환경 변수, 기본값 `https://edwardkim.github.io/rhwp/`)
- **프론트엔드**: `RhwpEditor.tsx` 컴포넌트가 iframe 마운트 + 인증된 파일 다운로드 → `editor.loadFile(buffer)` 로 전달
- **저장**: `editor.exportHwp()` → `Uint8Array` → `PUT /api/files/content/*` (기존 `SaveFileContent` 핸들러 재사용, 바이너리 스트림 OK)

### 파일 흐름

```
[더블클릭]
  ↓
FileList.handleItemDoubleClick → isHwpSupported → setHwpViewingFile
  ↓
<RhwpEditor> 마운트
  ↓
createEditor(container, { studioUrl })  // iframe 생성
  ↓
fetch(getFileUrl(path), Authorization)  → ArrayBuffer
  ↓
editor.loadFile(buffer, fileName)       // postMessage to iframe
  ↓
[사용자 편집]
  ↓
editor.exportHwp() → Uint8Array
  ↓
PUT /api/files/content/<path>          // 감사 로그 EventFileEdit 자동 기록
```

### 환경 변수

| 변수 | 기본값 | 용도 |
|------|--------|------|
| `RHWP_STUDIO_URL` | `https://edwardkim.github.io/rhwp/` | iframe SRC. 폐쇄망/self-host 시 내부 정적 자산 URL 로 교체 |

### 제약 사항 (rhwp v0.7.x)

- 조판 품질이 한컴보다 일부 떨어질 수 있음 (대부분 일반 문서는 정상)
- HWPX 출처 문서 저장은 rhwp 자체적으로 비활성화 (#196 — HWPX→HWP 변환 안정성 #197 해결 시까지)
- UI 에 "베타" 배지로 안내
```

- [ ] **Step 3: 커밋**

```bash
git add docs/specs/features/preview-editing.md
git commit -m "docs: HWP 뷰어/에디터 스펙 추가 (preview-editing.md)"
```

---

## Task 16: 버전 bump + 통합 빌드 검증

**Files:**
- Modify: `api/version.go`
- Modify: `ui/package.json`

- [ ] **Step 1: 두 파일 동시 bump 0.13.3 → 0.14.0 (minor — 신규 기능)**

`api/version.go`:

```go
	Version   = "0.14.0"
```

`ui/package.json`:

```json
  "version": "0.14.0",
```

- [ ] **Step 2: 동기화 확인**

```bash
grep 'Version.*=' /opt/stacks/FileHatch/api/version.go
grep '"version"' /opt/stacks/FileHatch/ui/package.json
```

- [ ] **Step 3: 전체 테스트 스위트 실행**

```bash
cd /opt/stacks/FileHatch && ./scripts/test.sh
```

기대: 전부 통과.

- [ ] **Step 4: Lint (CI 와 동일 환경)**

```bash
sudo docker run --rm -v /opt/stacks/FileHatch/api:/app -w /app golangci/golangci-lint:latest golangci-lint run --timeout=5m ./...
```

기대: error 0건.

- [ ] **Step 5: Docker 재빌드 + 헬스체크**

```bash
cd /opt/stacks/FileHatch && \
  sudo docker compose -f docker-compose-dev.yaml build --no-cache api ui && \
  sudo docker compose -f docker-compose-dev.yaml down api ui && \
  sudo docker compose -f docker-compose-dev.yaml up -d api ui
sleep 10
curl -s http://localhost:3080/health
curl -s http://localhost:3080/api/version
curl -s http://localhost:3080/api/rhwp/settings
```

기대:
- `/health` → OK
- `/api/version` → `{"version":"0.14.0",...}`
- `/api/rhwp/settings` → `{"enabled":true,"studioUrl":"https://edwardkim.github.io/rhwp/"}`

- [ ] **Step 6: 브라우저 수동 검증 (CLAUDE.md 필수 규칙)**

다음 시나리오를 브라우저에서 직접 수행:

1. http://localhost:3080 로그인
2. HWP 파일 업로드 (또는 fixture 사용) — `tests/e2e/fixtures/sample.hwp`
3. 파일 더블클릭 → RhwpEditor 모달 오픈 확인
4. iframe 안의 rhwp-studio UI 가 표시되는지 확인 (메뉴바, 페이지 영역)
5. "베타" 배지 + 페이지 수 표시 확인
6. 편집 후 "저장" 버튼 → 토스트 "저장 완료" 표시 확인
7. 모달 닫기 → 파일 목록 새로고침 확인 (modified time 갱신)
8. 컨텍스트 메뉴에 "한글 문서로 열기" 메뉴 표시 확인
9. ESC 키로 모달 닫기 (편집 모드 시 확인 다이얼로그) 확인

전 시나리오 정상 동작 시 다음 단계로.

- [ ] **Step 7: 커밋**

```bash
git add api/version.go ui/package.json
git commit -m "chore: 버전 0.14.0 — HWP 뷰어/에디터 통합 (Issue #35)"
```

---

## Task 17: 태그 생성 및 릴리즈

- [ ] **Step 1: 태그 생성 (verbatim cleanup)**

```bash
cd /opt/stacks/FileHatch && \
git tag --cleanup=verbatim -a v0.14.0 -m "$(cat <<'TAGEOF'
feat: 한글(HWP/HWPX) 문서 미리보기 + 편집/저장 (Issue #35, v0.14.0)

## What's New

[rhwp](https://github.com/edwardkim/rhwp) (Rust + WASM 기반 오픈소스 HWP
엔진, MIT 라이선스) 를 iframe 임베드 방식으로 통합. HWP/HWPX 파일을
브라우저 안에서 직접 보고 편집·저장할 수 있게 됨.

### 사용법

HWP/HWPX 파일을 더블클릭하면 자동으로 한글 에디터가 열립니다.
- 메뉴: 파일 컨텍스트 메뉴 → "한글 문서로 열기"
- 단축키: 저장 = Ctrl+S, 닫기 = ESC

### 환경 변수 (선택)

폐쇄망/self-host 환경에서는 `RHWP_STUDIO_URL` 로 내부 정적 자산
URL 을 지정할 수 있습니다. 기본값은 rhwp 공식 CDN
(https://edwardkim.github.io/rhwp/) 입니다.

### 제약 사항 (rhwp v0.7.x — 베타)

- 조판 품질은 한컴보다 일부 떨어질 수 있습니다 (일반 문서 정상)
- HWPX 출처 문서 저장은 rhwp 자체적으로 비활성화되어 있습니다 (#196)
- UI 에 "베타" 배지로 안내됩니다

## Upgrade

```bash
docker compose pull
docker compose up -d
```
TAGEOF
)"
```

- [ ] **Step 2: 푸시**

```bash
cd /opt/stacks/FileHatch && \
  git push origin main && \
  git push origin v0.14.0
```

- [ ] **Step 3: 워크플로우 검증**

```bash
sleep 15
gh run list --workflow=release.yml --limit 1
# 완료 대기
RUN_ID=$(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
until [ "$(gh run view $RUN_ID --json status --jq .status)" = "completed" ]; do sleep 30; done
gh run view $RUN_ID --json conclusion --jq .conclusion
```

기대: `success`.

- [ ] **Step 4: Docker Hub `:latest` 검증**

```bash
for c in api ui samba; do
  curl -s "https://hub.docker.com/v2/repositories/svrforum/filehatch-$c/tags/?page_size=3" 2>/dev/null \
    | jq -r --arg c "$c" '.results[] | select(.name=="latest" or .name=="0.14.0") | "filehatch-\($c) \(.name): \(.digest // .images[0].digest)"'
done
```

기대: 각 컴포넌트의 `:latest` digest = `0.14.0` digest (v0.13.3 에서 수정한 워크플로우 검증).

- [ ] **Step 5: 이슈 #35 댓글 + 종료**

```bash
gh issue comment 35 --body "$(cat <<'EOF'
v0.14.0 에서 [rhwp](https://github.com/edwardkim/rhwp) 통합 완료했습니다.

HWP/HWPX 파일을 더블클릭하면 자동으로 한글 에디터가 열립니다. 편집 후 Ctrl+S 또는 저장 버튼으로 저장 가능합니다.

## 사용
```bash
docker compose pull
docker compose up -d
```

## 폐쇄망 사용 시
`RHWP_STUDIO_URL` 환경 변수로 내부 정적 자산 URL 을 지정할 수 있습니다. 기본값은 rhwp 공식 CDN(https://edwardkim.github.io/rhwp/) 입니다.

## 제약 사항 (rhwp v0.7.x — 베타)
- 조판 품질은 한컴보다 일부 떨어질 수 있습니다 (대부분 정상 동작)
- HWPX 저장은 rhwp 측에서 일부 제한이 있습니다 (#196)
- 안정화는 rhwp v1.0 도달 시점에 자동으로 따라옵니다 (npm 업데이트만으로)

좋은 건의 감사합니다.

릴리즈: https://github.com/svrforum/FileHatch/releases/tag/v0.14.0
EOF
)"

gh issue close 35 --reason completed
```

---

## 자체 점검 체크리스트 (Self-Review)

작업 완료 후 다음을 확인:

- [ ] 모든 Task 의 Step 5 (커밋) 가 단일 작성자로 commit (`git log --format='%an'` 확인)
- [ ] 백엔드 단위 테스트 통과 (`go test ./handlers/...`)
- [ ] 프론트엔드 단위 테스트 통과 (`npx vitest run`)
- [ ] E2E 테스트 통과 (`npx playwright test files/hwp-viewer.spec.ts`)
- [ ] 타입 체크 통과 (`npx tsc --noEmit`)
- [ ] golangci-lint 에러 0건
- [ ] `/api/rhwp/settings` 가 기본값 + override 둘 다 정상
- [ ] HWP 파일 더블클릭 → 모달 오픈 → iframe 표시 → 저장 → modified time 갱신 (브라우저 수동 검증)
- [ ] `:latest` Docker Hub digest = `0.14.0` digest 일치
- [ ] 이슈 #35 종료
- [ ] CLAUDE.md 의 릴리즈 전 8단계 체크리스트 모두 통과

## 후속 작업 (이번 PR 범위 밖)

- rhwp v1.0 도달 시 npm 패키지 업데이트 (조판 품질 향상 자동 반영)
- self-host 모드 — UI Docker 빌드에 rhwp-studio 정적 자산 번들 (Phase 3)
- 공유 페이지(`ShareAccessPage.tsx`) HWP 미리보기 통합
- HWP 신규 생성 메뉴 (`fileTypeOptions` 에 추가) — rhwp `hwpctl-test.html` 의 빈 문서 생성 API 활용
- 한국 사용자 비중에 따라 HWP 아이콘 SVG 디자인 의뢰
