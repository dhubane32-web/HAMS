import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import {
  ROLES_OPS_READ,
  ROLES_OPS_FLIGHTS_LIST,
  ROLES_OPS_FLIGHT_DETAIL,
  ROLES_OPS_WRITE
} from '../../lib/airlineRbac.js';
import {
  assertCrewAssignableForFlight,
  recordDutyAfterAssignment,
  deleteDutyLogForAssignment,
  deleteDutyLogsForFlight
} from '../../services/crewCompliance.js';
import { recordOccFlightEvent, applyStatusWithTracking } from '../../services/occFlightEvents.js';
import { logFinanceTransaction } from '../../services/financeLedger.js';
import { registerOccRoutes } from './occ.js';

const router = express.Router();

const FLIGHT_STATUSES = [
  'SCHEDULED',
  'CHECKIN_OPEN',
  'BOARDING',
  'GATE_CLOSED',
  'DEPARTED',
  'IN_AIR',
  'ARRIVED',
  'DELAYED',
  'CANCELLED'
];

/** Minimum ground time between consecutive flights on the same tail (dispatch / scheduling). */
const MIN_TURNAROUND_MINUTES = 45;

/** Aircraft/crew overlap ignores flights in these terminal states (LANDED kept for legacy rows). */
const TERMINAL_NO_OVERLAP = ['CANCELLED', 'ARRIVED', 'LANDED'];

function sqlFlightNotTerminal(alias = 'f') {
  return `UPPER(TRIM(${alias}.status)) NOT IN ('CANCELLED','ARRIVED','LANDED')`;
}

function assertDispatchReleaseChecklist(body) {
  const c = body?.checklist || {};
  const keys = [
    ['aircraftRelease', 'Aircraft release'],
    ['crewRelease', 'Crew release'],
    ['weatherOk', 'Weather check'],
    ['notamOk', 'NOTAM check'],
    ['captainApproval', 'Captain approval'],
    ['dispatcherApproval', 'Dispatcher approval']
  ];
  const missing = keys.filter(([k]) => !c[k]).map(([, label]) => label);
  if (missing.length) {
    return { ok: false, message: `Dispatch checklist incomplete: confirm ${missing.join(', ')}.` };
  }
  return { ok: true, checklist: Object.fromEntries(keys.map(([k]) => [k, true])) };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function normalizeStatus(s) {
  return String(s || '').trim().toUpperCase();
}

/** OCC-style guardrails for PATCH status (use POST /cancel with a reason to cancel). */
function validateOpsStatusTransition(prevRaw, nextRaw) {
  const p = normalizeStatus(prevRaw);
  const n = normalizeStatus(nextRaw);
  if (p === n) return { ok: true };
  if (p === 'CANCELLED') {
    return { ok: false, message: 'Cancelled flights cannot change status (reopen is not supported).' };
  }
  if (n === 'CANCELLED') {
    return { ok: false, message: 'Use the cancel flight action with a required reason instead of PATCH status.' };
  }
  if (p === 'ARRIVED' && n !== 'ARRIVED') {
    return { ok: false, message: 'Cannot change status after arrival.' };
  }
  const postDep = ['DEPARTED', 'IN_AIR'];
  const preDep = ['SCHEDULED', 'CHECKIN_OPEN', 'BOARDING', 'GATE_CLOSED'];
  if (postDep.includes(p) && preDep.includes(n)) {
    return { ok: false, message: `Cannot revert flight from ${p} to ${n}.` };
  }
  if (n === 'IN_AIR' && !['DEPARTED', 'IN_AIR'].includes(p)) {
    return { ok: false, message: 'IN_AIR is only valid after the aircraft has departed.' };
  }
  if (
    n === 'DEPARTED' &&
    !['CHECKIN_OPEN', 'BOARDING', 'GATE_CLOSED', 'DEPARTED', 'IN_AIR', 'DELAYED'].includes(p)
  ) {
    return { ok: false, message: `DEPARTED is not valid from ${p} — open check-in / boarding / gate first.` };
  }
  return { ok: true };
}

/** Suggest next flight number from recent rows (PREFIX + digits pattern). */
function computeSuggestedFlightNumber(rows) {
  let maxNum = 0;
  let prefix = 'HW';
  let digitWidth = 3;
  for (const row of rows) {
    const raw = String(row?.flight_number || '').trim().toUpperCase();
    const m = raw.match(/^([A-Z]{1,4})(\d{1,5})$/);
    if (!m) continue;
    const n = parseInt(m[2], 10);
    if (!Number.isFinite(n)) continue;
    if (n >= maxNum) {
      maxNum = n;
      prefix = m[1];
      digitWidth = Math.max(3, m[2].length);
    }
  }
  if (maxNum <= 0) return `${prefix}001`;
  const next = maxNum + 1;
  const width = Math.max(digitWidth, String(next).length);
  return `${prefix}${String(next).padStart(width, '0')}`.slice(0, 20);
}

async function findAircraftOverlap(client, { aircraftId, depart, arrive, excludeFlightId, turnaroundMin }) {
  const tmin = Number.isFinite(Number(turnaroundMin)) ? Math.max(0, Math.min(Number(turnaroundMin), 24 * 60)) : MIN_TURNAROUND_MINUTES;
  const r = await client.query(
    `SELECT f.id, f.flight_number, f.departure_time, f.arrival_time
     FROM flights f
     WHERE f.aircraft_id = $1
       AND ($4::uuid IS NULL OR f.id <> $4::uuid)
       AND ${sqlFlightNotTerminal('f')}
       AND f.departure_time < $3::timestamptz + ($5::int * interval '1 minute')
       AND f.arrival_time + ($5::int * interval '1 minute') > $2::timestamptz`,
    [aircraftId, depart, arrive, excludeFlightId || null, tmin]
  );
  return r.rows[0] || null;
}

async function findCrewOverlap(client, { crewUserId, depart, arrive, excludeFlightId }) {
  const r = await client.query(
    `SELECT f.id, f.flight_number, f.departure_time, f.arrival_time
     FROM flights f
     JOIN crew_assignments ca ON ca.flight_id = f.id
     WHERE ca.crew_user_id = $1
       AND ($4::uuid IS NULL OR f.id <> $4::uuid)
       AND ${sqlFlightNotTerminal('f')}
       AND f.departure_time < $3::timestamptz
       AND f.arrival_time > $2::timestamptz`,
    [crewUserId, depart, arrive, excludeFlightId || null]
  );
  return r.rows[0] || null;
}

router.get('/health', (_req, res) => {
  res.json({ module: 'operations', status: 'ready' });
});

async function loadOperationsDashboard(dateStr) {
  const flights = await pool.query(
    `SELECT
      f.id,
      f.flight_number,
      f.departure_airport,
      f.arrival_airport,
      f.departure_time,
      f.arrival_time,
      f.gate,
      f.boarding_time,
      f.status,
      f.aircraft_id,
      f.route_id,
      f.cancellation_reason,
      f.cancelled_at,
      a.tail_number,
      a.model,
      r.label AS route_label
    FROM flights f
    LEFT JOIN aircraft a ON a.id = f.aircraft_id
    LEFT JOIN ops_routes r ON r.id = f.route_id
    WHERE (f.departure_time AT TIME ZONE 'UTC')::date = $1::date
    ORDER BY f.departure_time ASC`,
    [dateStr]
  );
  const byStatus = {};
  for (const s of FLIGHT_STATUSES) byStatus[s] = 0;
  for (const row of flights.rows) {
    const k = normalizeStatus(row.status) || 'SCHEDULED';
    if (byStatus[k] === undefined) byStatus[k] = 0;
    byStatus[k] += 1;
  }
  return { date: dateStr, flights: flights.rows, summaryByStatus: byStatus };
}

router.get(
  '/dashboard/today',
  requireAuth,
  requireRoles(...ROLES_OPS_READ),
  async (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const body = await loadOperationsDashboard(today);
      return res.status(200).json(body);
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load operations dashboard.', error: error.message });
    }
  }
);

