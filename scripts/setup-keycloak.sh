#!/bin/bash
#
# FileHatch - Keycloak SSO Setup Script
#
# This script configures Keycloak and FileHatch for SSO integration.
#
# Prerequisites:
#   - Docker containers running:
#     export HOST_IP=$(hostname -I | awk '{print $1}')
#     docker compose -f docker-compose.yaml -f docker-compose-sso.yaml up -d
#   - Keycloak container is healthy (wait ~2 minutes after startup)
#
# Usage:
#   ./scripts/setup-keycloak.sh
#
# The script will auto-detect HOST_IP if not set.
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Auto-detect HOST_IP if not set
if [ -z "$HOST_IP" ]; then
    HOST_IP=$(hostname -I | awk '{print $1}')
    echo -e "${YELLOW}HOST_IP not set, auto-detected: ${HOST_IP}${NC}"
fi

# Configuration
FH_URL="${FH_URL:-http://localhost:3080}"
KEYCLOAK_URL="http://${HOST_IP}:8080"
KEYCLOAK_ADMIN="${KEYCLOAK_ADMIN:-admin}"
KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin123}"
REALM_NAME="${REALM_NAME:-filehatch}"
CLIENT_ID="${CLIENT_ID:-filehatch}"
CLIENT_SECRET="${CLIENT_SECRET:-}"
TEST_USER="${TEST_USER:-testuser}"
TEST_PASSWORD="${TEST_PASSWORD:-test1234}"
TEST_EMAIL="${TEST_EMAIL:-testuser@example.com}"
FH_ADMIN="${FH_ADMIN:-admin}"
FH_PASSWORD="${FH_PASSWORD:-admin1234}"

# Generate client secret if not provided
if [ -z "$CLIENT_SECRET" ]; then
    CLIENT_SECRET="fh-$(openssl rand -hex 16)"
fi

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}FileHatch Keycloak SSO Setup${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo "  HOST_IP:          $HOST_IP"
echo "  FileHatch URL:    $FH_URL"
echo "  Keycloak URL:     $KEYCLOAK_URL"
echo "  Realm:            $REALM_NAME"
echo "  Client ID:        $CLIENT_ID"
echo "  Test User:        $TEST_USER"
echo ""

# Function to wait for service
wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=60
    local attempt=1

    echo -e "${YELLOW}Waiting for $name to be ready...${NC}"

    while [ $attempt -le $max_attempts ]; do
        if curl -sf "$url" > /dev/null 2>&1; then
            echo -e "${GREEN}$name is ready!${NC}"
            return 0
        fi
        echo -n "."
        sleep 2
        ((attempt++))
    done

    echo ""
    echo -e "${RED}ERROR: $name is not responding after $max_attempts attempts${NC}"
    return 1
}

