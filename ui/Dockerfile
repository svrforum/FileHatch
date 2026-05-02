# rhwp-studio mirror stage — GitHub Pages 정적 자산 mirror
# (외부 CDN 임베드 시 PNA + WASM init race 문제 회피용으로 self-host)
FROM alpine:latest AS rhwp-mirror
RUN apk add --no-cache wget
WORKDIR /rhwp-mirror
RUN mkdir -p /out/rhwp && \
    wget --recursive --no-parent --no-host-directories \
         --cut-dirs=1 --execute robots=off \
         --directory-prefix=/out/rhwp \
         --reject "index.html?*,*.html?*" \
         --no-check-certificate \
         https://edwardkim.github.io/rhwp/ || true
# 결과: /out/rhwp/index.html, /out/rhwp/assets/..., /out/rhwp/manifest.webmanifest
RUN ls -la /out/rhwp/ | head -20

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
