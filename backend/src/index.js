import express from 'express';
import cors from 'cors';
import { pool } from './config/db.js';
import authRoutes from './routes/auth.js';
import bookingRoutes from './routes/modules/booking.js';
import checkinRoutes from './routes/modules/checkin.js';
import boardingRoutes from './routes/modules/boarding.js';
import financeRoutes from './routes/modules/finance.js';
import operationsRoutes from './routes/modules/operations.js';
import maintenanceRoutes from './routes/modules/maintenance.js';
import dashboardRoutes from './routes/modules/dashboard.js';
import masterDataRoutes from './routes/modules/master-data.js';
import systemAdminRoutes from './routes/modules/system-administration.js';
import crewRoutes from './routes/modules/crew.js';
import salesRoutes from './routes/modules/sales.js';
import customerServiceRoutes from './routes/modules/customer-service.js';
import reportsAnalyticsRoutes from './routes/modules/reports-analytics.js';

const app = express();
const PORT = process.env.PORT || 5000;

const isProd = process.env.NODE_ENV === 'production';

function parseOrigins(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const configuredOrigins = parseOrigins(process.env.FRONTEND_URL);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (configuredOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      if (!isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: false
  })
);
app.use(express.json());

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', service: 'hams-backend' });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/boarding', boardingRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/operations', operationsRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/master-data', masterDataRoutes);
app.use('/api/system', systemAdminRoutes);
app.use('/api/crew', crewRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/customer-service', customerServiceRoutes);
app.use('/api/reports-analytics', reportsAnalyticsRoutes);

app.listen(PORT, () => {
  console.log(`HAMS backend running on http://localhost:${PORT}`);
});
