import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';
import { logInfo } from '../lib/safeLog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load backend/.env even when the process cwd is the repo root or another folder.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { Pool } = pg;

const isProd = process.env.NODE_ENV === 'production';
const max = Number(process.env.HAMS_DB_POOL_MAX || process.env.PGPOOL_MAX || 20);
const idleTimeoutMillis = Number(process.env.HAMS_DB_IDLE_TIMEOUT_MS || 30_000);
const connectionTimeoutMillis = Number(process.env.HAMS_DB_CONNECT_TIMEOUT_MS || 10_000);
const statementTimeout = Number(process.env.HAMS_DB_STATEMENT_TIMEOUT_MS || 60_000);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Math.max(2, Math.min(50, max)),
  idleTimeoutMillis,
  connectionTimeoutMillis,
  allowExitOnIdle: false,
  ssl: isProd && String(process.env.DATABASE_SSL || 'true').toLowerCase() !== 'false'
    ? { rejectUnauthorized: String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'false') === 'true' }
    : undefined
});

pool.on('error', (err) => {
  console.error('[db] idle client error:', err?.message || err);
});

pool.on('connect', (client) => {
  if (statementTimeout > 0) {
    client.query(`SET statement_timeout = ${Math.floor(statementTimeout)}`).catch(() => {});
  }
});

const slowQueryMs = Number(process.env.HAMS_DB_SLOW_QUERY_MS || 0);
if (slowQueryMs > 0) {
  const originalQuery = pool.query.bind(pool);
  pool.query = async function slowQueryWrapper(...args) {
    const t0 = Date.now();
    const result = await originalQuery(...args);
    const elapsed = Date.now() - t0;
    if (elapsed >= slowQueryMs) {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text || '';
      logInfo('[db] slow query', { elapsedMs: elapsed, sql: String(sql).slice(0, 240) });
    }
    return result;
  };
}

export function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    max: pool.options?.max ?? null
  };
}
