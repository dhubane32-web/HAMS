import { getConfig } from '../config/index.js';
import { pool } from '../config/db.js';
import { getPoolStats } from '../config/db.js';
import { sendOperationalAlert } from './alertService.js';

const startedAt = Date.now();
let requestCount = 0;
let errorCount = 0;
let slowRequestCount = 0;
const recentErrors = [];
const recentSlow = [];
const MAX_RECENT = 50;
const error5xxTimestamps = [];
let last5xxAlertAt = 0;

export function recordRequest({ method, path, status, durationMs }) {
  const cfg = getConfig();
  if (!cfg.monitoring.enabled) return;
  requestCount += 1;
  const code = Number(status) || 500;
  if (code >= 500) {
    errorCount += 1;
    pushRecent(recentErrors, { method, path, status: code, durationMs, at: new Date().toISOString() });
    maybeAlert5xxSpike({ method, path, status: code });
  }
  if (durationMs >= cfg.monitoring.slowRequestMs) {
    slowRequestCount += 1;
    pushRecent(recentSlow, { method, path, status: code, durationMs, at: new Date().toISOString() });
  }
}

function pushRecent(arr, item) {
  arr.unshift(item);
  if (arr.length > MAX_RECENT) arr.length = MAX_RECENT;
}

async function maybeAlert5xxSpike({ method, path, status }) {
  const cfg = getConfig();
  const url = cfg.alerts?.webhook;
  if (!url) return;

  const now = Date.now();
  const windowMs = (cfg.alerts?.error5xxWindowSec || 300) * 1000;
  error5xxTimestamps.push(now);
  while (error5xxTimestamps.length && now - error5xxTimestamps[0] > windowMs) {
    error5xxTimestamps.shift();
  }

  const threshold = cfg.alerts?.error5xxThreshold || 15;
  const cooldownMs = (cfg.alerts?.cooldownSec || 600) * 1000;
  if (error5xxTimestamps.length < threshold) return;
  if (now - last5xxAlertAt < cooldownMs) return;

  last5xxAlertAt = now;
  await sendOperationalAlert({
    severity: 'warning',
    title: 'HAMS 5xx error spike',
    message: `${error5xxTimestamps.length} server errors in ${Math.round(windowMs / 1000)}s`,
    context: { method, path, status, count: error5xxTimestamps.length, threshold }
  }).catch(() => {});
}

export function getMonitoringSnapshot() {
  return {
    startedAt: new Date(startedAt).toISOString(),
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    requests: { total: requestCount, errors5xx: errorCount, slow: slowRequestCount },
    recentErrors5xx: recentErrors.slice(0, 10),
    recentSlowRequests: recentSlow.slice(0, 10),
    dbPool: getPoolStats()
  };
}

/** Failed login counts from audit tables (last 24h). */
export async function getFailedLoginStats(hours = 24) {
  const safeHours = Math.max(1, Math.min(168, Number(hours) || 24));
  try {
    const q = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM login_history
       WHERE success = FALSE AND created_at >= NOW() - ($1::text || ' hours')::interval`,
      [String(safeHours)]
    );
    const byIp = await pool.query(
      `SELECT ip_address, COUNT(*)::int AS attempts
       FROM login_history
       WHERE success = FALSE AND created_at >= NOW() - ($1::text || ' hours')::interval
         AND ip_address IS NOT NULL
       GROUP BY ip_address
       ORDER BY attempts DESC
       LIMIT 10`,
      [String(safeHours)]
    );
    return {
      windowHours: safeHours,
      totalFailed: q.rows[0]?.total ?? 0,
      topIps: byIp.rows
    };
  } catch {
    return { windowHours: safeHours, totalFailed: null, topIps: [] };
  }
}

export async function getOpsSummary() {
  const [failedLogins, monitoring] = await Promise.all([
    getFailedLoginStats(24),
    Promise.resolve(getMonitoringSnapshot())
  ]);
  return { monitoring, failedLogins };
}
