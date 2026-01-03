#!/bin/bash
# =============================================================================
# SimpleCloudVault Backup Script
# =============================================================================
# 사용법:
#   ./scripts/backup.sh              # 전체 백업 (DB + 파일)
#   ./scripts/backup.sh db           # 데이터베이스만 백업
#   ./scripts/backup.sh files        # 파일만 백업
#   ./scripts/backup.sh config       # 설정만 백업
#
# 옵션:
#   -o, --output DIR    백업 저장 경로 (기본: ./backups)
#   -n, --name NAME     백업 파일 이름 접두사 (기본: scv_backup)
#   -k, --keep N        보관할 백업 개수 (기본: 10)
# =============================================================================

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 스크립트 디렉토리
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# 기본값
BACKUP_DIR="$PROJECT_DIR/backups"
BACKUP_PREFIX="scv_backup"
KEEP_COUNT=10
BACKUP_TYPE="all"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 환경 변수 로드
if [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env"
fi

# 기본값 설정
DB_USER="${DB_USER:-scv_user}"
DB_NAME="${DB_NAME:-scv_main}"

# 옵션 파싱
while [[ $# -gt 0 ]]; do
    case $1 in
        -o|--output)
            BACKUP_DIR="$2"
            shift 2
            ;;
        -n|--name)
            BACKUP_PREFIX="$2"
            shift 2
            ;;
        -k|--keep)
            KEEP_COUNT="$2"
            shift 2
            ;;
        db|files|config|all)
            BACKUP_TYPE="$1"
            shift
            ;;
        -h|--help)
            echo "사용법: $0 [db|files|config|all] [옵션]"
            echo ""
            echo "백업 유형:"
            echo "  all      전체 백업 (기본값)"
            echo "  db       데이터베이스만"
            echo "  files    파일만"
            echo "  config   설정만"
            echo ""
            echo "옵션:"
            echo "  -o, --output DIR    백업 저장 경로 (기본: ./backups)"
            echo "  -n, --name NAME     백업 파일 이름 접두사"
            echo "  -k, --keep N        보관할 백업 개수 (기본: 10)"
            exit 0
            ;;
        *)
            echo -e "${RED}알 수 없는 옵션: $1${NC}"
            exit 1
            ;;
    esac
done

# 백업 디렉토리 생성
mkdir -p "$BACKUP_DIR"

echo ""
echo -e "${BLUE}=== SimpleCloudVault 백업 ===${NC}"
echo -e "시간: ${YELLOW}$(date)${NC}"
echo -e "유형: ${YELLOW}$BACKUP_TYPE${NC}"
echo -e "저장 경로: ${YELLOW}$BACKUP_DIR${NC}"
echo ""

# 데이터베이스 백업
backup_database() {
    echo -e "${BLUE}[DB] 데이터베이스 백업 중...${NC}"

    local db_backup="$BACKUP_DIR/${BACKUP_PREFIX}_db_${TIMESTAMP}.sql.gz"

    if docker ps --format '{{.Names}}' | grep -q "scv-db"; then
        docker exec scv-db pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl | gzip > "$db_backup"

        if [ -f "$db_backup" ]; then
            local size=$(du -h "$db_backup" | cut -f1)
            echo -e "  ${GREEN}✓ 데이터베이스 백업 완료: $(basename $db_backup) ($size)${NC}"
        fi
    else
        echo -e "  ${RED}✗ scv-db 컨테이너가 실행 중이 아닙니다.${NC}"
        return 1
    fi
}

# 파일 백업
backup_files() {
    echo -e "${BLUE}[FILES] 파일 백업 중...${NC}"

    local data_path="${DATA_PATH:-./data}"
    local files_backup="$BACKUP_DIR/${BACKUP_PREFIX}_files_${TIMESTAMP}.tar.gz"

    if [ -d "$data_path" ]; then
        # .cache 제외하고 백업
        tar -czf "$files_backup" \
            --exclude="$data_path/.cache" \
            --exclude="$data_path/.thumbnails" \
            -C "$(dirname $data_path)" "$(basename $data_path)"

        if [ -f "$files_backup" ]; then
            local size=$(du -h "$files_backup" | cut -f1)
            echo -e "  ${GREEN}✓ 파일 백업 완료: $(basename $files_backup) ($size)${NC}"
        fi
    else
        echo -e "  ${YELLOW}⚠ 데이터 디렉토리가 없습니다: $data_path${NC}"
    fi
}

# 설정 백업
backup_config() {
    echo -e "${BLUE}[CONFIG] 설정 백업 중...${NC}"

    local config_path="${CONFIG_PATH:-./config}"
    local config_backup="$BACKUP_DIR/${BACKUP_PREFIX}_config_${TIMESTAMP}.tar.gz"

    if [ -d "$config_path" ]; then
        tar -czf "$config_backup" \
            -C "$(dirname $config_path)" "$(basename $config_path)"

        if [ -f "$config_backup" ]; then
            local size=$(du -h "$config_backup" | cut -f1)
            echo -e "  ${GREEN}✓ 설정 백업 완료: $(basename $config_backup) ($size)${NC}"
        fi
    fi

    # .env 파일도 별도 백업
    if [ -f ".env" ]; then
        local env_backup="$BACKUP_DIR/${BACKUP_PREFIX}_env_${TIMESTAMP}"
        cp .env "$env_backup"
        echo -e "  ${GREEN}✓ 환경 설정 백업 완료: $(basename $env_backup)${NC}"
    fi
}

# 오래된 백업 정리
cleanup_old_backups() {
    echo ""
    echo -e "${BLUE}오래된 백업 정리 중...${NC}"

    local cleaned=0
    for pattern in "db" "files" "config" "env"; do
        local files=$(ls -t "$BACKUP_DIR"/${BACKUP_PREFIX}_${pattern}_* 2>/dev/null || true)
        local count=0

        for file in $files; do
            ((count++))
            if [ $count -gt $KEEP_COUNT ]; then
                rm -f "$file"
                echo -e "  ${YELLOW}삭제됨: $(basename $file)${NC}"
                ((cleaned++))
            fi
        done
    done

    if [ $cleaned -eq 0 ]; then
        echo -e "  ${BLUE}정리할 백업이 없습니다.${NC}"
    else
        echo -e "  ${GREEN}$cleaned 개의 오래된 백업이 삭제되었습니다.${NC}"
    fi
}

# 메인 로직
case "$BACKUP_TYPE" in
    db)
        backup_database
        ;;
    files)
        backup_files
        ;;
    config)
        backup_config
        ;;
    all)
        backup_database
        backup_files
        backup_config
        ;;
esac

cleanup_old_backups

echo ""
echo -e "${GREEN}=== 백업 완료 ===${NC}"
echo ""

# 백업 목록 표시
echo -e "${BLUE}현재 백업 목록:${NC}"
ls -lh "$BACKUP_DIR"/${BACKUP_PREFIX}_* 2>/dev/null | tail -10 || echo "  (백업 없음)"
echo ""
