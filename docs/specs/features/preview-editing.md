# 파일 미리보기 및 문서 편집 시스템 명세

## 1. 시스템 개요

파일 미리보기 및 문서 편집 시스템은 사용자가 업로드한 파일을 브라우저 내에서 직접 확인하고 편집할 수 있도록 하는 핵심 기능이다.
이미지, 비디오, 오디오, PDF, 텍스트, Office 문서 등 다양한 형식을 지원하며,
썸네일 생성 시스템, ETag 기반 캐싱, OnlyOffice 통합 편집기를 포함한다.

### 핵심 특성

| 특성 | 설명 |
|------|------|
| 포맷별 미리보기 | 이미지, 비디오, 오디오, PDF, 텍스트 등 유형별 최적화된 미리보기 |
| 썸네일 워커풀 | 4개 워커 고루틴 기반 비동기 썸네일 생성 (이미지 + 비디오) |
| 다단계 캐싱 | ETag + Preview Cache + HTTP Cache-Control 3중 캐싱 전략 |
| OnlyOffice 통합 | Word, Excel, PowerPoint, PDF 실시간 편집 (Docker 프로필 기반) |
| 외부 스토리지 지원 | 로컬 파일 시스템과 외부 스토리지(S3 등) 모두에서 미리보기/썸네일 생성 |
| 자막 자동 감지 | 비디오 재생 시 SRT, SMI, VTT 자막 파일 자동 검색 및 WebVTT 변환 |

---

## 2. 파일 미리보기

### 2.1 지원 포맷 및 미리보기 방식

| 카테고리 | 확장자 | MIME 타입 | 미리보기 방식 | 캐시 TTL |
|----------|--------|-----------|---------------|----------|
| 이미지 | jpg, jpeg, png, gif, webp, svg, bmp, ico | `image/*` | 원본 파일 직접 반환 (`c.File()`) | 24시간 |
| 텍스트 | txt, md, json, xml, html, css, js, ts | `text/*`, `application/json` | JSON 응답 (content 필드) | 5분 |
| 비디오 | mp4, webm, avi, mov, mkv | `video/*` | 스트리밍 URL 반환 | 1시간 |
| 오디오 | mp3, wav, ogg, flac, m4a | `audio/*` | 스트리밍 URL 반환 | 1시간 |
| PDF | pdf | `application/pdf` | 스트리밍 URL 반환 | 1시간 |
| Office | doc, docx, xls, xlsx, ppt, pptx, odt, ods, odp, rtf, csv | - | OnlyOffice 편집기 | - |
| 한글 | hwp, hwpx | `application/x-hwp`, `application/vnd.hancom.hwpx` | rhwp 임베드 (iframe) | - |
| 압축 | zip | `application/zip` | ZipViewer 컴포넌트 | - |

### 2.2 미리보기 API 핸들러 (`api/handlers/preview_handler.go`)

`GetPreview` 핸들러는 파일 확장자와 MIME 타입에 따라 서로 다른 응답 형식을 반환한다.

```go
func (h *Handler) GetPreview(c echo.Context) error
```

#### 처리 흐름

```
[GET /api/preview/{path}]
    |
    v
경로 검증 + resolveStorageForOperation()
    |
    v
파일 정보 조회 (os.Stat 또는 Backend.Stat)
    |
    v
확장자 → MIME 타입 결정 (getMimeType)
    |
    v
ETag 생성 → If-None-Match 헤더 확인
    |
    +-- 304 Not Modified (캐시 유효)
    |
    +-- 이미지 → 파일 직접 반환 (24시간 캐시)
    |
    +-- 텍스트/JSON/MD → 캐시된 텍스트 미리보기 반환 (최대 100KB, 5분 캐시)
    |
    +-- 비디오/오디오 → 스트리밍 URL JSON 반환 (1시간 캐시)
    |
    +-- PDF → URL JSON 반환 (1시간 캐시)
    |
    +-- 미지원 → unsupported 타입 반환
```

#### 응답 형식

**이미지**: 파일 바이너리 직접 반환 (Content-Type: `image/*`)

**텍스트 파일**:
```json
{
  "type": "text",
  "mimeType": "text/plain",
  "content": "파일 내용 (최대 100KB)",
  "truncated": false
}
```

**비디오/오디오**:
```json
{
  "type": "video",
  "mimeType": "video/mp4",
  "url": "/api/files/home/user/video.mp4",
  "size": 1048576
}
```

**PDF**:
```json
{
  "type": "pdf",
  "mimeType": "application/pdf",
  "url": "/api/files/home/user/document.pdf",
  "size": 524288
}
```

### 2.3 텍스트 미리보기 캐싱

텍스트 파일의 미리보기는 `PreviewCache`의 `CachedTextPreview` 메서드를 통해 캐싱된다.

| 설정 | 값 |
|------|----|
| 최대 읽기 크기 | 100KB (`DefaultTextPreviewOptions().MaxBytes`) |
| 인코딩 | UTF-8 |
| 캐시 키 | `filePath + modTime + "text:102400"` 의 MD5 해시 |
| truncated 플래그 | 캐시 데이터 마지막 바이트 (0 또는 1) |

