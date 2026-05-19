import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import {
  ROLES_BOOKING_DESK,
  ROLES_BOOKING_PAYMENTS,
  ROLES_TICKET_ISSUE,
  ROLES_REFUND_REQUEST,
  ROLES_TICKET_RETRIEVE
} from '../../lib/airlineRbac.js';
import { writeAudit } from '../../services/auditService.js';
import { syncBookingPaymentStatus } from '../../services/bookingPaymentSync.js';
import { syncCrmCustomersForBooking } from '../../services/salesCommercialSync.js';
import {
  generateAirlinePnr,
  getFlightInventory,
  loadFlightsForLegs,
  priceMultiCityLegs,
  assertInventoryForLegs,
  upsertPassengerProfile,
  appendTravelHistory,
  addSsr,
  addOsi,
  listSsrOsi,
  getBaggageRulesForBooking,
  modifyBooking,
  reissueTicket,
  refundTicket,
  addStandby,
  afterBookingCommitted,
  isMissingCommercialSchema,
  schemaHint
} from '../../services/commercialBookingService.js';
import {
  processNotificationOutbox,
  notifyBookingConfirmation,
  notifyFlightDelay
} from '../../services/commercialNotificationService.js';
import { syncTicketCouponsForBooking } from '../../services/ticketCouponService.js';
import { computeItineraryPricing } from '../../services/masterDataPricing.js';
import { logFinanceTransaction } from '../../services/financeLedger.js';
import { issueTicketsForBooking } from '../../services/commercialBookingService.js';

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

function handleErr(res, err) {
  if (isMissingCommercialSchema(err)) {
    return res.status(503).json({ message: 'Commercial schema not applied.', hint: schemaHint() });
  }
  const status = err.statusCode || 500;
  return res.status(status).json({ message: err.message || 'Request failed.', code: err.code });
}

function splitFullName(fullName) {
  const clean = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!clean) return { firstName: '', lastName: '' };
  const [firstName, ...rest] = clean.split(' ');
  return { firstName, lastName: rest.join(' ') || 'N/A' };
}

router.get('/health', (_req, res) => {
  res.json({ module: 'commercial-core', status: 'ready', phase: 2 });
});

router.get('/inventory/:flightId', requireAuth, requireRoles(...ROLES_BOOKING_DESK), async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const inv = await getFlightInventory(client, req.params.flightId, {
        fareClassId: req.query.fareClassId || null
      });
      if (!inv) return res.status(404).json({ message: 'Flight not found.' });
      return res.json({ inventory: inv });
    } finally {
      client.release();
    }
  } catch (e) {
    return handleErr(res, e);
  }
});

