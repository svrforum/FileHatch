# 최근 항목 삭제/정리 기능 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** "내 작업 → 최근 항목" 목록에서 개별 항목 및 전체 항목을 삭제(숨김)할 수 있는 기능 추가

**Architecture:** `hidden_recent_items` DB 테이블로 숨김 처리. `audit_logs`는 보존하고, `GetRecentFiles` SQL 쿼리에 LEFT JOIN으로 숨긴 항목 제외. 프론트엔드는 컨텍스트 메뉴(개별) + 헤더 버튼(전체)으로 제공.

**Tech Stack:** Go + Echo (backend), React + TypeScript + Zustand (frontend), PostgreSQL (DB)

---

### Task 1: DB 마이그레이션 파일 생성

**Files:**
- Create: `api/database/migrations/006_hidden_recent_items.sql`

**Step 1: 마이그레이션 SQL 파일 작성**

```sql
-- Hidden recent items table for "내 작업 → 최근 항목" hide/clear feature
CREATE TABLE IF NOT EXISTS hidden_recent_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path VARCHAR(1024) NOT NULL,
    hidden_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_hidden_recent_user ON hidden_recent_items(user_id);

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES ('20240101000006', '006_hidden_recent_items')
ON CONFLICT (version) DO NOTHING;
```

**Step 2: 마이그레이션 파일 검증**

Run: `grep "INSERT INTO schema_migrations" api/database/migrations/006_hidden_recent_items.sql`
Expected: `INSERT INTO schema_migrations (version, name) VALUES ('20240101000006', '006_hidden_recent_items')`

**Step 3: `db/init.sql`에 테이블 추가**

`db/init.sql` 파일 끝에 `hidden_recent_items` 테이블 CREATE 문 추가 (멱등성 보장):

```sql
-- Hidden recent items (for "내 작업" recent items hide feature)
CREATE TABLE IF NOT EXISTS hidden_recent_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path VARCHAR(1024) NOT NULL,
    hidden_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_hidden_recent_user ON hidden_recent_items(user_id);
```

**Step 4: Commit**

```bash
git add api/database/migrations/006_hidden_recent_items.sql db/init.sql
git commit -m "feat: add hidden_recent_items migration for recent items hide feature"
```

---

### Task 2: Backend - 개별 항목 숨기기 API (`POST /files/recent/hide`)

**Files:**
- Modify: `api/handlers/audit.go` (add `HideRecentItem` method)
- Modify: `api/main.go` (register route)

**Step 1: Request DTO 추가**

`api/handlers/audit.go`에 `GetRecentFiles` 함수 위(약 line 1210 부근)에 추가:

```go
// HideRecentItemRequest is the request body for hiding a recent item
type HideRecentItemRequest struct {
	FilePath string `json:"file_path"`
}
```

**Step 2: `HideRecentItem` 핸들러 작성**

`api/handlers/audit.go`에 `GetRecentFiles` 메서드 뒤에 추가:

```go
// HideRecentItem hides a file from the recent items list
func (h *AuditHandler) HideRecentItem(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	var req HideRecentItemRequest
	if err := c.Bind(&req); err != nil {
		return RespondError(c, ErrValidation("Invalid request body", nil))
	}

	if req.FilePath == "" {
		return RespondError(c, ErrValidation("file_path is required", nil))
	}

	_, err = h.db.Exec(`
		INSERT INTO hidden_recent_items (user_id, file_path)
		VALUES ((SELECT id FROM users WHERE id::text = $1), $2)
		ON CONFLICT (user_id, file_path) DO NOTHING
	`, claims.UserID, req.FilePath)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to hide recent item"))
	}

	return RespondSuccess(c, map[string]string{"message": "ok"})
}
```

**Step 3: 라우트 등록**

`api/main.go`에서 기존 `/files/recent` GET 라우트(line 407) 아래에 추가:

```go
	authApi.POST("/files/recent/hide", auditHandler.HideRecentItem)
```

**Step 4: 빌드 확인**

