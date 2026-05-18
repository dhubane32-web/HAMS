import { pool } from './config/db.js';
import { validateProductionEnv } from './config/envValidation.js';

validateProductionEnv();

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
import { startBackupScheduler } from './services/backupScheduler.js';

const app = express();
const PORT = process.env.PORT || 5013;

const isProd = process.env.NODE_ENV === 'production';

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

async function healthHandler(_req, res) {
  try {
    res.status(200).json({ ok: true, service: 'HAMS backend' });
  } catch (error) {
    res.status(500).json({ ok: false, service: 'HAMS backend', message: isProd ? 'unhealthy' : error.message });
  }
}

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

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
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/master-data', masterDataRoutes);
app.use('/api/system', adminIpAllowlist, systemAdminRoutes);
app.use('/api/crew', crewRoutes);
app.use('/api/sales/commercial', salesCommercialRouter);
app.use('/api/sales', salesRoutes);
app.use('/api/customer-service', customerServiceRoutes);
app.use('/api/reports-analytics', reportsAnalyticsRoutes);

app.use((_req, res) => {
  res.status(404).json({ message: 'Not found.' });
});

app.use(productionErrorHandler);

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('Database connection verified.');
  } catch (err) {
    console.error('FATAL: Database connection failed. Check DATABASE_URL in backend/.env');
    console.error(err?.message || err);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`HAMS backend running on http://localhost:${PORT}`);
  });
  startBackupScheduler();
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(
        `FATAL: Port ${PORT} is already in use. Choose a free PORT in backend/.env and set frontend/.env.local NEXT_PUBLIC_API_URL to the same host/port. ` +
          `On macOS, port 5000 is often used by AirPlay Receiver (System Settings → General → AirDrop & Handoff).`
      );
      process.exit(1);
    }
    throw err;
  });
}

start();
