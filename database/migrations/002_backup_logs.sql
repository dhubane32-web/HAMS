-- HAMS backup logs (phase 1).
-- Tracks backup artifacts and restore timestamps.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/002_backup_logs.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS backup_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  backup_type VARCHAR(40) NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'success',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_created_at ON backup_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_logs_type_status ON backup_logs (backup_type, status);
