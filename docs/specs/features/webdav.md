# WebDAV 프로토콜 지원 명세

## 1. 기능 개요

WebDAV(Web Distributed Authoring and Versioning) 프로토콜을 통해 FileHatch의 파일 시스템에 네이티브 접근을 제공한다.
운영체제의 기본 파일 탐색기에서 네트워크 드라이브로 마운트하여 웹 UI 없이도 파일을 관리할 수 있다.

### 핵심 특성

| 특성 | 설명 |
|------|------|
| RFC 4918 기반 | `golang.org/x/net/webdav` 패키지를 활용한 표준 WebDAV 구현 |
| 가상 파일시스템 | `/home/`, `/shared/` 가상 디렉토리를 통한 사용자별 격리된 파일 접근 |
| 애플리케이션 비밀번호 | 웹 로그인과 분리된 전용 비밀번호 (bcrypt 해시, `smb_hash` 컬럼 공유) |
| 휴지통 연동 | WebDAV DELETE 시 영구 삭제가 아닌 휴지통 이동 (웹 UI와 동일 동작) |
| 감사 로그 | 쓰기 작업 (PUT, DELETE, MKCOL, MOVE, COPY)에 대한 자동 감사 기록 |
| DAV Class 2 | LOCK/UNLOCK 메서드 지원 (메모리 기반 잠금 시스템) |

---

## 2. WebDAV 프로토콜 지원 범위 (RFC 4918)

### 2.1 DAV Compliance Level

서버는 DAV Class 1 및 Class 2를 선언한다.

```
DAV: 1, 2
```

| Class | 설명 | 지원 여부 |
|-------|------|-----------|
| Class 1 | 기본 WebDAV 메서드 (PROPFIND, PROPPATCH, MKCOL, GET, PUT, DELETE, COPY, MOVE) | 지원 |
| Class 2 | 잠금 메서드 (LOCK, UNLOCK) | 지원 (메모리 기반) |
| Class 3 | RFC 3253 버전 관리 확장 | 미지원 |

### 2.2 지원 HTTP 메서드

OPTIONS 응답의 `Allow` 헤더에 선언된 메서드 목록:

```
Allow: OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK
```

### 2.3 Microsoft 확장

Windows 클라이언트 호환을 위한 추가 헤더:

```
MS-Author-Via: DAV
```

---

## 3. 백엔드 구조

### 3.1 핸들러 파일 및 역할

| 파일 | 구조체/함수 | 역할 |
|------|-------------|------|
| `api/handlers/webdav.go` | `WebDAVHandler` | WebDAV 요청 처리, 인증, 감사 로그 |
| `api/handlers/webdav.go` | `VirtualFS` | `webdav.FileSystem` 인터페이스 구현 (가상 파일시스템) |
| `api/handlers/webdav.go` | `VirtualRootDir` | `/` 루트 디렉토리 (home, shared 목록) |
| `api/handlers/webdav.go` | `VirtualHomeDir` | `/home/` 사용자 홈 디렉토리 |
| `api/handlers/webdav.go` | `VirtualSharedDir` | `/shared/` 공유 폴더 목록 |
| `api/handlers/trash.go` | `Handler.MoveToTrashInternal` | WebDAV DELETE 시 휴지통 이동 처리 |
| `api/handlers/auth.go` | `AuthHandler.SetMySMBPassword` | 애플리케이션 비밀번호 설정 |

### 3.2 WebDAVHandler 구조체 (DI 패턴)

```go
type WebDAVHandler struct {
    db         *sql.DB
    dataRoot   string
    lockSystem webdav.LockSystem  // 메모리 기반 잠금 시스템 (webdav.NewMemLS())
    handler    *Handler           // 휴지통 기능 연동용
}
```

### 3.3 VirtualFS 구조체

```go
type VirtualFS struct {
    db       *sql.DB
    dataRoot string
    user     *UserInfo   // 인증된 사용자 정보
    handler  *Handler    // 휴지통 기능 연동용
}
```

`webdav.FileSystem` 인터페이스의 전체 메서드를 구현한다:

