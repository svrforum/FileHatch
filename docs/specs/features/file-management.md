# 파일 관리 기능 명세

## 1. 기능 개요

파일/폴더에 대한 전체 생명주기를 관리하는 핵심 기능이다.
CRUD, 검색, 미리보기, 압축/해제, 즐겨찾기, 잠금 등을 포함하며,
가상 스크롤 기반의 고성능 UI와 WebSocket 실시간 동기화를 통해 대규모 파일 시스템을 처리한다.

### 핵심 특성

| 특성 | 설명 |
|------|------|
| 가상 스크롤 | `@tanstack/react-virtual` 기반 테이블/그리드 뷰로 수천 개 파일 렌더링 |
| 실시간 동기화 | WebSocket `FileChangeEvent`로 외부 변경 즉시 반영 |
| 키보드 중심 UX | 방향키, Ctrl+C/X/V, Delete, F2, Enter, 타이핑 검색 지원 |
| 드래그 선택 | 마우스 드래그로 다중 파일 선택 (Marquee Selection) |
| 서버사이드 처리 | 압축/해제/이동/복사 등 대용량 작업은 서버사이드 전송 큐 사용 |

---

## 2. 백엔드 구조

### 2.1 핸들러 파일 및 역할

| 파일 | 구조체/함수 | 역할 |
|------|-------------|------|
| `api/handlers/file_handler.go` | `Handler` struct | 파일 CRUD, 이동, 복사, 휴지통, 검색 등 주요 파일 작업 |
| `api/handlers/create_handler.go` | `CreateFile` | 새 파일 생성 (빈 텍스트, docx/xlsx/pptx 템플릿) |
| `api/handlers/preview_handler.go` | - | 이미지/비디오 미리보기 스트리밍 |
| `api/handlers/thumbnail.go` | - | 썸네일 생성 및 캐싱 |

### 2.2 Handler 구조체 (DI 패턴)

```go
type Handler struct {
    db           *sql.DB
    dataRoot     string
    auditHandler *AuditHandler
    // ... 기타 의존성
}
```

### 2.3 주요 메서드 목록

| 메서드 | 설명 | HTTP |
|--------|------|------|
| `ListFiles` | 파일/폴더 목록 조회 (정렬, 필터) | GET /api/files |
| `DownloadFile` | 단일 파일 다운로드 | GET /api/files/download |
| `RenameItem` | 파일/폴더 이름 변경 | POST /api/files/rename |
| `MoveToTrash` | 휴지통으로 이동 (소프트 삭제) | POST /api/files/trash |
| `RestoreFromTrash` | 휴지통에서 복원 | POST /api/files/restore |
| `SearchFiles` | 파일명/태그 기반 검색 | GET /api/files/search |
| `GetFolderStats` | 폴더 내 파일 수/크기 통계 | GET /api/files/stats |
| `CompressFiles` | 다중 파일 ZIP 압축 | POST /api/files/compress |
| `ExtractZip` | ZIP 파일 압축 해제 | POST /api/files/extract |
| `GetFileMetadata` | 파일 메타데이터 조회 | GET /api/files/metadata |
| `UpdateFileTags` | 태그 업데이트 | PUT /api/files/tags |
| `StarFile` | 즐겨찾기 추가/해제 | POST/DELETE /api/files/star |
| `LockFile` | 파일 잠금/해제 | POST/DELETE /api/files/lock |
| `CreateFile` | 새 파일 생성 (템플릿 기반) | POST /api/files/create |

### 2.4 보안 처리

모든 파일 작업에 다음 보안 검증이 적용된다.

```go
// 경로 검증 (Path Traversal 방지)
cleaned := filepath.Clean(path)
if strings.Contains(cleaned, "..") {
    return ErrForbidden("invalid path")
}
absPath := filepath.Join(dataRoot, cleaned)
if !strings.HasPrefix(absPath, dataRoot) {
    return ErrForbidden("path traversal detected")
}

// 파일명 검증
ValidateFilename(name) // < > : " / \ | ? * 금지

// 권한 확인 (공유 폴더인 경우)
pc.RequireSharedFolderAccess(c, folderID, "read")
```

### 2.5 감사 로그 기록 대상

