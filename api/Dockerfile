# Build stage
FROM golang:1.23-alpine AS builder

WORKDIR /build

# Install dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum* ./

# Copy source code first for go mod tidy
COPY . .

# Download dependencies
RUN go mod tidy && go mod download

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main .

# Runtime stage
FROM alpine:3.20

WORKDIR /app

# Install ca-certificates for HTTPS, docker-cli for system logs,
# ffmpeg for video thumbnails, and libwebp-tools for WebP conversion
RUN apk --no-cache add ca-certificates tzdata docker-cli ffmpeg libwebp-tools

# Copy binary from builder
COPY --from=builder /build/main .

# Create data directory
RUN mkdir -p /data /etc/scv

EXPOSE 8080

CMD ["./main"]