| 메서드 | 설명 |
|--------|------|
| `Mkdir` | 디렉토리 생성 (가상 경로 -> 실제 경로 변환 후 `os.Mkdir`) |
| `OpenFile` | 파일/디렉토리 열기 (가상 루트/홈/공유 분기 처리) |
| `RemoveAll` | 파일/디렉토리 삭제 (휴지통 이동 또는 영구 삭제) |
| `Rename` | 파일/디렉토리 이름 변경 또는 이동 |
| `Stat` | 파일/디렉토리 정보 조회 |

### 3.4 인터페이스 구현 검증

```go
var _ webdav.FileSystem = (*VirtualFS)(nil)
var _ webdav.File = (*VirtualRootDir)(nil)
var _ webdav.File = (*VirtualHomeDir)(nil)
var _ webdav.File = (*VirtualSharedDir)(nil)
var _ fs.FileInfo = (*virtualDirInfo)(nil)
```

---

## 4. 인증 방식

### 4.1 인증 흐름

WebDAV는 HTTP Basic Authentication을 사용한다. 웹 로그인에 사용되는 비밀번호와 분리된 **애플리케이션 비밀번호**를 사용한다.

```
[WebDAV 클라이언트 요청]
    |
    v
OPTIONS 메서드인가? ----Yes----> 인증 없이 DAV 헤더 반환 (200 OK)
    |
    No
    |
    v
Basic Auth 헤더 존재? ----No----> 401 + WWW-Authenticate: Basic realm="FileHatch WebDAV"
    |
    Yes
    |
    v
authenticateUser(username, password)
    |
    +-- users 테이블에서 username으로 조회 (is_active = true 필수)
    |
    +-- smb_hash 컬럼 확인 (NULL 또는 빈 문자열이면 인증 실패)
    |
    +-- bcrypt.CompareHashAndPassword 검증
    |
    v
인증 성공 -> UserInfo{ID, Username, IsAdmin} 반환
    |
    v
VirtualFS 생성 -> webdav.Handler에 전달 -> 요청 처리
```

### 4.2 인증 데이터 구조

```go
type UserInfo struct {
    ID       string
    Username string
    IsAdmin  bool
}
```

### 4.3 애플리케이션 비밀번호 설정

사용자는 웹 UI의 프로필 설정에서 애플리케이션 비밀번호를 설정할 수 있다.

| 항목 | 설명 |
|------|------|
| API 엔드포인트 | `PUT /api/auth/smb-password` |
| 최소 길이 | 8자 이상 |
| 해시 방식 | bcrypt (DefaultCost) |
| DB 컬럼 | `users.smb_hash` (SMB와 공유) |
| 활성화 조건 | 시스템 설정에서 SMB 기능이 활성화되어 있어야 함 (`smb_enabled`) |

### 4.4 인증 관련 SQL

```sql
-- 사용자 인증 쿼리
SELECT id, username, is_admin, smb_hash
FROM users
WHERE username = $1 AND is_active = true
```

### 4.5 OPTIONS 메서드 예외

RFC 4918에 따라 OPTIONS 메서드는 인증 없이 처리된다. 이는 WebDAV 클라이언트의 서버 기능 탐색(discovery)에 필수적이다.

---

## 5. 가상 파일시스템 매핑

### 5.1 디렉토리 구조

WebDAV를 통해 접근 가능한 가상 디렉토리 구조:

```
/webdav/                          <- WebDAV 루트 (가상)
    +-- home/                     <- 사용자 개인 홈 디렉토리 (가상)
    |     +-- Documents/          <- 실제 파일/폴더
    |     +-- Photos/
    |     +-- file.txt
    +-- shared/                   <- 공유 폴더 목록 (가상)
          +-- TeamDrive/          <- 공유 폴더 (DB 기반)
          +-- ProjectFiles/
```

### 5.2 경로 매핑 규칙