### 2.4 ETag 기반 캐시 검증

모든 미리보기 응답에 ETag 헤더가 포함된다.

```go
// ETag 생성: 파일경로 + 수정시간 + 파일크기의 MD5 해시
func GenerateETag(filePath string, modTime time.Time, size int64) string {
    data := fmt.Sprintf("%s:%d:%d", filePath, modTime.UnixNano(), size)
    hash := md5.Sum([]byte(data))
    return fmt.Sprintf(`"%s"`, hex.EncodeToString(hash[:16]))
}
```

클라이언트가 `If-None-Match` 헤더로 ETag를 전송하면 서버는 현재 ETag와 비교하여 일치 시 `304 Not Modified`를 반환한다.

### 2.5 외부 스토리지 지원

외부 스토리지(S3, WebDAV 등)에 저장된 파일도 미리보기를 지원한다.

- `resolveStorageForOperation()`으로 스토리지 유형 판별
- 외부 스토리지: `result.Backend.Stat()`, `result.Backend.ReadFile()`로 파일 정보 조회 및 읽기
- 로컬 스토리지: `os.Stat()`, `os.Open()`으로 직접 접근
- 이미지 미리보기 시 외부 스토리지 파일은 `io.Copy`로 응답에 스트리밍

---

## 3. 썸네일 시스템

### 3.1 구조체 및 설정 (`api/handlers/thumbnail.go`)

#### 미리 정의된 썸네일 크기

| 이름 | 너비 | 높이 | 용도 |
|------|------|------|------|
| `small` | 100px | 100px | 파일 목록 그리드 뷰 |
| `medium` | 300px | 300px | 미리보기 패널 (기본값) |
| `large` | 800px | 600px | 상세 미리보기 |

#### 지원 파일 형식

| 유형 | 확장자 | 생성 방식 |
|------|--------|-----------|
| 이미지 | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp` | Go `image` 패키지 + `draw.CatmullRom` 리사이징 |
| 비디오 | `.mp4`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.flv`, `.webm` | FFmpeg 프레임 추출 |

### 3.2 워커풀 (`ThumbnailWorkerPool`)

썸네일 생성은 비동기 워커풀을 통해 처리된다.

```
[썸네일 요청]
    |
    v
캐시 확인 (PreviewCache.Get)
    |
    +-- 캐시 히트 → 즉시 반환 (7일 Cache-Control)
    |
    +-- 캐시 미스 → 워커풀 제출 (ThumbnailWorkerPool.Submit)
                        |
                        v
                    [워커 고루틴 (4개)]
                        |
                        +-- 이미지 → generateImageThumbnail()
                        |
                        +-- 비디오 → generateVideoThumbnail()
                        |
                        v
                    캐시 저장 → 결과 반환
```

| 설정 | 값 | 설명 |
|------|----|------|
| 워커 수 | 4 | 동시 처리 고루틴 수 |
| 작업 큐 크기 | 100 | 버퍼드 채널 크기 |
| 큐 초과 시 | 즉시 에러 반환 | `"worker queue full"` |
| 글로벌 인스턴스 | `sync.Once` | 싱글톤 패턴으로 1회 초기화 |

### 3.3 이미지 썸네일 생성

```go
func generateImageThumbnail(filePath string, size ThumbnailSize) ([]byte, error)
```

1. `image.Decode()`로 원본 이미지 디코딩 (JPEG, PNG, GIF, WebP 지원)
2. `calculateThumbnailSize()`로 종횡비 유지하며 새 크기 계산
3. `draw.CatmullRom.Scale()`로 고품질 리사이징 (CatmullRom 보간법)
4. JPEG 품질 85로 인코딩하여 반환

#### 크기 계산 알고리즘

```go
func calculateThumbnailSize(origWidth, origHeight, maxWidth, maxHeight int) (int, int)
```

- 원본이 최대 크기 이내이면 그대로 반환
- 가로/세로 비율을 비교하여 제한 요소(가로 또는 세로)를 기준으로 축소
- 최소 1px 보장

### 3.4 비디오 썸네일 생성

```go
func generateVideoThumbnail(filePath string, size ThumbnailSize) ([]byte, error)
```

FFmpeg를 사용하여 비디오에서 프레임을 추출한다.

```bash
ffmpeg -i {input} -ss 00:00:05 -vframes 1 \
  -vf "scale={width}:{height}:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2" \
  -q:v 2 -y {output.jpg}
```

| 설정 | 값 | 설명 |
|------|----|------|
| 시크 위치 | 5초 | 1차 시도 |
| 폴백 위치 | 1초 | 5초 시크 실패 시 |
| 스케일 필터 | `force_original_aspect_ratio=decrease` | 종횡비 유지 |
| 패딩 필터 | `ceil(iw/2)*2:ceil(ih/2)*2` | mjpeg 인코더 요구 짝수 차원 보장 |
| 품질 | `-q:v 2` | 높은 품질 |