Run: `cd /opt/stacks/FileHatch/api && go build ./...`
Expected: 빌드 성공 (exit 0)

**Step 5: Commit**

```bash
git add api/handlers/audit.go api/main.go
git commit -m "feat: add POST /files/recent/hide API endpoint"
```

---

### Task 3: Backend - 전체 항목 숨기기 API (`DELETE /files/recent`)

**Files:**
- Modify: `api/handlers/audit.go` (add `ClearRecentItems` method)
- Modify: `api/main.go` (register route)

**Step 1: `ClearRecentItems` 핸들러 작성**

`api/handlers/audit.go`에 `HideRecentItem` 메서드 뒤에 추가:

```go
// ClearRecentItems hides all current recent items for the user
func (h *AuditHandler) ClearRecentItems(c echo.Context) error {
	claims, err := RequireClaims(c)
	if err != nil {
		return err
	}

	// Get all current visible recent items and insert them into hidden_recent_items
	result, err := h.db.Exec(`
		INSERT INTO hidden_recent_items (user_id, file_path)
		SELECT u.id, rf.target_resource
		FROM (
			SELECT DISTINCT ON (target_resource) target_resource
			FROM audit_logs
			WHERE actor_id = $1
			  AND event_type IN ('file.upload', 'file.download', 'file.view', 'file.edit', 'file.copy', 'file.move', 'file.rename', 'folder.create', 'trash.restore')
			  AND target_resource IS NOT NULL
			  AND target_resource != ''
		) rf
		CROSS JOIN users u
		WHERE u.id::text = $1
		ON CONFLICT (user_id, file_path) DO NOTHING
	`, claims.UserID)
	if err != nil {
		return RespondError(c, ErrInternal("Failed to clear recent items"))
	}

	hiddenCount, _ := result.RowsAffected()

	return RespondSuccess(c, map[string]interface{}{
		"message":      "ok",
		"hidden_count": hiddenCount,
	})
}
```

**Step 2: 라우트 등록**

`api/main.go`에서 `POST /files/recent/hide` 라우트 아래에 추가:

```go
	authApi.DELETE("/files/recent", auditHandler.ClearRecentItems)
```

**Step 3: 빌드 확인**

Run: `cd /opt/stacks/FileHatch/api && go build ./...`
Expected: 빌드 성공 (exit 0)

**Step 4: Commit**

```bash
git add api/handlers/audit.go api/main.go
git commit -m "feat: add DELETE /files/recent API for clearing all recent items"
```

---

### Task 4: Backend - `GetRecentFiles` SQL 수정 (숨김 항목 제외)

**Files:**
- Modify: `api/handlers/audit.go` (modify `GetRecentFiles` SQL query, lines 1246-1263)

**Step 1: SQL 쿼리에 LEFT JOIN 추가**

`GetRecentFiles` 메서드의 SQL 쿼리(line 1246 `rows, err := h.db.Query(` 부분)를 수정:

기존:
```sql
WITH ranked_files AS (
    SELECT
        target_resource,
        event_type,
        ts,
        ROW_NUMBER() OVER (PARTITION BY target_resource ORDER BY ts DESC) as rn
    FROM audit_logs
    WHERE actor_id = $1
      AND event_type IN ('file.upload', 'file.download', 'file.view', 'file.edit', 'file.copy', 'file.move', 'file.rename', 'folder.create', 'trash.restore')
      AND target_resource IS NOT NULL
      AND target_resource != ''
)
SELECT target_resource, event_type, ts
FROM ranked_files
WHERE rn = 1
ORDER BY ts DESC
LIMIT $2
```

