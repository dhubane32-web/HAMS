import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import { computeItineraryPricing } from '../../services/masterDataPricing.js';
import { syncBookingPaymentStatus } from '../../services/bookingPaymentSync.js';
import { logFinanceTransaction } from '../../services/financeLedger.js';
import { validateAndLockPromo, incrementPromoUsage, PromoValidationError } from '../../services/salesPromo.js';

const router = express.Router();

const allowedPnrChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomString(length, chars) {
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function generateUniquePnr(client) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = randomString(6, allowedPnrChars);
    const exists = await client.query('SELECT 1 FROM bookings WHERE pnr = $1', [candidate]);
    if (exists.rowCount === 0) {
      return candidate;
    }
  }
  throw new Error('Unable to generate unique PNR.');
}

async function generateTicketNumber(client) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const ticketNo = `555${randomString(10, '0123456789')}`;
    const exists = await client.query('SELECT 1 FROM tickets WHERE ticket_number = $1', [ticketNo]);
    if (exists.rowCount === 0) {
      return ticketNo;
    }
  }
  throw new Error('Unable to generate ticket number.');
}

function splitFullName(fullName) {
  const clean = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!clean) return { firstName: '', lastName: '' };
  const [firstName, ...rest] = clean.split(' ');
  return {
    firstName,
    lastName: rest.join(' ') || 'N/A'
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Persisted fare snapshot + denormalized totals for reporting. */
function buildFareSnapshot({
  normalizedTripType,
  passengers,
  outboundAmountPerPax,
  inboundAmountPerPax,
  totalPerPaxCharged,
  bookingCurrency,
  baseTotalAmount,
  promoDiscountAmount,
  totalAmount,
  pricingBreakdown
}) {
  const pc = passengers.length;
  const linesFromPricing = Array.isArray(pricingBreakdown) ? pricingBreakdown : null;
  let taxTotal = 0;
  let feeTotal = 0;
  let baseFromLines = 0;
  if (Array.isArray(linesFromPricing)) {
    for (const line of linesFromPricing) {
      const amt = Number(line.amount) * pc;
      const typ = String(line.type || '').toLowerCase();
      if (typ === 'tax') taxTotal += amt;
      else if (typ === 'fee') feeTotal += amt;
      else baseFromLines += amt;
    }
  }
  const baseRoute =
    (outboundAmountPerPax + (normalizedTripType === 'RETURN' ? inboundAmountPerPax : 0)) * pc;
  const fare_base_total = Array.isArray(linesFromPricing) ? baseFromLines : baseRoute;
  const doc = {
    version: 1,
    currency: bookingCurrency,
    passengerCount: pc,
    tripType: normalizedTripType,
    outboundPerPassenger: outboundAmountPerPax,
    inboundPerPassenger: normalizedTripType === 'RETURN' ? inboundAmountPerPax : 0,
    totalPerPassenger: totalPerPaxCharged,
    subtotalBeforePromo: baseTotalAmount,
    promoDiscount: promoDiscountAmount,
    total: totalAmount,
    ...(Array.isArray(linesFromPricing) ? { lines: linesFromPricing } : { manualPricing: true, lines: [] })
  };
  return {
    fare_breakdown: doc,
    fare_base_total,
    fare_tax_total: Array.isArray(linesFromPricing) ? Math.round(taxTotal * 100) / 100 : null,
    fare_fee_total: Array.isArray(linesFromPricing) ? Math.round(feeTotal * 100) / 100 : null
  };
}

router.get('/health', (_req, res) => {
  res.json({ module: 'booking', status: 'ready' });
});

/** Full list shape (requires booking_ticketing.sql columns + booking_flights.leg_type). */
const BOOKING_LIST_SQL_FULL = `
SELECT
  b.id,
  b.pnr,
  b.trip_type,
  b.booking_status,
  b.payment_status,
  b.total_amount,
  b.total_amount AS total_fare,
  b.currency,
  b.created_at,
  b.return_date,
  b.fare_breakdown,
  b.fare_base_total,
  b.fare_tax_total,
  b.fare_fee_total,
  (
    SELECT TRIM(BOTH ' ' FROM COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))
    FROM booking_passengers bp
    JOIN passengers p ON p.id = bp.passenger_id
    WHERE bp.booking_id = b.id
    ORDER BY bp.id ASC
    LIMIT 1
  ) AS primary_passenger_name,
  (
    SELECT STRING_AGG(
      f.departure_airport || '→' || f.arrival_airport,
      ' | ' ORDER BY
        CASE COALESCE(bf.leg_type, 'OUTBOUND')
          WHEN 'OUTBOUND' THEN 1
          WHEN 'INBOUND' THEN 2
          ELSE 3
        END,
        f.departure_time ASC
    )
    FROM booking_flights bf
    JOIN flights f ON f.id = bf.flight_id
    WHERE bf.booking_id = b.id
  ) AS route_summary,
  (
    SELECT STRING_AGG(t.ticket_number, ', ' ORDER BY t.issued_at ASC NULLS LAST)
    FROM tickets t
    WHERE t.booking_id = b.id
  ) AS ticket_numbers_summary
FROM bookings b
ORDER BY b.created_at DESC
LIMIT 500`;

/**
 * Older DBs may lack return_date / fare_* on bookings or leg_type on booking_flights.
 * Same JSON shape with NULLs for missing fare/return fields; route order by departure time only.
 */
const BOOKING_LIST_SQL_COMPAT = `
SELECT
  b.id,
  b.pnr,
  b.trip_type,
  b.booking_status,
  b.payment_status,
  b.total_amount,
  b.total_amount AS total_fare,
  b.currency,
  b.created_at,
  NULL::date AS return_date,
  NULL::jsonb AS fare_breakdown,
  NULL::numeric(12, 2) AS fare_base_total,
  NULL::numeric(12, 2) AS fare_tax_total,
  NULL::numeric(12, 2) AS fare_fee_total,
  (
    SELECT TRIM(BOTH ' ' FROM COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))
    FROM booking_passengers bp
    JOIN passengers p ON p.id = bp.passenger_id
    WHERE bp.booking_id = b.id
    ORDER BY bp.id ASC
    LIMIT 1
  ) AS primary_passenger_name,
  (
    SELECT STRING_AGG(
      f.departure_airport || '→' || f.arrival_airport,
      ' | ' ORDER BY f.departure_time ASC
    )
    FROM booking_flights bf
    JOIN flights f ON f.id = bf.flight_id
    WHERE bf.booking_id = b.id
  ) AS route_summary,
  (
    SELECT STRING_AGG(t.ticket_number, ', ' ORDER BY t.issued_at ASC NULLS LAST)
    FROM tickets t
    WHERE t.booking_id = b.id
  ) AS ticket_numbers_summary
FROM bookings b
ORDER BY b.created_at DESC
LIMIT 500`;

async function queryBookingListRows() {
  try {
    return await pool.query(BOOKING_LIST_SQL_FULL);
  } catch (err) {
    if (err && err.code === '42703') {
      return pool.query(BOOKING_LIST_SQL_COMPAT);
    }
    throw err;
  }
}

router.get(
  '/',
  requireAuth,
  requireRoles('admin', 'super_admin', 'agent', 'operations', 'customer_service', 'sales_manager'),
  async (_req, res) => {
    try {
      const result = await queryBookingListRows();
      return res.status(200).json({ bookings: result.rows });
    } catch (error) {
      const message = error?.message || String(error);
      if (process.env.NODE_ENV !== 'production') {
        console.error('[booking] list query failed:', error?.code, message);
      }
      return res.status(500).json({ message: 'Failed to list bookings.', error: message });
    }
  }
);

router.get(
  '/flights/search',
  requireAuth,
  requireRoles('admin', 'super_admin', 'agent', 'operations', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const { from, to, date, tripType, returnDate } = req.query;

    if (!from || !to || !date) {
      return res.status(400).json({ message: 'from, to, and date are required query parameters.' });
    }
    if (String(from).trim().toUpperCase() === String(to).trim().toUpperCase()) {
      return res.status(400).json({ message: 'Origin and destination must be different.' });
    }

    const normalizedTripType = String(tripType || 'ONE_WAY').toUpperCase();
    if (!['ONE_WAY', 'RETURN'].includes(normalizedTripType)) {
      return res.status(400).json({ message: 'tripType must be ONE_WAY or RETURN.' });
    }
    if (normalizedTripType === 'RETURN') {
      if (!returnDate) {
        return res.status(400).json({ message: 'returnDate is required for RETURN tripType.' });
      }
      if (new Date(String(returnDate)) <= new Date(String(date))) {
        return res.status(400).json({ message: 'Return date must be after departure date.' });
      }
    }

    try {
      const outboundFlights = await pool.query(
        `SELECT
          f.id,
          f.flight_number,
          f.departure_airport,
          f.arrival_airport,
          f.departure_time,
          f.arrival_time,
          f.status,
          a.tail_number,
          a.model,
          a.seat_capacity
        FROM flights f
        LEFT JOIN aircraft a ON a.id = f.aircraft_id
        WHERE
          UPPER(f.departure_airport) = UPPER($1)
          AND UPPER(f.arrival_airport) = UPPER($2)
          AND (f.departure_time AT TIME ZONE 'UTC')::date = $3::date
        ORDER BY f.departure_time ASC`,
        [from, to, date]
      );

      let inboundFlights = { rows: [] };
      if (normalizedTripType === 'RETURN') {
        inboundFlights = await pool.query(
          `SELECT
            f.id,
            f.flight_number,
            f.departure_airport,
            f.arrival_airport,
            f.departure_time,
            f.arrival_time,
            f.status,
            a.tail_number,
            a.model,
            a.seat_capacity
          FROM flights f
          LEFT JOIN aircraft a ON a.id = f.aircraft_id
          WHERE
            UPPER(f.departure_airport) = UPPER($1)
            AND UPPER(f.arrival_airport) = UPPER($2)
            AND (f.departure_time AT TIME ZONE 'UTC')::date = $3::date
          ORDER BY f.departure_time ASC`,
          [to, from, returnDate]
        );
      }

      return res.status(200).json({
        tripType: normalizedTripType,
        route: `${String(from).toUpperCase()}-${String(to).toUpperCase()}`,
        departureDate: date,
        returnDate: returnDate || null,
        outboundFlights: outboundFlights.rows,
        inboundFlights: inboundFlights.rows,
        flights: outboundFlights.rows
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to search flights.', error: error.message });
    }
  }
);

/** Simple availability: aircraft capacity minus passengers on non-cancelled bookings for this flight leg. */
router.get(
  '/flights/:flightId/availability',
  requireAuth,
  requireRoles('admin', 'super_admin', 'agent', 'operations', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const { flightId } = req.params;
    if (!isUuid(flightId)) {
      return res.status(400).json({ message: 'Invalid flight id.' });
    }
    try {
      const f = await pool.query(
        `SELECT f.id, f.flight_number, COALESCE(a.seat_capacity, 0)::int AS seat_capacity
         FROM flights f
         LEFT JOIN aircraft a ON a.id = f.aircraft_id
         WHERE f.id = $1`,
        [flightId]
      );
      if (!f.rows[0]) {
        return res.status(404).json({ message: 'Flight not found.' });
      }
      const pax = await pool.query(
        `SELECT COUNT(DISTINCT bp.passenger_id)::int AS passenger_legs
         FROM booking_flights bf
         JOIN bookings b ON b.id = bf.booking_id AND UPPER(TRIM(b.booking_status)) <> 'CANCELLED'
         JOIN booking_passengers bp ON bp.booking_id = b.id
         WHERE bf.flight_id = $1`,
        [flightId]
      );
      const cap = Number(f.rows[0].seat_capacity || 0);
      const used = Number(pax.rows[0]?.passenger_legs || 0);
      return res.status(200).json({
        flightId,
        flightNumber: f.rows[0].flight_number,
        seatCapacity: cap,
        passengersBooked: used,
        seatsAvailable: Math.max(0, cap - used)
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load availability.', error: error.message });
    }
  }
);

const pricingErrorMap = {
  INVALID_FARE_CLASS: [400, 'Invalid or inactive fare class.'],
  NO_ROUTE_FOR_OUTBOUND: [400, 'No active master-data route for outbound airports.'],
  NO_ROUTE_FOR_INBOUND: [400, 'No active master-data route for inbound airports.'],
  NO_ROUTE_FARE_FOR_OUTBOUND: [400, 'No route fare for this fare class (outbound).'],
  NO_ROUTE_FARE_FOR_INBOUND: [400, 'No route fare for this fare class (inbound).'],
  CURRENCY_MISMATCH_LEGS: [400, 'Inbound and outbound fares use different currencies.']
};

router.post('/', requireAuth, requireRoles('admin', 'super_admin', 'agent', 'customer_service', 'sales_manager'), async (req, res) => {
  const {
    tripType = 'ONE_WAY',
    outboundFlightId,
    inboundFlightId,
    passengers,
    outboundFareAmount,
    inboundFareAmount,
    fareAmount,
    currency,
    paymentType,
    departureDate,
    returnDate,
    fareClassId,
    collectPayment,
    notes,
    promoCode,
    campaignId
  } = req.body;

  const shouldCollectPayment = collectPayment !== false;
  const notesText = notes != null ? String(notes).trim().slice(0, 8000) : null;

  const normalizedTripType = String(tripType || 'ONE_WAY').toUpperCase();
  if (!['ONE_WAY', 'RETURN'].includes(normalizedTripType)) {
    return res.status(400).json({ message: 'tripType must be ONE_WAY or RETURN.' });
  }

  if (!outboundFlightId || !Array.isArray(passengers) || passengers.length === 0) {
    return res
      .status(400)
      .json({ message: 'outboundFlightId and passengers are required to create a booking.' });
  }

  if (normalizedTripType === 'RETURN') {
    if (!inboundFlightId) {
      return res.status(400).json({ message: 'inboundFlightId is required for RETURN trip type.' });
    }
    if (!returnDate || !departureDate || new Date(returnDate) <= new Date(departureDate)) {
      return res.status(400).json({ message: 'Return date must be after departure date.' });
    }
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const outboundFlightResult = await client.query(
      `SELECT id, flight_number, departure_airport, arrival_airport, departure_time, arrival_time, status
       FROM flights WHERE id = $1`,
      [outboundFlightId]
    );
    const outboundFlight = outboundFlightResult.rows[0];

    if (!outboundFlight) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Outbound flight not found.' });
    }
    if (
      String(outboundFlight.departure_airport).toUpperCase() ===
      String(outboundFlight.arrival_airport).toUpperCase()
    ) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Origin and destination must be different for the outbound flight.' });
    }

    let inboundFlight = null;
    if (normalizedTripType === 'RETURN') {
      const inboundFlightResult = await client.query(
        `SELECT id, flight_number, departure_airport, arrival_airport, departure_time, arrival_time, status
         FROM flights WHERE id = $1`,
        [inboundFlightId]
      );
      inboundFlight = inboundFlightResult.rows[0] || null;
      if (!inboundFlight) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Inbound flight not found.' });
      }
      if (
        String(inboundFlight.departure_airport).toUpperCase() !==
          String(outboundFlight.arrival_airport).toUpperCase() ||
        String(inboundFlight.arrival_airport).toUpperCase() !==
          String(outboundFlight.departure_airport).toUpperCase()
      ) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Inbound flight must be reverse route of outbound flight.' });
      }
      if (new Date(inboundFlight.departure_time) <= new Date(outboundFlight.departure_time)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Inbound flight must depart after outbound flight.' });
      }
    }

    const pnr = await generateUniquePnr(client);

    let outboundAmountPerPax = 0;
    let inboundAmountPerPax = 0;
    let totalPerPaxCharged = 0;
    let bookingCurrency = currency || 'USD';
    let cabinClass = 'ECONOMY';
    let fareClassUuid = null;
    let pricingBreakdown = null;

    if (fareClassId) {
      fareClassUuid = fareClassId;
      try {
        const pricing = await computeItineraryPricing(client, {
          outboundFlight,
          inboundFlight,
          tripType: normalizedTripType,
          fareClassId: fareClassUuid
        });
        outboundAmountPerPax = pricing.outboundPerPax;
        inboundAmountPerPax = pricing.inboundPerPax;
        totalPerPaxCharged = pricing.totalPerPax;
        bookingCurrency = pricing.currency;
        cabinClass = String(pricing.bookingClass || 'ECONOMY').slice(0, 20);
        pricingBreakdown = pricing.breakdown;
      } catch (e) {
        await client.query('ROLLBACK');
        const mapped = pricingErrorMap[e.message];
        if (mapped) {
          return res.status(mapped[0]).json({ message: mapped[1] });
        }
        return res.status(500).json({ message: 'Fare calculation failed.', error: e.message });
      }
    } else {
      outboundAmountPerPax = Number(outboundFareAmount ?? fareAmount);
      inboundAmountPerPax =
        normalizedTripType === 'RETURN' ? Number(inboundFareAmount ?? fareAmount ?? outboundFareAmount) : 0;

      if (!Number.isFinite(outboundAmountPerPax) || outboundAmountPerPax <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Outbound fare amount must be a positive number.' });
      }
      if (normalizedTripType === 'RETURN' && (!Number.isFinite(inboundAmountPerPax) || inboundAmountPerPax <= 0)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Inbound fare amount must be a positive number.' });
      }
      totalPerPaxCharged = outboundAmountPerPax + inboundAmountPerPax;
    }

    const baseTotalAmount = totalPerPaxCharged * passengers.length;
    const travelDateStr = new Date(outboundFlight.departure_time).toISOString().slice(0, 10);
    let promoDiscountAmount = 0;
    let promoCodeId = null;
    let campaignUuid = null;

    if (promoCode && String(promoCode).trim()) {
      try {
        const promoOut = await validateAndLockPromo(client, {
          code: String(promoCode).trim(),
          travelDate: travelDateStr,
          origin: outboundFlight.departure_airport,
          dest: outboundFlight.arrival_airport,
          subtotal: baseTotalAmount
        });
        promoDiscountAmount = promoOut.discountAmount;
        promoCodeId = promoOut.promo ? promoOut.promo.id : null;
      } catch (e) {
        await client.query('ROLLBACK');
        if (e instanceof PromoValidationError) {
          return res.status(400).json({ message: e.message, promoError: e.key });
        }
        return res.status(400).json({ message: e.message || 'Promo validation failed.' });
      }
    }

    if (campaignId && isUuid(String(campaignId))) {
      const cr = await client.query(
        `SELECT id FROM sales_campaigns
         WHERE id = $1 AND start_date <= $2::date AND end_date >= $2::date`,
        [campaignId, travelDateStr]
      );
      if (cr.rowCount > 0) {
        campaignUuid = campaignId;
      }
    }

    const totalAmount = Math.max(0, Math.round((baseTotalAmount - promoDiscountAmount) * 100) / 100);

    const returnDateVal =
      normalizedTripType === 'RETURN'
        ? String(returnDate || '').slice(0, 10) ||
          new Date(inboundFlight.departure_time).toISOString().slice(0, 10)
        : null;

    const fareSnap = buildFareSnapshot({
      normalizedTripType,
      passengers,
      outboundAmountPerPax,
      inboundAmountPerPax,
      totalPerPaxCharged,
      bookingCurrency,
      baseTotalAmount,
      promoDiscountAmount,
      totalAmount,
      pricingBreakdown
    });

    const bookingInsert = await client.query(
      `INSERT INTO bookings (
        pnr, trip_type, booking_status, total_amount, currency, created_by, payment_status, notes,
        promo_code_id, campaign_id, promo_discount_amount,
        return_date, fare_breakdown, fare_base_total, fare_tax_total, fare_fee_total
      )
       VALUES ($1, $2, $3, $4, $5, $6, 'UNPAID', $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15)
       RETURNING id, pnr, trip_type, booking_status, payment_status, total_amount, currency, created_at, notes,
         promo_code_id, campaign_id, promo_discount_amount, return_date, fare_breakdown, fare_base_total, fare_tax_total, fare_fee_total`,
      [
        pnr,
        normalizedTripType,
        'CONFIRMED',
        totalAmount,
        bookingCurrency,
        req.user.userId,
        notesText,
        promoCodeId,
        campaignUuid,
        promoDiscountAmount,
        returnDateVal,
        JSON.stringify(fareSnap.fare_breakdown),
        fareSnap.fare_base_total,
        fareSnap.fare_tax_total,
        fareSnap.fare_fee_total
      ]
    );
    const booking = bookingInsert.rows[0];

    await client.query(
      `INSERT INTO booking_flights (booking_id, flight_id, leg_type, cabin_class, fare_amount, fare_class_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [booking.id, outboundFlight.id, 'OUTBOUND', cabinClass, outboundAmountPerPax, fareClassUuid]
    );
    if (normalizedTripType === 'RETURN' && inboundFlight) {
      await client.query(
        `INSERT INTO booking_flights (booking_id, flight_id, leg_type, cabin_class, fare_amount, fare_class_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [booking.id, inboundFlight.id, 'INBOUND', cabinClass, inboundAmountPerPax, fareClassUuid]
      );
    }

    const passengerRows = [];
    for (const pax of passengers) {
      const fullName = String(pax.fullName || '').trim();
      const { firstName, lastName } = fullName
        ? splitFullName(fullName)
        : { firstName: String(pax.firstName || '').trim(), lastName: String(pax.lastName || '').trim() };

      if (!firstName || !lastName) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Each passenger requires fullName (or firstName and lastName).' });
      }
      if (!pax.gender) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Each passenger requires gender.' });
      }
      if (!pax.dateOfBirth) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Each passenger requires dateOfBirth.' });
      }

      const passengerInsert = await client.query(
        `INSERT INTO passengers (
          first_name,
          last_name,
          gender,
          date_of_birth,
          nationality,
          passport_no,
          passport_expiry,
          phone,
          email,
          emergency_contact
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, first_name, last_name, gender, date_of_birth, nationality, passport_no, passport_expiry, phone, email, emergency_contact`,
        [
          firstName,
          lastName,
          pax.gender || null,
          pax.dateOfBirth || null,
          pax.nationality || null,
          pax.passportNo || null,
          pax.passportExpiry || null,
          pax.phone || null,
          pax.email || null,
          pax.emergencyContact || null
        ]
      );

      const passenger = passengerInsert.rows[0];
      passengerRows.push(passenger);

      await client.query(
        `INSERT INTO booking_passengers (booking_id, passenger_id, passenger_type)
         VALUES ($1, $2, $3)`,
        [booking.id, passenger.id, pax.passengerType || 'ADT']
      );
    }

    if (shouldCollectPayment) {
      const payIns = await client.query(
        `INSERT INTO payments (booking_id, payment_type, amount, currency, payment_status, transaction_ref, processed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          booking.id,
          paymentType || 'CARD',
          totalAmount,
          booking.currency,
          'PAID',
          `TXN-${Date.now()}`,
          req.user.userId
        ]
      );
      const pid = payIns.rows[0]?.id;
      if (pid) {
        await logFinanceTransaction(client, {
          txnType: 'PAYMENT_RECORDED',
          amount: totalAmount,
          currency: booking.currency,
          bookingId: booking.id,
          paymentId: pid,
          description: 'Payment at booking creation',
          metadata: { source: 'booking_create' },
          userId: req.user.userId
        });
      }
    }

    await syncBookingPaymentStatus(client, booking.id);

    const bookingFresh = await client.query(
      `SELECT id, pnr, trip_type, booking_status, payment_status, total_amount, currency, created_at, notes,
              return_date, fare_breakdown, fare_base_total, fare_tax_total, fare_fee_total
       FROM bookings WHERE id = $1`,
      [booking.id]
    );
    const bookingRow = bookingFresh.rows[0];

    if (promoCodeId) {
      await incrementPromoUsage(client, promoCodeId);
    }

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.userId,
        'BOOKING_CREATED',
        'bookings',
        booking.id,
        JSON.stringify({
          pnr: booking.pnr,
          tripType: normalizedTripType,
          passengerCount: passengers.length,
          outboundFlight: outboundFlight.flight_number,
          inboundFlight: inboundFlight?.flight_number || null,
          fareClassId: fareClassUuid || undefined,
          collectPayment: shouldCollectPayment,
          paymentStatus: bookingRow.payment_status,
          baseTotalAmount,
          promoDiscountAmount,
          campaignId: campaignUuid,
          promoCode: promoCode ? String(promoCode).trim() : null
        })
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      booking: {
        ...bookingRow,
        outboundFlight,
        inboundFlight,
        fare: {
          outboundPerPassenger: outboundAmountPerPax,
          inboundPerPassenger: inboundAmountPerPax,
          totalPerPassenger: totalPerPaxCharged,
          passengerCount: passengers.length,
          subtotalBeforePromo: baseTotalAmount,
          promoDiscount: promoDiscountAmount,
          totalCharged: totalAmount,
          ...(pricingBreakdown ? { breakdown: pricingBreakdown } : {})
        },
        passengers: passengerRows
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed to create booking.', error: error.message });
  } finally {
    client.release();
  }
});

router.post('/:bookingId/tickets/issue', requireAuth, requireRoles('admin', 'super_admin', 'agent', 'customer_service', 'sales_manager'), async (req, res) => {
  const { bookingId } = req.params;
  if (!isUuid(bookingId)) {
    return res.status(400).json({ message: 'Invalid booking id.' });
  }
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const bookingResult = await client.query(
      `SELECT id, pnr, booking_status, payment_status, total_amount, currency
       FROM bookings WHERE id = $1`,
      [bookingId]
    );
    const booking = bookingResult.rows[0];

    if (!booking) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Booking not found.' });
    }

    if (String(booking.booking_status).toUpperCase() === 'CANCELLED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Cannot issue tickets for a cancelled booking.' });
    }

    await syncBookingPaymentStatus(client, bookingId);
    const paidCheck = await client.query(
      `SELECT payment_status, total_amount FROM bookings WHERE id = $1`,
      [bookingId]
    );
    const row = paidCheck.rows[0];
    if (!row || String(row.payment_status).toUpperCase() !== 'PAID') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message:
          'Tickets can only be issued after the booking is fully paid. Record a successful payment or enable collect payment when creating the booking.'
      });
    }

    const passengers = await client.query(
      `SELECT bp.passenger_id
       FROM booking_passengers bp
       WHERE bp.booking_id = $1`,
      [bookingId]
    );

    if (passengers.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No passengers found for booking.' });
    }

    const issuedTickets = [];
    let newlyIssued = 0;
    for (const row of passengers.rows) {
      const existing = await client.query(
        `SELECT id, ticket_number, passenger_id
         FROM tickets
         WHERE booking_id = $1 AND passenger_id = $2`,
        [bookingId, row.passenger_id]
      );

      if (existing.rowCount > 0) {
        issuedTickets.push(existing.rows[0]);
        continue;
      }

      const ticketNumber = await generateTicketNumber(client);
      const ticket = await client.query(
        `INSERT INTO tickets (ticket_number, booking_id, passenger_id, issued_by, ticket_status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, ticket_number, passenger_id, issued_at, ticket_status`,
        [ticketNumber, bookingId, row.passenger_id, req.user.userId, 'ISSUED']
      );

      issuedTickets.push(ticket.rows[0]);
      newlyIssued += 1;
    }

    if (newlyIssued > 0) {
      await logFinanceTransaction(client, {
        txnType: 'TICKET_ISSUED',
        amount: null,
        currency: booking.currency || 'USD',
        bookingId,
        description: `Issued ${newlyIssued} ticket(s) for PNR ${booking.pnr}`,
        metadata: { pnr: booking.pnr, newlyIssued },
        userId: req.user.userId
      });
    }

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.userId,
        'TICKETS_ISSUED',
        'bookings',
        bookingId,
        JSON.stringify({ pnr: booking.pnr, ticketCount: issuedTickets.length })
      ]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      bookingId,
      pnr: booking.pnr,
      tickets: issuedTickets
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Failed to issue tickets.', error: error.message });
  } finally {
    client.release();
  }
});

router.get('/pnr/:pnr', requireAuth, requireRoles('admin', 'super_admin', 'agent', 'operations', 'customer_service', 'sales_manager'), async (req, res) => {
  const { pnr } = req.params;

  try {
    const bookingResult = await pool.query(
      `SELECT b.id, b.pnr, b.trip_type, b.booking_status, b.payment_status, b.total_amount, b.currency, b.created_at, b.notes,
              b.return_date, b.fare_breakdown, b.fare_base_total, b.fare_tax_total, b.fare_fee_total,
              b.promo_code_id, b.campaign_id, b.promo_discount_amount, pc.code AS promo_code
       FROM bookings b
       LEFT JOIN sales_promo_codes pc ON pc.id = b.promo_code_id
       WHERE b.pnr = UPPER($1)`,
      [pnr]
    );
    const booking = bookingResult.rows[0];
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const flightRows = await pool.query(
      `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time, f.arrival_time, bf.leg_type, bf.fare_amount
       FROM booking_flights bf
       JOIN flights f ON f.id = bf.flight_id
       WHERE bf.booking_id = $1
       ORDER BY CASE bf.leg_type WHEN 'OUTBOUND' THEN 1 WHEN 'INBOUND' THEN 2 ELSE 3 END, f.departure_time ASC`,
      [booking.id]
    );

    const passengers = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, p.gender, p.date_of_birth, p.nationality, p.passport_no, p.passport_expiry, p.phone, p.email, p.emergency_contact, bp.passenger_type
       FROM booking_passengers bp
       JOIN passengers p ON p.id = bp.passenger_id
       WHERE bp.booking_id = $1`,
      [booking.id]
    );

    const tickets = await pool.query(
      `SELECT id, ticket_number, passenger_id, issued_at, ticket_status
       FROM tickets
       WHERE booking_id = $1`,
      [booking.id]
    );

    const payments = await pool.query(
      `SELECT id, payment_type, amount, currency, payment_status, transaction_ref, processed_at
       FROM payments
       WHERE booking_id = $1
       ORDER BY processed_at DESC`,
      [booking.id]
    );

    return res.status(200).json({
      booking,
      flights: flightRows.rows,
      passengers: passengers.rows,
      tickets: tickets.rows,
      payments: payments.rows
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to retrieve booking by PNR.', error: error.message });
  }
});

router.get(
  '/:bookingId',
  requireAuth,
  requireRoles('admin', 'super_admin', 'agent', 'operations', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const { bookingId } = req.params;
    if (!isUuid(bookingId)) {
      return res.status(400).json({ message: 'Invalid booking id.' });
    }

    try {
      const bookingResult = await pool.query(
        `SELECT b.id, b.pnr, b.trip_type, b.booking_status, b.payment_status, b.total_amount, b.currency, b.created_at, b.notes,
                b.return_date, b.fare_breakdown, b.fare_base_total, b.fare_tax_total, b.fare_fee_total,
                b.promo_code_id, b.campaign_id, b.promo_discount_amount, pc.code AS promo_code
         FROM bookings b
         LEFT JOIN sales_promo_codes pc ON pc.id = b.promo_code_id
         WHERE b.id = $1`,
        [bookingId]
      );
      const booking = bookingResult.rows[0];
      if (!booking) {
        return res.status(404).json({ message: 'Booking not found.' });
      }

      const flightRows = await pool.query(
        `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time, f.arrival_time, bf.leg_type, bf.fare_amount
         FROM booking_flights bf
         JOIN flights f ON f.id = bf.flight_id
         WHERE bf.booking_id = $1
         ORDER BY CASE bf.leg_type WHEN 'OUTBOUND' THEN 1 WHEN 'INBOUND' THEN 2 ELSE 3 END, f.departure_time ASC`,
        [bookingId]
      );

      const passengers = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, p.gender, p.date_of_birth, p.nationality, p.passport_no, p.passport_expiry, p.phone, p.email, p.emergency_contact, bp.passenger_type
         FROM booking_passengers bp
         JOIN passengers p ON p.id = bp.passenger_id
         WHERE bp.booking_id = $1`,
        [bookingId]
      );

      const tickets = await pool.query(
        `SELECT id, ticket_number, passenger_id, issued_at, ticket_status
         FROM tickets
         WHERE booking_id = $1`,
        [bookingId]
      );

      const payments = await pool.query(
        `SELECT id, payment_type, amount, currency, payment_status, transaction_ref, processed_at
         FROM payments
         WHERE booking_id = $1
         ORDER BY processed_at DESC`,
        [bookingId]
      );

      return res.status(200).json({
        booking,
        flights: flightRows.rows,
        passengers: passengers.rows,
        tickets: tickets.rows,
        payments: payments.rows
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to retrieve booking.', error: error.message });
    }
  }
);

router.post(
  '/:bookingId/cancel',
  requireAuth,
  requireRoles('admin', 'super_admin', 'agent', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const { bookingId } = req.params;
    if (!isUuid(bookingId)) {
      return res.status(400).json({ message: 'Invalid booking id.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT id, pnr, booking_status FROM bookings WHERE id = $1`,
        [bookingId]
      );
      const row = existing.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Booking not found.' });
      }
      if (String(row.booking_status).toUpperCase() === 'CANCELLED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Booking is already cancelled.' });
      }
      await client.query(`UPDATE bookings SET booking_status = 'CANCELLED' WHERE id = $1`, [bookingId]);
      await client.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          req.user.userId,
          'BOOKING_CANCELLED',
          'bookings',
          bookingId,
          JSON.stringify({ pnr: row.pnr })
        ]
      );
      await client.query('COMMIT');
      return res.status(200).json({ bookingId, pnr: row.pnr, booking_status: 'CANCELLED' });
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: 'Failed to cancel booking.', error: error.message });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/:bookingId/payments',
  requireAuth,
  requireRoles('admin', 'super_admin', 'agent', 'customer_service', 'sales_manager', 'finance'),
  async (req, res) => {
    const { bookingId } = req.params;
    if (!isUuid(bookingId)) {
      return res.status(400).json({ message: 'Invalid booking id.' });
    }
    const { amount, paymentType, paymentStatus } = req.body;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ message: 'amount must be a positive number.' });
    }
    let statusRaw = String(paymentStatus || 'PAID').toUpperCase();
    if (statusRaw === 'SUCCESS') statusRaw = 'PAID';
    if (!['PAID', 'PENDING', 'FAILED'].includes(statusRaw)) {
      return res.status(400).json({ message: 'paymentStatus must be PAID, PENDING, or FAILED (SUCCESS is accepted as PAID).' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const b = await client.query(
        `SELECT id, currency, booking_status FROM bookings WHERE id = $1`,
        [bookingId]
      );
      if (!b.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Booking not found.' });
      }
      if (String(b.rows[0].booking_status).toUpperCase() === 'CANCELLED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Cannot add payments to a cancelled booking.' });
      }
      const payIns = await client.query(
        `INSERT INTO payments (booking_id, payment_type, amount, currency, payment_status, transaction_ref, processed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          bookingId,
          paymentType || 'CARD',
          amt,
          b.rows[0].currency,
          statusRaw,
          `TXN-${Date.now()}`,
          req.user.userId
        ]
      );
      await logFinanceTransaction(client, {
        txnType: 'PAYMENT_RECORDED',
        amount: amt,
        currency: b.rows[0].currency,
        bookingId,
        paymentId: payIns.rows[0].id,
        description: `Manual payment (${statusRaw})`,
        metadata: { paymentType: paymentType || 'CARD' },
        userId: req.user.userId
      });
      await syncBookingPaymentStatus(client, bookingId);
      const fresh = await client.query(
        `SELECT id, pnr, payment_status, total_amount, currency FROM bookings WHERE id = $1`,
        [bookingId]
      );
      await client.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          req.user.userId,
          'BOOKING_PAYMENT_RECORDED',
          'bookings',
          bookingId,
          JSON.stringify({ amount: amt, paymentStatus: statusRaw })
        ]
      );
      await client.query('COMMIT');
      return res.status(201).json({ booking: fresh.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: 'Failed to record payment.', error: error.message });
    } finally {
      client.release();
    }
  }
);

router.put(
  '/:bookingId',
  requireAuth,
  requireRoles('admin', 'super_admin', 'agent', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const { bookingId } = req.params;
    if (!isUuid(bookingId)) {
      return res.status(400).json({ message: 'Invalid booking id.' });
    }
    const { notes, passengerContacts } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const b = await client.query(`SELECT id, booking_status FROM bookings WHERE id = $1`, [bookingId]);
      if (!b.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Booking not found.' });
      }
      if (String(b.rows[0].booking_status).toUpperCase() === 'CANCELLED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Cannot modify a cancelled booking.' });
      }
      if (notes !== undefined) {
        const n = notes == null ? null : String(notes).trim().slice(0, 8000);
        await client.query(`UPDATE bookings SET notes = $2 WHERE id = $1`, [bookingId, n]);
      }
      if (Array.isArray(passengerContacts) && passengerContacts.length > 0) {
        for (const pc of passengerContacts) {
          const pid = pc.passengerId || pc.passenger_id;
          if (!pid || !isUuid(String(pid))) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Each passenger contact update requires a valid passengerId.' });
          }
          const link = await client.query(
            `SELECT 1 FROM booking_passengers WHERE booking_id = $1 AND passenger_id = $2`,
            [bookingId, pid]
          );
          if (link.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Passenger is not on this booking.' });
          }
          const phone = pc.phone !== undefined ? (pc.phone == null ? null : String(pc.phone).slice(0, 40)) : undefined;
          const email = pc.email !== undefined ? (pc.email == null ? null : String(pc.email).slice(0, 150)) : undefined;
          if (phone !== undefined || email !== undefined) {
            const cur = await client.query(`SELECT phone, email FROM passengers WHERE id = $1`, [pid]);
            if (!cur.rows[0]) {
              await client.query('ROLLBACK');
              return res.status(404).json({ message: 'Passenger not found.' });
            }
            const nextPhone = phone !== undefined ? phone : cur.rows[0].phone;
            const nextEmail = email !== undefined ? email : cur.rows[0].email;
            await client.query(`UPDATE passengers SET phone = $2, email = $3 WHERE id = $1`, [pid, nextPhone, nextEmail]);
          }
        }
      }
      await client.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          req.user.userId,
          'BOOKING_UPDATED',
          'bookings',
          bookingId,
          JSON.stringify({
            notesUpdated: notes !== undefined,
            passengerContactsCount: Array.isArray(passengerContacts) ? passengerContacts.length : 0
          })
        ]
      );
      await client.query('COMMIT');
      const out = await pool.query(
        `SELECT id, pnr, trip_type, booking_status, payment_status, total_amount, currency, created_at, notes,
                return_date, fare_breakdown, fare_base_total, fare_tax_total, fare_fee_total
         FROM bookings WHERE id = $1`,
        [bookingId]
      );
      return res.status(200).json({ booking: out.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: 'Failed to update booking.', error: error.message });
    } finally {
      client.release();
    }
  }
);

export default router;
