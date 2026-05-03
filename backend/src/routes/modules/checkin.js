import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import { evaluateBaggageAllowance } from '../../services/masterDataBaggage.js';
import {
  computeBoardingDisplayIso,
  buildSeatMapPayload,
  buildCheckinLookupPayload,
  buildBoardingPassView
} from '../../services/checkinBoardingService.js';
import { assertGateMatchesFlight, runBoardingScan } from '../../services/checkinBoardingWorkflow.js';

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

router.get('/health', (_req, res) => {
  res.json({ module: 'checkin', status: 'ready' });
});

/**
 * GET /api/checkin/search?q=&type=
 * type: pnr | ticket | name | auto (default auto: try PNR, then ticket, then name)
 */
router.get('/search', requireAuth, requireRoles('admin', 'agent', 'operations', 'customer_service', 'sales_manager'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  const type = String(req.query.type || 'auto').toLowerCase();
  if (!q) {
    return res.status(400).json({ message: 'Query parameter q is required.' });
  }
  try {
    if (type === 'name') {
      const nameRows = await pool.query(
        `SELECT DISTINCT ON (b.id, p.id)
            b.id AS booking_id,
            b.pnr,
            b.booking_status,
            b.payment_status,
            p.id AS passenger_id,
            p.first_name,
            p.last_name
         FROM bookings b
         JOIN booking_passengers bp ON bp.booking_id = b.id
         JOIN passengers p ON p.id = bp.passenger_id
         WHERE UPPER(TRIM(b.booking_status)) = 'CONFIRMED'
           AND UPPER(TRIM(COALESCE(b.payment_status, ''))) = 'PAID'
           AND (
             upper(btrim(p.first_name || ' ' || p.last_name)) LIKE '%' || upper(btrim($1::text)) || '%'
             OR upper(btrim(p.last_name || ' ' || p.first_name)) LIKE '%' || upper(btrim($1::text)) || '%'
           )
         ORDER BY b.id, p.id, b.created_at DESC
         LIMIT 25`,
        [q]
      );
      return res.status(200).json({
        matchType: 'NAME',
        query: q,
        results: nameRows.rows.map((r) => ({
          booking_id: r.booking_id,
          pnr: r.pnr,
          booking_status: r.booking_status,
          payment_status: r.payment_status,
          passenger: { id: r.passenger_id, first_name: r.first_name, last_name: r.last_name }
        }))
      });
    }

    if (type === 'ticket') {
      const ticketNumber = decodeURIComponent(q);
      const ticketResult = await pool.query(
        `SELECT b.id, b.pnr, b.booking_status, b.payment_status, b.trip_type, b.total_amount, b.currency, b.created_at
         FROM tickets t
         JOIN bookings b ON b.id = t.booking_id
         WHERE t.ticket_number = $1`,
        [ticketNumber]
      );
      const booking = ticketResult.rows[0];
      if (!booking) {
        return res.status(404).json({ message: 'Ticket not found.', matchType: 'TICKET' });
      }
      const payload = await buildCheckinLookupPayload(pool, booking, {
        source: 'TICKET',
        ticketNumber,
        assertEligible: assertBookingCheckinEligible
      });
      return res.status(200).json({ matchType: 'TICKET', ...payload });
    }

    if (type === 'pnr') {
      const pnr = q.toUpperCase();
      const bookingResult = await pool.query(
        `SELECT id, pnr, booking_status, payment_status, trip_type, total_amount, currency, created_at
         FROM bookings WHERE pnr = $1`,
        [pnr]
      );
      const booking = bookingResult.rows[0];
      if (!booking) {
        return res.status(404).json({ message: 'PNR not found.', matchType: 'PNR' });
      }
      const payload = await buildCheckinLookupPayload(pool, booking, {
        source: 'PNR',
        assertEligible: assertBookingCheckinEligible
      });
      return res.status(200).json({ matchType: 'PNR', ...payload });
    }

    // auto
    const asPnr = q.toUpperCase();
    if (/^[A-Z0-9]{6,10}$/i.test(q) && q.length <= 10) {
      const bookingResult = await pool.query(
        `SELECT id, pnr, booking_status, payment_status, trip_type, total_amount, currency, created_at
         FROM bookings WHERE pnr = $1`,
        [asPnr]
      );
      const booking = bookingResult.rows[0];
      if (booking) {
        const payload = await buildCheckinLookupPayload(pool, booking, {
          source: 'PNR',
          assertEligible: assertBookingCheckinEligible
        });
        return res.status(200).json({ matchType: 'PNR', ...payload });
      }
    }

    const ticketResult = await pool.query(
      `SELECT b.id, b.pnr, b.booking_status, b.payment_status, b.trip_type, b.total_amount, b.currency, b.created_at
       FROM tickets t
       JOIN bookings b ON b.id = t.booking_id
       WHERE t.ticket_number = $1`,
      [q]
    );
    const ticketBooking = ticketResult.rows[0];
    if (ticketBooking) {
      const payload = await buildCheckinLookupPayload(pool, ticketBooking, {
        source: 'TICKET',
        ticketNumber: q,
        assertEligible: assertBookingCheckinEligible
      });
      return res.status(200).json({ matchType: 'TICKET', ...payload });
    }

    const nameRows = await pool.query(
      `SELECT DISTINCT ON (b.id, p.id)
          b.id AS booking_id,
          b.pnr,
          b.booking_status,
          b.payment_status,
          p.id AS passenger_id,
          p.first_name,
          p.last_name
       FROM bookings b
       JOIN booking_passengers bp ON bp.booking_id = b.id
       JOIN passengers p ON p.id = bp.passenger_id
       WHERE UPPER(TRIM(b.booking_status)) = 'CONFIRMED'
         AND UPPER(TRIM(COALESCE(b.payment_status, ''))) = 'PAID'
         AND (
           upper(btrim(p.first_name || ' ' || p.last_name)) LIKE '%' || upper(btrim($1::text)) || '%'
           OR upper(btrim(p.last_name || ' ' || p.first_name)) LIKE '%' || upper(btrim($1::text)) || '%'
         )
       ORDER BY b.id, p.id, b.created_at DESC
       LIMIT 25`,
      [q]
    );
    if (!nameRows.rows.length) {
      return res.status(404).json({ message: 'No booking found for this search.', matchType: 'NONE' });
    }
    return res.status(200).json({
      matchType: 'NAME',
      query: q,
      results: nameRows.rows.map((r) => ({
        booking_id: r.booking_id,
        pnr: r.pnr,
        booking_status: r.booking_status,
        payment_status: r.payment_status,
        passenger: { id: r.passenger_id, first_name: r.first_name, last_name: r.last_name }
      }))
    });
  } catch (error) {
    return res.status(500).json({ message: 'Search failed.', error: error.message });
  }
});

