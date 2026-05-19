#!/usr/bin/env bash
# Production smoke: enterprise flight ops via Vercel proxy.
set -euo pipefail

FRONTEND="${FRONTEND:-https://hams.hawanaairways.com}"
FRONTEND="${FRONTEND%/}"
EMAIL="${EMAIL:-admin@hawanaairways.com}"
PASSWORD="${PASSWORD:-Admin123!}"

fail=0
ok() { echo "OK $*"; }
bad() { echo "FAIL $*"; fail=1; }

echo "=== Production Enterprise Flight Ops smoke ==="
echo "Frontend: $FRONTEND"

health="$(curl -sf --max-time 25 "$FRONTEND/api/health" || true)"
if echo "$health" | grep -q '"ok":true'; then ok "/api/health"; else bad "/api/health"; fi

ent_health="$(curl -sf --max-time 25 "$FRONTEND/api/operations/enterprise/health" || true)"
if echo "$ent_health" | grep -q 'flight-ops-enterprise'; then ok "/api/operations/enterprise/health"; else bad "/api/operations/enterprise/health (Railway deploy + migrations?)"; fi

login="$(curl -sf --max-time 25 -X POST "$FRONTEND/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" || true)"
token="$(echo "$login" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{console.log(JSON.parse(s).token||'')}catch{}})" 2>/dev/null || true)"
if [[ -z "$token" ]]; then
  bad "login"
else
  ok "login"
  today="$(date -u +%Y-%m-%d)"
  feed="$(curl -sf --max-time 25 "$FRONTEND/api/operations/enterprise/feed?date=$today" \
    -H "Authorization: Bearer $token" || true)"
  if echo "$feed" | grep -q '"flights"'; then
    ok "enterprise feed"
  elif echo "$feed" | grep -q 'schema not applied'; then
    bad "enterprise feed — run migration 005 on Railway Postgres"
  else
    bad "enterprise feed"
  fi

  occ="$(curl -sf --max-time 25 "$FRONTEND/api/operations/occ/dashboard?date=$today" \
    -H "Authorization: Bearer $token" || true)"
  if echo "$occ" | grep -q '"enterprise"'; then ok "occ dashboard enterprise pulse"; else bad "occ enterprise pulse"; fi
fi

echo ""
if [[ "$fail" -eq 0 ]]; then
  echo "Enterprise ops production smoke passed."
  exit 0
fi
echo "Fix failures above, then redeploy Railway + Vercel."
exit 1
