# Phase 1 Backup System

This backup system is implemented under system administration APIs (`/api/system/backup/*`) and the System Administration frontend backup tab.

## Included Artifacts

- Database SQL dump (`pg_dump`)
- Uploads directory archive (`tar.gz`)
- Ticket PDF cache archive (`tar.gz`)
- Reports artifact archive (`tar.gz`)

Missing directories are skipped safely.

## Environment Variables

- `BACKUP_ROOT_DIR` (default: `backend/var/backups`)
- `BACKUP_UPLOADS_DIR` (default: `backend/uploads`)
- `BACKUP_TICKET_PDF_DIR` (default: `backend/var/eticket-pdf-cache`)
- `BACKUP_REPORTS_DIR` (default: `backend/var/reports`)
- `BACKUP_SCHEDULER_ENABLED` (default: `true`)
- `BACKUP_DAILY_HOUR_UTC` (default: `2`)
- `BACKUP_DAILY_MINUTE_UTC` (default: `0`)
- `BACKUP_WEEKLY_HOUR_UTC` (default: `2`)
- `BACKUP_WEEKLY_MINUTE_UTC` (default: `15`) // Sunday
- `BACKUP_MONTHLY_HOUR_UTC` (default: `2`)
- `BACKUP_MONTHLY_MINUTE_UTC` (default: `30`) // Day 1
- `BACKUP_RESTORE_OVERWRITE` (default: `false`)
- `BACKUP_ENCRYPTION_KEY` (required in production; AES-256 key material)
- `BACKUP_KEEP_PLAINTEXT` (default: `false`)
- `BACKUP_OFFSITE_PROVIDER` (`none` | `s3` | `gcs` | `r2`, default: `none`)
- `BACKUP_OFFSITE_DRY_RUN` (default: `true`)
- `BACKUP_OFFSITE_BUCKET` (required for offsite)
- `BACKUP_OFFSITE_ENDPOINT` (required for `r2`)

## API Endpoints

- `POST /api/system/backup/now` - run full backup now.
- `GET /api/system/backup/history` - paginated backup log entries.
- `GET /api/system/backup/download/:id` - download a specific backup artifact.
- `POST /api/system/backup/restore/:id` - restore a specific backup artifact.
- `POST /api/system/backup/restore-simulate/:id` - non-destructive restore test.
- `POST /api/system/backup/cleanup` - run retention cleanup immediately.
- `GET /api/system/backup/health` - dashboard health and provider status.

All endpoints require authenticated admin access (`admin` or `super_admin`) via existing system administration guards.
