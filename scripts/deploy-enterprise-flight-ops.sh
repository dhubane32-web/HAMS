#!/usr/bin/env bash
# Pre-deploy checks, migrations (Railway DATABASE_URL), seed, verify, push guidance.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Enterprise Flight Ops — deploy pipeline ==="

echo ">>> 1. Preflight"
node scripts/predeploy-check.mjs --target all 2>/dev/null || {
  echo "Running backend + frontend preflight separately..."
  (cd backend && NODE_ENV=production node scripts/railway-preflight.mjs)
  (cd frontend && NODE_ENV=production VERCEL=1 node scripts/vercel-preflight.mjs)
}

echo ">>> 2. Frontend production build"
(cd frontend && npm run build)

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo ">>> 3. Apply pending migrations"
  bash backend/scripts/apply-pending-migrations.sh
  echo ">>> 4. Seed enterprise demo data"
  bash backend/scripts/seed-flight-ops-enterprise.sh || true
else
  echo ">>> 3–4 SKIP migrations/seed (set DATABASE_URL for local/Railway DB)"
fi

if [[ -n "${BASE_URL:-}" ]] || curl -sf --max-time 3 http://127.0.0.1:5013/health/live >/dev/null 2>&1; then
  export BASE_URL="${BASE_URL:-http://127.0.0.1:5013}"
  echo ">>> 5. API verification against $BASE_URL"
  (cd backend && npm run test:operations)
  node backend/scripts/verify-flight-ops-enterprise.mjs
else
  echo ">>> 5 SKIP API verify (start backend or set BASE_URL)"
fi

echo ""
echo ">>> Deploy manually:"
echo "  git push origin main"
echo "  Railway: cd backend && railway up   (or GitHub deploy hook)"
echo "  Vercel:  cd frontend && vercel --prod"
echo "  On Railway Postgres: DATABASE_URL=... bash backend/scripts/apply-pending-migrations.sh"
echo "  Optional seed: bash backend/scripts/seed-flight-ops-enterprise.sh"
echo "  Smoke: FRONTEND=https://hams.hawanaairways.com bash scripts/verify-production-enterprise-ops.sh"
echo ""
echo "Done."