| 이벤트 | 상수 | 기록 정보 |
|--------|------|-----------|
| 파일 업로드 | `EventFileUpload` | filename, size, path |
| 파일 다운로드 | `EventFileDownload` | filename, size |
| 파일 삭제 | `EventFileDelete` | filename, path |
| 이름 변경 | `EventFileRename` | old_name, new_name |
| 파일 이동 | `EventFileMove` | from_path, to_path |
| 파일 복사 | `EventFileCopy` | from_path, to_path |

---

## 3. 프론트엔드 구조

### 3.1 컴포넌트 계층

```
FileList.tsx                         # 메인 컨테이너 (선택, 뷰 모드, 컨텍스트 메뉴 관리)
  +-- filelist/FileListHeader.tsx    # 정렬 가능한 컬럼 헤더
  +-- filelist/VirtualizedFileTable.tsx  # 가상 스크롤 테이블 뷰
  |     +-- filelist/FileRow.tsx     # 개별 행 컴포넌트
  +-- filelist/VirtualizedFileGrid.tsx   # 가상 스크롤 그리드 뷰
  |     +-- filelist/FileCard.tsx    # 개별 카드 컴포넌트
  +-- filelist/ContextMenu.tsx       # 우클릭 메뉴
  +-- filelist/MultiSelectBar.tsx    # 다중 선택 시 벌크 액션 툴바
  +-- filelist/FileInfoPanel.tsx     # 상세 정보 사이드바 (미리보기, 태그)
FileViewer.tsx                       # 파일 미리보기 (이미지, PDF, 텍스트, 비디오)
TextEditor.tsx                       # Monaco 에디터 (텍스트 파일 편집)
ZipViewer.tsx                        # ZIP 아카이브 탐색기
OnlyOfficeEditor.tsx                 # Office 문서 통합 편집
SearchModal.tsx                      # 전체 페이지 검색
```

### 3.2 가상 스크롤 구현

```typescript
// VirtualizedFileTable.tsx
// @tanstack/react-virtual의 useVirtualizer 사용
const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10, // 화면 밖 10개 행 추가 렌더링
});
```

| 설정 | 값 | 설명 |
|------|----|------|
| `estimateSize` | ROW_HEIGHT (고정) | 행 높이 고정으로 성능 최적화 |
| `overscan` | 10 | 스크롤 시 깜빡임 방지를 위한 여유 렌더링 |
| 렌더링 방식 | `FixedSizeList` | 고정 높이 기반 가상화 |

### 3.3 커스텀 훅

| 훅 | 파일 위치 | 역할 |
|----|-----------|------|
| `useFileOperations` | `hooks/useFileOperations.ts` | 삭제, 이름 변경, 복사, 이동 (queryClient 무효화 포함) |
| `useKeyboardNavigation` | `hooks/useKeyboardNavigation.ts` | 방향키, Ctrl+C/X/V, Delete, F2, Enter, 타이핑 검색 |
| `useClipboard` | `hooks/useClipboard.ts` | 복사/잘라내기/붙여넣기 파일 작업 |
| `useMarqueeSelection` | `hooks/useMarqueeSelection.ts` | 마우스 드래그 다중 선택 |
| `useLocalSearch` | `hooks/useLocalSearch.ts` | 클라이언트 측 파일 필터링 |
| `useStarredAndLocked` | `hooks/useStarredAndLocked.ts` | 즐겨찾기/잠금 상태 관리 |

### 3.4 키보드 단축키 매핑

| 단축키 | 동작 |
|--------|------|
| `Arrow Up/Down` | 파일 목록 탐색 |
| `Enter` | 폴더 진입 / 파일 열기 |
| `Backspace` | 상위 폴더로 이동 |
| `Ctrl+C` | 파일 복사 (클립보드) |
| `Ctrl+X` | 파일 잘라내기 (클립보드) |
| `Ctrl+V` | 파일 붙여넣기 |
| `Delete` | 휴지통으로 이동 |
| `F2` | 이름 변경 |
| `Ctrl+A` | 전체 선택 |
| `타이핑` | 타이핑 검색 (type-ahead) |

---

## 4. API 엔드포인트

### 4.1 파일 조회

