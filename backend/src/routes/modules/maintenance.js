import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import { recordOccFlightEvent } from '../../services/occFlightEvents.js';

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ module: 'maintenance', status: 'ready' });
});

router.get('/aircraft', requireAuth, requireRoles('admin', 'maintenance', 'operations'), async (_req, res) => {
  try {
    const aircraft = await pool.query(
      `SELECT id, tail_number, model, seat_capacity, release_status
       FROM aircraft
       ORDER BY tail_number ASC`
    );
    return res.status(200).json({ aircraft: aircraft.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to retrieve aircraft.', error: error.message });
  }
});

router.post('/defects', requireAuth, requireRoles('admin', 'maintenance'), async (req, res) => {
  const { aircraftId, defectCode, defectDescription, severity } = req.body;
  if (!aircraftId || !defectDescription || !severity) {
    return res.status(400).json({ message: 'aircraftId, defectDescription, and severity are required.' });
  }

  try {
    const defect = await pool.query(
      `INSERT INTO maintenance_logs (
        aircraft_id, defect_code, defect_description, severity, status, opened_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, aircraft_id, defect_code, defect_description, severity, status, opened_at`,
      [aircraftId, defectCode || null, defectDescription, String(severity).toUpperCase(), 'OPEN', req.user.userId]
    );

    await pool.query(
      `UPDATE aircraft SET release_status = 'HOLD' WHERE id = $1`,
      [aircraftId]
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.userId, 'DEFECT_LOGGED', 'maintenance_logs', defect.rows[0].id, JSON.stringify({ aircraftId })]
    );

    return res.status(201).json({ defect: defect.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to log defect.', error: error.message });
  }
});

router.patch('/defects/:defectId/close', requireAuth, requireRoles('admin', 'maintenance'), async (req, res) => {
  const { defectId } = req.params;
  const { releaseAircraft } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const defectResult = await client.query(
      `UPDATE maintenance_logs
       SET status = 'CLOSED',
           closed_by = $1,
           closed_at = NOW()
       WHERE id = $2
       RETURNING id, aircraft_id, status, closed_at`,
      [req.user.userId, defectId]
    );
    const defect = defectResult.rows[0];
    if (!defect) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Defect not found.' });
    }

    if (releaseAircraft === true) {
      await client.query(`UPDATE aircraft SET release_status = 'RELEASED' WHERE id = $1`, [defect.aircraft_id]);
      const fl = await client.query(
        `SELECT id FROM flights
         WHERE aircraft_id = $1::uuid
           AND UPPER(TRIM(status::text)) NOT IN ('CANCELLED','ARRIVED','LANDED')
           AND departure_time > NOW() - interval '3 days'`,
        [defect.aircraft_id]
      );
      for (const fr of fl.rows) {
        await recordOccFlightEvent(client, {
          flightId: fr.id,
          eventType: 'MAINT_RELEASE',
          sourceSystem: 'maintenance',
          userId: req.user.userId,
          payload: { defectId: defect.id, aircraftId: defect.aircraft_id }
        });
      }
    }

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.userId,
        'DEFECT_CLOSED',
        'maintenance_logs',
        defect.id,
        JSON.stringify({ releaseAircraft: releaseAircraft === true })
      ]
    );

    await client.query('COMMIT');
    return res.status(200).json({ message: 'Defect closed.', defect });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed to close defect.', error: error.message });
  } finally {
    client.release();
  }
});