변경:
```sql
WITH ranked_files AS (
    SELECT
        target_resource,
        event_type,
        ts,
        ROW_NUMBER() OVER (PARTITION BY target_resource ORDER BY ts DESC) as rn
    FROM audit_logs
    WHERE actor_id = $1
      AND event_type IN ('file.upload', 'file.download', 'file.view', 'file.edit', 'file.copy', 'file.move', 'file.rename', 'folder.create', 'trash.restore')
      AND target_resource IS NOT NULL
      AND target_resource != ''
)
SELECT rf.target_resource, rf.event_type, rf.ts
FROM ranked_files rf
LEFT JOIN hidden_recent_items hri
    ON hri.user_id = (SELECT id FROM users WHERE id::text = $1)
    AND hri.file_path = rf.target_resource
WHERE rf.rn = 1
  AND hri.id IS NULL
ORDER BY rf.ts DESC
LIMIT $2
```

핵심: `LEFT JOIN hidden_recent_items` + `hri.id IS NULL`로 숨긴 항목 필터링.

**Step 2: 빌드 확인**

Run: `cd /opt/stacks/FileHatch/api && go build ./...`
Expected: 빌드 성공 (exit 0)

**Step 3: Commit**

```bash
git add api/handlers/audit.go
git commit -m "feat: exclude hidden items from GetRecentFiles query"
```

---

### Task 5: Frontend - API 함수 추가

**Files:**
- Modify: `ui/src/api/files.ts` (add `hideRecentItem`, `clearAllRecentItems`)

**Step 1: API 함수 2개 추가**

`ui/src/api/files.ts`에서 `getRecentFiles` 함수(약 line 962) 뒤에 추가:

```typescript
export async function hideRecentItem(filePath: string): Promise<{ message: string }> {
  return api.post<{ message: string }>('/files/recent/hide', { file_path: filePath })
}

export async function clearAllRecentItems(): Promise<{ message: string; hidden_count: number }> {
  return api.delete<{ message: string; hidden_count: number }>('/files/recent')
}
```

**주의:** `api.get`의 `getRecentFiles`는 `result.data`를 언래핑하지만, `post`/`delete`는 `RespondSuccess` 응답의 `data` 필드가 직접 반환됨. `client.ts`의 `request<T>`가 `response.json()` 전체를 반환하므로, 실제 반환값은 `{ data: { message: "ok" } }` 형태. `getRecentFiles` 패턴처럼 `.data`를 언래핑해야 할 수 있음 — Docker 테스트로 확인 필요.

**Step 2: TypeScript 빌드 확인**

Run: `cd /opt/stacks/FileHatch/ui && npx tsc --noEmit`
Expected: 에러 없음

**Step 3: Commit**

```bash
git add ui/src/api/files.ts
git commit -m "feat: add hideRecentItem and clearAllRecentItems API functions"
```

---

### Task 6: Frontend - MyActivity 컨텍스트 메뉴에 "최근 항목에서 제거" 추가

**Files:**
- Modify: `ui/src/components/MyActivity.tsx` (add hide handler + context menu item)
- Modify: `ui/src/components/MyActivity.css` (add divider style)

**Step 1: import 추가**

`MyActivity.tsx` 상단 import에 `hideRecentItem`을 추가:

```typescript
import { getRecentFiles, hideRecentItem } from '../api/files'
```

(기존 `getRecentFiles` import 라인에 `hideRecentItem` 추가)

**Step 2: 핸들러 추가**

`handleCopyPath` 핸들러(약 line 400) 뒤에 추가:

```typescript
  const handleHideRecent = useCallback(async () => {
    if (contextMenu) {
      try {
        await hideRecentItem(contextMenu.path)
        setActivities(prev => prev.filter(a => a.path !== contextMenu.path))
      } catch (error) {
        console.error('Failed to hide recent item:', error)
      }
    }
    setContextMenu(null)
  }, [contextMenu])
```

**Step 3: 컨텍스트 메뉴에 구분선 + 버튼 추가**

`MyActivity.tsx`의 컨텍스트 메뉴 렌더링(약 line 735, "경로 복사" 버튼 `</button>` 닫힘 뒤)에 추가:

```tsx
            {/* Divider */}
            {activeTab === 'recent' && <div className="context-menu-divider" />}

            {/* Hide from recent */}
            {activeTab === 'recent' && (
              <button className="context-menu-danger" onClick={handleHideRecent}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                최근 항목에서 제거
              </button>
            )}
```

