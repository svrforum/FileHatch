# FileHatch 리버스 프록시 설정 가이드

이 문서는 Nginx를 사용하여 FileHatch를 리버스 프록시 뒤에서 운영하는 방법을 설명합니다.

## 1. FileHatch 환경변수 설정

리버스 프록시를 사용할 때는 다음 환경변수를 반드시 설정해야 합니다.

`.env` 파일을 편집하세요:

```bash
# HTTPS 사용 시 (권장)
EXTERNAL_URL=https://file.example.com
CORS_ALLOWED_ORIGINS=https://file.example.com
ALLOWED_ORIGINS=https://file.example.com

# HTTP만 사용 시 (권장하지 않음)
EXTERNAL_URL=http://file.example.com
CORS_ALLOWED_ORIGINS=http://file.example.com
ALLOWED_ORIGINS=http://file.example.com
```

### 환경변수 설명

| 변수 | 설명 |
|------|------|
| `EXTERNAL_URL` | SSO 콜백, 공유 링크 등 외부 URL 생성에 사용 |
| `CORS_ALLOWED_ORIGINS` | API CORS 정책에서 허용할 오리진 (`*` = 모두 허용) |
| `ALLOWED_ORIGINS` | WebSocket 연결 허용 오리진 (쉼표로 구분) |

> **주의**: `ALLOWED_ORIGINS`가 설정되지 않으면 WebSocket 연결이 거부될 수 있습니다.

## 2. Nginx 설정

### HTTP 전용 설정

```nginx
server {
    listen 80;
    server_name file.example.com;

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
    server_name file.example.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS 서버
server {
    listen 443 ssl http2;
    server_name file.example.com;

    # SSL 인증서 설정
    ssl_certificate /etc/nginx/ssl/file.example.com.crt;
    ssl_certificate_key /etc/nginx/ssl/file.example.com.key;

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

## 3. 컨테이너 재시작

환경변수 변경 후 컨테이너를 재시작하세요:

```bash
docker compose down && docker compose up -d
```

## 4. 설정 확인

### 환경변수 확인

```bash
docker compose exec api env | grep -E "(CORS|ALLOWED|EXTERNAL)"
```

예상 출력:
```
CORS_ALLOWED_ORIGINS=https://file.example.com
ALLOWED_ORIGINS=https://file.example.com
EXTERNAL_URL=https://file.example.com
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

## OnlyOffice와 함께 사용

OnlyOffice를 사용하는 경우, OnlyOffice도 리버스 프록시 설정이 필요합니다.
자세한 내용은 [ONLYOFFICE_SETUP.md](./ONLYOFFICE_SETUP.md)를 참조하세요.
