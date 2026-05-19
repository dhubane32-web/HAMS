import express from 'express';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import { ROLES_OPS_READ, ROLES_OPS_WRITE } from '../../lib/airlineRbac.js';
import { pool } from '../../config/db.js';
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  generateFlightsFromSchedules,
  getScheduleCalendar,
  assignAircraft,
  rebuildRotations,
  listRotations,
  getOrCreateDispatchRelease,
  updateDispatchRelease,
  listSlots,
  upsertSlot,
  ensureTurnaroundEvents,
  patchTurnaroundEvent,
  getTurnaroundSummary,
  listOperationalAlerts,
  createOperationalAlert,
  getEnterpriseBoard,
  isMissingSchema,
  schemaHint
} from '../../services/flightOpsEnterpriseService.js';
import {
  getRealtimeFeed,
  detectDayConflicts,
  getAircraftUtilization,
  rescheduleFlight,
  syncConflictAlerts,
  acknowledgeAlert,
  listFlightOpsAudit,
  getTurnaroundLive,
  auditFlightOps,
  cancelEnterpriseFlight
} from '../../services/flightOpsEnterpriseEngine.js';
import {
  validateAssignment,
  listCompatibleAircraft,
  validateScheduleTemplate,
  listRouteTemplates
} from '../../services/flightOpsValidation.js';
import { buildDispatchReleasePdf } from '../../services/dispatchReleasePdf.js';

const router = express.Router();

function handleErr(res, err) {
  if (isMissingSchema(err)) {
    return res.status(503).json({ message: 'Flight ops schema not applied.', hint: schemaHint() });
  }
  const status = err.status || 500;
  return res.status(status).json({ message: err.message || 'Request failed.' });
}

router.get('/health', (_req, res) => {
  res.json({ module: 'flight-ops-enterprise', status: 'ready' });
});

/** Realtime OCC feed — poll every 15–30s from UI. */
router.get('/feed', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const feed = await getRealtimeFeed(req.query.date);
    return res.json(feed);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/board', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const board = await getEnterpriseBoard(req.query.date);
    return res.json(board);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/conflicts', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const pack = await detectDayConflicts(req.query.date);
    return res.json(pack);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.post('/conflicts/scan', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    const result = await syncConflictAlerts(req.body.date || req.query.date, req.user?.userId);
    return res.json(result);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/utilization', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const util = await getAircraftUtilization(req.query.date);
    return res.json(util);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/audit', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const rows = await listFlightOpsAudit({
      entityId: req.query.entityId || req.query.flightId,
      limit: Number(req.query.limit || 40)
    });
    return res.json({ audit: rows });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to load audit trail.', error: e.message });
  }
});

router.get('/routes/templates', requireAuth, requireRoles(...ROLES_OPS_READ), async (_req, res) => {
  try {
    const routes = await listRouteTemplates();
    return res.json({ routes });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to load route templates.', error: e.message });
  }
});

