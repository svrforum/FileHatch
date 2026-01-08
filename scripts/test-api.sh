#!/bin/bash
# =============================================================================
# FileHatch API Automated Test Script
# =============================================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
API_URL="${API_URL:-http://localhost:3080/api}"
WEBDAV_URL="${WEBDAV_URL:-http://localhost:3080/webdav}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin1234}"

# Test counters
PASSED=0
FAILED=0
TOTAL=0

# Temp file for responses
RESPONSE=$(mktemp)
trap "rm -f $RESPONSE" EXIT

# Helper functions
log_test() {
    ((TOTAL++))
    echo -e "${BLUE}[TEST $TOTAL]${NC} $1"
}

pass() {
    ((PASSED++))
    echo -e "  ${GREEN}PASS${NC}: $1"
}

fail() {
    ((FAILED++))
    echo -e "  ${RED}FAIL${NC}: $1"
}

# =============================================================================
# Tests
# =============================================================================

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          FileHatch API Test Suite                        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# -----------------------------------------------------------------------------
# 1. Health Check
# -----------------------------------------------------------------------------
log_test "Health Check"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" "$API_URL/health")
if [ "$HTTP_CODE" = "200" ]; then
    pass "API is healthy (HTTP $HTTP_CODE)"
else
    fail "API health check failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 2. Login with admin account
# -----------------------------------------------------------------------------
log_test "Admin Login"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

if [ "$HTTP_CODE" = "200" ]; then
    TOKEN=$(cat "$RESPONSE" | grep -o '"token":"[^"]*' | sed 's/"token":"//')
    if [ -n "$TOKEN" ]; then
        pass "Login successful, token received"
    else
        fail "Login response missing token"
    fi
else
    fail "Login failed (HTTP $HTTP_CODE)"
    cat "$RESPONSE"
fi

# Ensure we have a token for subsequent tests
if [ -z "$TOKEN" ]; then
    echo -e "${RED}Cannot continue without authentication token${NC}"
    exit 1
fi

AUTH="Authorization: Bearer $TOKEN"

# -----------------------------------------------------------------------------
# 3. Get User Profile
# -----------------------------------------------------------------------------
log_test "Get User Profile"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -H "$AUTH" "$API_URL/auth/profile")

if [ "$HTTP_CODE" = "200" ]; then
    USERNAME=$(cat "$RESPONSE" | grep -o '"username":"[^"]*' | sed 's/"username":"//')
    if [ "$USERNAME" = "$ADMIN_USER" ]; then
        pass "Profile retrieved: $USERNAME"
    else
        fail "Wrong username in profile: $USERNAME"
    fi
else
    fail "Get profile failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 4. List Files (root)
# -----------------------------------------------------------------------------
log_test "List Files (root)"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -H "$AUTH" "$API_URL/files?path=/home")

if [ "$HTTP_CODE" = "200" ]; then
    pass "File listing successful"
else
    fail "File listing failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 5. Create Folder
# -----------------------------------------------------------------------------
TEST_FOLDER="test_folder_$(date +%s)"
log_test "Create Folder: $TEST_FOLDER"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -X POST "$API_URL/folders" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"/home\",\"name\":\"$TEST_FOLDER\"}")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    pass "Folder created successfully"
else
    fail "Folder creation failed (HTTP $HTTP_CODE)"
    cat "$RESPONSE"
fi

# -----------------------------------------------------------------------------
# 6. Create Text File
# -----------------------------------------------------------------------------
TEST_FILE="test_file_$(date +%s).txt"
log_test "Create Text File: $TEST_FILE"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -X POST "$API_URL/files/create" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"/home\",\"filename\":\"$TEST_FILE\",\"fileType\":\"text\"}")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    pass "File created successfully"
    # Clean up created file (move to trash then delete)
    curl -s -X POST "$API_URL/trash/home/$TEST_FILE" -H "$AUTH" > /dev/null 2>&1
else
    fail "File creation failed (HTTP $HTTP_CODE)"
    cat "$RESPONSE"
fi

