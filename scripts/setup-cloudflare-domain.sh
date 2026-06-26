#!/usr/bin/env bash
# Setup Cloudflare DNS records for Sentinel: Vercel domain + Clerk auth DNS
# Requirements: CLOUDFLARE_API_TOKEN env var with Zone:DNS:Edit on supersonics.cl
# Usage:
#   export CLOUDFLARE_API_TOKEN='your-token-here'
#   bash scripts/setup-cloudflare-domain.sh
#
# supersonics.cl uses Cloudflare nameservers:
#   serena.ns.cloudflare.com
#   yoxall.ns.cloudflare.com

set -euo pipefail

# ─── Config ────────────────────────────────────────────────────────────

ZONE_NAME="supersonics.cl"

# Each record: "TYPE|NAME|CONTENT|PROXIED|TTL"
# PROXIED: false = DNS-only (required for Vercel and Clerk CNAMEs)
# TTL: 1 = Auto

DNS_RECORDS=(
  # ── Vercel deploy domain ─────────────────────────────────────────────
  "CNAME|sentinel|${SENTINEL_VERCEL_TARGET:-cname.vercel-dns.com}|false|1"

  # ── Clerk Authentication ─────────────────────────────────────────────
  # Custom sign-in domain
  "CNAME|accounts|accounts.clerk.services|false|1"

  # Clerk frontend API
  "CNAME|clerk|frontend-api.clerk.services|false|1"

  # ── Clerk Email (DKIM + mail) ────────────────────────────────────────
  "CNAME|clk._domainkey|dkim1.azn90t7k8jvh.clerk.services|false|1"
  "CNAME|clk2._domainkey|dkim2.azn90t7k8jvh.clerk.services|false|1"
  "CNAME|clkmail|mail.azn90t7k8jvh.clerk.services|false|1"
)

# ─── Helper functions ──────────────────────────────────────────────────

CURL_HEADERS=(
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
  -H "Content-Type: application/json"
)

cf_api() {
  local method="$1" url="$2" data="${3:-}"
  if [ -n "$data" ]; then
    curl -s -X "$method" "$url" "${CURL_HEADERS[@]}" --data "$data"
  else
    curl -s -X "$method" "$url" "${CURL_HEADERS[@]}"
  fi
}

upsert_record() {
  local type="$1" name="$2" content="$3" proxied="$4" ttl="$5"
  local fqdn="${name}.${ZONE_NAME}"

  echo "  📝 $type $fqdn → $content (proxied=$proxied)"

  # Check if record already exists
  local existing
  existing=$(cf_api GET \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=${type}&name=${fqdn}")

  local record_id
  record_id=$(echo "$existing" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -n "$record_id" ] && [ "$record_id" != "null" ]; then
    # Update existing
    local resp
    resp=$(cf_api PUT \
      "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${record_id}" \
      "{\"type\":\"${type}\",\"name\":\"${name}\",\"content\":\"${content}\",\"ttl\":${ttl},\"proxied\":${proxied}}")

    if echo "$resp" | grep -q '"success":true'; then
      echo "     ✅ Updated existing record"
    else
      echo "     ⚠️  Update may have failed — check manually"
    fi
  else
    # Create new
    local resp
    resp=$(cf_api POST \
      "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
      "{\"type\":\"${type}\",\"name\":\"${name}\",\"content\":\"${content}\",\"ttl\":${ttl},\"proxied\":${proxied}}")

    if echo "$resp" | grep -q '"success":true'; then
      echo "     ✅ Created"
    else
      local err
      err=$(echo "$resp" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4)
      echo "     ❌ Failed: ${err:-unknown error}"
    fi
  fi
}

# ─── Main ──────────────────────────────────────────────────────────────

echo "🌐 Sentinel — Cloudflare DNS Setup"
echo "   Zone: $ZONE_NAME"
echo ""

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "❌ CLOUDFLARE_API_TOKEN not set."
  echo ""
  echo "  Obtené tu token en: https://dash.cloudflare.com/profile/api-tokens"
  echo "  Permisos necesarios: Zone:DNS:Edit para $ZONE_NAME"
  echo ""
  echo "  Luego ejecutá:"
  echo "    export CLOUDFLARE_API_TOKEN='tu-token'"
  echo "    bash scripts/setup-cloudflare-domain.sh"
  exit 1
fi

# Get Zone ID
ZONE_ID=$(cf_api GET \
  "https://api.cloudflare.com/client/v4/zones?name=$ZONE_NAME" | \
  grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$ZONE_ID" ]; then
  echo "❌ No se encontró la zona '$ZONE_NAME'."
  echo "   Verificá que el token tenga permisos Zone:Read."
  exit 1
fi

echo "✅ Zone ID: $ZONE_ID"
echo ""

# Process all records
ACTIVE_RECORDS=0
for record in "${DNS_RECORDS[@]}"; do
  # Skip comment lines and empty lines
  [[ "$record" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${record// }" ]] && continue

  IFS='|' read -r type name content proxied ttl <<< "$record"
  upsert_record "$type" "$name" "$content" "$proxied" "$ttl"
  ACTIVE_RECORDS=$((ACTIVE_RECORDS + 1))
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ $ACTIVE_RECORDS DNS records configured."
echo ""
echo "📋 Próximos pasos:"
echo ""
echo "  Vercel:"
echo "    Dashboard → sentinel → Settings → Domains → Add"
echo "    → sentinel.supersonics.cl"
echo ""
echo "  Clerk:"
echo "    Dashboard → Domains → seleccionar supersonics.cl → Verify"
echo "    → Esperar que los 5 registros pasen a 'verified'"
echo "    → Settings → Custom Domain → configurar sign-in URL"
echo "    → Actualizar NEXT_PUBLIC_CLERK_SIGN_IN_URL en Vercel/envs"
echo ""
echo "  DNS propagation: <5 min con Cloudflare"
echo "    Verificar: dig CNAME accounts.supersonics.cl"
echo "    Verificar: dig CNAME sentinel.supersonics.cl"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
