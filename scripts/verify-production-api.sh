#!/usr/bin/env bash
# Verify production API + login (read-only). Usage:
#   API_BASE=https://api.hawanaairways.com bash scripts/verify-production-api.sh
#   API_BASE=https://hams-frontend.vercel.app NEXT_PUBLIC_USE_API_PROXY=true bash scripts/verify-production-api.sh

set -euo pipefail

API_BASE="${API_BASE:-https://api.hawanaairways.com}"
ORIGIN="${ORIGIN:-https://hams-frontend.vercel.app}"
EMAIL="${EMAIL:-${HAMS_LOGIN_EMAIL:-abdifatah@hawanaairways.com}}"
PASSWORD="${PASSWORD:-Hawana@2026}"

API_BASE="${API_BASE%/}"
fail=0

echo "[verify] API_BASE=$API_BASE"
echo "[verify] Origin header=$ORIGIN"

health_code="$(curl -sS -o /tmp/hams-health.json -w "%{http_code}" --max-time 15 "${API_BASE}/health" 2>/dev/null || echo 000)"
if [[ "$health_code" == "307" ]] || [[ "$health_code" == "302" ]]; then
  echo "[verify] FAIL: GET ${API_BASE}/health → HTTP ${health_code} (middleware auth redirect — deploy latest frontend/middleware.ts + redeploy Vercel)" >&2
  fail=1
elif [[ "$health_code" != "200" ]]; then
  echo "[verify] FAIL: GET ${API_BASE}/health → HTTP ${health_code}" >&2
  head -c 200 /tmp/hams-health.json 2>/dev/null >&2
  fail=1
else
  echo "[verify] OK: /health"
fi

login_body=$(curl -sf --max-time 20 -X POST "${API_BASE}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -H "Origin: ${ORIGIN}" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" 2>/dev/null) || true

if [[ -z "$login_body" ]] || ! echo "$login_body" | grep -q '"token"'; then
  echo "[verify] FAIL: POST /api/auth/login (no token in response)" >&2
  echo "$login_body" | head -c 300 >&2
  fail=1
else
  echo "[verify] OK: /api/auth/login returned token"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "[verify] See docs/API_PRODUCTION_AUTH_FIX.md" >&2
  exit 1
fi
echo "[verify] Production API auth checks passed."
