import { pool } from '../config/db.js';
import { auditFlightOps } from './flightOpsEnterpriseEngine.js';
import { validateScheduleTemplate, validateAssignment } from './flightOpsValidation.js';

export const MIN_TURNAROUND_MINUTES = 45;
const TERMINAL = ['CANCELLED', 'ARRIVED', 'LANDED'];

function pgCode(err) {
  return err?.code || '';
}

export function isMissingSchema(err) {
  return pgCode(err) === '42P01';
}

export function schemaHint() {
  return 'Apply database/flight_ops_enterprise.sql on PostgreSQL.';
}

function normalizeStatus(s) {
  return String(s || '').trim().toUpperCase();
}

function mapScheduleStatusToFlight(scheduleStatus) {
  const s = normalizeStatus(scheduleStatus);
  if (s === 'CANCELLED') return 'CANCELLED';
  if (s === 'DELAYED') return 'DELAYED';
  if (s === 'COMPLETED') return 'ARRIVED';
  return 'SCHEDULED';
}

/** @param {Date} d */
function dateOnly(d) {
  return d.toISOString().slice(0, 10);
}

/** Build UTC timestamptz from local date + time + tz label (stored as UTC wall clock for ops day). */
function combineDateTime(dateStr, timeStr, dayOffset = 0) {
  const base = new Date(`${dateStr}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + Number(dayOffset || 0));
  const [hh, mm, ss] = String(timeStr || '00:00:00').split(':').map((x) => parseInt(x, 10) || 0);
  base.setUTCHours(hh, mm, ss || 0, 0);
  return base.toISOString();
}

export async function listSchedules({ status, from, to } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    params.push(normalizeStatus(status));
    clauses.push(`schedule_status = $${params.length}`);
  }
  if (from) {
    params.push(from);
    clauses.push(`(effective_to IS NULL OR effective_to >= $${params.length}::date)`);
  }
  if (to) {
    params.push(to);
    clauses.push(`effective_from <= $${params.length}::date`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const r = await pool.query(
    `SELECT s.*, r.label AS route_label
     FROM flight_schedules s
     LEFT JOIN ops_routes r ON r.id = s.route_id
     ${where}
     ORDER BY s.effective_from DESC, s.flight_number ASC`,
    params
  );
  return r.rows;
}

export async function createSchedule(body, userId, req = null) {
  const code = String(body.scheduleCode || body.schedule_code || '').trim().toUpperCase();
  if (!code) throw Object.assign(new Error('scheduleCode is required.'), { status: 400 });

  const validation = await validateScheduleTemplate(body);
  if (!validation.valid) {
    throw Object.assign(new Error(validation.errors.join(' ')), { status: 400, details: validation });
  }

  const flightNumber = String(body.flightNumber || body.flight_number || '').trim().toUpperCase();
  const origin = String(body.originAirport || body.origin_airport || validation.origin || '').trim().toUpperCase();
  const dest = String(body.destAirport || body.dest_airport || validation.dest || '').trim().toUpperCase();
  if (!flightNumber || !origin || !dest) {
    throw Object.assign(new Error('flightNumber, originAirport, and destAirport are required.'), { status: 400 });
  }
  const r = await pool.query(
    `INSERT INTO flight_schedules (
      schedule_code, route_id, flight_number, origin_airport, dest_airport,
      scheduled_dep_time, scheduled_arr_time, timezone, recurrence_type, days_of_week,
      effective_from, effective_to, direction, return_schedule_id, default_aircraft_id,
      aircraft_type_hint, seat_capacity_required, schedule_status, operational_day_offset, notes, created_by
    ) VALUES (
      $1, $2, $3, $4, $5, $6::time, $7::time, $8, $9, $10::smallint[],
      $11::date, $12::date, $13, $14, $15, $16, $17, $18, $19, $20, $21
    ) RETURNING *`,
    [
      code,
      body.routeId || body.route_id || null,
      flightNumber,
      origin,
      dest,
      body.scheduledDepTime || body.scheduled_dep_time || '08:00',
      body.scheduledArrTime || body.scheduled_arr_time || '10:00',
      body.timezone || 'UTC',
      normalizeStatus(body.recurrenceType || body.recurrence_type || 'NONE'),
      Array.isArray(body.daysOfWeek || body.days_of_week) ? body.daysOfWeek || body.days_of_week : [],
      body.effectiveFrom || body.effective_from || dateOnly(new Date()),
      body.effectiveTo || body.effective_to || null,
      normalizeStatus(body.direction || 'ONE_WAY'),
      body.returnScheduleId || body.return_schedule_id || null,
      body.defaultAircraftId || body.default_aircraft_id || null,
      body.aircraftTypeHint || body.aircraft_type_hint || null,
      body.seatCapacityRequired || body.seat_capacity_required || null,
      normalizeStatus(body.scheduleStatus || body.schedule_status || 'PLANNED'),
      Number(body.operationalDayOffset || body.operational_day_offset || 0),
      body.notes || null,
      userId || null
    ]
  );
  const row = r.rows[0];
  await auditFlightOps(userId, 'SCHEDULE_CREATE', row.id, { scheduleCode: code, flightNumber }, req);
  return row;
}

export async function updateSchedule(id, body, userId = null, req = null) {
  const r = await pool.query(
    `UPDATE flight_schedules SET
      route_id = COALESCE($2, route_id),
      flight_number = COALESCE($3, flight_number),
      origin_airport = COALESCE($4, origin_airport),
      dest_airport = COALESCE($5, dest_airport),
      scheduled_dep_time = COALESCE($6::time, scheduled_dep_time),
      scheduled_arr_time = COALESCE($7::time, scheduled_arr_time),
      timezone = COALESCE($8, timezone),
      recurrence_type = COALESCE($9, recurrence_type),
      days_of_week = COALESCE($10::smallint[], days_of_week),
      effective_from = COALESCE($11::date, effective_from),
      effective_to = COALESCE($12::date, effective_to),
      schedule_status = COALESCE($13, schedule_status),
      default_aircraft_id = COALESCE($14, default_aircraft_id),
      notes = COALESCE($15, notes),
      updated_at = NOW()
     WHERE id = $1::uuid RETURNING *`,
    [
      id,
      body.routeId ?? body.route_id,
      body.flightNumber ? String(body.flightNumber).toUpperCase() : null,
      body.originAirport ? String(body.originAirport).toUpperCase() : null,
      body.destAirport ? String(body.destAirport).toUpperCase() : null,
      body.scheduledDepTime || body.scheduled_dep_time,
      body.scheduledArrTime || body.scheduled_arr_time,
      body.timezone,
      body.recurrenceType ? normalizeStatus(body.recurrenceType) : null,
      body.daysOfWeek || body.days_of_week,
      body.effectiveFrom || body.effective_from,
      body.effectiveTo || body.effective_to,
      body.scheduleStatus ? normalizeStatus(body.scheduleStatus) : null,
      body.defaultAircraftId ?? body.default_aircraft_id,
      body.notes
    ]
  );
  if (!r.rows[0]) throw Object.assign(new Error('Schedule not found.'), { status: 404 });
  await auditFlightOps(userId, 'SCHEDULE_UPDATE', id, body, req);
  return r.rows[0];
}

export async function deleteSchedule(id, userId = null, req = null) {
  const r = await pool.query(`DELETE FROM flight_schedules WHERE id = $1::uuid RETURNING id`, [id]);
  if (!r.rows[0]) throw Object.assign(new Error('Schedule not found.'), { status: 404 });
  await auditFlightOps(userId, 'SCHEDULE_DELETE', id, {}, req);
  return { ok: true };
}

/** Generate flight rows from active schedules for a single ops day. */
export async function generateFlightsFromSchedules({ opsDate, scheduleIds, userId, req = null }) {
  const day = opsDate || dateOnly(new Date());
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  let schedules;
  if (scheduleIds?.length) {
    const r = await pool.query(`SELECT * FROM flight_schedules WHERE id = ANY($1::uuid[])`, [scheduleIds]);
    schedules = r.rows;
  } else {
    const r = await pool.query(
      `SELECT * FROM flight_schedules
       WHERE schedule_status IN ('PLANNED', 'ACTIVE')
         AND effective_from <= $1::date
         AND (effective_to IS NULL OR effective_to >= $1::date)`,
      [day]
    );
    schedules = r.rows;
  }

  const created = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of schedules) {
      const rec = normalizeStatus(s.recurrence_type);
      if (rec === 'WEEKLY' && s.days_of_week?.length && !s.days_of_week.includes(dow)) continue;

      const depIso = combineDateTime(day, s.scheduled_dep_time, s.operational_day_offset);
      let arrIso = combineDateTime(day, s.scheduled_arr_time, s.operational_day_offset);
      if (new Date(arrIso) <= new Date(depIso)) {
        const arrDate = new Date(depIso);
        arrDate.setUTCDate(arrDate.getUTCDate() + 1);
        const [hh, mm] = String(s.scheduled_arr_time).split(':');
        arrDate.setUTCHours(parseInt(hh, 10) || 0, parseInt(mm, 10) || 0, 0, 0);
        arrIso = arrDate.toISOString();
      }

      const exists = await client.query(
        `SELECT id FROM flights
         WHERE schedule_id = $1 AND (departure_time AT TIME ZONE 'UTC')::date = $2::date
         LIMIT 1`,
        [s.id, day]
      );
      if (exists.rows[0]) continue;

      const ins = await client.query(
        `INSERT INTO flights (
          flight_number, departure_airport, arrival_airport, departure_time, arrival_time,
          status, aircraft_id, route_id, schedule_id
        ) VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9)
        RETURNING id, flight_number, departure_time, status`,
        [
          s.flight_number,
          s.origin_airport,
          s.dest_airport,
          depIso,
          arrIso,
          mapScheduleStatusToFlight(s.schedule_status),
          s.default_aircraft_id,
          s.route_id,
          s.id
        ]
      );
      created.push(ins.rows[0]);

      if (s.default_aircraft_id) {
        await client.query(
          `INSERT INTO aircraft_assignments (flight_id, aircraft_id, assignment_status, assigned_by, auto_assigned)
           VALUES ($1, $2, 'ASSIGNED', $3, TRUE)`,
          [ins.rows[0].id, s.default_aircraft_id, userId]
        );
        await client.query(`UPDATE flights SET aircraft_id = $2 WHERE id = $1`, [
          ins.rows[0].id,
          s.default_aircraft_id
        ]);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  await auditFlightOps(userId, 'SCHEDULE_GENERATE', null, { opsDate: day, createdCount: created.length }, req);
  return { opsDate: day, createdCount: created.length, flights: created };
}

export async function getScheduleCalendar({ from, to }) {
  const r = await pool.query(
    `SELECT s.id, s.schedule_code, s.flight_number, s.origin_airport, s.dest_airport,
            s.scheduled_dep_time, s.scheduled_arr_time, s.schedule_status, s.recurrence_type,
            s.effective_from, s.effective_to,
            (SELECT COUNT(*)::int FROM flights f WHERE f.schedule_id = s.id
             AND f.departure_time::date >= $1::date AND f.departure_time::date <= $2::date) AS instances_count
     FROM flight_schedules s
     WHERE s.effective_from <= $2::date AND (s.effective_to IS NULL OR s.effective_to >= $1::date)
     ORDER BY s.flight_number`,
    [from, to]
  );
  const flights = await pool.query(
    `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport,
            f.departure_time, f.arrival_time, f.status, f.schedule_id, f.aircraft_id,
            a.tail_number
     FROM flights f
     LEFT JOIN aircraft a ON a.id = f.aircraft_id
     WHERE f.departure_time::date >= $1::date AND f.departure_time::date <= $2::date
     ORDER BY f.departure_time`,
    [from, to]
  );
  return { schedules: r.rows, flights: flights.rows };
}

async function findAircraftOverlap(client, { aircraftId, depart, arrive, excludeFlightId }) {
  const r = await client.query(
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

export async function assignAircraft({
  flightId,
  aircraftId: requestedAircraftId,
  userId,
  isReserve,
  autoAssigned: autoAssignedIn,
  autoReassign,
  notes: notesIn,
  req = null
}) {
  let aircraftId = requestedAircraftId;
  let autoAssigned = autoAssignedIn;
  let notes = notesIn;

  if (!autoReassign) {
    const check = await validateAssignment({ flightId, aircraftId, isReserve });
    if (!check.valid) {
      throw Object.assign(new Error(check.errors.join(' ')), { status: 409, details: check });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const f = await client.query(
      `SELECT f.*, a.release_status FROM flights f
       LEFT JOIN aircraft a ON a.id = f.aircraft_id WHERE f.id = $1 FOR UPDATE`,
      [flightId]
    );
    if (!f.rows[0]) throw Object.assign(new Error('Flight not found.'), { status: 404 });
    const flight = f.rows[0];
    let ac = await client.query(
      `SELECT id, tail_number, model, seat_capacity, release_status FROM aircraft WHERE id = $1`,
      [aircraftId]
    );
    if (!ac.rows[0]) throw Object.assign(new Error('Aircraft not found.'), { status: 404 });
    if (String(ac.rows[0].release_status || '').toUpperCase() !== 'RELEASED' && !isReserve) {
      throw Object.assign(new Error(`Aircraft ${ac.rows[0].tail_number} is not released for operations.`), {
        status: 409
      });
    }
    const overlap = await findAircraftOverlap(client, {
      aircraftId,
      depart: flight.departure_time,
      arrive: flight.arrival_time,
      excludeFlightId: flightId
    });
    if (overlap && autoReassign) {
      const alt = await client.query(
        `SELECT a.id, a.tail_number FROM aircraft a
         WHERE a.id <> $1 AND UPPER(TRIM(a.release_status)) = 'RELEASED'
           AND NOT EXISTS (
             SELECT 1 FROM flights f2
             WHERE f2.aircraft_id = a.id AND f2.id <> $2
               AND UPPER(TRIM(f2.status)) NOT IN ('CANCELLED','ARRIVED','LANDED')
               AND f2.departure_time < $4::timestamptz + ($5::int * interval '1 minute')
               AND f2.arrival_time + ($5::int * interval '1 minute') > $3::timestamptz
           )
         ORDER BY a.tail_number LIMIT 1`,
        [
          aircraftId,
          flightId,
          flight.departure_time,
          flight.arrival_time,
          MIN_TURNAROUND_MINUTES
        ]
      );
      if (alt.rows[0]) {
        aircraftId = alt.rows[0].id;
        autoAssigned = true;
        notes = `${notes || ''} Auto-reassigned to ${alt.rows[0].tail_number}`.trim();
        ac = await client.query(
          `SELECT id, tail_number, model, seat_capacity, release_status FROM aircraft WHERE id = $1`,
          [aircraftId]
        );
      } else {
        throw Object.assign(new Error('No alternate aircraft available for auto-reassign.'), { status: 409 });
      }
    } else if (overlap) {
      throw Object.assign(
        new Error(`Rotation conflict with ${overlap.flight_number} (min ${MIN_TURNAROUND_MINUTES} min turnaround).`),
        { status: 409 }
      );
    }
    await client.query(`UPDATE flights SET aircraft_id = $2 WHERE id = $1`, [flightId, aircraftId]);
    const ins = await client.query(
      `INSERT INTO aircraft_assignments (flight_id, aircraft_id, assignment_status, is_reserve, auto_assigned, assigned_by, notes)
       VALUES ($1, $2, 'ASSIGNED', $3, $4, $5, $6) RETURNING *`,
      [flightId, aircraftId, Boolean(isReserve), Boolean(autoAssigned), userId, notes || null]
    );
    await client.query('COMMIT');
    const result = { assignment: ins.rows[0], aircraft: ac.rows[0] };
    await auditFlightOps(userId, 'AIRCRAFT_ASSIGN', flightId, { aircraftId, autoAssigned, isReserve }, req);
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function rebuildRotations(opsDate, userId = null, req = null) {
  const day = opsDate || dateOnly(new Date());
  await pool.query(`DELETE FROM aircraft_rotations WHERE operational_date = $1::date`, [day]);
  const flights = await pool.query(
    `SELECT f.id, f.aircraft_id, f.departure_airport, f.arrival_airport,
            f.departure_time, f.arrival_time, f.status
     FROM flights f
     WHERE f.aircraft_id IS NOT NULL
       AND (f.departure_time AT TIME ZONE 'UTC')::date = $1::date
     ORDER BY f.aircraft_id, f.departure_time`,
    [day]
  );
  const byTail = new Map();
  for (const row of flights.rows) {
    if (!byTail.has(row.aircraft_id)) byTail.set(row.aircraft_id, []);
    byTail.get(row.aircraft_id).push(row);
  }
  const rotations = [];
  for (const [aircraftId, legs] of byTail) {
    let seq = 0;
    let prevArr = null;
    for (const leg of legs) {
      seq += 1;
      let turnaround = null;
      let conflict = null;
      if (prevArr) {
        turnaround = Math.round((new Date(leg.departure_time) - new Date(prevArr)) / 60000);
        if (turnaround < MIN_TURNAROUND_MINUTES) {
          conflict = `Turnaround ${turnaround} min < ${MIN_TURNAROUND_MINUTES} min minimum`;
        }
      }
      const block = Math.round((new Date(leg.arrival_time) - new Date(leg.departure_time)) / 60000);
      const isLast = seq === legs.length;
      const overnight = isLast ? leg.arrival_airport : null;
      const ins = await pool.query(
        `INSERT INTO aircraft_rotations (
          operational_date, aircraft_id, sequence_no, flight_id,
          origin_airport, dest_airport, planned_dep, planned_arr,
          planned_turnaround_min, planned_block_min, overnight_station,
          rotation_status, conflict_reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [
          day,
          aircraftId,
          seq,
          leg.id,
          leg.departure_airport,
          leg.arrival_airport,
          leg.departure_time,
          leg.arrival_time,
          turnaround,
          block,
          overnight,
          conflict ? 'CONFLICT' : normalizeStatus(leg.status) === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
          conflict
        ]
      );
      rotations.push(ins.rows[0]);
      prevArr = leg.arrival_time;
    }
  }
  await auditFlightOps(userId, 'ROTATIONS_REBUILD', null, { operationalDate: day, count: rotations.length }, req);
  return { operationalDate: day, rotations };
}