/** Multi-city booking: legs[{ flightId, fareAmount? }], passengers[], fareClassId? */
router.post('/bookings/multi-city', requireAuth, requireRoles(...ROLES_BOOKING_DESK), async (req, res) => {
  const { legs, passengers, fareClassId, currency, collectPayment, paymentType, notes, ssr, osi } = req.body;
  if (!Array.isArray(legs) || legs.length < 2) {
    return res.status(400).json({ message: 'Multi-city requires at least 2 legs in `legs`.' });
  }
  if (!Array.isArray(passengers) || passengers.length === 0) {
    return res.status(400).json({ message: 'passengers array is required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const legFlightIds = legs.map((l) => l.flightId).filter(Boolean);
    const loadedLegs = await loadFlightsForLegs(client, legFlightIds);
    await assertInventoryForLegs(client, loadedLegs, passengers.length, fareClassId);

    let totalPerPax = 0;
    let bookingCurrency = currency || 'USD';
    let cabinClass = 'ECONOMY';
    let pricingBreakdown = null;

    if (fareClassId) {
      const priced = await priceMultiCityLegs(client, loadedLegs, fareClassId);
      totalPerPax = priced.totalPerPax;
      bookingCurrency = priced.currency;
      cabinClass = priced.bookingClass;
      pricingBreakdown = priced.breakdown;
    } else {
      for (let i = 0; i < loadedLegs.length; i += 1) {
        const amt = Number(legs[i].fareAmount);
        if (!Number.isFinite(amt) || amt <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'Each leg requires fareAmount when fareClassId is omitted.' });
        }
        loadedLegs[i].fareAmount = amt;
        totalPerPax += amt;
      }
    }

    if (fareClassId) {
      for (let i = 0; i < loadedLegs.length; i += 1) {
        const p = await computeItineraryPricing(client, {
          outboundFlight: loadedLegs[i].flight,
          inboundFlight: null,
          tripType: 'ONE_WAY',
          fareClassId
        });
        loadedLegs[i].fareAmount = p.totalPerPax;
      }
    }

    const totalAmount = Math.round(totalPerPax * passengers.length * 100) / 100;
    const pnr = await generateAirlinePnr(client);

    const bookingIns = await client.query(
      `INSERT INTO bookings (
         pnr, trip_type, booking_status, total_amount, currency, created_by, payment_status, notes,
         fare_breakdown, fare_base_total, sales_channel_code
       )
       VALUES ($1, 'MULTI_CITY', 'CONFIRMED', $2, $3, $4, 'UNPAID', $5, $6::jsonb, $7, 'DIRECT_WEB')
       RETURNING *`,
      [
        pnr,
        totalAmount,
        bookingCurrency,
        req.user.userId,
        notes ? String(notes).slice(0, 8000) : null,
        JSON.stringify({ tripType: 'MULTI_CITY', perPassenger: totalPerPax, breakdown: pricingBreakdown }),
        totalAmount
      ]
    );
    const booking = bookingIns.rows[0];

    for (const leg of loadedLegs) {
      await client.query(
        `INSERT INTO booking_flights (booking_id, flight_id, leg_type, leg_sequence, cabin_class, fare_amount, fare_class_id)
         VALUES ($1, $2, 'LEG', $3, $4, $5, $6)`,
        [booking.id, leg.flight.id, leg.legSequence, cabinClass, leg.fareAmount, fareClassId || null]
      );
    }

    const passengerRows = [];
    for (const pax of passengers) {
      const { firstName, lastName } = pax.fullName
        ? splitFullName(pax.fullName)
        : { firstName: pax.firstName, lastName: pax.lastName };
      const pIns = await client.query(
        `INSERT INTO passengers (first_name, last_name, gender, date_of_birth, nationality, passport_no, phone, email)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          firstName,
          lastName,
          pax.gender,
          pax.dateOfBirth,
          pax.nationality || null,
          pax.passportNo || null,
          pax.phone || null,
          pax.email || null
        ]
      );
      const passenger = pIns.rows[0];
      passengerRows.push(passenger);
      await client.query(
        `INSERT INTO booking_passengers (booking_id, passenger_id, passenger_type) VALUES ($1,$2,$3)`,
        [booking.id, passenger.id, pax.passengerType || 'ADT']
      );
      const profile = await upsertPassengerProfile(client, {
        email: passenger.email,
        phone: passenger.phone,
        passengerId: passenger.id
      });
      if (profile?.id) {
        await appendTravelHistory(client, profile.id, {
          at: new Date().toISOString(),
          pnr,
          tripType: 'MULTI_CITY',
          legs: loadedLegs.map((l) => l.flight.flight_number)
        });
      }
    }

    if (Array.isArray(ssr)) {
      for (const s of ssr) {
        await addSsr(client, {
          bookingId: booking.id,
          passengerId: s.passengerId,
          flightId: s.flightId,
          ssrCode: s.code,
          ssrText: s.text,
          userId: req.user.userId
        });
      }
    }
    if (Array.isArray(osi)) {
      for (const line of osi) {
        await addOsi(client, { bookingId: booking.id, osiLine: line, userId: req.user.userId });
      }
    }

    const shouldPay = collectPayment !== false;
    if (shouldPay) {
      await client.query(
        `INSERT INTO payments (booking_id, payment_type, amount, currency, payment_status, transaction_ref, processed_by)
         VALUES ($1,$2,$3,$4,'PAID',$5,$6)`,
        [booking.id, paymentType || 'CARD', totalAmount, bookingCurrency, `TXN-${Date.now()}`, req.user.userId]
      );
      await logFinanceTransaction(client, {
        txnType: 'PAYMENT_RECORDED',
        amount: totalAmount,
        currency: bookingCurrency,
        bookingId: booking.id,
        description: 'Multi-city booking payment',
        userId: req.user.userId
      });
    }

    await syncBookingPaymentStatus(client, booking.id);
    try {
      await syncCrmCustomersForBooking(client, booking.id);
    } catch {
      /* optional */
    }

    let tickets = [];
    if (shouldPay) {
      const issueOut = await issueTicketsForBooking(client, booking.id, req.user.userId, { requirePaid: true });
      tickets = issueOut.tickets;
    }

    await client.query('COMMIT');

    await writeAudit(pool, {
      userId: req.user.userId,
      action: 'BOOKING_CREATED',
      entity: 'bookings',
      entityId: booking.id,
      metadata: { pnr, tripType: 'MULTI_CITY', legCount: loadedLegs.length },
      req
    });

    afterBookingCommitted(pool, {
      bookingId: booking.id,
      pnr,
      flightIds: loadedLegs.map((l) => l.flight.id),
      userId: req.user.userId
    });

    return res.status(201).json({
      booking: { ...booking, passengers: passengerRows, legs: loadedLegs.map((l) => l.flight) },
      tickets
    });
  } catch (e) {
    await client.query('ROLLBACK');
    return handleErr(res, e);
  } finally {
    client.release();
  }
});

router.get('/bookings/:bookingId/ssr-osi', requireAuth, requireRoles(...ROLES_BOOKING_DESK), async (req, res) => {
  if (!isUuid(req.params.bookingId)) return res.status(400).json({ message: 'Invalid booking id.' });
  const client = await pool.connect();
  try {
    const data = await listSsrOsi(client, req.params.bookingId);
    return res.json(data);
  } catch (e) {
    return handleErr(res, e);
  } finally {
    client.release();
  }
});

router.post('/bookings/:bookingId/ssr', requireAuth, requireRoles(...ROLES_BOOKING_DESK), async (req, res) => {
  if (!isUuid(req.params.bookingId)) return res.status(400).json({ message: 'Invalid booking id.' });
  const client = await pool.connect();
  try {
    const row = await addSsr(client, {
      bookingId: req.params.bookingId,
      passengerId: req.body.passengerId,
      flightId: req.body.flightId,
      ssrCode: req.body.ssrCode || req.body.code,
      ssrText: req.body.ssrText || req.body.text,
      userId: req.user.userId
    });
    return res.status(201).json({ ssr: row });
  } catch (e) {
    return handleErr(res, e);
  } finally {
    client.release();
  }
});

router.post('/bookings/:bookingId/osi', requireAuth, requireRoles(...ROLES_BOOKING_DESK), async (req, res) => {
  if (!isUuid(req.params.bookingId)) return res.status(400).json({ message: 'Invalid booking id.' });
  const client = await pool.connect();
  try {
    const row = await addOsi(client, {
      bookingId: req.params.bookingId,
      osiLine: req.body.osiLine || req.body.line,
      userId: req.user.userId
    });
    return res.status(201).json({ osi: row });
  } catch (e) {
    return handleErr(res, e);
  } finally {
    client.release();
  }
});

router.patch('/bookings/:bookingId/modify', requireAuth, requireRoles(...ROLES_BOOKING_DESK), async (req, res) => {
  if (!isUuid(req.params.bookingId)) return res.status(400).json({ message: 'Invalid booking id.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const booking = await modifyBooking(client, req.params.bookingId, {
      notes: req.body.notes,
      contactUpdates: req.body.contactUpdates,
      userId: req.user.userId
    });
    await client.query('COMMIT');
    return res.json({ booking });
  } catch (e) {
    await client.query('ROLLBACK');
    return handleErr(res, e);
  } finally {
    client.release();
  }
});

router.get('/bookings/:bookingId/baggage-rules', requireAuth, requireRoles(...ROLES_BOOKING_DESK), async (req, res) => {
  if (!isUuid(req.params.bookingId)) return res.status(400).json({ message: 'Invalid booking id.' });
  const client = await pool.connect();
  try {
    const rules = await getBaggageRulesForBooking(client, req.params.bookingId);
    return res.json({ rules });
  } catch (e) {
    return handleErr(res, e);
  } finally {
    client.release();
  }
});

router.post(
  '/tickets/:ticketId/reissue',
  requireAuth,
  requireRoles(...ROLES_TICKET_ISSUE),
  async (req, res) => {
    if (!isUuid(req.params.ticketId)) return res.status(400).json({ message: 'Invalid ticket id.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await reissueTicket(client, {
        ticketId: req.params.ticketId,
        userId: req.user.userId
      });
      await client.query('COMMIT');
      return res.json(out);
    } catch (e) {
      await client.query('ROLLBACK');
      return handleErr(res, e);
    } finally {
      client.release();
    }
  }
);

router.post(
  '/tickets/:ticketId/refund',
  requireAuth,
  requireRoles(...ROLES_REFUND_REQUEST),
  async (req, res) => {
    if (!isUuid(req.params.ticketId)) return res.status(400).json({ message: 'Invalid ticket id.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await refundTicket(client, {
        ticketId: req.params.ticketId,
        amount: req.body.amount,
        reason: req.body.reason,
        userId: req.user.userId
      });
      await client.query('COMMIT');
      return res.json(out);
    } catch (e) {
      await client.query('ROLLBACK');
      return handleErr(res, e);
    } finally {
      client.release();
    }
  }
);

router.get('/profiles/search', requireAuth, requireRoles(...ROLES_TICKET_RETRIEVE), async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ message: 'Query min 2 characters.' });
  try {
    const r = await pool.query(
      `SELECT pp.*,
              (SELECT COUNT(*)::int FROM passengers p WHERE p.profile_id = pp.id) AS passenger_links
       FROM passenger_profiles pp
       WHERE lower(primary_email) LIKE $1 OR primary_phone LIKE $1 OR profile_ref ILIKE $1
       ORDER BY updated_at DESC LIMIT 30`,
      [`%${q.toLowerCase()}%`]
    );
    return res.json({ profiles: r.rows });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/profiles/:profileId', requireAuth, requireRoles(...ROLES_TICKET_RETRIEVE), async (req, res) => {
  if (!isUuid(req.params.profileId)) return res.status(400).json({ message: 'Invalid profile id.' });
  try {
    const p = await pool.query(`SELECT * FROM passenger_profiles WHERE id = $1`, [req.params.profileId]);
    if (!p.rowCount) return res.status(404).json({ message: 'Profile not found.' });
    const pax = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, p.email, p.phone
       FROM passengers p WHERE p.profile_id = $1`,
      [req.params.profileId]
    );
    const history = await pool.query(
      `SELECT b.pnr, b.trip_type, b.created_at, b.total_amount, b.currency, b.booking_status
       FROM booking_passengers bp
       JOIN passengers p ON p.id = bp.passenger_id
       JOIN bookings b ON b.id = bp.booking_id
       WHERE p.profile_id = $1
       ORDER BY b.created_at DESC LIMIT 50`,
      [req.params.profileId]
    );
    return res.json({ profile: p.rows[0], passengers: pax.rows, bookings: history.rows });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.get('/notifications', requireAuth, requireRoles(...ROLES_BOOKING_DESK), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, channel, template_code, recipient, status, booking_id, flight_id, created_at, sent_at, error_message
       FROM commercial_notifications
       ORDER BY created_at DESC LIMIT $1`,
      [Math.min(Number(req.query.limit) || 50, 200)]
    );
    return res.json({ notifications: r.rows });
  } catch (e) {
    return handleErr(res, e);
  }
});

router.post('/notifications/process-outbox', requireAuth, requireRoles('admin', 'super_admin'), async (_req, res) => {
  try {
    const out = await processNotificationOutbox(50);
    return res.json(out);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.post('/notifications/booking/:bookingId/send', requireAuth, requireRoles(...ROLES_BOOKING_DESK), async (req, res) => {
  if (!isUuid(req.params.bookingId)) return res.status(400).json({ message: 'Invalid booking id.' });
  const client = await pool.connect();
  try {
    const channels = req.body.channels || ['EMAIL'];
    const queued = await notifyBookingConfirmation(client, req.params.bookingId, { channels });
    const out = await processNotificationOutbox(50);
    return res.json({ queued: queued.length, ...out });
  } catch (e) {
    return handleErr(res, e);
  } finally {
    client.release();
  }
});

router.post('/flights/:flightId/delay-notify', requireAuth, requireRoles('admin', 'super_admin', 'operations'), async (req, res) => {
  if (!isUuid(req.params.flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
  try {
    const out = await notifyFlightDelay(req.params.flightId, {
      delayMinutes: Number(req.body.delayMinutes) || 0,
      reason: req.body.reason
    });
    await processNotificationOutbox(100);
    return res.json(out);
  } catch (e) {
    return handleErr(res, e);
  }
});

router.post('/flights/:flightId/standby', requireAuth, requireRoles(...ROLES_BOOKING_DESK), async (req, res) => {
  if (!isUuid(req.params.flightId)) return res.status(400).json({ message: 'Invalid flight id.' });
  const { bookingId, passengerId, priority } = req.body;
  if (!isUuid(bookingId) || !isUuid(passengerId)) {
    return res.status(400).json({ message: 'bookingId and passengerId required.' });
  }
  const client = await pool.connect();
  try {
    const row = await addStandby(client, {
      flightId: req.params.flightId,
      bookingId,
      passengerId,
      priority
    });
    return res.status(201).json({ standby: row });
  } catch (e) {
    return handleErr(res, e);
  } finally {
    client.release();
  }
});

router.get('/bookings/:bookingId/coupons', requireAuth, requireRoles(...ROLES_TICKET_RETRIEVE), async (req, res) => {
  if (!isUuid(req.params.bookingId)) return res.status(400).json({ message: 'Invalid booking id.' });
  try {
    const r = await pool.query(
      `SELECT tc.*, t.ticket_number, f.flight_number, f.departure_airport, f.arrival_airport
       FROM ticket_coupons tc
       JOIN tickets t ON t.id = tc.ticket_id
       JOIN booking_flights bf ON bf.id = tc.booking_flight_id
       JOIN flights f ON f.id = bf.flight_id
       WHERE t.booking_id = $1
       ORDER BY t.ticket_number, tc.coupon_number`,
      [req.params.bookingId]
    );
    return res.json({ coupons: r.rows });
  } catch (e) {
    return handleErr(res, e);
  }
});

export default router;