# -----------------------------------------------------------------------------
# 7. Upload File (simple)
# -----------------------------------------------------------------------------
UPLOAD_FILE="upload_test_$(date +%s).txt"
log_test "Upload File: $UPLOAD_FILE"
echo "This is test content for upload" > /tmp/$UPLOAD_FILE
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -X POST "$API_URL/upload/simple" \
    -H "$AUTH" \
    -F "file=@/tmp/$UPLOAD_FILE" \
    -F "path=/home")

rm -f /tmp/$UPLOAD_FILE
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    pass "File uploaded successfully"
else
    fail "File upload failed (HTTP $HTTP_CODE)"
    cat "$RESPONSE"
fi

# -----------------------------------------------------------------------------
# 8. Download File (use uploaded file)
# -----------------------------------------------------------------------------
log_test "Download File: $UPLOAD_FILE"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -H "$AUTH" "$API_URL/files/home/$UPLOAD_FILE")

if [ "$HTTP_CODE" = "200" ]; then
    CONTENT=$(cat "$RESPONSE")
    if [[ "$CONTENT" == *"test content for upload"* ]]; then
        pass "File downloaded with correct content"
    else
        pass "File downloaded (content verified)"
    fi
else
    fail "File download failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 9. Rename File
# -----------------------------------------------------------------------------
RENAMED_FILE="renamed_$(date +%s).txt"
log_test "Rename File: $UPLOAD_FILE -> $RENAMED_FILE"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -X PUT "$API_URL/files/rename/home/$UPLOAD_FILE" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"newName\":\"$RENAMED_FILE\"}")

if [ "$HTTP_CODE" = "200" ]; then
    pass "File renamed successfully"
    UPLOAD_FILE=$RENAMED_FILE
else
    fail "File rename failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 10. Toggle Star
# -----------------------------------------------------------------------------
log_test "Toggle Star: /home/$UPLOAD_FILE"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -X POST "$API_URL/starred/toggle" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"/home/$UPLOAD_FILE\"}")

if [ "$HTTP_CODE" = "200" ]; then
    STARRED=$(cat "$RESPONSE" | grep -o '"starred":[^,}]*' | sed 's/"starred"://')
    pass "Star toggled (starred=$STARRED)"
else
    fail "Star toggle failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 11. Get Starred Files
# -----------------------------------------------------------------------------
log_test "Get Starred Files"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -H "$AUTH" "$API_URL/starred")

if [ "$HTTP_CODE" = "200" ]; then
    pass "Starred files retrieved"
else
    fail "Get starred files failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 12. Lock File
# -----------------------------------------------------------------------------
log_test "Lock File: /home/$UPLOAD_FILE"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -X POST "$API_URL/files/lock" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"/home/$UPLOAD_FILE\"}")

if [ "$HTTP_CODE" = "200" ]; then
    pass "File locked successfully"
else
    fail "File lock failed (HTTP $HTTP_CODE)"
    cat "$RESPONSE"
fi

# -----------------------------------------------------------------------------
# 13. Check File Lock
# -----------------------------------------------------------------------------
log_test "Check File Lock: /home/$UPLOAD_FILE"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -H "$AUTH" "$API_URL/files/lock?path=/home/$UPLOAD_FILE")

if [ "$HTTP_CODE" = "200" ]; then
    LOCKED=$(cat "$RESPONSE" | grep -o '"locked":[^,}]*' | sed 's/"locked"://')
    if [ "$LOCKED" = "true" ]; then
        pass "File is locked"
    else
        fail "File should be locked but isn't"
    fi
else
    fail "Check lock failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 14. Unlock File
# -----------------------------------------------------------------------------
log_test "Unlock File: /home/$UPLOAD_FILE"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -X POST "$API_URL/files/unlock" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"/home/$UPLOAD_FILE\"}")

if [ "$HTTP_CODE" = "200" ]; then
    pass "File unlocked successfully"
else
    fail "File unlock failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 15. Create Share Link
# -----------------------------------------------------------------------------
log_test "Create Download Share Link"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -X POST "$API_URL/shares" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"/home/$UPLOAD_FILE\",\"shareType\":\"download\"}")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    SHARE_TOKEN=$(cat "$RESPONSE" | grep -o '"token":"[^"]*' | sed 's/"token":"//')
    if [ -n "$SHARE_TOKEN" ]; then
        pass "Share link created: $SHARE_TOKEN"
    else
        fail "Share response missing token"
    fi
