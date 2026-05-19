#!/usr/bin/env bash
# Apply only Operations Control Center (OCC) schema — idempotent.
# Usage from repo root:  export DATABASE_URL=postgres://...  && bash backend/scripts/apply-occ-migrations.sh
set -euo pipefail
if [[ -n "${HAMS_DATABASE_DIR:-}" ]] && [[ -d "$HAMS_DATABASE_DIR" ]]; then
  DB_ROOT="${HAMS_DATABASE_DIR%/}"
else
  DB_ROOT="$(cd "$(dirname "$0")/../.." && pwd)/database"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL to your Postgres connection string, then re-run." >&2
  exit 1
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$DB_ROOT/occ_control_center.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$DB_ROOT/occ_control_center_v2.sql"
echo "OCC migrations applied (occ_control_center + occ_control_center_v2)."
