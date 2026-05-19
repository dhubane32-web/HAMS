import { pool } from '../config/db.js';
import {
  DEPRECATED_COLUMNS,
  OPTIONAL_TABLES,
  REQUIRED_COLUMNS,
  REQUIRED_TABLES
} from './schemaRegistry.js';

async function tableExists(table) {
  const r = await pool.query(`SELECT to_regclass($1::text) AS reg`, [`public.${table}`]);
  return Boolean(r.rows[0]?.reg);
}

async function columnExists(table, column) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     LIMIT 1`,
    [table, column]
  );
  return r.rows.length > 0;
}

/**
 * Full schema audit report — safe on production (read-only).
 */
export async function auditSchema() {
  const missingTables = [];
  const missingColumns = [];
  const deprecatedColumns = [];
  const presentTables = [];

  for (const table of REQUIRED_TABLES) {
    const exists = await tableExists(table);
    if (exists) presentTables.push(table);
    else missingTables.push(table);
  }

  for (const table of OPTIONAL_TABLES) {
    if (await tableExists(table)) presentTables.push(table);
  }

  for (const { table, column } of REQUIRED_COLUMNS) {
    if (!(await tableExists(table))) {
      missingColumns.push({ table, column, reason: 'table_missing' });
      continue;
    }
    if (!(await columnExists(table, column))) {
      missingColumns.push({ table, column, reason: 'column_missing' });
    }
  }

  for (const { table, column } of DEPRECATED_COLUMNS) {
    if (await columnExists(table, column)) {
      deprecatedColumns.push({ table, column });
    }
  }

  let appliedMigrations = [];
  try {
    if (await tableExists('hams_schema_migrations')) {
      const m = await pool.query(
        `SELECT version FROM hams_schema_migrations ORDER BY applied_at ASC`
      );
      appliedMigrations = m.rows.map((r) => r.version);
    }
  } catch {
    appliedMigrations = [];
  }

  const ok = missingTables.length === 0 && missingColumns.length === 0 && deprecatedColumns.length === 0;

  return {
    ok,
    missingTables,
    missingColumns,
    deprecatedColumns,
    presentTables,
    appliedMigrations,
    migrationCount: appliedMigrations.length,
    checkedAt: new Date().toISOString(),
    report: buildReportText({
      ok,
      missingTables,
      missingColumns,
      deprecatedColumns,
      appliedMigrations
    })
  };
}

function buildReportText({ ok, missingTables, missingColumns, deprecatedColumns, appliedMigrations }) {
  const lines = [
    ok ? 'SCHEMA OK' : 'SCHEMA DRIFT DETECTED',
    `Migrations applied: ${appliedMigrations.length}`,
    appliedMigrations.length ? `  Latest: ${appliedMigrations[appliedMigrations.length - 1]}` : '  (none recorded)'
  ];
  if (missingTables.length) {
    lines.push('Missing tables:');
    for (const t of missingTables) lines.push(`  - ${t}`);
  }
  if (missingColumns.length) {
    lines.push('Missing columns:');
    for (const c of missingColumns) lines.push(`  - ${c.table}.${c.column} (${c.reason})`);
  }
  if (deprecatedColumns.length) {
    lines.push('Deprecated columns (rename via 008):');
    for (const c of deprecatedColumns) lines.push(`  - ${c.table}."${c.column}"`);
  }
  if (!missingTables.length && !missingColumns.length && !deprecatedColumns.length) {
    lines.push('All required tables and columns present.');
  }
  return lines.join('\n');
}

export function isPostgresSchemaError(err) {
  const code = err?.code;
  return code === '42P01' || code === '42703';
}
