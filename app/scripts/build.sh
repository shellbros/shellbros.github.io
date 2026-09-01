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
# Upstream branch guard
# makeShellHome.sh differs per branch — it hardcodes which CDN base it injects and
# which asset rewriter it runs. Building from the wrong branch yields an index.html
# full of URLs pointing at another repo, which 404. Check BEFORE the destructive sync.
# ============================================
echo -e "${YELLOW}Checking upstream branch...${NC}"

UPSTREAM_REPO="$(cd "$REPO_ROOT/../ShellShockers" 2>/dev/null && pwd)"
EXPECTED_BRANCH="${EXPECTED_BRANCH_OVERRIDE:-portalBranch}"

if [ -z "$UPSTREAM_REPO" ]; then
    echo -e "${RED}Error: ShellShockers not found beside $REPO_ROOT${NC}"
    exit 1
fi

CURRENT_BRANCH="$(git -C "$UPSTREAM_REPO" branch --show-current)"

if [ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]; then
    echo -e "${RED}Error: upstream is on '$CURRENT_BRANCH', expected '$EXPECTED_BRANCH'${NC}"
    echo -e "${YELLOW}Switch:${NC}   ${GREEN}git -C $UPSTREAM_REPO switch $EXPECTED_BRANCH${NC}"
    echo -e "${YELLOW}Override:${NC} ${GREEN}EXPECTED_BRANCH_OVERRIDE=$CURRENT_BRANCH bash app/scripts/build.sh${NC}"
    exit 1
fi

echo -e "${GREEN}Upstream on $CURRENT_BRANCH${NC}"
echo ""

# ============================================
# Compiled-client freshness guard
# The game client is compiled manually via `sudo ./compile.sh live compress` in
# the ShellShockers/game dir. If that compile is missing or older than any source
# file, this build would silently ship a stale client. Fail loudly instead, BEFORE
# the destructive sync runs.
# ============================================
echo -e "${YELLOW}Checking compiled client freshness...${NC}"

GAME_DIR="$(cd "$REPO_ROOT/../ShellShockers/game" 2>/dev/null && pwd)"
# compile.sh emits two bundles: shellshock.js (the game) and home.js (the Vue 3
# home/UI). Checking only one would pass a compile that produced that bundle and
# failed on the other.
COMPILED_JS="$GAME_DIR/home/js/shellshock.js"
COMPILED_HOME_JS="$GAME_DIR/home/js/home.js"

if [ -z "$GAME_DIR" ] || [ ! -d "$GAME_DIR/src" ]; then
    echo -e "${RED}Error: game source not found (expected $REPO_ROOT/../ShellShockers/game)${NC}"
    exit 1
fi

for BUNDLE in "$COMPILED_JS" "$COMPILED_HOME_JS"; do
  if [ ! -f "$BUNDLE" ]; then
    echo -e "${RED}Error: compiled client not found: $BUNDLE${NC}"
    echo -e "${YELLOW}Run the compile first:${NC}"
    echo -e "   ${GREEN}cd \"$GAME_DIR\" && sudo ./compile.sh live compress${NC}"
    exit 1
  fi
done

OLDEST_BUNDLE="$COMPILED_JS"
[ "$COMPILED_HOME_JS" -ot "$OLDEST_BUNDLE" ] && OLDEST_BUNDLE="$COMPILED_HOME_JS"
STALE_SRC="$(find "$GAME_DIR/src" -type f -newer "$OLDEST_BUNDLE" 2>/dev/null)"
if [ -n "$STALE_SRC" ]; then
    STALE_COUNT="$(printf '%s\n' "$STALE_SRC" | wc -l | tr -d ' ')"
    echo -e "${RED}Error: compiled client is STALE.${NC}"
    echo -e "${RED}$STALE_COUNT source file(s) are newer than $(basename "$OLDEST_BUNDLE").${NC}"
    echo -e "${YELLOW}Recompile before building:${NC}"
    echo -e "   ${GREEN}cd \"$GAME_DIR\" && sudo ./compile.sh live compress${NC}"
    echo -e "${YELLOW}Newer than the compiled client (first 10):${NC}"
    printf '%s\n' "$STALE_SRC" | head -10 | sed 's/^/   /'
    exit 1
fi

echo -e "${GREEN}Compiled client is up to date${NC}"
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
# Built-output guard
# Cause-agnostic: catches a wrong upstream branch, a changed upstream script, or a
# broken rewriter. Runs BEFORE the commit so a bad build never enters history.
# cdnSearchReplace.js only rewrites relative paths, so absolute URLs injected
# upstream pass straight through untouched — this is what catches them.
# ============================================
echo -e "${YELLOW}Validating built index.html...${NC}"

EXPECTED_REPO="gh/shellbros/shellbros.github.io"
# Re-baselined for the Vue 3 migration. Templates are precompiled into
# js/home.js and assets now resolve at RUNTIME via window.JSCDN, so the built
# index.html carries ~17-19 rewritten URLs instead of ~190. A rewrite that did
# not run at all still lands at 0, which this floor catches.
MIN_CDN_URLS=12

CDN_REFS="$(grep -oE 'cdn\.jsdelivr\.net/gh/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+' "$REPO_ROOT/index.html" \
            | sed 's|cdn\.jsdelivr\.net/||' || true)"

FOREIGN="$(printf '%s\n' "$CDN_REFS" | sort -u | grep -vx "$EXPECTED_REPO" || true)"

if [ -n "$FOREIGN" ]; then
    echo -e "${RED}Error: index.html references unexpected CDN repos:${NC}"
    printf '   %s\n' $FOREIGN
    echo -e "${YELLOW}Usually means the upstream build script came from the wrong branch.${NC}"
    exit 1
fi

# A zero-foreign result also passes when the rewrite never ran at all, so floor it.
CDN_COUNT="$(printf '%s\n' "$CDN_REFS" | grep -cx "$EXPECTED_REPO" || true)"

if [ "$CDN_COUNT" -lt "$MIN_CDN_URLS" ]; then
    echo -e "${RED}Error: only $CDN_COUNT CDN URLs in index.html — expected >= $MIN_CDN_URLS${NC}"
    echo -e "${YELLOW}The path rewrite (cdnSearchReplace.js) likely did not run.${NC}"
    exit 1
fi

echo -e "${GREEN}index.html OK — $CDN_COUNT CDN URLs, all $EXPECTED_REPO${NC}"
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