function randomDigits(length) {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
}

async function generateUniqueBoardingPassNo(client) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `BP${randomDigits(10)}`;
    const exists = await client.query('SELECT 1 FROM checkins WHERE boarding_pass_no = $1', [code]);
    if (exists.rowCount === 0) {
      return code;
    }
  }
  throw new Error('Unable to generate unique boarding pass number.');
}

async function generateUniqueBagTag(client) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `BG${randomDigits(10)}`;
    const exists = await client.query('SELECT 1 FROM baggage WHERE tag_number = $1', [code]);
    if (exists.rowCount === 0) {
      return code;
    }
  }
  throw new Error('Unable to generate unique baggage tag.');
}

function assertBookingCheckinEligible(booking) {
  if (!booking) {
    return { ok: false, status: 404, message: 'PNR not found.' };
  }
  if (String(booking.booking_status || '').toUpperCase() === 'CANCELLED') {
    return { ok: false, status: 400, message: 'Cancelled bookings cannot check in.' };
  }
  if (String(booking.booking_status || '').toUpperCase() !== 'CONFIRMED') {
    return { ok: false, status: 400, message: 'Booking must be confirmed before check-in.' };
  }
  const pay = String(booking.payment_status || '').toUpperCase();
  if (pay !== 'PAID') {
    return {
      ok: false,
      status: 400,
      message: 'Booking must be fully paid before check-in. Payment status is not PAID.'
    };
  }
  return { ok: true };
}

function normalizePassportTail(passportNo) {
  return String(passportNo || '')
    .replace(/\s/g, '')
    .toUpperCase();
}