| 메서드 | 경로 | 쿼리 파라미터 | 설명 |
|--------|------|---------------|------|
| GET | `/api/files` | `path`, `sort`, `order` | 파일 목록 조회 |
| GET | `/api/files/download` | `path` | 파일 다운로드 (스트리밍) |
| POST | `/api/files/download-zip` | body: `{paths: [...]}` | 다중 파일 ZIP 다운로드 |
| GET | `/api/files/url` | `path` | 파일 직접 URL 조회 |
| GET | `/api/files/stats` | `path` | 폴더 통계 (파일 수, 총 크기) |
| GET | `/api/files/check` | `path`, `filename` | 파일 존재 여부 확인 |
| GET | `/api/files/storage-usage` | - | 사용자 저장 공간 사용량 |
| GET | `/api/files/trash-stats` | - | 휴지통 통계 |
| GET | `/api/files/search` | `q` | 파일 검색 |
| GET | `/api/files/metadata` | `path` | 파일 메타데이터 조회 |
| GET | `/api/files/recent` | - | 최근 파일 목록 |

### 4.2 파일 수정

| 메서드 | 경로 | 요청 바디 | 설명 |
|--------|------|-----------|------|
| POST | `/api/files/rename` | `{path, newName}` | 이름 변경 |
| POST | `/api/files/copy` | `{sourcePath, destPath}` | 복사 |
| POST | `/api/files/move` | `{sourcePath, destPath}` | 이동 |
| POST | `/api/files/trash` | `{paths: [...]}` | 휴지통으로 이동 |
| POST | `/api/files/restore` | `{paths: [...]}` | 휴지통에서 복원 |
| POST | `/api/files/create` | `{path, filename, type}` | 새 파일 생성 |
| POST | `/api/files/compress` | `{paths: [...], destPath}` | ZIP 압축 |
| POST | `/api/files/extract` | `{path, destPath}` | ZIP 압축 해제 |

### 4.3 메타데이터 수정

| 메서드 | 경로 | 요청 바디 | 설명 |
|--------|------|-----------|------|
| PUT | `/api/files/description` | `{path, description}` | 설명 업데이트 |
| PUT | `/api/files/tags` | `{path, tags: [...]}` | 태그 업데이트 |
| POST | `/api/files/star` | `{path}` | 즐겨찾기 추가 |
| DELETE | `/api/files/star` | `{path}` | 즐겨찾기 해제 |

### 4.4 인증 요구사항

모든 `/api/files/*` 엔드포인트는 `JWTMiddleware()` 필수이다.
공유 폴더(`/shared/` 접두사) 경로 접근 시 추가로 `PermissionChecker.CheckSharedFolderAccess()` 검증이 수행된다.

### 4.5 공유 드라이브 쓰기 권한 검증

공유 폴더에 대한 모든 mutating 작업은 `Handler.CanWriteSharedDrive()` (= `PermissionLevel >= PermissionReadWrite`) 검증을 통과해야 한다. ReadOnly(viewer) 권한 사용자가 어떤 경로로도 공유 폴더 데이터를 변경할 수 없도록 모든 핸들러가 일관되게 검사한다.

| 핸들러 | 라우트 | 검증 대상 |
|--------|--------|-----------|
| `DeleteFile` | DELETE `/api/files/*` | source |
| `DeleteFolder` | DELETE `/api/folders/*` | source |
| `SaveFileContent` | PUT `/api/file/*` | target |
| `RenameItem` | PUT `/api/files/rename/*` | source |
| `MoveItem` | PUT `/api/files/move/*` | source + destination |
| `MoveItemStream` | GET `/api/files/move-stream/*` | source + destination |
| `CopyItem` | POST `/api/files/copy/*` | destination |
| `CopyItemStream` | GET `/api/files/copy-stream/*` | destination |
| `MoveToTrash` | POST `/api/trash/*` | source |
| `BatchMoveToTrash` | POST `/api/trash/batch` | source (각 항목별) |
| `CreateFolder` | POST `/api/folders` | parent |
| `UploadFile` | POST `/api/upload` | parent |

WebDAV 경로 또한 동일한 시맨틱을 따른다. `VirtualFS.OpenFile()`은 호출 시점의 `flag`(O_WRONLY/O_RDWR/O_CREATE/O_TRUNC/O_APPEND)에서 쓰기 의도를 추출하여 viewer 권한자의 PUT을 거부한다. `RemoveAll`/`Rename`은 항상 `write=true`로 검사한다.

