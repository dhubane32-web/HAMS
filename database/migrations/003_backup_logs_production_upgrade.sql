-- Production-safe backup log upgrades for retention, encryption, and offsite metadata.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/003_backup_logs_production_upgrade.sql

ALTER TABLE backup_logs ADD COLUMN IF NOT EXISTS backup_tier VARCHAR(20) NOT NULL DEFAULT 'daily';
ALTER TABLE backup_logs ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE backup_logs ADD COLUMN IF NOT EXISTS checksum_sha256 VARCHAR(128);
ALTER TABLE backup_logs ADD COLUMN IF NOT EXISTS offsite_provider VARCHAR(20);
ALTER TABLE backup_logs ADD COLUMN IF NOT EXISTS offsite_status VARCHAR(40) NOT NULL DEFAULT 'not_configured';
ALTER TABLE backup_logs ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE backup_logs ADD COLUMN IF NOT EXISTS last_downloaded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_backup_logs_tier_created ON backup_logs (backup_tier, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_logs_status_created ON backup_logs (status, created_at DESC);
