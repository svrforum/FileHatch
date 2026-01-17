#!/bin/bash
# =============================================================================
# FileHatch Restore Script
# =============================================================================
# 사용법:
#   ./scripts/restore.sh                     # 대화형 복원
#   ./scripts/restore.sh db BACKUP_FILE      # 데이터베이스 복원
#   ./scripts/restore.sh files BACKUP_FILE   # 파일 복원
#   ./scripts/restore.sh config BACKUP_FILE  # 설정 복원
#
# 주의: 복원 전 현재 데이터는 덮어씌워집니다!
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

# 환경 변수 로드
if [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env"
fi

# 기본값 설정
DB_USER="${DB_USER:-fh_user}"
DB_NAME="${DB_NAME:-fh_main}"
BACKUP_DIR="$PROJECT_DIR/backups"

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              FileHatch 복원 스크립트                       ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# 사용 가능한 백업 목록 표시
list_backups() {
    local type="$1"
    echo -e "${BLUE}사용 가능한 백업 목록 ($type):${NC}"
    echo ""

    local pattern=""
    case "$type" in
        db) pattern="*_db_*.sql.gz" ;;
        files) pattern="*_files_*.tar.gz" ;;
        config) pattern="*_config_*.tar.gz" ;;
        *) pattern="*" ;;
    esac

    local backups=$(ls -t "$BACKUP_DIR"/$pattern 2>/dev/null || true)

    if [ -z "$backups" ]; then
        echo -e "  ${YELLOW}백업 파일이 없습니다.${NC}"
        return 1
    fi

    local i=1
    for file in $backups; do
        local size=$(du -h "$file" | cut -f1)
        local date=$(stat -c %y "$file" 2>/dev/null | cut -d'.' -f1 || stat -f %Sm "$file" 2>/dev/null || echo "unknown")
        echo -e "  ${GREEN}[$i]${NC} $(basename $file)"
        echo -e "      크기: $size, 생성: $date"
        ((i++))
    done
    echo ""

    return 0
}

# 데이터베이스 복원
restore_database() {
    local backup_file="$1"

    if [ ! -f "$backup_file" ]; then
        echo -e "${RED}오류: 백업 파일을 찾을 수 없습니다: $backup_file${NC}"
        exit 1
    fi

    echo -e "${YELLOW}⚠ 경고: 이 작업은 현재 데이터베이스를 덮어씌웁니다!${NC}"
    echo -e "복원할 파일: ${BLUE}$(basename $backup_file)${NC}"
    echo -n "계속하시겠습니까? (yes를 입력): "
    read -r confirm

    if [ "$confirm" != "yes" ]; then
        echo -e "${YELLOW}복원이 취소되었습니다.${NC}"
        exit 0
    fi

    echo ""
    echo -e "${BLUE}[DB] 데이터베이스 복원 중...${NC}"

    if ! docker ps --format '{{.Names}}' | grep -q "fh-db"; then
        echo -e "${RED}오류: fh-db 컨테이너가 실행 중이 아닙니다.${NC}"
        echo "먼저 서비스를 시작하세요: docker compose up -d db"
        exit 1
    fi

    # 기존 연결 종료
    docker exec fh-db psql -U "$DB_USER" -d postgres -c \
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" 2>/dev/null || true

    # 데이터베이스 재생성
    echo -e "  기존 데이터베이스 삭제 중..."
    docker exec fh-db psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null || true
    docker exec fh-db psql -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

    # 백업 복원
    echo -e "  백업 복원 중..."
    if [[ "$backup_file" == *.gz ]]; then
        gunzip -c "$backup_file" | docker exec -i fh-db psql -U "$DB_USER" -d "$DB_NAME"
    else
        cat "$backup_file" | docker exec -i fh-db psql -U "$DB_USER" -d "$DB_NAME"
    fi

    echo -e "  ${GREEN}✓ 데이터베이스 복원 완료${NC}"
}

# 파일 복원
restore_files() {
    local backup_file="$1"

    if [ ! -f "$backup_file" ]; then
        echo -e "${RED}오류: 백업 파일을 찾을 수 없습니다: $backup_file${NC}"
        exit 1
    fi

    local data_path="${DATA_PATH:-./data}"

    echo -e "${YELLOW}⚠ 경고: 이 작업은 현재 파일을 덮어씌웁니다!${NC}"
    echo -e "복원할 파일: ${BLUE}$(basename $backup_file)${NC}"
    echo -e "대상 디렉토리: ${BLUE}$data_path${NC}"
    echo -n "계속하시겠습니까? (yes를 입력): "
    read -r confirm

    if [ "$confirm" != "yes" ]; then
        echo -e "${YELLOW}복원이 취소되었습니다.${NC}"
        exit 0
    fi

    echo ""
    echo -e "${BLUE}[FILES] 파일 복원 중...${NC}"

    # 기존 디렉토리 백업
    if [ -d "$data_path" ]; then
        local backup_old="${data_path}.old.$(date +%Y%m%d%H%M%S)"
        echo -e "  기존 디렉토리를 ${backup_old}로 이동 중..."
        mv "$data_path" "$backup_old"
    fi

    # 복원
    echo -e "  백업 복원 중..."
    tar -xzf "$backup_file" -C "$(dirname $data_path)"

    echo -e "  ${GREEN}✓ 파일 복원 완료${NC}"
    echo -e "  ${YELLOW}기존 파일은 ${backup_old:-없음}에 백업되었습니다.${NC}"
}