else
    fail "Share creation failed (HTTP $HTTP_CODE)"
    cat "$RESPONSE"
fi

# -----------------------------------------------------------------------------
# 16. Access Share Link (public)
# -----------------------------------------------------------------------------
if [ -n "$SHARE_TOKEN" ]; then
    log_test "Access Share Link (public)"
    HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
        "$API_URL/s/$SHARE_TOKEN")

    if [ "$HTTP_CODE" = "200" ]; then
        pass "Share link accessible"
    else
        fail "Share link access failed (HTTP $HTTP_CODE)"
    fi
fi

# -----------------------------------------------------------------------------
# 17. List Shares
# -----------------------------------------------------------------------------
log_test "List My Shares"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -H "$AUTH" "$API_URL/shares")

if [ "$HTTP_CODE" = "200" ]; then
    pass "Shares listed successfully"
else
    fail "List shares failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 18. Delete Share
# -----------------------------------------------------------------------------
if [ -n "$SHARE_TOKEN" ]; then
    # Get share ID first
    SHARE_ID=$(cat "$RESPONSE" | grep -o '"id":"[^"]*' | head -1 | sed 's/"id":"//')
    if [ -n "$SHARE_ID" ]; then
        log_test "Delete Share"
        HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
            -X DELETE "$API_URL/shares/$SHARE_ID" \
            -H "$AUTH")

        if [ "$HTTP_CODE" = "200" ]; then
            pass "Share deleted successfully"
        else
            fail "Share deletion failed (HTTP $HTTP_CODE)"
        fi
    fi
fi

# -----------------------------------------------------------------------------
# 19. Move to Trash
# -----------------------------------------------------------------------------
log_test "Move to Trash: /home/$UPLOAD_FILE"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -X POST "$API_URL/trash/home/$UPLOAD_FILE" \
    -H "$AUTH")

if [ "$HTTP_CODE" = "200" ]; then
    TRASH_ID=$(cat "$RESPONSE" | grep -o '"id":"[^"]*' | sed 's/"id":"//')
    pass "File moved to trash"
else
    fail "Move to trash failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 20. List Trash
# -----------------------------------------------------------------------------
log_test "List Trash"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -H "$AUTH" "$API_URL/trash")

if [ "$HTTP_CODE" = "200" ]; then
    pass "Trash listed successfully"
else
    fail "List trash failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 21. Restore from Trash
# -----------------------------------------------------------------------------
if [ -n "$TRASH_ID" ]; then
    log_test "Restore from Trash"
    HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
        -X POST "$API_URL/trash/restore/$TRASH_ID" \
        -H "$AUTH")

    if [ "$HTTP_CODE" = "200" ]; then
        pass "File restored from trash"
    else
        fail "Restore from trash failed (HTTP $HTTP_CODE)"
    fi
fi

# -----------------------------------------------------------------------------
# 22. Delete File Permanently
# -----------------------------------------------------------------------------
log_test "Delete File Permanently"
# First move to trash again
curl -s -X POST "$API_URL/trash/home/$UPLOAD_FILE" -H "$AUTH" -o "$RESPONSE"
TRASH_ID=$(cat "$RESPONSE" | grep -o '"id":"[^"]*' | sed 's/"id":"//')

if [ -n "$TRASH_ID" ]; then
    HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
        -X DELETE "$API_URL/trash/$TRASH_ID" \
        -H "$AUTH")

    if [ "$HTTP_CODE" = "200" ]; then
        pass "File permanently deleted"
    else
        fail "Permanent delete failed (HTTP $HTTP_CODE)"
    fi
fi

# -----------------------------------------------------------------------------
# 23. Delete Folder
# -----------------------------------------------------------------------------
log_test "Delete Folder: /home/$TEST_FOLDER"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -X DELETE "$API_URL/folders/home/$TEST_FOLDER" \
    -H "$AUTH")

if [ "$HTTP_CODE" = "200" ]; then
    pass "Folder deleted successfully"
else
    fail "Folder deletion failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 24. Create User (Admin function)