### 3.5 WebP 변환

요청 시 `format=webp` 파라미터로 WebP 형식 변환을 지원한다.

```go
func convertToWebP(jpegData []byte) ([]byte, error)
```

- `cwebp` 명령어 사용 (시스템에 설치 필요)
- 품질: `-q 80`
- JPEG → WebP 변환 파이프라인

### 3.6 캐시 시스템 (`api/handlers/preview_cache.go`)

#### 캐시 구조

```go
type PreviewCache struct {
    cacheDir    string        // 기본값: "/data/.cache/previews"
    maxAge      time.Duration // 기본값: 24시간
    mu          sync.RWMutex  // 동시성 제어
    cleanupOnce sync.Once     // 정리 고루틴 1회 시작
}
```

#### 캐시 키 생성

```go
// 키 = MD5(filePath + modTime + suffix)
// 서브디렉토리 = 키의 처음 2자 (디렉토리 분산)
func (c *PreviewCache) GetCachePath(key string) string {
    subDir := key[:2]
    return filepath.Join(c.cacheDir, subDir, key)
}
```

#### 캐시 설정

| 설정 | 값 | 설명 |
|------|----|------|
| 캐시 디렉토리 | `/data/.cache/previews` | 서브디렉토리 해시 분산 |
| 캐시 만료 | 24시간 | `maxAge` |
| 정리 주기 | 1시간 | `StartCleanup(time.Hour)` |
| HTTP 캐시 (썸네일) | 7일 | `Cache-Control: public, max-age=604800` |
| HTTP 캐시 (이미지) | 24시간 | `Cache-Control: public, max-age=86400` |
| HTTP 캐시 (텍스트) | 5분 | `Cache-Control: public, max-age=300` |
| HTTP 캐시 (미디어/PDF) | 1시간 | `Cache-Control: public, max-age=3600` |

#### 캐시 통계 및 관리 (관리자 전용)

| API | 설명 |
|-----|------|
| `GET /api/admin/thumbnails/stats` | 캐시 파일 수, 총 크기, 가장 오래된 항목 |
| `DELETE /api/admin/thumbnails/cache` | 전체 캐시 삭제 |

### 3.7 반응형 썸네일

단일 요청으로 모든 크기의 썸네일 URL을 반환한다.

```
GET /api/thumbnails/responsive/{path}
```

**응답**:
```json
{
  "srcset": {
    "small": "/api/thumbnail/{path}?size=small",
    "medium": "/api/thumbnail/{path}?size=medium",
    "large": "/api/thumbnail/{path}?size=large"
  },
  "webp": {
    "small": "/api/thumbnail/{path}?size=small&format=webp",
    "medium": "/api/thumbnail/{path}?size=medium&format=webp",
    "large": "/api/thumbnail/{path}?size=large&format=webp"
  }
}
```

### 3.8 배치 썸네일

여러 파일의 썸네일 상태를 한 번에 확인하고 생성을 큐잉한다.

```
POST /api/thumbnails/batch
```

**요청**:
```json
{
  "paths": ["/home/user/photo1.jpg", "/home/user/photo2.png"],
  "size": "small"
}
```

**응답** (파일별):
```json
{
  "/home/user/photo1.jpg": {
    "status": "cached",
    "url": "/api/thumbnail/home/user/photo1.jpg?size=small"
  },
  "/home/user/photo2.png": {
    "status": "queued",
    "url": "/api/thumbnail/home/user/photo2.png?size=small"
  }
}
```

| 제한 | 값 |
|------|----|
| 최대 경로 수 | 50 |
| 기본 크기 | `small` |

### 3.9 프리로드

디렉토리의 이미지/비디오 파일에 대해 미리 썸네일을 생성한다.

```
POST /api/thumbnails/preload/{path}?limit=50
```

| 설정 | 값 | 설명 |
|------|----|------|
| 기본 제한 | 50 | 한 번에 큐잉할 최대 파일 수 |
| 최대 제한 | 200 | limit 파라미터 최대값 |
| 기본 크기 | `medium` | JPEG 형식 |
| 외부 스토리지 | 미지원 | 다운로드 비용 때문에 건너뜀 |

---

## 4. OnlyOffice 통합

### 4.1 개요

OnlyOffice Document Server를 통해 Word, Excel, PowerPoint 문서를 브라우저에서 직접 편집할 수 있다.
Docker Compose의 `office` 프로필로 선택적으로 활성화된다.

### 4.2 지원 파일 형식

| 문서 유형 | OnlyOffice `documentType` | 확장자 |
|-----------|--------------------------|--------|
| 문서 (word) | `word` | `.doc`, `.docx`, `.odt`, `.rtf`, `.txt`, `.pdf` |
| 스프레드시트 (cell) | `cell` | `.xls`, `.xlsx`, `.ods`, `.csv` |
| 프레젠테이션 (slide) | `slide` | `.ppt`, `.pptx`, `.odp` |

