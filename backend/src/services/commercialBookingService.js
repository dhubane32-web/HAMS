/**
 * Phase 2 commercial booking — multi-city, inventory, SSR/OSI, modify, reissue, refund.
 */

import { computeItineraryPricing } from './masterDataPricing.js';
import { findBaggageRule } from './masterDataBaggage.js';
import { syncTicketCouponsForBooking, voidTicketCoupons } from './ticketCouponService.js';
import { scheduleBookingNotifications } from './commercialNotificationService.js';
import { logFinanceTransaction } from './financeLedger.js';
import { releaseSeatLegAllocationsForBooking } from './seatInventorySync.js';
import { recordOccFlightEvent } from './occFlightEvents.js';

const PNR_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const AIRLINE_PREFIX = String(process.env.HAMS_PNR_PREFIX || 'HW').slice(0, 2).toUpperCase();

export function isMissingCommercialSchema(err) {
  const msg = String(err?.message || '');
  return (
    err?.code === '42P01' &&
    (msg.includes('booking_ssr') ||
      msg.includes('booking_osi') ||
      msg.includes('ticket_coupons') ||
      msg.includes('passenger_profiles'))
  );
}

export function schemaHint() {
  return 'Apply database/commercial_core_phase2.sql (migration 006).';
}

function randomChars(n, chars) {
  return Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export async function generateTicketNumber(client) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const ticketNo = `555${randomChars(10, '0123456789')}`;
    const exists = await client.query('SELECT 1 FROM tickets WHERE ticket_number = $1', [ticketNo]);
    if (!exists.rowCount) return ticketNo;
  }
  throw new Error('Unable to generate ticket number.');
}

export async function generateAirlinePnr(client) {
  const suffixLen = Math.max(4, 6 - AIRLINE_PREFIX.length);
  for (let i = 0; i < 12; i += 1) {
    const candidate = `${AIRLINE_PREFIX}${randomChars(suffixLen, PNR_CHARS)}`.slice(0, 6);
    const exists = await client.query('SELECT 1 FROM bookings WHERE pnr = $1', [candidate]);
    if (!exists.rowCount) return candidate;
  }
  throw new Error('Unable to generate unique PNR.');
}

export async function getFlightInventory(client, flightId, { fareClassId } = {}) {
  const cap = await client.query(
    `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time, f.status,
            COALESCE(a.seat_capacity, 0) AS seat_capacity
     FROM flights f
     LEFT JOIN aircraft a ON a.id = f.aircraft_id
     WHERE f.id = $1`,
    [flightId]
  );
  const flight = cap.rows[0];
  if (!flight) return null;

  const sold = await client.query(
    `SELECT COUNT(DISTINCT bp.passenger_id)::int AS sold
     FROM booking_flights bf
     JOIN bookings b ON b.id = bf.booking_id AND upper(b.booking_status) <> 'CANCELLED'
     JOIN booking_passengers bp ON bp.booking_id = b.id
     WHERE bf.flight_id = $1`,
    [flightId]
  );
  const soldCount = Number(sold.rows[0]?.sold || 0);
  const capacity = Number(flight.seat_capacity) || 0;
  let authorized = capacity;
  let bucketSold = soldCount;

  try {
    const inv = await client.query(
      `SELECT authorized_seats, sold_seats FROM route_inventory_control
       WHERE flight_id = $1 AND (($2::uuid IS NULL AND fare_class_id IS NULL) OR fare_class_id = $2)
       ORDER BY fare_class_id NULLS LAST LIMIT 1`,
      [flightId, fareClassId || null]
    );
    if (inv.rows[0]) {
      authorized = Number(inv.rows[0].authorized_seats);
      bucketSold = Number(inv.rows[0].sold_seats);
    }
  } catch (e) {
    if (e?.code !== '42P01') throw e;
  }

  const available = Math.max(0, authorized - bucketSold);
  return {
    flightId,
    flightNumber: flight.flight_number,
    status: flight.status,
    capacity: authorized,
    sold: bucketSold,
    available,
    openForSale: available > 0 && !['CANCELLED', 'ARRIVED', 'LANDED'].includes(String(flight.status).toUpperCase())
  };
}

