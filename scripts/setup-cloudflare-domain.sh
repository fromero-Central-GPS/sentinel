#!/usr/bin/env bash
# Setup custom domain sentinel.centralgps.cl via Cloudflare DNS
# Requirements: CLOUDFLARE_API_TOKEN env var, cloudflare CLI or API calls
# Usage: CLOUDFLARE_API_TOKEN="..." bash scripts/setup-cloudflare-domain.sh
#
# centralgps.cl uses Cloudflare nameservers:
#   gwen.ns.cloudflare.com
#   dale.ns.cloudflare.com
#
# This script adds the CNAME record that points sentinel.centralgps.cl to Vercel.

set -euo pipefail

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "❌ CLOUDFLARE_API_TOKEN not set."
  echo ""
  echo "  Get your token at: https://dash.cloudflare.com/profile/api-tokens"
  echo "  Required permissions: Zone:DNS:Edit for centralgps.cl"
  echo ""
  echo "  Then run:"
  echo "    export CLOUDFLARE_API_TOKEN='your-token-here'"
  echo "    bash scripts/setup-cloudflare-domain.sh"
  exit 1
fi

ZONE_NAME="centralgps.cl"
CNAME_NAME="sentinel"
CNAME_TARGET="cname.vercel-dns.com"

echo "🌐 Setting up Cloudflare DNS for $CNAME_NAME.$ZONE_NAME..."
echo ""

# Get Zone ID
ZONE_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=$ZONE_NAME" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" | \
  grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$ZONE_ID" ]; then
  echo "❌ Could not find zone $ZONE_NAME. Check your API token permissions."
  exit 1
fi

echo "✅ Found zone: $ZONE_NAME ($ZONE_ID)"

# Check if CNAME already exists
EXISTING=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=CNAME&name=$CNAME_NAME.$ZONE_NAME" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json")

EXISTING_COUNT=$(echo "$EXISTING" | grep -o '"count":[0-9]*' | cut -d: -f2)

if [ "$EXISTING_COUNT" -gt 0 ]; then
  RECORD_ID=$(echo "$EXISTING" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "⏭️  CNAME record already exists ($RECORD_ID). Updating..."

  curl -s -X PUT \
    "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{
      \"type\": \"CNAME\",
      \"name\": \"$CNAME_NAME\",
      \"content\": \"$CNAME_TARGET\",
      \"ttl\": 1,
      \"proxied\": false
    }" > /dev/null
else
  echo "📝 Creating CNAME record: $CNAME_NAME.$ZONE_NAME → $CNAME_TARGET"

  curl -s -X POST \
    "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{
      \"type\": \"CNAME\",
      \"name\": \"$CNAME_NAME\",
      \"content\": \"$CNAME_TARGET\",
      \"ttl\": 1,
      \"proxied\": false
    }" > /dev/null
fi

echo "✅ Cloudflare DNS record configured: $CNAME_NAME.$ZONE_NAME → $CNAME_TARGET"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Next steps:"
echo "  1. Add the domain in Vercel dashboard:"
echo "     https://vercel.com/dashboard → sentinel → Settings → Domains → Add"
echo "     Domain: sentinel.centralgps.cl"
echo ""
echo "  2. Wait for DNS propagation (usually <5 min with Cloudflare)"
echo ""
echo "  3. Verify: curl -I https://sentinel.centralgps.cl"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
