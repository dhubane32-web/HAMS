-- System operations: audit trail and backup log query performance (idempotent).
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity, entity_id);

DO $$
BEGIN
  IF to_regclass('public.backup_logs') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_backup_logs_created_at ON backup_logs (created_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_backup_logs_status ON backup_logs (status)';
  END IF;
END $$;
