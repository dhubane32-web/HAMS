import { pool } from './config/db.js';
import { getConfig } from './config/index.js';

getConfig();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { attachSecurityHeaders } from './middleware/securityHeaders.js';
import { trustedOriginMutations } from './middleware/trustedOriginMutations.js';
import { apiLimiter, authPasswordResetLimiter } from './middleware/apiRateLimits.js';
import { bearerFromCookie } from './middleware/bearerFromCookie.js';
import { sanitizeBody } from './middleware/sanitizeBody.js';
import { productionErrorHandler } from './middleware/productionErrors.js';
import authRoutes from './routes/auth.js';
import authTotpRoutes from './routes/auth-totp.js';
import bookingRoutes from './routes/modules/booking.js';
import checkinRoutes from './routes/modules/checkin.js';
import boardingRoutes from './routes/modules/boarding.js';
import financeRoutes from './routes/modules/finance.js';
import operationsRoutes from './routes/modules/operations.js';
import maintenanceRoutes from './routes/modules/maintenance.js';
import dashboardRoutes from './routes/modules/dashboard.js';
import masterDataRoutes from './routes/modules/master-data.js';
import systemAdminRoutes from './routes/modules/system-administration.js';
import { adminIpAllowlist } from './middleware/adminIpAllowlist.js';
import crewRoutes from './routes/modules/crew.js';
import salesRoutes from './routes/modules/sales.js';
import { salesCommercialRouter } from './routes/modules/salesCommercialExtras.js';
import customerServiceRoutes from './routes/modules/customer-service.js';
import reportsAnalyticsRoutes from './routes/modules/reports-analytics.js';
import commercialRoutes from './routes/modules/commercial.js';
import enterpriseOpsRoutes from './routes/modules/enterprise-ops.js';
import { ensureOccEtaColumns } from './lib/occFlightColumns.js';
import { startBackupScheduler } from './services/backupScheduler.js';
import healthRouter from './routes/health.js';
import { occPublicRouter } from './routes/modules/occ.js';
import { requestMonitoring } from './middleware/requestMonitoring.js';
import { logInfo, logError } from './lib/safeLog.js';
import { registerGracefulShutdown } from './lib/gracefulShutdown.js';
import { requestTimeout } from './middleware/requestTimeout.js';
import { maintenanceMode } from './middleware/maintenanceMode.js';
import { logSystemEvent } from './services/systemLogService.js';
import { runDbIntegrityChecks } from './services/dbIntegrityService.js';
import { sendOperationalAlert } from './services/alertService.js';

const app = express();
const cfg = getConfig();
const PORT = cfg.port;
const isProd = cfg.isProd;

import {
  parseOrigins,
  isBrowserOriginAllowed
} from './lib/corsOrigins.js';

const configuredOrigins = parseOrigins(process.env.FRONTEND_URL);
const extraOrigins = parseOrigins(process.env.HAMS_EXTRA_CORS_ORIGINS);

attachSecurityHeaders(app);

app.use(
  cors({
    origin(origin, callback) {
      const ok = isBrowserOriginAllowed(origin, {
        configuredOrigins,
        extraOrigins,
        isProd
      });
      callback(null, ok);
    },
    credentials: true
  })
);

app.use(cookieParser());
app.use(bearerFromCookie);
app.use(trustedOriginMutations);
app.use(express.json({ limit: '1mb' }));
app.use(sanitizeBody);
app.use(requestTimeout());
app.use(requestMonitoring);

app.use(maintenanceMode);

app.use('/health', healthRouter);
app.get('/live', (req, res, next) => {
  req.url = '/live';
  healthRouter(req, res, next);
});
app.get('/ready', (req, res, next) => {
  req.url = '/ready';
  healthRouter(req, res, next);
});
app.get('/api/health', (req, res, next) => {
  req.url = '/';
  healthRouter(req, res, next);
});

app.use('/api/occ', occPublicRouter);

app.use('/api/auth/forgot-password', authPasswordResetLimiter);
app.use('/api/auth/reset-password', authPasswordResetLimiter);

app.use('/api/', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/auth', authTotpRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/boarding', boardingRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/operations', operationsRoutes);
app.use('/api/enterprise-ops', enterpriseOpsRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/master-data', masterDataRoutes);
app.use('/api/system', adminIpAllowlist, systemAdminRoutes);
app.use('/api/crew', crewRoutes);
app.use('/api/sales/commercial', salesCommercialRouter);
app.use('/api/sales', salesRoutes);
app.use('/api/customer-service', customerServiceRoutes);
app.use('/api/reports-analytics', reportsAnalyticsRoutes);
app.use('/api/commercial', commercialRoutes);

app.use((_req, res) => {
  res.status(404).json({ message: 'Not found.' });
});

app.use(productionErrorHandler);

async function waitForDatabase(maxAttempts = 30, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      logInfo('Database connection verified.');
      return;
    } catch (err) {
      const msg = err?.message || String(err);
      if (attempt >= maxAttempts) {
        logError('FATAL: Database connection failed. Check DATABASE_URL.', err);
        process.exit(1);
      }
      logInfo(`Database not ready (${attempt}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function start() {
  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(PORT, host, () => {
    logInfo(`HAMS backend running on http://${host}:${PORT}`);
  });

  registerGracefulShutdown(server);

  // Listen before DB is ready so Railway /health can pass during Postgres cold start.
  waitForDatabase()
    .then(async () => {
      try {
        await ensureOccEtaColumns(pool);
        logInfo('OCC flight ETA columns verified.');
      } catch (occErr) {
        logError('OCC column bootstrap warn', occErr);
      }
      const integrity = await runDbIntegrityChecks();
      if (!integrity.ok) {
        logError('DB integrity check reported issues', new Error('integrity warnings'));
      }
      await logSystemEvent({
        level: 'info',
        category: 'deployment',
        action: 'STARTUP',
        message: 'HAMS backend started',
        metadata: { integrityOk: integrity.ok, port: PORT }
      });
      startBackupScheduler();
    })
    .catch((err) => {
      logError('Startup failed after listen', err);
      process.exit(1);
    });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      logError(
        `FATAL: Port ${PORT} is already in use.`,
        err
      );
      process.exit(1);
    }
    throw err;
  });
}

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logError('unhandledRejection', err);
  void sendOperationalAlert({
    severity: 'critical',
    title: 'Unhandled promise rejection',
    message: err.message || 'unhandledRejection',
    context: { name: err.name }
  }).catch(() => {});
});
process.on('uncaughtException', (err) => {
  logError('uncaughtException', err);
  void sendOperationalAlert({
    severity: 'critical',
    title: 'Uncaught exception',
    message: err?.message || 'uncaughtException',
    context: { name: err?.name }
  }).catch(() => {});
  process.exit(1);
});

start();
