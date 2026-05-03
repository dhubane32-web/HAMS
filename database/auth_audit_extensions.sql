-- Apply if login returns 500 (missing login_history or audit log columns).
-- psql "$DATABASE_URL" -f database/auth_audit_extensions.sql

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64),
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

CREATE TABLE IF NOT EXISTS login_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(150) NOT NULL,
  success BOOLEAN NOT NULL,
  ip_address VARCHAR(64),
  user_agent TEXT,
  reason VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_history_created ON login_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_email ON login_history(email);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(128),
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;
