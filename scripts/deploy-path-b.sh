#!/usr/bin/env bash
# Non-interactive Path B deploy when tokens are set:
#   export RAILWAY_TOKEN=... VERCEL_TOKEN=...
#   bash scripts/deploy-path-b.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

: "${RAILWAY_TOKEN:?Set RAILWAY_TOKEN from https://railway.com/account/tokens}"
: "${VERCEL_TOKEN:?Set VERCEL_TOKEN from https://vercel.com/account/tokens}"

export RAILWAY_TOKEN VERCEL_TOKEN

echo ">>> Deploy backend (Railway)"
cd "$BACKEND"
npx --yes @railway/cli@4.5.0 up --detach

RAILWAY_URL="$(npx --yes @railway/cli@4.5.0 domain 2>/dev/null | head -1 | tr -d ' ')"
RAILWAY_URL="${RAILWAY_URL%/}"
[[ -n "$RAILWAY_URL" ]] || { echo "Generate Railway domain in dashboard, set RAILWAY_URL= and re-run."; exit 1; }
echo "Railway API: $RAILWAY_URL"

echo ">>> Verify Railway API"
API_BASE="$RAILWAY_URL" bash "$ROOT/scripts/verify-production-api.sh"

echo ">>> Vercel env + production deploy"
cd "$FRONTEND"
npx --yes vercel@41.4.0 link --yes --token "$VERCEL_TOKEN" 2>/dev/null || true
npx --yes vercel@41.4.0 env rm HAMS_BACKEND_INTERNAL_URL production --token "$VERCEL_TOKEN" -y 2>/dev/null || true
printf '%s' "$RAILWAY_URL" | npx --yes vercel@41.4.0 env add HAMS_BACKEND_INTERNAL_URL production --token "$VERCEL_TOKEN"
printf '%s' 'true' | npx --yes vercel@41.4.0 env add NEXT_PUBLIC_USE_API_PROXY production --token "$VERCEL_TOKEN" 2>/dev/null || \
  printf '%s' 'true' | npx --yes vercel@41.4.0 env add NEXT_PUBLIC_USE_API_PROXY production --token "$VERCEL_TOKEN" --force
printf '%s' '/api' | npx --yes vercel@41.4.0 env add NEXT_PUBLIC_API_URL production --token "$VERCEL_TOKEN" 2>/dev/null || true
printf '%s' 'https://hams-frontend.vercel.app' | npx --yes vercel@41.4.0 env add NEXT_PUBLIC_SITE_URL production --token "$VERCEL_TOKEN" 2>/dev/null || true
npx --yes vercel@41.4.0 --prod --force --token "$VERCEL_TOKEN"

echo ">>> Verify Vercel proxy"
API_BASE="https://hams-frontend.vercel.app" bash "$ROOT/scripts/verify-production-api.sh"
echo "Done. Login: https://hams-frontend.vercel.app/login"
