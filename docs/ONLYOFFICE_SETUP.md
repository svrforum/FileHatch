# OnlyOffice Document Server 설정 가이드

FileHatch에서 OnlyOffice Document Server를 설정하여 브라우저에서 Office 문서를 편집하는 방법을 상세히 설명합니다.

---

## 목차

1. [개요](#1-개요)
2. [사전 요구사항](#2-사전-요구사항)
3. [OnlyOffice 설치 및 시작](#3-onlyoffice-설치-및-시작)
4. [네트워크 구성 이해](#4-네트워크-구성-이해)
5. [기본 사용 방법](#5-기본-사용-방법)
6. [외부 접근 설정](#6-외부-접근-설정)
7. [공유 링크에서 문서 편집](#7-공유-링크에서-문서-편집)
8. [성능 최적화](#8-성능-최적화)
9. [문제 해결](#9-문제-해결)
10. [프로덕션 권장 사항](#10-프로덕션-권장-사항)

---

## 1. 개요

### OnlyOffice Document Server란?

OnlyOffice Document Server는 웹 브라우저에서 Microsoft Office 호환 문서를 편집할 수 있는 오픈소스 오피스 스위트입니다. FileHatch와 통합하면 별도의 Office 소프트웨어 없이 문서를 직접 편집할 수 있습니다.

### 지원 문서 형식

| 문서 유형 | 지원 확장자 | 편집 모드 |
|----------|------------|----------|
| **Word 문서** | `.docx`, `.doc`, `.odt`, `.rtf`, `.txt` | 텍스트 편집기 |
| **Excel 스프레드시트** | `.xlsx`, `.xls`, `.ods`, `.csv` | 스프레드시트 편집기 |
| **PowerPoint 프레젠테이션** | `.pptx`, `.ppt`, `.odp` | 프레젠테이션 편집기 |
| **PDF 문서** | `.pdf` | 뷰어 (읽기 전용) |

### 주요 기능

- **실시간 편집**: 브라우저에서 직접 문서 편집
- **자동 저장**: 편집 중 자동으로 변경사항 저장
- **서식 유지**: Microsoft Office와 높은 호환성
- **공유 문서 편집**: 공유 링크를 통한 외부 사용자 편집 지원

---

## 2. 사전 요구사항

### 시스템 요구사항

| 항목 | 최소 사양 | 권장 사양 |
|------|----------|----------|
| **RAM** | 4GB | 8GB 이상 |
| **CPU** | 2코어 | 4코어 이상 |
| **디스크** | 10GB | 20GB 이상 |
| **네트워크** | 포트 8088 접근 가능 | - |

> ⚠️ OnlyOffice는 상당한 리소스를 사용합니다. 다른 서비스와 함께 실행할 경우 충분한 메모리를 확보하세요.

### 소프트웨어 요구사항

- Docker Engine 24.0 이상
- Docker Compose v2.20 이상
- FileHatch 기본 서비스 실행 중

---

## 3. OnlyOffice 설치 및 시작

### 3.1 환경 변수 설정

`.env` 파일에서 OnlyOffice 관련 설정을 확인합니다:

```bash
# OnlyOffice 설정
ONLYOFFICE_PORT=8088              # OnlyOffice 접속 포트
ONLYOFFICE_PUBLIC_URL=            # 외부 접근 URL (선택)
```

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `ONLYOFFICE_PORT` | 8088 | OnlyOffice 외부 포트 |
| `ONLYOFFICE_INTERNAL_URL` | http://onlyoffice | Docker 내부 URL (변경 불필요) |
| `ONLYOFFICE_PUBLIC_URL` | (비어있음) | 브라우저가 접근할 URL |

### 3.2 OnlyOffice 시작

```bash
# OnlyOffice 프로필로 서비스 시작
docker compose --profile office up -d

# 또는 SSO와 함께 시작
docker compose --profile office --profile sso up -d
```

### 3.3 시작 상태 확인

OnlyOffice는 시작하는 데 약 **2-3분**이 소요됩니다.

```bash
# 로그 확인 (실시간)
docker compose logs -f onlyoffice

# 헬스체크 확인
docker compose ps onlyoffice

# 또는 직접 헬스체크 엔드포인트 호출
curl http://localhost:8088/healthcheck
```

**정상 시작 확인:**
```bash
$ curl http://localhost:8088/healthcheck
true
```

### 3.4 OnlyOffice 상태 확인 (FileHatch)

FileHatch에서 OnlyOffice 상태를 확인할 수 있습니다:

```bash
curl http://localhost:3080/api/onlyoffice/settings
```

**응답 예시:**
```json
{
  "available": true,
  "publicUrl": "http://localhost:8088"
}
```

---

## 4. 네트워크 구성 이해

### 4.1 내부 URL vs 공개 URL

OnlyOffice 통합에는 두 가지 URL이 사용됩니다:

| URL 유형 | 용도 | 예시 |
|---------|------|------|
| **내부 URL** | API 서버 → OnlyOffice 통신 | `http://onlyoffice` |
| **공개 URL** | 브라우저 → OnlyOffice 통신 | `http://localhost:8088` |

### 4.2 네트워크 통신 흐름

```
┌─────────────────────────────────────────────────────────────────────┐
│                          브라우저                                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
       ┌───────────────────────┼───────────────────────┐
       │                       │                       │
       ▼                       ▼                       ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────────────┐
│  FileHatch   │      │  FileHatch   │      │    OnlyOffice        │
│  UI (:3080)  │─────▶│  API (:8080) │      │ Document Server      │
│              │      │              │      │     (:8088)          │
└──────────────┘      └───────┬──────┘      └──────────────────────┘
                              │                       ▲
                              │                       │
                              │   Docker Network      │
                              │   (http://onlyoffice) │
                              └───────────────────────┘
```

### 4.3 문서 편집 워크플로우

```
1. 사용자가 파일 선택하여 편집 시작
   브라우저 → FileHatch API: GET /api/onlyoffice/config/{path}

2. API가 편집 설정 반환
   - 문서 URL (API 서버 경유)
   - 콜백 URL (저장용)
   - 사용자 정보

3. 브라우저가 OnlyOffice 에디터 로드
   브라우저 → OnlyOffice: {PUBLIC_URL}/web-apps/apps/api/documents/api.js

4. OnlyOffice가 문서 로드
   OnlyOffice → FileHatch API: GET /api/files/{path} (내부 네트워크)

5. 사용자가 문서 편집

6. 자동 저장 또는 편집 완료 시
   OnlyOffice → FileHatch API: POST /api/onlyoffice/callback

7. API가 OnlyOffice에서 수정된 문서 다운로드 및 저장
   FileHatch API → OnlyOffice: GET /cache/files/{key}
```

---

## 5. 기본 사용 방법

### 5.1 지원 파일 형식

FileHatch에서 OnlyOffice로 편집 가능한 파일:

**Word 문서 (텍스트 에디터):**
- `.docx` - Microsoft Word 2007+
- `.doc` - Microsoft Word 97-2003
- `.odt` - OpenDocument Text
- `.rtf` - Rich Text Format
- `.txt` - 일반 텍스트

**Excel 스프레드시트 (스프레드시트 에디터):**
- `.xlsx` - Microsoft Excel 2007+
- `.xls` - Microsoft Excel 97-2003
- `.ods` - OpenDocument Spreadsheet
- `.csv` - Comma-Separated Values

**PowerPoint 프레젠테이션 (프레젠테이션 에디터):**
- `.pptx` - Microsoft PowerPoint 2007+
- `.ppt` - Microsoft PowerPoint 97-2003
- `.odp` - OpenDocument Presentation

**기타:**
- `.pdf` - PDF 문서 (Word 모드로 열림, 제한된 편집)

### 5.2 문서 편집하기

1. FileHatch에서 편집할 파일 클릭
2. 파일 상세 패널에서 **OnlyOffice로 편집** 버튼 클릭
3. OnlyOffice 에디터가 새 창 또는 오버레이로 열림
4. 문서 편집
5. 변경사항은 **자동으로 저장**됨

### 5.3 자동 저장 동작

OnlyOffice는 다음 경우에 자동으로 저장합니다:

| 이벤트 | 설명 |
|--------|------|
| **주기적 저장** | 편집 중 주기적으로 저장 |
| **편집 완료** | 마지막 사용자가 에디터를 닫을 때 |
| **강제 저장** | 사용자가 Ctrl+S를 누를 때 |

### 5.4 편집 완료

- 에디터 우측 상단 **X** 버튼 클릭
- 또는 브라우저 탭 닫기
- 변경사항이 자동으로 저장됨

> 💡 **팁**: 편집 완료 후 FileHatch 파일 목록을 새로고침하면 수정 시간이 업데이트된 것을 확인할 수 있습니다.

---

## 6. 외부 접근 설정

### 6.1 로컬 네트워크에서 사용

같은 네트워크의 다른 컴퓨터에서 OnlyOffice를 사용하려면:

1. 서버 IP 확인:
   ```bash
   hostname -I
   # 예: 192.168.1.100
   ```

2. `.env` 파일 수정:
   ```bash
   ONLYOFFICE_PUBLIC_URL=http://192.168.1.100:8088
   ```

3. 서비스 재시작:
   ```bash
   docker compose down
   docker compose --profile office up -d
   ```

### 6.2 Nginx 리버스 프록시 설정

OnlyOffice를 Nginx 뒤에 배치하는 경우:

```nginx
# /etc/nginx/sites-available/onlyoffice
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name office.company.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 보안 헤더
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;

    # 최대 업로드 크기 (문서 크기에 맞게 조정)
    client_max_body_size 100m;

    location / {
        proxy_pass http://localhost:8088;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 지원 (필수!)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # 타임아웃 설정
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
```

**FileHatch 설정 업데이트:**
```bash
# .env
ONLYOFFICE_PUBLIC_URL=https://office.company.com
```

### 6.3 Traefik 설정

```yaml
# docker-compose.override.yml
services:
  onlyoffice:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.onlyoffice.rule=Host(`office.company.com`)"
      - "traefik.http.routers.onlyoffice.entrypoints=websecure"
      - "traefik.http.routers.onlyoffice.tls.certresolver=letsencrypt"
      - "traefik.http.services.onlyoffice.loadbalancer.server.port=80"
```

### 6.4 HTTPS 설정 시 주의사항

HTTPS를 사용할 때 혼합 콘텐츠(Mixed Content) 문제를 방지하려면:

1. FileHatch도 HTTPS로 접근
2. OnlyOffice도 HTTPS로 접근
3. API 서버의 콜백 URL도 HTTPS 사용

```bash
# 모든 URL이 HTTPS를 사용하도록 설정
ONLYOFFICE_PUBLIC_URL=https://office.company.com
```

---

## 7. 공유 링크에서 문서 편집

### 7.1 편집 가능한 공유 링크 생성

1. FileHatch에서 공유할 파일 선택
2. **공유** 버튼 클릭
3. **공유 유형**: 다운로드 링크 선택
4. **편집 허용** 옵션 활성화 (Office 문서만)
5. 필요시 비밀번호, 만료일 설정
6. **공유 링크 생성** 클릭

### 7.2 권한 설정

| 권한 | 설명 |
|------|------|
| **읽기 전용** | 문서 보기만 가능, 수정 불가 |
| **읽기/쓰기** | 문서 편집 가능, 변경사항 저장 |

### 7.3 외부 사용자의 문서 편집

외부 사용자(로그인하지 않은 사용자)가 공유 링크로 문서를 편집할 때:

1. 공유 링크 접속
2. 필요시 비밀번호 입력
3. **OnlyOffice로 열기** 버튼 클릭
4. 문서 편집
5. 저장 시 원본 파일에 반영

> ⚠️ **주의**: 편집 가능한 공유 링크는 누구나 문서를 수정할 수 있으므로 신중하게 사용하세요.

### 7.4 익명 사용자 식별

공유 링크로 편집 시, 사용자는 다음과 같이 식별됩니다:

- **로그인한 사용자**: 실제 사용자 이름
- **익명 사용자**: `Guest_abc123` (공유 토큰 기반)

---

## 8. 성능 최적화

### 8.1 리소스 할당

Docker Compose에서 리소스 제한을 설정할 수 있습니다:

```yaml
# docker-compose.override.yml
services:
  onlyoffice:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
```

### 8.2 동시 편집자 수

OnlyOffice의 동시 편집자 수는 시스템 리소스에 따라 결정됩니다:

| RAM | 권장 동시 편집자 |
|-----|----------------|
| 4GB | 5-10명 |
| 8GB | 20-30명 |
| 16GB | 50-100명 |

### 8.3 캐시 정리

OnlyOffice 캐시가 커지면 성능이 저하될 수 있습니다:

```bash
# OnlyOffice 캐시 확인
docker compose exec onlyoffice du -sh /var/lib/onlyoffice/

# 필요시 캐시 정리 (서비스 중지 필요)
docker compose stop onlyoffice
docker compose rm onlyoffice
docker volume rm filehatch_onlyoffice_data
docker compose --profile office up -d
```

### 8.4 로그 레벨 조정

디버깅이 필요한 경우 로그 레벨을 조정할 수 있습니다:

```yaml
# docker-compose.override.yml
services:
  onlyoffice:
    environment:
      - LOG_LEVEL=DEBUG  # ERROR, WARN, INFO, DEBUG
```

---

## 9. 문제 해결

### 9.1 문서가 열리지 않음

**증상:** "OnlyOffice로 편집" 버튼 클릭 후 에디터가 로드되지 않음

**확인 사항:**

1. OnlyOffice 컨테이너 상태 확인:
   ```bash
   docker compose ps onlyoffice
   docker compose logs onlyoffice | tail -50
   ```

2. 헬스체크 확인:
   ```bash
   curl http://localhost:8088/healthcheck
   # "true" 응답이어야 함
   ```

3. FileHatch에서 OnlyOffice 상태 확인:
   ```bash
   curl http://localhost:3080/api/onlyoffice/settings
   # "available": true 여야 함
   ```

### 9.2 "Cannot connect to document server" 오류

**원인:** 브라우저가 OnlyOffice 서버에 접근할 수 없음

**해결 방법:**

1. 공개 URL 설정 확인:
   ```bash
   # .env
   ONLYOFFICE_PUBLIC_URL=http://서버IP:8088
   ```

2. 방화벽에서 포트 8088 개방 확인

3. 브라우저에서 직접 접근 테스트:
   ```
   http://서버IP:8088/web-apps/apps/api/documents/api.js
   ```

### 9.3 저장 실패

**증상:** 문서 편집 후 저장되지 않음

**확인 사항:**

1. API 서버 로그 확인:
   ```bash
   docker compose logs -f api | grep -i onlyoffice
   ```

2. 콜백 URL 접근 가능 여부:
   - OnlyOffice → API 서버 통신 확인
   - Docker 네트워크 내 `http://api:8080` 접근 가능해야 함

3. 파일 권한 확인:
   - 사용자가 해당 파일에 쓰기 권한이 있는지 확인

### 9.4 브라우저 콘솔 오류 확인

브라우저 개발자 도구(F12)에서 Console 탭 확인:

**일반적인 오류:**

| 오류 | 원인 | 해결 |
|------|------|------|
| `Mixed Content` | HTTPS/HTTP 혼합 사용 | 모든 URL을 동일한 프로토콜로 통일 |
| `CORS error` | 크로스 오리진 차단 | CORS 설정 확인 |
| `404 api.js` | OnlyOffice 접근 불가 | 공개 URL 설정 확인 |

### 9.5 로그 확인 방법

```bash
# OnlyOffice 전체 로그
docker compose logs onlyoffice

# 최근 로그만
docker compose logs --tail=100 onlyoffice

# 실시간 로그
docker compose logs -f onlyoffice

# FileHatch API 로그 (OnlyOffice 관련)
docker compose logs -f api | grep -iE "(onlyoffice|document|callback)"
```

### 9.6 OnlyOffice 재시작

문제 해결 후 재시작:

```bash
docker compose restart onlyoffice

# 완전 재시작 (상태 초기화)
docker compose stop onlyoffice
docker compose rm -f onlyoffice
docker compose --profile office up -d onlyoffice
```

---

## 10. 프로덕션 권장 사항

### 10.1 버전 고정

`latest` 태그 대신 특정 버전을 사용하세요:

```yaml
# docker-compose.yml
services:
  onlyoffice:
    image: onlyoffice/documentserver:8.2  # 버전 고정
```

> 💡 FileHatch는 기본적으로 `8.2` 버전으로 고정되어 있습니다.

### 10.2 JWT 보안 활성화

프로덕션에서는 OnlyOffice JWT를 활성화하는 것이 권장됩니다:

```yaml
# docker-compose.override.yml
services:
  onlyoffice:
    environment:
      - JWT_ENABLED=true
      - JWT_SECRET=매우_긴_랜덤_문자열
      - JWT_HEADER=Authorization
```

> ⚠️ JWT 활성화 시 FileHatch 코드 수정이 필요할 수 있습니다. 기본 설정에서는 JWT가 비활성화되어 있으며, FileHatch API 레벨에서 인증을 처리합니다.

### 10.3 HTTPS 필수

프로덕션 환경에서는 반드시 HTTPS를 사용하세요:

```bash
# .env
ONLYOFFICE_PUBLIC_URL=https://office.company.com
```

### 10.4 리소스 모니터링

OnlyOffice 리소스 사용량을 모니터링하세요:

```bash
# 실시간 리소스 사용량
docker stats fh-onlyoffice

# 디스크 사용량
docker compose exec onlyoffice df -h
```

### 10.5 백업 전략

OnlyOffice 자체는 문서를 저장하지 않으므로 별도의 OnlyOffice 백업은 필요 없습니다. FileHatch 데이터 볼륨만 백업하면 됩니다:

```bash
# FileHatch 데이터 백업
tar czf backup-$(date +%Y%m%d).tar.gz ./data
```

### 10.6 업그레이드 절차

OnlyOffice 버전 업그레이드:

```bash
# 1. 현재 버전 확인
docker compose exec onlyoffice cat /var/log/onlyoffice/documentserver/docservice/out.log | head -5

# 2. 서비스 중지
docker compose stop onlyoffice

# 3. 이미지 버전 변경 (docker-compose.yml)
# image: onlyoffice/documentserver:8.2 → 8.3

# 4. 새 이미지 다운로드 및 시작
docker compose pull onlyoffice
docker compose --profile office up -d onlyoffice

# 5. 헬스체크 확인
curl http://localhost:8088/healthcheck
```

### 10.7 보안 체크리스트

```
[ ] HTTPS 적용 완료
[ ] 버전 고정 (latest 미사용)
[ ] 적절한 리소스 제한 설정
[ ] 방화벽에서 필요한 포트만 개방
[ ] 정기적인 버전 업데이트 계획
[ ] 리소스 모니터링 설정
```

---

## 환경 변수 전체 목록

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `ONLYOFFICE_PORT` | 8088 | OnlyOffice 외부 접속 포트 |
| `ONLYOFFICE_INTERNAL_URL` | http://onlyoffice | Docker 내부 URL (API 서버용) |
| `ONLYOFFICE_PUBLIC_URL` | (비어있음) | 브라우저 접근 URL |

**OnlyOffice 컨테이너 환경변수 (docker-compose.yml):**

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `JWT_ENABLED` | false | JWT 인증 활성화 |
| `ALLOW_PRIVATE_IP_ADDRESS` | true | 내부 IP 접근 허용 |
| `ALLOW_META_IP_ADDRESS` | true | 메타 IP 접근 허용 |
| `USE_UNAUTHORIZED_STORAGE` | true | 인증 없는 스토리지 접근 허용 |

---

## 관련 문서

- [메인 README](../README.md)
- [SSO 설정 가이드](./SSO_SETUP.md)
- [OnlyOffice 공식 문서](https://helpcenter.onlyoffice.com/server/docker/document/docker-installation.aspx)
- [OnlyOffice API 문서](https://api.onlyoffice.com/)