router.get(
  '/dashboard',
  requireAuth,
  requireRoles(...ROLES_OPS_READ),
  async (req, res) => {
    const raw = req.query.date ? String(req.query.date).trim().slice(0, 10) : new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return res.status(400).json({ message: 'Invalid date. Use date=YYYY-MM-DD (UTC calendar date for departures).' });
    }
    try {
      const body = await loadOperationsDashboard(raw);
      return res.status(200).json(body);
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load operations dashboard.', error: error.message });
    }
  }
);

router.get(
  '/routes',
  requireAuth,
  requireRoles(...ROLES_OPS_READ),
  async (req, res) => {
    const activeOnly = String(req.query.active || '').toLowerCase() === 'true';
    try {
      const r = await pool.query(
        `SELECT id, origin_airport, dest_airport, label, is_active, created_at
         FROM ops_routes
         ${activeOnly ? 'WHERE is_active = TRUE' : ''}
         ORDER BY origin_airport, dest_airport`
      );
      return res.status(200).json({ routes: r.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to list routes.', error: error.message });
    }
  }
);

router.post(
  '/routes',
  requireAuth,
  requireRoles(...ROLES_OPS_WRITE),
  async (req, res) => {
    const { originAirport, destAirport, label } = req.body;
    const o = String(originAirport || '').trim().toUpperCase();
    const d = String(destAirport || '').trim().toUpperCase();
    if (!o || !d || o === d) {
      return res.status(400).json({ message: 'originAirport and destAirport are required and must differ.' });
    }
    try {
      const dup = await pool.query(
        `SELECT id FROM ops_routes WHERE upper(origin_airport) = upper($1) AND upper(dest_airport) = upper($2)`,
        [o, d]
      );
      if (dup.rowCount > 0) {
        return res.status(409).json({ message: 'This route already exists.' });
      }
      const ins = await pool.query(
        `INSERT INTO ops_routes (origin_airport, dest_airport, label)
         VALUES ($1, $2, $3)
         RETURNING id, origin_airport, dest_airport, label, is_active, created_at`,
        [o, d, label ? String(label).trim().slice(0, 160) : null]
      );
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.userId, 'OPS_ROUTE_CREATED', 'ops_routes', ins.rows[0].id, JSON.stringify({ origin: o, dest: d })]
      );
      return res.status(201).json({ route: ins.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to create route.', error: error.message });
    }
  }
);

router.put(
  '/routes/:routeId',
  requireAuth,
  requireRoles(...ROLES_OPS_WRITE),
  async (req, res) => {
    const { routeId } = req.params;
    if (!isUuid(routeId)) {
      return res.status(400).json({ message: 'Invalid route id.' });
    }
    const { label, isActive } = req.body;
    if (label === undefined && isActive === undefined) {
      return res.status(400).json({ message: 'Provide label and/or isActive.' });
    }
    try {
      const cur = await pool.query(`SELECT id, label, is_active FROM ops_routes WHERE id = $1`, [routeId]);
      if (!cur.rows[0]) {
        return res.status(404).json({ message: 'Route not found.' });
      }
      const nextLabel = label !== undefined ? String(label).trim().slice(0, 160) : cur.rows[0].label;
      const nextActive = isActive !== undefined ? Boolean(isActive) : cur.rows[0].is_active;
      const upd = await pool.query(
        `UPDATE ops_routes SET label = $2, is_active = $3 WHERE id = $1
         RETURNING id, origin_airport, dest_airport, label, is_active, created_at`,
        [routeId, nextLabel || null, nextActive]
      );
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.userId, 'OPS_ROUTE_UPDATED', 'ops_routes', routeId, JSON.stringify({ label: nextLabel, isActive: nextActive })]
      );
      return res.status(200).json({ route: upd.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to update route.', error: error.message });
    }
  }
);

router.delete(
  '/routes/:routeId',
  requireAuth,
  requireRoles(...ROLES_OPS_WRITE),
  async (req, res) => {
    const { routeId } = req.params;
    if (!isUuid(routeId)) {
      return res.status(400).json({ message: 'Invalid route id.' });
    }
    try {
      const inUse = await pool.query(`SELECT 1 FROM flights WHERE route_id = $1 LIMIT 1`, [routeId]);
      if (inUse.rowCount > 0) {
        await pool.query(`UPDATE ops_routes SET is_active = FALSE WHERE id = $1`, [routeId]);
        return res.status(200).json({ message: 'Route has flights; deactivated instead of delete.', softDeleted: true });
      }
      await pool.query(`DELETE FROM ops_routes WHERE id = $1`, [routeId]);
      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ message: 'Failed to delete route.', error: error.message });
    }
  }
);

