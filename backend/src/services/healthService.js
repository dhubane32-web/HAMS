import os from 'os';
import { pool } from '../config/db.js';
import { getBackupHealthSummary } from './backupService.js';
import { getMonitoringSnapshot } from './monitoringService.js';

const startedAt = Date.now();

export function getProcessMetrics() {
  const mem = process.memoryUsage();
  const load = os.loadavg();
  return {
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      externalMb: Math.round(mem.external / 1024 / 1024)
    },
    cpu: {
      load1: load[0],
      load5: load[1],
      load15: load[2],
      cores: os.cpus().length
    }
  };
}

export async function checkDatabase() {
  const t0 = Date.now();
  await pool.query('SELECT 1 AS ok');
  return { ok: true, latencyMs: Date.now() - t0 };
}

/** Liveness — process is up (Railway/Docker). */
export function getLiveness() {
  return {
    ok: true,
    service: 'HAMS backend',
    check: 'live',
    ...getProcessMetrics()
  };
}

/** Readiness — dependencies available. */
export async function getReadiness() {
  const checks = { database: { ok: false } };
  let ok = true;
  try {
    const db = await checkDatabase();
    checks.database = { ok: true, latencyMs: db.latencyMs };
  } catch (err) {
    ok = false;
    checks.database = { ok: false, error: 'unavailable' };
  }
  return {
    ok,
    service: 'HAMS backend',
    check: 'ready',
    checks,
    ...getProcessMetrics()
  };
}

/** Full health for ops dashboards (may include backup summary). */
export async function getFullHealth({ includeBackup = false, includeMonitoring = false } = {}) {
  const readiness = await getReadiness();
  const body = {
    ...readiness,
    check: 'health'
  };
  if (includeBackup) {
    try {
      body.backup = await getBackupHealthSummary();
    } catch {
      body.backup = { lastBackupStatus: 'unknown' };
    }
  }
  if (includeMonitoring) {
    body.monitoring = getMonitoringSnapshot();
  }
  return body;
}