# Function to get Keycloak admin token
get_keycloak_token() {
    local response
    response=$(curl -sf -X POST "${KEYCLOAK_URL}/auth/realms/master/protocol/openid-connect/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "username=${KEYCLOAK_ADMIN}" \
        -d "password=${KEYCLOAK_ADMIN_PASSWORD}" \
        -d "grant_type=password" \
        -d "client_id=admin-cli" 2>/dev/null)

    if [ $? -ne 0 ]; then
        echo ""
        return 1
    fi

    echo "$response" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4
}

# Function to get FileHatch admin token
get_fh_token() {
    local response
    response=$(curl -sf -X POST "${FH_URL}/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"${FH_ADMIN}\",\"password\":\"${FH_PASSWORD}\"}" 2>/dev/null)

    if [ $? -ne 0 ]; then
        echo ""
        return 1
    fi

    echo "$response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4
}

# Step 1: Wait for services
echo ""
echo -e "${BLUE}[Step 1/6] Checking services...${NC}"
wait_for_service "${KEYCLOAK_URL}/auth/" "Keycloak" || exit 1
wait_for_service "${FH_URL}/api/storage/usage" "FileHatch" || exit 1

# Step 2: Get Keycloak admin token
echo ""
echo -e "${BLUE}[Step 2/6] Getting Keycloak admin token...${NC}"
KC_TOKEN=$(get_keycloak_token)
if [ -z "$KC_TOKEN" ]; then
    echo -e "${RED}ERROR: Failed to get Keycloak admin token${NC}"
    echo "Please check Keycloak admin credentials"
    exit 1
fi
echo -e "${GREEN}Token obtained successfully${NC}"

# Step 3: Create Realm
echo ""
echo -e "${BLUE}[Step 3/6] Creating Keycloak realm '${REALM_NAME}'...${NC}"
REALM_RESULT=$(curl -sf -X POST "${KEYCLOAK_URL}/auth/admin/realms" \
    -H "Authorization: Bearer ${KC_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
        \"realm\": \"${REALM_NAME}\",
        \"enabled\": true,
        \"displayName\": \"FileHatch\",
        \"registrationAllowed\": false,
        \"loginWithEmailAllowed\": true,
        \"duplicateEmailsAllowed\": false,
        \"resetPasswordAllowed\": true,
        \"editUsernameAllowed\": false
    }" 2>&1)

if echo "$REALM_RESULT" | grep -q "Conflict"; then
    echo -e "${YELLOW}Realm '${REALM_NAME}' already exists, skipping...${NC}"
else
    echo -e "${GREEN}Realm '${REALM_NAME}' created successfully${NC}"
fi

# Step 4: Create Client
echo ""
echo -e "${BLUE}[Step 4/6] Creating Keycloak client '${CLIENT_ID}'...${NC}"

# Need fresh token after realm creation
KC_TOKEN=$(get_keycloak_token)

CLIENT_RESULT=$(curl -sf -X POST "${KEYCLOAK_URL}/auth/admin/realms/${REALM_NAME}/clients" \
    -H "Authorization: Bearer ${KC_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
        \"clientId\": \"${CLIENT_ID}\",
        \"name\": \"FileHatch\",
        \"enabled\": true,
        \"publicClient\": false,
        \"secret\": \"${CLIENT_SECRET}\",
        \"protocol\": \"openid-connect\",
        \"standardFlowEnabled\": true,
        \"directAccessGrantsEnabled\": false,
        \"serviceAccountsEnabled\": false,
        \"rootUrl\": \"${FH_URL}\",
        \"baseUrl\": \"${FH_URL}\",
        \"redirectUris\": [\"${FH_URL}/api/auth/sso/callback/*\"],
        \"webOrigins\": [\"${FH_URL}\"],
        \"attributes\": {
            \"post.logout.redirect.uris\": \"${FH_URL}/*\"
        }
    }" 2>&1)

if echo "$CLIENT_RESULT" | grep -q "Conflict"; then
    echo -e "${YELLOW}Client '${CLIENT_ID}' already exists${NC}"
    # Get existing client secret
    KC_TOKEN=$(get_keycloak_token)
    EXISTING_CLIENT=$(curl -sf "${KEYCLOAK_URL}/auth/admin/realms/${REALM_NAME}/clients?clientId=${CLIENT_ID}" \
        -H "Authorization: Bearer ${KC_TOKEN}")
    CLIENT_SECRET=$(echo "$EXISTING_CLIENT" | grep -o '"secret":"[^"]*"' | cut -d'"' -f4)
    echo -e "${YELLOW}Using existing client secret${NC}"
else
    echo -e "${GREEN}Client '${CLIENT_ID}' created successfully${NC}"
fi

# Step 5: Create Test User
echo ""
echo -e "${BLUE}[Step 5/6] Creating test user '${TEST_USER}'...${NC}"

KC_TOKEN=$(get_keycloak_token)

USER_RESULT=$(curl -sf -X POST "${KEYCLOAK_URL}/auth/admin/realms/${REALM_NAME}/users" \
    -H "Authorization: Bearer ${KC_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
        \"username\": \"${TEST_USER}\",
        \"email\": \"${TEST_EMAIL}\",
        \"emailVerified\": true,
        \"enabled\": true,
        \"firstName\": \"Test\",
        \"lastName\": \"User\",
        \"credentials\": [{
            \"type\": \"password\",
            \"value\": \"${TEST_PASSWORD}\",
            \"temporary\": false
        }]
    }" 2>&1)

if echo "$USER_RESULT" | grep -q "Conflict"; then
    echo -e "${YELLOW}User '${TEST_USER}' already exists, skipping...${NC}"
else
    echo -e "${GREEN}User '${TEST_USER}' created successfully${NC}"
fi

# Step 6: Configure FileHatch SSO
echo ""
echo -e "${BLUE}[Step 6/6] Configuring FileHatch SSO...${NC}"

FH_TOKEN=$(get_fh_token)
if [ -z "$FH_TOKEN" ]; then
    echo -e "${RED}ERROR: Failed to get FileHatch admin token${NC}"
    echo "Please check FileHatch admin credentials"
    exit 1