# 설정 복원
restore_config() {
    local backup_file="$1"

    if [ ! -f "$backup_file" ]; then
        echo -e "${RED}오류: 백업 파일을 찾을 수 없습니다: $backup_file${NC}"
        exit 1
    fi

    local config_path="${CONFIG_PATH:-./config}"

    echo -e "${YELLOW}⚠ 경고: 이 작업은 현재 설정을 덮어씌웁니다!${NC}"
    echo -e "복원할 파일: ${BLUE}$(basename $backup_file)${NC}"
    echo -n "계속하시겠습니까? (yes를 입력): "
    read -r confirm

    if [ "$confirm" != "yes" ]; then
        echo -e "${YELLOW}복원이 취소되었습니다.${NC}"
        exit 0
    fi

    echo ""
    echo -e "${BLUE}[CONFIG] 설정 복원 중...${NC}"

    # 기존 설정 백업
    if [ -d "$config_path" ]; then
        local backup_old="${config_path}.old.$(date +%Y%m%d%H%M%S)"
        cp -r "$config_path" "$backup_old"
        echo -e "  기존 설정이 ${backup_old}에 백업되었습니다."
    fi

    # 복원
    tar -xzf "$backup_file" -C "$(dirname $config_path)"

    echo -e "  ${GREEN}✓ 설정 복원 완료${NC}"
}

# 대화형 복원
interactive_restore() {
    echo -e "${BLUE}어떤 유형의 백업을 복원하시겠습니까?${NC}"
    echo ""
    echo "  [1] 데이터베이스"
    echo "  [2] 파일"
    echo "  [3] 설정"
    echo "  [4] 취소"
    echo ""
    echo -n "선택 (1-4): "
    read -r choice

    case "$choice" in
        1)
            if list_backups "db"; then
                echo -n "복원할 백업 번호 또는 파일 경로: "
                read -r selection

                if [[ "$selection" =~ ^[0-9]+$ ]]; then
                    local files=($(ls -t "$BACKUP_DIR"/*_db_*.sql.gz 2>/dev/null))
                    local backup_file="${files[$((selection-1))]}"
                else
                    backup_file="$selection"
                fi

                restore_database "$backup_file"
            fi
            ;;
        2)
            if list_backups "files"; then
                echo -n "복원할 백업 번호 또는 파일 경로: "
                read -r selection

                if [[ "$selection" =~ ^[0-9]+$ ]]; then
                    local files=($(ls -t "$BACKUP_DIR"/*_files_*.tar.gz 2>/dev/null))
                    local backup_file="${files[$((selection-1))]}"
                else
                    backup_file="$selection"
                fi

                restore_files "$backup_file"
            fi
            ;;
        3)
            if list_backups "config"; then
                echo -n "복원할 백업 번호 또는 파일 경로: "
                read -r selection

                if [[ "$selection" =~ ^[0-9]+$ ]]; then
                    local files=($(ls -t "$BACKUP_DIR"/*_config_*.tar.gz 2>/dev/null))
                    local backup_file="${files[$((selection-1))]}"
                else
                    backup_file="$selection"
                fi

                restore_config "$backup_file"
            fi
            ;;
        4)
            echo -e "${YELLOW}복원이 취소되었습니다.${NC}"
            exit 0
            ;;
        *)
            echo -e "${RED}잘못된 선택입니다.${NC}"
            exit 1
            ;;
    esac
}

# 메인 로직
if [ $# -eq 0 ]; then
    interactive_restore
else
    case "$1" in
        db)
            if [ -z "$2" ]; then
                list_backups "db"
                echo -n "복원할 백업 파일 경로: "
                read -r backup_file
            else
                backup_file="$2"
            fi
            restore_database "$backup_file"
            ;;
        files)
            if [ -z "$2" ]; then
                list_backups "files"
                echo -n "복원할 백업 파일 경로: "
                read -r backup_file
            else
                backup_file="$2"
            fi
            restore_files "$backup_file"
            ;;
        config)
            if [ -z "$2" ]; then
                list_backups "config"
                echo -n "복원할 백업 파일 경로: "
                read -r backup_file
            else
                backup_file="$2"
            fi
            restore_config "$backup_file"
            ;;
        -h|--help)
            echo "사용법: $0 [db|files|config] [BACKUP_FILE]"
            echo ""
            echo "인자 없이 실행하면 대화형 모드로 실행됩니다."
            echo ""
            echo "예제:"
            echo "  $0                                  # 대화형 모드"
            echo "  $0 db backups/fh_backup_db_20240101.sql.gz"
            echo "  $0 files backups/fh_backup_files_20240101.tar.gz"
            exit 0
            ;;
        *)
            echo -e "${RED}알 수 없는 명령: $1${NC}"
            echo "사용법: $0 [db|files|config] [BACKUP_FILE]"
            exit 1
            ;;
    esac
fi

echo ""
echo -e "${GREEN}=== 복원 완료 ===${NC}"
echo ""
echo -e "${YELLOW}서비스를 재시작하는 것을 권장합니다:${NC}"
echo -e "  ${BLUE}docker compose restart${NC}"
echo ""
