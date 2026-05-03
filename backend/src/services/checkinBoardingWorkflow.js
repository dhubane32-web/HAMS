/**
 * Shared check-in / boarding validation and scan logic.
 */

import { isFlightOpenForBoardingOps } from '../lib/flightOccStatus.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function normGate(g) {
  return String(g || '')
    .trim()
    .toUpperCase();
}

export function assertGateMatchesFlight(flightGate, gateAtScan, { strict = false } = {}) {
  const fg = normGate(flightGate);
  const sg = normGate(gateAtScan);
  if (!sg) return { ok: true };
  if (!fg) {
    if (strict) return { ok: false, message: 'Flight gate not set; cannot validate scanned gate.' };
    return { ok: true };
  }
  if (fg !== sg) {
    return { ok: false, message: `Gate mismatch: expected ${fg}, got ${sg}.` };
  }
  return { ok: true };
}

/** @param {import('pg').PoolClient} client */
export async function runBoardingScan(client, { scan, flightId, gateAtScan, strictGate, userId }) {
  const raw = String(scan || '').trim();
  if (!raw) {
    return { ok: false, status: 400, message: 'scan is required (boarding pass number, ticket number, or PNR + flightId).' };
  }

  const looksLikePnr = /^[A-Z0-9]{6,10}$/i.test(raw) && raw.length <= 10;
  let checkinRow = null;
  let flightGate = null;

  if (/^BP/i.test(raw)) {
    const q = await client.query(
      `SELECT c.id, c.boarding_status, c.passenger_id, c.flight_id, f.gate
       FROM checkins c
       JOIN flights f ON f.id = c.flight_id
       WHERE upper(btrim(c.boarding_pass_no::text)) = upper(btrim($1::text))
         AND upper(btrim(c.boarding_status::text)) IN ('CHECKED_IN', 'BOARDING')`,
      [raw]
    );
    checkinRow = q.rows[0];
    flightGate = checkinRow?.gate ?? null;
  } else if (!looksLikePnr) {
    const q = await client.query(
      `SELECT c.id, c.boarding_status, c.passenger_id, c.flight_id, f.gate
       FROM tickets t
       JOIN checkins c ON c.booking_id = t.booking_id AND c.passenger_id = t.passenger_id
       JOIN flights f ON f.id = c.flight_id
       WHERE t.ticket_number = $1
         AND upper(btrim(c.boarding_status::text)) IN ('CHECKED_IN', 'BOARDING')`,
      [raw]
    );
    if (q.rows.length > 1 && (!flightId || !isUuid(flightId))) {
      return {
        ok: false,
        status: 400,
        message: 'Multiple check-ins match this ticket; include flightId to select the correct leg.'
      };
    }
    checkinRow =
      flightId && isUuid(flightId) ? q.rows.find((r) => r.flight_id === flightId) || null : q.rows[0];
    flightGate = checkinRow?.gate ?? null;
  } else {
    const pnr = raw.toUpperCase();
    if (!flightId || !isUuid(flightId)) {
      return { ok: false, status: 400, message: 'PNR scan requires flightId in the request body.' };
    }
    const q = await client.query(
      `SELECT c.id, c.boarding_status, c.passenger_id, c.flight_id, f.gate
       FROM checkins c
       JOIN bookings b ON b.id = c.booking_id
       JOIN flights f ON f.id = c.flight_id
       WHERE b.pnr = $1 AND c.flight_id = $2
         AND upper(btrim(c.boarding_status::text)) IN ('CHECKED_IN', 'BOARDING')`,
      [pnr, flightId]
    );
    if (q.rowCount === 0) {
      return {
        ok: false,
        status: 404,
        message: 'No checked-in passenger in CHECKED_IN/BOARDING status found for this PNR on this flight.'
      };
    }
    if (q.rowCount > 1) {
      return {
        ok: false,
        status: 409,
        message: 'Multiple passengers match this PNR on this flight; use ticket number or boarding pass scan.'
      };
    }
    checkinRow = q.rows[0];
    flightGate = checkinRow?.gate ?? null;
  }

  if (!checkinRow) {
    return { ok: false, status: 404, message: 'No matching checked-in record for boarding.' };
  }

  const fid = checkinRow.flight_id;
  if (fid) {
    const fsq = await client.query(`SELECT status FROM flights WHERE id = $1`, [fid]);
    const fs = String(fsq.rows[0]?.status || '').toUpperCase();
    if (!isFlightOpenForBoardingOps(fsq.rows[0]?.status)) {
      return {
        ok: false,
        status: 400,
        message: `Boarding scan is not allowed while flight status is ${fs}. Open check-in / boarding / gate first.`
      };
    }
  }

  const gv = assertGateMatchesFlight(flightGate, gateAtScan, { strict: Boolean(strictGate) });
  if (!gv.ok) {
    return { ok: false, status: 400, message: gv.message };
  }

  const prev = String(checkinRow.boarding_status || '').toUpperCase();
  if (prev === 'BOARDED') {
    return { ok: false, status: 409, message: 'Passenger already boarded (duplicate scan rejected).' };
  }
  if (prev === 'NO_SHOW') {
    return { ok: false, status: 400, message: 'Passenger marked no-show; cannot board.' };
  }

  const gateSnap = normGate(gateAtScan) || null;
  await client.query(
    `UPDATE checkins c
     SET boarding_status = 'BOARDED',
         boarded_at = COALESCE(c.boarded_at, NOW()),
         boarding_gate = COALESCE(c.boarding_gate, NULLIF($2::text, ''), NULLIF(btrim(f.gate::text), ''))
     FROM flights f
     WHERE c.id = $1::uuid AND f.id = c.flight_id`,
    [checkinRow.id, gateSnap]
  );
  await client.query(`UPDATE passengers SET travel_status = 'BOARDED' WHERE id = $1`, [checkinRow.passenger_id]);
  await client.query(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, 'BOARDING_SCAN_BOARDED', 'checkins', checkinRow.id, JSON.stringify({ scan: raw, gateAtScan: gateAtScan || null })]
  );

  return { ok: true, checkinId: checkinRow.id, scan: raw };
}