| WebDAV 가상 경로 | 실제 파일시스템 경로 | 설명 |
|-------------------|---------------------|------|
| `/webdav/` | (가상) | 루트: `home`, `shared` 목록만 표시 |
| `/webdav/home/` | `{dataRoot}/users/{username}/` | 사용자 홈 디렉토리 |
| `/webdav/home/Documents/file.txt` | `{dataRoot}/users/{username}/Documents/file.txt` | 홈 내 파일 |
| `/webdav/shared/` | (가상) | 접근 가능한 공유 폴더 목록 |
| `/webdav/shared/TeamDrive/` | `{dataRoot}/shared/TeamDrive/` | 공유 폴더 내 파일 |

### 5.3 경로 해석 함수 (`resolvePath`)

```go
func (vfs *VirtualFS) resolvePath(name string, write bool) (string, error) {
    name = filepath.Clean(name)

    // /home/* -> 사용자 홈 디렉토리
    if strings.HasPrefix(name, "/home/") || name == "/home" {
        subPath := strings.TrimPrefix(name, "/home")
        userHome := filepath.Join(vfs.dataRoot, "users", vfs.user.Username)
        os.MkdirAll(userHome, 0755) // 홈 디렉토리 자동 생성
        return filepath.Join(userHome, subPath), nil
    }

    // /shared/{folder-name}/* -> 공유 폴더 (DB 조회 + 권한 확인)
    if strings.HasPrefix(name, "/shared/") {
        // 폴더명 추출 -> DB에서 접근 권한 확인 -> 실제 경로 반환
        // write=true일 때 viewer 권한이면 os.ErrPermission 반환
        ...
    }

    return "", os.ErrNotExist // 기타 경로는 접근 불가
}
```

### 5.4 가상 디렉토리 처리

루트(`/`), 홈(`/home`), 공유(`/shared`) 경로는 가상 디렉토리로 처리된다:

| 가상 디렉토리 | 구현체 | Readdir 동작 |
|---------------|--------|-------------|
| `/` | `VirtualRootDir` | `home`, `shared` 두 디렉토리 정보 반환 |
| `/home` | `VirtualHomeDir` | 사용자 홈의 실제 파일시스템 디렉토리 내용 반환 |
| `/shared` | `VirtualSharedDir` | DB 조회 결과 기반 공유 폴더 목록 반환 |

### 5.5 홈 디렉토리 자동 생성

`/home` 경로 접근 시 사용자의 홈 디렉토리가 존재하지 않으면 자동으로 생성한다:

```go
userHome := filepath.Join(vfs.dataRoot, "users", vfs.user.Username)
os.MkdirAll(userHome, 0755)
```

---

## 6. 지원 메서드 상세

### 6.1 OPTIONS

| 항목 | 설명 |
|------|------|
| 인증 | 불필요 |
| 응답 헤더 | `Allow`, `DAV`, `MS-Author-Via` |
| 용도 | WebDAV 서버 기능 탐색 (discovery) |

### 6.2 PROPFIND

| 항목 | 설명 |
|------|------|
| 인증 | 필수 (Basic Auth) |
| 용도 | 파일/디렉토리 속성 조회, 디렉토리 목록 |
| 감사 로그 | 기록하지 않음 |
| 구현 | `golang.org/x/net/webdav` 패키지가 `VirtualFS.Stat()` 및 `OpenFile().Readdir()` 호출 |

### 6.3 GET / HEAD

| 항목 | 설명 |
|------|------|
| 인증 | 필수 (Basic Auth) |
| 용도 | 파일 다운로드 / 메타데이터 조회 |
| 감사 로그 | 기록하지 않음 (WebDAV 클라이언트가 검증용으로 빈번하게 호출하므로 제외) |
| 구현 | `VirtualFS.OpenFile()` -> `os.OpenFile()` |

### 6.4 PUT

| 항목 | 설명 |
|------|------|
| 인증 | 필수 (Basic Auth) |
| 용도 | 파일 업로드 / 덮어쓰기 |
| 감사 로그 | `file.upload` 이벤트 기록 |
| 권한 | 공유 폴더의 경우 editor 이상 권한 필요 |

### 6.5 DELETE