router.post('/inspections', requireAuth, requireRoles('admin', 'maintenance'), async (req, res) => {
  const { aircraftId, inspectionType, scheduledFor, remarks } = req.body;
  if (!aircraftId || !inspectionType || !scheduledFor) {
    return res.status(400).json({ message: 'aircraftId, inspectionType, and scheduledFor are required.' });
  }

  try {
    const inspection = await pool.query(
      `INSERT INTO maintenance_inspections (
        aircraft_id, inspection_type, scheduled_for, remarks, scheduled_by
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, aircraft_id, inspection_type, scheduled_for, status, remarks, created_at`,
      [aircraftId, inspectionType, scheduledFor, remarks || null, req.user.userId]
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.userId, 'INSPECTION_SCHEDULED', 'maintenance_inspections', inspection.rows[0].id, JSON.stringify({ aircraftId })]
    );

    return res.status(201).json({ inspection: inspection.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to schedule inspection.', error: error.message });
  }
});

router.patch('/inspections/:inspectionId/complete', requireAuth, requireRoles('admin', 'maintenance'), async (req, res) => {
  const { inspectionId } = req.params;
  try {
    const completed = await pool.query(
      `UPDATE maintenance_inspections
       SET status = 'COMPLETED',
           completed_by = $1,
           completed_at = NOW()
       WHERE id = $2
       RETURNING id, aircraft_id, inspection_type, status, completed_at`,
      [req.user.userId, inspectionId]
    );
    if (!completed.rows[0]) {
      return res.status(404).json({ message: 'Inspection not found.' });
    }
    return res.status(200).json({ inspection: completed.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to complete inspection.', error: error.message });
  }
});

router.patch('/aircraft/:aircraftId/release-status', requireAuth, requireRoles('admin', 'maintenance'), async (req, res) => {
  const { aircraftId } = req.params;
  const { releaseStatus } = req.body;
  const normalized = String(releaseStatus || '').toUpperCase();
  if (!['RELEASED', 'HOLD', 'IN_MAINTENANCE'].includes(normalized)) {
    return res.status(400).json({ message: 'releaseStatus must be RELEASED, HOLD, or IN_MAINTENANCE.' });
  }

  try {
    const result = await pool.query(
      `UPDATE aircraft
       SET release_status = $1
       WHERE id = $2
       RETURNING id, tail_number, model, release_status`,
      [normalized, aircraftId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Aircraft not found.' });
    }
    if (normalized === 'RELEASED') {
      try {
        const fl = await pool.query(
          `SELECT id FROM flights
           WHERE aircraft_id = $1::uuid
             AND UPPER(TRIM(status::text)) NOT IN ('CANCELLED','ARRIVED','LANDED')
             AND departure_time > NOW() - interval '3 days'`,
          [aircraftId]
        );
        for (const fr of fl.rows) {
          await recordOccFlightEvent(pool, {
            flightId: fr.id,
            eventType: 'AIRCRAFT_RELEASE_STATUS',
            sourceSystem: 'maintenance',
            userId: req.user.userId,
            payload: { aircraftId, releaseStatus: normalized }
          });
        }
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[maintenance] OCC flight event:', e?.message || e);
        }
      }
    }
    return res.status(200).json({ aircraft: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update release status.', error: error.message });
  }
});

router.get('/history', requireAuth, requireRoles('admin', 'maintenance', 'operations'), async (req, res) => {
  const aircraftId = req.query.aircraftId ? String(req.query.aircraftId) : null;
  const values = [];
  let whereClause = '';
  if (aircraftId) {
    values.push(aircraftId);
    whereClause = `WHERE m.aircraft_id = $1`;
  }

  try {
    const defects = await pool.query(
      `SELECT
        m.id,
        m.aircraft_id,
        a.tail_number,
        m.defect_code,
        m.defect_description,
        m.severity,
        m.status,
        m.opened_at,
        m.closed_at
      FROM maintenance_logs m
      JOIN aircraft a ON a.id = m.aircraft_id
      ${whereClause}
      ORDER BY m.opened_at DESC`,
      values
    );

    const inspectionsWhere = aircraftId ? `WHERE i.aircraft_id = $1` : '';
    const inspections = await pool.query(
      `SELECT
        i.id,
        i.aircraft_id,
        a.tail_number,
        i.inspection_type,
        i.scheduled_for,
        i.status,
        i.completed_at
      FROM maintenance_inspections i
      JOIN aircraft a ON a.id = i.aircraft_id
      ${inspectionsWhere}
      ORDER BY i.scheduled_for DESC`,
      values
    );

    return res.status(200).json({
      defects: defects.rows,
      inspections: inspections.rows
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to retrieve maintenance history.', error: error.message });
  }
});

export default router;
