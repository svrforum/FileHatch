# rhwp-studio mirror stage — GitHub Pages 정적 자산 mirror
# v0.15.0: race fix 후 기본 활성화. mirror 실패 시 빌드도 실패시킴.
FROM alpine:latest AS rhwp-mirror
RUN apk add --no-cache wget grep
WORKDIR /rhwp-mirror
RUN mkdir -p /out/rhwp && \
    wget --quiet --recursive --no-parent \
         --reject "*.html?*,*.html?" \
         --directory-prefix=/out/rhwp \
         --no-host-directories \
         --cut-dirs=1 \
         https://edwardkim.github.io/rhwp/
# 동적 로드 자산 추가 다운로드 — wget --recursive 는 JS 안의 import/fetch 를 따라가지
# 못함. 빌드된 JS 를 grep 해서 *.wasm 과 *.woff2 참조 추출 후 명시적으로 fetch.
# wasm 은 /rhwp/assets/, fonts 는 /rhwp/fonts/ 경로로 호스팅됨.
#
# 정규식 메모:
# - wasm: `name-{hash}.wasm` 패턴만 매칭 (Vite/wasm-bindgen 출력 규약). 이는
#   minified JS 의 변수명이 우연히 `e.wasm`, `t.wasm` 등으로 매칭되는 false positive
#   를 제외한다. 실제 자산 (예: `rhwp_bg-BbAYsuOY.wasm`) 은 hyphen-hash 형식.
# - woff2: 폰트 파일은 모두 `Family-Variant.woff2` 형식이라 hyphen 포함.
# 404 응답은 무시 (false positive 가능) — 단, 마지막에 `rhwp_bg-*.wasm` 한 개 이상
# 있는지 확인하여 핵심 자산 누락 시 빌드 실패시킨다.
RUN cd /out/rhwp && \
    cat assets/*.js 2>/dev/null | \
      grep -oE '[A-Za-z0-9_]+-[A-Za-z0-9_-]+\.wasm' | sort -u > /tmp/wasm.list && \
    cat assets/*.js 2>/dev/null | \
      grep -oE '[A-Za-z0-9_]+-[A-Za-z0-9_-]+\.woff2' | sort -u > /tmp/woff2.list && \
    echo "=== wasm candidates ===" && cat /tmp/wasm.list && \
    echo "=== woff2 candidates ===" && cat /tmp/woff2.list && \
    echo "=== fetching wasm ===" && \
    while read -r f; do \
      [ -z "$f" ] && continue; \
      out="/out/rhwp/assets/$f"; \
      [ -f "$out" ] && continue; \
      url="https://edwardkim.github.io/rhwp/assets/$f"; \
      if wget --quiet -O "$out" "$url"; then \
        echo "OK: $f ($(wc -c < "$out") bytes)"; \
      else \
        echo "SKIP 404/err: $url"; rm -f "$out"; \
      fi; \
    done < /tmp/wasm.list && \
    echo "=== fetching woff2 ===" && \
    mkdir -p /out/rhwp/fonts && \
    while read -r f; do \
      [ -z "$f" ] && continue; \
      out="/out/rhwp/fonts/$f"; \
      [ -f "$out" ] && continue; \
      url="https://edwardkim.github.io/rhwp/fonts/$f"; \
      if wget --quiet -O "$out" "$url"; then \
        echo "OK: $f ($(wc -c < "$out") bytes)"; \
      else \
        echo "SKIP 404/err: $url"; rm -f "$out"; \
      fi; \
    done < /tmp/woff2.list
# 검증: 핵심 자산이 mirror 되었는지 확인 — 누락 시 빌드 실패
RUN test -f /out/rhwp/index.html
RUN test -d /out/rhwp/assets
RUN ls /out/rhwp/assets/*.js > /dev/null
RUN ls /out/rhwp/assets/*.css > /dev/null
RUN ls /out/rhwp/assets/rhwp_bg-*.wasm > /dev/null
RUN ls /out/rhwp/fonts/*.woff2 > /dev/null
RUN ls -la /out/rhwp/ /out/rhwp/assets/ /out/rhwp/fonts/ | head -50

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy source code
COPY . .

# Build
RUN npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy built files
COPY --from=builder /app/dist ./dist

# Copy mirrored rhwp-studio (served at /rhwp/* by server.cjs)
COPY --from=rhwp-mirror /out/rhwp ./rhwp-studio

# Copy server
COPY server.cjs ./

EXPOSE 3000

CMD ["node", "server.cjs"]
