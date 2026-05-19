import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import {
  ROLES_OPS_FLIGHT_DETAIL,
  ROLES_OPS_READ,
  ROLES_OPS_WRITE
} from '../../lib/airlineRbac.js';
import { recordOccFlightEvent } from '../../services/occFlightEvents.js';
import { assertCrewAssignableForFlight } from '../../services/crewCompliance.js';
import { writeAudit } from '../../services/auditService.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** OCC live phase from row (status + movement timestamps). */
function deriveFlightLive(f) {
  const status = String(f.status || '').toUpperCase();
  let phase = 'PLANNED';
  if (status === 'CANCELLED') phase = 'CANCELLED';
  else if (status === 'ARRIVED' || status === 'LANDED') phase = 'LANDED';
  else if (status === 'IN_AIR') phase = 'AIRBORNE';
  else if (status === 'DEPARTED') phase = 'DEPARTED';
  else if (['CHECKIN_OPEN', 'BOARDING', 'GATE_CLOSED', 'DELAYED', 'SCHEDULED'].includes(status)) phase = 'GROUND';
  const eta = f.eta_current_at || f.arrival_time;
  return {
    phase,
    status,
    eta,
    departedAt: f.actual_off_block_at ?? null,
    airborneAt: f.actual_airborne_at ?? null,
    landedAt: f.actual_landed_at ?? null
  };
}

const occRouter = express.Router();

