#!/usr/bin/env bash
# HAMS disaster recovery — restore from encrypted backup (super-admin API).
# Requires: API_BASE, ADMIN_EMAIL, ADMIN_PASSWORD, BACKUP_LOG_ID
#
# Recommended DR flow:
#   1. Enable maintenance: HAMS_MAINTENANCE_MODE=true on Railway (health probes still pass)
#   2. DRY_RUN=true — simulate restore
#   3. DRY_RUN=false — execute restore after confirmation
#   4. Verify hardening + API smoke tests
#   5. Disable maintenance mode
#
# Rollback after bad deploy (no DB restore):
#   Railway → Deployments → Rollback | Vercel → Promote previous production build
set -euo pipefail

API_BASE="${API_BASE:-https://hams-backend-production.up.railway.app}"
ADMIN_EMAIL="${ADMIN_EMAIL:?Set ADMIN_EMAIL}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?Set ADMIN_PASSWORD}"
BACKUP_LOG_ID="${BACKUP_LOG_ID:?Set BACKUP_LOG_ID (from GET /api/system/backup/logs)}"
DRY_RUN="${DRY_RUN:-true}"
SKIP_MAINTENANCE_HINT="${SKIP_MAINTENANCE_HINT:-false}"

echo "=== HAMS disaster restore ==="
echo "API: $API_BASE"
echo "Backup log: $BACKUP_LOG_ID"
echo "Dry run: $DRY_RUN"
echo ""

if [[ "$SKIP_MAINTENANCE_HINT" != "true" && "$DRY_RUN" != "true" ]]; then
  echo "Before destructive restore, set on Railway:"
  echo "  HAMS_MAINTENANCE_MODE=true"
  echo "  HAMS_MAINTENANCE_MESSAGE=\"HAMS restore in progress\""
  echo ""
  read -r -p "Maintenance mode enabled on Railway? (y/N): " maint_ok
  if [[ "${maint_ok,,}" != "y" ]]; then
    echo "Enable maintenance mode first, then re-run."
    exit 1
  fi
fi

echo "Checking API readiness..."
if ! curl -sf --max-time 20 "$API_BASE/health/ready" >/dev/null; then
  echo "WARN: /health/ready failed — continue only if API is intentionally in maintenance."
fi

TOKEN=$(curl -sf --max-time 30 -X POST "$API_BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);console.log(j.token||j.accessToken||'');});")

if [[ -z "$TOKEN" ]]; then
  echo "Login failed — check credentials, maintenance mode (health must stay up), and API health."
  exit 1
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Simulating restore (no data written)..."
  curl -sf --max-time 120 -X POST "$API_BASE/api/system/backup/$BACKUP_LOG_ID/simulate-restore" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json'
  echo ""
  echo "Simulation complete."
  echo "Next: DRY_RUN=false BACKUP_LOG_ID=$BACKUP_LOG_ID $0"
  exit 0
fi

echo "WARNING: This will restore database and files from backup."
read -r -p "Type RESTORE to continue: " confirm
if [[ "$confirm" != "RESTORE" ]]; then
  echo "Aborted."
  exit 1
fi

curl -sf --max-time 600 -X POST "$API_BASE/api/system/backup/$BACKUP_LOG_ID/restore" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json'

echo ""
echo "Restore request submitted."
echo "Verify:"
echo "  bash scripts/verify-production-hardening.sh"
echo "  bash scripts/verify-production-api.sh   # with admin credentials"
echo "Then set HAMS_MAINTENANCE_MODE=false on Railway."
