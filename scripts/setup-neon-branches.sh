#!/usr/bin/env bash
# Setup Neon branches for sentinel (dev / staging / prod)
# Requirements: neon CLI installed and authenticated (`neon auth`)
# Usage: bash scripts/setup-neon-branches.sh <parent-branch-id-or-name>

set -euo pipefail

PARENT_BRANCH="${1:-main}"
PROJECT_NAME="sentinel"
ENVIRONMENTS=("dev" "staging" "prod")

echo "🌿 Setting up Neon branches for $PROJECT_NAME from parent: $PARENT_BRANCH"
echo ""

# Check if neon CLI is available
if ! command -v neon &> /dev/null; then
  echo "❌ neon CLI not found. Install it with: npm install -g neon"
  exit 1
fi

# Get project ID
PROJECT_ID=$(neon projects list --output json 2>/dev/null | grep -B2 "\"name\":\"$PROJECT_NAME\"" | grep '"id"' | head -1 | cut -d'"' -f4 || echo "")

if [ -z "$PROJECT_ID" ]; then
  echo "❌ Project '$PROJECT_NAME' not found in Neon."
  echo "   Create it first at https://console.neon.tech or run:"
  echo "   neon projects create --name sentinel --region-id aws-us-east-2"
  exit 1
fi

echo "✅ Found project: $PROJECT_NAME ($PROJECT_ID)"
echo ""

# Get parent branch ID
PARENT_BRANCH_ID=$(neon branches list --project-id "$PROJECT_ID" --output json 2>/dev/null | grep -B1 "\"name\":\"$PARENT_BRANCH\"" | grep '"id"' | head -1 | cut -d'"' -f4 || echo "")

if [ -z "$PARENT_BRANCH_ID" ]; then
  echo "❌ Parent branch '$PARENT_BRANCH' not found in project $PROJECT_NAME."
  exit 1
fi

echo "📌 Parent branch: $PARENT_BRANCH ($PARENT_BRANCH_ID)"
echo ""

# Create branches for each environment
for ENV in "${ENVIRONMENTS[@]}"; do
  BRANCH_NAME="${PROJECT_NAME}-${ENV}"

  # Check if branch already exists
  EXISTING=$(neon branches list --project-id "$PROJECT_ID" --output json 2>/dev/null | grep "\"name\":\"$BRANCH_NAME\"" || echo "")

  if [ -n "$EXISTING" ]; then
    echo "⏭️  Branch '$BRANCH_NAME' already exists, skipping."
  else
    echo "🌱 Creating branch: $BRANCH_NAME..."
    neon branches create \
      --project-id "$PROJECT_ID" \
      --parent-id "$PARENT_BRANCH_ID" \
      --name "$BRANCH_NAME" \
      --type "development"

    # Get connection string
    CONN_STR=$(neon connection-string --branch-id "$(neon branches list --project-id "$PROJECT_ID" --output json | grep -B1 "\"name\":\"$BRANCH_NAME\"" | grep '"id"' | head -1 | cut -d'"' -f4)" 2>/dev/null || echo "unknown")
    echo "   ✅ Created: $BRANCH_NAME"
    echo "   📋 Connection string: $CONN_STR"
  fi
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Neon branches ready!"
echo ""
echo "Next steps:"
echo "  1. Set DATABASE_URL in Vercel for each environment:"
echo "     vercel env add DATABASE_URL production"
echo "     vercel env add DATABASE_URL preview"
echo "     vercel env add DATABASE_URL development"
echo ""
echo "  2. Or add to .env.local for local dev:"
echo "     DATABASE_URL=\$(neon connection-string --branch-id <dev-branch-id>)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