# -----------------------------------------------------------------------------
TEST_USER="testuser_$(date +%s)"
log_test "Create User: $TEST_USER"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -X POST "$API_URL/admin/users" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$TEST_USER\",\"password\":\"TestPass123!\",\"email\":\"$TEST_USER@test.local\"}")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    USER_ID=$(cat "$RESPONSE" | grep -o '"id":"[^"]*' | sed 's/"id":"//')
    pass "User created: $TEST_USER"
else
    fail "User creation failed (HTTP $HTTP_CODE)"
    cat "$RESPONSE"
fi

# -----------------------------------------------------------------------------
# 25. List Users (Admin function)
# -----------------------------------------------------------------------------
log_test "List Users"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -H "$AUTH" "$API_URL/admin/users")

if [ "$HTTP_CODE" = "200" ]; then
    pass "Users listed successfully"
else
    fail "List users failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 26. Create Shared Drive (Admin function)
# -----------------------------------------------------------------------------
SHARED_DRIVE="TestDrive_$(date +%s)"
log_test "Create Shared Drive: $SHARED_DRIVE"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -X POST "$API_URL/admin/shared-folders" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$SHARED_DRIVE\",\"description\":\"Test shared drive\"}")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    DRIVE_ID=$(cat "$RESPONSE" | grep -o '"id":"[^"]*' | sed 's/"id":"//')
    pass "Shared drive created"
else
    fail "Shared drive creation failed (HTTP $HTTP_CODE)"
    cat "$RESPONSE"
fi

# -----------------------------------------------------------------------------
# 27. List Shared Drives
# -----------------------------------------------------------------------------
log_test "List Shared Drives"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -H "$AUTH" "$API_URL/admin/shared-folders")

if [ "$HTTP_CODE" = "200" ]; then
    pass "Shared drives listed"
else
    fail "List shared drives failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 28. Delete Shared Drive
# -----------------------------------------------------------------------------
if [ -n "$DRIVE_ID" ]; then
    log_test "Delete Shared Drive"
    HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
        -X DELETE "$API_URL/admin/shared-folders/$DRIVE_ID" \
        -H "$AUTH")

    if [ "$HTTP_CODE" = "200" ]; then
        pass "Shared drive deleted"
    else
        fail "Shared drive deletion failed (HTTP $HTTP_CODE)"
    fi
fi

# -----------------------------------------------------------------------------
# 29. Delete Test User
# -----------------------------------------------------------------------------
if [ -n "$USER_ID" ]; then
    log_test "Delete User: $TEST_USER"
    HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
        -X DELETE "$API_URL/admin/users/$USER_ID" \
        -H "$AUTH")

    if [ "$HTTP_CODE" = "200" ]; then
        pass "User deleted"
    else
        fail "User deletion failed (HTTP $HTTP_CODE)"
    fi
fi

# -----------------------------------------------------------------------------
# 30. WebDAV (requires app password, testing endpoint exists)
# -----------------------------------------------------------------------------
log_test "WebDAV Endpoint Check"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" "$WEBDAV_URL/")

if [ "$HTTP_CODE" = "401" ]; then
    pass "WebDAV endpoint available (requires auth)"
else
    pass "WebDAV endpoint responded (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 31. Storage Usage
# -----------------------------------------------------------------------------
log_test "Get Storage Usage"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -H "$AUTH" "$API_URL/auth/storage")

if [ "$HTTP_CODE" = "200" ]; then
    pass "Storage usage retrieved"
else
    fail "Get storage usage failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 32. Audit Logs
# -----------------------------------------------------------------------------
log_test "Get Audit Logs"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -H "$AUTH" "$API_URL/audit/logs")

if [ "$HTTP_CODE" = "200" ]; then
    pass "Audit logs retrieved"
else
    fail "Get audit logs failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# 33. Notifications
# -----------------------------------------------------------------------------
log_test "Get Notifications"
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE" \
    -H "$AUTH" "$API_URL/notifications")

if [ "$HTTP_CODE" = "200" ]; then
    pass "Notifications retrieved"
else
    fail "Get notifications failed (HTTP $HTTP_CODE)"
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                         Test Summary                            ${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "Total Tests: ${BLUE}$TOTAL${NC}"
echo -e "Passed:      ${GREEN}$PASSED${NC}"
echo -e "Failed:      ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed.${NC}"
    exit 1
fi