**Step 4: CSS에 divider + danger 스타일 추가**

`MyActivity.css`에서 `.activity-context-menu button svg` 블록(약 line 481) 뒤에 추가:

```css
.activity-context-menu .context-menu-divider {
  height: 1px;
  background: var(--border-light);
  margin: var(--spacing-xs) 0;
}

.activity-context-menu .context-menu-danger {
  color: var(--color-error, #F44336);
}

.activity-context-menu .context-menu-danger:hover {
  background: rgba(244, 67, 54, 0.08);
}

.activity-context-menu .context-menu-danger svg {
  color: var(--color-error, #F44336);
}
```

**Step 5: TypeScript 빌드 확인**

Run: `cd /opt/stacks/FileHatch/ui && npx tsc --noEmit`
Expected: 에러 없음

**Step 6: Commit**

```bash
git add ui/src/components/MyActivity.tsx ui/src/components/MyActivity.css
git commit -m "feat: add 'hide from recent' context menu item in MyActivity"
```

---

### Task 7: Frontend - "전체 지우기" 버튼 추가

**Files:**
- Modify: `ui/src/components/MyActivity.tsx` (add clear button + confirm dialog)
- Modify: `ui/src/components/MyActivity.css` (add button + dialog styles)

**Step 1: import 추가**

`MyActivity.tsx` import에 `clearAllRecentItems` 추가:

```typescript
import { getRecentFiles, hideRecentItem, clearAllRecentItems } from '../api/files'
```

**Step 2: 확인 다이얼로그 state 추가**

기존 state 선언 부근(약 line 124)에 추가:

```typescript
  const [showClearConfirm, setShowClearConfirm] = useState(false)
```

**Step 3: 전체 삭제 핸들러 추가**

`handleHideRecent` 핸들러 뒤에 추가:

```typescript
  const handleClearAllRecent = useCallback(async () => {
    try {
      await clearAllRecentItems()
      setActivities([])
    } catch (error) {
      console.error('Failed to clear recent items:', error)
    } finally {
      setShowClearConfirm(false)
    }
  }, [])
```

**Step 4: 헤더에 "전체 지우기" 버튼 추가**

`my-activity-header` div(line 468)의 `</p>` 닫힘(line 474) 뒤, `</div>` 닫힘(line 475) 전에 추가:

```tsx
        {activeTab === 'recent' && activities.length > 0 && (
          <button
            className="clear-recent-btn"
            onClick={() => setShowClearConfirm(true)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            전체 지우기
          </button>
        )}
```

**Step 5: 확인 다이얼로그 렌더링 추가**

`MyActivity.tsx`의 최하단 return JSX에서, 컨텍스트 메뉴 `</div>` 뒤 (파일 끝부분의 `</div>` 닫힘들 전)에 추가:

```tsx
      {/* Clear all confirm dialog */}
      {showClearConfirm && (
        <div className="clear-confirm-overlay" onClick={() => setShowClearConfirm(false)}>
          <div className="clear-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>최근 항목을 모두 지우시겠습니까?</p>
            <div className="clear-confirm-actions">
              <button className="btn-cancel" onClick={() => setShowClearConfirm(false)}>
                취소
              </button>
              <button className="btn-danger" onClick={handleClearAllRecent}>
                지우기
              </button>
            </div>
          </div>
        </div>
      )}
```

**Step 6: CSS 스타일 추가**

`MyActivity.css` 끝에 추가:

