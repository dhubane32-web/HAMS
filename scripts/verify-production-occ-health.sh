#!/usr/bin/env bash
# Production OCC + API connectivity report for hams.hawanaairways.com
set -euo pipefail

FRONTEND="${FRONTEND:-https://hams.hawanaairways.com}"
FRONTEND="${FRONTEND%/}"

echo "=== HAMS production OCC health report ==="
echo "Frontend: $FRONTEND"
echo ""

fail=0

check() {
  local name="$1"
  local url="$2"
  local expect="$3"
  echo -n "$name ... "
  body="$(curl -sf --max-time 25 "$url" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    echo "FAIL (no response)"
    fail=1
    return
  fi
  if echo "$body" | grep -q "$expect"; then
    echo "OK"
    echo "  $(echo "$body" | head -c 120)"
  else
    echo "FAIL (unexpected body)"
    echo "  $(echo "$body" | head -c 200)"
    fail=1
  fi
}

check "build-id" "$FRONTEND/build-id.txt" ""
check "/api/health" "$FRONTEND/api/health" '"ok":true'
check "/api/occ/status" "$FRONTEND/api/occ/status" '"status":"healthy"'

echo -n "build-id is current (not 5848f0b) ... "
bid="$(curl -sf --max-time 15 "$FRONTEND/build-id.txt" | tr -d '\n')"
if [[ "$bid" == *5848f0b* ]]; then
  echo "FAIL (stale build $bid)"
  fail=1
else
  echo "OK ($bid)"
fi

echo ""
if [[ "$fail" -eq 0 ]]; then
  echo "All production connectivity checks passed."
  exit 0
fi
echo "Some checks failed — verify Vercel HAMS_BACKEND_INTERNAL_URL and Railway deploy."
exit 1
