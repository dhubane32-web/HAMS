#!/usr/bin/env bash
# Hawana Airways Phase 2 commercial demo seed (routes, fleet, PNRs, DCS, OCC).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL (Railway Postgres), then re-run." >&2
  exit 1
fi

echo ">>> Apply pending migrations"
bash "$ROOT/backend/scripts/apply-pending-migrations.sh"

echo ">>> Master data baseline"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/master_data.sql" 2>/dev/null || true
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/master_data_seed.sql"

echo ">>> Flight operations baseline"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/flight_operations.sql" 2>/dev/null || true
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/operations_seed_flights.sql" 2>/dev/null || true

echo ">>> Commercial phase 2 Hawana demo"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/seeds/commercial_phase2_hawana_demo.sql"

echo ">>> Optional: legacy booking/check-in seeds"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/booking_ticketing.sql" 2>/dev/null || true
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/booking_ticketing_seed.sql" 2>/dev/null || true
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/checkin_boarding_seed.sql" 2>/dev/null || true

echo "Done. Demo PNRs: HW9K2M (MGQ-NBO, checked-in), HW4R7N (GGR return), HW8P1C (refund)."
echo "Flights: HW301–HW305 | Admin: admin@hawanaairways.com"
