#!/usr/bin/env node
/**
 * Production schema audit — compare DB to backend expectations.
 * Usage: DATABASE_URL=postgres://... node backend/scripts/audit-schema.mjs
 */
import pg from 'pg';
import { REQUIRED_COLUMNS, REQUIRED_TABLES } from '../src/services/schemaRegistry.js';

const { Pool } = pg;
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: url.includes('railway') ? { rejectUnauthorized: false } : undefined });

async function tableExists(table) {
  const r = await pool.query(`SELECT to_regclass($1::text) AS reg`, [`public.${table}`]);
  return Boolean(r.rows[0]?.reg);
}

async function columnExists(table, column) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1`,
    [table, column]
  );
  return r.rows.length > 0;
}

async function main() {
  console.log('=== HAMS schema audit ===\n');
  const missingTables = [];
  const missingColumns = [];

  for (const t of REQUIRED_TABLES) {
    const ok = await tableExists(t);
    console.log(`${ok ? 'OK  ' : 'MISS'} table ${t}`);
    if (!ok) missingTables.push(t);
  }

  console.log('');
  for (const { table, column } of REQUIRED_COLUMNS) {
    if (!(await tableExists(table))) {
      missingColumns.push(`${table}.${column}`);
      console.log(`SKIP column ${table}.${column} (table missing)`);
      continue;
    }
    const ok = await columnExists(table, column);
    console.log(`${ok ? 'OK  ' : 'MISS'} column ${table}.${column}`);
    if (!ok) missingColumns.push(`${table}.${column}`);
  }

  let migrations = [];
  if (await tableExists('hams_schema_migrations')) {
    const m = await pool.query(`SELECT version FROM hams_schema_migrations ORDER BY applied_at`);
    migrations = m.rows.map((r) => r.version);
    console.log(`\nMigrations recorded: ${migrations.length}`);
    for (const v of migrations) console.log(`  - ${v}`);
  } else {
    console.log('\nWARN: hams_schema_migrations table missing');
  }

  const fail = missingTables.length || missingColumns.length;
  console.log('\n--- Summary ---');
  if (fail) {
    if (missingTables.length) console.log('Missing tables:', missingTables.join(', '));
    if (missingColumns.length) console.log('Missing columns:', missingColumns.join(', '));
    console.log('\nFix: bash scripts/sync-railway-production.sh');
    process.exitCode = 1;
  } else {
    console.log('Schema matches backend expectations.');
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
