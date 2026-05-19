/**
 * Centralized runtime configuration — validated once at startup.
 */
import { validateProductionEnv } from './envValidation.js';

const isProd = process.env.NODE_ENV === 'production';

function requirePositiveInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function loadConfig() {
  validateProductionEnv();

  return Object.freeze({
    isProd,
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT || 5013),
    host: process.env.HOST || '0.0.0.0',
    databaseUrl: process.env.DATABASE_URL || '',
    jwtSecret: process.env.JWT_SECRET || '',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
    encryptionKey: process.env.HAMS_ENCRYPTION_KEY || '',
    frontendUrls: process.env.FRONTEND_URL || '',
    backup: {
      enabled: String(process.env.BACKUP_SCHEDULER_ENABLED || 'true').toLowerCase() !== 'false',
      encryptionKey: process.env.BACKUP_ENCRYPTION_KEY || '',
      rootDir: process.env.BACKUP_ROOT_DIR || '',
      retentionDailyDays: requirePositiveInt(process.env.BACKUP_RETENTION_DAILY_DAYS, 30, 7, 365),
      retentionWeeklyDays: requirePositiveInt(process.env.BACKUP_RETENTION_WEEKLY_DAYS, 90, 14, 730),
      retentionMonthlyDays: requirePositiveInt(process.env.BACKUP_RETENTION_MONTHLY_DAYS, 365, 30, 1825),
      verifyAfterRun: String(process.env.BACKUP_VERIFY_AFTER_RUN || 'true').toLowerCase() !== 'false'
    },
    security: {
      httpOnlySession: String(process.env.HAMS_HTTPONLY_SESSION || 'true').toLowerCase() === 'true',
      internalApiKey: process.env.HAMS_INTERNAL_API_KEY || ''
    },
    monitoring: {
      enabled: String(process.env.HAMS_MONITORING_ENABLED || 'true').toLowerCase() !== 'false',
      slowRequestMs: requirePositiveInt(process.env.HAMS_SLOW_REQUEST_MS, 3000, 500, 60000)
    },
    alerts: {
      webhook: (process.env.HAMS_ALERT_WEBHOOK_URL || '').trim(),
      error5xxThreshold: requirePositiveInt(process.env.HAMS_ALERT_5XX_THRESHOLD, 15, 3, 500),
      error5xxWindowSec: requirePositiveInt(process.env.HAMS_ALERT_5XX_WINDOW_SEC, 300, 60, 3600),
      cooldownSec: requirePositiveInt(process.env.HAMS_ALERT_COOLDOWN_SEC, 600, 60, 86400),
      onShutdown: String(process.env.HAMS_ALERT_ON_SHUTDOWN || 'false').toLowerCase() === 'true'
    },
    maintenance: {
      enabled: ['true', '1', 'on'].includes(String(process.env.HAMS_MAINTENANCE_MODE || '').trim().toLowerCase()),
      message:
        process.env.HAMS_MAINTENANCE_MESSAGE?.trim() ||
        'HAMS is temporarily unavailable for scheduled maintenance. Please try again shortly.'
    }
  });
}

let cached = null;

export function getConfig() {
  if (!cached) cached = loadConfig();
  return cached;
}
