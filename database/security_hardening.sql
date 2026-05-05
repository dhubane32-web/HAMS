-- HAMS production security: account lockout, TOTP 2FA material (idempotent).
-- Apply: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/security_hardening.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS totp_secret_enc TEXT NULL,
  ADD COLUMN IF NOT EXISTS totp_pending_secret_enc TEXT NULL,
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users (locked_until) WHERE locked_until IS NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NULL;

UPDATE users SET password_changed_at = COALESCE(password_changed_at, updated_at, created_at, NOW())
WHERE password_changed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_last_activity ON users (last_activity_at DESC NULLS LAST);
