#!/bin/bash
# =============================================================================
# FileHatch Database Migration Script
# =============================================================================
# 사용법:
#   ./scripts/migrate.sh           # 모든 대기 중인 마이그레이션 실행
#   ./scripts/migrate.sh status    # 마이그레이션 상태 확인
#   ./scripts/migrate.sh rollback  # 마지막 마이그레이션 롤백 (미구현)
# =============================================================================

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 스크립트 디렉토리
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MIGRATIONS_DIR="$PROJECT_DIR/db/migrations"

# 환경 변수 로드
if [ -f "$PROJECT_DIR/.env" ]; then
    source "$PROJECT_DIR/.env"
fi

# 기본값 설정
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-scv_user}"
DB_PASS="${DB_PASS:-scv_password}"
DB_NAME="${DB_NAME:-scv_main}"

# Docker 환경 감지
if docker ps --format '{{.Names}}' | grep -q "scv-db"; then
    USE_DOCKER=true
    echo -e "${BLUE}Docker 환경 감지됨. scv-db 컨테이너 사용${NC}"
else
    USE_DOCKER=false
fi

# PostgreSQL 명령 실행 함수
run_psql() {
    local query="$1"
    if [ "$USE_DOCKER" = true ]; then
        docker exec scv-db psql -U "$DB_USER" -d "$DB_NAME" -t -c "$query"
    else
        PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "$query"
    fi
}

# SQL 파일 실행 함수
run_sql_file() {
    local file="$1"
    if [ "$USE_DOCKER" = true ]; then
        docker exec -i scv-db psql -U "$DB_USER" -d "$DB_NAME" < "$file"
    else
        PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" < "$file"
    fi
}

# 스키마 마이그레이션 테이블 생성
ensure_migration_table() {
    echo -e "${BLUE}마이그레이션 테이블 확인 중...${NC}"
    run_sql_file "$MIGRATIONS_DIR/000_schema_migrations.sql" 2>/dev/null || true
}

# 적용된 마이그레이션 목록 가져오기
get_applied_migrations() {
    run_psql "SELECT version FROM schema_migrations ORDER BY version;" 2>/dev/null | tr -d ' '
}

# 마이그레이션 상태 표시
show_status() {
    echo -e "${BLUE}=== 마이그레이션 상태 ===${NC}"
    echo ""

    # 적용된 마이그레이션
    echo -e "${GREEN}적용됨:${NC}"
    local applied=$(run_psql "SELECT version || ' - ' || name || ' (' || applied_at::date || ')' FROM schema_migrations ORDER BY version;" 2>/dev/null)
    if [ -n "$applied" ]; then
        echo "$applied" | while read line; do
            [ -n "$line" ] && echo "  ✓ $line"
        done
    else
        echo "  (없음)"
    fi

    echo ""

    # 대기 중인 마이그레이션
    echo -e "${YELLOW}대기 중:${NC}"
    local has_pending=false
    for file in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
        filename=$(basename "$file")
        # 000_schema_migrations.sql 제외
        if [[ "$filename" == "000_"* ]]; then
            continue
        fi

        # 파일에서 버전 추출
        version=$(grep -oP "INSERT INTO schema_migrations.*VALUES.*\('\K[0-9]+(?=')" "$file" 2>/dev/null || true)

        if [ -n "$version" ]; then
            is_applied=$(run_psql "SELECT 1 FROM schema_migrations WHERE version = '$version';" 2>/dev/null | tr -d ' ')
            if [ -z "$is_applied" ]; then
                echo "  ○ $filename (version: $version)"
                has_pending=true
            fi
        fi
    done

    if [ "$has_pending" = false ]; then
        echo "  (없음)"
    fi

    echo ""
}

# 마이그레이션 실행
run_migrations() {
    echo -e "${BLUE}=== 마이그레이션 시작 ===${NC}"
    echo ""

    local applied_count=0

    for file in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
        filename=$(basename "$file")

        # 000_schema_migrations.sql 제외
        if [[ "$filename" == "000_"* ]]; then
            continue
        fi

        # 파일에서 버전 추출
        version=$(grep -oP "INSERT INTO schema_migrations.*VALUES.*\('\K[0-9]+(?=')" "$file" 2>/dev/null || true)

        if [ -z "$version" ]; then
            echo -e "${YELLOW}경고: $filename - 버전 정보 없음, 건너뜀${NC}"
            continue
        fi

        # 이미 적용되었는지 확인
        is_applied=$(run_psql "SELECT 1 FROM schema_migrations WHERE version = '$version';" 2>/dev/null | tr -d ' ')

        if [ -z "$is_applied" ]; then
            echo -e "${BLUE}적용 중: $filename (version: $version)${NC}"

            if run_sql_file "$file"; then
                echo -e "${GREEN}  ✓ 성공${NC}"
                ((applied_count++))
            else
                echo -e "${RED}  ✗ 실패${NC}"
                exit 1
            fi
        fi
    done

    echo ""
    if [ $applied_count -eq 0 ]; then
        echo -e "${GREEN}모든 마이그레이션이 이미 적용되어 있습니다.${NC}"
    else
        echo -e "${GREEN}$applied_count 개의 마이그레이션이 적용되었습니다.${NC}"
    fi
}

# 메인 로직
main() {
    local command="${1:-migrate}"

    case "$command" in
        status)
            ensure_migration_table
            show_status
            ;;
        migrate|"")
            ensure_migration_table
            run_migrations
            ;;
        rollback)
            echo -e "${RED}롤백 기능은 아직 구현되지 않았습니다.${NC}"
            exit 1
            ;;
        *)
            echo "사용법: $0 [status|migrate|rollback]"
            exit 1
            ;;
    esac
}

main "$@"
