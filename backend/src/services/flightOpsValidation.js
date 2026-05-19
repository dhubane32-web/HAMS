import { pool } from '../config/db.js';
import { MIN_TURNAROUND_MINUTES } from './flightOpsEnterpriseService.js';

const DEFAULT_MAX_RANGE_NM = 3500;

async function routeDistanceNm(origin, dest) {
  try {
    const r = await pool.query(
      `SELECT mr.distance_nm
       FROM md_routes mr
       JOIN md_airports o ON o.id = mr.origin_airport_id
       JOIN md_airports d ON d.id = mr.dest_airport_id
       WHERE upper(trim(o.iata_code)) = $1 AND upper(trim(d.iata_code)) = $2
       LIMIT 1`,
      [String(origin).toUpperCase(), String(dest).toUpperCase()]
    );
    return r.rows[0]?.distance_nm != null ? Number(r.rows[0].distance_nm) : null;
  } catch {
    return null;
  }
}

async function aircraftAvailable(aircraftId, depart, arrive, excludeFlightId) {
  const r = await pool.query(
    `SELECT f.id, f.flight_number
     FROM flights f
     WHERE f.aircraft_id = $1
       AND ($4::uuid IS NULL OR f.id <> $4)
       AND UPPER(TRIM(f.status)) NOT IN ('CANCELLED','ARRIVED','LANDED')
       AND f.departure_time < $3::timestamptz + ($5::int * interval '1 minute')
       AND f.arrival_time + ($5::int * interval '1 minute') > $2::timestamptz`,
    [aircraftId, depart, arrive, excludeFlightId || null, MIN_TURNAROUND_MINUTES]
  );
  return r.rows[0] || null;
}

/**
 * Pre-flight assignment validation (seat, release, overlap, range).
 */