function verifyPassengerIdentity(
  passengerRow,
  verificationLastName,
  verificationPassportLast4,
  verificationFirstName
) {
  const first = String(verificationFirstName || '').trim();
  if (first && String(passengerRow.first_name || '').trim().toUpperCase() !== first.toUpperCase()) {
    return { ok: false, message: 'First name does not match the passenger record.' };
  }
  const last = String(verificationLastName || '').trim();
  if (!last) {
    return { ok: false, message: 'verificationLastName is required for passenger verification.' };
  }
  if (String(passengerRow.last_name || '').trim().toUpperCase() !== last.toUpperCase()) {
    return { ok: false, message: 'Last name does not match the passenger record.' };
  }
  const passport = normalizePassportTail(passengerRow.passport_no);
  const suffix = String(verificationPassportLast4 || '')
    .replace(/\s/g, '')
    .toUpperCase();
  if (!passport) {
    if (suffix) {
      return { ok: false, message: 'No passport on file; leave verificationPassportLast4 empty or add passport to the profile.' };
    }
    return { ok: true };
  }
  if (!suffix || suffix.length < 2) {
    return { ok: false, message: 'verificationPassportLast4 is required when a passport is on file.' };
  }
  const tail = suffix.slice(-4);
  if (!passport.endsWith(tail)) {
    return { ok: false, message: 'Passport verification failed.' };
  }
  return { ok: true };
}

router.get(
  '/flights/:flightId/seats',
  requireAuth,
  requireRoles('admin', 'agent', 'operations', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) {
      return res.status(400).json({ message: 'Invalid flight id.' });
    }
    try {
      const payload = await buildSeatMapPayload(pool, flightId);
      if (payload.notFound) {
        return res.status(404).json({ message: 'Flight not found.' });
      }
      return res.status(200).json(payload);
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load seat map.', error: error.message });
    }
  }
);

router.get(
  '/flights/:flightId/manifest',
  requireAuth,
  requireRoles('admin', 'agent', 'operations', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) {
      return res.status(400).json({ message: 'Invalid flight id.' });
    }
    try {
      const flightResult = await pool.query(
        `SELECT id, flight_number, departure_airport, arrival_airport, departure_time, arrival_time, gate, boarding_time, status
         FROM flights WHERE id = $1`,
        [flightId]
      );
      const flight = flightResult.rows[0];
      if (!flight) {
        return res.status(404).json({ message: 'Flight not found.' });
      }

      const rows = await pool.query(
        `SELECT
          b.id AS booking_id,
          b.pnr,
          p.id AS passenger_id,
          p.first_name,
          p.last_name,
          p.travel_status AS passenger_travel_status,
          c.id AS checkin_id,
          c.seat_number,
          c.boarding_pass_no,
          c.checkin_time,
          c.boarding_status,
          c.checkin_status,
          c.boarded_at,
          c.boarding_gate,
          c.boarding_sequence,
          (SELECT COALESCE(SUM(bg.weight_kg), 0) FROM baggage bg WHERE bg.checkin_id = c.id) AS baggage_weight_kg,
          (SELECT COALESCE(SUM(bg.pieces), 0)::int FROM baggage bg WHERE bg.checkin_id = c.id) AS baggage_pieces,
          (
            SELECT t.ticket_number
            FROM tickets t
            WHERE t.booking_id = b.id AND t.passenger_id = p.id
            ORDER BY t.issued_at DESC
            LIMIT 1
          ) AS ticket_number
        FROM booking_flights bf
        JOIN bookings b ON b.id = bf.booking_id
        JOIN booking_passengers bp ON bp.booking_id = b.id
        JOIN passengers p ON p.id = bp.passenger_id
        LEFT JOIN checkins c
          ON c.booking_id = b.id AND c.passenger_id = p.id AND c.flight_id = bf.flight_id
        WHERE bf.flight_id = $1
          AND UPPER(TRIM(b.booking_status)) = 'CONFIRMED'
          AND UPPER(TRIM(COALESCE(b.payment_status, ''))) = 'PAID'
        ORDER BY b.pnr ASC, p.last_name ASC, p.first_name ASC`,
        [flightId]
      );

      const boardingDisplayTime = computeBoardingDisplayIso(flight);

      const checkedIn = rows.rows.filter((r) => r.checkin_id);
      const notCheckedIn = rows.rows.filter((r) => !r.checkin_id);
      const noShowTracked = rows.rows.filter(
        (r) => r.checkin_id && String(r.boarding_status || '').toUpperCase() === 'NO_SHOW'
      );
      const boarded = rows.rows.filter(
        (r) => r.checkin_id && String(r.boarding_status || '').toUpperCase() === 'BOARDED'
      );
      const boarding = rows.rows.filter(
        (r) => r.checkin_id && String(r.boarding_status || '').toUpperCase() === 'BOARDING'
      );

      const bagTotals = await pool.query(
        `SELECT COALESCE(SUM(b.weight_kg), 0)::numeric AS total_kg, COALESCE(SUM(b.pieces), 0)::int AS total_pieces
         FROM baggage b
         JOIN checkins c ON c.id = b.checkin_id
         WHERE c.flight_id = $1`,
        [flightId]
      );

      return res.status(200).json({
        flight: {
          ...flight,
          boarding_display_time: boardingDisplayTime,
          gate_display: flight.gate || 'TBD'
        },
        passengers: rows.rows,
        summary: {
          expectedCount: rows.rows.length,
          checkedInCount: checkedIn.length,
          pendingCount: notCheckedIn.length,
          notCheckedInCount: notCheckedIn.length,
          boardingCount: boarding.length,
          boardedCount: boarded.length,
          noShowCount: noShowTracked.length,
          totalBaggageKg: Number(bagTotals.rows[0]?.total_kg || 0),
          totalBaggagePieces: Number(bagTotals.rows[0]?.total_pieces || 0)
        },
        lists: {
          checkedIn,
          notCheckedIn,
          boarding,
          noShows: noShowTracked,
          boarded
        }
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load flight manifest.', error: error.message });
    }
  }
);

router.patch(
  '/flights/:flightId/gate-boarding',
  requireAuth,
  requireRoles('admin', 'agent', 'operations', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) {
      return res.status(400).json({ message: 'Invalid flight id.' });
    }
    const { gate, boardingTime } = req.body;
    if (gate === undefined && boardingTime === undefined) {
      return res.status(400).json({ message: 'Provide gate and/or boardingTime (ISO string).' });
    }
    try {
      const cur = await pool.query(`SELECT gate, boarding_time FROM flights WHERE id = $1`, [flightId]);
      if (!cur.rows[0]) {
        return res.status(404).json({ message: 'Flight not found.' });
      }
      const nextGate = gate !== undefined ? String(gate).trim().slice(0, 10) || null : cur.rows[0].gate;
      const nextBoarding =
        boardingTime !== undefined ? (boardingTime ? new Date(boardingTime).toISOString() : null) : cur.rows[0].boarding_time;
      const upd = await pool.query(
        `UPDATE flights SET gate = $2, boarding_time = $3 WHERE id = $1
         RETURNING id, flight_number, gate, boarding_time, departure_time, departure_airport, arrival_airport`,
        [flightId, nextGate, nextBoarding]
      );
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          req.user.userId,
          'FLIGHT_GATE_BOARDING_UPDATED',
          'flights',
          flightId,
          JSON.stringify({ gate: nextGate, boardingTime: nextBoarding })
        ]
      );
      return res.status(200).json({ flight: upd.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to update gate/boarding.', error: error.message });
    }
  }
);

