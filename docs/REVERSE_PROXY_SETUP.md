# FileHatch 리버스 프록시 설정 가이드

이 문서는 Nginx를 사용하여 FileHatch를 리버스 프록시 뒤에서 운영하는 방법을 설명합니다.

## 1. FileHatch 환경변수 설정

리버스 프록시를 사용할 때는 다음 환경변수를 반드시 설정해야 합니다.

`.env` 파일을 편집하세요:

```bash
# HTTPS 사용 시 (권장)
EXTERNAL_URL=https://files.your-domain.com
CORS_ALLOWED_ORIGINS=https://files.your-domain.com
ALLOWED_ORIGINS=https://files.your-domain.com

# HTTP만 사용 시 (권장하지 않음)
EXTERNAL_URL=http://files.your-domain.com
CORS_ALLOWED_ORIGINS=http://files.your-domain.com
ALLOWED_ORIGINS=http://files.your-domain.com
```

### 환경변수 설명

| 변수 | 설명 |
|------|------|
| `EXTERNAL_URL` | SSO 콜백, 파일 업로드 URL 등 외부 URL 생성에 사용 (Mixed Content 에러 방지) |
| `CORS_ALLOWED_ORIGINS` | API CORS 정책에서 허용할 오리진 (`*` = 모두 허용) |
| `ALLOWED_ORIGINS` | WebSocket 연결 허용 오리진 (쉼표로 구분) |

> **주의**: `ALLOWED_ORIGINS`가 설정되지 않으면 WebSocket 연결이 거부될 수 있습니다.

## 2. Nginx 설정

### HTTP 전용 설정

```nginx
server {
    listen 80;
    server_name files.your-domain.com;

    location / {
        proxy_pass http://192.168.1.100:3080;

        # 필수 헤더
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;

        # WebSocket 지원 (필수)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 타임아웃 설정 (대용량 파일 업로드용)
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        client_max_body_size 10G;
    }
}
```

### HTTPS 설정 (권장)

```nginx
# HTTP -> HTTPS 리다이렉트
server {
    listen 80;
    server_name files.your-domain.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS 서버
server {
    listen 443 ssl http2;
    server_name files.your-domain.com;

    # SSL 인증서 설정
    ssl_certificate /etc/nginx/ssl/files.your-domain.com.crt;
    ssl_certificate_key /etc/nginx/ssl/files.your-domain.com.key;

    # SSL 보안 설정
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    location / {
        proxy_pass http://192.168.1.100:3080;

        # 필수 헤더
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;

        # WebSocket 지원 (필수)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 타임아웃 설정 (대용량 파일 업로드용)
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        client_max_body_size 10G;
    }
}
```

## 3. Nginx Proxy Manager (NPM) 설정

NPM을 사용하는 경우 다음과 같이 설정합니다.

### 기본 설정

1. **Proxy Hosts** → **Add Proxy Host**
2. **Details** 탭:
   - Domain Names: `files.your-domain.com`
   - Scheme: `http`
   - Forward Hostname / IP: `192.168.1.100` (FileHatch 서버 IP)
   - Forward Port: `3080`
   - ☑️ Websockets Support (반드시 체크!)

3. **SSL** 탭 (HTTPS 사용 시):
   - ☑️ Force SSL
   - SSL Certificate 선택 또는 새로 발급

### Custom Nginx Configuration (중요!)

NPM은 기본적으로 `X-Forwarded-Proto` 헤더를 전달하지 않을 수 있습니다.

**Proxy Host** → **Advanced** 탭에 다음 내용을 추가:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
```

### 또는 EXTERNAL_URL 사용 (권장)

NPM에서 헤더 설정이 어려운 경우, `.env` 파일에 `EXTERNAL_URL`을 설정하면 됩니다:

```bash
EXTERNAL_URL=https://files.your-domain.com
```

이 설정은 리버스 프록시 헤더보다 우선 적용됩니다.

## 4. 컨테이너 재시작

환경변수 변경 후 컨테이너를 재시작하세요:

```bash
docker compose down && docker compose up -d
```

## 5. 설정 확인

### 환경변수 확인

```bash
docker compose exec api env | grep -E "(CORS|ALLOWED|EXTERNAL)"
```

예상 출력:
```
CORS_ALLOWED_ORIGINS=https://files.your-domain.com
ALLOWED_ORIGINS=https://files.your-domain.com
EXTERNAL_URL=https://files.your-domain.com
```

### 연결 테스트

1. 브라우저에서 도메인 접속
2. F12 → 콘솔에서 CORS 에러 확인
3. F12 → 네트워크 탭에서 WebSocket 연결 상태 확인 (`/api/ws` 엔드포인트)

## 문제 해결

### CORS 에러 발생

- `CORS_ALLOWED_ORIGINS`에 정확한 프로토콜과 도메인이 설정되어 있는지 확인
- HTTPS 사용 시 `https://`로 시작해야 함

### WebSocket 연결 실패

- `ALLOWED_ORIGINS`이 설정되어 있는지 확인
- Nginx에서 WebSocket 헤더가 전달되는지 확인:
  ```nginx
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  ```

### 로그인 후 리다이렉트 문제

- `EXTERNAL_URL`이 올바르게 설정되어 있는지 확인
- 또는 Nginx에서 `X-Forwarded-Proto`와 `X-Forwarded-Host` 헤더가 전달되는지 확인

### Mixed Content 에러 (파일 업로드 실패)

HTTPS 페이지에서 HTTP API 호출 시 발생합니다:
```
Mixed Content: The page was loaded over HTTPS, but requested an insecure XMLHttpRequest endpoint 'http://...'
```

**해결 방법:**
1. `.env`에 `EXTERNAL_URL=https://your-domain.com` 설정 (권장)
2. 또는 리버스 프록시에서 `X-Forwarded-Proto: https` 헤더 전달

## OnlyOffice와 함께 사용

OnlyOffice를 사용하는 경우, OnlyOffice도 리버스 프록시 설정이 필요합니다.
자세한 내용은 [ONLYOFFICE_SETUP.md](./ONLYOFFICE_SETUP.md)를 참조하세요.