```css
/* Clear recent button */
.clear-recent-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 6px 12px;
  font-size: 13px;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.clear-recent-btn:hover {
  color: var(--color-error, #F44336);
  border-color: var(--color-error, #F44336);
  background: rgba(244, 67, 54, 0.04);
}

/* Clear confirm dialog */
.clear-confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.clear-confirm-dialog {
  background: var(--bg-primary);
  border-radius: var(--radius-lg, 16px);
  padding: 24px;
  min-width: 320px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
}

.clear-confirm-dialog p {
  margin: 0 0 20px;
  font-size: 15px;
  color: var(--text-primary);
  text-align: center;
}

.clear-confirm-actions {
  display: flex;
  gap: var(--spacing-sm);
  justify-content: flex-end;
}

.clear-confirm-actions .btn-cancel {
  padding: 8px 20px;
  font-size: 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.clear-confirm-actions .btn-cancel:hover {
  background: var(--bg-secondary);
}

.clear-confirm-actions .btn-danger {
  padding: 8px 20px;
  font-size: 14px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-error, #F44336);
  color: white;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.clear-confirm-actions .btn-danger:hover {
  background: #d32f2f;
}
```

**Step 7: TypeScript 빌드 확인**

Run: `cd /opt/stacks/FileHatch/ui && npx tsc --noEmit`
Expected: 에러 없음

**Step 8: Commit**

```bash
git add ui/src/components/MyActivity.tsx ui/src/components/MyActivity.css
git commit -m "feat: add clear all recent items button with confirmation dialog"
```

---

### Task 8: 통합 테스트 + Docker 빌드 검증

**Step 1: 전체 테스트 실행**

Run: `./scripts/test.sh`
Expected: 모든 테스트 통과

**Step 2: Docker 빌드**

```bash
docker compose -f docker-compose-dev.yaml build --no-cache api ui
docker compose -f docker-compose-dev.yaml down api ui && docker compose -f docker-compose-dev.yaml up -d api ui
```

**Step 3: API 헬스 체크**

```bash
curl -s http://localhost:3080/health
curl -s http://localhost:3080/api/version
```
Expected: 정상 응답

**Step 4: 로그 확인**

```bash
docker compose -f docker-compose-dev.yaml logs --tail=20 api
```
Expected: 마이그레이션 006 실행 로그 확인, 에러 없음

**Step 5: 실제 기능 테스트 시나리오**

1. 로그인 후 "내 작업 → 최근 항목" 탭 확인
2. 파일 하나를 우클릭 → "최근 항목에서 제거" 클릭 → 목록에서 사라지는지 확인
3. 숨긴 파일을 다시 다운로드/편집 → 최근 항목에 다시 나타나는지 확인
4. "전체 지우기" 버튼 클릭 → 확인 다이얼로그 → "지우기" → 목록 비워지는지 확인
5. 페이지 새로고침 후에도 숨김 상태 유지되는지 확인

**Step 6: 테스트 결과 보고 및 최종 Commit**

```bash
git add -A
git commit -m "feat: 최근 항목 삭제/정리 기능 추가 (개별 숨기기 + 전체 지우기)"
```

---

### Task 9: 버전 업데이트 + 코드 리뷰 수정사항 반영

**Files:**
- Modify: `api/version.go` (version bump)
- Modify: `ui/package.json` (version bump)
- Modify: `ui/src/components/Sidebar.tsx` (fix: `enabled: !!token` on trash-stats query)

**Step 1: 코드 리뷰 수정 — trash-stats `enabled` 추가**

`Sidebar.tsx` line 198-202의 `useQuery`에 `enabled: !!token` 추가:

```typescript
  const { data: trashStats } = useQuery({
    queryKey: ['trash-stats'],
    queryFn: getTrashStats,
    refetchInterval: 30000,
    enabled: !!token,
  })
```

**Step 2: 버전 업데이트**

`api/version.go`: `Version = "0.9.2"`
`ui/package.json`: `"version": "0.9.2"`

**Step 3: 버전 동기화 확인**

```bash
grep 'Version.*=' api/version.go
grep '"version"' ui/package.json
```
Expected: 둘 다 `0.9.2`

**Step 4: Commit**

```bash
git add api/version.go ui/package.json ui/src/components/Sidebar.tsx
git commit -m "fix: add enabled guard to trash-stats query, bump version to 0.9.2"
```