async function occStatusHandler(_req, res) {
  try {
    await pool.query('SELECT 1 AS ok');
    return res.json({
      status: 'healthy',
      service: 'HAMS OCC',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    return res.status(503).json({
      status: 'unhealthy',
      service: 'HAMS OCC',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
      error: e?.message || 'database unavailable'
    });
  }
}

export const occPublicRouter = express.Router();
occPublicRouter.get('/status', occStatusHandler);

occRouter.get('/status', occStatusHandler);

occRouter.get('/duty-limits', requireAuth, requireRoles(...ROLES_OPS_FLIGHT_DETAIL), async (_req, res) => {
  try {
    const r = await pool.query(`SELECT id, max_block_minutes, min_rest_minutes, max_duty_day_minutes, notes, updated_at FROM occ_duty_limit_config WHERE id = 1`);
    return res.json({ limits: r.rows[0] || null });
  } catch (e) {
    if (e?.code === '42P01') return res.json({ limits: null });
    return res.status(500).json({ message: 'Failed to load duty limits.', error: e.message });
  }
});

occRouter.get('/dashboard', requireAuth, requireRoles(...ROLES_OPS_READ), async (req, res) => {
  const dateStr = req.query.date ? String(req.query.date).slice(0, 10) : new Date().toISOString().slice(0, 10);
  try {
    const r = await pool.query(
      `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time, f.arrival_time,
              f.status, f.gate, f.aircraft_id, f.eta_current_at,
              f.actual_off_block_at, f.actual_airborne_at, f.actual_landed_at,
              a.tail_number, a.model
       FROM flights f
       LEFT JOIN aircraft a ON a.id = f.aircraft_id
       WHERE (f.departure_time AT TIME ZONE 'UTC')::date = $1::date
       ORDER BY f.departure_time ASC`,
      [dateStr]
    );
    const flights = r.rows.map((row) => ({
      ...row,
      live: deriveFlightLive(row)
    }));
    return res.json({ date: dateStr, flights });
  } catch (e) {
    if (e?.code === '42703') {
      return res.status(503).json({
        message: 'OCC flight columns missing (eta_current_at, actual_off_block_at, …). Apply database/occ_control_center.sql.',
        error: e.message
      });
    }
    if (e?.code === '42P01') {
      return res.status(503).json({
        message: 'OCC tables missing. Apply database/occ_control_center.sql then occ_control_center_v2.sql (or backend/scripts/apply-db-fixes.sh).',
        error: e.message
      });
    }
    return res.status(500).json({ message: 'Failed to load OCC dashboard.', error: e.message });
  }
});

occRouter.get('/flights/:flightId/live', requireAuth, requireRoles(...ROLES_OPS_FLIGHT_DETAIL), async (req, res) => {
  const { flightId } = req.params;
  if (!isUuid(flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
  try {
    const r = await pool.query(
      `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time, f.arrival_time,
              f.status, f.gate, f.aircraft_id, f.eta_current_at,
              f.actual_off_block_at, f.actual_airborne_at, f.actual_landed_at,
              a.tail_number, a.model
       FROM flights f
       LEFT JOIN aircraft a ON a.id = f.aircraft_id
       WHERE f.id = $1::uuid`,
      [flightId]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ message: 'Flight not found.' });
    return res.json({ flight: row, live: deriveFlightLive(row) });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to load live flight.', error: e.message });
  }
});

occRouter.post('/flights/:flightId/eta', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  const { flightId } = req.params;
  if (!isUuid(flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
  const raw = req.body?.etaCurrentAt;
  if (raw == null || String(raw).trim() === '') {
    return res.status(400).json({ message: 'etaCurrentAt is required (ISO date/time).' });
  }
  const iso = new Date(raw).toISOString();
  if (Number.isNaN(new Date(iso).getTime())) {
    return res.status(400).json({ message: 'etaCurrentAt must be a valid date/time.' });
  }
  try {
    const u = await pool.query(
      `UPDATE flights SET eta_current_at = $2::timestamptz WHERE id = $1::uuid
       RETURNING id, flight_number, status, departure_time, arrival_time, eta_current_at,
         actual_off_block_at, actual_airborne_at, actual_landed_at`,
      [flightId, iso]
    );
    if (u.rows.length === 0) return res.status(404).json({ message: 'Flight not found.' });
    const row = u.rows[0];
    await recordOccFlightEvent(pool, {
      flightId,
      eventType: 'ETA_UPDATE',
      sourceSystem: 'occ',
      userId: req.user.userId,
      payload: { etaCurrentAt: iso }
    });
    await writeAudit(pool, {
      userId: req.user.userId,
      action: 'OCC_ETA_UPDATE',
      entity: 'flights',
      entityId: flightId,
      metadata: { etaCurrentAt: iso },
      req
    });
    return res.json({ flight: row, live: deriveFlightLive(row) });
  } catch (e) {
    if (e?.code === '42703') {
      return res.status(503).json({ message: 'Flight ETA columns not migrated (eta_current_at).' });
    }
    return res.status(500).json({ message: 'Failed to update ETA.', error: e.message });
  }
});

occRouter.get('/delay-codes', requireAuth, requireRoles(...ROLES_OPS_FLIGHT_DETAIL), async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT code, label, default_cost_usd FROM occ_delay_code_ref ORDER BY code ASC`
    );
    return res.json({ delayCodes: r.rows });
  } catch (e) {
    if (e?.code === '42P01') return res.json({ delayCodes: [] });
    return res.status(500).json({ message: 'Failed to load delay codes.', error: e.message });
  }
});

occRouter.get(
  '/flights/:flightId/timeline',
  requireAuth,
  requireRoles(...ROLES_OPS_FLIGHT_DETAIL),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
    try {
      const r = await pool.query(
        `SELECT id, event_type, source_system, payload_json, created_at, created_by
         FROM occ_flight_event WHERE flight_id = $1::uuid ORDER BY created_at DESC LIMIT 300`,
        [flightId]
      );
      return res.json({ events: r.rows });
    } catch (e) {
      if (e?.code === '42P01') return res.json({ events: [] });
      return res.status(500).json({ message: 'Failed to load OCC timeline.', error: e.message });
    }
  }
);

occRouter.get(
  '/flights/:flightId/rotation',
  requireAuth,
  requireRoles(...ROLES_OPS_FLIGHT_DETAIL),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
    try {
      const cur = await pool.query(
        `SELECT id, aircraft_id, departure_time FROM flights WHERE id = $1::uuid`,
        [flightId]
      );
      const row = cur.rows[0];
      if (!row) return res.status(404).json({ message: 'Flight not found.' });
      if (!row.aircraft_id) return res.json({ rotation: [], message: 'No aircraft assigned.' });
      const r = await pool.query(
        `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time, f.arrival_time, f.status, f.aircraft_id
         FROM flights f
         WHERE f.aircraft_id = $1::uuid
           AND f.departure_time BETWEEN ($2::timestamptz - interval '4 days') AND ($2::timestamptz + interval '4 days')
         ORDER BY f.departure_time ASC`,
        [row.aircraft_id, row.departure_time]
      );
      return res.json({ rotation: r.rows, focusFlightId: flightId });
    } catch (e) {
      return res.status(500).json({ message: 'Failed to load rotation.', error: e.message });
    }
  }
);

occRouter.get(
  '/flights/:flightId/fuel',
  requireAuth,
  requireRoles(...ROLES_OPS_FLIGHT_DETAIL),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
    try {
      const plan = await pool.query(`SELECT * FROM occ_fuel_plan WHERE flight_id = $1::uuid`, [flightId]);
      const upl = await pool.query(
        `SELECT id, uplift_kg, receipt_ref, created_at, recorded_by FROM occ_fuel_uplift WHERE flight_id = $1::uuid ORDER BY created_at DESC`,
        [flightId]
      );
      return res.json({ plan: plan.rows[0] || null, uplifts: upl.rows });
    } catch (e) {
      if (e?.code === '42P01') return res.json({ plan: null, uplifts: [] });
      return res.status(500).json({ message: 'Failed to load fuel data.', error: e.message });
    }
  }
);

occRouter.post(
  '/flights/:flightId/fuel-plan',
  requireAuth,
  requireRoles(...ROLES_OPS_WRITE),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
    const b = req.body || {};
    const nums = ['plannedTripKg', 'taxiKg', 'contingencyKg', 'alternateKg', 'plannedUpliftKg'].map((k) =>
      b[k] != null && Number.isFinite(Number(b[k])) ? Number(b[k]) : null
    );
    try {
      const r = await pool.query(
        `INSERT INTO occ_fuel_plan (
          flight_id, planned_trip_kg, taxi_kg, contingency_kg, alternate_kg, planned_uplift_kg, station, notes, updated_by
        ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid)
        ON CONFLICT (flight_id) DO UPDATE SET
          planned_trip_kg = EXCLUDED.planned_trip_kg,
          taxi_kg = EXCLUDED.taxi_kg,
          contingency_kg = EXCLUDED.contingency_kg,
          alternate_kg = EXCLUDED.alternate_kg,
          planned_uplift_kg = EXCLUDED.planned_uplift_kg,
          station = EXCLUDED.station,
          notes = EXCLUDED.notes,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        RETURNING *`,
        [
          flightId,
          nums[0],
          nums[1],
          nums[2],
          nums[3],
          nums[4],
          b.station ? String(b.station).slice(0, 10) : null,
          b.notes ? String(b.notes).slice(0, 4000) : null,
          req.user.userId
        ]
      );
      await recordOccFlightEvent(pool, {
        flightId,
        eventType: 'FUEL_PLAN_UPDATED',
        sourceSystem: 'occ',
        userId: req.user.userId,
        payload: { plan: r.rows[0] }
      });
      await writeAudit(pool, {
        userId: req.user.userId,
        action: 'OCC_FUEL_PLAN',
        entity: 'flights',
        entityId: flightId,
        metadata: { flightId },
        req
      });
      return res.status(200).json({ plan: r.rows[0] });
    } catch (e) {
      if (e?.code === '42P01') return res.status(503).json({ message: 'OCC schema not applied (occ_fuel_plan).' });
      return res.status(500).json({ message: 'Failed to save fuel plan.', error: e.message });
    }
  }
);

occRouter.post(
  '/flights/:flightId/fuel-uplift',
  requireAuth,
  requireRoles(...ROLES_OPS_WRITE),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
    const kg = Number(req.body?.upliftKg);
    if (!Number.isFinite(kg) || kg <= 0) {
      return res.status(400).json({ message: 'upliftKg must be a positive number.' });
    }
    try {
      const r = await pool.query(
        `INSERT INTO occ_fuel_uplift (flight_id, uplift_kg, receipt_ref, recorded_by)
         VALUES ($1::uuid, $2, $3, $4::uuid) RETURNING *`,
        [flightId, kg, req.body?.receiptRef ? String(req.body.receiptRef).slice(0, 80) : null, req.user.userId]
      );
      await recordOccFlightEvent(pool, {
        flightId,
        eventType: 'FUEL_UPLIFT',
        sourceSystem: 'occ',
        userId: req.user.userId,
        payload: { row: r.rows[0] }
      });
      await writeAudit(pool, {
        userId: req.user.userId,
        action: 'OCC_FUEL_UPLIFT',
        entity: 'flights',
        entityId: flightId,
        metadata: { upliftKg: kg },
        req
      });
      return res.status(201).json({ uplift: r.rows[0] });
    } catch (e) {
      if (e?.code === '42P01') return res.status(503).json({ message: 'OCC schema not applied (occ_fuel_uplift).' });
      return res.status(500).json({ message: 'Failed to record uplift.', error: e.message });
    }
  }
);

occRouter.get(
  '/flights/:flightId/loadsheets',
  requireAuth,
  requireRoles(...ROLES_OPS_FLIGHT_DETAIL),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
    try {
      const r = await pool.query(
        `SELECT id, version, operating_empty_kg, payload_kg, zero_fuel_weight_kg, takeoff_weight_kg, cg_percent_mac, status, signed_at, created_at
         FROM occ_loadsheet WHERE flight_id = $1::uuid ORDER BY version DESC LIMIT 50`,
        [flightId]
      );
      return res.json({ loadsheets: r.rows });
    } catch (e) {
      if (e?.code === '42P01') return res.json({ loadsheets: [] });
      return res.status(500).json({ message: 'Failed to load loadsheets.', error: e.message });
    }
  }
);

occRouter.post(
  '/flights/:flightId/loadsheet',
  requireAuth,
  requireRoles(...ROLES_OPS_WRITE),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
    const b = req.body || {};
    try {
      const v = await pool.query(`SELECT COALESCE(MAX(version), 0) + 1 AS nv FROM occ_loadsheet WHERE flight_id = $1::uuid`, [
        flightId
      ]);
      const version = Number(v.rows[0]?.nv) || 1;
      const r = await pool.query(
        `INSERT INTO occ_loadsheet (
          flight_id, version, operating_empty_kg, payload_kg, zero_fuel_weight_kg, takeoff_weight_kg, cg_percent_mac, status, limits_json, created_by
        ) VALUES (
          $1::uuid, $2, $3, $4, $5, $6, $7, 'DRAFT', $8::jsonb, $9::uuid
        ) RETURNING *`,
        [
          flightId,
          version,
          numOrNull(b.operatingEmptyKg),
          numOrNull(b.payloadKg),
          numOrNull(b.zeroFuelWeightKg),
          numOrNull(b.takeoffWeightKg),
          numOrNull(b.cgPercentMac),
          JSON.stringify(b.limits && typeof b.limits === 'object' ? b.limits : {}),
          req.user.userId
        ]
      );
      await recordOccFlightEvent(pool, {
        flightId,
        eventType: 'LOADSHEET_DRAFT',
        sourceSystem: 'occ',
        userId: req.user.userId,
        payload: { version, id: r.rows[0].id }
      });
      await writeAudit(pool, {
        userId: req.user.userId,
        action: 'OCC_LOADSHEET',
        entity: 'flights',
        entityId: flightId,
        metadata: { version },
        req
      });
      return res.status(201).json({ loadsheet: r.rows[0] });
    } catch (e) {
      if (e?.code === '42P01') return res.status(503).json({ message: 'OCC schema not applied (occ_loadsheet).' });
      return res.status(500).json({ message: 'Failed to create loadsheet.', error: e.message });
    }
  }
);

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

occRouter.get(
  '/flights/:flightId/irops',
  requireAuth,
  requireRoles(...ROLES_OPS_FLIGHT_DETAIL),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
    try {
      const r = await pool.query(
        `SELECT id, category, status, title, narrative, created_at, closed_at, resolution_notes
         FROM occ_irops_case WHERE flight_id = $1::uuid ORDER BY created_at DESC`,
        [flightId]
      );
      return res.json({ cases: r.rows });
    } catch (e) {
      if (e?.code === '42P01') return res.json({ cases: [] });
      return res.status(500).json({ message: 'Failed to load IROPS.', error: e.message });
    }
  }
);

occRouter.post(
  '/flights/:flightId/irops',
  requireAuth,
  requireRoles(...ROLES_OPS_WRITE),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
    const allowedCat = new Set(['MISCONNECT', 'WX', 'MX', 'CREW', 'STATION', 'SECURITY', 'OTHER']);
    const rawCat = String(req.body?.category || '').toUpperCase();
    const cat = allowedCat.has(rawCat) ? rawCat : 'OTHER';
    const title = String(req.body?.title || '').trim();
    if (!title || title.length < 3) {
      return res.status(400).json({ message: 'title is required (min 3 characters).' });
    }
    try {
      const r = await pool.query(
        `INSERT INTO occ_irops_case (flight_id, category, title, narrative, opened_by)
         VALUES ($1::uuid, $2, $3, $4, $5::uuid) RETURNING *`,
        [
          flightId,
          cat,
          title.slice(0, 200),
          req.body?.narrative ? String(req.body.narrative).slice(0, 8000) : null,
          req.user.userId
        ]
      );
      await recordOccFlightEvent(pool, {
        flightId,
        eventType: 'IROPS_OPENED',
        sourceSystem: 'occ',
        userId: req.user.userId,
        payload: { caseId: r.rows[0].id, category: r.rows[0].category }
      });
      await writeAudit(pool, {
        userId: req.user.userId,
        action: 'OCC_IROPS_OPEN',
        entity: 'flights',
        entityId: flightId,
        metadata: { caseId: r.rows[0].id },
        req
      });
      return res.status(201).json({ irops: r.rows[0] });
    } catch (e) {
      if (e?.code === '42P01') return res.status(503).json({ message: 'OCC schema not applied (occ_irops_case).' });
      return res.status(500).json({ message: 'Failed to open IROPS case.', error: e.message });
    }
  }
);

occRouter.patch(
  '/flights/:flightId/irops/:caseId',
  requireAuth,
  requireRoles(...ROLES_OPS_WRITE),
  async (req, res) => {
    const { flightId, caseId } = req.params;
    if (!isUuid(flightId) || !isUuid(caseId)) return res.status(400).json({ message: 'Invalid id.' });
    const nextStatus = String(req.body?.status || '').toUpperCase();
    if (!['OPEN', 'IN_PROGRESS', 'CLOSED'].includes(nextStatus)) {
      return res.status(400).json({ message: 'status must be OPEN, IN_PROGRESS, or CLOSED.' });
    }
    const resolutionNotes =
      req.body?.resolutionNotes != null ? String(req.body.resolutionNotes).slice(0, 8000) : null;
    try {
      const r = await pool.query(
        `UPDATE occ_irops_case SET
          status = $3::varchar,
          closed_at = CASE WHEN $3::varchar = 'CLOSED' THEN COALESCE(closed_at, NOW()) ELSE NULL END,
          resolution_notes = COALESCE($4::text, resolution_notes)
         WHERE id = $2::uuid AND flight_id = $1::uuid
         RETURNING *`,
        [flightId, caseId, nextStatus, resolutionNotes]
      );
      if (!r.rows[0]) return res.status(404).json({ message: 'IROPS case not found for this flight.' });
      await recordOccFlightEvent(pool, {
        flightId,
        eventType: nextStatus === 'CLOSED' ? 'IROPS_CLOSED' : 'IROPS_UPDATED',
        sourceSystem: 'occ',
        userId: req.user.userId,
        payload: { caseId, status: r.rows[0].status }
      });
      await writeAudit(pool, {
        userId: req.user.userId,
        action: 'OCC_IROPS_PATCH',
        entity: 'flights',
        entityId: flightId,
        metadata: { caseId, status: r.rows[0].status },
        req
      });
      return res.json({ irops: r.rows[0] });
    } catch (e) {
      if (e?.code === '42P01') return res.status(503).json({ message: 'OCC schema not applied (occ_irops_case).' });
      return res.status(500).json({ message: 'Failed to update IROPS case.', error: e.message });
    }
  }
);

occRouter.get(
  '/flights/:flightId/slots',
  requireAuth,
  requireRoles(...ROLES_OPS_FLIGHT_DETAIL),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
    try {
      const r = await pool.query(
        `SELECT id, airport, slot_kind, slot_time, coordinator_ref, status, notes, created_at
         FROM occ_slot WHERE flight_id = $1::uuid ORDER BY slot_time ASC`,
        [flightId]
      );
      return res.json({ slots: r.rows });
    } catch (e) {
      if (e?.code === '42P01') return res.json({ slots: [] });
      return res.status(500).json({ message: 'Failed to load slots.', error: e.message });
    }
  }
);

occRouter.post(
  '/flights/:flightId/slots',
  requireAuth,
  requireRoles(...ROLES_OPS_WRITE),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
    const airport = String(req.body?.airport || '').trim().slice(0, 10);
    const kind = String(req.body?.slotKind || '').toUpperCase();
    const slotTime = req.body?.slotTime;
    if (!airport || !['DEP', 'ARR'].includes(kind)) {
      return res.status(400).json({ message: 'airport and slotKind (DEP|ARR) are required.' });
    }
    const st = slotTime && !Number.isNaN(new Date(slotTime).getTime()) ? new Date(slotTime).toISOString() : null;
    if (!st) return res.status(400).json({ message: 'slotTime must be a valid date/time.' });
    const slotStatuses = new Set(['REQUESTED', 'CONFIRMED', 'MISSED', 'CANCELLED']);
    const stRaw = req.body?.status != null ? String(req.body.status).toUpperCase().slice(0, 20) : null;
    const slotStatus = slotStatuses.has(stRaw) ? stRaw : 'REQUESTED';
    try {
      const r = await pool.query(
        `INSERT INTO occ_slot (flight_id, airport, slot_kind, slot_time, coordinator_ref, status, notes)
         VALUES ($1::uuid, $2, $3, $4::timestamptz, $5, $6, $7) RETURNING *`,
        [
          flightId,
          airport,
          kind,
          st,
          req.body?.coordinatorRef ? String(req.body.coordinatorRef).slice(0, 80) : null,
          slotStatus,
          req.body?.notes ? String(req.body.notes).slice(0, 2000) : null
        ]
      );
      await recordOccFlightEvent(pool, {
        flightId,
        eventType: 'SLOT_RECORDED',
        sourceSystem: 'occ',
        userId: req.user.userId,
        payload: { slot: r.rows[0] }
      });
      await writeAudit(pool, {
        userId: req.user.userId,
        action: 'OCC_SLOT_RECORD',
        entity: 'flights',
        entityId: flightId,
        metadata: { slotId: r.rows[0].id, airport, kind },
        req
      });
      return res.status(201).json({ slot: r.rows[0] });
    } catch (e) {
      if (e?.code === '42P01') return res.status(503).json({ message: 'OCC schema not applied (occ_slot).' });
      return res.status(500).json({ message: 'Failed to record slot.', error: e.message });
    }
  }
);

occRouter.get(
  '/stations/:airportCode',
  requireAuth,
  requireRoles(...ROLES_OPS_FLIGHT_DETAIL),
  async (req, res) => {
    const code = String(req.params.airportCode || '').trim().slice(0, 10);
    const dateStr = req.query.date ? String(req.query.date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    if (!code) return res.status(400).json({ message: 'airportCode required.' });
    try {
      const r = await pool.query(
        `SELECT id, airport_code, state_date, ramp_status, notes, updated_at
         FROM occ_station_state
         WHERE upper(trim(airport_code)) = upper(trim($1::text)) AND state_date = $2::date`,
        [code, dateStr]
      );
      return res.json({ station: r.rows[0] || null, date: dateStr });
    } catch (e) {
      if (e?.code === '42P01') return res.json({ station: null, date: dateStr });
      return res.status(500).json({ message: 'Failed to load station state.', error: e.message });
    }
  }
);

occRouter.put(
  '/stations/:airportCode',
  requireAuth,
  requireRoles(...ROLES_OPS_WRITE),
  async (req, res) => {
    const code = String(req.params.airportCode || '').trim().slice(0, 10);
    const dateStr = req.body?.stateDate ? String(req.body.stateDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const ramp = String(req.body?.rampStatus || 'NORMAL').slice(0, 32);
    const notes = req.body?.notes != null ? String(req.body.notes).slice(0, 4000) : null;
    if (!code) return res.status(400).json({ message: 'airportCode required.' });
    try {
      const ins = await pool.query(
        `INSERT INTO occ_station_state (airport_code, state_date, ramp_status, notes, updated_by)
         VALUES ($1, $2::date, $3, $4, $5::uuid) RETURNING *`,
        [code, dateStr, ramp, notes, req.user.userId]
      );
      await writeAudit(pool, {
        userId: req.user.userId,
        action: 'OCC_STATION_STATE',
        entity: 'occ_station_state',
        entityId: ins.rows[0].id,
        metadata: { airportCode: code, stateDate: dateStr, rampStatus: ramp },
        req
      });
      return res.status(201).json({ station: ins.rows[0] });
    } catch (e) {
      if (e?.code === '23505') {
        const upd = await pool.query(
          `UPDATE occ_station_state SET ramp_status = $3, notes = $4, updated_by = $5::uuid, updated_at = NOW()
           WHERE upper(trim(airport_code)) = upper(trim($1::text)) AND state_date = $2::date
           RETURNING *`,
          [code, dateStr, ramp, notes, req.user.userId]
        );
        await writeAudit(pool, {
          userId: req.user.userId,
          action: 'OCC_STATION_STATE',
          entity: 'occ_station_state',
          entityId: upd.rows[0].id,
          metadata: { airportCode: code, stateDate: dateStr, rampStatus: ramp },
          req
        });
        return res.status(200).json({ station: upd.rows[0] });
      }
      if (e?.code === '42P01') return res.status(503).json({ message: 'OCC schema not applied (occ_station_state).' });
      return res.status(500).json({ message: 'Failed to update station.', error: e.message });
    }
  }
);

occRouter.get(
  '/flights/:flightId/crew-legality',
  requireAuth,
  requireRoles(...ROLES_OPS_FLIGHT_DETAIL),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
    try {
      const crew = await pool.query(
        `SELECT ca.crew_user_id, u.full_name, ca.duty_role
         FROM crew_assignments ca JOIN users u ON u.id = ca.crew_user_id WHERE ca.flight_id = $1::uuid`,
        [flightId]
      );
      const checks = [];
      for (const row of crew.rows) {
        const c = await assertCrewAssignableForFlight(pool, { crewUserId: row.crew_user_id, flightId });
        checks.push({
          crewUserId: row.crew_user_id,
          fullName: row.full_name,
          dutyRole: row.duty_role,
          assignable: c.ok,
          message: c.ok ? null : c.message
        });
      }
      return res.json({ crewLegality: checks });
    } catch (e) {
      return res.status(500).json({ message: 'Failed crew legality check.', error: e.message });
    }
  }
);

export function registerOccRoutes(parentRouter) {
  parentRouter.use('/occ', occRouter);
}