router.get(
  '/flights',
  requireAuth,
  requireRoles(...ROLES_OPS_FLIGHTS_LIST),
  async (req, res) => {
    const queryDate = req.query.date ? String(req.query.date) : null;

    try {
      const values = [];
      let whereClause = '';
      if (queryDate) {
        values.push(queryDate);
        whereClause = `WHERE (f.departure_time AT TIME ZONE 'UTC')::date = $1::date`;
      }

      const flights = await pool.query(
        `SELECT
          f.id,
          f.flight_number,
          f.departure_airport,
          f.arrival_airport,
          f.departure_time,
          f.arrival_time,
          f.gate,
          f.boarding_time,
          f.status,
          f.aircraft_id,
          f.route_id,
          f.cancellation_reason,
          f.cancelled_at,
          a.tail_number,
          a.model,
          r.label AS route_label
        FROM flights f
        LEFT JOIN aircraft a ON a.id = f.aircraft_id
        LEFT JOIN ops_routes r ON r.id = f.route_id
        ${whereClause}
        ORDER BY f.departure_time ASC`,
        values
      );

      return res.status(200).json({ flights: flights.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to retrieve flights.', error: error.message });
    }
  }
);

router.get(
  '/flights/suggest-flight-number',
  requireAuth,
  requireRoles(...ROLES_OPS_WRITE),
  async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT flight_number
         FROM flights
         WHERE flight_number IS NOT NULL AND TRIM(flight_number) <> ''
         ORDER BY created_at DESC NULLS LAST
         LIMIT 500`
      );
      const suggestedFlightNumber = computeSuggestedFlightNumber(r.rows);
      return res.status(200).json({ suggestedFlightNumber });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to suggest flight number.', error: error.message });
    }
  }
);

/** Recent flights for scheduling UI (newest departures first). */
router.get(
  '/flights/recent',
  requireAuth,
  requireRoles(...ROLES_OPS_READ),
  async (req, res) => {
    const raw = parseInt(String(req.query.limit || '40'), 10);
    const limit = Number.isFinite(raw) ? Math.min(100, Math.max(5, raw)) : 40;
    try {
      const flights = await pool.query(
        `SELECT
          f.id,
          f.flight_number,
          f.departure_airport,
          f.arrival_airport,
          f.departure_time,
          f.arrival_time,
          f.gate,
          f.boarding_time,
          f.status,
          f.aircraft_id,
          f.route_id,
          f.cancellation_reason,
          f.cancelled_at,
          a.tail_number,
          a.model,
          r.label AS route_label
        FROM flights f
        LEFT JOIN aircraft a ON a.id = f.aircraft_id
        LEFT JOIN ops_routes r ON r.id = f.route_id
        ORDER BY f.departure_time DESC
        LIMIT $1`,
        [limit]
      );
      return res.status(200).json({ flights: flights.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load recent flights.', error: error.message });
    }
  }
);

router.get('/aircraft', requireAuth, requireRoles(...ROLES_OPS_READ), async (_req, res) => {
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

router.get('/crew', requireAuth, requireRoles(...ROLES_OPS_READ), async (_req, res) => {
  try {
    const crew = await pool.query(
      `SELECT id, full_name, email, role
       FROM users
       WHERE role = 'crew'::user_role
       ORDER BY full_name ASC`
    );
    return res.status(200).json({ crew: crew.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to retrieve crew members.', error: error.message });
  }
});

router.post('/flights', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  const {
    flightNumber,
    routeId,
    departureTime,
    arrivalTime,
    aircraftId,
    gate,
    boardingTime,
    departureAirport,
    arrivalAirport
  } = req.body;

  if (!flightNumber || !departureTime || !arrivalTime || !aircraftId) {
    return res.status(400).json({
      message: 'flightNumber, departureTime, arrivalTime, and aircraftId are required. routeId is required unless departureAirport and arrivalAirport are provided.'
    });
  }
  if (!isUuid(aircraftId)) {
    return res.status(400).json({ message: 'Invalid aircraftId.' });
  }

  const dep = new Date(departureTime);
  const arr = new Date(arrivalTime);
  if (!(dep instanceof Date) || Number.isNaN(dep.getTime()) || !(arr instanceof Date) || Number.isNaN(arr.getTime())) {
    return res.status(400).json({ message: 'departureTime and arrivalTime must be valid datetimes.' });
  }
  if (arr <= dep) {
    return res.status(400).json({ message: 'Arrival time must be after departure time.' });
  }

  const gateVal = gate != null ? String(gate).trim().slice(0, 10) || null : null;
  const boardingVal = boardingTime ? new Date(boardingTime).toISOString() : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let origin = String(departureAirport || '').trim().toUpperCase();
    let dest = String(arrivalAirport || '').trim().toUpperCase();
    let resolvedRouteId = routeId && isUuid(String(routeId)) ? String(routeId) : null;

    if (resolvedRouteId) {
      const rt = await client.query(
        `SELECT id, origin_airport, dest_airport FROM ops_routes WHERE id = $1 AND is_active = TRUE`,
        [resolvedRouteId]
      );
      if (!rt.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Active route not found for routeId.' });
      }
      origin = String(rt.rows[0].origin_airport).toUpperCase();
      dest = String(rt.rows[0].dest_airport).toUpperCase();
    } else {
      if (!origin || !dest || origin === dest) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: 'Provide routeId, or both departureAirport and arrivalAirport (distinct IATA codes).'
        });
      }
    }

    const ac = await client.query(`SELECT id, release_status FROM aircraft WHERE id = $1`, [aircraftId]);
    if (!ac.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Aircraft not found.' });
    }
    if (ac.rows[0].release_status !== 'RELEASED') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Aircraft is not released for operations.' });
    }

    const overlap = await findAircraftOverlap(client, {
      aircraftId,
      depart: dep.toISOString(),
      arrive: arr.toISOString(),
      excludeFlightId: null
    });
    if (overlap) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: `Aircraft conflicts with flight ${overlap.flight_number} (includes ${MIN_TURNAROUND_MINUTES} min turnaround buffer).`,
        conflictingFlightId: overlap.id
      });
    }

    const insert = await client.query(
      `INSERT INTO flights (
        flight_number,
        departure_airport,
        arrival_airport,
        departure_time,
        arrival_time,
        gate,
        boarding_time,
        status,
        aircraft_id,
        route_id,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, flight_number, departure_airport, arrival_airport, departure_time, arrival_time, gate, boarding_time, status, aircraft_id, route_id`,
      [
        String(flightNumber).toUpperCase(),
        origin,
        dest,
        dep.toISOString(),
        arr.toISOString(),
        gateVal,
        boardingVal,
        'SCHEDULED',
        aircraftId,
        resolvedRouteId,
        req.user.userId
      ]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.userId,
        'FLIGHT_SCHEDULED',
        'flights',
        insert.rows[0].id,
        JSON.stringify({
          flightNumber: String(flightNumber).toUpperCase(),
          routeId: resolvedRouteId,
          aircraftId
        })
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json({ flight: insert.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed to schedule flight.', error: error.message });
  } finally {
    client.release();
  }
});

router.put('/flights/:flightId', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  const { flightId } = req.params;
  if (!isUuid(flightId)) {
    return res.status(400).json({ message: 'Invalid flight id.' });
  }
  const { departureTime, arrivalTime, flightNumber, gate, boardingTime, routeId: newRouteId } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT id, aircraft_id, departure_time, arrival_time, status, flight_number, gate, boarding_time, route_id,
              departure_airport, arrival_airport
       FROM flights WHERE id = $1`,
      [flightId]
    );
    const f = cur.rows[0];
    if (!f) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Flight not found.' });
    }
    if (normalizeStatus(f.status) === 'CANCELLED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Cannot modify a cancelled flight.' });
    }

    let dep = f.departure_time;
    let arr = f.arrival_time;
    if (departureTime) dep = new Date(departureTime).toISOString();
    if (arrivalTime) arr = new Date(arrivalTime).toISOString();
    if (new Date(arr) <= new Date(dep)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Arrival must be after departure.' });
    }

    let routeIdNext = f.route_id;
    let origin = f.departure_airport;
    let dest = f.arrival_airport;
    if (newRouteId && isUuid(String(newRouteId))) {
      const rt = await client.query(
        `SELECT id, origin_airport, dest_airport FROM ops_routes WHERE id = $1 AND is_active = TRUE`,
        [newRouteId]
      );
      if (!rt.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Route not found or inactive.' });
      }
      routeIdNext = rt.rows[0].id;
      origin = String(rt.rows[0].origin_airport).toUpperCase();
      dest = String(rt.rows[0].dest_airport).toUpperCase();
    }

    if (f.aircraft_id) {
      const overlap = await findAircraftOverlap(client, {
        aircraftId: f.aircraft_id,
        depart: dep,
        arrive: arr,
        excludeFlightId: flightId
      });
      if (overlap) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: `Aircraft would conflict with flight ${overlap.flight_number} (includes ${MIN_TURNAROUND_MINUTES} min turnaround buffer).`,
          conflictingFlightId: overlap.id
        });
      }
    }

    const fn = flightNumber != null ? String(flightNumber).toUpperCase().slice(0, 20) : f.flight_number;
    const gateNext = gate !== undefined ? (gate == null ? null : String(gate).trim().slice(0, 10) || null) : f.gate;
    const boardNext =
      boardingTime !== undefined
        ? boardingTime
          ? new Date(boardingTime).toISOString()
          : null
        : f.boarding_time;

    const upd = await client.query(
      `UPDATE flights SET
        departure_time = $2,
        arrival_time = $3,
        flight_number = $4,
        gate = $5,
        boarding_time = $6,
        route_id = $7,
        departure_airport = $8,
        arrival_airport = $9
       WHERE id = $1
       RETURNING id, flight_number, departure_airport, arrival_airport, departure_time, arrival_time, gate, boarding_time, status, aircraft_id, route_id`,
      [flightId, dep, arr, fn, gateNext, boardNext, routeIdNext, origin, dest]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.userId, 'FLIGHT_UPDATED', 'flights', flightId, JSON.stringify({ departureTime: dep, arrivalTime: arr })]
    );

    await client.query('COMMIT');
    return res.status(200).json({ flight: upd.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed to update flight.', error: error.message });
  } finally {
    client.release();
  }
});