router.get(
  '/ticket/:ticketNumber',
  requireAuth,
  requireRoles('admin', 'agent', 'operations', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const ticketNumber = decodeURIComponent(String(req.params.ticketNumber || '').trim());
    if (!ticketNumber) {
      return res.status(400).json({ message: 'ticketNumber is required.' });
    }
    try {
      const ticketResult = await pool.query(
        `SELECT b.id, b.pnr, b.booking_status, b.payment_status, b.trip_type, b.total_amount, b.currency, b.created_at
         FROM tickets t
         JOIN bookings b ON b.id = t.booking_id
         WHERE t.ticket_number = $1`,
        [ticketNumber]
      );
      const booking = ticketResult.rows[0];
      if (!booking) {
        return res.status(404).json({ message: 'Ticket not found.' });
      }
      const payload = await buildCheckinLookupPayload(pool, booking, {
        source: 'TICKET',
        ticketNumber,
        assertEligible: assertBookingCheckinEligible
      });
      return res.status(200).json(payload);
    } catch (error) {
      return res.status(500).json({ message: 'Failed to retrieve ticket for check-in.', error: error.message });
    }
  }
);

router.get('/pnr/:pnr', requireAuth, requireRoles('admin', 'agent', 'operations', 'customer_service', 'sales_manager'), async (req, res) => {
  const pnr = String(req.params.pnr || '').trim().toUpperCase();

  try {
    const bookingResult = await pool.query(
      `SELECT id, pnr, booking_status, payment_status, trip_type, total_amount, currency, created_at
       FROM bookings
       WHERE pnr = $1`,
      [pnr]
    );
    const booking = bookingResult.rows[0];
    if (!booking) {
      return res.status(404).json({ message: 'PNR not found.' });
    }
    const payload = await buildCheckinLookupPayload(pool, booking, {
      source: 'PNR',
      assertEligible: assertBookingCheckinEligible
    });
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to retrieve PNR for check-in.', error: error.message });
  }
});

