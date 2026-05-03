import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import {
  assertCrewAssignableForFlight,
  recordDutyAfterAssignment,
  deleteDutyLogForAssignment,
  deleteDutyLogsForFlight
} from '../../services/crewCompliance.js';

const router = express.Router();

const FLIGHT_STATUSES = [
  'SCHEDULED',
  'BOARDING',
  'DEPARTED',
  'IN_AIR',
  'LANDED',
  'DELAYED',
  'CANCELLED'
];

const TERMINAL_NO_OVERLAP = ['CANCELLED', 'LANDED'];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function normalizeStatus(s) {
  return String(s || '').trim().toUpperCase();
}

async function findAircraftOverlap(client, { aircraftId, depart, arrive, excludeFlightId }) {
  const r = await client.query(
    `SELECT f.id, f.flight_number, f.departure_time, f.arrival_time
     FROM flights f
     WHERE f.aircraft_id = $1
       AND ($4::uuid IS NULL OR f.id <> $4::uuid)
       AND UPPER(TRIM(f.status)) NOT IN ('CANCELLED', 'LANDED')
       AND f.departure_time < $3::timestamptz
       AND f.arrival_time > $2::timestamptz`,
    [aircraftId, depart, arrive, excludeFlightId || null]
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
       AND UPPER(TRIM(f.status)) NOT IN ('CANCELLED', 'LANDED')
       AND f.departure_time < $3::timestamptz
       AND f.arrival_time > $2::timestamptz`,
    [crewUserId, depart, arrive, excludeFlightId || null]
  );
  return r.rows[0] || null;
}

router.get('/health', (_req, res) => {
  res.json({ module: 'operations', status: 'ready' });
});

router.get(
  '/dashboard/today',
  requireAuth,
  requireRoles('admin', 'super_admin', 'operations', 'maintenance', 'agent', 'customer_service'),
  async (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
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
        WHERE DATE(f.departure_time AT TIME ZONE 'UTC') = DATE($1::date)
        ORDER BY f.departure_time ASC`,
        [today]
      );
      const byStatus = {};
      for (const s of FLIGHT_STATUSES) byStatus[s] = 0;
      for (const row of flights.rows) {
        const k = normalizeStatus(row.status) || 'SCHEDULED';
        if (byStatus[k] === undefined) byStatus[k] = 0;
        byStatus[k] += 1;
      }
      return res.status(200).json({ date: today, flights: flights.rows, summaryByStatus: byStatus });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load operations dashboard.', error: error.message });
    }
  }
);