router.patch('/flights/:flightId/status', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  const { flightId } = req.params;
  const { status } = req.body;
  if (!isUuid(flightId)) {
    return res.status(400).json({ message: 'Invalid flight id.' });
  }
  const next = normalizeStatus(status);
  if (!FLIGHT_STATUSES.includes(next)) {
    return res.status(400).json({ message: `status must be one of: ${FLIGHT_STATUSES.join(', ')}` });
  }
  try {
    const cur = await pool.query(`SELECT status FROM flights WHERE id = $1`, [flightId]);
    if (!cur.rows[0]) {
      return res.status(404).json({ message: 'Flight not found.' });
    }
    if (normalizeStatus(cur.rows[0].status) === 'CANCELLED') {
      return res.status(400).json({ message: 'Cannot change status of a cancelled flight.' });
    }
    const transition = validateOpsStatusTransition(cur.rows[0].status, next);
    if (!transition.ok) {
      return res.status(400).json({ message: transition.message });
    }
    const etaBody = req.body?.etaCurrentAt;
    const upd = await applyStatusWithTracking(pool, {
      flightId,
      nextStatus: next,
      etaCurrentAt: etaBody
    });
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.userId, 'FLIGHT_STATUS_SET', 'flights', flightId, JSON.stringify({ status: next, etaCurrentAt: etaBody || null })]
    );
    await recordOccFlightEvent(pool, {
      flightId,
      eventType: 'FLIGHT_STATUS',
      sourceSystem: 'occ',
      userId: req.user.userId,
      payload: { status: next, etaCurrentAt: etaBody || null }
    });
    return res.status(200).json({ flight: upd.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update flight status.', error: error.message });
  }
});

