#!/usr/bin/env bash
# Apply idempotent SQL fixes when dashboards fail (missing md_* tables, login_history, audit columns).
# Usage from repo root:  export DATABASE_URL=postgres://...   && bash backend/scripts/apply-db-fixes.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL to your Postgres connection string, then re-run." >&2
  exit 1
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/auth_audit_extensions.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/auth_hawana_admin.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/master_data.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/master_data_seed.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/crew_management.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/flight_operations.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/operations_seed_flights.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/crew_seed_sample.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/booking_ticketing.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/booking_ticketing_seed.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/checkin_boarding.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/checkin_boarding_module.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/checkin_boarding_seed.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/finance_accounting.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/finance_seed_sample.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/customer_service.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/customer_service_seed.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/sales_marketing.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/sales_marketing_seed.sql"
echo "Done. Restart the backend if it was running."