---

## 5. 데이터 흐름

### 5.1 파일 목록 로딩

```
[FileList 마운트]
    |
    v
useQuery(['files', currentPath]) -----> GET /api/files?path=...
    |                                         |
    v                                         v
React Query 캐시 저장               <---- JSON 응답 (파일 배열)
    |
    v
useMemo (정렬/필터 적용)
    |
    v
VirtualizedFileTable 또는 VirtualizedFileGrid
    |
    v
화면에 보이는 행/카드만 렌더링 (가상 스크롤)
```

### 5.2 실시간 동기화

```
[서버: 파일 시스템 변경 감지]
    |
    v
BroadcastFileChange(FileChangeEvent{
    Type: "create|write|remove|rename",
    Path: "/home/user/...",
    Name: "file.txt",
    IsDir: false,
})
    |
    v (WebSocket)
[프론트엔드: useFileWatcher]
    |
    v
queryClient.invalidateQueries(['files', affectedPath])
    |
    v
자동 리페치 → UI 업데이트
```

### 5.3 파일 작업 흐름 (예: 이름 변경)

```
[사용자: F2 키 입력 또는 컨텍스트 메뉴]
    |
    v
useKeyboardNavigation → 이름 변경 모드 활성화
    |
    v
[사용자: 새 이름 입력 + Enter]
    |
    v
useFileOperations.rename(path, newName)
    |
    v
POST /api/files/rename -----> 서버: ValidateFilename → filepath 검증 → os.Rename
    |                                |
    v                                v
성공 → queryClient.invalidateQueries  감사 로그: EventFileRename
    |
    v
토스트 알림 표시
```

---

## 6. 미리보기 시스템

### 6.1 지원 형식

| 카테고리 | 확장자 | 미리보기 방식 |
|----------|--------|---------------|
| 이미지 | jpg, png, gif, webp, svg, bmp | 인라인 이미지 렌더링 |
| 비디오 | mp4, webm, mov, avi | HTML5 비디오 플레이어 |
| 오디오 | mp3, wav, ogg, flac | HTML5 오디오 플레이어 |
| PDF | pdf | PDF.js 뷰어 |
| 텍스트 | txt, md, json, yaml, xml, csv 등 | Monaco 에디터 (구문 강조) |
| Office | docx, xlsx, pptx | OnlyOffice 통합 |
| 압축 | zip | ZipViewer (아카이브 탐색) |

### 6.2 썸네일 생성

```
[이미지 파일 요청]
    |
    v
캐시 확인 (/data/.thumbnails/{hash}.jpg)
    |
    +-- 캐시 히트 → 즉시 반환
    |
    +-- 캐시 미스 → 이미지 리사이즈 → 캐시 저장 → 반환
```

| 설정 | 값 |
|------|----|
| 썸네일 크기 | 200x200 (최대, 비율 유지) |
| 캐시 경로 | `/data/.thumbnails/` |
| 캐시 키 | 파일 경로 해시 + 수정 시간 |
| 지원 형식 | JPEG, PNG, GIF, WebP |

---

## 7. 검색 시스템

### 7.1 서버사이드 검색

```
GET /api/files/search?q=키워드
```

- 파일명 기반 검색 (LIKE 쿼리 또는 파일 시스템 순회)
- 태그 기반 검색 (DB 쿼리)
- 결과에 경로, 파일 정보 포함

### 7.2 클라이언트사이드 검색 (useLocalSearch)

- 현재 디렉토리 내 실시간 필터링
- 파일명 부분 일치
- 디바운싱 적용 (300ms)

### 7.3 SearchModal 기능

| 기능 | 설명 |
|------|------|
| 전체 검색 | 전체 사용자 디렉토리 대상 |
| 결과 탐색 | 검색 결과에서 파일 위치로 이동 |
| 필터 | 파일 유형, 날짜 범위, 크기 필터 |

---

## 8. 즐겨찾기 및 잠금

### 8.1 즐겨찾기 (Star)