router.post('/flights/:flightId/cancel', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  const { flightId } = req.params;
  const { reason } = req.body;
  if (!isUuid(flightId)) {
    return res.status(400).json({ message: 'Invalid flight id.' });
  }
  const r = String(reason || '').trim();
  if (r.length < 3) {
    return res.status(400).json({ message: 'cancellation reason is required (min 3 characters).' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT status FROM flights WHERE id = $1`, [flightId]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Flight not found.' });
    }
    if (normalizeStatus(cur.rows[0].status) === 'CANCELLED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Flight is already cancelled.' });
    }
    const upd = await client.query(
      `UPDATE flights
       SET status = 'CANCELLED',
           cancellation_reason = $2,
           cancelled_at = NOW(),
           aircraft_id = NULL
       WHERE id = $1
       RETURNING id, flight_number, status, cancellation_reason, cancelled_at`,
      [flightId, r.slice(0, 2000)]
    );
    await client.query(`DELETE FROM crew_assignments WHERE flight_id = $1`, [flightId]);
    await deleteDutyLogsForFlight(client, flightId);
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.userId, 'FLIGHT_CANCELLED', 'flights', flightId, JSON.stringify({ reason: r.slice(0, 200) })]
    );
    await recordOccFlightEvent(client, {
      flightId,
      eventType: 'FLIGHT_CANCELLED',
      sourceSystem: 'occ',
      userId: req.user.userId,
      payload: { reason: r.slice(0, 500) }
    });
    await client.query('COMMIT');
    return res.status(200).json({ flight: upd.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed to cancel flight.', error: error.message });
  } finally {
    client.release();
  }
});

router.post('/flights/:flightId/assign-aircraft', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  const { flightId } = req.params;
  const { aircraftId } = req.body;

  if (!isUuid(flightId) || !aircraftId || !isUuid(String(aircraftId))) {
    return res.status(400).json({ message: 'Valid flightId and aircraftId are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const aircraftResult = await client.query(
      `SELECT id, tail_number, release_status
       FROM aircraft
       WHERE id = $1`,
      [aircraftId]
    );
    const aircraft = aircraftResult.rows[0];
    if (!aircraft) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Aircraft not found.' });
    }
    if (aircraft.release_status !== 'RELEASED') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Aircraft is not released for operations.' });
    }

    const flRow = await client.query(
      `SELECT id, departure_time, arrival_time, status FROM flights WHERE id = $1`,
      [flightId]
    );
    const fl = flRow.rows[0];
    if (!fl) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Flight not found.' });
    }
    if (normalizeStatus(fl.status) === 'CANCELLED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Cannot assign aircraft to a cancelled flight.' });
    }

    const overlap = await findAircraftOverlap(client, {
      aircraftId,
      depart: fl.departure_time,
      arrive: fl.arrival_time,
      excludeFlightId: flightId
    });
    if (overlap) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: `Aircraft conflicts with flight ${overlap.flight_number} (includes ${MIN_TURNAROUND_MINUTES} min turnaround buffer).`,
        conflictingFlightId: overlap.id
      });
    }

    const flightResult = await client.query(
      `UPDATE flights
       SET aircraft_id = $1
       WHERE id = $2
       RETURNING id, flight_number, aircraft_id`,
      [aircraftId, flightId]
    );
    const flight = flightResult.rows[0];

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.userId,
        'AIRCRAFT_ASSIGNED',
        'flights',
        flight.id,
        JSON.stringify({ aircraftId, tailNumber: aircraft.tail_number })
      ]
    );

    await client.query('COMMIT');
    await recordOccFlightEvent(pool, {
      flightId,
      eventType: 'AIRCRAFT_ASSIGNED',
      sourceSystem: 'maintenance',
      userId: req.user.userId,
      payload: { aircraftId, tailNumber: aircraft.tail_number }
    });
    return res.status(200).json({
      message: 'Aircraft assigned successfully.',
      flight
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed to assign aircraft.', error: error.message });
  } finally {
    client.release();
  }
});

router.post('/flights/:flightId/assign-crew', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  const { flightId } = req.params;
  const { crewUserId, dutyRole } = req.body;

  if (!isUuid(flightId) || !crewUserId || !isUuid(String(crewUserId)) || !dutyRole) {
    return res.status(400).json({ message: 'flightId, crewUserId, and dutyRole are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const crewResult = await client.query(
      `SELECT id, full_name, role
       FROM users
       WHERE id = $1`,
      [crewUserId]
    );
    const crew = crewResult.rows[0];
    if (!crew) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Crew user not found.' });
    }
    if (crew.role !== 'crew') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Selected user is not a crew role.' });
    }

    const flRow = await client.query(
      `SELECT id, departure_time, arrival_time, status FROM flights WHERE id = $1`,
      [flightId]
    );
    const fl = flRow.rows[0];
    if (!fl) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Flight not found.' });
    }
    if (normalizeStatus(fl.status) === 'CANCELLED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Cannot assign crew to a cancelled flight.' });
    }

    const overlap = await findCrewOverlap(client, {
      crewUserId,
      depart: fl.departure_time,
      arrive: fl.arrival_time,
      excludeFlightId: flightId
    });
    if (overlap) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: `Crew member is already assigned to overlapping flight ${overlap.flight_number}.`,
        conflictingFlightId: overlap.id
      });
    }

    const compliance = await assertCrewAssignableForFlight(client, { crewUserId, flightId });
    if (!compliance.ok) {
      await client.query('ROLLBACK');
      return res.status(compliance.status).json({ message: compliance.message });
    }

    const assignment = await client.query(
      `INSERT INTO crew_assignments (flight_id, crew_user_id, duty_role)
       VALUES ($1, $2, $3)
       ON CONFLICT (flight_id, crew_user_id)
       DO UPDATE SET duty_role = EXCLUDED.duty_role, assigned_at = NOW()
       RETURNING id, flight_id, crew_user_id, duty_role, assigned_at`,
      [flightId, crewUserId, String(dutyRole).slice(0, 50)]
    );

    await recordDutyAfterAssignment(client, { crewUserId, flightId });

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.userId,
        'CREW_ASSIGNED',
        'flights',
        flightId,
        JSON.stringify({ crewUserId, dutyRole })
      ]
    );

    await client.query('COMMIT');
    await recordOccFlightEvent(pool, {
      flightId,
      eventType: 'CREW_ASSIGNED',
      sourceSystem: 'crew',
      userId: req.user.userId,
      payload: { crewUserId, dutyRole, assignmentId: assignment.rows[0].id }
    });
    return res.status(200).json({
      message: 'Crew assignment saved.',
      assignment: assignment.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed to assign crew.', error: error.message });
  } finally {
    client.release();
  }
});

router.delete(
  '/flights/:flightId/crew/:assignmentId',
  requireAuth,
  requireRoles(...ROLES_OPS_WRITE),
  async (req, res) => {
    const { flightId, assignmentId } = req.params;
    if (!isUuid(flightId) || !isUuid(assignmentId)) {
      return res.status(400).json({ message: 'Invalid ids.' });
    }
    try {
      const r = await pool.query(
        `DELETE FROM crew_assignments WHERE id = $1 AND flight_id = $2 RETURNING id, crew_user_id`,
        [assignmentId, flightId]
      );
      if (r.rowCount === 0) {
        return res.status(404).json({ message: 'Assignment not found on this flight.' });
      }
      const removed = r.rows[0];
      await deleteDutyLogForAssignment(pool, { crewUserId: removed.crew_user_id, flightId });
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.userId, 'CREW_UNASSIGNED', 'flights', flightId, JSON.stringify({ assignmentId })]
      );
      await recordOccFlightEvent(pool, {
        flightId,
        eventType: 'CREW_UNASSIGNED',
        sourceSystem: 'crew',
        userId: req.user.userId,
        payload: { assignmentId, crewUserId: removed.crew_user_id }
      });
      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ message: 'Failed to remove crew assignment.', error: error.message });
    }
  }
);

router.post('/flights/:flightId/dispatch', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  const { flightId } = req.params;
  if (!isUuid(flightId)) {
    return res.status(400).json({ message: 'Invalid flight id.' });
  }
  const { dispatchStatus, remarks } = req.body;
  let status = normalizeStatus(dispatchStatus);
  if (status === 'DISPATCHED') {
    status = 'DEPARTED';
  }
  if (!status || !FLIGHT_STATUSES.includes(status)) {
    return res.status(400).json({
      message: `dispatchStatus must be one of: ${FLIGHT_STATUSES.join(', ')} (legacy DISPATCHED maps to DEPARTED).`
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cur = await client.query(`SELECT status FROM flights WHERE id = $1`, [flightId]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Flight not found.' });
    }
    if (normalizeStatus(cur.rows[0].status) === 'CANCELLED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Cannot dispatch a cancelled flight.' });
    }
    if (status === 'CANCELLED') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Use the cancel flight action with a required reason instead of setting status to CANCELLED here.'
      });
    }
    const dispatchTransition = validateOpsStatusTransition(cur.rows[0].status, status);
    if (!dispatchTransition.ok) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: dispatchTransition.message });
    }

    const flightResult = await applyStatusWithTracking(client, { flightId, nextStatus: status, etaCurrentAt: null });
    const flight = flightResult.rows[0];

    const dispatchResult = await client.query(
      `INSERT INTO dispatch_logs (flight_id, dispatch_status, remarks, dispatched_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, flight_id, dispatch_status, remarks, dispatched_at`,
      [flightId, status, remarks || null, req.user.userId]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.userId,
        'FLIGHT_DISPATCH_UPDATED',
        'flights',
        flightId,
        JSON.stringify({ dispatchStatus: status, remarks: remarks || '' })
      ]
    );

    await client.query('COMMIT');
    await recordOccFlightEvent(pool, {
      flightId,
      eventType: 'DISPATCH_STATUS',
      sourceSystem: 'occ',
      userId: req.user.userId,
      payload: { status, remarks: remarks || null }
    });
    return res.status(200).json({
      message: 'Dispatch log created.',
      dispatch: dispatchResult.rows[0],
      flight
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed to update dispatch.', error: error.message });
  } finally {
    client.release();
  }
});

router.post('/flights/:flightId/dispatch-release', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  const { flightId } = req.params;
  const { remarks, checklist } = req.body;
  if (!isUuid(flightId)) {
    return res.status(400).json({ message: 'Invalid flight id.' });
  }
  const checklistResult = assertDispatchReleaseChecklist(req.body);
  if (!checklistResult.ok) {
    return res.status(400).json({ message: checklistResult.message });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT id, status, aircraft_id, route_id, departure_airport, gate, departure_time FROM flights WHERE id = $1`,
      [flightId]
    );
    const row = cur.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Flight not found.' });
    }
    if (normalizeStatus(row.status) === 'CANCELLED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Flight is cancelled.' });
    }
    if (!row.aircraft_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Assign aircraft before dispatch release.' });
    }
    if (!row.route_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Flight must be linked to a route (route_id).' });
    }
    const ac = await client.query(`SELECT release_status FROM aircraft WHERE id = $1`, [row.aircraft_id]);
    if (!ac.rows[0] || String(ac.rows[0].release_status) !== 'RELEASED') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Aircraft must be maintenance-released before dispatch release.' });
    }

    const st = normalizeStatus(row.status);
    let nextStatus = 'CHECKIN_OPEN';
    if (['BOARDING', 'GATE_CLOSED', 'DEPARTED', 'IN_AIR', 'ARRIVED'].includes(st)) {
      nextStatus = st;
    }

    const upd = await client.query(
      `UPDATE flights SET status = $2::varchar WHERE id = $1 RETURNING id, flight_number, status`,
      [flightId, nextStatus]
    );
    const checklistJson = JSON.stringify(checklistResult.checklist);
    try {
      await client.query(
        `INSERT INTO dispatch_logs (flight_id, dispatch_status, remarks, dispatched_by, checklist_json)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          flightId,
          'RELEASED',
          remarks || 'Dispatch release — pre-departure checklist complete',
          req.user.userId,
          checklistJson
        ]
      );
    } catch (e) {
      if (e && e.code === '42703') {
        await client.query(
          `INSERT INTO dispatch_logs (flight_id, dispatch_status, remarks, dispatched_by)
           VALUES ($1, $2, $3, $4)`,
          [flightId, 'RELEASED', remarks || 'Dispatch release — pre-departure checklist complete', req.user.userId]
        );
      } else {
        throw e;
      }
    }
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.userId,
        'DISPATCH_RELEASE',
        'flights',
        flightId,
        JSON.stringify({ checklist: checklistResult.checklist, nextStatus })
      ]
    );
    await recordOccFlightEvent(client, {
      flightId,
      eventType: 'DISPATCH_RELEASE',
      sourceSystem: 'occ',
      userId: req.user.userId,
      payload: { nextStatus, checklist: checklistResult.checklist }
    });
    await client.query('COMMIT');
    return res.status(200).json({
      flight: upd.rows[0],
      message:
        nextStatus === 'CHECKIN_OPEN'
          ? 'Dispatch release complete — check-in may open for this flight.'
          : 'Dispatch release logged; flight already in advanced status.'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed dispatch release.', error: error.message });
  } finally {
    client.release();
  }
});

router.post('/flights/:flightId/delays', requireAuth, requireRoles(...ROLES_OPS_WRITE), async (req, res) => {
  const { flightId } = req.params;
  if (!isUuid(flightId)) {
    return res.status(400).json({ message: 'Invalid flight id.' });
  }
  const { delayMinutes, reason, revisedDepartureTime, operationalNotes, delayCode, costImpactUsd } = req.body;
  const minutes = Number(delayMinutes);
  const notesTrim =
    operationalNotes != null ? String(operationalNotes).trim().slice(0, 4000) : null;
  const revisedIso =
    revisedDepartureTime != null && String(revisedDepartureTime).trim()
      ? new Date(String(revisedDepartureTime)).toISOString()
      : null;
  const delayCodeNorm = delayCode != null ? String(delayCode).trim().slice(0, 16).toUpperCase() : null;
  let costImpact =
    costImpactUsd != null && Number.isFinite(Number(costImpactUsd)) ? Number(costImpactUsd) : null;

  if (!Number.isInteger(minutes) || minutes <= 0 || !reason || String(reason).trim().length < 3) {
    return res.status(400).json({ message: 'delayMinutes (positive integer) and reason (min 3 chars) are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cur = await client.query(
      `SELECT id, status, departure_time, arrival_time FROM flights WHERE id = $1 FOR UPDATE`,
      [flightId]
    );
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Flight not found.' });
    }
    if (normalizeStatus(cur.rows[0].status) === 'CANCELLED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Cannot delay a cancelled flight.' });
    }

    if (delayCodeNorm && costImpact == null) {
      try {
        const dc = await client.query(`SELECT default_cost_usd FROM occ_delay_code_ref WHERE code = $1`, [delayCodeNorm]);
        if (dc.rows[0]) costImpact = Number(dc.rows[0].default_cost_usd);
      } catch {
        /* ref table optional until migration */
      }
    }

    let newDepIso = null;
    let newArrIso = null;
    if (revisedIso && !Number.isNaN(new Date(revisedIso).getTime())) {
      const oldDep = new Date(cur.rows[0].departure_time);
      const oldArr = new Date(cur.rows[0].arrival_time);
      const newDep = new Date(revisedIso);
      if (newDep > oldDep) {
        const legMs = oldArr.getTime() - oldDep.getTime();
        newDepIso = newDep.toISOString();
        newArrIso = new Date(newDep.getTime() + legMs).toISOString();
      }
    }

    const flightResult = await client.query(
      `UPDATE flights
       SET status = 'DELAYED',
           departure_time = COALESCE($2::timestamptz, departure_time),
           arrival_time = COALESCE($3::timestamptz, arrival_time)
       WHERE id = $1
       RETURNING id, flight_number, status, departure_time, arrival_time`,
      [flightId, newDepIso, newArrIso]
    );
    const flight = flightResult.rows[0];

    let delay;
    try {
      delay = await client.query(
        `INSERT INTO flight_delays (flight_id, delay_minutes, reason, reported_by, revised_departure, operational_notes, delay_code, cost_impact_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, flight_id, delay_minutes, reason, created_at, revised_departure, operational_notes, delay_code, cost_impact_usd`,
        [
          flightId,
          minutes,
          String(reason).trim().slice(0, 2000),
          req.user.userId,
          newDepIso,
          notesTrim,
          delayCodeNorm,
          costImpact
        ]
      );
    } catch (e) {
      if (e && e.code === '42703') {
        try {
          delay = await client.query(
            `INSERT INTO flight_delays (flight_id, delay_minutes, reason, reported_by, revised_departure, operational_notes)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, flight_id, delay_minutes, reason, created_at, revised_departure, operational_notes`,
            [
              flightId,
              minutes,
              String(reason).trim().slice(0, 2000),
              req.user.userId,
              newDepIso,
              notesTrim
            ]
          );
        } catch (e2) {
          if (e2 && e2.code === '42703') {
            delay = await client.query(
              `INSERT INTO flight_delays (flight_id, delay_minutes, reason, reported_by)
               VALUES ($1, $2, $3, $4)
               RETURNING id, flight_id, delay_minutes, reason, created_at`,
              [flightId, minutes, String(reason).trim().slice(0, 2000), req.user.userId]
            );
          } else {
            throw e2;
          }
        }
      } else {
        throw e;
      }
    }

    await recordOccFlightEvent(client, {
      flightId,
      eventType: 'DELAY',
      sourceSystem: 'occ',
      userId: req.user.userId,
      payload: {
        delayId: delay.rows[0].id,
        delayMinutes: minutes,
        delayCode: delayCodeNorm,
        costImpactUsd: costImpact,
        revisedDepartureTime: newDepIso
      }
    });

    if (costImpact != null && Number.isFinite(costImpact) && costImpact > 0) {
      try {
        await logFinanceTransaction(client, {
          txnType: 'OCC_DELAY_COST_EST',
          amount: costImpact,
          currency: 'USD',
          description: `Estimated delay cost (${delayCodeNorm || 'N/A'}) — ${minutes} min`,
          metadata: { flightId, delayId: delay.rows[0].id, delayCode: delayCodeNorm },
          userId: req.user.userId
        });
      } catch (finErr) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[operations] OCC_DELAY_COST_EST ledger:', finErr?.message || finErr);
        }
      }
    }

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.userId,
        'FLIGHT_DELAY_RECORDED',
        'flights',
        flightId,
        JSON.stringify({
          delayMinutes: minutes,
          reason,
          revisedDepartureTime: newDepIso,
          operationalNotes: notesTrim,
          delayCode: delayCodeNorm,
          costImpactUsd: costImpact
        })
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json({
      message: 'Delay recorded successfully.',
      delay: delay.rows[0],
      flight
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed to record delay.', error: error.message });
  } finally {
    client.release();
  }
});

router.get(
  '/flights/:flightId/details',
  requireAuth,
  requireRoles(...ROLES_OPS_FLIGHT_DETAIL),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) {
      return res.status(400).json({ message: 'Invalid flight id.' });
    }

    try {
      let flightResult;
      try {
        flightResult = await pool.query(
          `SELECT
        f.id,
        f.flight_number,
        f.departure_airport,
        f.arrival_airport,
        f.departure_time,
        f.arrival_time,
        f.gate,
        f.boarding_time,
        f.status,
        f.route_id,
        f.cancellation_reason,
        f.cancelled_at,
        f.aircraft_id,
        f.actual_off_block_at,
        f.actual_airborne_at,
        f.actual_landed_at,
        f.eta_current_at,
        a.tail_number,
        a.model,
        a.release_status AS aircraft_release_status,
        r.label AS route_label
      FROM flights f
      LEFT JOIN aircraft a ON a.id = f.aircraft_id
      LEFT JOIN ops_routes r ON r.id = f.route_id
      WHERE f.id = $1`,
          [flightId]
        );
      } catch (e) {
        if (e && e.code === '42703') {
          flightResult = await pool.query(
            `SELECT
        f.id,
        f.flight_number,
        f.departure_airport,
        f.arrival_airport,
        f.departure_time,
        f.arrival_time,
        f.gate,
        f.boarding_time,
        f.status,
        f.route_id,
        f.cancellation_reason,
        f.cancelled_at,
        f.aircraft_id,
        a.tail_number,
        a.model,
        a.release_status AS aircraft_release_status,
        r.label AS route_label
      FROM flights f
      LEFT JOIN aircraft a ON a.id = f.aircraft_id
      LEFT JOIN ops_routes r ON r.id = f.route_id
      WHERE f.id = $1`,
            [flightId]
          );
        } else {
          throw e;
        }
      }
      const flight = flightResult.rows[0];
      if (!flight) {
        return res.status(404).json({ message: 'Flight not found.' });
      }

      const crew = await pool.query(
        `SELECT ca.id, ca.crew_user_id, u.full_name, u.email, ca.duty_role, ca.assigned_at
       FROM crew_assignments ca
       JOIN users u ON u.id = ca.crew_user_id
       WHERE ca.flight_id = $1
       ORDER BY ca.assigned_at DESC`,
        [flightId]
      );

      let dispatchLogs;
      try {
        dispatchLogs = await pool.query(
          `SELECT id, dispatch_status, remarks, dispatched_at, checklist_json
           FROM dispatch_logs
           WHERE flight_id = $1
           ORDER BY dispatched_at DESC`,
          [flightId]
        );
      } catch (e) {
        if (e && e.code === '42703') {
          dispatchLogs = await pool.query(
            `SELECT id, dispatch_status, remarks, dispatched_at, NULL::jsonb AS checklist_json
             FROM dispatch_logs
             WHERE flight_id = $1
             ORDER BY dispatched_at DESC`,
            [flightId]
          );
        } else {
          throw e;
        }
      }

      let delays;
      try {
        delays = await pool.query(
          `SELECT id, delay_minutes, reason, created_at, revised_departure, operational_notes, delay_code, cost_impact_usd
           FROM flight_delays
           WHERE flight_id = $1
           ORDER BY created_at DESC`,
          [flightId]
        );
      } catch (e) {
        if (e && e.code === '42703') {
          try {
            delays = await pool.query(
              `SELECT id, delay_minutes, reason, created_at, revised_departure, operational_notes
               FROM flight_delays
               WHERE flight_id = $1
               ORDER BY created_at DESC`,
              [flightId]
            );
          } catch (e2) {
            if (e2 && e2.code === '42703') {
              delays = await pool.query(
                `SELECT id, delay_minutes, reason, created_at, NULL::timestamptz AS revised_departure, NULL::text AS operational_notes,
                        NULL::varchar AS delay_code, NULL::numeric AS cost_impact_usd
                 FROM flight_delays
                 WHERE flight_id = $1
                 ORDER BY created_at DESC`,
                [flightId]
              );
            } else {
              throw e2;
            }
          }
        } else {
          throw e;
        }
      }

      const loadRow = await pool.query(
        `SELECT
          (SELECT COUNT(DISTINCT bp.passenger_id)::int
           FROM booking_flights bf
           JOIN bookings b ON b.id = bf.booking_id AND UPPER(TRIM(COALESCE(b.booking_status,''))) <> 'CANCELLED'
           JOIN booking_passengers bp ON bp.booking_id = b.id
           WHERE bf.flight_id = f.id) AS passengers_booked,
          (SELECT COUNT(*)::int FROM checkins c WHERE c.flight_id = f.id) AS passengers_checked_in,
          (SELECT COUNT(*)::int FROM checkins c WHERE c.flight_id = f.id AND UPPER(TRIM(c.boarding_status)) = 'BOARDED') AS passengers_boarded,
          (SELECT COALESCE(SUM(bag.pieces), 0)::int FROM baggage bag JOIN checkins c ON c.id = bag.checkin_id WHERE c.flight_id = f.id) AS baggage_pieces,
          (SELECT COALESCE(SUM(bag.weight_kg), 0)::numeric FROM baggage bag JOIN checkins c ON c.id = bag.checkin_id WHERE c.flight_id = f.id) AS baggage_weight_kg
        FROM flights f WHERE f.id = $1`,
        [flightId]
      );
      const L = loadRow.rows[0] || {};
      const booked = Number(L.passengers_booked || 0);
      const checkedIn = Number(L.passengers_checked_in || 0);
      const boarded = Number(L.passengers_boarded || 0);
      const baggagePieces = Number(L.baggage_pieces || 0);
      const baggageKg = Number(L.baggage_weight_kg || 0);
      const cargoWeightKg = 0;
      const estFuelKg = Math.round(4200 + booked * 95 + baggageKg * 1.2);

      let gateConflict = null;
      if (flight.gate) {
        const g = await pool.query(
          `SELECT f2.flight_number
           FROM flights f2
           WHERE f2.id <> $1::uuid
             AND UPPER(TRIM(f2.departure_airport)) = UPPER(TRIM($2::text))
             AND f2.gate IS NOT NULL AND btrim(f2.gate::text) <> ''
             AND UPPER(btrim(f2.gate::text)) = UPPER(btrim($3::text))
             AND (f2.departure_time AT TIME ZONE 'UTC')::date = ($4::timestamptz AT TIME ZONE 'UTC')::date
             AND ${sqlFlightNotTerminal('f2')}
           LIMIT 1`,
          [flightId, flight.departure_airport, flight.gate, flight.departure_time]
        );
        gateConflict = g.rows[0]?.flight_number || null;
      }

      const auditTimeline = await pool.query(
        `SELECT id, action, metadata, created_at
         FROM audit_logs
         WHERE entity = 'flights' AND entity_id = $1::uuid
         ORDER BY created_at DESC
         LIMIT 120`,
        [flightId]
      );

      const roles = new Set(crew.rows.map((r) => String(r.duty_role || '').toUpperCase()));
      const dutyCounts = {};
      for (const r of crew.rows) {
        const dr = String(r.duty_role || '').toUpperCase();
        dutyCounts[dr] = (dutyCounts[dr] || 0) + 1;
      }
      const alerts = [];
      if ((dutyCounts.PIC || 0) > 1) {
        alerts.push({
          code: 'CREW_DUPLICATE_PIC',
          severity: 'error',
          message: 'More than one Captain (PIC) line on the roster — correct assignments before release.'
        });
      }
      if ((dutyCounts.FO || 0) > 1 || (dutyCounts.SIC || 0) > 1) {
        alerts.push({
          code: 'CREW_DUPLICATE_FO',
          severity: 'warning',
          message: 'Multiple First Officer (FO/SIC) lines — verify complement and duty rules.'
        });
      }
      if (!flight.aircraft_id) {
        alerts.push({ code: 'NO_AIRCRAFT', severity: 'error', message: 'No aircraft assigned to this flight.' });
      } else if (String(flight.aircraft_release_status || '').toUpperCase() !== 'RELEASED') {
        alerts.push({
          code: 'MAINT_NOT_RELEASED',
          severity: 'warning',
          message: 'Aircraft is not maintenance-released for operations.'
        });
      }
      if (!roles.has('PIC')) {
        alerts.push({ code: 'NO_PIC', severity: 'warning', message: 'No Captain (PIC) assigned on crew roster.' });
      }
      if (!roles.has('FO') && !roles.has('SIC')) {
        alerts.push({
          code: 'NO_FO',
          severity: 'info',
          message: 'No First Officer (FO/SIC) recorded — verify dual-pilot rules.'
        });
      }
      if (normalizeStatus(flight.status) === 'SCHEDULED') {
        alerts.push({
          code: 'CHECKIN_NOT_OPEN',
          severity: 'info',
          message:
            'Flight is SCHEDULED — passenger check-in requires CHECKIN_OPEN, BOARDING, or DELAYED. Use Open ck-in or dispatch release.'
        });
      }
      if (gateConflict) {
        alerts.push({
          code: 'GATE_CONFLICT',
          severity: 'warning',
          message: `Gate ${flight.gate} may conflict with flight ${gateConflict} same day.`
        });
      }
      if (normalizeStatus(flight.status) === 'DELAYED' || Number(delays.rows[0]?.delay_minutes || 0) >= 45) {
        alerts.push({
          code: 'DELAY_RISK',
          severity: 'info',
          message: 'Delay risk / recovery — review revised times and connections.'
        });
      }

      if (flight.aircraft_id) {
        const prevLeg = await pool.query(
          `SELECT flight_number, arrival_time
           FROM flights f
           WHERE f.aircraft_id = $1
             AND f.id <> $2::uuid
             AND f.arrival_time <= $3::timestamptz
             AND ${sqlFlightNotTerminal('f')}
           ORDER BY f.arrival_time DESC
           LIMIT 1`,
          [flight.aircraft_id, flightId, flight.departure_time]
        );
        if (prevLeg.rows[0]) {
          const gapMin = (new Date(flight.departure_time) - new Date(prevLeg.rows[0].arrival_time)) / 60000;
          if (gapMin < MIN_TURNAROUND_MINUTES) {
            alerts.push({
              code: 'TIGHT_TURNAROUND_IN',
              severity: 'warning',
              message: `After ${prevLeg.rows[0].flight_number}, only ${Math.round(gapMin)} min until this departure — target ≥ ${MIN_TURNAROUND_MINUTES} min turnaround.`
            });
          }
        }
        const nextLeg = await pool.query(
          `SELECT flight_number, departure_time
           FROM flights f
           WHERE f.aircraft_id = $1
             AND f.id <> $2::uuid
             AND f.departure_time >= $3::timestamptz
             AND ${sqlFlightNotTerminal('f')}
           ORDER BY f.departure_time ASC
           LIMIT 1`,
          [flight.aircraft_id, flightId, flight.arrival_time]
        );
        if (nextLeg.rows[0]) {
          const gapMin = (new Date(nextLeg.rows[0].departure_time) - new Date(flight.arrival_time)) / 60000;
          if (gapMin < MIN_TURNAROUND_MINUTES) {
            alerts.push({
              code: 'TIGHT_TURNAROUND_OUT',
              severity: 'warning',
              message: `Before ${nextLeg.rows[0].flight_number}, only ${Math.round(gapMin)} min after this arrival — target ≥ ${MIN_TURNAROUND_MINUTES} min turnaround.`
            });
          }
        }
      }

      return res.status(200).json({
        flight,
        crew: crew.rows,
        dispatchLogs: dispatchLogs.rows,
        delays: delays.rows,
        operationalSummary: {
          load: {
            passengersBooked: booked,
            passengersCheckedIn: checkedIn,
            passengersBoarded: boarded,
            baggagePieces,
            baggageWeightKg: Math.round(baggageKg * 100) / 100,
            cargoWeightKg,
            estimatedFuelKg: estFuelKg
          },
          alerts,
          constants: { minTurnaroundMinutes: MIN_TURNAROUND_MINUTES }
        },
        auditTimeline: auditTimeline.rows
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to retrieve flight operations details.', error: error.message });
    }
  }
);

registerOccRoutes(router);

export default router;
