#!/usr/bin/env node
/**
 * Reset Hawana Airways HAMS super-admin credentials (idempotent).
 * Usage:
 *   DATABASE_URL=postgresql://... node backend/scripts/reset-hawana-admin-password.mjs
 *   node backend/scripts/reset-hawana-admin-password.mjs --password 'YourNewPassword'
 */
import pg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pg;

const ADMIN_EMAIL = 'admin@hawanaairways.com';
const DEFAULT_PASSWORD = 'Hawana@2026';

function parsePasswordArg() {
  const idx = process.argv.indexOf('--password');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env.HAMS_ADMIN_PASSWORD || DEFAULT_PASSWORD;
}

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/hams';

async function main() {
  const password = parsePasswordArg();
  if (password.length < 10) {
    console.error('Password must be at least 10 characters.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  try {
    await pool.query(`DO $$ BEGIN ALTER TYPE user_role ADD VALUE 'super_admin';
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

    const hash = await bcrypt.hash(password, 10);
    const upsert = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_active, failed_login_count, locked_until)
       VALUES ($1, $2, $3, 'super_admin'::user_role, TRUE, 0, NULL)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         full_name = EXCLUDED.full_name,
         is_active = TRUE,
         role = 'super_admin'::user_role,
         failed_login_count = 0,
         locked_until = NULL,
         updated_at = NOW()
       RETURNING id, email, role`,
      ['Hawana Airways Admin', ADMIN_EMAIL, hash]
    );

    const row = upsert.rows[0];
    console.log(`OK: ${row.email} (${row.role}) password updated, lockout cleared.`);
    console.log(`Email: ${ADMIN_EMAIL}`);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`Password: ${password}`);
    } else {
      console.log('Password: (set via --password or HAMS_ADMIN_PASSWORD; not printed in production NODE_ENV)');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
