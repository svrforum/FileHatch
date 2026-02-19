# 실시간 통신 명세

## 개요

FileHatch는 WebSocket 기반 실시간 통신을 통해 파일 변경 감지, 전송 진행률 업데이트, 알림 전달을 수행한다. 서버 측에서는 Hub/Client 패턴으로 연결을 관리하고, 프론트엔드에서는 Custom Hook을 통해 WebSocket 이벤트를 React Query 캐시 무효화 및 UI 업데이트에 연결한다.

---

## WebSocket Hub

### 핵심 구조

| 항목 | 값 |
|------|-----|
| 구현 파일 | `api/handlers/websocket.go` |
| 엔드포인트 | `/api/ws` |
| 라이브러리 | `gorilla/websocket` |
| 인증 | JWT (쿼리 파라미터 또는 헤더) |

### Hub 구조

```go
type Hub struct {
    clients    map[*Client]bool   // 연결된 클라이언트 맵
    register   chan *Client        // 클라이언트 등록 채널
    unregister chan *Client        // 클라이언트 해제 채널
    broadcast  chan []byte         // 전체 브로드캐스트 채널
}
```

### Client 구조

| 속성 | 설명 |
|------|------|
| `conn` | WebSocket 연결 객체 |
| `send` | 전송 버퍼 채널 (크기: 100) |
| `userID` | 인증된 사용자 ID |
| `watchPaths` | 감시 중인 경로 목록 (필터링용) |

### 연결 관리

- 클라이언트별 별도 고루틴(goroutine) 운영
- `ping/pong` 메커니즘으로 연결 유지(keepalive)
- 클라이언트 연결 해제 시 `unregister` 채널을 통해 자동 정리

---

## 파일 변경 감시 (FileWatcher)

### 핵심 구조

| 항목 | 값 |
|------|-----|
| 구현 파일 | `api/handlers/watcher.go` |
| 라이브러리 | `fsnotify` |
| 감시 대상 | `/data/` 디렉토리 트리 |
| 제외 대상 | `.trash` 디렉토리 |

### 이벤트 처리

| 이벤트 | 발생 조건 |
|--------|-----------|
| `Create` | 파일/디렉토리 생성 |
| `Write` | 파일 내용 변경 |
| `Remove` | 파일/디렉토리 삭제 |
| `Rename` | 파일/디렉토리 이름 변경 |

### 디바운싱

- 경로별(per-path) 디바운싱 적용
- 설정 가능한 간격(interval)으로 중복 이벤트 방지
- 짧은 시간 내 동일 경로에 대한 다수 이벤트를 단일 이벤트로 통합

### 자동 감시 확장

- 새 디렉토리 생성 시 자동으로 감시 목록에 추가
- 디렉토리 삭제 시 감시 목록에서 자동 제거

### SMB 통합

- Samba 클라이언트 연결 모니터링
- IP 추적을 위한 연결 정보 감시

---

## 이벤트 타입

### FileChangeEvent

파일 시스템 변경 사항을 WebSocket 클라이언트에 전달하는 이벤트.

```go
type FileChangeEvent struct {
    Type      string `json:"type"`      // "create", "write", "remove", "rename"
    Path      string `json:"path"`      // 가상 경로 (예: /home/user/file.txt)
    Name      string `json:"name"`      // 파일명
    IsDir     bool   `json:"isDir"`     // 디렉토리 여부
    Timestamp int64  `json:"timestamp"` // Unix 타임스탬프
}
```

### 브로드캐스트 함수

```go
BroadcastFileChange(FileChangeEvent{
    Type: "create",
    Path: "/home/user/documents",
    Name: "report.pdf",
    IsDir: false,
})
```

### TransferProgressEvent

서버 사이드 파일 전송(복사/이동) 진행률을 클라이언트에 전달하는 이벤트.

```go
type TransferProgressEvent struct {
    Type        string `json:"type"`        // "transfer_progress"
    JobID       string `json:"jobId"`       // 전송 작업 ID
    Status      string `json:"status"`      // "pending", "running", "completed", "error"
    Progress    int    `json:"progress"`    // 0~100 (퍼센트)
    TotalFiles  int    `json:"totalFiles"`  // 전체 파일 수
    CopiedFiles int    `json:"copiedFiles"` // 복사 완료 파일 수
    TotalBytes  int64  `json:"totalBytes"`  // 전체 바이트
    CopiedBytes int64  `json:"copiedBytes"` // 복사 완료 바이트
    BytesPerSec int64  `json:"bytesPerSec"` // 전송 속도 (바이트/초)
    ErrorMsg    string `json:"errorMsg"`    // 에러 메시지 (에러 시)
}
```

### 진행률 상태 흐름

```
pending → running → completed
                  → error
```

### Notification

사용자에게 전달되는 실시간 알림 이벤트.

```go
type Notification struct {
    ID        int64                  `json:"id"`
    Type      string                 `json:"type"`      // 알림 타입
    Title     string                 `json:"title"`     // 알림 제목
    Message   string                 `json:"message"`   // 알림 메시지
    ActorName *string                `json:"actorName"` // 행위자 이름 (nullable)
    IsRead    bool                   `json:"isRead"`    // 읽음 여부
    CreatedAt time.Time              `json:"createdAt"` // 생성 시각
    Metadata  map[string]interface{} `json:"metadata"`  // 추가 데이터
}
```

