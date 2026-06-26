#!/usr/bin/env bash
# Setup Vercel environment variables for sentinel (dev / staging / prod)
# Requirements: vercel CLI installed and linked (`vercel link`)
# Usage: bash scripts/setup-vercel-envs.sh

set -euo pipefail

echo "🔐 Setting up Vercel environment variables for sentinel..."
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

# Production env vars (main branch)
echo "📦 Setting production environment variables..."
vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production <<< "" 2>/dev/null || true
vercel env add CLERK_SECRET_KEY production <<< "" 2>/dev/null || true
vercel env add DATABASE_URL production <<< "" 2>/dev/null || true
vercel env add NEXT_PUBLIC_APP_URL production <<< "" 2>/dev/null || true

# Preview env vars (staging + PR previews)
echo "📦 Setting preview environment variables..."
vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY preview <<< "" 2>/dev/null || true
vercel env add CLERK_SECRET_KEY preview <<< "" 2>/dev/null || true
vercel env add DATABASE_URL preview <<< "" 2>/dev/null || true
vercel env add NEXT_PUBLIC_APP_URL preview <<< "" 2>/dev/null || true

# Development env vars (local dev)
echo "📦 Setting development environment variables..."
vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY development <<< "" 2>/dev/null || true
vercel env add CLERK_SECRET_KEY development <<< "" 2>/dev/null || true
vercel env add DATABASE_URL development <<< "" 2>/dev/null || true
vercel env add NEXT_PUBLIC_APP_URL development <<< "" 2>/dev/null || true

echo ""
echo "✅ Environment variable slots created in Vercel."
echo ""
echo "⚠️  You must set the actual values in the Vercel dashboard:"
echo "   https://vercel.com/dashboard"
echo ""
echo "  Required vars per environment:"
echo "   - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  (Clerk publishable key)"
echo "   - CLERK_SECRET_KEY                   (Clerk secret key)"
echo "   - DATABASE_URL                       (Neon connection string for that environment's branch)"
echo "   - NEXT_PUBLIC_APP_URL                (https://sentinel-fleet.vercel.app for production, https://sentinel-fleet-staging.vercel.app for staging, https://sentinel-fleet-dev.vercel.app for dev)"
echo ""
echo "  Or use vercel CLI to set values:"
echo "   vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production"