export async function assertInventoryForLegs(client, legs, passengerCount, fareClassId) {
  for (const leg of legs) {
    const inv = await getFlightInventory(client, leg.flight.id, { fareClassId });
    if (!inv?.openForSale) {
      const err = new Error(`No inventory on flight ${leg.flight.flight_number}.`);
      err.statusCode = 409;
      err.code = 'INVENTORY_CLOSED';
      throw err;
    }
    if (inv.available < passengerCount) {
      const err = new Error(
        `Insufficient seats on ${leg.flight.flight_number} (${inv.available} left, need ${passengerCount}).`
      );
      err.statusCode = 409;
      err.code = 'INVENTORY_EXHAUSTED';
      throw err;
    }
  }
}

export async function loadFlightsForLegs(client, legFlightIds) {
  const legs = [];
  for (let i = 0; i < legFlightIds.length; i += 1) {
    const id = legFlightIds[i];
    const r = await client.query(
      `SELECT id, flight_number, departure_airport, arrival_airport, departure_time, arrival_time, status
       FROM flights WHERE id = $1`,
      [id]
    );
    const flight = r.rows[0];
    if (!flight) {
      const err = new Error(`Flight not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    legs.push({ flight, legSequence: i + 1 });
  }
  for (let i = 1; i < legs.length; i += 1) {
    const prev = legs[i - 1].flight;
    const cur = legs[i].flight;
    if (new Date(cur.departure_time) <= new Date(prev.departure_time)) {
      const err = new Error('Multi-city legs must depart in chronological order.');
      err.statusCode = 400;
      throw err;
    }
  }
  return legs;
}

export async function priceMultiCityLegs(client, legs, fareClassId) {
  if (!fareClassId) return null;
  let totalPerPax = 0;
  const breakdown = [];
  let currency = 'USD';
  let bookingClass = 'ECONOMY';

  for (const leg of legs) {
    const pricing = await computeItineraryPricing(client, {
      outboundFlight: leg.flight,
      inboundFlight: null,
      tripType: 'ONE_WAY',
      fareClassId
    });
    totalPerPax += pricing.totalPerPax;
    currency = pricing.currency;
    bookingClass = pricing.bookingClass;
    breakdown.push(...(pricing.breakdown || []).map((b) => ({ ...b, leg: leg.flight.flight_number })));
  }
  return { totalPerPax, currency, bookingClass, breakdown };
}

export async function upsertPassengerProfile(client, { email, phone, passengerId }) {
  try {
    const em = email ? String(email).trim().toLowerCase() : null;
    const ph = phone ? String(phone).trim() : null;
    if (!em && !ph) return null;

    let existing = null;
    if (em) {
      const r = await client.query(`SELECT id, profile_ref FROM passenger_profiles WHERE lower(primary_email) = $1 LIMIT 1`, [
        em
      ]);
      existing = r.rows[0] || null;
    }
    if (!existing && ph) {
      const r = await client.query(`SELECT id, profile_ref FROM passenger_profiles WHERE primary_phone = $1 LIMIT 1`, [ph]);
      existing = r.rows[0] || null;
    }

    if (existing) {
      await client.query(`UPDATE passengers SET profile_id = $1 WHERE id = $2 AND profile_id IS NULL`, [
        existing.id,
        passengerId
      ]);
      return existing;
    }

    const ref = `P${randomChars(8, '0123456789')}`;
    const ins = await client.query(
      `INSERT INTO passenger_profiles (profile_ref, primary_email, primary_phone)
       VALUES ($1, $2, $3)
       RETURNING id, profile_ref`,
      [ref, em, ph]
    );
    await client.query(`UPDATE passengers SET profile_id = $1 WHERE id = $2`, [ins.rows[0].id, passengerId]);
    return ins.rows[0];
  } catch (e) {
    if (e?.code === '42P01') return null;
    throw e;
  }
}

export async function appendTravelHistory(client, profileId, entry) {
  try {
    await client.query(
      `UPDATE passenger_profiles
       SET travel_history_json = travel_history_json || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [profileId, JSON.stringify([entry])]
    );
  } catch (e) {
    if (e?.code !== '42P01') throw e;
  }
}

export async function addSsr(client, { bookingId, passengerId, flightId, ssrCode, ssrText, userId }) {
  const r = await client.query(
    `INSERT INTO booking_ssr (booking_id, passenger_id, flight_id, ssr_code, ssr_text, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      bookingId,
      passengerId || null,
      flightId || null,
      String(ssrCode).toUpperCase().slice(0, 4),
      ssrText ? String(ssrText).slice(0, 240) : null,
      userId
    ]
  );
  return r.rows[0];
}

export async function addOsi(client, { bookingId, osiLine, userId }) {
  const r = await client.query(
    `INSERT INTO booking_osi (booking_id, osi_line, created_by)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [bookingId, String(osiLine).slice(0, 200), userId]
  );
  return r.rows[0];
}

export async function listSsrOsi(client, bookingId) {
  const ssr = await client.query(
    `SELECT s.*, p.first_name, p.last_name, f.flight_number
     FROM booking_ssr s
     LEFT JOIN passengers p ON p.id = s.passenger_id
     LEFT JOIN flights f ON f.id = s.flight_id
     WHERE s.booking_id = $1 AND s.status = 'ACTIVE'
     ORDER BY s.created_at`,
    [bookingId]
  );
  let osi = { rows: [] };
  try {
    osi = await client.query(`SELECT * FROM booking_osi WHERE booking_id = $1 ORDER BY created_at`, [bookingId]);
  } catch (e) {
    if (e?.code !== '42P01') throw e;
  }
  return { ssr: ssr.rows, osi: osi.rows };
}

export async function getBaggageRulesForBooking(client, bookingId) {
  const legs = await client.query(
    `SELECT f.departure_airport, f.arrival_airport, bf.fare_class_id
     FROM booking_flights bf
     JOIN flights f ON f.id = bf.flight_id
     WHERE bf.booking_id = $1`,
    [bookingId]
  );
  const rules = [];
  for (const leg of legs.rows) {
    const rule = await findBaggageRule(client, {
      depIata: leg.departure_airport,
      arrIata: leg.arrival_airport,
      fareClassId: leg.fare_class_id
    });
    rules.push({
      route: `${leg.departure_airport}→${leg.arrival_airport}`,
      rule: rule
        ? {
            freePieces: rule.free_pieces,
            freeWeightKg: rule.free_weight_kg,
            maxPerPieceKg: rule.max_weight_per_piece_kg,
            chargePerKgOver: rule.charge_per_kg_over
          }
        : null
    });
  }
  return rules;
}

export async function logModification(client, { bookingId, type, before, after, reason, userId }) {
  try {
    await client.query(
      `INSERT INTO booking_modification_log (booking_id, modification_type, before_json, after_json, reason, created_by)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
      [bookingId, type, JSON.stringify(before || null), JSON.stringify(after || null), reason || null, userId]
    );
  } catch (e) {
    if (e?.code !== '42P01') throw e;
  }
}

export async function modifyBooking(client, bookingId, { notes, contactUpdates, userId }) {
  const b = await client.query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  const before = b.rows[0];
  if (!before) {
    const err = new Error('Booking not found.');
    err.statusCode = 404;
    throw err;
  }
  if (String(before.booking_status).toUpperCase() === 'CANCELLED') {
    const err = new Error('Cannot modify cancelled booking.');
    err.statusCode = 400;
    throw err;
  }

  if (notes != null) {
    await client.query(`UPDATE bookings SET notes = $2 WHERE id = $1`, [bookingId, String(notes).slice(0, 8000)]);
  }

  if (Array.isArray(contactUpdates)) {
    for (const u of contactUpdates) {
      if (!u.passengerId) continue;
      await client.query(
        `UPDATE passengers SET phone = COALESCE($3, phone), email = COALESCE($4, email) WHERE id = $2
         AND id IN (SELECT passenger_id FROM booking_passengers WHERE booking_id = $1)`,
        [bookingId, u.passengerId, u.phone || null, u.email || null]
      );
    }
  }

  const after = (await client.query(`SELECT * FROM bookings WHERE id = $1`, [bookingId])).rows[0];
  await logModification(client, {
    bookingId,
    type: 'CONTACT_UPDATE',
    before: { notes: before.notes },
    after: { notes: after.notes },
    reason: 'Desk modification',
    userId
  });

  return after;
}

export async function issueTicketsForBooking(client, bookingId, userId, { requirePaid = true } = {}) {
  const bookingResult = await client.query(
    `SELECT id, pnr, booking_status, payment_status, currency FROM bookings WHERE id = $1`,
    [bookingId]
  );
  const booking = bookingResult.rows[0];
  if (!booking) {
    const err = new Error('Booking not found.');
    err.statusCode = 404;
    throw err;
  }
  if (String(booking.booking_status || '').toUpperCase() === 'CANCELLED') {
    const err = new Error('Cannot issue tickets for a cancelled booking.');
    err.statusCode = 400;
    throw err;
  }
  if (requirePaid) {
    const paidRow = await client.query(`SELECT payment_status FROM bookings WHERE id = $1`, [bookingId]);
    if (String(paidRow.rows[0]?.payment_status || '').toUpperCase() !== 'PAID') {
      const err = new Error('Booking must be paid before ticket issue.');
      err.statusCode = 400;
      err.code = 'PAYMENT_REQUIRED';
      throw err;
    }
  }

  const passengers = await client.query(
    `SELECT passenger_id FROM booking_passengers WHERE booking_id = $1`,
    [bookingId]
  );
  const issuedTickets = [];
  for (const row of passengers.rows) {
    const existing = await client.query(
      `SELECT id, ticket_number, passenger_id, issued_at, ticket_status
       FROM tickets WHERE booking_id = $1 AND passenger_id = $2`,
      [bookingId, row.passenger_id]
    );
    if (existing.rowCount) {
      issuedTickets.push(existing.rows[0]);
      continue;
    }
    const ticketNumber = await generateTicketNumber(client);
    const ticket = await client.query(
      `INSERT INTO tickets (ticket_number, booking_id, passenger_id, issued_by, ticket_status)
       VALUES ($1, $2, $3, $4, 'ISSUED')
       RETURNING id, ticket_number, passenger_id, issued_at, ticket_status`,
      [ticketNumber, bookingId, row.passenger_id, userId]
    );
    issuedTickets.push(ticket.rows[0]);
  }
  const { syncSeatLegAllocationsForBooking } = await import('./seatInventorySync.js');
  await syncSeatLegAllocationsForBooking(client, bookingId);
  await syncTicketCouponsForBooking(client, bookingId);
  return { booking, tickets: issuedTickets };
}

export async function reissueTicket(client, { ticketId, userId }) {
  const t = await client.query(
    `SELECT t.*, b.pnr, b.booking_status FROM tickets t JOIN bookings b ON b.id = t.booking_id WHERE t.id = $1`,
    [ticketId]
  );
  const ticket = t.rows[0];
  if (!ticket) {
    const err = new Error('Ticket not found.');
    err.statusCode = 404;
    throw err;
  }
  if (String(ticket.ticket_status).toUpperCase() !== 'ISSUED') {
    const err = new Error('Only issued tickets can be reissued.');
    err.statusCode = 400;
    throw err;
  }

  await client.query(`UPDATE tickets SET ticket_status = 'EXCHANGED' WHERE id = $1`, [ticketId]);
  await voidTicketCoupons(client, ticketId, 'EXCHANGED');

  const newNumber = await generateTicketNumber(client);
  const ins = await client.query(
    `INSERT INTO tickets (ticket_number, booking_id, passenger_id, issued_by, ticket_status)
     VALUES ($1, $2, $3, $4, 'ISSUED')
     RETURNING *`,
    [newNumber, ticket.booking_id, ticket.passenger_id, userId]
  );

  await syncTicketCouponsForBooking(client, ticket.booking_id);
  await logFinanceTransaction(client, {
    txnType: 'TICKET_REISSUED',
    bookingId: ticket.booking_id,
    description: `Reissued ${ticket.ticket_number} → ${newNumber}`,
    metadata: { oldTicketId: ticketId, newTicketId: ins.rows[0].id, pnr: ticket.pnr },
    userId
  });
  await logModification(client, {
    bookingId: ticket.booking_id,
    type: 'REISSUE',
    before: { ticketNumber: ticket.ticket_number },
    after: { ticketNumber: newNumber },
    userId
  });

  return { oldTicket: ticket, newTicket: ins.rows[0] };
}

export async function refundTicket(client, { ticketId, amount, reason, userId }) {
  const t = await client.query(
    `SELECT t.*, b.pnr, b.currency FROM tickets t JOIN bookings b ON b.id = t.booking_id WHERE t.id = $1`,
    [ticketId]
  );
  const ticket = t.rows[0];
  if (!ticket) {
    const err = new Error('Ticket not found.');
    err.statusCode = 404;
    throw err;
  }

  await client.query(`UPDATE tickets SET ticket_status = 'REFUNDED' WHERE id = $1`, [ticketId]);
  await voidTicketCoupons(client, ticketId, 'REFUNDED');

  const pay = await client.query(
    `SELECT id, amount FROM payments WHERE booking_id = $1 AND upper(payment_status) IN ('PAID','PARTIALLY_REFUNDED') ORDER BY processed_at DESC LIMIT 1`,
    [ticket.booking_id]
  );
  const payment = pay.rows[0];
  const refundAmt = amount != null ? Number(amount) : Number(payment?.amount || 0);

  if (payment && refundAmt > 0) {
    await client.query(
      `INSERT INTO refunds (payment_id, refund_amount, reason, approved_by) VALUES ($1, $2, $3, $4)`,
      [payment.id, refundAmt, reason || 'Ticket refund', userId]
    );
    await client.query(`UPDATE payments SET payment_status = 'REFUNDED' WHERE id = $1`, [payment.id]);
  }

  await logFinanceTransaction(client, {
    txnType: 'TICKET_REFUNDED',
    amount: refundAmt,
    currency: ticket.currency,
    bookingId: ticket.booking_id,
    description: `Refund ticket ${ticket.ticket_number}`,
    metadata: { ticketId, reason },
    userId
  });

  return { ticket, refundAmount: refundAmt };
}

export async function addStandby(client, { flightId, bookingId, passengerId, priority = 100 }) {
  const r = await client.query(
    `INSERT INTO flight_standby_list (flight_id, booking_id, passenger_id, priority)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (flight_id, booking_id, passenger_id) DO UPDATE SET status = 'WAITING', priority = EXCLUDED.priority
     RETURNING *`,
    [flightId, bookingId, passengerId, priority]
  );
  return r.rows[0];
}

export async function afterBookingCommitted(pool, { bookingId, pnr, flightIds, userId }) {
  scheduleBookingNotifications(bookingId);
  for (const fid of flightIds) {
    if (!fid) continue;
    try {
      await recordOccFlightEvent(pool, {
        flightId: fid,
        eventType: 'BOOKING_LINK',
        sourceSystem: 'commercial',
        userId,
        payload: { bookingId, pnr }
      });
    } catch {
      /* non-fatal */
    }
  }
}
