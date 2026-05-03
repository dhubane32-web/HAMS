import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import { buildBoardingPassView } from '../../services/checkinBoardingService.js';
import { isUuid, assertGateMatchesFlight, runBoardingScan } from '../../services/checkinBoardingWorkflow.js';
import { isFlightOpenForBoardingOps } from '../../lib/flightOccStatus.js';
import { ROLES_BOARDING } from '../../lib/airlineRbac.js';

const router = express.Router();

const ROLES = ROLES_BOARDING;

/**
 * POST /api/boarding/scan
 * Body: { scan, flightId?, gateAtScan?, strictGate? }
 */
router.post('/scan', requireAuth, requireRoles(...ROLES), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await runBoardingScan(client, {
      scan: req.body?.scan,
      flightId: req.body?.flightId,
      gateAtScan: req.body?.gateAtScan,
      strictGate: req.body?.strictGate,
      userId: req.user.userId
    });
    if (!result.ok) {
      await client.query('ROLLBACK');
      return res.status(result.status).json({ message: result.message });
    }
    await client.query('COMMIT');
    const boardingPass = await buildBoardingPassView(pool, result.checkinId);
    return res.status(200).json({ message: 'Boarded.', boardingPass });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Boarding scan failed.', error: error.message });
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/boarding/status
 * Body: { checkinId, boardingStatus, gateAtScan? }
 * boardingStatus: BOARDING | BOARDED | NO_SHOW
 */
router.patch('/status', requireAuth, requireRoles(...ROLES), async (req, res) => {
  const { checkinId, boardingStatus, gateAtScan } = req.body;
  if (!checkinId || !isUuid(String(checkinId))) {
    return res.status(400).json({ message: 'checkinId (uuid) is required.' });
  }
  const next = String(boardingStatus || '').toUpperCase();
  if (!['BOARDING', 'BOARDED', 'NO_SHOW'].includes(next)) {
    return res.status(400).json({ message: 'boardingStatus must be BOARDING, BOARDED, or NO_SHOW.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT c.id, c.passenger_id, c.boarding_status, c.flight_id, b.pnr, f.gate, f.status AS flight_status
       FROM checkins c
       JOIN bookings b ON b.id = c.booking_id
       JOIN flights f ON f.id = c.flight_id
       WHERE c.id = $1`,
      [checkinId]
    );
    const row = cur.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Check-in not found.' });
    }

    const flightSt = String(row.flight_status || '').toUpperCase();
    if (!isFlightOpenForBoardingOps(row.flight_status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Boarding updates are not allowed while flight status is ${flightSt}. Open check-in / boarding / gate in Operations first.`
      });
    }

    if (gateAtScan) {
      const gv = assertGateMatchesFlight(row.gate, gateAtScan, { strict: true });
      if (!gv.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: gv.message });
      }
    }

    const prev = String(row.boarding_status || '').toUpperCase();
    if (prev === 'BOARDED') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Passenger already boarded; duplicate update rejected.' });
    }
    if (prev === 'NO_SHOW') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Boarding status is already final (no-show).' });
    }

    if (next === 'BOARDING' && prev !== 'CHECKED_IN') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'BOARDING is only allowed from CHECKED_IN.' });
    }
    if (next === 'BOARDED' && prev !== 'CHECKED_IN' && prev !== 'BOARDING') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'BOARDED is only allowed from CHECKED_IN or BOARDING.' });
    }
    if (next === 'NO_SHOW' && prev === 'BOARDING') {
      /* allowed */
    } else if (next === 'NO_SHOW' && prev !== 'CHECKED_IN' && prev !== 'BOARDING') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'NO_SHOW is only allowed from CHECKED_IN or BOARDING.' });
    }

    const upd = await client.query(
      `UPDATE checkins c
       SET boarding_status = $2::varchar,
           boarded_at = CASE WHEN $2::text = 'BOARDED' THEN COALESCE(c.boarded_at, NOW()) ELSE c.boarded_at END,
           boarding_gate = CASE
             WHEN $2::text = 'BOARDED' THEN COALESCE(c.boarding_gate, NULLIF(btrim(f.gate::text), ''))
             WHEN $2::text = 'BOARDING' AND $3::text IS NOT NULL AND btrim($3::text) <> '' THEN $3::varchar
             ELSE c.boarding_gate
           END
       FROM flights f
       WHERE c.id = $1::uuid AND f.id = c.flight_id
       RETURNING c.boarding_status, c.boarded_at, c.boarding_gate`,
      [checkinId, next, gateAtScan != null ? String(gateAtScan).trim() : null]
    );

    const paxStatus =
      next === 'BOARDED' ? 'BOARDED' : next === 'NO_SHOW' ? 'NO_SHOW' : 'CHECKED_IN';
    if (next !== 'BOARDING') {
      await client.query(`UPDATE passengers SET travel_status = $2 WHERE id = $1`, [row.passenger_id, paxStatus]);
    }

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.userId,
        'BOARDING_STATUS_PATCH',
        'checkins',
        checkinId,
        JSON.stringify({ boardingStatus: next, pnr: row.pnr })
      ]
    );
    await client.query('COMMIT');
    const updated = upd.rows[0];
    return res.status(200).json({
      checkinId,
      boarding_status: updated?.boarding_status || next,
      boarded_at: updated?.boarded_at ?? null,
      boarding_gate: updated?.boarding_gate ?? null
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed to update boarding status.', error: error.message });
  } finally {
    client.release();
  }
});

export default router;