| 항목 | 설명 |
|------|------|
| 인증 | 필수 (Basic Auth) |
| 용도 | 파일/디렉토리 삭제 |
| 감사 로그 | `file.delete` 또는 `folder.delete` 이벤트 기록 |
| 동작 | 휴지통으로 이동 (`MoveToTrashInternal` 사용) |

DELETE 시 영구 삭제가 아닌 휴지통 이동 처리:

```go
func (vfs *VirtualFS) RemoveAll(ctx context.Context, name string) error {
    realPath, _ := vfs.resolvePath(name, true)
    virtualPath := vfs.getVirtualPath(name)

    // Handler가 있으면 휴지통으로 이동
    if vfs.handler != nil {
        return vfs.handler.MoveToTrashInternal(
            vfs.user.Username,
            vfs.user.ID,
            virtualPath,
            realPath,
        )
    }
    // Fallback: 영구 삭제
    return os.RemoveAll(realPath)
}
```

### 6.6 MKCOL

| 항목 | 설명 |
|------|------|
| 인증 | 필수 (Basic Auth) |
| 용도 | 디렉토리 생성 |
| 감사 로그 | `folder.create` 이벤트 기록 |
| 구현 | `VirtualFS.Mkdir()` -> `os.Mkdir()` |

### 6.7 COPY

| 항목 | 설명 |
|------|------|
| 인증 | 필수 (Basic Auth) |
| 용도 | 파일/디렉토리 복사 |
| 감사 로그 | `file.copy` 이벤트 기록 |
| 구현 | `golang.org/x/net/webdav` 패키지 내부에서 OpenFile + Write로 처리 |

### 6.8 MOVE

| 항목 | 설명 |
|------|------|
| 인증 | 필수 (Basic Auth) |
| 용도 | 파일/디렉토리 이동 또는 이름 변경 |
| 감사 로그 | `file.move` 이벤트 기록 |
| 구현 | `VirtualFS.Rename()` -> `os.Rename()` |

### 6.9 LOCK / UNLOCK

| 항목 | 설명 |
|------|------|
| 인증 | 필수 (Basic Auth) |
| 용도 | 리소스 잠금/해제 (동시 편집 방지) |
| 감사 로그 | 기록하지 않음 |
| 잠금 시스템 | `webdav.NewMemLS()` (메모리 기반, 서버 재시작 시 초기화) |

### 6.10 PROPPATCH

| 항목 | 설명 |
|------|------|
| 인증 | 필수 (Basic Auth) |
| 용도 | 파일 속성 수정 |
| 감사 로그 | 기록하지 않음 |
| 구현 | `golang.org/x/net/webdav` 패키지 기본 처리 |

---

## 7. 경로 해석 및 스토리지 라우팅

### 7.1 경로 해석 흐름

```
[WebDAV 요청: /webdav/shared/TeamDrive/document.docx]
    |
    v
Prefix 제거: /shared/TeamDrive/document.docx
    |
    v
resolvePath("/shared/TeamDrive/document.docx", write=false)
    |
    v
/shared/ 접두사 감지
    |
    v
폴더명 추출: "TeamDrive"
    |
    v
getSharedFolder("TeamDrive")
    |
    +-- DB 조회: shared_folders + shared_folder_members JOIN
    |   (user_id 기반 접근 권한 확인)
    |
    +-- 관리자인 경우: shared_folders에서 직접 조회 (멤버가 아니어도 접근 가능)
    |
    v
SharedFolderInfo{
    ID: "uuid",
    Name: "TeamDrive",
    Path: "{dataRoot}/shared/TeamDrive",
    Permission: "editor"
}
    |
    v
실제 경로 반환: {dataRoot}/shared/TeamDrive/document.docx
```

### 7.2 공유 폴더 권한 체계

| 권한 수준 | DB 값 | 읽기 | 쓰기 | 설명 |
|-----------|-------|------|------|------|
| Viewer | `permission_level = 1` | O | X | 읽기 전용 |
| Editor | `permission_level = 2` | O | O | 읽기 + 쓰기 |
| Admin | `permission_level >= 3` | O | O | 전체 권한 |

쓰기 작업 시 권한 확인:

