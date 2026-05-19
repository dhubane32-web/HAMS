import { getFullHealth } from './healthService.js';
import { getOpsSummary } from './monitoringService.js';
import { getBackupHealthSummary } from './backupService.js';
import { runDbIntegrityChecks } from './dbIntegrityService.js';
import { tailSystemEvents } from './systemLogService.js';
import { getConfig } from '../config/index.js';
import { getPoolStats } from '../config/db.js';

export async function getDiagnosticsDashboard() {
  const cfg = getConfig();
  const [health, ops, backup, dbIntegrity, recentEvents] = await Promise.all([
    getFullHealth({ includeBackup: true, includeMonitoring: true }),
    getOpsSummary(),
    getBackupHealthSummary().catch(() => ({ lastBackupStatus: 'unknown' })),
    runDbIntegrityChecks(),
    Promise.resolve(tailSystemEvents(50))
  ]);

  return {
    generatedAt: new Date().toISOString(),
    environment: cfg.nodeEnv,
    maintenanceMode: cfg.maintenance?.enabled || false,
    health,
    ops,
    backup,
    dbIntegrity,
    dbPool: getPoolStats(),
    recentSystemEvents: recentEvents,
    deployment: {
      version: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
      service: process.env.RAILWAY_SERVICE_NAME || 'hams-backend'
    }
  };
}
