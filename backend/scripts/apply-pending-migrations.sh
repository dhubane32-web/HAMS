#!/usr/bin/env bash
# Apply numbered SQL migrations under database/migrations/ exactly once per database.
# Safe for production: skips already-recorded versions; each file is run with ON_ERROR_STOP.
#
# Usage from repo root:
#   export DATABASE_URL=postgres://...
#   bash backend/scripts/apply-pending-migrations.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL, then re-run." >&2
  exit 1
fi

MIG_DIR="$ROOT/database/migrations"
BOOT="$MIG_DIR/000_schema_migrations_bootstrap.sql"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$BOOT"

is_applied() {
  local ver="$1"
  psql "$DATABASE_URL" -Atq -c "SELECT 1 FROM hams_schema_migrations WHERE version = '${ver//\'/\'\'}' LIMIT 1;" | grep -q '^1$'
}

record_applied() {
  local ver="$1"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO hams_schema_migrations (version) VALUES ('${ver//\'/\'\'}');"
}

if ! is_applied "000_schema_migrations_bootstrap.sql"; then
  record_applied "000_schema_migrations_bootstrap.sql"
fi

shopt -s nullglob
for f in "$MIG_DIR"/[0-9][0-9][0-9]_*.sql; do
  base=$(basename "$f")
  [[ "$base" == "000_schema_migrations_bootstrap.sql" ]] && continue
  if is_applied "$base"; then
    echo "[migrations] skip $base"
    continue
  fi
  echo "[migrations] apply $base"
  if [[ "$base" == "005_flight_ops_enterprise.sql" ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/flight_ops_enterprise.sql"
  elif [[ "$base" == "006_commercial_core_phase2.sql" ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/commercial_core_phase2.sql"
  else
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
  fi
  record_applied "$base"
  echo "[migrations] recorded $base"
done

echo "[migrations] done."