> 참고: PDF는 OnlyOffice에서 `word` 모드로 열린다. `.txt`는 프론트엔드에서 내장 텍스트 편집기를 우선 사용하므로, OnlyOffice 지원 목록에서 제외된다.

### 4.3 환경 변수 설정

| 환경 변수 | 기본값 | 설명 |
|-----------|--------|------|
| `ONLYOFFICE_INTERNAL_URL` | `http://onlyoffice` | Docker 내부 네트워크 URL (API → OnlyOffice) |
| `ONLYOFFICE_PUBLIC_URL` | 없음 (프론트엔드가 `{protocol}://{hostname}:8088` 사용) | 브라우저에서 접근하는 OnlyOffice 공개 URL |

### 4.4 설정 확인 API

```
GET /api/onlyoffice/settings
```

OnlyOffice 활성화 여부와 공개 URL을 반환한다. 내부적으로 `{internalURL}/healthcheck`에 3초 타임아웃 HTTP 요청을 보내 가용성을 확인한다.

**응답**:
```json
{
  "publicUrl": "https://office.example.com",
  "available": true
}
```

### 4.5 문서 설정 API (`GetOnlyOfficeConfig`)

```
GET /api/onlyoffice/config/{path}
```

OnlyOffice 에디터 초기화에 필요한 전체 설정을 반환한다. JWT 인증 필수.

#### 문서 키 생성

```go
func generateDocumentKey(path string, modTime int64) string {
    hash := sha256.Sum256([]byte(path))
    hashStr := hex.EncodeToString(hash[:])
    return hashStr[:20] + fmt.Sprintf("_%d", modTime)
}
```

- SHA256 해시의 처음 20자 + 수정 시간 타임스탬프
- 비 ASCII 경로를 안전하게 처리 (hex 문자만 포함)
- 파일 수정 시 키가 변경되어 OnlyOffice가 새 버전을 로드

#### 응답 구조

```json
{
  "documentType": "word",
  "document": {
    "fileType": "docx",
    "key": "a1b2c3d4e5f6a7b8c9d0_1708300000",
    "title": "문서.docx",
    "url": "http://api:8080/api/files/{path}?token={jwt}"
  },
  "editorConfig": {
    "callbackUrl": "http://api:8080/api/onlyoffice/callback?token={jwt}&path={encodedPath}",
    "user": {
      "id": "user-uuid",
      "name": "사용자명"
    },
    "lang": "ko",
    "mode": "edit",
    "customization": {
      "autosave": true,
      "forcesave": true
    },
    "coEditing": {
      "mode": "strict",
      "change": false
    }
  }
}
```

#### 편집/뷰 모드 결정

| 조건 | 모드 | 콜백 URL |
|------|------|----------|
| 파일 소유자 | `edit` | 포함 |
| 공유 파일 (쓰기 권한) | `edit` | 포함 |
| 공유 파일 (읽기 전용) | `view` | 미포함 |

- `autosave`와 `forcesave`는 편집 가능 시에만 `true`
- 공동 편집은 `strict` 모드로 비활성화 (프레젠테이션 SDK 버그 방지)

### 4.6 콜백 처리 (`OnlyOfficeCallback`)

```
POST /api/onlyoffice/callback?token={jwt}&path={encodedPath}
```

OnlyOffice가 문서 저장 시 호출하는 콜백 엔드포인트이다.

#### OnlyOffice 상태 코드

| 코드 | 상태 | 처리 |
|------|------|------|
| 0 | 해당 키의 문서 없음 | 무시 |
| 1 | 편집 중 | 무시 (성공 응답) |
| 2 | 저장 준비 완료 | **문서 다운로드 및 저장** |
| 3 | 저장 오류 | 무시 (성공 응답) |
| 4 | 변경 없음 | 무시 (성공 응답) |
| 6 | 강제 저장 | **문서 다운로드 및 저장** |
| 7 | 강제 저장 오류 | 무시 (성공 응답) |

#### 저장 흐름 (상태 2, 6)

```
[OnlyOffice → POST /api/onlyoffice/callback]
    |
    v
경로 추출 (쿼리 파라미터 또는 key에서 base64 디코드)
    |
    v
JWT 토큰 검증 (쿼리 파라미터 token)
    |
    v
경로 해석 (resolvePath 또는 GetSharedFileOwnerPath)
    |
    v
공유 파일 쓰기 권한 확인 (CanWriteSharedFile)
    |
    v
외부 URL → Docker 내부 URL 변환 (convertToInternalURL)
    |
    v
OnlyOffice에서 문서 다운로드 (HTTP GET)
    |
    v
파일 원자적 쓰기 (writeFileAtomic)
    |
    v
감사 로그 기록 (EventFileEdit, source: "onlyoffice")
    |
    v
성공 응답: {"error": 0}
```

#### URL 변환 (`convertToInternalURL`)

OnlyOffice는 문서 다운로드 URL을 공개 주소로 전달하지만, API 서버는 Docker 내부 네트워크를 통해 접근해야 한다.

