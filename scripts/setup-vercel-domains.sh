#!/usr/bin/env bash
# Setup Vercel domains for sentinel (dev / staging / prod)
# Requirements: vercel CLI installed and linked (`vercel link`), valid VERCEL_TOKEN
# Usage: bash scripts/setup-vercel-domains.sh
#
# Domain naming:
#   Production: sentinel-fleet.vercel.app
#   Staging:    sentinel-fleet-staging.vercel.app
#   Dev:        sentinel-fleet-dev.vercel.app
#
# Original sentinel*.vercel.app names were taken — sentinel-fleet* was verified
# available as of 2026-06-26.
#
# Production custom domain: sentinel.supersonics.cl (requires Cloudflare DNS config)
# supersonics.cl uses Cloudflare nameservers (serena.ns.cloudflare.com, yoxall.ns.cloudflare.com)
# Run scripts/setup-cloudflare-domain.sh to create the CNAME record

set -euo pipefail

PROD_DOMAIN="sentinel-fleet.vercel.app"
STAGING_DOMAIN="sentinel-fleet-staging.vercel.app"
DEV_DOMAIN="sentinel-fleet-dev.vercel.app"

echo "🌐 Setting up Vercel domains for sentinel..."
echo ""

if ! command -v vercel &> /dev/null; then
  echo "❌ vercel CLI not found. Install it with: npm install -g vercel"
  exit 1
fi

# Check if linked to Vercel
if [ ! -f ".vercel/project.json" ]; then
  echo "⚠️  Project not linked to Vercel. Run 'vercel link' first."
  exit 1
fi

PROJECT_NAME=$(cat .vercel/project.json | grep -o '"name":"[^"]*"' | cut -d'"' -f4)
echo "📦 Project: $PROJECT_NAME"
echo ""

# Add production domain
echo "🏭 Configuring production domain: $PROD_DOMAIN"
vercel domains add "$PROD_DOMAIN" --scope "$PROJECT_NAME" 2>/dev/null || \
  echo "⚠️  Could not add $PROD_DOMAIN via CLI. Configure it in Vercel dashboard: https://vercel.com/dashboard"
echo ""

# Add staging domain
echo "🧪 Configuring staging domain: $STAGING_DOMAIN"
vercel domains add "$STAGING_DOMAIN" --scope "$PROJECT_NAME" 2>/dev/null || \
  echo "⚠️  Could not add $STAGING_DOMAIN via CLI. Configure it in Vercel dashboard."
echo ""

# Add dev domain
echo "🔧 Configuring dev domain: $DEV_DOMAIN"
vercel domains add "$DEV_DOMAIN" --scope "$PROJECT_NAME" 2>/dev/null || \
  echo "⚠️  Could not add $DEV_DOMAIN via CLI. Configure it in Vercel dashboard."
echo ""

echo "✅ Domain setup attempted."
echo ""
echo "📋 Manual steps if CLI setup failed:"
echo "   1. Go to https://vercel.com/dashboard"
echo "   2. Select the sentinel project"
echo "   3. Settings → Domains → Add:"
echo "      - $PROD_DOMAIN (production)"
echo "      - $STAGING_DOMAIN (staging branch alias)"
echo "      - $DEV_DOMAIN (dev branch alias)"
echo "   4. For staging/dev: set up Git branch → domain mapping in project settings"
echo ""
echo "🔮 Production custom domain:"
echo "   sentinel.supersonics.cl (Cloudflare DNS → Vercel)"
echo "   To set it up:"
echo "     CLOUDFLARE_API_TOKEN='your-token' bash scripts/setup-cloudflare-domain.sh"
echo ""
echo "   Or manually: add the domain in Vercel, then add a CNAME record in Cloudflare:"
echo "     sentinel.supersonics.cl → cname.vercel-dns.com"
