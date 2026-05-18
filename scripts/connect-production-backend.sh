#!/usr/bin/env bash
# Wire Railway API → Vercel hams-frontend (run on your machine after Railway /health works).
#
#   export VERCEL_TOKEN=...   # https://vercel.com/account/tokens
#   bash scripts/connect-production-backend.sh https://YOUR-SERVICE.up.railway.app
#
set -euo pipefail

RAILWAY_URL="${1:?Usage: $0 https://YOUR-SERVICE.up.railway.app}"
RAILWAY_URL="${RAILWAY_URL%/}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$ROOT/frontend"

: "${VERCEL_TOKEN:?Set VERCEL_TOKEN from https://vercel.com/account/tokens}"

echo ">>> 1. Verify Railway API"
curl -sf "${RAILWAY_URL}/health" | grep -q '"ok":true' || {
  echo "FAIL: ${RAILWAY_URL}/health did not return ok:true"
  exit 1
}
echo "OK: Railway /health"

echo ">>> 2. Optional: reset login user on Railway DB"
if [[ -n "${DATABASE_URL:-}" ]]; then
  EMAIL="${HAMS_LOGIN_EMAIL:-abdifatah@hawanaairways.com}"
  PASS="${HAMS_ADMIN_PASSWORD:-Hawana@2026}"
  DATABASE_URL="$DATABASE_URL" node "$ROOT/backend/scripts/reset-hawana-admin-password.mjs" \
    --email "$EMAIL" --password "$PASS" || true
fi

echo ">>> 3. Vercel Production env (hams-frontend)"
cd "$FRONTEND"
export VERCEL_TOKEN

for name in HAMS_BACKEND_INTERNAL_URL NEXT_PUBLIC_USE_API_PROXY NEXT_PUBLIC_API_URL; do
  npx --yes vercel@41.4.0 env rm "$name" production --token "$VERCEL_TOKEN" -y 2>/dev/null || true
done

printf '%s' "$RAILWAY_URL" | npx --yes vercel@41.4.0 env add HAMS_BACKEND_INTERNAL_URL production --token "$VERCEL_TOKEN"
printf '%s' 'true' | npx --yes vercel@41.4.0 env add NEXT_PUBLIC_USE_API_PROXY production --token "$VERCEL_TOKEN"
printf '%s' '/api' | npx --yes vercel@41.4.0 env add NEXT_PUBLIC_API_URL production --token "$VERCEL_TOKEN"

echo ">>> 4. Redeploy Production (clear cache)"
npx --yes vercel@41.4.0 --prod --force --token "$VERCEL_TOKEN"

echo ">>> 5. Wait and verify"
sleep 90
API_BASE="${FRONTEND_URL:-https://hams-frontend.vercel.app}" bash "$ROOT/scripts/verify-production-api.sh" || true

echo "Done. Test login at https://hams.hawanaairways.com/login"
