import { pool } from '../config/db.js';
import { writeAudit } from './auditService.js';
import { MIN_TURNAROUND_MINUTES, isMissingSchema } from './flightOpsEnterpriseService.js';

const ACTIVE_STATUSES = ['SCHEDULED', 'CHECKIN_OPEN', 'BOARDING', 'GATE_CLOSED', 'DEPARTED', 'IN_AIR', 'DELAYED'];

export async function auditFlightOps(userId, action, entityId, metadata = {}, req = null) {
  try {
    await writeAudit(pool, {
      userId,
      action,
      entity: 'flight_ops_enterprise',
      entityId: entityId || null,
      metadata,
      req
    });
  } catch (e) {
    console.warn('[flight-ops-enterprise] audit:', e?.message || e);
  }
}

/** Aircraft time overlap conflicts for an ops day. */
export async function detectDayConflicts(opsDate) {
  const day = opsDate || new Date().toISOString().slice(0, 10);
  const conflicts = [];

  const flights = await pool.query(
    `SELECT f.id, f.flight_number, f.aircraft_id, f.departure_time, f.arrival_time, f.status,
            a.tail_number
     FROM flights f
     LEFT JOIN aircraft a ON a.id = f.aircraft_id
     WHERE (f.departure_time AT TIME ZONE 'UTC')::date = $1::date
       AND UPPER(TRIM(f.status)) NOT IN ('CANCELLED', 'ARRIVED', 'LANDED')
     ORDER BY f.aircraft_id NULLS LAST, f.departure_time`,
    [day]
  );

  const byAircraft = new Map();
  for (const f of flights.rows) {
    if (!f.aircraft_id) {
      conflicts.push({
        kind: 'UNASSIGNED_AIRCRAFT',
        severity: 'WARNING',
        flightId: f.id,
        flightNumber: f.flight_number,
        message: `${f.flight_number} has no aircraft assigned`
      });
      continue;
    }
    if (!byAircraft.has(f.aircraft_id)) byAircraft.set(f.aircraft_id, []);
    byAircraft.get(f.aircraft_id).push(f);
  }

  for (const [, legs] of byAircraft) {
    legs.sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time));
    for (let i = 1; i < legs.length; i += 1) {
      const prev = legs[i - 1];
      const cur = legs[i];
      const gapMin = Math.round((new Date(cur.departure_time) - new Date(prev.arrival_time)) / 60000);
      if (gapMin < MIN_TURNAROUND_MINUTES) {
        conflicts.push({
          kind: 'ROTATION_TURNAROUND',
          severity: 'CRITICAL',
          flightId: cur.id,
          flightNumber: cur.flight_number,
          aircraftId: cur.aircraft_id,
          tailNumber: cur.tail_number,
          message: `${cur.tail_number}: ${prev.flight_number}→${cur.flight_number} turnaround ${gapMin} min (min ${MIN_TURNAROUND_MINUTES})`,
          metadata: { gapMin, previousFlightId: prev.id }
        });
      }
      if (new Date(cur.departure_time) < new Date(prev.arrival_time)) {
        conflicts.push({
          kind: 'AIRCRAFT_OVERLAP',
          severity: 'CRITICAL',
          flightId: cur.id,
          flightNumber: cur.flight_number,
          aircraftId: cur.aircraft_id,
          tailNumber: cur.tail_number,
          message: `${cur.tail_number}: overlapping ${prev.flight_number} and ${cur.flight_number}`,
          metadata: { previousFlightId: prev.id }
        });
      }
    }
  }

  try {
    const rot = await pool.query(
      `SELECT ar.*, a.tail_number, f.flight_number
       FROM aircraft_rotations ar
       JOIN aircraft a ON a.id = ar.aircraft_id
       LEFT JOIN flights f ON f.id = ar.flight_id
       WHERE ar.operational_date = $1::date AND ar.rotation_status = 'CONFLICT'`,
      [day]
    );
    for (const r of rot.rows) {
      if (r.conflict_reason) {
        conflicts.push({
          kind: 'ROTATION_PLAN',
          severity: 'WARNING',
          flightId: r.flight_id,
          flightNumber: r.flight_number,
          aircraftId: r.aircraft_id,
          tailNumber: r.tail_number,
          message: r.conflict_reason,
          metadata: { rotationId: r.id }
        });
      }
    }
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
  }

  try {
    const slots = await pool.query(
      `SELECT s1.id AS id1, s2.id AS id2, s1.airport, s1.slot_time AS t1, s2.slot_time AS t2,
              f1.flight_number AS fn1, f2.flight_number AS fn2
       FROM airport_slots s1
       JOIN airport_slots s2 ON s1.airport = s2.airport AND s1.id < s2.id
       JOIN flights f1 ON f1.id = s1.flight_id
       JOIN flights f2 ON f2.id = s2.flight_id
       WHERE (f1.departure_time AT TIME ZONE 'UTC')::date = $1::date
         AND s1.slot_status NOT IN ('CANCELLED') AND s2.slot_status NOT IN ('CANCELLED')
         AND ABS(EXTRACT(EPOCH FROM (s1.slot_time - s2.slot_time))) < 900`,
      [day]
    );
    for (const s of slots.rows) {
      conflicts.push({
        kind: 'SLOT_CONFLICT',
        severity: 'WARNING',
        message: `Slot conflict at ${s.airport}: ${s.fn1} and ${s.fn2} within 15 min`,
        metadata: { slotId1: s.id1, slotId2: s.id2, airport: s.airport }
      });
    }
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
  }

  return { operationalDate: day, conflicts, conflictCount: conflicts.length };
}

