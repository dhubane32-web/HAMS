#!/usr/bin/env bash
# Seed enterprise flight ops demo data (schedules, flights, dispatch, turnaround, alerts).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL, then re-run." >&2
  exit 1
fi
echo "[seed] operations base flights (if needed)..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/operations_seed_flights.sql" 2>/dev/null || true
echo "[seed] enterprise flight ops demo..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/seeds/flight_ops_enterprise_demo.sql"
echo "[seed] rebuild rotations for UTC today..."
TODAY="$(date -u +%Y-%m-%d)"
node -e "
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rebuildRotations } = await import('../src/services/flightOpsEnterpriseService.js');
await rebuildRotations('$TODAY', null, null);
await pool.end();
console.log('[seed] rotations rebuilt for $TODAY');
" 2>/dev/null || echo "[seed] skip rotation rebuild (run via API after deploy)"
echo "[seed] done."