---

## 알림 시스템

### 핵심 구조

| 항목 | 값 |
|------|-----|
| 구현체 | `NotificationService` (`api/handlers/notification_service.go`) |
| DB 테이블 | `notifications` |
| 전달 경로 | DB 저장 + WebSocket 실시간 브로드캐스트 |

### 알림 타입 (8종)

| 타입 | 설명 |
|------|------|
| `share.received` | 파일 공유를 받음 |
| `share.permission_changed` | 공유 권한이 변경됨 |
| `share.removed` | 공유가 제거됨 |
| `shared_folder.invited` | 공유 폴더에 초대됨 |
| `shared_folder.removed` | 공유 폴더에서 제거됨 |
| `shared_file.modified` | 공유 파일이 수정됨 |
| `share_link.accessed` | 공유 링크가 접근됨 |
| `upload_link.received` | 업로드 링크로 파일 수신 |

### 알림 생성

```go
// 단일 사용자 알림
notificationService.Create(ctx, userID, notifType, title, message, metadata)

// 다중 사용자 알림 (공유 폴더 멤버 전체 등)
notificationService.CreateBulk(ctx, userIDs, notifType, title, message, metadata)
```

### 브로드캐스트

```go
BroadcastNotification(userID, notification)
```

특정 사용자 ID에 연결된 WebSocket 클라이언트에만 알림을 전달한다.

---

## 프론트엔드 연동

### useFileWatcher Hook

파일 시스템 변경 및 알림을 실시간으로 수신하는 Custom Hook.

```typescript
interface UseFileWatcherReturn {
    isConnected: boolean
    connectionState: 'connected' | 'disconnected' | 'reconnecting'
}
```

#### 핵심 동작

| 기능 | 처리 방식 |
|------|-----------|
| 파일 변경 수신 | `queryClient.invalidateQueries(['files', path])` |
| 알림 수신 | `notificationStore.triggerRefresh()` |
| 연결 상태 변화 | UI 인디케이터 업데이트 |

#### 재연결 전략

- **방식**: 지수 백오프 (Exponential Backoff)
- **최소 대기**: 1초
- **최대 대기**: 30초
- 연결 끊김 시 자동으로 재연결을 시도한다.

### useNotifications Hook

알림 목록을 API로부터 조회하고 읽음/삭제 상태를 관리하는 Hook.

| 기능 | 설명 |
|------|------|
| 목록 조회 | 페이지네이션 지원 |
| 읽음 처리 | 단일/전체 읽음 표시 |
| 삭제 | 단일/전체 삭제 |
| 새로고침 트리거 | WebSocket 알림 수신 시 자동 |

### 프론트엔드 컴포넌트

| 컴포넌트 | 역할 |
|----------|------|
| `NotificationCenter.tsx` | 전체 알림 목록 (인박스 뷰) |
| `NotificationBell.tsx` | 읽지 않은 알림 수 배지 |

### React Query 설정

| 옵션 | 값 | 설명 |
|------|----|------|
| `staleTime` | 60초 | 데이터가 stale로 간주되기까지의 시간 |
| `gcTime` | 5분 | 캐시 가비지 컬렉션 시간 |
| `refetchOnWindowFocus` | `false` | 윈도우 포커스 시 자동 리페치 비활성화 |

WebSocket 이벤트를 통해 React Query 캐시를 선택적으로 무효화하므로, 폴링 대신 이벤트 기반으로 UI를 업데이트한다.

---

## 메시지 흐름도

### 파일 변경 전파 흐름

```
[파일 시스템 변경]
    ↓
[FileWatcher (fsnotify)]
    ↓ 디바운싱
[BroadcastFileChange()]
    ↓
[Hub.broadcast]
    ↓ watchPaths 필터링
[Client.send 채널]
    ↓
[WebSocket → 브라우저]
    ↓
[useFileWatcher Hook]
    ↓
[queryClient.invalidateQueries()]
    ↓
[React Query 자동 리페치 → UI 업데이트]
```

### 알림 전파 흐름

```
[서버 이벤트 (공유 생성, 파일 수정 등)]
    ↓
[NotificationService.Create()]
    ↓ DB 저장
[BroadcastNotification(userID)]
    ↓ 사용자별 필터링
[Client.send 채널]
    ↓
[WebSocket → 브라우저]
    ↓
[useFileWatcher → notificationStore.triggerRefresh()]
    ↓
[useNotifications → API 재조회 → UI 업데이트]
```

---

## 관련 파일

| 경로 | 설명 |
|------|------|
| `api/handlers/websocket.go` | Hub, Client 구조체, WebSocket 연결 관리 |
| `api/handlers/watcher.go` | FileWatcher, fsnotify 기반 파일 감시 |
| `api/handlers/notification_service.go` | NotificationService, 알림 생성 및 브로드캐스트 |
| `ui/src/hooks/useFileWatcher.ts` | WebSocket 연결, 이벤트 수신, React Query 연동 |
| `ui/src/hooks/useNotifications.ts` | 알림 목록 조회, 읽음/삭제 관리 |
| `ui/src/stores/notificationStore.ts` | 알림 상태 관리 (Zustand) |
| `ui/src/components/NotificationCenter.tsx` | 알림 목록 UI |
| `ui/src/components/NotificationBell.tsx` | 알림 배지 UI |
