/**
 * Shared check-in / boarding lookup and seat inventory (airline-style operations).
 */

import { isFlightOpenForPassengerCheckin } from '../lib/flightOccStatus.js';

export function computeBoardingDisplayIso(flight) {
  if (flight.boarding_time) {
    return new Date(flight.boarding_time).toISOString();
  }
  const d = new Date(flight.departure_time);
  d.setMinutes(d.getMinutes() - 40);
  return d.toISOString();
}

export function legOperationalStatus(checkinId, boardingStatus) {
  if (!checkinId) return 'NOT_CHECKED_IN';
  const u = String(boardingStatus || 'CHECKED_IN').toUpperCase();
  if (u === 'BOARDED') return 'BOARDED';
  if (u === 'NO_SHOW') return 'NO_SHOW';
  if (u === 'BOARDING') return 'BOARDING';
  return 'CHECKED_IN';
}

function seatLettersForEconomy(economy) {
  if (economy === '2-2') return ['A', 'B', 'C', 'D'];
  return ['A', 'B', 'C', 'D', 'E', 'F'];
}

export function buildSeatGrid(layoutJson, seatCapacity, occupiedUpper) {
  const occ = new Set((occupiedUpper || []).map((s) => String(s || '').toUpperCase().replace(/\s/g, '')));
  const rows = Math.max(1, Math.min(Number(layoutJson?.rows) || 30, 60));
  const economy = String(layoutJson?.economy || '3-3');
  const letters = seatLettersForEconomy(economy);
  const seats = [];
  let count = 0;
  for (let r = 1; r <= rows && count < seatCapacity; r += 1) {
    for (const L of letters) {
      if (count >= seatCapacity) break;
      const id = `${r}${L}`;
      const up = id.toUpperCase();
      seats.push({
        id,
        cabin: 'Y',
        available: !occ.has(up)
      });
      count += 1;
    }
  }
  return seats;
}

export async function buildSeatMapPayload(pool, flightId) {
  const flightRow = await pool.query(
    `SELECT f.id,
            COALESCE(a.seat_capacity, 0)::int AS seat_capacity,
            a.seat_map_id,
            sm.layout_json
     FROM flights f
     LEFT JOIN aircraft a ON a.id = f.aircraft_id
     LEFT JOIN md_seat_maps sm ON sm.id = a.seat_map_id
     WHERE f.id = $1`,
    [flightId]
  );
  if (!flightRow.rows[0]) {
    return { notFound: true };
  }
  const { seat_capacity: seatCapacity, layout_json: layoutJson } = flightRow.rows[0];
  const occ = await pool.query(
    `SELECT upper(btrim(seat_number::text)) AS seat_number
     FROM checkins
     WHERE flight_id = $1 AND seat_number IS NOT NULL AND btrim(seat_number::text) <> ''`,
    [flightId]
  );
  const occupiedSeats = occ.rows.map((r) => r.seat_number);
  const layoutSource = layoutJson && Object.keys(layoutJson).length ? 'md_seat_maps' : 'synthetic';
  const effectiveLayout =
    layoutSource === 'md_seat_maps' ? layoutJson : { rows: Math.ceil(Math.max(seatCapacity, 1) / 6), economy: '3-3' };
  const seats = buildSeatGrid(effectiveLayout, Math.max(seatCapacity, 1), occupiedSeats);
  return {
    flightId,
    seatCapacity,
    occupiedSeats,
    layoutSource,
    layoutMeta: effectiveLayout,
    seats
  };
}

