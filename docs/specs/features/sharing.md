# 공유 기능 명세

## 1. 기능 개요

사용자 간 파일 공유, 링크 기반 공개 공유, 공유 폴더(팀 드라이브)의 세 가지 공유 방식을 제공한다.
세분화된 권한 시스템과 캐싱을 통해 성능과 보안을 동시에 확보한다.

### 공유 유형 비교

| 유형 | 대상 | 인증 | 권한 단위 | DB 테이블 |
|------|------|------|-----------|-----------|
| 사용자 간 공유 | 특정 사용자 | JWT 필수 | 파일/폴더 단위 | `file_shares` |
| 링크 공유 | 불특정 다수 (URL 보유자) | 없음 (토큰 기반) | 링크 단위 | `shares` |
| 공유 폴더 | 조직/팀 멤버 | JWT 필수 | 폴더 단위 | `shared_folders` + `shared_folder_members` |

---

## 2. 사용자 간 공유 (file_shares)

### 2.1 핸들러

| 항목 | 값 |
|------|----|
| 핸들러 | `ShareHandler` in `api/handlers/share.go` |
| 구조체 | `ShareHandler{db, dataRoot, auditHandler, notificationService}` |

### 2.2 DB 스키마

```sql
CREATE TABLE IF NOT EXISTS file_shares (
    id            SERIAL PRIMARY KEY,
    item_path     TEXT NOT NULL,              -- 공유 대상 경로
    owner_id      INTEGER REFERENCES users(id),
    shared_with_id INTEGER REFERENCES users(id),
    permission    INTEGER NOT NULL DEFAULT 1,  -- 1: 읽기, 2: 읽기+쓰기
    message       TEXT,                        -- 선택적 메시지
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(item_path, owner_id, shared_with_id)
);
```

### 2.3 공유 흐름

```
[소유자: ShareModal에서 사용자 검색 및 권한 선택]
    |
    v
POST /api/shares/file
    Body: {
        itemPath: "/documents/report.pdf",
        sharedWithId: 42,
        permission: 2,            // read-write
        message: "검토 부탁드립니다"
    }
    |
    v
[서버]
    +-- 경로 소유권 검증
    +-- 중복 공유 확인 (UNIQUE 제약)
    +-- file_shares 레코드 생성
    +-- 알림 전송: NotifShareReceived → 수신자
    +-- 감사 로그 기록
    |
    v
[수신자]
    +-- WebSocket 알림 수신
    +-- "나에게 공유됨" 목록에 표시
    +-- 권한에 따라 읽기/수정 가능
```

### 2.4 권한 수준

| 값 | 상수 | 설명 |
|----|------|------|
| 1 | `PermissionReadOnly` | 읽기 전용 (다운로드, 미리보기) |
| 2 | `PermissionReadWrite` | 읽기 + 쓰기 (수정, 삭제 가능) |

### 2.5 알림

```go
// 공유 생성 시 수신자에게 알림 전송
notificationService.CreateNotification(Notification{
    UserID:  sharedWithID,
    Type:    NotifShareReceived,
    Title:   fmt.Sprintf("%s님이 파일을 공유했습니다", ownerName),
    Message: message,
    Data: map[string]interface{}{
        "shareId":  shareID,
        "itemPath": itemPath,
        "ownerName": ownerName,
    },
})

// WebSocket으로 실시간 전달
BroadcastNotification(sharedWithID, notification)
```

---

## 3. 링크 공유 (shares)

### 3.1 DB 스키마

```sql
CREATE TABLE IF NOT EXISTS shares (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES users(id),
    token         UUID UNIQUE DEFAULT gen_random_uuid(),
    share_type    VARCHAR(20) NOT NULL,   -- download, upload, edit
    item_path     TEXT NOT NULL,
    password      TEXT,                    -- bcrypt 해시 (선택)
    expires_at    TIMESTAMPTZ,             -- 만료일 (선택)
    max_access    INTEGER,                 -- 최대 접근 횟수 (선택)
    access_count  INTEGER DEFAULT 0,       -- 현재 접근 횟수
    editable      BOOLEAN DEFAULT FALSE,   -- 수정 허용 여부
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 공유 유형

| 타입 | 설명 | 공개 페이지 |
|------|------|-------------|
| `download` | 파일 다운로드 전용 링크 | `ShareAccessPage` (`/s/:token`) |
| `upload` | 파일 업로드 수신 링크 | `UploadShareAccessPage` (`/u/:token`) |
| `edit` | 파일 편집 가능 링크 | `ShareAccessPage` (편집 모드) |

### 3.3 보안 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| 비밀번호 | 접근 시 비밀번호 입력 필요 | 없음 |
| 만료일 | 설정 날짜 이후 접근 불가 | 없음 (무기한) |
| 최대 접근 횟수 | 설정 횟수 초과 시 접근 불가 | 없음 (무제한) |
| 편집 가능 | 파일 수정 허용 여부 | false |

### 3.4 접근 흐름

```
[비인증 사용자: /s/{token} 접근]
    |
    v
