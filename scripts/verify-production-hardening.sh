#!/usr/bin/env bash
# Verify production hardening endpoints (read-only).
set -euo pipefail

API_BASE="${API_BASE:-https://hams-backend-production.up.railway.app}"
FRONTEND="${FRONTEND:-https://hams-frontend.vercel.app}"

echo "=== HAMS production hardening checks ==="
echo "Backend: $API_BASE"
echo "Frontend: $FRONTEND"
echo ""

check_json() {
  local label="$1"
  local url="$2"
  local optional="${3:-}"
  echo -n "$label ... "
  if ! body=$(curl -sf --max-time 20 "$url"); then
    if [[ "$optional" == "optional" ]]; then
      echo "SKIP (not deployed yet)"
      return 0
    fi
    echo "FAIL"
    return 1
  fi
  echo "OK"
  echo "$body" | head -c 200
  echo ""
}

check_json "GET /health/live" "$API_BASE/health/live" optional
check_json "GET /live" "$API_BASE/live" optional
check_json "GET /health/ready" "$API_BASE/health/ready" optional
check_json "GET /ready" "$API_BASE/ready" optional
check_json "GET /health (full)" "$API_BASE/health"
check_json "GET frontend /health (proxy)" "$FRONTEND/health" optional

echo "Done."