```go
if write && folder.Permission == "viewer" {
    return "", os.ErrPermission
}
```

### 7.3 공유 폴더 목록 조회

`/shared/` 디렉토리 접근 시 사용자가 접근 가능한 공유 폴더 목록을 DB에서 조회한다:

```sql
-- 일반 사용자: 멤버로 등록된 공유 폴더
SELECT sf.id, sf.name, sfm.permission_level
FROM shared_folders sf
JOIN shared_folder_members sfm ON sf.id = sfm.shared_folder_id
WHERE sfm.user_id = $1 AND sf.is_active = true
ORDER BY sf.name

-- 관리자 추가: 생성했지만 멤버가 아닌 폴더
SELECT sf.id, sf.name
FROM shared_folders sf
WHERE sf.created_by = $1 AND sf.is_active = true
AND NOT EXISTS (
    SELECT 1 FROM shared_folder_members sfm
    WHERE sfm.shared_folder_id = sf.id AND sfm.user_id = $1
)
```

### 7.4 스토리지 라우팅 제한

현재 WebDAV 구현은 로컬 파일시스템만 지원한다. `StorageRouter`를 통한 외부 스토리지(S3, SFTP 등)는 WebDAV 경로 해석에 통합되어 있지 않다. WebDAV의 `resolvePath`는 `{dataRoot}/users/{username}/` 및 `{dataRoot}/shared/{folderName}/`으로 직접 매핑한다.

---

## 8. 서버 라우팅 및 프록시 구성

### 8.1 서버 라우팅 (api/main.go)

Echo 프레임워크의 라우팅은 WebDAV의 비표준 HTTP 메서드(PROPFIND, MKCOL 등)를 적절히 처리하지 못한다.
이를 해결하기 위해 `http.HandlerFunc`로 래핑하여 `/webdav` 접두사 요청을 Echo보다 먼저 가로챈다:

```go
combinedHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    if strings.HasPrefix(r.URL.Path, "/webdav") {
        webdavHandler.ServeHTTP(w, r)
        return
    }
    e.ServeHTTP(w, r)
})
```

### 8.2 프론트엔드 프록시 (ui/server.cjs)

UI 서버(Express)에서 WebDAV 요청을 API 서버로 프록시한다:

```javascript
const webdavProxy = createProxyMiddleware({
    target: API_URL,
    changeOrigin: true,
    agent: keepAliveAgent,
    pathRewrite: (path, req) => {
        let targetPath = req.originalUrl;
        if (targetPath === '/webdav') {
            targetPath = '/webdav/';
        }
        return targetPath;
    },
    on: {
        proxyReq: (proxyReq, req, res) => {
            proxyReq.setHeader('X-Forwarded-Host', host);
            proxyReq.setHeader('X-Forwarded-Proto', proto);
        }
    }
});

app.all('/webdav', webdavProxy);
app.use('/webdav/', webdavProxy);
```

### 8.3 접근 URL

WebDAV 엔드포인트는 UI 서버를 통해 접근한다:

```
{protocol}://{host}/webdav/
```

예시: `https://filehatch.example.com/webdav/`

사용자 프로필 페이지에서 WebDAV URL 복사 기능을 제공한다.

---

## 9. 감사 로그

### 9.1 로그 기록 대상

쓰기 작업만 감사 로그에 기록한다. 읽기 작업(OPTIONS, PROPFIND, PROPPATCH, LOCK, UNLOCK, GET, HEAD)은 기록하지 않는다.

| WebDAV 메서드 | 이벤트 타입 | 설명 |
|---------------|-------------|------|
| PUT | `file.upload` | 파일 업로드/덮어쓰기 |
| DELETE | `file.delete` / `folder.delete` | 파일/폴더 삭제 (경로가 `/`로 끝나면 `folder.delete`) |
| MKCOL | `folder.create` | 디렉토리 생성 |
| MOVE | `file.move` | 파일/폴더 이동 |
| COPY | `file.copy` | 파일/폴더 복사 |

### 9.2 로그 데이터 형식