export async function listRotations({ opsDate, aircraftId }) {
  const day = opsDate || dateOnly(new Date());
  const params = [day];
  let extra = '';
  if (aircraftId) {
    params.push(aircraftId);
    extra = ` AND ar.aircraft_id = $${params.length}`;
  }
  const r = await pool.query(
    `SELECT ar.*, a.tail_number, a.model, f.flight_number, f.status AS flight_status
     FROM aircraft_rotations ar
     JOIN aircraft a ON a.id = ar.aircraft_id
     LEFT JOIN flights f ON f.id = ar.flight_id
     WHERE ar.operational_date = $1::date${extra}
     ORDER BY a.tail_number, ar.sequence_no`,
    params
  );
  return r.rows;
}

export async function getOrCreateDispatchRelease(flightId, userId) {
  const existing = await pool.query(
    `SELECT * FROM dispatch_releases WHERE flight_id = $1
     AND release_status IN ('DRAFT', 'PENDING_APPROVAL', 'RELEASED')
     ORDER BY created_at DESC LIMIT 1`,
    [flightId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const f = await pool.query(`SELECT flight_number FROM flights WHERE id = $1`, [flightId]);
  if (!f.rows[0]) throw Object.assign(new Error('Flight not found.'), { status: 404 });
  const num = `DR-${String(f.rows[0].flight_number).replace(/\W/g, '')}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  const ins = await pool.query(
    `INSERT INTO dispatch_releases (flight_id, release_number, dispatcher_id, checklist_json)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
    [
      flightId,
      num,
      userId,
      JSON.stringify({
        aircraftRelease: false,
        crewRelease: false,
        weatherOk: false,
        notamOk: false,
        fuelPlanOk: false,
        captainApproval: false,
        dispatcherApproval: false
      })
    ]
  );
  return ins.rows[0];
}

export async function updateDispatchRelease(id, body, userId, req = null) {
  const r = await pool.query(
    `UPDATE dispatch_releases SET
      release_status = COALESCE($2, release_status),
      fuel_plan_json = COALESCE($3::jsonb, fuel_plan_json),
      weather_notes = COALESCE($4, weather_notes),
      mel_cdl_notes = COALESCE($5, mel_cdl_notes),
      payload_summary_json = COALESCE($6::jsonb, payload_summary_json),
      operational_remarks = COALESCE($7, operational_remarks),
      crew_validated = COALESCE($8, crew_validated),
      checklist_json = COALESCE($9::jsonb, checklist_json),
      approver_id = COALESCE($10, approver_id),
      captain_ack_at = COALESCE($11::timestamptz, captain_ack_at),
      released_at = CASE WHEN $2 = 'RELEASED' AND released_at IS NULL THEN NOW() ELSE released_at END,
      closed_at = CASE WHEN $2 = 'CLOSED' THEN NOW() ELSE closed_at END,
      updated_at = NOW()
     WHERE id = $1::uuid RETURNING *`,
    [
      id,
      body.releaseStatus ? normalizeStatus(body.releaseStatus) : null,
      body.fuelPlan != null ? JSON.stringify(body.fuelPlan) : null,
      body.weatherNotes ?? body.weather_notes,
      body.melCdlNotes ?? body.mel_cdl_notes,
      body.payloadSummary != null ? JSON.stringify(body.payloadSummary) : null,
      body.operationalRemarks ?? body.operational_remarks,
      body.crewValidated ?? body.crew_validated,
      body.checklist != null ? JSON.stringify(body.checklist) : null,
      body.approverId ?? body.approver_id ?? (normalizeStatus(body.releaseStatus) === 'RELEASED' ? userId : null),
      body.captainAckAt ?? body.captain_ack_at
    ]
  );
  if (!r.rows[0]) throw Object.assign(new Error('Dispatch release not found.'), { status: 404 });
  await auditFlightOps(userId, 'DISPATCH_UPDATE', r.rows[0].flight_id, { releaseId: id, status: r.rows[0].release_status }, req);
  return r.rows[0];
}

export async function listSlots(flightId) {
  const r = await pool.query(
    `SELECT * FROM airport_slots WHERE flight_id = $1 ORDER BY slot_time`,
    [flightId]
  );
  return r.rows;
}

export async function upsertSlot(body, userId) {
  const r = await pool.query(
    `INSERT INTO airport_slots (flight_id, airport, slot_kind, slot_time, coordinator_ref, atc_remarks, priority, curfew_ok, slot_status, created_by)
     VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      body.flightId,
      String(body.airport).toUpperCase(),
      normalizeStatus(body.slotKind || body.slot_kind),
      body.slotTime || body.slot_time,
      body.coordinatorRef || body.coordinator_ref || null,
      body.atcRemarks || body.atc_remarks || null,
      normalizeStatus(body.priority || 'NORMAL'),
      body.curfewOk !== false,
      normalizeStatus(body.slotStatus || body.slot_status || 'REQUESTED'),
      userId
    ]
  );
  return r.rows[0];
}

const DEFAULT_TURNAROUND_STEPS = [
  'ARRIVAL',
  'CLEANING',
  'CATERING',
  'FUELING',
  'BOARDING',
  'BAGGAGE',
  'TECHNICAL',
  'GATE',
  'READY',
  'DEPARTURE'
];

export async function ensureTurnaroundEvents(flightId, stationCode) {
  const existing = await pool.query(`SELECT COUNT(*)::int AS c FROM turnaround_events WHERE flight_id = $1`, [
    flightId
  ]);
  if (Number(existing.rows[0].c) > 0) {
    return listTurnaround(flightId);
  }
  const f = await pool.query(`SELECT departure_time, arrival_time, departure_airport FROM flights WHERE id = $1`, [
    flightId
  ]);
  if (!f.rows[0]) throw Object.assign(new Error('Flight not found.'), { status: 404 });
  const station = stationCode || f.rows[0].departure_airport;
  const base = new Date(f.rows[0].arrival_time || f.rows[0].departure_time);
  let order = 0;
  for (const step of DEFAULT_TURNAROUND_STEPS) {
    const planned = new Date(base.getTime() + order * 8 * 60000);
    await pool.query(
      `INSERT INTO turnaround_events (flight_id, station_code, event_type, event_status, planned_at, sort_order)
       VALUES ($1, $2, $3, 'PENDING', $4::timestamptz, $5)`,
      [flightId, station, step, planned.toISOString(), order]
    );
    order += 1;
  }
  return listTurnaround(flightId);
}

export async function listTurnaround(flightId) {
  const r = await pool.query(
    `SELECT * FROM turnaround_events WHERE flight_id = $1 ORDER BY sort_order, planned_at`,
    [flightId]
  );
  return r.rows;
}

export async function patchTurnaroundEvent(eventId, body) {
  const r = await pool.query(
    `UPDATE turnaround_events SET
      event_status = COALESCE($2, event_status),
      actual_at = COALESCE($3::timestamptz, actual_at),
      delay_reason = COALESCE($4, delay_reason),
      assigned_team = COALESCE($5, assigned_team),
      updated_at = NOW()
     WHERE id = $1::uuid RETURNING *`,
    [
      eventId,
      body.eventStatus ? normalizeStatus(body.eventStatus) : null,
      body.actualAt ?? body.actual_at,
      body.delayReason ?? body.delay_reason,
      body.assignedTeam ?? body.assigned_team
    ]
  );
  if (!r.rows[0]) throw Object.assign(new Error('Turnaround event not found.'), { status: 404 });
  return r.rows[0];
}

export async function getTurnaroundSummary(flightId) {
  const events = await listTurnaround(flightId);
  const f = await pool.query(
    `SELECT departure_time, arrival_time, status FROM flights WHERE id = $1`,
    [flightId]
  );
  if (!f.rows[0]) throw Object.assign(new Error('Flight not found.'), { status: 404 });
  const planned = events.filter((e) => e.planned_at).map((e) => new Date(e.planned_at).getTime());
  const actual = events.filter((e) => e.actual_at).map((e) => new Date(e.actual_at).getTime());
  const plannedTurnaroundMin =
    planned.length >= 2 ? Math.round((Math.max(...planned) - Math.min(...planned)) / 60000) : null;
  const actualTurnaroundMin =
    actual.length >= 2 ? Math.round((Math.max(...actual) - Math.min(...actual)) / 60000) : null;
  const complete = events.filter((e) => e.event_status === 'COMPLETE').length;
  return {
    flightId,
    plannedTurnaroundMin,
    actualTurnaroundMin,
    targetTurnaroundMin: MIN_TURNAROUND_MINUTES,
    eventsComplete: complete,
    eventsTotal: events.length,
    departureReadinessPct: events.length ? Math.round((complete / events.length) * 100) : 0,
    events
  };
}

export async function listOperationalAlerts({ status = 'OPEN', limit = 50 } = {}) {
  const r = await pool.query(
    `SELECT oa.*, f.flight_number, a.tail_number
     FROM operational_alerts oa
     LEFT JOIN flights f ON f.id = oa.flight_id
     LEFT JOIN aircraft a ON a.id = oa.aircraft_id
     WHERE oa.alert_status = $1
     ORDER BY
       CASE oa.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END,
       oa.created_at DESC
     LIMIT $2`,
    [status, limit]
  );
  return r.rows;
}

export async function createOperationalAlert(body, userId) {
  const r = await pool.query(
    `INSERT INTO operational_alerts (alert_type, severity, flight_id, aircraft_id, schedule_id, message, metadata_json, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) RETURNING *`,
    [
      body.alertType || body.alert_type || 'OPS',
      normalizeStatus(body.severity || 'INFO'),
      body.flightId || body.flight_id || null,
      body.aircraftId || body.aircraft_id || null,
      body.scheduleId || body.schedule_id || null,
      body.message,
      JSON.stringify(body.metadata || {}),
      userId
    ]
  );
  return r.rows[0];
}

/** Unified enterprise ops board for a day (delegates to realtime feed). */
export async function getEnterpriseBoard(opsDate) {
  const { getRealtimeFeed } = await import('./flightOpsEnterpriseEngine.js');
  const feed = await getRealtimeFeed(opsDate);
  return {
    operationalDate: feed.operationalDate,
    serverTime: feed.serverTime,
    flights: feed.flights,
    rotations: feed.rotations,
    alerts: feed.alerts,
    activeSchedules: feed.activeSchedules,
    conflicts: feed.conflicts,
    conflictCount: feed.conflictCount,
    utilization: feed.utilization,
    dispatchQueue: feed.dispatchQueue,
    constants: feed.constants
  };
}
