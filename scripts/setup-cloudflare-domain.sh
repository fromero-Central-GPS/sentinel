#!/usr/bin/env bash
# Setup Cloudflare DNS records for Sentinel: Vercel domain + Clerk auth DNS
# Requirements: CLOUDFLARE_API_TOKEN env var
# Usage:
#   export CLOUDFLARE_API_TOKEN='your-token-here'
#   bash scripts/setup-cloudflare-domain.sh
#
# centralgps.cl uses Cloudflare nameservers:
#   gwen.ns.cloudflare.com
#   dale.ns.cloudflare.com

set -euo pipefail

# ─── Config ────────────────────────────────────────────────────────────

ZONE_NAME="centralgps.cl"

# Each record: "TYPE|NAME|CONTENT|PROXIED|TTL"
# PROXIED: true for CDN/proxied, false for CNAME redirects (Vercel, Clerk)
# TTL: 1 = Auto

DNS_RECORDS=(
  # ── Vercel deploy domain ─────────────────────────────────────────────
  "CNAME|sentinel|${SENTINEL_VERCEL_TARGET:-cname.vercel-dns.com}|false|1"

  # ── Clerk Authentication DNS ─────────────────────────────────────────
  #
  # Clerk necesita un CNAME para el dominio de sign-in personalizado.
  # PASOS para obtener el target:
  #   1. Ir a Clerk Dashboard → Domains
  #      https://dashboard.clerk.com → tu app → Domains
  #   2. Add Domain → ingresar "accounts.centralgps.cl"
  #   3. Clerk te mostrará el CNAME target exacto (algo como:
  #      "abcdef.clerk.services" o "clerk.xxx.com")
  #   4. Copiá ese target acá abajo:
  #
  # Descomentá y reemplazá <clerk-cname-target> con el valor real:
  # "CNAME|accounts|<clerk-cname-target>|false|1"

  # ── Clerk Email Service (opcional) ───────────────────────────────────
  #
  # Si querés que los emails de Clerk (magic links, invites, etc.)
  # vengan de un dominio propio (@centralgps.cl), Clerk te da un
  # CNAME de email tracking. Pasos:
  #   1. Clerk Dashboard → Email → Custom domain
  #   2. Clerk te da uno o más TXT/CNAME records
  #   3. Agregalos acá:
  #
  # "TXT|mail|v=spf1 include:spf.clerk.services ~all|false|1"
  # "CNAME|email|mail.clerk.services|false|1"
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

# Check which Clerk records are still commented out
if grep -q '<clerk-cname-target>' "$0"; then
  echo "⚠️  Clerk DNS records aún NO están configurados."
  echo ""
  echo "   Para activar el dominio de autenticación de Clerk:"
  echo "   1. Ir a Clerk Dashboard → Domains"
  echo "      https://dashboard.clerk.com"
  echo "   2. Agregar dominio: accounts.centralgps.cl"
  echo "   3. Clerk te dará un CNAME target exacto"
  echo "   4. Editar este script y reemplazar <clerk-cname-target>"
  echo "      con el valor que Clerk te mostró"
  echo "   5. Volver a ejecutar:"
  echo "      export CLOUDFLARE_API_TOKEN='tu-token'"
  echo "      bash scripts/setup-cloudflare-domain.sh"
  echo ""
fi

echo "📋 Próximos pasos:"
echo ""
echo "  Vercel:"
echo "    Dashboard → sentinel → Settings → Domains → Add"
echo "    → sentinel.centralgps.cl"
echo ""
echo "  Clerk (cuando los DNS estén listos):"
echo "    Dashboard → Domains → verificar que el dominio esté activo"
echo "    → Settings → Custom Domain → configurar sign-in URL"
echo "    → Actualizar NEXT_PUBLIC_CLERK_SIGN_IN_URL en Vercel/envs"
echo ""
echo "  DNS propagation: <5 min con Cloudflare"
echo "    Verificar: dig CNAME sentinel.centralgps.cl"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
