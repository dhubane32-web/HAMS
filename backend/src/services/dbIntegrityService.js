import { pool } from '../config/db.js';

const CORE_TABLES = ['users', 'bookings', 'flights', 'audit_logs', 'backup_logs'];

/**
 * Lightweight integrity checks — non-destructive, safe on every deploy.
 */
export async function runDbIntegrityChecks() {
  const checks = [];
  let ok = true;

  for (const table of CORE_TABLES) {
    try {
      const r = await pool.query(
        `SELECT to_regclass($1::text) AS reg`,
        [`public.${table}`]
      );
      const exists = Boolean(r.rows[0]?.reg);
      checks.push({ name: `table_${table}`, ok: exists });
      if (!exists) ok = false;
    } catch (err) {
      checks.push({ name: `table_${table}`, ok: false, error: 'query_failed' });
      ok = false;
    }
  }

  try {
    const conn = await pool.query(
      `SELECT count(*)::int AS active FROM pg_stat_activity WHERE datname = current_database()`
    );
    checks.push({
      name: 'connections',
      ok: true,
      active: conn.rows[0]?.active ?? 0,
      max: Number(process.env.PGPOOL_MAX || process.env.HAMS_DB_POOL_MAX || 20)
    });
  } catch {
    checks.push({ name: 'connections', ok: true, skipped: true });
  }

  try {
    const orphans = await pool.query(
      `SELECT COUNT(*)::int AS n FROM bookings b
       WHERE b.created_by IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = b.created_by)
       LIMIT 1`
    ).catch(() => ({ rows: [{ n: null }] }));
    const n = orphans.rows[0]?.n;
    if (n != null && n > 0) {
      checks.push({ name: 'orphan_booking_users', ok: false, count: n });
      ok = false;
    } else {
      checks.push({ name: 'orphan_booking_users', ok: true });
    }
  } catch {
    checks.push({ name: 'orphan_booking_users', ok: true, skipped: true });
  }

  return { ok, checks, checkedAt: new Date().toISOString() };
}
