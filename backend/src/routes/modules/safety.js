import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import { writeAudit } from '../../services/auditService.js';

const router = express.Router();

const ROLES_SAFETY = ['super_admin', 'admin', 'operations', 'maintenance'];

router.get('/health', (_req, res) => {
  res.json({ module: 'safety-compliance', status: 'ready' });
});

router.get('/incidents', requireAuth, requireRoles(...ROLES_SAFETY), async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, title, severity, status, reported_at
       FROM sms_incidents
       ORDER BY reported_at DESC
       LIMIT 100`
    );
    return res.json({ incidents: r.rows });
  } catch (e) {
    if (e?.code === '42P01') {
      return res.status(503).json({ message: 'SMS tables not migrated (009_safety_compliance_sms.sql).' });
    }
    return res.status(500).json({ message: 'Failed to load incidents.', error: e.message });
  }
});

router.post('/incidents', requireAuth, requireRoles(...ROLES_SAFETY), async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const severity = String(req.body?.severity || 'MEDIUM').toUpperCase();
  const description = req.body?.description ? String(req.body.description) : null;
  if (title.length < 3) return res.status(400).json({ message: 'Title is required (min 3 chars).' });
  try {
    const r = await pool.query(
      `INSERT INTO sms_incidents (title, description, severity, reported_by)
       VALUES ($1, $2, $3, $4::uuid)
       RETURNING id, title, severity, status, reported_at`,
      [title, description, severity, req.user.userId]
    );
    await writeAudit(pool, {
      userId: req.user.userId,
      action: 'SMS_INCIDENT_REPORTED',
      entity: 'sms_incidents',
      entityId: r.rows[0].id,
      metadata: { severity },
      req
    });
    return res.status(201).json({ incident: r.rows[0] });
  } catch (e) {
    if (e?.code === '42P01') {
      return res.status(503).json({ message: 'SMS tables not migrated.' });
    }
    return res.status(500).json({ message: 'Failed to report incident.', error: e.message });
  }
});

export default router;
