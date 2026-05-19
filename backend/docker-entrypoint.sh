#!/bin/sh
# Boot: apply pending SQL migrations, then start API.
set -eu

if [ -n "${DATABASE_URL:-}" ] && [ "${HAMS_RUN_MIGRATIONS_ON_START:-true}" = "true" ]; then
  if [ -d "${HAMS_DATABASE_DIR:-/database}/migrations" ]; then
    echo "[boot] Applying database migrations…"
    if bash scripts/apply-pending-migrations.sh; then
      echo "[boot] Migrations complete."
    else
      echo "[boot] WARN: migrations script returned non-zero (continuing start)."
    fi
    if bash scripts/apply-occ-migrations.sh 2>/dev/null; then
      echo "[boot] OCC schema ensured."
    else
      echo "[boot] WARN: OCC migrations optional step failed."
    fi
  else
    echo "[boot] No ${HAMS_DATABASE_DIR:-/database}/migrations — skip auto-migrate (run manually)."
  fi
else
  echo "[boot] Migrations skipped (DATABASE_URL unset or HAMS_RUN_MIGRATIONS_ON_START=false)."
fi

exec node src/index.js