```go
// 공개 URL → 내부 URL 변환
// 예: https://office.example.com/cache/... → http://onlyoffice/cache/...
func convertToInternalURL(externalURL string) string
```

변환 우선순위:
1. `ONLYOFFICE_PUBLIC_URL`이 설정된 경우 해당 접두사 치환
2. `localhost` 또는 `127.0.0.1` 패턴 감지 시 내부 URL로 치환
3. 일치하지 않으면 원본 URL 그대로 사용

### 4.7 공유 링크의 OnlyOffice 편집

편집 가능 공유 링크(`/api/e/:token`)를 통해 인증 없이도 OnlyOffice 편집이 가능하다.

| API | 설명 |
|-----|------|
| `GET /api/e/:token` | 편집 공유 접근 |
| `GET /api/e/:token/config` | 공유 파일 OnlyOffice 설정 |
| `GET /api/e/:token/file` | 공유 파일 다운로드 (OnlyOffice용) |
| `POST /api/e/:token/callback` | 공유 파일 저장 콜백 |

---

## 5. 오피스 문서 템플릿

### 5.1 개요 (`api/handlers/office_templates.go`)

새 Office 문서 생성 시 유효한 최소 템플릿을 Go 코드에서 직접 생성한다.
OOXML(ZIP 기반) 형식의 필수 구성 요소만 포함한 경량 템플릿이다.

### 5.2 지원 템플릿

| 함수 | 파일 유형 | 포함 요소 |
|------|-----------|-----------|
| `createDocxTemplate()` | Word (.docx) | `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `word/_rels/document.xml.rels` |
| `createXlsxTemplate()` | Excel (.xlsx) | `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/worksheets/sheet1.xml`, `xl/_rels/workbook.xml.rels` |
| `createPptxTemplate()` | PowerPoint (.pptx) | 완전한 구조 (presentation, slide, slideMaster, slideLayout, theme, presProps, viewProps, tableStyles, docProps) |

### 5.3 PPTX 템플릿 상세

PowerPoint 템플릿은 가장 복잡한 구조를 가진다.

```
[Content_Types].xml
_rels/.rels
docProps/
  core.xml          ← 작성자: "FileHatch"
  app.xml           ← 슬라이드 수: 1, 형식: 4:3
ppt/
  presentation.xml  ← 기본 텍스트: ko-KR
  presProps.xml
  viewProps.xml
  tableStyles.xml
  theme/
    theme1.xml      ← Office 테마 (색상, 폰트, 효과 스키마)
  slideMasters/
    slideMaster1.xml
    _rels/slideMaster1.xml.rels
  slideLayouts/
    slideLayout1.xml  ← Blank 레이아웃
    _rels/slideLayout1.xml.rels
  slides/
    slide1.xml        ← 빈 슬라이드
    _rels/slide1.xml.rels
  _rels/
    presentation.xml.rels
```

### 5.4 파일 생성 흐름 (`api/handlers/create_handler.go`)

```
POST /api/files/create
{
  "path": "/documents",
  "filename": "새문서.docx",
  "fileType": "docx"
}
```

```
[CreateFile 핸들러]
    |
    v
파일명 검증 (위험 문자 금지)
    |
    v
경로 해석 (resolveStorageForOperation)
    |
    v
getTemplateContent(fileType) → 템플릿 바이트 반환
    |
    +-- "txt", "text" → 빈 문자열
    +-- "html" → HTML 보일러플레이트
    +-- "json" → "{\n  \n}"
    +-- "md" → "# New Document\n\n"
    +-- "docx" → createDocxTemplate()
    +-- "xlsx" → createXlsxTemplate()
    +-- "pptx" → createPptxTemplate()
    |
    v
파일 쓰기 (로컬: os.WriteFile / 외부: Backend.WriteFile)
    |
    v
감사 로그 기록 (EventFileUpload, source: "create")
    |
    v
응답: { success: true, filename, path }
```

### 5.5 프론트엔드 파일 유형 옵션

```typescript
export const fileTypeOptions: FileTypeOption[] = [
  { type: 'txt',  name: '텍스트 파일',            extension: '.txt',  icon: 'text' },
  { type: 'md',   name: 'Markdown',               extension: '.md',   icon: 'markdown' },
  { type: 'html', name: 'HTML',                   extension: '.html', icon: 'html' },
  { type: 'json', name: 'JSON',                   extension: '.json', icon: 'json' },
  { type: 'docx', name: 'Word 문서',              extension: '.docx', icon: 'word' },
  { type: 'xlsx', name: 'Excel 스프레드시트',     extension: '.xlsx', icon: 'excel' },
  { type: 'pptx', name: 'PowerPoint 프레젠테이션', extension: '.pptx', icon: 'powerpoint' },
]
```

---

## 6. 자막 지원

### 6.1 개요 (`api/handlers/preview_handler.go`)

비디오 재생 시 동일 디렉토리에 같은 이름의 자막 파일이 있으면 자동으로 감지하여 WebVTT 형식으로 변환해 반환한다.

### 6.2 지원 자막 형식

| 형식 | 확장자 | 변환 함수 |
|------|--------|-----------|
| WebVTT | `.vtt` | 변환 없음 (그대로 반환) |
| SubRip | `.srt` | `convertSRTtoVTT()` |
| SAMI | `.smi`, `.sami` | `convertSMItoVTT()` |

### 6.3 자막 검색 로직

```
GET /api/subtitle/{video-path}
```

```
[비디오 파일 경로에서 확장자 제거 → baseName]
    |
    v