GET /api/shares/public/{token}
    |
    v
[서버 검증]
    +-- 토큰 유효성 확인
    +-- 만료일 확인
    +-- 접근 횟수 확인
    +-- 비밀번호 설정 여부 확인
    |
    +-- 비밀번호 설정됨 → 비밀번호 입력 페이지 반환
    |
    +-- 검증 통과 → access_count 증가
    |
    v
[공개 페이지 렌더링]
    +-- download 타입: 파일 정보 표시 + 다운로드 버튼
    +-- upload 타입: 업로드 영역 표시
    +-- edit 타입: 파일 편집기 표시
```

### 3.5 링크 공유 생성 요청/응답

```json
// 요청
POST /api/shares/link
{
    "itemPath": "/documents/report.pdf",
    "shareType": "download",
    "password": "optional-password",
    "expiresAt": "2024-12-31T23:59:59Z",
    "maxAccess": 100
}

// 응답
{
    "success": true,
    "data": {
        "id": 1,
        "token": "550e8400-e29b-41d4-a716-446655440000",
        "shareType": "download",
        "url": "https://files.example.com/s/550e8400-e29b-41d4-a716-446655440000",
        "password": true,
        "expiresAt": "2024-12-31T23:59:59Z",
        "maxAccess": 100,
        "accessCount": 0
    }
}
```

---

## 4. 공유 폴더 (팀 드라이브)

### 4.1 개념

관리자가 생성하는 팀 공유 작업 공간이다.
여러 사용자가 하나의 폴더에 접근하며, 멤버별로 권한을 다르게 설정할 수 있다.
가상 경로 `/shared/{folderName}/`으로 접근한다.

### 4.2 DB 스키마

```sql
-- 공유 폴더 테이블
CREATE TABLE IF NOT EXISTS shared_folders (
    id             SERIAL PRIMARY KEY,
    name           VARCHAR(255) UNIQUE NOT NULL,
    description    TEXT,
    storage_quota  BIGINT DEFAULT 0,          -- 폴더별 저장 할당량 (0=무제한)
    storage_used   BIGINT DEFAULT 0,          -- 현재 사용량
    created_by     INTEGER REFERENCES users(id),
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 공유 폴더 멤버 테이블
CREATE TABLE IF NOT EXISTS shared_folder_members (
    id             SERIAL PRIMARY KEY,
    folder_id      INTEGER REFERENCES shared_folders(id) ON DELETE CASCADE,
    user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
    permission     INTEGER NOT NULL DEFAULT 1,  -- 1: 읽기, 2: 읽기+쓰기, 3: 전체 제어
    added_by       INTEGER REFERENCES users(id),
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(folder_id, user_id)
);
```

### 4.3 권한 수준

| 값 | 상수 | 설명 |
|----|------|------|
| 0 | `PermissionNone` | 접근 불가 |
| 1 | `PermissionReadOnly` | 읽기 전용 (조회, 다운로드) |
| 2 | `PermissionReadWrite` | 읽기 + 쓰기 (업로드, 수정, 삭제) |
| 3 | `PermissionFullControl` | 전체 제어 (멤버 관리 포함, 관리자) |

### 4.4 가상 경로 매핑

```
사용자가 보는 경로:      /shared/마케팅팀/보고서/월간보고.pdf
실제 파일 시스템 경로:    /data/shared/마케팅팀/보고서/월간보고.pdf
```

```go
// 공유 폴더 경로 판별
if strings.HasPrefix(requestPath, "/shared/") {
    folderName := extractFolderName(requestPath)  // "마케팅팀"
    // 권한 확인 후 실제 경로로 매핑
    realPath := filepath.Join(dataRoot, "shared", folderName, subPath)
}
```

### 4.5 관리 흐름 (관리자)

```
[관리자]
    |
    +-- POST /api/admin/shared-folders
    |     Body: { name: "마케팅팀", description: "마케팅팀 공유 폴더", storageQuota: 10737418240 }
    |     → 폴더 생성 + 파일 시스템 디렉토리 생성
    |
    +-- POST /api/admin/shared-folders/{id}/members
    |     Body: { userId: 42, permission: 2 }
    |     → 멤버 추가 (읽기+쓰기 권한)
    |
    +-- PUT /api/admin/shared-folders/{id}
    |     Body: { name: "마케팅팀", storageQuota: 21474836480 }
    |     → 설정 수정 (이름, 할당량 등)
    |
    +-- DELETE /api/admin/shared-folders/{id}/members/{mid}
    |     → 멤버 제거
    |
    +-- DELETE /api/admin/shared-folders/{id}
          → 공유 폴더 삭제 (파일 시스템 포함)
```

---

## 5. 권한 시스템

### 5.1 PermissionChecker 구조

```go
type PermissionChecker struct {
    db       *sql.DB
    dataRoot string
}

type ACLResult struct {
    Allowed         bool
    PermissionLevel int
    FolderID        int
    FolderName      string
    Reason          string
}
```

### 5.2 주요 메서드

| 메서드 | 설명 | 반환 |
|--------|------|------|
| `CheckSharedFolderAccess(userID, folderName, action)` | 공유 폴더 접근 권한 확인 | `ACLResult` |
| `CheckFileShareAccess(userID, filePath, action)` | 파일 공유 접근 권한 확인 | `ACLResult` |
| `RequireSharedFolderAccess(c, folderID, action)` | Echo 컨텍스트용 권한 필수 확인 | `error` |

### 5.3 권한 캐시 (PermissionCache)

| 설정 | 값 |
|------|----|
| TTL | 5분 |
| 캐시 키 | `(userID, folderName)` 튜플 |
| 무효화 | 멤버 추가/제거/권한 변경 시 |

```go
type PermissionCache struct {
    cache map[string]cachedPermission
    mu    sync.RWMutex
}

type cachedPermission struct {
    result    ACLResult
    expiresAt time.Time
}

// 캐시 조회
func (pc *PermissionCache) Get(userID int, folderName string) (ACLResult, bool) {
    key := fmt.Sprintf("%d:%s", userID, folderName)
    pc.mu.RLock()
    defer pc.mu.RUnlock()
    if cached, ok := pc.cache[key]; ok && time.Now().Before(cached.expiresAt) {
        return cached.result, true
    }
    return ACLResult{}, false
}
```

### 5.4 권한 검증 흐름

```
[파일 요청 수신]
    |
    v
경로가 /shared/ 접두사인가?
    |
    +-- 아니오 → 사용자 본인 디렉토리 접근 (일반 파일 핸들러)
    |
    +-- 예 → 공유 폴더 권한 확인
            |
            v
        PermissionCache 조회
            |
            +-- 캐시 히트 → ACLResult 반환
            |
            +-- 캐시 미스 → DB 쿼리
                    |
                    v
                shared_folder_members에서 user_id + folder_id 검색
                    |
                    +-- 레코드 없음 → ACLResult{Allowed: false, Reason: "not a member"}
                    |
                    +-- 레코드 있음 → 권한 수준 확인
                            |
                            v
                        action에 필요한 최소 권한과 비교
                            |
                            +-- read 요청 → permission >= 1 필요
                            +-- write 요청 → permission >= 2 필요
                            +-- admin 요청 → permission >= 3 필요
                            |
                            v
                        결과 캐싱 (5분 TTL) → ACLResult 반환
```

---

## 6. 프론트엔드 구조

### 6.1 컴포넌트

| 컴포넌트 | 파일 위치 | 역할 |
|----------|-----------|------|
| `ShareModal.tsx` | `ui/src/components/ShareModal.tsx` | 사용자 간 공유 다이얼로그 |
| `LinkShareModal.tsx` | `ui/src/components/LinkShareModal.tsx` | 링크 공유 설정 다이얼로그 |
| `ShareAccessPage.tsx` | `ui/src/components/ShareAccessPage.tsx` | 공개 다운로드/편집 페이지 |
| `UploadShareAccessPage.tsx` | `ui/src/components/UploadShareAccessPage.tsx` | 공개 업로드 페이지 |
| `ShareOptionsDisplay.tsx` | `ui/src/components/ShareOptionsDisplay.tsx` | 파일 목록 내 공유 상태 표시 |

### 6.2 ShareModal 구조

```
ShareModal.tsx
    +-- 사용자 검색 입력 (자동완성)
    |     GET /api/shares/users/search?q=...
    |
    +-- 검색 결과 목록
    |     +-- 사용자 선택 시 공유 대상에 추가
    |
    +-- 권한 선택 드롭다운
    |     +-- 읽기 전용
    |     +-- 읽기+쓰기
    |
    +-- 메시지 입력 (선택)
    |
    +-- [공유] 버튼 → POST /api/shares/file
```

### 6.3 LinkShareModal 구조

```
LinkShareModal.tsx
    +-- 공유 유형 선택
    |     +-- 다운로드 / 업로드 / 편집
    |
    +-- 보안 옵션
    |     +-- 비밀번호 설정 (토글 + 입력)
    |     +-- 만료일 설정 (날짜 선택기)
    |     +-- 최대 접근 횟수 (숫자 입력)
    |
    +-- 생성된 링크 표시
    |     +-- URL 복사 버튼
    |     +-- QR 코드 (선택)
    |
    +-- 기존 링크 목록
          +-- 접근 횟수 표시
          +-- [삭제] 버튼
```

### 6.4 관련 훅 및 API 함수

| 훅/함수 | 파일 | 설명 |
|---------|------|------|
| `useSharedFolders` | `hooks/useSharedFolders.ts` | 사용자의 공유 폴더 목록 조회 |
| `createFileShare` | `api/fileShares.ts` | 파일 공유 생성 API |
| `getSharedWithMe` | `api/fileShares.ts` | 나에게 공유된 항목 조회 |
| `getSharedByMe` | `api/fileShares.ts` | 내가 공유한 항목 조회 |
| `createLinkShare` | `api/fileShares.ts` | 링크 공유 생성 API |
| `getMyLinks` | `api/fileShares.ts` | 내 링크 목록 조회 |
| `getSharedFolders` | `api/sharedFolders.ts` | 공유 폴더 목록 조회 |
| `getSharedFolderPermission` | `api/sharedFolders.ts` | 특정 폴더의 내 권한 조회 |

---

## 7. API 엔드포인트

### 7.1 사용자 간 파일 공유

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| POST | `/api/shares/file` | JWT | 파일 공유 생성 |
| GET | `/api/shares/shared-with-me` | JWT | 나에게 공유된 항목 조회 |
| GET | `/api/shares/shared-by-me` | JWT | 내가 공유한 항목 조회 |
| PUT | `/api/shares/file/{id}` | JWT | 공유 권한 수정 |
| DELETE | `/api/shares/file/{id}` | JWT | 공유 삭제 (철회) |
| GET | `/api/shares/users/search` | JWT | 공유 대상 사용자 검색 |

### 7.2 링크 공유

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| POST | `/api/shares/link` | JWT | 링크 공유 생성 |
| GET | `/api/shares/links` | JWT | 내 링크 공유 목록 |
| DELETE | `/api/shares/link/{id}` | JWT | 링크 공유 삭제 |

### 7.3 공개 접근 (인증 불필요)

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/api/shares/public/{token}` | 없음 | 공유 정보 조회 (비밀번호 필요 여부 포함) |
| GET | `/api/shares/public/{token}/download` | 없음 | 파일 다운로드 |
| POST | `/api/shares/public/{token}/upload` | 없음 | 파일 업로드 (upload 타입 링크) |

### 7.4 공유 폴더 (일반 사용자)

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/api/shared-folders` | JWT | 내가 접근 가능한 공유 폴더 목록 |
| GET | `/api/shared-folders/{id}/permission` | JWT | 특정 폴더에 대한 내 권한 조회 |

### 7.5 공유 폴더 관리 (관리자 전용)

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/api/admin/shared-folders` | Admin | 전체 공유 폴더 목록 |
| POST | `/api/admin/shared-folders` | Admin | 공유 폴더 생성 |
| PUT | `/api/admin/shared-folders/{id}` | Admin | 공유 폴더 수정 (이름, 할당량 등) |
| DELETE | `/api/admin/shared-folders/{id}` | Admin | 공유 폴더 삭제 |
| POST | `/api/admin/shared-folders/{id}/members` | Admin | 멤버 추가 |
| DELETE | `/api/admin/shared-folders/{id}/members/{mid}` | Admin | 멤버 제거 |

---

## 8. 보안 고려사항

### 8.1 경로 접근 검증

```go
// 공유된 파일 접근 시 반드시 확인해야 하는 사항
// 1. 공유 레코드 존재 여부
// 2. 요청 경로가 공유된 경로의 하위인지 (Path Traversal 방지)
// 3. 권한 수준이 요청 동작에 충분한지

func (h *ShareHandler) validateSharedAccess(userID int, requestPath string) error {
    // 공유 레코드 조회
    share, err := h.getFileShare(userID, requestPath)
    if err != nil {
        return ErrNotFound("share not found")
    }

    // 경로 검증
    cleaned := filepath.Clean(requestPath)
    if !strings.HasPrefix(cleaned, share.ItemPath) {
        return ErrForbidden("path not within shared scope")
    }

    return nil
}
```

### 8.2 링크 공유 보안

| 위협 | 대응 |
|------|------|
| 토큰 브루트포스 | UUID v4 사용 (122비트 엔트로피) |
| 링크 유출 | 비밀번호 보호, 만료일, 접근 횟수 제한 |
| 무단 업로드 | upload 타입 링크에만 업로드 허용 |
| 경로 조작 | 공유 대상 경로 외 접근 차단 |

### 8.3 공유 폴더 보안

| 위협 | 대응 |
|------|------|
| 비멤버 접근 | `PermissionChecker`로 모든 요청 검증 |
| 권한 상승 | DB 기반 권한 확인, 캐시 무효화 |
| 저장 공간 남용 | 폴더별 `storage_quota` 제한 |
| 관리 API 남용 | `RequireAdmin()` 미들웨어 필수 |

---

## 9. 감사 로그

### 9.1 기록 대상 이벤트

| 이벤트 | 상수 | 기록 정보 |
|--------|------|-----------|
| 파일 공유 생성 | `EventShareCreate` | item_path, shared_with, permission |
| 파일 공유 삭제 | `EventShareDelete` | share_id, item_path |
| 링크 공유 생성 | `EventLinkShareCreate` | item_path, share_type, has_password |
| 링크 공유 삭제 | `EventLinkShareDelete` | share_id, token (마스킹) |
| 공유 폴더 생성 | `EventSharedFolderCreate` | folder_name, created_by |
| 공유 폴더 삭제 | `EventSharedFolderDelete` | folder_name |
| 멤버 추가 | `EventSharedFolderMemberAdd` | folder_name, user_id, permission |
| 멤버 제거 | `EventSharedFolderMemberRemove` | folder_name, user_id |
| 공개 링크 접근 | `EventPublicShareAccess` | token (마스킹), ip_address |

---

## 10. 관련 파일 참조

### 백엔드

| 파일 경로 | 설명 |
|-----------|------|
| `api/handlers/share.go` | 공유 핸들러 (사용자 간 공유, 링크 공유) |
| `api/handlers/shared_folder.go` | 공유 폴더 관리 핸들러 |
| `api/handlers/permissions.go` | 권한 체크 (PermissionChecker, PermissionCache) |
| `api/handlers/notification.go` | 알림 서비스 (NotificationService) |
| `api/handlers/audit.go` | 감사 로그 기록 |

### 프론트엔드

| 파일 경로 | 설명 |
|-----------|------|
| `ui/src/components/ShareModal.tsx` | 사용자 간 공유 모달 |
| `ui/src/components/LinkShareModal.tsx` | 링크 공유 모달 |
| `ui/src/components/ShareAccessPage.tsx` | 공개 다운로드/편집 페이지 |
| `ui/src/components/UploadShareAccessPage.tsx` | 공개 업로드 페이지 |
| `ui/src/components/ShareOptionsDisplay.tsx` | 파일 목록 내 공유 표시 |
| `ui/src/hooks/useSharedFolders.ts` | 공유 폴더 훅 |
| `ui/src/api/fileShares.ts` | 파일 공유 API 함수 |
| `ui/src/api/sharedFolders.ts` | 공유 폴더 API 함수 |

### DB

| 테이블 | 설명 |
|--------|------|
| `file_shares` | 사용자 간 파일 공유 레코드 |
| `shares` | 링크 공유 레코드 (토큰 기반) |
| `shared_folders` | 공유 폴더 정의 |
| `shared_folder_members` | 공유 폴더 멤버 및 권한 |