```sql
INSERT INTO audit_logs (actor_id, ip_addr, event_type, target_resource, details)
VALUES ($1, $2, $3, $4, $5)
```

`details` JSON 필드에 WebDAV 출처 표시:

```json
{"source": "webdav", "method": "PUT"}
```

### 9.3 클라이언트 IP 감지

X-Forwarded-For -> X-Real-IP -> RemoteAddr 순서로 클라이언트 IP를 추출한다.

---

## 10. 휴지통 연동

### 10.1 MoveToTrashInternal 함수

WebDAV DELETE 요청은 `Handler.MoveToTrashInternal`을 호출하여 웹 UI와 동일한 휴지통 동작을 구현한다.

```
[WebDAV DELETE /webdav/home/file.txt]
    |
    v
VirtualFS.RemoveAll("/home/file.txt")
    |
    v
resolvePath -> 실제 경로 확인
    |
    v
getVirtualPath -> 웹 UI 일관성 경로 ("/home/file.txt")
    |
    v
Handler.MoveToTrashInternal(username, userID, virtualPath, realPath)
    |
    +-- 1. 파일 존재 확인
    +-- 2. 휴지통 디렉토리 생성
    +-- 3. 고유 ID 생성 (timestamp_filename)
    +-- 4. os.Rename으로 휴지통 이동
    +-- 5. 크기 계산
    +-- 6. 휴지통 메타데이터 저장 (JSON)
    +-- 7. 스토리지 사용량 갱신
    +-- 8. 감사 로그 기록 (source: "webdav")
```

### 10.2 Fallback 동작

`Handler` 인스턴스가 주입되지 않은 경우(handler == nil), `os.RemoveAll`로 영구 삭제한다.

---

## 11. 클라이언트 호환성

### 11.1 Windows

| 방법 | 접속 주소 | 비고 |
|------|-----------|------|
| 파일 탐색기 > 네트워크 드라이브 연결 | `https://host/webdav/` | "다른 자격 증명으로 연결" 체크 권장 |
| `net use` 명령어 | `net use Z: https://host/webdav/ /user:username password` | 명령줄 마운트 |

**Windows 주의사항:**
- Windows WebDAV 클라이언트(WebClient 서비스)는 기본적으로 HTTPS만 지원. HTTP 사용 시 레지스트리 수정 필요 (`BasicAuthLevel = 2`)
- 파일 크기 제한: Windows WebClient는 기본 50MB 제한. 레지스트리에서 `FileSizeLimitInBytes` 수정 필요
- `MS-Author-Via: DAV` 헤더로 Windows 호환성 확보

### 11.2 macOS

| 방법 | 접속 주소 | 비고 |
|------|-----------|------|
| Finder > 서버에 연결 (Cmd+K) | `https://host/webdav/` | macOS 기본 WebDAV 클라이언트 |
| 터미널 mount | `mount -t webdav https://host/webdav/ /mnt/webdav` | CLI 마운트 |
| Cyberduck, Mountain Duck | `https://host/webdav/` | 서드파티 클라이언트 (권장) |

**macOS 주의사항:**
- Finder의 기본 WebDAV 클라이언트는 LOCK 메서드를 빈번하게 사용함
- 대용량 파일 전송 시 Cyberduck 등 서드파티 클라이언트 권장

### 11.3 Linux

| 방법 | 명령어 | 비고 |
|------|--------|------|
| davfs2 | `mount -t davfs https://host/webdav/ /mnt/webdav` | FUSE 기반 |
| GNOME Files | `davs://host/webdav/` | GNOME 기본 파일 관리자 |
| KDE Dolphin | `webdavs://host/webdav/` | KDE 기본 파일 관리자 |
| cadaver | `cadaver https://host/webdav/` | CLI 클라이언트 |

### 11.4 모바일

| OS | 앱 | 비고 |
|----|----|------|
| iOS | 파일 앱 > 서버에 연결 | iOS 내장 WebDAV 지원 |
| Android | Cx File Explorer, Total Commander | WebDAV 플러그인 사용 |

---

## 12. 제한사항 및 알려진 이슈

### 12.1 기능 제한