순서대로 검색: .srt → .smi → .sami → .vtt
    |
    v (대소문자 양쪽 시도)
    |
    +-- 검색 성공 → 형식에 맞게 WebVTT로 변환
    |       Content-Type: text/vtt; charset=utf-8
    |
    +-- 검색 실패 → 404 "No subtitle found"
```

검색 예시: `movie.mp4` → `movie.srt`, `movie.SRT`, `movie.smi`, `movie.SMI`, `movie.sami`, `movie.SAMI`, `movie.vtt`, `movie.VTT`

### 6.4 SRT → WebVTT 변환 (`convertSRTtoVTT`)

| 변환 규칙 |
|-----------|
| CRLF → LF 치환 |
| 시퀀스 번호 행 제거 |
| 타임스탬프의 쉼표(`,`) → 마침표(`.`) 치환 |
| 파일 시작에 `WEBVTT\n\n` 헤더 추가 |

### 6.5 SMI/SAMI → WebVTT 변환 (`convertSMItoVTT`)

| 변환 규칙 |
|-----------|
| `<SYNC START=밀리초>` 태그에서 타임스탬프 추출 |
| HTML 태그 제거 (`stripHTMLTags`) |
| `&nbsp;` → 공백 치환 |
| 다음 SYNC 블록의 시작을 현재 블록의 종료 시간으로 사용 |
| 마지막 블록: 기본 5초 지속 시간 |
| 밀리초 → `HH:MM:SS.mmm` 형식 변환 (`formatVTTTime`) |

### 6.6 외부 스토리지 지원

외부 스토리지에 저장된 비디오의 자막도 검색한다.
- `result.Backend.Exists()`로 존재 여부 확인
- `result.Backend.ReadFile()`로 자막 내용 읽기
- 동일한 변환 로직 적용

---

## 7. 프론트엔드 구현

### 7.1 컴포넌트 계층

```
FileViewer.tsx               # 이미지, PDF, 비디오, 오디오 뷰어 (오버레이)
TextEditor.tsx               # Monaco 기반 텍스트/코드 편집기 (오버레이)
OnlyOfficeEditor.tsx         # OnlyOffice Document Server 통합 편집기 (오버레이)
ZipViewer.tsx                # ZIP 아카이브 탐색기
```

### 7.2 FileViewer (`ui/src/components/FileViewer.tsx`)

이미지, PDF, 비디오, 오디오 파일을 오버레이로 미리보는 컴포넌트이다.

#### 뷰어 타입 판별

```typescript
type ViewerType = 'image' | 'pdf' | 'video' | 'audio' | 'unsupported'

