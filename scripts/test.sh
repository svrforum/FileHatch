#!/bin/bash
# FileHatch - Test Runner Script
# 모든 기능 개선/추가 후 반드시 실행

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  FileHatch Test Runner${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Parse arguments
RUN_BACKEND=true
RUN_FRONTEND=true
RUN_BUILD=true
RUN_LINT=true
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --backend-only)
            RUN_FRONTEND=false
            RUN_BUILD=false
            shift
            ;;
        --frontend-only)
            RUN_BACKEND=false
            RUN_LINT=false
            shift
            ;;
        --no-build)
            RUN_BUILD=false
            shift
            ;;
        --no-lint)
            RUN_LINT=false
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --backend-only    Run only backend tests"
            echo "  --frontend-only   Run only frontend tests"
            echo "  --no-build        Skip build verification"
            echo "  --no-lint         Skip Go lint check"
            echo "  --verbose, -v     Show verbose output"
            echo "  --help, -h        Show this help"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Track results
BACKEND_RESULT=0
FRONTEND_RESULT=0
BUILD_RESULT=0
LINT_RESULT=0

# ========================================
# Go Lint
# ========================================
if [ "$RUN_LINT" = true ]; then
    echo -e "${YELLOW}[1/4] Running Go Lint...${NC}"
    cd "$PROJECT_ROOT/api"

    # Check if golangci-lint is available locally or use Docker
    if command -v golangci-lint &> /dev/null; then
        if golangci-lint run --timeout=5m ./...; then
            echo -e "${GREEN}✓ Go lint passed${NC}"
        else
            LINT_RESULT=1
            echo -e "${RED}✗ Go lint failed${NC}"
        fi
    else
        echo -e "  ${BLUE}Using Docker for lint (golangci-lint not found locally)...${NC}"
        if docker run --rm -v "$PROJECT_ROOT/api:/app" -w /app golangci/golangci-lint:latest golangci-lint run --timeout=5m ./...; then
            echo -e "${GREEN}✓ Go lint passed${NC}"
        else
            LINT_RESULT=1
            echo -e "${RED}✗ Go lint failed${NC}"
        fi
    fi
    echo ""
fi

# ========================================
# Backend Tests (Go)
# ========================================
if [ "$RUN_BACKEND" = true ]; then
    echo -e "${YELLOW}[2/4] Running Backend Tests (Go)...${NC}"
    cd "$PROJECT_ROOT/api"

    if [ "$VERBOSE" = true ]; then
        if go test ./handlers/... -v; then
            echo -e "${GREEN}✓ Backend tests passed${NC}"
        else
            BACKEND_RESULT=1
            echo -e "${RED}✗ Backend tests failed${NC}"
        fi
    else
        if go test ./handlers/... 2>&1 | tail -5; then
            echo -e "${GREEN}✓ Backend tests passed${NC}"
        else
            BACKEND_RESULT=1
            echo -e "${RED}✗ Backend tests failed${NC}"
        fi
    fi
    echo ""
fi

# ========================================
# Frontend Tests (Vitest)
# ========================================
if [ "$RUN_FRONTEND" = true ]; then
    echo -e "${YELLOW}[3/4] Running Frontend Tests (Vitest)...${NC}"
    cd "$PROJECT_ROOT/ui"

    if [ "$VERBOSE" = true ]; then
        if npm test -- --run; then
            echo -e "${GREEN}✓ Frontend tests passed${NC}"
        else
            FRONTEND_RESULT=1
            echo -e "${RED}✗ Frontend tests failed${NC}"
        fi
    else
        if npm test -- --run 2>&1 | tail -10; then
            echo -e "${GREEN}✓ Frontend tests passed${NC}"
        else
            FRONTEND_RESULT=1
            echo -e "${RED}✗ Frontend tests failed${NC}"
        fi
    fi
    echo ""
fi

# ========================================
# Build Verification
# ========================================
if [ "$RUN_BUILD" = true ]; then
    echo -e "${YELLOW}[4/4] Verifying Build...${NC}"

    # Backend build check
    echo -e "  ${BLUE}Checking backend build...${NC}"
    cd "$PROJECT_ROOT/api"
    if go build -o /dev/null . 2>&1; then
        echo -e "  ${GREEN}✓ Backend build OK${NC}"
    else
        BUILD_RESULT=1
        echo -e "  ${RED}✗ Backend build failed${NC}"
    fi

    # Frontend build check
    echo -e "  ${BLUE}Checking frontend build...${NC}"
    cd "$PROJECT_ROOT/ui"
    if npm run build 2>&1 | tail -5; then
        echo -e "  ${GREEN}✓ Frontend build OK${NC}"
    else
        BUILD_RESULT=1
        echo -e "  ${RED}✗ Frontend build failed${NC}"
    fi
    echo ""
fi

# ========================================
# Summary
# ========================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Test Summary${NC}"
echo -e "${BLUE}========================================${NC}"

TOTAL_RESULT=0

if [ "$RUN_LINT" = true ]; then
    if [ $LINT_RESULT -eq 0 ]; then
        echo -e "  Go Lint:        ${GREEN}PASSED${NC}"
    else
        echo -e "  Go Lint:        ${RED}FAILED${NC}"
        TOTAL_RESULT=1
    fi
fi

if [ "$RUN_BACKEND" = true ]; then
    if [ $BACKEND_RESULT -eq 0 ]; then
        echo -e "  Backend Tests:  ${GREEN}PASSED${NC}"
    else
        echo -e "  Backend Tests:  ${RED}FAILED${NC}"
        TOTAL_RESULT=1
    fi
fi

if [ "$RUN_FRONTEND" = true ]; then
    if [ $FRONTEND_RESULT -eq 0 ]; then
        echo -e "  Frontend Tests: ${GREEN}PASSED${NC}"
    else
        echo -e "  Frontend Tests: ${RED}FAILED${NC}"
        TOTAL_RESULT=1
    fi
fi

if [ "$RUN_BUILD" = true ]; then
    if [ $BUILD_RESULT -eq 0 ]; then
        echo -e "  Build Check:    ${GREEN}PASSED${NC}"
    else
        echo -e "  Build Check:    ${RED}FAILED${NC}"
        TOTAL_RESULT=1
    fi
fi

echo ""

if [ $TOTAL_RESULT -eq 0 ]; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  All checks passed! Ready to commit.${NC}"
    echo -e "${GREEN}========================================${NC}"
    exit 0
else
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}  Some checks failed. Please fix before committing.${NC}"
    echo -e "${RED}========================================${NC}"
    exit 1
fi
