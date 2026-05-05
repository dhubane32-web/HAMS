-- System administration: roles, permissions, login history, settings, audit extensions.
-- Run after schema.sql (and after master_data.sql if you use md_role_definitions).

-- New user_role enum values (idempotent for PostgreSQL)
DO $$ BEGIN ALTER TYPE user_role ADD VALUE 'super_admin';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE user_role ADD VALUE 'customer_service';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE user_role ADD VALUE 'sales_manager';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(128),
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;

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

CREATE TABLE IF NOT EXISTS sys_permissions (
  code VARCHAR(80) PRIMARY KEY,
  description VARCHAR(240) NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_role_permissions (
  role user_role NOT NULL,
  permission_code VARCHAR(80) NOT NULL REFERENCES sys_permissions(code) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role, permission_code)
);

CREATE INDEX IF NOT EXISTS idx_sys_role_permissions_role ON sys_role_permissions(role);

CREATE TABLE IF NOT EXISTS system_settings (
  category VARCHAR(40) NOT NULL,
  setting_key VARCHAR(80) NOT NULL,
  value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (category, setting_key)
);

CREATE TABLE IF NOT EXISTS backup_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  backup_type VARCHAR(40) NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'success',
  backup_tier VARCHAR(20) NOT NULL DEFAULT 'daily',
  is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  checksum_sha256 VARCHAR(128),
  offsite_provider VARCHAR(20),
  offsite_status VARCHAR(40) NOT NULL DEFAULT 'not_configured',
  last_error TEXT,
  last_downloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_created_at ON backup_logs (created_at DESC);