export async function getAircraftUtilization(opsDate) {
  const day = opsDate || new Date().toISOString().slice(0, 10);
  const r = await pool.query(
    `SELECT a.id, a.tail_number, a.model, a.seat_capacity, a.release_status,
            COUNT(f.id)::int AS flight_count,
            COALESCE(SUM(EXTRACT(EPOCH FROM (f.arrival_time - f.departure_time)) / 3600.0), 0)::numeric(10,2) AS block_hours
     FROM aircraft a
     LEFT JOIN flights f ON f.aircraft_id = a.id
       AND (f.departure_time AT TIME ZONE 'UTC')::date = $1::date
       AND UPPER(TRIM(f.status)) NOT IN ('CANCELLED')
     GROUP BY a.id, a.tail_number, a.model, a.seat_capacity, a.release_status
     ORDER BY a.tail_number`,
    [day]
  );
  const maxDailyHours = 14;
  return {
    operationalDate: day,
    fleet: r.rows.map((row) => ({
      ...row,
      utilizationPct: Math.min(100, Math.round((Number(row.block_hours) / maxDailyHours) * 100)),
      status:
        String(row.release_status).toUpperCase() !== 'RELEASED'
          ? 'MAINTENANCE'
          : Number(row.flight_count) === 0
            ? 'AVAILABLE'
            : Number(row.block_hours) >= maxDailyHours * 0.85
              ? 'ASSIGNED'
              : 'ASSIGNED'
    }))
  };
}

export async function getDispatchQueue(opsDate) {
  const day = opsDate || new Date().toISOString().slice(0, 10);
  try {
    const r = await pool.query(
      `SELECT f.id, f.flight_number, f.departure_time, f.status,
              dr.id AS release_id, dr.release_status, dr.release_number
       FROM flights f
       LEFT JOIN LATERAL (
         SELECT id, release_status, release_number
         FROM dispatch_releases
         WHERE flight_id = f.id
         ORDER BY created_at DESC
         LIMIT 1
       ) dr ON TRUE
       WHERE (f.departure_time AT TIME ZONE 'UTC')::date = $1::date
         AND UPPER(TRIM(f.status)) NOT IN ('CANCELLED', 'ARRIVED', 'LANDED')
       ORDER BY f.departure_time`,
      [day]
    );
    return r.rows.map((row) => ({
      ...row,
      needsRelease: !row.release_status || !['RELEASED', 'DEPARTED', 'CLOSED'].includes(row.release_status)
    }));
  } catch (e) {
    if (isMissingSchema(e)) return [];
    throw e;
  }
}