router.get(
  '/routes',
  requireAuth,
  requireRoles('admin', 'super_admin', 'operations', 'maintenance', 'agent', 'customer_service'),
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
  requireRoles('admin', 'super_admin', 'operations'),
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
  requireRoles('admin', 'super_admin', 'operations'),
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
  requireRoles('admin', 'super_admin', 'operations'),
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
  requireRoles('admin', 'super_admin', 'operations', 'maintenance', 'agent', 'customer_service'),
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

router.get('/aircraft', requireAuth, requireRoles('admin', 'super_admin', 'operations', 'maintenance', 'agent'), async (_req, res) => {
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

router.get('/crew', requireAuth, requireRoles('admin', 'super_admin', 'operations', 'maintenance', 'agent'), async (_req, res) => {
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

router.post('/flights', requireAuth, requireRoles('admin', 'super_admin', 'operations'), async (req, res) => {
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
        message: `Aircraft is already assigned to overlapping flight ${overlap.flight_number}.`,
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

router.put('/flights/:flightId', requireAuth, requireRoles('admin', 'super_admin', 'operations'), async (req, res) => {
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
          message: `Aircraft would overlap flight ${overlap.flight_number}.`,
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

router.patch('/flights/:flightId/status', requireAuth, requireRoles('admin', 'super_admin', 'operations'), async (req, res) => {
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
    const upd = await pool.query(
      `UPDATE flights SET status = $2 WHERE id = $1 RETURNING id, flight_number, status`,
      [flightId, next]
    );
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.userId, 'FLIGHT_STATUS_SET', 'flights', flightId, JSON.stringify({ status: next })]
    );
    return res.status(200).json({ flight: upd.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update flight status.', error: error.message });
  }
});

router.post('/flights/:flightId/cancel', requireAuth, requireRoles('admin', 'super_admin', 'operations'), async (req, res) => {
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
    await client.query('COMMIT');
    return res.status(200).json({ flight: upd.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed to cancel flight.', error: error.message });
  } finally {
    client.release();
  }
});

router.post('/flights/:flightId/assign-aircraft', requireAuth, requireRoles('admin', 'super_admin', 'operations'), async (req, res) => {
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
        message: `Aircraft is already assigned to overlapping flight ${overlap.flight_number}.`,
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

router.post('/flights/:flightId/assign-crew', requireAuth, requireRoles('admin', 'super_admin', 'operations'), async (req, res) => {
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
  requireRoles('admin', 'super_admin', 'operations'),
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
      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ message: 'Failed to remove crew assignment.', error: error.message });
    }
  }
);

router.post('/flights/:flightId/dispatch', requireAuth, requireRoles('admin', 'super_admin', 'operations'), async (req, res) => {
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

    const flightResult = await client.query(
      `UPDATE flights
       SET status = $1
       WHERE id = $2
       RETURNING id, flight_number, status`,
      [status, flightId]
    );
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

router.post('/flights/:flightId/dispatch-release', requireAuth, requireRoles('admin', 'super_admin', 'operations'), async (req, res) => {
  const { flightId } = req.params;
  const { remarks } = req.body;
  if (!isUuid(flightId)) {
    return res.status(400).json({ message: 'Invalid flight id.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT id, status, aircraft_id, route_id FROM flights WHERE id = $1`,
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
    const upd = await client.query(
      `UPDATE flights SET status = 'BOARDING' WHERE id = $1 RETURNING id, flight_number, status`,
      [flightId]
    );
    await client.query(
      `INSERT INTO dispatch_logs (flight_id, dispatch_status, remarks, dispatched_by)
       VALUES ($1, $2, $3, $4)`,
      [flightId, 'RELEASED', remarks || 'Dispatch release — boarding', req.user.userId]
    );
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.userId, 'DISPATCH_RELEASE_BOARDING', 'flights', flightId, JSON.stringify({})]
    );
    await client.query('COMMIT');
    return res.status(200).json({ flight: upd.rows[0], message: 'Flight released for boarding.' });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed dispatch release.', error: error.message });
  } finally {
    client.release();
  }
});

router.post('/flights/:flightId/delays', requireAuth, requireRoles('admin', 'super_admin', 'operations'), async (req, res) => {
  const { flightId } = req.params;
  if (!isUuid(flightId)) {
    return res.status(400).json({ message: 'Invalid flight id.' });
  }
  const { delayMinutes, reason } = req.body;
  const minutes = Number(delayMinutes);

  if (!Number.isInteger(minutes) || minutes <= 0 || !reason || String(reason).trim().length < 3) {
    return res.status(400).json({ message: 'delayMinutes (positive integer) and reason (min 3 chars) are required.' });
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
      return res.status(400).json({ message: 'Cannot delay a cancelled flight.' });
    }

    const flightResult = await client.query(
      `UPDATE flights
       SET status = 'DELAYED'
       WHERE id = $1
       RETURNING id, flight_number, status`,
      [flightId]
    );
    const flight = flightResult.rows[0];

    const delay = await client.query(
      `INSERT INTO flight_delays (flight_id, delay_minutes, reason, reported_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, flight_id, delay_minutes, reason, created_at`,
      [flightId, minutes, String(reason).trim().slice(0, 2000), req.user.userId]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.userId,
        'FLIGHT_DELAY_RECORDED',
        'flights',
        flightId,
        JSON.stringify({ delayMinutes: minutes, reason })
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
  requireRoles('admin', 'super_admin', 'operations', 'maintenance', 'agent', 'customer_service'),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) {
      return res.status(400).json({ message: 'Invalid flight id.' });
    }

    try {
      const flightResult = await pool.query(
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
        r.label AS route_label
      FROM flights f
      LEFT JOIN aircraft a ON a.id = f.aircraft_id
      LEFT JOIN ops_routes r ON r.id = f.route_id
      WHERE f.id = $1`,
        [flightId]
      );
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

      const dispatchLogs = await pool.query(
        `SELECT id, dispatch_status, remarks, dispatched_at
       FROM dispatch_logs
       WHERE flight_id = $1
       ORDER BY dispatched_at DESC`,
        [flightId]
      );

      const delays = await pool.query(
        `SELECT id, delay_minutes, reason, created_at
       FROM flight_delays
       WHERE flight_id = $1
       ORDER BY created_at DESC`,
        [flightId]
      );

      return res.status(200).json({
        flight,
        crew: crew.rows,
        dispatchLogs: dispatchLogs.rows,
        delays: delays.rows
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to retrieve flight operations details.', error: error.message });
    }
  }
);

export default router;
