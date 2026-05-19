#!/usr/bin/env bash
# Full PostgreSQL schema sync for Railway production (run from your machine).
# Requires: psql, DATABASE_URL from Railway → Postgres → Connect
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: export DATABASE_URL from Railway Postgres (Connect tab)." >&2
  exit 1
fi

echo "=== HAMS Railway production schema sync ==="
echo "Target: ${DATABASE_URL%%@*}@***"

echo ">>> 1. Numbered migrations (000–007)"
bash "$ROOT/backend/scripts/apply-pending-migrations.sh"

echo ">>> 2. OCC control center (full)"
bash "$ROOT/backend/scripts/apply-occ-migrations.sh"

echo ">>> 3. Schema verification"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'migrations' AS check, count(*)::text AS n FROM hams_schema_migrations;
SELECT 'eta_current_at' AS check,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'flights' AND column_name = 'eta_current_at'
  ) THEN 'OK' ELSE 'MISSING' END AS status;
SELECT 'commercial_notifications' AS check,
  CASE WHEN to_regclass('public.commercial_notifications') IS NOT NULL THEN 'OK' ELSE 'MISSING' END;
SELECT 'flight_ops_enterprise' AS check,
  CASE WHEN to_regclass('public.flight_schedules') IS NOT NULL THEN 'OK' ELSE 'MISSING' END;
SQL

if [[ "${SEED_DEMO:-}" == "1" ]] || [[ "${SEED_DEMO:-}" == "true" ]]; then
  echo ">>> 4. Demo seed (commercial + enterprise)"
  bash "$ROOT/backend/scripts/seed-commercial-phase2.sh"
  bash "$ROOT/backend/scripts/seed-flight-ops-enterprise.sh" 2>/dev/null || true
else
  echo ">>> 4. Skip demo seed (set SEED_DEMO=1 to run)"
fi

echo ""
echo "Schema sync complete."
echo "Next: Redeploy Railway with Root Directory = repo root (see railway.toml)."
echo "Then verify: BASE_URL=https://YOUR.up.railway.app bash $ROOT/scripts/verify-railway-production.sh"
