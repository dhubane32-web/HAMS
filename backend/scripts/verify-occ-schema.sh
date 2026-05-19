#!/usr/bin/env bash
# Verify OCC database objects required for the OCC Hub dashboard (read-only checks).
# Exit 0 if OK; non-zero if a prerequisite is missing.
#
#   export DATABASE_URL=postgresql://...
#   bash backend/scripts/verify-occ-schema.sh
#
set -euo pipefail
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: Set DATABASE_URL." >&2
  exit 1
fi

q() { psql "$DATABASE_URL" -Atq -c "$1"; }

echo "[occ-verify] flights.eta_current_at …"
[[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'flights' AND column_name = 'eta_current_at';")" == "1" ]] || {
  echo "FAIL: column flights.eta_current_at missing. Apply database/occ_control_center.sql" >&2
  exit 2
}

echo "[occ-verify] occ_duty_limit_config …"
[[ "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'occ_duty_limit_config';")" == "1" ]] || {
  echo "FAIL: table occ_duty_limit_config missing. Apply database/occ_control_center_v2.sql" >&2
  exit 3
}
[[ "$(q "SELECT count(*) FROM occ_duty_limit_config WHERE id = 1;")" == "1" ]] || {
  echo "FAIL: occ_duty_limit_config row id=1 missing. Re-run occ_control_center_v2.sql" >&2
  exit 4
}

echo "[occ-verify] occ_delay_code_ref …"
[[ "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'occ_delay_code_ref';")" == "1" ]] || {
  echo "FAIL: occ_delay_code_ref missing. Apply database/occ_control_center.sql" >&2
  exit 5
}

echo "[occ-verify] OK — OCC schema prerequisites present."
