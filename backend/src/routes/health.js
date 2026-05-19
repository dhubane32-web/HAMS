import express from 'express';
import { getLiveness, getReadiness, getFullHealth } from '../services/healthService.js';

const router = express.Router();

router.get('/live', (_req, res) => {
  res.status(200).json(getLiveness());
});

router.get('/ready', async (_req, res) => {
  try {
    const body = await getReadiness();
    res.status(body.ok ? 200 : 503).json(body);
  } catch {
    res.status(503).json({ ok: false, service: 'HAMS backend', check: 'ready' });
  }
});

router.get('/', async (_req, res) => {
  try {
    const body = await getFullHealth({ includeBackup: false, includeMonitoring: false });
    res.status(body.ok ? 200 : 503).json({
      status: body.ok ? 'healthy' : 'degraded',
      ...body
    });
  } catch {
    res.status(503).json({ status: 'unhealthy', ok: false, service: 'HAMS backend' });
  }
});

export default router;
