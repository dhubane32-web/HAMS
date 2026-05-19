#!/usr/bin/env bash
# Deploy Phase 2 Commercial Core: migrations, seed, verify, push guidance.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Phase 2 Commercial — production deploy ==="

echo ">>> Frontend build"
(cd frontend && npm run build)

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo ">>> Migrations + Hawana commercial seed"
  bash backend/scripts/seed-commercial-phase2.sh
else
  echo ">>> SKIP DB (set DATABASE_URL for Railway Postgres)"
fi

if [[ -n "${BASE_URL:-}" ]] || curl -sf --max-time 3 http://127.0.0.1:5013/api/health >/dev/null 2>&1; then
  export BASE_URL="${BASE_URL:-http://127.0.0.1:5013}"
  echo ">>> API verification"
  (cd backend && npm run test:commercial)
  node scripts/verify-commercial-e2e-flow.mjs
else
  echo ">>> SKIP API verify (set BASE_URL or start backend)"
fi

echo ""
echo ">>> Production:"
echo "  git push origin main"
echo "  Railway: redeploy backend | run seed on Postgres:"
echo "    DATABASE_URL=... bash backend/scripts/seed-commercial-phase2.sh"
echo "  Vercel: redeploy frontend"
echo "  Smoke: FRONTEND=https://hams.hawanaairways.com EMAIL=... PASSWORD=... bash -c '"
echo "    BASE_URL=\$FRONTEND node scripts/verify-commercial-e2e-flow.mjs'"
echo ""
echo "Demo: PNR HW9K2M | Flights HW301–305 | admin@hawanaairways.com"