function getViewerType(fileName: string, mimeType?: string): ViewerType
```

1. MIME 타입 우선 확인
2. 없으면 확장자 기반 폴백

#### 이미지 뷰어

| 기능 | 설명 |
|------|------|
| 확대/축소 | `+`/`-` 키, 버튼 (25% 단위, 25%~300%) |
| 원본 크기 복원 | 버튼 클릭 |
| 파일 간 탐색 | 좌/우 화살표 키, 네비게이션 버튼 |
| 파일 카운터 | "3 / 15" 형식 표시 |
| 로딩 | `fetch` + `blob` → `URL.createObjectURL` |

#### PDF 뷰어

| 기능 | 설명 |
|------|------|
| 라이브러리 | `react-pdf` (PDF.js 기반) |
| 페이지 탐색 | 좌/우 화살표 키, 버튼 |
| 확대/축소 | `+`/`-` 키 (25% 단위) |
| 텍스트 레이어 | `renderTextLayer={true}` (텍스트 선택 가능) |
| 주석 레이어 | `renderAnnotationLayer={true}` |
| 인증 | `fetch` + `Authorization` 헤더로 ArrayBuffer 로드 |

#### 비디오 뷰어

| 기능 | 설명 |
|------|------|
| 재생 | HTML5 `<video>` 태그, `autoPlay`, `playsInline` |
| 인증 | 토큰을 쿼리 파라미터로 전달 (`?token=`) |
| 자막 | `<track>` 태그로 WebVTT 자막 자동 로드 |
| 브라우저 호환 | MP4, WebM, OGG만 직접 재생 가능 |
| 미지원 형식 | 다운로드 안내 UI 표시 (MKV, AVI 등) |

브라우저 재생 가능 판별:
```typescript
function isBrowserPlayableVideo(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const playableExts = ['mp4', 'webm', 'ogg', 'm4v']
  return playableExts.includes(ext)
}
```

#### 오디오 뷰어

| 기능 | 설명 |
|------|------|
| 재생 | HTML5 `<audio>` 태그, `autoPlay` |
| 아이콘 | 음표 SVG 아이콘 표시 |
| 파일명 | 오디오 파일명 표시 |
| 인증 | 토큰을 쿼리 파라미터로 전달 |

#### 자막 자동 감지

```typescript
// 비디오 뷰어 초기화 시 자막 존재 확인
if (viewerType === 'video') {
  fetch(subtitleApiUrl, { method: 'HEAD' })
    .then(res => {
      if (res.ok) setSubtitleUrl(subtitleApiUrl)
    })
}
```

- `/api/subtitle/{path}` 엔드포인트에 HEAD 요청
- 200 응답 시 `<track>` 태그에 자막 URL 설정
- 기본 자막 언어: `ko` (한국어)

#### 키보드 단축키

| 키 | 동작 |
|----|------|
| `Escape` | 뷰어 닫기 |
| `ArrowLeft` | 이전 파일 (이미지/비디오/오디오) 또는 이전 페이지 (PDF) |
| `ArrowRight` | 다음 파일 (이미지/비디오/오디오) 또는 다음 페이지 (PDF) |
| `+` / `=` | 확대 (25% 단위, 최대 300%) |
| `-` | 축소 (25% 단위, 최소 25%) |

### 7.3 TextEditor (`ui/src/components/TextEditor.tsx`)

Monaco Editor 기반의 텍스트/코드 편집기이다.

| 기능 | 설명 |
|------|------|
| 에디터 | `@monaco-editor/react` |
| 구문 강조 | 확장자 기반 자동 언어 감지 |
| 파일 읽기 | `readFileContent()` API 호출 |
| 파일 저장 | `saveFileContent()` API 호출 (`PUT /api/files/content/{path}`) |

#### 지원 언어 매핑

| 확장자 | 언어 |
|--------|------|
| `.js`, `.jsx` | JavaScript |
| `.ts`, `.tsx` | TypeScript |
| `.json` | JSON |
| `.html`, `.htm` | HTML |
| `.css` | CSS |
| `.md` | Markdown |
| `.py` | Python |
| `.go` | Go |
| `.rs` | Rust |
| `.java` | Java |
| `.sql` | SQL |
| `.yaml`, `.yml` | YAML |
| `.xml` | XML |
| `.sh`, `.bash`, `.zsh` | Shell |
| 기타 | plaintext |

### 7.4 OnlyOfficeEditor (`ui/src/components/OnlyOfficeEditor.tsx`)

OnlyOffice Document Server API를 통해 Office 문서를 편집하는 컴포넌트이다.

#### 초기화 흐름

```
[OnlyOfficeEditor 마운트]
    |
    v