export async function buildCheckinLookupPayload(pool, booking, lookupMeta = {}) {
  const assertFn = typeof lookupMeta.assertEligible === 'function' ? lookupMeta.assertEligible : () => ({ ok: true });
  const eligibility = assertFn(booking);

  const itinerary = await pool.query(
    `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time, f.arrival_time, f.status, f.gate, f.boarding_time, f.checkin_closed_at, bf.leg_type
     FROM booking_flights bf
     JOIN flights f ON f.id = bf.flight_id
     WHERE bf.booking_id = $1
     ORDER BY f.departure_time ASC`,
    [booking.id]
  );

  const legs = itinerary.rows.map((f) => ({
    ...f,
    checkin_closed: Boolean(f.checkin_closed_at),
    boarding_display_time: computeBoardingDisplayIso(f),
    gate_display: f.gate || 'TBD'
  }));

  const paxRows = await pool.query(
    `SELECT
        p.id,
        p.first_name,
        p.last_name,
        p.email,
        p.passport_no,
        p.travel_status,
        f.id AS flight_id,
        f.flight_number,
        f.departure_airport,
        f.arrival_airport,
        f.departure_time,
        f.arrival_time,
        f.status AS flight_status,
        f.gate,
        f.boarding_time,
        f.checkin_closed_at,
        bf.leg_type,
        c.id AS checkin_id,
        c.seat_number,
        c.boarding_pass_no,
        c.checkin_time,
        c.boarding_status,
        c.checkin_status,
        c.boarded_at,
        c.boarding_gate,
        c.boarding_sequence,
        (
          SELECT t.ticket_number
          FROM tickets t
          WHERE t.booking_id = b.id AND t.passenger_id = p.id
          ORDER BY t.issued_at DESC
          LIMIT 1
        ) AS ticket_number,
        (
          SELECT UPPER(TRIM(t.ticket_status))
          FROM tickets t
          WHERE t.booking_id = b.id AND t.passenger_id = p.id
          ORDER BY t.issued_at DESC
          LIMIT 1
        ) AS ticket_status
      FROM booking_passengers bp
      JOIN passengers p ON p.id = bp.passenger_id
      JOIN bookings b ON b.id = bp.booking_id
      JOIN booking_flights bf ON bf.booking_id = b.id
      JOIN flights f ON f.id = bf.flight_id
      LEFT JOIN checkins c
        ON c.booking_id = b.id AND c.passenger_id = p.id AND c.flight_id = f.id
      WHERE b.id = $1
      ORDER BY f.departure_time ASC, p.last_name, p.first_name`,
    [booking.id]
  );

  let anyPassportOnFile = false;
  const byPassenger = {};
  for (const row of paxRows.rows) {
    if (row.passport_no && String(row.passport_no).trim()) anyPassportOnFile = true;
    if (!byPassenger[row.id]) {
      byPassenger[row.id] = {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        passport_no: row.passport_no,
        travel_status: row.travel_status,
        legs: []
      };
    }
    byPassenger[row.id].legs.push({
      flight_id: row.flight_id,
      flight_number: row.flight_number,
      departure_airport: row.departure_airport,
      arrival_airport: row.arrival_airport,
      departure_time: row.departure_time,
      arrival_time: row.arrival_time,
      flight_status: row.flight_status,
      gate: row.gate,
      gate_display: row.gate || 'TBD',
      boarding_time: row.boarding_time,
      checkin_closed: Boolean(row.checkin_closed_at),
      boarding_display_time: computeBoardingDisplayIso(row),
      leg_type: row.leg_type,
      ticket_number: row.ticket_number,
      ticket_status: row.ticket_status ?? null,
      checkin_id: row.checkin_id,
      seat_number: row.seat_number,
      boarding_pass_no: row.boarding_pass_no,
      checkin_time: row.checkin_time,
      boarding_status: row.boarding_status,
      checkin_status: row.checkin_status,
      boarded_at: row.boarded_at,
      boarding_gate: row.boarding_gate,
      boarding_sequence: row.boarding_sequence ?? null,
      is_checked_in: Boolean(row.checkin_id),
      operational_status: legOperationalStatus(row.checkin_id, row.boarding_status)
    });
  }

  const passengers = Object.values(byPassenger);

  const relaxScheduled = String(process.env.OCC_RELAX_CHECKIN_STATUSES || '').toLowerCase() === 'true';
  const flightStatusIssues = legs
    .filter((leg) => !isFlightOpenForPassengerCheckin(String(leg.status || ''), { relaxScheduled }))
    .map((leg) => ({
      flight_id: leg.id,
      flight_number: leg.flight_number,
      status: leg.status
    }));

  return {
    booking,
    lookup: {
      source: lookupMeta.source || 'PNR',
      ticket_number: lookupMeta.ticketNumber || null
    },
    verification: {
      booking_status: booking.booking_status,
      payment_status: booking.payment_status,
      flight_status_blocked_legs: flightStatusIssues,
      last_name_match_required: true,
      passport_last4_required_when_on_file: anyPassportOnFile,
      optional_first_name_match: true
    },
    checkInEligible: eligibility.ok,
    checkInBlockedReason: eligibility.ok ? null : eligibility.message,
    itinerary: legs,
    passengers
  };
}

export async function buildBoardingPassView(pool, checkinId) {
  const r = await pool.query(
    `SELECT c.id AS checkin_id,
            c.seat_number,
            c.boarding_pass_no,
            c.boarding_status,
            c.checkin_status,
            c.boarded_at,
            c.boarding_gate,
            c.boarding_sequence,
            c.checkin_time,
            b.pnr,
            p.first_name,
            p.last_name,
            f.flight_number,
            f.departure_airport,
            f.arrival_airport,
            f.departure_time,
            f.gate,
            f.boarding_time,
            (
              SELECT t.ticket_number FROM tickets t
              WHERE t.booking_id = b.id AND t.passenger_id = p.id
              ORDER BY t.issued_at DESC LIMIT 1
            ) AS ticket_number
     FROM checkins c
     JOIN bookings b ON b.id = c.booking_id
     JOIN passengers p ON p.id = c.passenger_id
     JOIN flights f ON f.id = c.flight_id
     WHERE c.id = $1`,
    [checkinId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const ff = {
    flight_number: row.flight_number,
    departure_airport: row.departure_airport,
    arrival_airport: row.arrival_airport,
    departure_time: row.departure_time,
    gate: row.gate,
    boarding_time: row.boarding_time
  };
  const gateDisplay = row.boarding_gate || row.gate || 'TBD';
  const boardingTimeIso = computeBoardingDisplayIso(ff);
  const passengerName = `${row.first_name} ${row.last_name}`.trim();
  return {
    checkin_id: row.checkin_id,
    passengerName,
    pnr: row.pnr,
    ticketNumber: row.ticket_number,
    flightNumber: row.flight_number,
    route: `${row.departure_airport}→${row.arrival_airport}`,
    seat: row.seat_number,
    gate: gateDisplay,
    boardingTime: boardingTimeIso,
    departureTime: row.departure_time,
    boardingPassNo: row.boarding_pass_no,
    boarding_status: row.boarding_status,
    checkin_status: row.checkin_status,
    boarded_at: row.boarded_at,
    boarding_gate: row.boarding_gate,
    checkin_time: row.checkin_time,
    boarding_sequence: row.boarding_sequence ?? null
  };
}
