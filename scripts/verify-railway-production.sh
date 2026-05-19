#!/usr/bin/env bash
# Verify Railway backend routes after redeploy + migrations.
set -euo pipefail
API_BASE="${API_BASE:-https://hams-backend-production.up.railway.app}"
API_BASE="${API_BASE%/}"
EMAIL="${EMAIL:-admin@hawanaairways.com}"
PASSWORD="${PASSWORD:-}"

fail=0
ok() { echo "OK  $*"; }
bad() { echo "FAIL $*"; fail=1; }

echo "=== Railway production API verify ==="
echo "API_BASE=$API_BASE"

h=$(curl -sf --max-time 20 "$API_BASE/api/health" || true)
echo "$h" | grep -q '"ok":true' && ok "/api/health" || bad "/api/health"

live=$(curl -sf --max-time 20 "$API_BASE/health/live" || true)
if echo "$live" | grep -q '"ok"'; then ok "/health/live"; else
  h2=$(curl -sf --max-time 20 "$API_BASE/health" || true)
  echo "$h2" | grep -q '"ok"' && ok "/health (live alias)" || bad "/health/live"
fi

comm=$(curl -sf --max-time 20 "$API_BASE/api/commercial/health" || true)
echo "$comm" | grep -q 'commercial-core' && ok "/api/commercial/health" || bad "/api/commercial/health (redeploy + migrations?)"

ent=$(curl -sf --max-time 20 "$API_BASE/api/operations/enterprise/health" || true)
echo "$ent" | grep -q 'flight-ops-enterprise' && ok "/api/operations/enterprise/health" || bad "/api/operations/enterprise/health"

occ=$(curl -sf --max-time 20 "$API_BASE/api/occ/status" || true)
echo "$occ" | grep -q 'OCC' && ok "/api/occ/status" || bad "/api/occ/status"

if [[ -z "$PASSWORD" ]]; then
  echo "SKIP auth tests (set PASSWORD)"
else
  login=$(curl -sf --max-time 25 -X POST "$API_BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" || true)
  token=$(echo "$login" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{console.log(JSON.parse(s).token||'')}catch{}})" 2>/dev/null || true)
  if [[ -z "$token" ]]; then
    bad "login"
  else
    ok "login"
    today=$(date -u +%Y-%m-%d)
    dash=$(curl -sf --max-time 25 "$API_BASE/api/operations/occ/dashboard?date=$today" \
      -H "Authorization: Bearer $token" || true)
    if echo "$dash" | grep -q '"flights"'; then ok "OCC dashboard"; else bad "OCC dashboard ($(echo "$dash" | head -c 120))"; fi
    feed=$(curl -sf --max-time 25 "$API_BASE/api/operations/enterprise/feed?date=$today" \
      -H "Authorization: Bearer $token" || true)
    echo "$feed" | grep -q '"flights"' && ok "enterprise feed" || bad "enterprise feed"
  fi
fi

echo ""
[[ "$fail" -eq 0 ]] && echo "Railway backend verification passed." || echo "Fix failures, then redeploy."
exit "$fail"
