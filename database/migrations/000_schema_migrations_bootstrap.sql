-- Tracks applied numbered migrations for safe repeat deploys (see database/migrations/README.md).
-- Idempotent.

CREATE TABLE IF NOT EXISTS hams_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hams_schema_migrations_applied ON hams_schema_migrations (applied_at DESC);