router.patch(
  '/checkins/:checkinId/boarding',
  requireAuth,
  requireRoles('admin', 'agent', 'operations', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const { checkinId } = req.params;
    if (!isUuid(checkinId)) {
      return res.status(400).json({ message: 'Invalid check-in id.' });
    }
    const { boardingStatus, gateAtScan } = req.body;
    const next = String(boardingStatus || '').toUpperCase();
    if (!['BOARDING', 'BOARDED', 'NO_SHOW'].includes(next)) {
      return res.status(400).json({ message: 'boardingStatus must be BOARDING, BOARDED, or NO_SHOW.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query(
        `SELECT c.id, c.passenger_id, c.boarding_status, c.flight_id, b.pnr, f.gate
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
        return res.status(409).json({
          message: 'Passenger already boarded; duplicate boarding update rejected.'
        });
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
      if (next === 'NO_SHOW' && prev !== 'CHECKED_IN' && prev !== 'BOARDING') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'NO_SHOW is only allowed from CHECKED_IN or BOARDING.' });
      }

      const gateTrim = gateAtScan != null ? String(gateAtScan).trim() : null;
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
        [checkinId, next, gateTrim]
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
          'BOARDING_STATUS_UPDATED',
          'checkins',
          checkinId,
          JSON.stringify({ boardingStatus: next, pnr: row.pnr, gateAtScan: gateTrim })
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
  }
);

router.get(
  '/boarding-pass/:ref',
  requireAuth,
  requireRoles('admin', 'agent', 'operations', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const ref = String(req.params.ref || '').trim();
    if (!ref) {
      return res.status(400).json({ message: 'ref is required (check-in UUID or boarding pass number).' });
    }
    try {
      let checkinId = null;
      if (isUuid(ref)) {
        checkinId = ref;
      } else {
        const q = await pool.query(
          `SELECT id FROM checkins WHERE upper(btrim(boarding_pass_no::text)) = upper(btrim($1::text)) LIMIT 1`,
          [ref]
        );
        if (!q.rows[0]) {
          return res.status(404).json({ message: 'Boarding pass not found.' });
        }
        checkinId = q.rows[0].id;
      }
      const bp = await buildBoardingPassView(pool, checkinId);
      if (!bp) {
        return res.status(404).json({ message: 'Boarding pass not found.' });
      }
      return res.status(200).json({ boardingPass: bp });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load boarding pass.', error: error.message });
    }
  }
);

router.patch(
  '/checkins/:checkinId/seat',
  requireAuth,
  requireRoles('admin', 'agent', 'operations', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const { checkinId } = req.params;
    if (!isUuid(checkinId)) {
      return res.status(400).json({ message: 'Invalid check-in id.' });
    }
    const { seatNumber, verificationLastName, verificationPassportLast4, verificationFirstName } = req.body;
    if (!seatNumber || !String(seatNumber).trim()) {
      return res.status(400).json({ message: 'seatNumber is required.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query(
        `SELECT c.id, c.flight_id, c.booking_id, c.passenger_id,
                p.first_name, p.last_name, p.passport_no
         FROM checkins c
         JOIN passengers p ON p.id = c.passenger_id
         WHERE c.id = $1`,
        [checkinId]
      );
      const row = cur.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Check-in not found.' });
      }
      const v = verifyPassengerIdentity(
        row,
        verificationLastName,
        verificationPassportLast4,
        verificationFirstName
      );
      if (!v.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: v.message });
      }
      const bs = await client.query(`SELECT boarding_status FROM checkins WHERE id = $1`, [checkinId]);
      if (String(bs.rows[0]?.boarding_status || '').toUpperCase() === 'BOARDED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Cannot change seat after passenger has boarded.' });
      }
      const taken = await client.query(
        `SELECT 1 FROM checkins
         WHERE flight_id = $1 AND id <> $2
           AND upper(btrim(seat_number::text)) = upper(btrim($3::text))`,
        [row.flight_id, checkinId, seatNumber]
      );
      if (taken.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Seat is already assigned to another passenger.' });
      }
      await client.query(
        `UPDATE checkins SET seat_number = $2 WHERE id = $1`,
        [checkinId, String(seatNumber).trim().toUpperCase()]
      );
      await client.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          req.user.userId,
          'CHECKIN_SEAT_CHANGED',
          'checkins',
          checkinId,
          JSON.stringify({ seatNumber: String(seatNumber).trim().toUpperCase() })
        ]
      );
      await client.query('COMMIT');
      const boardingPass = await buildBoardingPassView(pool, checkinId);
      return res.status(200).json({
        message: 'Seat updated.',
        seatNumber: String(seatNumber).trim().toUpperCase(),
        boardingPass
      });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && error.code === '23505') {
        return res.status(409).json({ message: 'Seat conflict: duplicate seat assignment prevented.' });
      }
      return res.status(500).json({ message: 'Failed to change seat.', error: error.message });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/checkins/:checkinId/baggage',
  requireAuth,
  requireRoles('admin', 'agent', 'operations', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const { checkinId } = req.params;
    if (!isUuid(checkinId)) {
      return res.status(400).json({ message: 'Invalid check-in id.' });
    }
    const { bags, weightKg, pieces, acceptExcessCharge } = req.body;
    let bagList = Array.isArray(bags) ? bags : null;
    if (!bagList && weightKg != null) {
      bagList = [{ weightKg, pieces: pieces ?? 1 }];
    }
    if (!bagList || !bagList.length) {
      return res.status(400).json({ message: 'Provide bags: [{ weightKg, pieces }] or weightKg (+ optional pieces).' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cin = await client.query(
        `SELECT c.id, c.booking_id, c.flight_id FROM checkins c WHERE c.id = $1`,
        [checkinId]
      );
      if (!cin.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Check-in not found.' });
      }
      const { booking_id: bookingId, flight_id: flightId } = cin.rows[0];
      const existing = await client.query(`SELECT weight_kg, pieces, excess_charge FROM baggage WHERE checkin_id = $1`, [
        checkinId
      ]);
      const existingBags = existing.rows.map((r) => ({
        weightKg: Number(r.weight_kg),
        pieces: Number(r.pieces) || 1
      }));
      const newBags = bagList.map((b) => ({
        weightKg: Number(b.weightKg),
        pieces: Number(b.pieces || 1)
      }));
      for (const b of newBags) {
        if (!Number.isFinite(b.weightKg) || b.weightKg <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'Each bag must have a positive weightKg.' });
        }
      }
      const fl = await client.query(
        `SELECT departure_airport, arrival_airport FROM flights WHERE id = $1`,
        [flightId]
      );
      if (!fl.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Flight not found.' });
      }
      const bf = await client.query(
        `SELECT fare_class_id FROM booking_flights WHERE booking_id = $1 AND flight_id = $2`,
        [bookingId, flightId]
      );
      const fareClassIdFromBooking = bf.rows[0]?.fare_class_id || null;
      const combined = [...existingBags, ...newBags];
      const evalResult = await evaluateBaggageAllowance(client, {
        depIata: fl.rows[0].departure_airport,
        arrIata: fl.rows[0].arrival_airport,
        fareClassId: fareClassIdFromBooking,
        bags: combined
      });
      if (!evalResult.allowed) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: evalResult.reason || 'Baggage not allowed.' });
      }
      const prevExcRows = await client.query(
        `SELECT COALESCE(SUM(excess_charge), 0)::numeric AS s FROM baggage WHERE checkin_id = $1`,
        [checkinId]
      );
      const prevExc = Number(prevExcRows.rows[0].s || 0);
      const newExc = Number(evalResult.charge || 0);
      const deltaExc = Math.max(0, newExc - prevExc);
      if (deltaExc > 0 && !acceptExcessCharge) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: `Additional excess baggage fee of ${deltaExc} ${evalResult.currency || 'USD'} applies. Confirm with acceptExcessCharge: true.`,
          excessCharge: deltaExc,
          currency: evalResult.currency || 'USD'
        });
      }
      const baggageRows = [];
      for (let i = 0; i < newBags.length; i += 1) {
        const bag = newBags[i];
        const tagNumber = await generateUniqueBagTag(client);
        const rowExcess = i === 0 ? deltaExc : 0;
        const bagInsert = await client.query(
          `INSERT INTO baggage (checkin_id, tag_number, weight_kg, pieces, excess_charge)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, tag_number, weight_kg, pieces, excess_charge`,
          [checkinId, tagNumber, bag.weightKg, bag.pieces, rowExcess]
        );
        baggageRows.push(bagInsert.rows[0]);
      }
      await client.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          req.user.userId,
          'CHECKIN_BAGGAGE_ADDED',
          'checkins',
          checkinId,
          JSON.stringify({ added: newBags.length, tags: baggageRows.map((b) => b.tag_number) })
        ]
      );
      await client.query('COMMIT');
      return res.status(200).json({ message: 'Baggage recorded.', baggage: baggageRows });
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: 'Failed to add baggage.', error: error.message });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/boarding/scan',
  requireAuth,
  requireRoles('admin', 'agent', 'operations', 'customer_service', 'sales_manager'),
  async (req, res) => {
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
  }
);

async function processCheckIn(req, res) {
  const {
    pnr,
    passengerId,
    flightId,
    seatNumber,
    baggage,
    acceptExcessCharge,
    verificationLastName,
    verificationPassportLast4,
    verificationFirstName
  } = req.body;

  if (!pnr || !passengerId || !flightId || !seatNumber) {
    return res
      .status(400)
      .json({ message: 'pnr, passengerId, flightId, and seatNumber are required for check-in.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const bookingResult = await client.query(
      `SELECT id, pnr, booking_status, payment_status FROM bookings WHERE pnr = UPPER($1)`,
      [pnr]
    );
    const booking = bookingResult.rows[0];
    const elig = assertBookingCheckinEligible(booking);
    if (!elig.ok) {
      await client.query('ROLLBACK');
      return res.status(elig.status).json({ message: elig.message });
    }

    const paxInBooking = await client.query(
      `SELECT p.id, p.first_name, p.last_name, p.passport_no
       FROM booking_passengers bp
       JOIN passengers p ON p.id = bp.passenger_id
       WHERE bp.booking_id = $1 AND bp.passenger_id = $2`,
      [booking.id, passengerId]
    );
    if (paxInBooking.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Passenger does not belong to this booking.' });
    }
    const passengerRow = paxInBooking.rows[0];
    const v = verifyPassengerIdentity(
      passengerRow,
      verificationLastName,
      verificationPassportLast4,
      verificationFirstName
    );
    if (!v.ok) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: v.message });
    }

    const flightInBooking = await client.query(
      `SELECT 1
       FROM booking_flights
       WHERE booking_id = $1 AND flight_id = $2`,
      [booking.id, flightId]
    );
    if (flightInBooking.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Flight does not belong to this booking.' });
    }

    const ticketIssued = await client.query(
      `SELECT 1 FROM tickets
       WHERE booking_id = $1 AND passenger_id = $2 AND UPPER(TRIM(ticket_status)) = 'ISSUED'
       LIMIT 1`,
      [booking.id, passengerId]
    );
    if (ticketIssued.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Ticket status validation failed: passenger must have an ISSUED ticket on this booking.'
      });
    }

    const flightStatusRow = await client.query(`SELECT id, status FROM flights WHERE id = $1`, [flightId]);
    if (!flightStatusRow.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Flight not found.' });
    }
    const fs = String(flightStatusRow.rows[0].status || '').toUpperCase();
    const blockedFlight = new Set(['CANCELLED', 'DEPARTED', 'IN_AIR', 'LANDED']);
    if (blockedFlight.has(fs)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Flight status validation failed: flight is ${fs}; check-in is not allowed.`
      });
    }

    const existingCheckin = await client.query(
      `SELECT id, boarding_pass_no
       FROM checkins
       WHERE booking_id = $1 AND passenger_id = $2 AND flight_id = $3`,
      [booking.id, passengerId, flightId]
    );
    if (existingCheckin.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Passenger is already checked in on this flight.' });
    }

    const seatTaken = await client.query(
      `SELECT 1
       FROM checkins
       WHERE flight_id = $1
         AND upper(btrim(seat_number::text)) = upper(btrim($2::text))`,
      [flightId, seatNumber]
    );
    if (seatTaken.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Seat is already assigned to another passenger.' });
    }

    const boardingPassNo = await generateUniqueBoardingPassNo(client);
    const insertCheckin = await client.query(
      `INSERT INTO checkins (booking_id, passenger_id, flight_id, seat_number, checked_in_by, boarding_pass_no, boarding_status, checkin_status, boarded_at, boarding_gate)
       VALUES ($1, $2, $3, $4, $5, $6, 'CHECKED_IN', 'COMPLETED', NULL, NULL)
       RETURNING id, checkin_time`,
      [booking.id, passengerId, flightId, String(seatNumber).trim().toUpperCase(), req.user.userId, boardingPassNo]
    );
    const checkinId = insertCheckin.rows[0].id;

    const seqQ = await client.query(
      `SELECT COALESCE(MAX(boarding_sequence), 0)::int + 1 AS n FROM checkins WHERE flight_id = $1`,
      [flightId]
    );
    const boardingSeq = seqQ.rows[0]?.n ?? 1;
    await client.query(`UPDATE checkins SET boarding_sequence = $2 WHERE id = $1`, [checkinId, boardingSeq]);

    let excessChargeTotal = 0;
    let excessCurrency = 'USD';

    if (Array.isArray(baggage) && baggage.length > 0) {
      const flightInfo = await client.query(
        `SELECT departure_airport, arrival_airport, departure_time, gate, boarding_time, flight_number
         FROM flights WHERE id = $1`,
        [flightId]
      );
      const fl = flightInfo.rows[0];
      if (!fl) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Flight not found.' });
      }

      const bf = await client.query(
        `SELECT fare_class_id FROM booking_flights WHERE booking_id = $1 AND flight_id = $2`,
        [booking.id, flightId]
      );
      const fareClassIdFromBooking = bf.rows[0]?.fare_class_id || null;

      const bagsPayload = baggage.map((b) => ({
        weightKg: Number(b.weightKg),
        pieces: Number(b.pieces || 1)
      }));

      const evalResult = await evaluateBaggageAllowance(client, {
        depIata: fl.departure_airport,
        arrIata: fl.arrival_airport,
        fareClassId: fareClassIdFromBooking,
        bags: bagsPayload
      });

      if (!evalResult.allowed) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: evalResult.reason || 'Baggage not allowed.' });
      }

      excessChargeTotal = Number(evalResult.charge || 0);
      excessCurrency = String(evalResult.currency || 'USD');

      if (excessChargeTotal > 0 && !acceptExcessCharge) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: `Excess baggage fee of ${excessChargeTotal} ${excessCurrency} applies. Confirm with acceptExcessCharge: true.`,
          excessCharge: excessChargeTotal,
          currency: excessCurrency
        });
      }
    }

    const baggageRows = [];
    if (Array.isArray(baggage)) {
      for (let i = 0; i < baggage.length; i += 1) {
        const bag = baggage[i];
        const weight = Number(bag.weightKg);
        const pieces = Number(bag.pieces || 1);
        if (!Number.isFinite(weight) || weight <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'Baggage weight must be a positive number.' });
        }

        const tagNumber = await generateUniqueBagTag(client);
        const excessForRow = i === 0 ? excessChargeTotal : 0;
        const bagInsert = await client.query(
          `INSERT INTO baggage (checkin_id, tag_number, weight_kg, pieces, excess_charge)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, tag_number, weight_kg, pieces, excess_charge`,
          [checkinId, tagNumber, weight, pieces, excessForRow]
        );
        baggageRows.push(bagInsert.rows[0]);
      }
    }

    await client.query(`UPDATE passengers SET travel_status = 'CHECKED_IN' WHERE id = $1`, [passengerId]);

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.userId,
        'PASSENGER_CHECKED_IN',
        'checkins',
        checkinId,
        JSON.stringify({
          pnr: booking.pnr,
          passengerId,
          flightId,
          seatNumber: String(seatNumber).trim().toUpperCase(),
          baggageCount: baggageRows.length,
          excessBaggageCharge: excessChargeTotal,
          excessCurrency
        })
      ]
    );

    await client.query('COMMIT');

    const bpView = await buildBoardingPassView(pool, checkinId);
    const boardingPass = bpView
      ? {
          passengerName: bpView.passengerName,
          pnr: bpView.pnr,
          ticketNumber: bpView.ticketNumber,
          flightNumber: bpView.flightNumber,
          route: bpView.route,
          seat: bpView.seat,
          gate: bpView.gate,
          boardingTime: bpView.boardingTime,
          departureTime: bpView.departureTime,
          boardingPassNo: bpView.boardingPassNo
        }
      : null;

    return res.status(200).json({
      message: 'Check-in successful.',
      checkin: {
        id: checkinId,
        pnr: booking.pnr,
        passengerId,
        flightId,
        seatNumber: String(seatNumber).trim().toUpperCase(),
        boardingPassNo,
        boarding_status: 'CHECKED_IN',
        checkin_status: 'COMPLETED',
        boarded_at: null,
        boarding_gate: null,
        boarding_sequence: boardingSeq
      },
      baggage: baggageRows,
      boardingPass
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error && error.code === '23505') {
      return res.status(409).json({ message: 'Seat conflict: duplicate seat assignment prevented.' });
    }
    return res.status(500).json({ message: 'Failed to complete check-in.', error: error.message });
  } finally {
    client.release();
  }
}

router.post('/', requireAuth, requireRoles('admin', 'agent', 'operations', 'customer_service', 'sales_manager'), processCheckIn);
router.post(
  '/process',
  requireAuth,
  requireRoles('admin', 'agent', 'operations', 'customer_service', 'sales_manager'),
  processCheckIn
);

export default router;