| 항목 | 설명 |
|------|------|
| DB 테이블 | `file_stars` (user_id, file_path, created_at) |
| 토글 방식 | POST로 추가, DELETE로 해제 |
| UI 표현 | 파일 행/카드에 별 아이콘 |
| 전용 뷰 | 즐겨찾기 페이지에서 모아보기 |

### 8.2 잠금 (Lock)

| 항목 | 설명 |
|------|------|
| DB 테이블 | `file_locks` (user_id, file_path, locked_at) |
| 효과 | 잠긴 파일은 다른 사용자가 수정/삭제 불가 |
| UI 표현 | 잠금 아이콘 표시 |
| 해제 | 잠금 설정자 또는 관리자만 해제 가능 |

---

## 9. 휴지통 시스템

### 9.1 동작 방식

```
[파일 삭제 요청]
    |
    v
POST /api/files/trash
    |
    v
파일을 .trash/ 디렉토리로 이동
    |
    v
DB에 삭제 기록 저장 (원본 경로, 삭제 시간)
```

### 9.2 주요 기능

| 기능 | 설명 |
|------|------|
| 소프트 삭제 | 실제 삭제가 아닌 .trash/로 이동 |
| 복원 | 원본 경로로 복원 (경로 충돌 시 이름 변경) |
| 영구 삭제 | 휴지통에서 수동 삭제 |
| 자동 정리 | 설정된 기간 후 자동 영구 삭제 (관리자 설정) |
| 통계 | `/api/files/trash-stats`로 휴지통 크기 확인 |

---

## 10. 새 파일 생성

### 10.1 지원 템플릿

| 타입 | 확장자 | 설명 |
|------|--------|------|
| `text` | .txt | 빈 텍스트 파일 |
| `markdown` | .md | 빈 마크다운 파일 |
| `docx` | .docx | Word 문서 템플릿 |
| `xlsx` | .xlsx | Excel 스프레드시트 템플릿 |
| `pptx` | .pptx | PowerPoint 프레젠테이션 템플릿 |

### 10.2 요청/응답

```json
// 요청
POST /api/files/create
{
    "path": "/documents",
    "filename": "새문서",
    "type": "docx"
}

// 응답
{
    "success": true,
    "data": {
        "path": "/documents/새문서.docx",
        "name": "새문서.docx",
        "size": 1024
    }
}
```

---

## 11. 관련 파일 참조

### 백엔드

| 파일 경로 | 설명 |
|-----------|------|
| `api/handlers/file_handler.go` | 메인 파일 핸들러 |
| `api/handlers/create_handler.go` | 파일 생성 핸들러 |
| `api/handlers/preview_handler.go` | 미리보기 핸들러 |
| `api/handlers/thumbnail.go` | 썸네일 생성/캐싱 |
| `api/handlers/validation.go` | 입력 검증 함수 |
| `api/handlers/permissions.go` | 권한 체크 |
| `api/handlers/audit.go` | 감사 로그 |
| `api/handlers/errors.go` | 에러 처리/응답 헬퍼 |

### 프론트엔드

| 파일 경로 | 설명 |
|-----------|------|
| `ui/src/components/FileList.tsx` | 메인 파일 목록 컨테이너 |
| `ui/src/components/filelist/*.tsx` | 파일 목록 하위 컴포넌트 |
| `ui/src/components/FileViewer.tsx` | 파일 미리보기 |
| `ui/src/components/TextEditor.tsx` | 텍스트 편집기 |
| `ui/src/components/ZipViewer.tsx` | ZIP 탐색기 |
| `ui/src/components/OnlyOfficeEditor.tsx` | Office 통합 |
| `ui/src/components/SearchModal.tsx` | 검색 모달 |
| `ui/src/hooks/useFileOperations.ts` | 파일 작업 훅 |
| `ui/src/hooks/useKeyboardNavigation.ts` | 키보드 탐색 훅 |
| `ui/src/hooks/useClipboard.ts` | 클립보드 훅 |
| `ui/src/hooks/useMarqueeSelection.ts` | 드래그 선택 훅 |
| `ui/src/hooks/useLocalSearch.ts` | 로컬 검색 훅 |
| `ui/src/hooks/useStarredAndLocked.ts` | 즐겨찾기/잠금 훅 |
| `ui/src/api/files.ts` | 파일 API 함수 |