OnlyOffice API 스크립트 로드
  → {publicUrl || protocol://hostname:8088}/web-apps/apps/api/documents/api.js
    |
    +-- 로드 실패 → "OnlyOffice가 설치되어 있지 않습니다" 에러 표시
    |
    +-- 로드 성공 → 100ms 딜레이 후 에디터 초기화
                        |
                        v
                    new window.DocsAPI.DocEditor('onlyoffice-editor', config)
                        |
                        v
                    이벤트 핸들러:
                      onDocumentReady → 로딩 해제
                      onError → 에러 표시
                      onRequestClose → onClose 콜백
```

#### 컴포넌트 Props

```typescript
interface OnlyOfficeEditorProps {
  config: OnlyOfficeConfig   // 서버에서 받은 OnlyOffice 설정
  publicUrl?: string | null  // OnlyOffice 공개 URL
  onClose: () => void        // 닫기 콜백
  onError?: (error: string) => void  // 에러 콜백
}
```

#### 안전장치

| 보호 메커니즘 | 설명 |
|--------------|------|
| `isMountedRef` | 언마운트 후 상태 업데이트 방지 |
| `initializingRef` | 이중 초기화 방지 |
| 에디터 파괴 | cleanup에서 `destroyEditor()` 호출 |
| DOM 확인 | `getElementById` 검증 후 초기화 |

#### 에디터 설정 확장

프론트엔드에서 서버 설정에 추가 옵션을 적용한다.

```typescript
const editorConfig = {
  ...config.editorConfig,
  mode: 'edit',
  customization: {
    ...config.editorConfig.customization,
    compactHeader: true,     // 컴팩트 헤더
    toolbarNoTabs: false,    // 탭 표시
  },
}
```

### 7.5 프론트엔드 API 함수 (`ui/src/api/files.ts`)

| 함수 | 설명 |
|------|------|
| `getPreview(path)` | 파일 미리보기 데이터 조회 |
| `checkOnlyOfficeStatus()` | OnlyOffice 가용성 확인 |
| `getOnlyOfficeConfig(path)` | 파일별 OnlyOffice 편집 설정 조회 |
| `isOnlyOfficeSupported(ext)` | 확장자별 OnlyOffice 지원 여부 확인 |
| `readFileContent(path)` | 텍스트 파일 내용 읽기 |
| `saveFileContent(path, content)` | 텍스트 파일 내용 저장 |
| `createFile(path, filename, fileType)` | 새 파일 생성 (템플릿 포함) |
| `getFileUrl(path)` | 파일 직접 접근 URL 생성 |
| `getAuthToken()` | 인증 토큰 조회 (스트리밍 URL용) |

---

## 8. API 엔드포인트 총괄

### 8.1 미리보기

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/api/preview/*` | 선택적 JWT | 파일 유형별 미리보기 데이터 반환 |

### 8.2 자막

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET/HEAD | `/api/subtitle/*` | 선택적 JWT | 비디오 자막 WebVTT 변환 반환 |

### 8.3 썸네일

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET/HEAD | `/api/thumbnail/*` | 선택적 JWT | 단일 파일 썸네일 (`?size=small\|medium\|large`, `?format=jpeg\|webp`) |
| GET | `/api/thumbnails/responsive/*` | 선택적 JWT | 모든 크기의 썸네일 URL 반환 |
| POST | `/api/thumbnails/batch` | 선택적 JWT | 다중 파일 썸네일 상태 확인 및 큐잉 |
| POST | `/api/thumbnails/preload/*` | 선택적 JWT | 디렉토리 내 파일 썸네일 사전 생성 |
| GET | `/api/admin/thumbnails/stats` | 관리자 | 캐시 통계 조회 |
| DELETE | `/api/admin/thumbnails/cache` | 관리자 | 캐시 전체 삭제 |

### 8.4 OnlyOffice

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/api/onlyoffice/settings` | 없음 | OnlyOffice 가용성 및 공개 URL |
| GET | `/api/onlyoffice/config/*` | 필수 JWT | 문서 편집 설정 반환 |
| POST | `/api/onlyoffice/callback` | 쿼리 토큰 | 문서 저장 콜백 |

### 8.5 공유 파일 OnlyOffice 편집

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/api/e/:token` | 선택적 JWT | 편집 공유 접근 |
| GET | `/api/e/:token/config` | 선택적 JWT | 공유 파일 OnlyOffice 설정 |
| GET | `/api/e/:token/file` | 선택적 JWT | 공유 파일 다운로드 |
| POST | `/api/e/:token/callback` | 없음 | 공유 파일 저장 콜백 |

### 8.6 파일 생성

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| POST | `/api/files/create` | 선택적 JWT | 새 파일 생성 (템플릿 기반) |

### 8.7 텍스트 편집

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/api/files/*` | 선택적 JWT | 파일 내용 읽기 (텍스트 편집용) |
| PUT | `/api/files/content/*` | 선택적 JWT | 파일 내용 저장 |

---

## 9. 관련 파일 참조

### 백엔드

| 파일 경로 | 설명 |
|-----------|------|
| `api/handlers/preview_handler.go` | 미리보기 핸들러 (`GetPreview`, `GetSubtitle`, 자막 변환 함수) |
| `api/handlers/preview_cache.go` | 미리보기 캐시 (`PreviewCache`, `GenerateETag`, `CheckETag`, `SetCacheHeaders`) |
| `api/handlers/thumbnail.go` | 썸네일 시스템 (`ThumbnailWorkerPool`, 이미지/비디오 썸네일 생성, 배치/프리로드/반응형) |
| `api/handlers/onlyoffice.go` | OnlyOffice 통합 (설정, 콜백, 헬스체크, URL 변환) |
| `api/handlers/office_templates.go` | Office 문서 템플릿 생성 (DOCX, XLSX, PPTX) |
| `api/handlers/create_handler.go` | 파일 생성 핸들러 (`CreateFile`, `getTemplateContent`) |
| `api/handlers/handler.go` | MIME 타입 매핑 (`getMimeType`, `mimeTypes` 맵) |
| `api/handlers/utils.go` | 유틸리티 (`writeFileAtomic`, `statFile`) |
| `api/main.go` | API 라우트 등록 (미리보기, 썸네일, OnlyOffice, 자막) |

### 프론트엔드

| 파일 경로 | 설명 |
|-----------|------|
| `ui/src/components/FileViewer.tsx` | 이미지/PDF/비디오/오디오 미리보기 오버레이 |
| `ui/src/components/FileViewer.css` | FileViewer 스타일 |
| `ui/src/components/TextEditor.tsx` | Monaco 기반 텍스트 편집기 |
| `ui/src/components/TextEditor.css` | TextEditor 스타일 |
| `ui/src/components/OnlyOfficeEditor.tsx` | OnlyOffice 통합 편집기 |
| `ui/src/components/OnlyOfficeEditor.css` | OnlyOfficeEditor 스타일 |
| `ui/src/components/ZipViewer.tsx` | ZIP 아카이브 탐색기 |
| `ui/src/api/files.ts` | 미리보기/OnlyOffice/파일 생성 API 함수 |

---

## 10. rhwp HWP 뷰어/에디터 (Issue #35)

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
