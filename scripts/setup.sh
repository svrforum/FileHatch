#!/bin/bash
# =============================================================================
# SimpleCloudVault Initial Setup Script
# =============================================================================
# 이 스크립트는 SimpleCloudVault를 처음 설치할 때 실행합니다.
#
# 기능:
#   - 환경 설정 파일 생성 (.env)
#   - 필요한 디렉토리 생성
#   - 보안 키 자동 생성 (JWT, 암호화 키)
#   - Docker 이미지 빌드
#   - 서비스 시작
# =============================================================================

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 스크립트 디렉토리
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          SimpleCloudVault 초기 설정 스크립트                      ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# =============================================================================
# 1. 요구 사항 확인
# =============================================================================
echo -e "${BLUE}[1/6] 요구 사항 확인 중...${NC}"

# Docker 확인
if ! command -v docker &> /dev/null; then
    echo -e "${RED}오류: Docker가 설치되어 있지 않습니다.${NC}"
    echo "Docker 설치: https://docs.docker.com/get-docker/"
    exit 1
fi

# Docker Compose 확인
if ! docker compose version &> /dev/null; then
    echo -e "${RED}오류: Docker Compose가 설치되어 있지 않습니다.${NC}"
    echo "Docker Compose v2 이상이 필요합니다."
    exit 1
fi

# Docker 데몬 실행 확인
if ! docker info &> /dev/null; then
    echo -e "${RED}오류: Docker 데몬이 실행 중이 아닙니다.${NC}"
    exit 1
fi

echo -e "  ${GREEN}✓ Docker: $(docker --version)${NC}"
echo -e "  ${GREEN}✓ Docker Compose: $(docker compose version --short)${NC}"
echo ""

# =============================================================================
# 2. 환경 설정 파일 생성
# =============================================================================
echo -e "${BLUE}[2/6] 환경 설정 파일 생성 중...${NC}"

if [ -f ".env" ]; then
    echo -e "  ${YELLOW}⚠ .env 파일이 이미 존재합니다. 덮어쓰시겠습니까? (y/N)${NC}"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo -e "  ${BLUE}기존 .env 파일을 유지합니다.${NC}"
        CREATE_ENV=false
    else
        CREATE_ENV=true
        # 백업
        cp .env ".env.backup.$(date +%Y%m%d%H%M%S)"
        echo -e "  ${BLUE}기존 파일이 .env.backup.* 으로 백업되었습니다.${NC}"
    fi
else
    CREATE_ENV=true
fi

if [ "$CREATE_ENV" = true ]; then
    # 보안 키 생성
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p | tr -d '\n' | head -c 64)
    ENCRYPTION_KEY=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p | tr -d '\n' | head -c 64)
    DB_PASS=$(openssl rand -base64 24 2>/dev/null | tr -d '/+=' | head -c 24 || head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)

    # .env.example을 기반으로 .env 생성
    if [ -f ".env.example" ]; then
        cp .env.example .env

        # 보안 키 설정
        sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
        sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$ENCRYPTION_KEY/" .env
        sed -i "s/^DB_PASS=.*/DB_PASS=$DB_PASS/" .env

        echo -e "  ${GREEN}✓ .env 파일이 생성되었습니다.${NC}"
        echo -e "  ${GREEN}✓ JWT_SECRET이 자동 생성되었습니다.${NC}"
        echo -e "  ${GREEN}✓ ENCRYPTION_KEY가 자동 생성되었습니다.${NC}"
        echo -e "  ${GREEN}✓ DB_PASS가 자동 생성되었습니다.${NC}"
    else
        echo -e "${RED}오류: .env.example 파일을 찾을 수 없습니다.${NC}"
        exit 1
    fi
fi
echo ""

# =============================================================================
# 3. 디렉토리 생성
# =============================================================================
echo -e "${BLUE}[3/6] 필요한 디렉토리 생성 중...${NC}"

directories=("data" "data/users" "data/shared" "data/.cache" "config" "database")

for dir in "${directories[@]}"; do
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        echo -e "  ${GREEN}✓ $dir 생성됨${NC}"
    else
        echo -e "  ${BLUE}○ $dir 이미 존재${NC}"
    fi
done

# 권한 설정
chmod -R 755 data config 2>/dev/null || true
echo ""

# =============================================================================
# 4. SMB 설정 파일 확인
# =============================================================================
echo -e "${BLUE}[4/6] SMB 설정 확인 중...${NC}"

if [ ! -f "config/smb.conf" ]; then
    # 기본 smb.conf 생성
    cat > config/smb.conf << 'EOF'
[global]
    workgroup = WORKGROUP
    server string = SimpleCloudVault
    security = user
    map to guest = Bad User
    load printers = no
    printing = bsd
    printcap name = /dev/null
    disable spoolss = yes
    log file = /var/log/samba/log.%m
    max log size = 50
    passdb backend = smbpasswd:/etc/scv/smb_users.txt

[home]
    path = /data/users
    valid users = @users
    read only = no
    create mask = 0644
    directory mask = 0755
    browseable = yes
    comment = User Home Directories
EOF
    chmod 600 config/smb.conf
    echo -e "  ${GREEN}✓ config/smb.conf 생성됨${NC}"
else
    echo -e "  ${BLUE}○ config/smb.conf 이미 존재${NC}"
fi
echo ""

# =============================================================================
# 5. Docker 이미지 빌드
# =============================================================================
echo -e "${BLUE}[5/6] Docker 이미지 빌드 중... (시간이 다소 소요될 수 있습니다)${NC}"
echo ""

docker compose build

echo ""
echo -e "  ${GREEN}✓ Docker 이미지 빌드 완료${NC}"
echo ""

# =============================================================================
# 6. 서비스 시작
# =============================================================================
echo -e "${BLUE}[6/6] 서비스 시작 중...${NC}"

docker compose up -d

# 서비스 상태 확인
echo ""
echo -e "${BLUE}서비스 상태 확인 중...${NC}"
sleep 5

docker compose ps

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                    설정 완료!                                    ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}SimpleCloudVault가 성공적으로 시작되었습니다!${NC}"
echo ""
echo -e "${YELLOW}접속 정보:${NC}"
echo -e "  웹 UI:    ${BLUE}http://localhost:3080${NC}"
echo -e "  SMB:      ${BLUE}\\\\\\localhost\\home${NC} (Windows)"
echo -e "            ${BLUE}smb://localhost/home${NC} (Mac/Linux)"
echo ""
echo -e "${YELLOW}기본 계정:${NC}"
echo -e "  사용자명: ${BLUE}admin${NC}"
echo -e "  비밀번호: ${BLUE}admin1234${NC}"
echo ""
echo -e "${RED}⚠ 보안 주의: 프로덕션 환경에서는 반드시 admin 비밀번호를 변경하세요!${NC}"
echo ""
echo -e "${YELLOW}유용한 명령어:${NC}"
echo -e "  로그 확인:        ${BLUE}docker compose logs -f${NC}"
echo -e "  서비스 중지:      ${BLUE}docker compose down${NC}"
echo -e "  서비스 재시작:    ${BLUE}docker compose restart${NC}"
echo -e "  마이그레이션:     ${BLUE}./scripts/migrate.sh${NC}"
echo -e "  백업:            ${BLUE}./scripts/backup.sh${NC}"
echo ""
echo -e "${YELLOW}OnlyOffice 문서 편집기를 사용하려면:${NC}"
echo -e "  ${BLUE}docker compose --profile office up -d${NC}"
echo ""
