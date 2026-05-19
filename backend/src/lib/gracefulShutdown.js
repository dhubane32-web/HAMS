import { logInfo, logError } from './safeLog.js';
import { pool } from '../config/db.js';
import { stopBackupScheduler } from '../services/backupScheduler.js';
import { logSystemEvent } from '../services/systemLogService.js';
import { sendOperationalAlert } from '../services/alertService.js';
import { getConfig } from '../config/index.js';

let shuttingDown = false;

export function registerGracefulShutdown(server) {
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logInfo(`[shutdown] received ${signal}`);
    await logSystemEvent({ level: 'info', category: 'deployment', action: 'SHUTDOWN', message: signal });
    const cfg = getConfig();
    if (cfg.alerts?.onShutdown && cfg.alerts?.webhook) {
      void sendOperationalAlert({
        severity: 'info',
        title: 'HAMS backend shutting down',
        message: signal,
        context: { service: process.env.RAILWAY_SERVICE_NAME || 'hams-backend' }
      }).catch(() => {});
    }

    stopBackupScheduler();

    const forceTimer = setTimeout(() => {
      logError('[shutdown] forced exit after timeout', new Error('shutdown timeout'));
      process.exit(1);
    }, Number(process.env.HAMS_SHUTDOWN_TIMEOUT_MS || 25_000));
    if (typeof forceTimer.unref === 'function') forceTimer.unref();

    try {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await pool.end();
      logInfo('[shutdown] complete');
      process.exit(0);
    } catch (err) {
      logError('[shutdown] error', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

export function isShuttingDown() {
  return shuttingDown;
}
