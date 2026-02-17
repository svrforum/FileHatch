# 최근 항목 삭제/정리 기능 설계

**날짜**: 2026-02-17
**관련 이슈**: GitHub Issue #21 (댓글 요청)
**범위**: 개별 삭제 + 전체 삭제
**방식**: 숨김 테이블 (audit_logs 보존)

---

## 개요

"내 작업 → 최근 항목" 목록에서 개별 항목 또는 전체 항목을 삭제(숨김 처리)할 수 있는 기능을 추가한다. 감사 로그(audit_logs)는 변경하지 않고, 별도의 `hidden_recent_items` 테이블로 숨김 처리한다.

---

## DB 스키마

### 새 테이블: `hidden_recent_items`

```sql
CREATE TABLE IF NOT EXISTS hidden_recent_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path VARCHAR(1024) NOT NULL,
    hidden_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_hidden_recent_user ON hidden_recent_items(user_id);
```

- `starred_files` 테이블과 동일한 패턴
- `UNIQUE(user_id, file_path)`로 중복 방지
- `ON DELETE CASCADE`로 사용자 삭제 시 자동 정리

### 마이그레이션 파일

`api/database/migrations/NNN_hidden_recent_items.sql` 생성. 반드시 `INSERT INTO schema_migrations` 포함.

---

## API 설계

### 1. 개별 항목 숨기기

```
POST /api/files/recent/hide
Content-Type: application/json
Authorization: Bearer {token}

{
  "file_path": "/home/user/documents/file.txt"
}

Response 200: { "message": "ok" }
```

### 2. 전체 항목 숨기기 (일괄 삭제)

```
DELETE /api/files/recent
Authorization: Bearer {token}

Response 200: { "message": "ok", "hidden_count": 25 }
```

현재 보이는 모든 최근 항목의 `target_resource`를 `hidden_recent_items`에 INSERT한다.

### 3. 기존 API 수정

`GET /api/files/recent` (`AuditHandler.GetRecentFiles`)의 SQL 쿼리에 `LEFT JOIN hidden_recent_items` + `WHERE hidden_recent_items.id IS NULL` 조건을 추가하여 숨김 항목을 제외한다.

---

## 프론트엔드 설계

### 컨텍스트 메뉴 (우클릭)

기존 4개 항목 하단에 구분선 + "최근 항목에서 제거" 추가:

```
📂 열기
📥 다운로드
📍 파일 위치로 이동
📋 경로 복사
──────────────
🗑️ 최근 항목에서 제거
```

### 헤더 버튼

"최근 항목" 탭 헤더 영역에 "전체 지우기" 버튼 추가. 클릭 시 확인 다이얼로그 표시:

```
"최근 항목을 모두 지우시겠습니까?"
[취소] [지우기]
```

### 데이터 흐름

1. 사용자가 "제거" 클릭
2. `POST /api/files/recent/hide` 호출
3. 성공 시 `queryClient.invalidateQueries(['recent-files'])` → 목록 갱신
4. 전체 삭제도 동일 패턴 (`DELETE /api/files/recent`)

### 새 API 함수 (`ui/src/api/files.ts`)

```typescript
export async function hideRecentItem(filePath: string): Promise<void>
export async function clearAllRecentItems(): Promise<{ hidden_count: number }>
```

---

## 고려사항

- **감사 로그 보존**: audit_logs는 불변 — 관리자 감사 기능에 영향 없음
- **숨김 후 재활동**: 숨긴 파일을 다시 편집/다운로드하면 새 audit_log가 생성되어 다시 최근 항목에 나타남 (hidden_at < 새 audit_log timestamp이므로 자연스럽게 해결)
- **성능**: hidden_recent_items JOIN은 인덱스 기반이므로 성능 영향 미미
