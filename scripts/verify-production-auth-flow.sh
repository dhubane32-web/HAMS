#!/usr/bin/env bash
# Production auth redirect + optional login flow (read-only except login POST).
set -euo pipefail

FRONTEND="${FRONTEND:-https://hams.hawanaairways.com}"
API_BASE="${API_BASE:-$FRONTEND}"
COOKIE_JAR="${COOKIE_JAR:-/tmp/hams-auth-verify-$$.cookies}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

pass=0
fail=0
skip=0

ok() { echo "  OK: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1"; fail=$((fail + 1)); }
skip_msg() { echo "  SKIP: $1"; skip=$((skip + 1)); }

cleanup() { rm -f "$COOKIE_JAR"; }
trap cleanup EXIT

echo "=== HAMS production auth flow ==="
echo "Frontend: $FRONTEND"
echo ""

echo "[1] GET / (expect 302/307 → /login or /dashboard)"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-redirs 0 "$FRONTEND/" || true)
loc=$(curl -sI --max-redirs 0 "$FRONTEND/" | tr -d '\r' | awk -F': ' 'tolower($1)=="location"{print $2}')
if [[ "$code" == "302" || "$code" == "307" ]] && [[ "$loc" == *"/login"* || "$loc" == *"/dashboard"* ]]; then
  ok "GET / → $code $loc"
else
  bad "GET / → HTTP $code (location: ${loc:-none}); expected redirect to /login or /dashboard"
fi

echo "[2] GET /login (expect 200)"
code=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND/login")
if [[ "$code" == "200" ]]; then ok "/login → 200"; else bad "/login → HTTP $code"; fi

echo "[3] GET /dashboard without session (expect redirect to /login)"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-redirs 0 "$FRONTEND/dashboard" || true)
loc=$(curl -sI --max-redirs 0 "$FRONTEND/dashboard" | tr -d '\r' | awk -F': ' 'tolower($1)=="location"{print $2}')
if [[ "$code" == "302" || "$code" == "307" ]] && [[ "$loc" == *"/login"* ]]; then
  ok "/dashboard unauthenticated → $code"
else
  bad "/dashboard unauthenticated → HTTP $code (location: ${loc:-none})"
fi

echo "[4] POST /api/auth/login"
if [[ -z "$ADMIN_EMAIL" || -z "$ADMIN_PASSWORD" ]]; then
  skip_msg "Set ADMIN_EMAIL and ADMIN_PASSWORD for automated login"
else
  login_body=$(curl -sf -X POST "$API_BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -c "$COOKIE_JAR" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 2>/dev/null) || login_body=""
  if [[ -z "$login_body" ]]; then
    bad "login POST failed"
  else
    token=$(node -e "try{const j=JSON.parse(process.argv[1]);process.stdout.write(j.token||'')}catch{}" "$login_body" 2>/dev/null || true)
    if [[ -n "$token" ]]; then
      ok "login returned token"
      # Ensure hams_token cookie for middleware (Set-Cookie from API + client mirror)
      if ! grep -q 'hams_token' "$COOKIE_JAR" 2>/dev/null; then
        echo "#HttpOnly_${FRONTEND#https://}" 0 path FALSE 0 hams_token "$token" 0 | sed 's/#HttpOnly_//' >>"$COOKIE_JAR" || true
        curl -s -o /dev/null "$FRONTEND/login" -b "hams_token=$token" -c "$COOKIE_JAR" || true
      fi
    else
      bad "login response missing token (2FA or password change?)"
    fi
  fi
fi

if [[ -f "$COOKIE_JAR" ]] && grep -q 'hams_token' "$COOKIE_JAR" 2>/dev/null; then
  echo "[5] GET /dashboard with session cookie"
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-redirs 0 -b "$COOKIE_JAR" "$FRONTEND/dashboard" || true)
  if [[ "$code" == "200" ]]; then ok "/dashboard authenticated → 200"; else bad "/dashboard authenticated → HTTP $code"; fi

  echo "[6] Refresh /dashboard (same cookie jar)"
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-redirs 0 -b "$COOKIE_JAR" "$FRONTEND/dashboard" || true)
  if [[ "$code" == "200" ]]; then ok "dashboard refresh → 200"; else bad "dashboard refresh → HTTP $code"; fi
else
  skip_msg "No session cookie — skip dashboard authenticated checks"
fi

echo "[7] build-id.txt"
build_id=$(curl -sf "$FRONTEND/build-id.txt" | tr -d '\n' || true)
if [[ -n "$build_id" ]]; then ok "build-id: $build_id"; else bad "could not fetch build-id.txt"; fi

echo ""
echo "Summary: $pass passed, $fail failed, $skip skipped"
[[ "$fail" -eq 0 ]]
