#!/bin/bash

# ============================================
# Build Script
# Runs the complete build pipeline:
# 1. Syncs files from distShellHome
# 2. Updates WebSocket proxy allowlist
# 3. Transforms index.html for CDN delivery
# 4. Commits as "BUILD shell YYYY-MM-DD"
# 5. Updates build hash in CDN URLs
# 6. Commits as "UPDATE build YYYY-MM-DD"
# ============================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Script paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SYNC_SCRIPT="$SCRIPT_DIR/sync.py"
ALLOWLIST_SCRIPT="$SCRIPT_DIR/update-proxy-list.sh"
MAKESHELL_SCRIPT="$SCRIPT_DIR/makeShell.sh"
UPDATE_BUILD_SCRIPT="$SCRIPT_DIR/update-build.py"

# ISO date for commit messages
BUILD_DATE="$(date +%Y-%m-%d)"

echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         ShellShockers Build            ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# ============================================
# Validation
# ============================================
echo -e "${YELLOW}Validating scripts...${NC}"

for script in "$SYNC_SCRIPT" "$ALLOWLIST_SCRIPT" "$MAKESHELL_SCRIPT" "$UPDATE_BUILD_SCRIPT"; do
    if [ ! -f "$script" ]; then
        echo -e "${RED}Error: $(basename "$script") not found at $script${NC}"
        exit 1
    fi
done

for cmd in python3 node git; do
    if ! command -v "$cmd" &> /dev/null; then
        echo -e "${RED}Error: $cmd is not installed${NC}"
        exit 1
    fi
done

echo -e "${GREEN}All scripts found${NC}"
echo -e "${GREEN}Dependencies available${NC}"
echo ""

# ============================================
# Step 1: Sync Files
# ============================================
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Step 1: Syncing Files                ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

python3 "$SYNC_SCRIPT"
echo ""

# ============================================
# Step 2: Update Proxy Allowlist
# ============================================
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Step 2: Updating Proxy Allowlist     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

bash "$ALLOWLIST_SCRIPT"
echo ""

# ============================================
# Step 3: Transform index.html for CDN
# ============================================
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Step 3: Transforming index.html      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

SHORT_HASH="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
cd "$SCRIPT_DIR"
bash "$MAKESHELL_SCRIPT" "$SHORT_HASH"
cd "$REPO_ROOT"
echo ""

# ============================================
# Step 4: Commit "BUILD shell"
# ============================================
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Step 4: Committing BUILD shell       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

cd "$REPO_ROOT"
git add -A
if git diff --cached --quiet; then
    echo -e "${YELLOW}No changes to commit, skipping BUILD commit${NC}"
else
    git commit -m "BUILD shell $BUILD_DATE"
fi
echo ""

# ============================================
# Step 5: Update build hash
# ============================================
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Step 5: Updating build hash          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

python3 "$UPDATE_BUILD_SCRIPT"
echo ""

# ============================================
# Step 6: Commit "UPDATE build"
# ============================================
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Step 6: Committing UPDATE build      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

cd "$REPO_ROOT"
git add -A
if git diff --cached --quiet; then
    echo -e "${YELLOW}No changes to commit, skipping UPDATE commit${NC}"
else
    git commit -m "UPDATE build $BUILD_DATE"
fi
echo ""

# ============================================
# Build Complete
# ============================================
echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         Build Complete!                ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "   ${BLUE}1.${NC} Push to deploy:"
echo -e "      ${GREEN}git push origin main${NC}"
echo ""
echo -e "   ${BLUE}2.${NC} Purge jsDelivr cache:"
echo -e "      ${GREEN}python3 app/scripts/purge.py${NC}"