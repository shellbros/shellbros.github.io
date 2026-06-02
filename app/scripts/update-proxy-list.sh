#!/bin/bash

# ============================================
# Update WebSocket Proxy Allowlist Script
# Syncs domains from root_domains.json into 
# functions/_shared/wsProxy.js allowlist array
# ============================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Files (resolve relative to script location, not cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
JSON_FILE="$REPO_ROOT/root_domains.json"
WSPROXY_FILE="$REPO_ROOT/functions/_shared/wsProxy.js"
WSPROXY_BACKUP="$REPO_ROOT/functions/_shared/wsProxy.js.backup"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Updating WebSocket Proxy Allowlist   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# ============================================
# Validation
# ============================================
echo -e "${YELLOW}🔍 Validating files...${NC}"

if [ ! -f "$JSON_FILE" ]; then
    echo -e "${RED}❌ Error: $JSON_FILE not found!${NC}"
    exit 1
fi

if [ ! -f "$WSPROXY_FILE" ]; then
    echo -e "${RED}❌ Error: $WSPROXY_FILE not found!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All files found${NC}"
echo ""

# ============================================
# Create Backup
# ============================================
echo -e "${YELLOW}📋 Creating backup...${NC}"
cp "$WSPROXY_FILE" "$WSPROXY_BACKUP"
echo -e "${GREEN}✓ Backed up: $WSPROXY_BACKUP${NC}"
echo ""

# ============================================
# Extract Domains from JSON
# ============================================
echo -e "${YELLOW}📖 Reading domains from $JSON_FILE...${NC}"
DOMAINS=$(node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('$JSON_FILE', 'utf8'));
const formatted = data.domains.map(d => '  \\\"' + d + '\\\",').join('\n');
console.log(formatted.slice(0, -1)); // Remove last comma
")

DOMAIN_COUNT=$(echo "$DOMAINS" | wc -l | tr -d ' ')
echo -e "${GREEN}✓ Found $DOMAIN_COUNT domains${NC}"
echo ""

# ============================================
# Update Allowlist Array
# ============================================
echo -e "${YELLOW}🔄 Updating wsProxy.js...${NC}"

# Create temp file with new allowlist array
TMP_ALLOWLIST="$(mktemp)"
{
  echo "	const allowlist = ["
  printf '%s\n' "$DOMAINS"
  echo "	];"
} > "$TMP_ALLOWLIST"

# Replace the allowlist array in the JS file
awk -v tmp="$TMP_ALLOWLIST" '
BEGIN {
  in_allowlist = 0
  bracket_count = 0
}
/const allowlist = \[/ {
  in_allowlist = 1
  bracket_count = 1
  # Print the prepared allowlist block from the temp file
  while ((getline line < tmp) > 0) print line
  close(tmp)
  next
}
in_allowlist {
  # Count brackets until we hit the closing "];"
  for (i = 1; i <= length($0); i++) {
    char = substr($0, i, 1)
    if (char == "[") bracket_count++
    else if (char == "]") bracket_count--
  }
  if (bracket_count == 0 && /];/) in_allowlist = 0
  next
}
{ print }
' "$WSPROXY_FILE" > "${WSPROXY_FILE}.tmp"

mv "${WSPROXY_FILE}.tmp" "$WSPROXY_FILE"
rm -f "$TMP_ALLOWLIST"

echo -e "${GREEN}✓ Successfully updated wsProxy.js${NC}"

echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Update Complete!                     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}📊 Summary:${NC}"
echo -e "   - Domains synced: ${GREEN}$DOMAIN_COUNT${NC}"
echo -e "   - File updated:"
echo -e "     • ${GREEN}functions/_shared/wsProxy.js${NC}"
echo -e "   - Backup saved:"
echo -e "     • ${YELLOW}wsProxy.js.backup${NC}"
echo ""
echo -e "${YELLOW}💡 Next steps:${NC}"
echo -e "   ${BLUE}1.${NC} Review changes:"
echo -e "      ${GREEN}git diff functions/_shared/wsProxy.js${NC}"
echo ""
echo -e "   ${BLUE}2.${NC} Test function locally:"
echo -e "      ${GREEN}wrangler pages dev .${NC}"
echo ""
echo -e "   ${BLUE}3.${NC} Commit changes:"
echo -e "      ${GREEN}git add functions/_shared/wsProxy.js${NC}"
echo -e "      ${GREEN}git commit -m 'Update wsProxy allowlist from root_domains.json'${NC}"
echo ""
echo -e "   ${BLUE}4.${NC} Deploy to Cloudflare:"
echo -e "      ${GREEN}git push origin main${NC}"
echo ""
echo -e "${GREEN}✨ Done! 🎉${NC}"