router.post('/schedules/validate', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const result = await validateScheduleTemplate(req.body);
    return res.json(result);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/assignments/compatible', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    if (!req.query.flightId) return res.status(400).json({ message: 'flightId required.' });
    const result = await listCompatibleAircraft(req.query.flightId);
    return res.json(result);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.post('/assignments/validate', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const result = await validateAssignment({
      flightId: req.body.flightId,
      aircraftId: req.body.aircraftId,
      isReserve: req.body.isReserve
    });
    return res.json(result);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.post('/flights/:flightId/cancel', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    const flight = await cancelEnterpriseFlight(
      req.params.flightId,
      req.body.reason || req.body.cancellationReason,
      req.user?.userId,
      req
    );
    return res.json({ flight });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/schedules', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const rows = await listSchedules({
      status: req.query.status,
      from: req.query.from,
      to: req.query.to
    });
    return res.json({ schedules: rows });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/schedules/calendar', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const from = String(req.query.from || new Date().toISOString().slice(0, 10));
    const to = String(req.query.to || from);
    const cal = await getScheduleCalendar({ from, to });
    return res.json(cal);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.post('/schedules', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    const row = await createSchedule(req.body, req.user?.userId, req);
    return res.status(201).json({ schedule: row });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.put('/schedules/:scheduleId', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    const row = await updateSchedule(req.params.scheduleId, req.body, req.user?.userId, req);
    return res.json({ schedule: row });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.delete('/schedules/:scheduleId', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    await deleteSchedule(req.params.scheduleId, req.user?.userId, req);
    return res.json({ ok: true });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.post('/schedules/generate', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    const result = await generateFlightsFromSchedules({
      opsDate: req.body.opsDate || req.body.date,
      scheduleIds: req.body.scheduleIds,
      userId: req.user?.userId,
      req
    });
    return res.json(result);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.patch('/flights/:flightId/reschedule', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    const flight = await rescheduleFlight({
      flightId: req.params.flightId,
      departureTime: req.body.departureTime || req.body.departure_time,
      arrivalTime: req.body.arrivalTime || req.body.arrival_time,
      userId: req.user?.userId,
      req
    });
    return res.json({ flight });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.post('/flights/:flightId/delays', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  const { flightId } = req.params;
  const minutes = Number(req.body.delayMinutes ?? req.body.delay_minutes);
  const reason = String(req.body.reason || '').trim();
  if (!Number.isInteger(minutes) || minutes <= 0 || reason.length < 3) {
    return res.status(400).json({ message: 'delayMinutes (positive) and reason (min 3 chars) required.' });
  }
  try {
    const client = await pool.connect();
    let delay;
    try {
      await client.query('BEGIN');
      const f = await client.query(`SELECT id, status, departure_time FROM flights WHERE id = $1`, [flightId]);
      if (!f.rows[0]) return res.status(404).json({ message: 'Flight not found.' });
      if (String(f.rows[0].status).toUpperCase() === 'CANCELLED') {
        return res.status(400).json({ message: 'Cannot delay cancelled flight.' });
      }
      try {
        delay = await client.query(
          `INSERT INTO flight_delays (flight_id, delay_minutes, reason, reported_by, delay_code, operational_notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            flightId,
            minutes,
            reason,
            req.user?.userId,
            req.body.delayCode || req.body.delay_code || null,
            req.body.operationalNotes || req.body.operational_notes || null
          ]
        );
      } catch (colErr) {
        delay = await client.query(
          `INSERT INTO flight_delays (flight_id, delay_minutes, reason, reported_by)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [flightId, minutes, reason, req.user?.userId]
        );
      }
      const revised = req.body.revisedDepartureTime || req.body.revised_departure_time;
      if (revised) {
        await client.query(
          `UPDATE flights SET status = 'DELAYED', departure_time = $2::timestamptz WHERE id = $1`,
          [flightId, new Date(revised).toISOString()]
        );
      } else {
        await client.query(`UPDATE flights SET status = 'DELAYED' WHERE id = $1`, [flightId]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    await auditFlightOps(req.user?.userId, 'FLIGHT_DELAY', flightId, { delayMinutes: minutes, reason }, req);
    try {
      await pool.query(
        `INSERT INTO operational_alerts (alert_type, severity, flight_id, message, created_by)
         VALUES ('DELAY', 'WARNING', $1, $2, $3)`,
        [flightId, `Delay ${minutes} min: ${reason}`, req.user?.userId]
      );
    } catch {
      /* alerts table optional */
    }
    return res.status(201).json({ delay: delay.rows[0] });
  } catch (e) {
    if (e?.code === '42P01') return handleErr(res, e);
    return res.status(500).json({ message: 'Failed to record delay.', error: e.message });
  }
});

router.get('/rotations', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const rows = await listRotations({
      opsDate: req.query.date,
      aircraftId: req.query.aircraftId
    });
    return res.json({ rotations: rows });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.post('/rotations/rebuild', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    const result = await rebuildRotations(req.body.date || req.query.date, req.user?.userId, req);
    return res.json(result);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.post('/assignments', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    const result = await assignAircraft({
      flightId: req.body.flightId,
      aircraftId: req.body.aircraftId,
      userId: req.user?.userId,
      isReserve: req.body.isReserve,
      autoAssigned: req.body.autoAssign,
      autoReassign: req.body.autoReassign,
      notes: req.body.notes,
      req
    });
    return res.json(result);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/dispatch-releases/flight/:flightId', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const row = await getOrCreateDispatchRelease(req.params.flightId, req.user?.userId);
    return res.json({ release: row });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.put('/dispatch-releases/:releaseId', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    const row = await updateDispatchRelease(req.params.releaseId, req.body, req.user?.userId, req);
    return res.json({ release: row });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/dispatch-releases/:releaseId/pdf', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT dr.*, f.flight_number, f.departure_airport, f.arrival_airport,
              f.departure_time, f.arrival_time, a.tail_number,
              u.email AS dispatcher_email
       FROM dispatch_releases dr
       JOIN flights f ON f.id = dr.flight_id
       LEFT JOIN aircraft a ON a.id = f.aircraft_id
       LEFT JOIN users u ON u.id = dr.dispatcher_id
       WHERE dr.id = $1`,
      [req.params.releaseId]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Release not found.' });
    const dr = r.rows[0];
    const buffer = await buildDispatchReleasePdf({
      releaseNumber: dr.release_number,
      flightNumber: dr.flight_number,
      route: `${dr.departure_airport}→${dr.arrival_airport}`,
      std: dr.departure_time,
      sta: dr.arrival_time,
      tail: dr.tail_number,
      releaseStatus: dr.release_status,
      dispatcher: dr.dispatcher_email,
      releasedAt: dr.released_at,
      weatherNotes: dr.weather_notes,
      melCdlNotes: dr.mel_cdl_notes,
      operationalRemarks: dr.operational_remarks,
      checklist: dr.checklist_json
    });
    await pool.query(`UPDATE dispatch_releases SET pdf_generated_at = NOW() WHERE id = $1`, [dr.id]);
    await auditFlightOps(req.user?.userId, 'DISPATCH_PDF', dr.flight_id, { releaseId: dr.id }, req);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="dispatch-${dr.release_number}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/slots', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    if (!req.query.flightId) return res.status(400).json({ message: 'flightId required.' });
    const rows = await listSlots(req.query.flightId);
    return res.json({ slots: rows });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.post('/slots', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    const row = await upsertSlot(req.body, req.user?.userId);
    return res.status(201).json({ slot: row });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/turnaround/:flightId', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const summary = await getTurnaroundSummary(req.params.flightId);
    return res.json(summary);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/turnaround/:flightId/live', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const live = await getTurnaroundLive(req.params.flightId);
    return res.json(live);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.post('/turnaround/:flightId/init', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    const events = await ensureTurnaroundEvents(req.params.flightId, req.body.stationCode);
    return res.json({ events });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.patch('/turnaround/events/:eventId', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    const row = await patchTurnaroundEvent(req.params.eventId, req.body);
    return res.json({ event: row });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/alerts', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  try {
    const rows = await listOperationalAlerts({
      status: req.query.status || 'OPEN',
      limit: Number(req.query.limit || 50)
    });
    return res.json({ alerts: rows });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.post('/alerts', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    const row = await createOperationalAlert(req.body, req.user?.userId);
    return res.status(201).json({ alert: row });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.patch('/alerts/:alertId/ack', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  try {
    const row = await acknowledgeAlert(req.params.alertId, req.user?.userId);
    return res.json({ alert: row });
  } catch (e) {
    return handleErr(res, e);
  }
});

export function registerFlightOpsEnterpriseRoutes(parentRouter) {
  parentRouter.use('/enterprise', router);
}
