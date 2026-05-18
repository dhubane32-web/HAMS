#!/usr/bin/env bash
# Deep production backend connectivity diagnostics (read-only).
set -euo pipefail

FRONTEND="${FRONTEND:-https://hams-frontend.vercel.app}"
CUSTOM="${CUSTOM:-https://hams.hawanaairways.com}"
LEGACY_API="${LEGACY_API:-https://api.hawanaairways.com}"

echo "=== HAMS production backend diagnostics ==="
echo "Frontend: $FRONTEND"
echo ""

check_url() {
  local label="$1"
  local url="$2"
  local extra="${3:-}"
  echo "--- $label"
  echo "    URL: $url"
  if ! out=$(curl -sS -w "\n__HTTP__%{http_code}" --max-time 15 $extra "$url" 2>&1); then
    echo "    FAIL: $out"
    return 1
  fi
  code=$(echo "$out" | sed -n 's/.*__HTTP__//p')
  body=$(echo "$out" | sed '/__HTTP__/d' | head -c 200)
  echo "    HTTP: $code"
  echo "    Body: $body"
  echo ""
}

echo "=== DNS ==="
for h in api.hawanaairways.com hams.hawanaairways.com; do
  echo -n "  $h → "
  dig +short "$h" 2>/dev/null | tr '\n' ' ' || echo "lookup failed"
  echo ""
done
echo ""

check_url "Vercel /health (proxy)" "$FRONTEND/health" || true
echo "--- Vercel POST login (proxy)"
echo "    URL: $FRONTEND/api/auth/login"
if ! out=$(curl -sS -w "\n__HTTP__%{http_code}" --max-time 15 -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hawanaairways.com","password":"Hawana@2026"}' \
  "$FRONTEND/api/auth/login" 2>&1); then
  echo "    FAIL: $out"
else
  code=$(echo "$out" | sed -n 's/.*__HTTP__//p')
  body=$(echo "$out" | sed '/__HTTP__/d' | head -c 200)
  echo "    HTTP: $code"
  echo "    Body: $body"
fi
echo ""
check_url "Custom domain /health" "$CUSTOM/health" || true
check_url "Legacy api.hawanaairways.com /health" "$LEGACY_API/health" || true

echo "=== Interpretation ==="
echo "• 503 'API backend not configured' → set HAMS_BACKEND_INTERNAL_URL on Vercel (Production)."
echo "• 502 with api.hawanaairways.com → remove dead URL; use https://YOUR-SERVICE.up.railway.app"
echo "• 307 to /login on /health → redeploy frontend with latest middleware from main"
echo "• Railway /health must return {\"ok\":true,\"service\":\"HAMS backend\"} before login works"
echo ""
echo "Vercel Production env (Path B):"
echo "  HAMS_BACKEND_INTERNAL_URL=https://<railway>.up.railway.app"
echo "  NEXT_PUBLIC_USE_API_PROXY=true"
echo "  NEXT_PUBLIC_API_URL=/api"