fi

# Enable SSO
curl -sf -X PUT "${FH_URL}/api/admin/sso/settings" \
    -H "Authorization: Bearer ${FH_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"sso_enabled":"true","sso_auto_register":"true"}' > /dev/null

echo -e "${GREEN}SSO enabled in FileHatch${NC}"

# Check if provider already exists
EXISTING_PROVIDERS=$(curl -sf "${FH_URL}/api/admin/sso/providers" \
    -H "Authorization: Bearer ${FH_TOKEN}" 2>/dev/null)
PROVIDER_ID=$(echo "$EXISTING_PROVIDERS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# IMPORTANT: Both issuerUrl and authorizationUrl must use the same HOST_IP
# This ensures:
# 1. Browser accesses Keycloak at HOST_IP:8080
# 2. API container accesses Keycloak at HOST_IP:8080
# 3. Token issuer matches the URL used for validation
ISSUER_URL="http://${HOST_IP}:8080/auth/realms/${REALM_NAME}"
AUTH_URL="http://${HOST_IP}:8080/auth/realms/${REALM_NAME}/protocol/openid-connect/auth"

if [ -n "$PROVIDER_ID" ] && echo "$EXISTING_PROVIDERS" | grep -q "Keycloak"; then
    echo -e "${YELLOW}Keycloak provider found (ID: $PROVIDER_ID), updating...${NC}"
    curl -sf -X PUT "${FH_URL}/api/admin/sso/providers/${PROVIDER_ID}" \
        -H "Authorization: Bearer ${FH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{
            \"name\": \"Keycloak\",
            \"providerType\": \"oidc\",
            \"clientId\": \"${CLIENT_ID}\",
            \"clientSecret\": \"${CLIENT_SECRET}\",
            \"issuerUrl\": \"${ISSUER_URL}\",
            \"authorizationUrl\": \"${AUTH_URL}\",
            \"scopes\": \"openid email profile\",
            \"autoCreateUser\": true,
            \"defaultAdmin\": false,
            \"isEnabled\": true,
            \"displayOrder\": 0
        }" > /dev/null
    echo -e "${GREEN}Keycloak SSO provider updated successfully${NC}"
else
    PROVIDER_RESULT=$(curl -sf -X POST "${FH_URL}/api/admin/sso/providers" \
        -H "Authorization: Bearer ${FH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{
            \"name\": \"Keycloak\",
            \"providerType\": \"oidc\",
            \"clientId\": \"${CLIENT_ID}\",
            \"clientSecret\": \"${CLIENT_SECRET}\",
            \"issuerUrl\": \"${ISSUER_URL}\",
            \"authorizationUrl\": \"${AUTH_URL}\",
            \"scopes\": \"openid email profile\",
            \"autoCreateUser\": true,
            \"defaultAdmin\": false,
            \"isEnabled\": true,
            \"displayOrder\": 0
        }" 2>&1)

    if echo "$PROVIDER_RESULT" | grep -q "error"; then
        echo -e "${RED}ERROR: Failed to create SSO provider${NC}"
        echo "$PROVIDER_RESULT"
        exit 1
    fi

    echo -e "${GREEN}Keycloak SSO provider registered successfully${NC}"
fi

# Summary
echo ""
echo -e "${BLUE}======================================${NC}"
echo -e "${GREEN}SSO Setup Complete!${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""
echo -e "${YELLOW}Keycloak Admin Console:${NC}"
echo "  URL:      ${KEYCLOAK_URL}/auth/admin"
echo "  Username: ${KEYCLOAK_ADMIN}"
echo "  Password: ${KEYCLOAK_ADMIN_PASSWORD}"
echo ""
echo -e "${YELLOW}Keycloak Realm:${NC}"
echo "  Realm:    ${REALM_NAME}"
echo "  Client:   ${CLIENT_ID}"
echo "  Secret:   ${CLIENT_SECRET}"
echo ""
echo -e "${YELLOW}Test User (for SSO login):${NC}"
echo "  Username: ${TEST_USER}"
echo "  Password: ${TEST_PASSWORD}"
echo "  Email:    ${TEST_EMAIL}"
echo ""
echo -e "${YELLOW}FileHatch:${NC}"
echo "  URL:      ${FH_URL}"
echo ""
echo -e "${GREEN}You can now login to FileHatch using the 'Keycloak' button on the login page.${NC}"
echo ""