export async function rescheduleFlight({ flightId, departureTime, arrivalTime, userId, req }) {
  const dep = new Date(departureTime);
  const arr = new Date(arrivalTime);
  if (Number.isNaN(dep.getTime()) || Number.isNaN(arr.getTime())) {
    throw Object.assign(new Error('Invalid departure or arrival time.'), { status: 400 });
  }
  if (arr <= dep) {
    throw Object.assign(new Error('Arrival must be after departure.'), { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const f = await client.query(`SELECT * FROM flights WHERE id = $1 FOR UPDATE`, [flightId]);
    if (!f.rows[0]) throw Object.assign(new Error('Flight not found.'), { status: 404 });
    const flight = f.rows[0];

    if (flight.aircraft_id) {
      const overlap = await client.query(
        `SELECT f.id, f.flight_number FROM flights f
         WHERE f.aircraft_id = $1 AND f.id <> $2
           AND UPPER(TRIM(f.status)) NOT IN ('CANCELLED','ARRIVED','LANDED')
           AND f.departure_time < $4::timestamptz + ($5::int * interval '1 minute')
           AND f.arrival_time + ($5::int * interval '1 minute') > $3::timestamptz`,
        [flight.aircraft_id, flightId, dep.toISOString(), arr.toISOString(), MIN_TURNAROUND_MINUTES]
      );
      if (overlap.rows[0]) {
        throw Object.assign(
          new Error(`Reschedule conflicts with ${overlap.rows[0].flight_number} (aircraft rotation).`),
          { status: 409 }
        );
      }
    }

    const u = await client.query(
      `UPDATE flights SET departure_time = $2::timestamptz, arrival_time = $3::timestamptz, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [flightId, dep.toISOString(), arr.toISOString()]
    );
    await client.query('COMMIT');
    await auditFlightOps(userId, 'FLIGHT_RESCHEDULE', flightId, {
      previousDeparture: flight.departure_time,
      previousArrival: flight.arrival_time,
      departureTime: dep.toISOString(),
      arrivalTime: arr.toISOString()
    }, req);
    return u.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function syncConflictAlerts(opsDate, userId) {
  const { conflicts } = await detectDayConflicts(opsDate);
  const created = [];
  for (const c of conflicts) {
    const key = `${c.kind}:${c.flightId || ''}:${c.message}`;
    const dup = await pool.query(
      `SELECT id FROM operational_alerts
       WHERE alert_status = 'OPEN' AND alert_type = $1 AND message = $2 LIMIT 1`,
      [c.kind, c.message]
    );
    if (dup.rows[0]) continue;
    try {
      const ins = await pool.query(
        `INSERT INTO operational_alerts (alert_type, severity, flight_id, aircraft_id, message, metadata_json, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id`,
        [
          c.kind,
          c.severity || 'WARNING',
          c.flightId || null,
          c.aircraftId || null,
          c.message,
          JSON.stringify(c.metadata || {}),
          userId || null
        ]
      );
      created.push(ins.rows[0].id);
    } catch (e) {
      if (!isMissingSchema(e)) throw e;
    }
  }
  return { scanned: conflicts.length, alertsCreated: created.length };
}

export async function acknowledgeAlert(alertId, userId) {
  const r = await pool.query(
    `UPDATE operational_alerts SET alert_status = 'ACK', acknowledged_by = $2, acknowledged_at = NOW()
     WHERE id = $1::uuid AND alert_status = 'OPEN' RETURNING *`,
    [alertId, userId]
  );
  if (!r.rows[0]) throw Object.assign(new Error('Alert not found or already closed.'), { status: 404 });
  return r.rows[0];
}

export async function listFlightOpsAudit({ entityId, limit = 40 } = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 40));
  const r = entityId
    ? await pool.query(
        `SELECT id, user_id, action, entity, entity_id, metadata, created_at
         FROM audit_logs
         WHERE entity = 'flight_ops_enterprise' AND entity_id = $1::uuid
         ORDER BY created_at DESC
         LIMIT $2`,
        [entityId, lim]
      )
    : await pool.query(
        `SELECT id, user_id, action, entity, entity_id, metadata, created_at
         FROM audit_logs
         WHERE entity = 'flight_ops_enterprise'
         ORDER BY created_at DESC
         LIMIT $1`,
        [lim]
      );
  return r.rows;
}

export async function getTurnaroundLive(flightId) {
  const summary = await pool.query(
    `SELECT te.*, f.departure_time, f.arrival_time, f.status AS flight_status
     FROM turnaround_events te
     JOIN flights f ON f.id = te.flight_id
     WHERE te.flight_id = $1
     ORDER BY te.sort_order, te.planned_at`,
    [flightId]
  );
  if (!summary.rows.length) return { events: [], countdownSec: null, flightId };
  const now = Date.now();
  const next = summary.rows.find((e) => e.event_status !== 'COMPLETE' && e.planned_at);
  const countdownSec = next?.planned_at
    ? Math.max(0, Math.round((new Date(next.planned_at).getTime() - now) / 1000))
    : null;
  const complete = summary.rows.filter((e) => e.event_status === 'COMPLETE').length;
  return {
    flightId,
    events: summary.rows,
    eventsComplete: complete,
    eventsTotal: summary.rows.length,
    departureReadinessPct: summary.rows.length ? Math.round((complete / summary.rows.length) * 100) : 0,
    countdownSec,
    nextEventType: next?.event_type || null,
    serverTime: new Date().toISOString()
  };
}

export async function cancelEnterpriseFlight(flightId, reason, userId, req) {
  const r = String(reason || '').trim();
  if (r.length < 3) throw Object.assign(new Error('Cancellation reason required (min 3 chars).'), { status: 400 });
  const u = await pool.query(
    `UPDATE flights SET status = 'CANCELLED', cancellation_reason = $2, cancelled_at = NOW(), updated_at = NOW()
     WHERE id = $1::uuid AND UPPER(TRIM(status)) <> 'CANCELLED'
     RETURNING id, flight_number, status, cancellation_reason, cancelled_at`,
    [flightId, r]
  );
  if (!u.rows[0]) {
    const ex = await pool.query(`SELECT id, status FROM flights WHERE id = $1`, [flightId]);
    if (!ex.rows[0]) throw Object.assign(new Error('Flight not found.'), { status: 404 });
    throw Object.assign(new Error('Flight is already cancelled.'), { status: 400 });
  }
  try {
    await pool.query(
      `INSERT INTO operational_alerts (alert_type, severity, flight_id, message, created_by)
       VALUES ('CANCELLATION', 'WARNING', $1, $2, $3)`,
      [flightId, `Flight ${u.rows[0].flight_number} cancelled: ${r}`, userId]
    );
  } catch {
    /* optional */
  }
  await auditFlightOps(userId, 'FLIGHT_CANCEL', flightId, { reason: r }, req);
  return u.rows[0];
}

export async function getRealtimeFeed(opsDate) {
  const day = opsDate || new Date().toISOString().slice(0, 10);
  const serverTime = new Date().toISOString();

  let flights = [];
  let alerts = [];
  let rotations = [];
  let activeSchedules = 0;

  try {
    try {
      const f = await pool.query(
        `SELECT f.*, a.tail_number, a.model, a.release_status AS aircraft_release_status,
                (SELECT release_status FROM dispatch_releases dr WHERE dr.flight_id = f.id ORDER BY created_at DESC LIMIT 1) AS dispatch_release_status,
                (SELECT COALESCE(SUM(delay_minutes), 0)::int FROM flight_delays fd WHERE fd.flight_id = f.id) AS total_delay_min
         FROM flights f
         LEFT JOIN aircraft a ON a.id = f.aircraft_id
         WHERE (f.departure_time AT TIME ZONE 'UTC')::date = $1::date
         ORDER BY f.departure_time`,
        [day]
      );
      flights = f.rows;
    } catch (e) {
      if (e?.code === '42P01' || isMissingSchema(e)) {
        const f2 = await pool.query(
          `SELECT f.*, a.tail_number, a.model, a.release_status AS aircraft_release_status
           FROM flights f
           LEFT JOIN aircraft a ON a.id = f.aircraft_id
           WHERE (f.departure_time AT TIME ZONE 'UTC')::date = $1::date
           ORDER BY f.departure_time`,
          [day]
        );
        flights = f2.rows;
      } else throw e;
    }
  } catch (e) {
    if (!isMissingSchema(e) && e?.code !== '42P01') throw e;
  }

  try {
    const a = await pool.query(
      `SELECT oa.*, f.flight_number, ac.tail_number
       FROM operational_alerts oa
       LEFT JOIN flights f ON f.id = oa.flight_id
       LEFT JOIN aircraft ac ON ac.id = oa.aircraft_id
       WHERE oa.alert_status = 'OPEN'
       ORDER BY CASE oa.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, oa.created_at DESC
       LIMIT 30`
    );
    alerts = a.rows;
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
  }

  try {
    const s = await pool.query(
      `SELECT COUNT(*)::int AS c FROM flight_schedules WHERE schedule_status IN ('PLANNED','ACTIVE')`
    );
    activeSchedules = Number(s.rows[0]?.c || 0);
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
  }

  try {
    const rot = await pool.query(
      `SELECT ar.*, a.tail_number, f.flight_number
       FROM aircraft_rotations ar
       JOIN aircraft a ON a.id = ar.aircraft_id
       LEFT JOIN flights f ON f.id = ar.flight_id
       WHERE ar.operational_date = $1::date
       ORDER BY a.tail_number, ar.sequence_no`,
      [day]
    );
    rotations = rot.rows;
  } catch (e) {
    if (!isMissingSchema(e)) throw e;
  }

  const [conflictPack, utilization, dispatchQueue] = await Promise.all([
    detectDayConflicts(day).catch(() => ({ conflicts: [], conflictCount: 0 })),
    getAircraftUtilization(day).catch(() => ({ fleet: [] })),
    getDispatchQueue(day)
  ]);

  return {
    serverTime,
    operationalDate: day,
    flights,
    alerts,
    rotations,
    activeSchedules,
    conflicts: conflictPack.conflicts || [],
    conflictCount: conflictPack.conflictCount || 0,
    utilization: utilization.fleet || [],
    dispatchQueue,
    constants: { minTurnaroundMinutes: MIN_TURNAROUND_MINUTES }
  };
}
