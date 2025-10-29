#!/bin/bash

# ============================================
# Update Backends Script
# Syncs domains from root_domains.json into 
# app/functions/matchmaker.js and services.js
# backends arrays
# ============================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Files
JSON_FILE="../../root_domains.json"
MATCHMAKER_FILE="../../functions/matchmaker.js"
SERVICES_FILE="../../functions/services.js"
MATCHMAKER_BACKUP="../../functions/matchmaker.js.backup"
SERVICES_BACKUP="../../functions/services.js.backup"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Updating Backends in Functions       ║${NC}"
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

if [ ! -f "$MATCHMAKER_FILE" ]; then
    echo -e "${RED}❌ Error: $MATCHMAKER_FILE not found!${NC}"
    exit 1
fi

if [ ! -f "$SERVICES_FILE" ]; then
    echo -e "${RED}❌ Error: $SERVICES_FILE not found!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All files found${NC}"
echo ""

# ============================================
# Create Backups
# ============================================
echo -e "${YELLOW}📋 Creating backups...${NC}"
cp "$MATCHMAKER_FILE" "$MATCHMAKER_BACKUP"
echo -e "${GREEN}✓ Backed up: $MATCHMAKER_BACKUP${NC}"
cp "$SERVICES_FILE" "$SERVICES_BACKUP"
echo -e "${GREEN}✓ Backed up: $SERVICES_BACKUP${NC}"
echo ""

# ============================================
# Extract Domains from JSON
# ============================================
echo -e "${YELLOW}📖 Reading domains from $JSON_FILE...${NC}"
DOMAINS=$(node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('$JSON_FILE', 'utf8'));
const formatted = data.domains.map(d => '  \"' + d + '\",').join('\n');
console.log(formatted.slice(0, -1)); // Remove last comma
")

DOMAIN_COUNT=$(echo "$DOMAINS" | wc -l | tr -d ' ')
echo -e "${GREEN}✓ Found $DOMAIN_COUNT domains${NC}"
echo ""

# ============================================
# Function to Update Backend Array
# ============================================
update_backends() {
    local FILE=$1
    local FILE_NAME=$(basename "$FILE")
    
    echo -e "${YELLOW}🔄 Updating $FILE_NAME...${NC}"
    
    # Create temp file with new backends array
    TMP_BACKENDS="$(mktemp)"
    {
      echo "const backends = ["
      printf '%s\n' "$DOMAINS"
      echo "];"
    } > "$TMP_BACKENDS"
    
    # Replace the backends array in the JS file
    awk -v tmp="$TMP_BACKENDS" '
    BEGIN {
      in_backends = 0
      bracket_count = 0
    }
    /const backends = \[/ {
      in_backends = 1
      bracket_count = 1
      # Print the prepared backends block from the temp file
      while ((getline line < tmp) > 0) print line
      close(tmp)
      next
    }
    in_backends {
      # Count brackets until we hit the closing "];"
      for (i = 1; i <= length($0); i++) {
        char = substr($0, i, 1)
        if (char == "[") bracket_count++
        else if (char == "]") bracket_count--
      }
      if (bracket_count == 0 && /];/) in_backends = 0
      next
    }
    { print }
    ' "$FILE" > "${FILE}.tmp"
    
    mv "${FILE}.tmp" "$FILE"
    rm -f "$TMP_BACKENDS"
    
    echo -e "${GREEN}✓ Successfully updated $FILE_NAME${NC}"
}

# ============================================
# Update Both Files
# ============================================
update_backends "$MATCHMAKER_FILE"
update_backends "$SERVICES_FILE"

echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Update Complete!                     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}📊 Summary:${NC}"
echo -e "   - Domains synced: ${GREEN}$DOMAIN_COUNT${NC}"
echo -e "   - Files updated:"
echo -e "     • ${GREEN}matchmaker.js${NC}"
echo -e "     • ${GREEN}services.js${NC}"
echo -e "   - Backups saved:"
echo -e "     • ${YELLOW}matchmaker.js.backup${NC}"
echo -e "     • ${YELLOW}services.js.backup${NC}"
echo ""
echo -e "${YELLOW}💡 Next steps:${NC}"
echo -e "   ${BLUE}1.${NC} Review changes:"
echo -e "      ${GREEN}git diff functions/matchmaker.js${NC}"
echo -e "      ${GREEN}git diff functions/services.js${NC}"
echo ""
echo -e "   ${BLUE}2.${NC} Test functions locally:"
echo -e "      ${GREEN}wrangler pages dev .${NC}"
echo ""
echo -e "   ${BLUE}3.${NC} Commit changes:"
echo -e "      ${GREEN}git add functions/matchmaker.js functions/services.js${NC}"
echo -e "      ${GREEN}git commit -m 'Update backends from root_domains.json'${NC}"
echo ""
echo -e "   ${BLUE}4.${NC} Deploy to Cloudflare:"
echo -e "      ${GREEN}git push origin main${NC}"
echo ""
echo -e "${GREEN}✨ Done! 🎉${NC}"