export async function validateAssignment({ flightId, aircraftId, isReserve = false }) {
  const f = await pool.query(
    `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport,
            f.departure_time, f.arrival_time, f.status, f.schedule_id,
            s.seat_capacity_required, s.aircraft_type_hint AS schedule_type_hint
     FROM flights f
     LEFT JOIN flight_schedules s ON s.id = f.schedule_id
     WHERE f.id = $1`,
    [flightId]
  );
  if (!f.rows[0]) throw Object.assign(new Error('Flight not found.'), { status: 404 });
  const flight = f.rows[0];

  const ac = await pool.query(
    `SELECT a.id, a.tail_number, a.model, a.seat_capacity, a.release_status,
            t.code AS type_code, t.default_seat_capacity
     FROM aircraft a
     LEFT JOIN md_aircraft_types t ON t.id = a.aircraft_type_id
     WHERE a.id = $1`,
    [aircraftId]
  );
  if (!ac.rows[0]) throw Object.assign(new Error('Aircraft not found.'), { status: 404 });
  const aircraft = ac.rows[0];

  const errors = [];
  const warnings = [];

  if (String(flight.status).toUpperCase() === 'CANCELLED') {
    errors.push('Flight is cancelled.');
  }
  if (String(aircraft.release_status).toUpperCase() !== 'RELEASED' && !isReserve) {
    errors.push(`Aircraft ${aircraft.tail_number} is not released (${aircraft.release_status}).`);
  }
  if (isReserve) {
    warnings.push('Assigning as reserve aircraft.');
  }

  const seatsRequired = Number(flight.seat_capacity_required || 0);
  const seatsAvailable = Number(aircraft.seat_capacity || aircraft.default_seat_capacity || 0);
  if (seatsRequired > 0 && seatsAvailable > 0 && seatsAvailable < seatsRequired) {
    errors.push(`Seat capacity ${seatsAvailable} below required ${seatsRequired}.`);
  }

  if (flight.schedule_type_hint && aircraft.type_code) {
    const hint = String(flight.schedule_type_hint).toUpperCase();
    const code = String(aircraft.type_code).toUpperCase();
    if (hint !== code && !String(aircraft.model).toUpperCase().includes(hint)) {
      warnings.push(`Type hint ${hint} may not match ${code} (${aircraft.model}).`);
    }
  }

  const dist = await routeDistanceNm(flight.departure_airport, flight.arrival_airport);
  if (dist != null && dist > DEFAULT_MAX_RANGE_NM) {
    errors.push(`Route ${dist} NM exceeds default aircraft range (${DEFAULT_MAX_RANGE_NM} NM).`);
  } else if (dist != null && dist > DEFAULT_MAX_RANGE_NM * 0.85) {
    warnings.push(`Route ${dist} NM is near maximum operational range.`);
  }

  const overlap = await aircraftAvailable(
    aircraftId,
    flight.departure_time,
    flight.arrival_time,
    flightId
  );
  if (overlap) {
    errors.push(`Rotation conflict with ${overlap.flight_number} (min ${MIN_TURNAROUND_MINUTES} min turnaround).`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    flight: {
      id: flight.id,
      flightNumber: flight.flight_number,
      route: `${flight.departure_airport}→${flight.arrival_airport}`,
      distanceNm: dist
    },
    aircraft: {
      id: aircraft.id,
      tailNumber: aircraft.tail_number,
      model: aircraft.model,
      seatCapacity: seatsAvailable,
      releaseStatus: aircraft.release_status
    }
  };
}

/**
 * List aircraft compatible with a flight (released, capacity, no overlap).
 */
export async function listCompatibleAircraft(flightId) {
  const f = await pool.query(
    `SELECT f.departure_airport, f.arrival_airport, f.departure_time, f.arrival_time, f.schedule_id,
            s.seat_capacity_required AS seats_req
     FROM flights f
     LEFT JOIN flight_schedules s ON s.id = f.schedule_id
     WHERE f.id = $1`,
    [flightId]
  );
  if (!f.rows[0]) throw Object.assign(new Error('Flight not found.'), { status: 404 });
  const flight = f.rows[0];
  const seatsReq = Number(flight.seats_req || 0);

  const fleet = await pool.query(
    `SELECT a.id, a.tail_number, a.model, a.seat_capacity, a.release_status,
            t.code AS type_code
     FROM aircraft a
     LEFT JOIN md_aircraft_types t ON t.id = a.aircraft_type_id
     ORDER BY a.tail_number`
  );

  const dist = await routeDistanceNm(flight.departure_airport, flight.arrival_airport);
  const out = [];
  for (const a of fleet.rows) {
    const v = await validateAssignment({ flightId, aircraftId: a.id, isReserve: false }).catch(() => null);
    const seatsOk = !seatsReq || Number(a.seat_capacity) >= seatsReq;
    const rangeOk = dist == null || dist <= DEFAULT_MAX_RANGE_NM;
    out.push({
      ...a,
      compatible: Boolean(v?.valid && seatsOk && rangeOk),
      errors: v?.errors || (seatsOk ? [] : ['Insufficient seats']),
      warnings: v?.warnings || []
    });
  }
  return { flightId, distanceNm: dist, aircraft: out };
}

/**
 * Validate schedule template before insert.
 */
export async function validateScheduleTemplate(body) {
  const errors = [];
  const warnings = [];
  let route = null;

  if (body.routeId || body.route_id) {
    const r = await pool.query(`SELECT * FROM ops_routes WHERE id = $1`, [body.routeId || body.route_id]);
    route = r.rows[0];
    if (!route) errors.push('Route template not found.');
  }

  const origin = String(
    body.originAirport || body.origin_airport || route?.origin_airport || ''
  ).toUpperCase();
  const dest = String(body.destAirport || body.dest_airport || route?.dest_airport || '').toUpperCase();
  if (!origin || !dest) errors.push('Origin and destination airports are required.');
  if (origin === dest) errors.push('Origin and destination must differ.');

  const aircraftId = body.defaultAircraftId || body.default_aircraft_id;
  if (aircraftId) {
    const day = body.effectiveFrom || body.effective_from || new Date().toISOString().slice(0, 10);
    const depIso = `${day}T${body.scheduledDepTime || body.scheduled_dep_time || '08:00'}:00Z`;
    const arrIso = `${day}T${body.scheduledArrTime || body.scheduled_arr_time || '10:00'}:00Z`;
    const overlap = await aircraftAvailable(aircraftId, depIso, arrIso, null);
    if (overlap) {
      warnings.push(`Default aircraft may conflict with ${overlap.flight_number} on sample day.`);
    }
    const ac = await pool.query(`SELECT tail_number, release_status, seat_capacity FROM aircraft WHERE id = $1`, [
      aircraftId
    ]);
    if (ac.rows[0] && String(ac.rows[0].release_status).toUpperCase() !== 'RELEASED') {
      warnings.push(`Default aircraft ${ac.rows[0].tail_number} is not released.`);
    }
    const seatsReq = Number(body.seatCapacityRequired || body.seat_capacity_required || 0);
    if (seatsReq && ac.rows[0] && Number(ac.rows[0].seat_capacity) < seatsReq) {
      errors.push('Default aircraft seat capacity below requirement.');
    }
  }

  const rec = String(body.recurrenceType || body.recurrence_type || 'NONE').toUpperCase();
  if (rec === 'WEEKLY') {
    const dow = body.daysOfWeek || body.days_of_week;
    if (!Array.isArray(dow) || dow.length === 0) {
      errors.push('Weekly recurrence requires daysOfWeek (0=Sun … 6=Sat).');
    }
  }

  return { valid: errors.length === 0, errors, warnings, route, origin, dest };
}

export async function listRouteTemplates() {
  const r = await pool.query(
    `SELECT id, origin_airport, dest_airport, label, is_active
     FROM ops_routes
     WHERE is_active = TRUE
     ORDER BY label NULLS LAST, origin_airport, dest_airport`
  );
  return r.rows;
}
