#!/usr/bin/env bash
# Full logical backup of the HAMS Postgres database (no destructive operations).
# Writes a compressed custom-format dump suitable for pg_restore.
#
#   export DATABASE_URL=postgresql://user:pass@host:5432/hams
#   export BACKUP_OUT_DIR=/path/to/backups   # optional; default: ./backups
#   bash scripts/backup-postgres.sh
#
set -euo pipefail
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: Set DATABASE_URL." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${BACKUP_OUT_DIR:-$ROOT/backups}"
mkdir -p "$OUT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT/hams-pgdump-${STAMP}.dump"

echo "[backup] Writing $FILE (custom format, gzip-compressible via -Fc)..."
pg_dump "$DATABASE_URL" -Fc --no-owner --no-acl -f "$FILE"
ls -lh "$FILE"
echo "[backup] Done. Test restore on a scratch DB: pg_restore -l $FILE | head"
