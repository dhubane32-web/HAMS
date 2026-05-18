#!/usr/bin/env bash
# Verify production serves current nav labels and build id (no auth required for build-id + JS scan).
set -euo pipefail

FRONTEND_URL="${FRONTEND_URL:-https://hams-frontend.vercel.app}"
FRONTEND_URL="${FRONTEND_URL%/}"

echo "=== HAMS production nav label verification ==="
echo "Frontend: $FRONTEND_URL"
echo ""

fail=0

echo -n "GET /build-id.txt ... "
BUILD_ID="$(curl -sf --max-time 25 "$FRONTEND_URL/build-id.txt" | tr -d '\n' || true)"
if [[ -z "$BUILD_ID" || "$BUILD_ID" == "dev" ]]; then
  echo "FAIL (missing or dev build id)"
  fail=1
else
  echo "OK ($BUILD_ID)"
fi

echo -n "GET /login (build meta) ... "
LOGIN_HTML="$(curl -sf --max-time 25 "$FRONTEND_URL/login" || true)"
if echo "$LOGIN_HTML" | grep -q 'hams-build-id'; then
  echo "OK (meta present)"
else
  echo "SKIP (meta on protected layout only)"
fi

echo -n "Scan deployed JS for nav labels ... "
# Collect a few main chunks from login page (public) — labels ship in client bundles.
CHUNK_URLS="$(echo "$LOGIN_HTML" | grep -oE '/_next/static/[^"'\'' ]+\.js' | head -8 | sed "s|^|$FRONTEND_URL|")"
FOUND_OPS=0
FOUND_MX=0
for url in $CHUNK_URLS; do
  BODY="$(curl -sf --max-time 25 "$url" 2>/dev/null || true)"
  echo "$BODY" | grep -q 'Flight Operations' && FOUND_OPS=1
  echo "$BODY" | grep -q 'Aircraft Maintenance' && FOUND_MX=1
done

if [[ "$FOUND_OPS" -eq 1 && "$FOUND_MX" -eq 1 ]]; then
  echo "OK"
elif [[ "$FOUND_OPS" -eq 1 ]]; then
  echo "PARTIAL (Flight Operations only — deploy may still be propagating)"
  fail=1
else
  echo "FAIL (labels not in scanned bundles — redeploy with build:production)"
  fail=1
fi

echo -n "Stale labels absent ... "
STALE=0
for url in $CHUNK_URLS; do
  BODY="$(curl -sf --max-time 25 "$url" 2>/dev/null || true)"
  echo "$BODY" | grep -q 'Flight & Operations' && STALE=1
  echo "$BODY" | grep -q 'Maintenance & Aircraft' && STALE=1
done
if [[ "$STALE" -eq 0 ]]; then
  echo "OK"
else
  echo "FAIL (old labels still in CDN bundles)"
  fail=1
fi

echo ""
if [[ "$fail" -eq 0 ]]; then
  echo "Verification passed."
  exit 0
fi
echo "Verification failed — run: cd frontend && npm run deploy:production"
exit 1