| 제한사항 | 설명 |
|----------|------|
| 잠금 시스템 | 메모리 기반(`NewMemLS()`)이므로 서버 재시작 시 모든 잠금이 초기화됨 |
| 외부 스토리지 미지원 | `StorageRouter`와 통합되지 않아 외부 스토리지(S3, SFTP 등)에 WebDAV로 접근 불가 |
| 사용자 속성 미지원 | 파일 태그, 설명, 즐겨찾기 등 FileHatch 고유 메타데이터는 WebDAV를 통해 조회/수정 불가 |
| 파일 잠금 미연동 | WebDAV의 LOCK/UNLOCK과 웹 UI의 파일 잠금(`file_locks` 테이블)은 별개 시스템 |
| 버전 관리 미지원 | DAV Class 3 (RFC 3253) 미구현 |
| 실시간 동기화 미발생 | WebDAV를 통한 파일 변경 시 WebSocket `FileChangeEvent`가 발생하지 않음 (FileWatcher가 감지할 수 있으나, 직접 브로드캐스트하지 않음) |

### 12.2 보안 고려사항

| 항목 | 설명 |
|------|------|
| Basic Auth | 비밀번호가 Base64로만 인코딩되므로 반드시 HTTPS 사용 권장 |
| 경로 보안 | `filepath.Clean()` 처리로 Path Traversal 방지. 단, 웹 UI의 `ValidatePath()`와 같은 명시적 검증은 없음 |
| 비활성 사용자 | `is_active = false`인 사용자는 인증 단계에서 차단됨 |
| 애플리케이션 비밀번호 미설정 | `smb_hash`가 NULL이면 WebDAV 접근 불가 |

### 12.3 성능 고려사항

| 항목 | 설명 |
|------|------|
| 요청당 DB 조회 | 매 요청마다 인증 + 경로 해석을 위한 DB 쿼리 발생 (캐싱 없음) |
| 공유 폴더 목록 | `/shared/` 접근 시 매번 DB 조회 (대량의 공유 폴더가 있는 경우 성능 영향) |
| 대용량 파일 | 파일 크기 제한 없음 (Go의 `os.OpenFile` 직접 사용). 단, 클라이언트 측 제한이 있을 수 있음 |
| 동시 접근 | `webdav.Handler`는 요청마다 새로 생성되지만, `lockSystem`은 공유됨 |

---

## 13. 관련 파일 참조

### 백엔드

| 파일 경로 | 설명 |
|-----------|------|
| `api/handlers/webdav.go` | WebDAV 핸들러, VirtualFS, 가상 디렉토리 구현 |
| `api/handlers/trash.go` | `MoveToTrashInternal` 함수 (WebDAV DELETE 연동) |
| `api/handlers/auth.go` | `SetMySMBPassword`, `authenticateUser` |
| `api/handlers/audit.go` | 감사 이벤트 상수 정의 |
| `api/main.go` | WebDAV 핸들러 생성 및 HTTP 라우팅 통합 |

### 프론트엔드

| 파일 경로 | 설명 |
|-----------|------|
| `ui/server.cjs` | WebDAV 프록시 설정 (`/webdav` -> API 서버) |
| `ui/src/components/UserProfile.tsx` | WebDAV URL 표시 및 복사, 애플리케이션 비밀번호 설정 UI |
| `ui/src/api/auth.ts` | 애플리케이션 비밀번호 설정 API 호출 |

### 데이터베이스

| 테이블 | 관련 컬럼 | 설명 |
|--------|-----------|------|
| `users` | `smb_hash` | 애플리케이션 비밀번호 bcrypt 해시 |
| `users` | `is_active` | 활성 사용자만 WebDAV 접근 가능 |
| `shared_folders` | `name`, `is_active` | 공유 폴더 정보 |
| `shared_folder_members` | `user_id`, `permission_level` | 공유 폴더 접근 권한 |
| `audit_logs` | `event_type`, `details` | WebDAV 감사 로그 (`source: "webdav"`) |
| `system_settings` | `key = 'smb_enabled'` | SMB/WebDAV 기능 활성화 여부 |
