import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import { userHasAnyRole } from '../../lib/roles.js';
import { canAccessReport, isAgentOnlySales, canFilterByAgent } from '../../lib/reportAccess.js';

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function sendCsv(res, filename, headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(lines.join('\n'));
}

function parseRange(req) {
  const from = req.query.from ? String(req.query.from).slice(0, 10) : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = req.query.to ? String(req.query.to).slice(0, 10) : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const e = new Error('Invalid from/to date (use YYYY-MM-DD).');
    e.status = 400;
    throw e;
  }
  return { from, to };
}

function parseRouteFilter(req) {
  const route = req.query.route ? String(req.query.route).trim().toUpperCase() : '';
  const dep = req.query.departureAirport ? String(req.query.departureAirport).trim().toUpperCase().slice(0, 10) : '';
  const arr = req.query.arrivalAirport ? String(req.query.arrivalAirport).trim().toUpperCase().slice(0, 10) : '';
  if (route && route.includes('-')) {
    const [a, b] = route.split('-');
    return { dep: a?.trim() || '', arr: b?.trim() || '' };
  }
  return { dep, arr };
}

function guardReport(req, res, key) {
  if (!canAccessReport(req.user.role, key)) {
    res.status(403).json({ message: 'You do not have access to this report.' });
    return false;
  }
  return true;
}

function agentBookingClause(role, userId, paramStart) {
  if (!isAgentOnlySales(role)) return { sql: '', params: [], next: paramStart };
  return { sql: ` AND b.created_by = $${paramStart}::uuid `, params: [userId], next: paramStart + 1 };
}

router.use(
  requireAuth,
  requireRoles(
    'admin',
    'super_admin',
    'finance',
    'sales_manager',
    'agent',
    'operations',
    'maintenance',
    'customer_service'
  )
);

router.get('/health', (_req, res) => {
  res.json({ module: 'reports-analytics', status: 'ready' });
});

router.get('/meta/flights', async (req, res) => {
  if (!guardReport(req, res, 'meta')) return;
  try {
    const { from, to } = parseRange(req);
    const { dep, arr } = parseRouteFilter(req);
    const vals = [from, to];
    let extra = '';
    if (dep) {
      vals.push(dep);
      extra += ` AND f.departure_airport = $${vals.length}`;
    }
    if (arr) {
      vals.push(arr);
      extra += ` AND f.arrival_airport = $${vals.length}`;
    }
    const r = await pool.query(
      `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time, f.status, f.aircraft_id
       FROM flights f
       WHERE DATE(f.departure_time) >= DATE($1::date) AND DATE(f.departure_time) <= DATE($2::date)
       ${extra}
       ORDER BY f.departure_time ASC
       LIMIT 500`,
      vals
    );
    return res.status(200).json({ from, to, flights: r.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to load flights.' });
  }
});

router.get('/meta/routes', async (req, res) => {
  if (!guardReport(req, res, 'meta')) return;
  try {
    const { from, to } = parseRange(req);
    const r = await pool.query(
      `SELECT DISTINCT f.departure_airport, f.arrival_airport,
              f.departure_airport || '→' || f.arrival_airport AS route_label
       FROM flights f
       WHERE DATE(f.departure_time) >= DATE($1::date) AND DATE(f.departure_time) <= DATE($2::date)
       ORDER BY 1, 2
       LIMIT 500`,
      [from, to]
    );
    return res.status(200).json({ from, to, routes: r.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to load routes.' });
  }
});

router.get('/meta/agents', async (req, res) => {
  if (!guardReport(req, res, 'meta')) return;
  if (!canFilterByAgent(req.user.role)) {
    return res.status(403).json({ message: 'Only admin, finance, or sales manager can list agents for filtering.' });
  }
  try {
    const r = await pool.query(
      `SELECT id, full_name, email FROM users WHERE role = 'agent'::user_role AND is_active = TRUE ORDER BY full_name ASC LIMIT 500`
    );
    return res.status(200).json({ agents: r.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load agents.', error: error.message });
  }
});

router.get('/kpis', async (req, res) => {
  if (!guardReport(req, res, 'kpis')) return;
  try {
    const { from, to } = parseRange(req);
    const role = req.user.role;
    const uid = req.user.userId;
    const agent = isAgentOnlySales(role);
    const pBase = [from, to];
    const bScope = agent ? 'AND b.created_by = $3::uuid' : '';
    const pPay = agent ? [...pBase, uid] : pBase;

    const [bookings, payments, checkins, cases] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS c FROM bookings b
         WHERE DATE(b.created_at) >= DATE($1::date) AND DATE(b.created_at) <= DATE($2::date)
         ${bScope}`,
        pPay
      ),
      pool.query(
        `SELECT COALESCE(SUM(p.amount - COALESCE(rf.refunded, 0)), 0)::numeric AS net
         FROM payments p
         JOIN bookings b ON b.id = p.booking_id
         LEFT JOIN (SELECT payment_id, SUM(refund_amount)::numeric AS refunded FROM refunds GROUP BY payment_id) rf ON rf.payment_id = p.id
         WHERE DATE(p.processed_at) >= DATE($1::date) AND DATE(p.processed_at) <= DATE($2::date)
           AND UPPER(TRIM(p.payment_status)) IN ('PAID', 'SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED')
           ${bScope}`,
        pPay
      ),
      canAccessReport(role, 'checkins')
        ? pool.query(
            `SELECT COUNT(*)::int AS c FROM checkins c
             JOIN bookings b ON b.id = c.booking_id
             WHERE DATE(c.checkin_time) >= DATE($1::date) AND DATE(c.checkin_time) <= DATE($2::date)
             ${agent ? 'AND b.created_by = $3::uuid' : ''}`,
            pPay
          )
        : Promise.resolve({ rows: [{ c: null }] }),
      canAccessReport(role, 'customer-service')
        ? pool.query(
            userHasAnyRole(role, ['admin', 'super_admin', 'finance'])
              ? `SELECT COUNT(*)::int AS c FROM cs_service_cases
                 WHERE DATE(created_at) >= DATE($1::date) AND DATE(created_at) <= DATE($2::date)`
              : `SELECT COUNT(*)::int AS c FROM cs_service_cases
                 WHERE DATE(created_at) >= DATE($1::date) AND DATE(created_at) <= DATE($2::date)
                   AND (assigned_to IS NULL OR assigned_to = $3::uuid OR created_by = $3::uuid)`,
            userHasAnyRole(role, ['admin', 'super_admin', 'finance']) ? [from, to] : [from, to, uid]
          )
        : Promise.resolve({ rows: [{ c: null }] })
    ]);

    return res.status(200).json({
      from,
      to,
      kpis: {
        bookingsCreated: bookings.rows[0]?.c ?? 0,
        netPaymentsInPeriod: Number(payments.rows[0]?.net ?? 0),
        checkins: checkins.rows[0]?.c,
        customerServiceCases: cases.rows[0]?.c
      }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed KPIs.' });
  }
});

function applyFlightRouteFilters(req, vals, tableAlias = 'f') {
  const { dep, arr } = parseRouteFilter(req);
  let sql = '';
  if (req.query.flightId && isUuid(String(req.query.flightId))) {
    vals.push(String(req.query.flightId));
    sql += ` AND ${tableAlias}.id = $${vals.length}::uuid`;
  }
  if (dep) {
    vals.push(dep);
    sql += ` AND ${tableAlias}.departure_airport = $${vals.length}`;
  }
  if (arr) {
    vals.push(arr);
    sql += ` AND ${tableAlias}.arrival_airport = $${vals.length}`;
  }
  return sql;
}

router.get('/reports/daily-sales', async (req, res) => {
  if (!guardReport(req, res, 'daily-sales')) return;
  try {
    const { from, to } = parseRange(req);
    const vals = [from, to];
    const ag = agentBookingClause(req.user.role, req.user.userId, vals.length + 1);
    vals.push(...ag.params);
    const csv = String(req.query.format || '').toLowerCase() === 'csv';

    const r = await pool.query(
      `SELECT DATE(p.processed_at)::text AS day,
              COUNT(*)::int AS payment_count,
              COALESCE(SUM(p.amount), 0)::numeric AS gross_collected,
              COALESCE(SUM(COALESCE(rf.refunded, 0)), 0)::numeric AS refunded_on_payments
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       LEFT JOIN (SELECT payment_id, SUM(refund_amount)::numeric AS refunded FROM refunds GROUP BY payment_id) rf ON rf.payment_id = p.id
       WHERE DATE(p.processed_at) >= DATE($1::date) AND DATE(p.processed_at) <= DATE($2::date)
         AND UPPER(TRIM(p.payment_status)) IN ('PAID', 'SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED')
         ${ag.sql}
       GROUP BY DATE(p.processed_at)
       ORDER BY day ASC`,
      vals
    );

    if (csv) {
      return sendCsv(res, `daily-sales-${from}-${to}.csv`, ['day', 'payment_count', 'gross_collected', 'refunded_on_payments'], r.rows.map((x) => [x.day, x.payment_count, x.gross_collected, x.refunded_on_payments]));
    }
    return res.status(200).json({ from, to, series: r.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed daily sales report.' });
  }
});

router.get('/reports/bookings', async (req, res) => {
  if (!guardReport(req, res, 'bookings')) return;
  try {
    const { from, to } = parseRange(req);
    const vals = [from, to];
    let sqlExtra = '';
    const ag = agentBookingClause(req.user.role, req.user.userId, vals.length + 1);
    vals.push(...ag.params);
    sqlExtra += ag.sql;

    if (canFilterByAgent(req.user.role) && req.query.agentId && isUuid(String(req.query.agentId))) {
      vals.push(String(req.query.agentId));
      sqlExtra += ` AND b.created_by = $${vals.length}::uuid`;
    }

    if (req.query.flightId && isUuid(String(req.query.flightId))) {
      vals.push(String(req.query.flightId));
      sqlExtra += ` AND EXISTS (SELECT 1 FROM booking_flights bf WHERE bf.booking_id = b.id AND bf.flight_id = $${vals.length}::uuid)`;
    }
    const { dep, arr } = parseRouteFilter(req);
    if (dep && arr) {
      vals.push(dep, arr);
      sqlExtra += ` AND EXISTS (
        SELECT 1 FROM booking_flights bf2
        JOIN flights f2 ON f2.id = bf2.flight_id
        WHERE bf2.booking_id = b.id AND f2.departure_airport = $${vals.length - 1} AND f2.arrival_airport = $${vals.length}
      )`;
    }

    const r = await pool.query(
      `SELECT b.id, b.pnr, b.booking_status, b.payment_status, b.total_amount, b.currency, b.created_at,
              u.full_name AS agent_name,
              (SELECT COUNT(*)::int FROM booking_passengers bp WHERE bp.booking_id = b.id) AS passenger_count
       FROM bookings b
       LEFT JOIN users u ON u.id = b.created_by
       WHERE DATE(b.created_at) >= DATE($1::date) AND DATE(b.created_at) <= DATE($2::date)
       ${sqlExtra}
       ORDER BY b.created_at DESC
       LIMIT 5000`,
      vals
    );

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      return sendCsv(
        res,
        `bookings-${from}-${to}.csv`,
        ['id', 'pnr', 'booking_status', 'payment_status', 'total_amount', 'currency', 'created_at', 'agent_name', 'passenger_count'],
        r.rows.map((x) => [
          x.id,
          x.pnr,
          x.booking_status,
          x.payment_status,
          x.total_amount,
          x.currency,
          x.created_at,
          x.agent_name,
          x.passenger_count
        ])
      );
    }
    return res.status(200).json({ from, to, bookings: r.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed booking report.' });
  }
});

router.get('/reports/tickets', async (req, res) => {
  if (!guardReport(req, res, 'tickets')) return;
  try {
    const { from, to } = parseRange(req);
    const vals = [from, to];
    const ag = agentBookingClause(req.user.role, req.user.userId, vals.length + 1);
    vals.push(...ag.params);
    let extra = ag.sql;

    if (canFilterByAgent(req.user.role) && req.query.agentId && isUuid(String(req.query.agentId))) {
      vals.push(String(req.query.agentId));
      extra += ` AND b.created_by = $${vals.length}::uuid`;
    }
    if (req.query.flightId && isUuid(String(req.query.flightId))) {
      vals.push(String(req.query.flightId));
      extra += ` AND EXISTS (SELECT 1 FROM booking_flights bf WHERE bf.booking_id = b.id AND bf.flight_id = $${vals.length}::uuid)`;
    }

    const r = await pool.query(
      `SELECT t.id, t.ticket_number, t.ticket_status, t.issued_at,
              b.pnr, b.id AS booking_id,
              p.first_name, p.last_name, p.id AS passenger_id,
              u.full_name AS issued_by_name
       FROM tickets t
       JOIN bookings b ON b.id = t.booking_id
       JOIN passengers p ON p.id = t.passenger_id
       LEFT JOIN users u ON u.id = t.issued_by
       WHERE DATE(t.issued_at) >= DATE($1::date) AND DATE(t.issued_at) <= DATE($2::date)
       ${extra}
       ORDER BY t.issued_at DESC
       LIMIT 5000`,
      vals
    );

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      return sendCsv(
        res,
        `tickets-${from}-${to}.csv`,
        ['ticket_number', 'ticket_status', 'issued_at', 'pnr', 'first_name', 'last_name', 'issued_by_name'],
        r.rows.map((x) => [x.ticket_number, x.ticket_status, x.issued_at, x.pnr, x.first_name, x.last_name, x.issued_by_name])
      );
    }
    return res.status(200).json({ from, to, tickets: r.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed ticket report.' });
  }
});

router.get('/reports/passengers', async (req, res) => {
  if (!guardReport(req, res, 'passengers')) return;
  try {
    const { from, to } = parseRange(req);
    const vals = [from, to];
    const ag = agentBookingClause(req.user.role, req.user.userId, vals.length + 1);
    vals.push(...ag.params);

    const r = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, p.email, p.phone, p.nationality, p.created_at AS passenger_created_at,
              COUNT(DISTINCT bp.booking_id)::int AS booking_count,
              MAX(b.created_at) AS last_booking_at
       FROM passengers p
       JOIN booking_passengers bp ON bp.passenger_id = p.id
       JOIN bookings b ON b.id = bp.booking_id
       WHERE DATE(b.created_at) >= DATE($1::date) AND DATE(b.created_at) <= DATE($2::date)
       ${ag.sql}
       GROUP BY p.id, p.first_name, p.last_name, p.email, p.phone, p.nationality, p.created_at
       ORDER BY last_booking_at DESC NULLS LAST
       LIMIT 5000`,
      vals
    );

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      return sendCsv(
        res,
        `passengers-${from}-${to}.csv`,
        ['id', 'first_name', 'last_name', 'email', 'booking_count', 'last_booking_at'],
        r.rows.map((x) => [x.id, x.first_name, x.last_name, x.email, x.booking_count, x.last_booking_at])
      );
    }
    return res.status(200).json({ from, to, passengers: r.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed passenger report.' });
  }
});

router.get('/reports/revenue', async (req, res) => {
  if (!guardReport(req, res, 'revenue')) return;
  try {
    const { from, to } = parseRange(req);
    const vals = [from, to];
    const ag = agentBookingClause(req.user.role, req.user.userId, vals.length + 1);
    vals.push(...ag.params);

    const series = await pool.query(
      `SELECT DATE(p.processed_at)::text AS day,
              COALESCE(SUM(p.amount - COALESCE(rf.refunded, 0)), 0)::numeric AS net_collected,
              COUNT(*)::int AS payment_rows
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       LEFT JOIN (SELECT payment_id, SUM(refund_amount)::numeric AS refunded FROM refunds GROUP BY payment_id) rf ON rf.payment_id = p.id
       WHERE DATE(p.processed_at) >= DATE($1::date) AND DATE(p.processed_at) <= DATE($2::date)
         AND UPPER(TRIM(p.payment_status)) IN ('PAID', 'SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED')
         ${ag.sql}
       GROUP BY DATE(p.processed_at)
       ORDER BY day ASC`,
      vals
    );

    const bookedVals = [from, to];
    const agBook = agentBookingClause(req.user.role, req.user.userId, bookedVals.length + 1);
    bookedVals.push(...agBook.params);
    const booked = await pool.query(
      `SELECT COALESCE(SUM(bf.fare_amount), 0)::numeric AS itinerary_fare_booked
       FROM booking_flights bf
       JOIN bookings b ON b.id = bf.booking_id
       WHERE DATE(b.created_at) >= DATE($1::date) AND DATE(b.created_at) <= DATE($2::date)
         AND UPPER(TRIM(COALESCE(b.booking_status, ''))) <> 'CANCELLED'
         ${agBook.sql}`,
      bookedVals
    );

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      return sendCsv(res, `revenue-${from}-${to}.csv`, ['day', 'net_collected', 'payment_rows'], series.rows.map((x) => [x.day, x.net_collected, x.payment_rows]));
    }

    return res.status(200).json({
      from,
      to,
      summary: {
        itineraryFareBookingsCreatedInRange: Number(booked.rows[0]?.itinerary_fare_booked ?? 0),
        note: 'Net collected uses payment processing date; itinerary fare uses booking created date in the same window.'
      },
      series: series.rows
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed revenue report.' });
  }
});

router.get('/reports/agent-sales', async (req, res) => {
  if (!guardReport(req, res, 'agent-sales')) return;
  try {
    const { from, to } = parseRange(req);
    const vals = [from, to];
    let extra = '';
    if (isAgentOnlySales(req.user.role)) {
      vals.push(req.user.userId);
      extra = `AND b.created_by = $${vals.length}::uuid`;
    } else if (canFilterByAgent(req.user.role) && req.query.agentId && isUuid(String(req.query.agentId))) {
      vals.push(String(req.query.agentId));
      extra = `AND b.created_by = $${vals.length}::uuid`;
    }

    const r = await pool.query(
      `SELECT b.created_by AS agent_id, u.full_name AS agent_name,
              COUNT(DISTINCT b.id)::int AS booking_count,
              COALESCE(SUM(b.total_amount), 0)::numeric AS booked_gross,
              COALESCE(SUM(
                (SELECT COALESCE(SUM(p.amount - COALESCE(rf.refunded,0)),0) FROM payments p
                 LEFT JOIN (SELECT payment_id, SUM(refund_amount)::numeric refunded FROM refunds GROUP BY payment_id) rf ON rf.payment_id = p.id
                 WHERE p.booking_id = b.id AND UPPER(TRIM(p.payment_status)) NOT IN ('PENDING','FAILED'))
              ), 0)::numeric AS net_payments
       FROM bookings b
       JOIN users u ON u.id = b.created_by
       WHERE DATE(b.created_at) >= DATE($1::date) AND DATE(b.created_at) <= DATE($2::date)
         AND u.role = 'agent'::user_role
         ${extra}
       GROUP BY b.created_by, u.full_name
       ORDER BY booked_gross DESC NULLS LAST`,
      vals
    );

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      return sendCsv(
        res,
        `agent-sales-${from}-${to}.csv`,
        ['agent_name', 'booking_count', 'booked_gross', 'net_payments'],
        r.rows.map((x) => [x.agent_name, x.booking_count, x.booked_gross, x.net_payments])
      );
    }
    return res.status(200).json({ from, to, agentSales: r.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed agent sales report.' });
  }
});

router.get('/reports/refunds', async (req, res) => {
  if (!guardReport(req, res, 'refunds')) return;
  try {
    const { from, to } = parseRange(req);
    const vals = [from, to];
    const ag = agentBookingClause(req.user.role, req.user.userId, vals.length + 1);
    vals.push(...ag.params);

    const r = await pool.query(
      `SELECT r.id, r.refund_amount, r.refunded_at, r.payment_id, p.booking_id, b.pnr,
              u.full_name AS processed_context
       FROM refunds r
       JOIN payments p ON p.id = r.payment_id
       JOIN bookings b ON b.id = p.booking_id
       LEFT JOIN users u ON u.id = b.created_by
       WHERE DATE(r.refunded_at) >= DATE($1::date) AND DATE(r.refunded_at) <= DATE($2::date)
       ${ag.sql}
       ORDER BY r.refunded_at DESC
       LIMIT 5000`,
      vals
    );

    const pending = userHasAnyRole(req.user.role, ['admin', 'super_admin', 'finance'])
      ? await pool.query(
          `SELECT rr.id, rr.amount, rr.status, rr.created_at, rr.payment_id, p.booking_id, b.pnr
           FROM refund_requests rr
           JOIN payments p ON p.id = rr.payment_id
           JOIN bookings b ON b.id = p.booking_id
           WHERE rr.status = 'PENDING' AND DATE(rr.created_at) >= DATE($1::date) AND DATE(rr.created_at) <= DATE($2::date)
           ${ag.sql}`,
          vals
        )
      : { rows: [] };

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      return sendCsv(
        res,
        `refunds-${from}-${to}.csv`,
        ['refund_amount', 'refunded_at', 'pnr', 'booking_id'],
        r.rows.map((x) => [x.refund_amount, x.refunded_at, x.pnr, x.booking_id])
      );
    }
    return res.status(200).json({ from, to, refunds: r.rows, pendingRefundRequests: pending.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed refund report.' });
  }
});

router.get('/reports/expenses', async (req, res) => {
  if (!guardReport(req, res, 'expenses')) return;
  try {
    const { from, to } = parseRange(req);
    const vals = [from, to];
    let extra = '';
    if (req.query.flightId && isUuid(String(req.query.flightId))) {
      vals.push(String(req.query.flightId));
      extra = ` AND e.flight_id = $${vals.length}::uuid`;
    }

    const r = await pool.query(
      `SELECT e.id, e.category, e.amount, e.currency, e.incurred_on, e.description, e.reference, e.flight_id,
              f.flight_number, u.full_name AS entered_by_name
       FROM finance_expenses e
       LEFT JOIN flights f ON f.id = e.flight_id
       JOIN users u ON u.id = e.entered_by
       WHERE e.incurred_on >= DATE($1::date) AND e.incurred_on <= DATE($2::date)
       ${extra}
       ORDER BY e.incurred_on DESC, e.created_at DESC
       LIMIT 5000`,
      vals
    );

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      return sendCsv(
        res,
        `expenses-${from}-${to}.csv`,
        ['incurred_on', 'category', 'amount', 'currency', 'description', 'flight_number'],
        r.rows.map((x) => [x.incurred_on, x.category, x.amount, x.currency, x.description, x.flight_number])
      );
    }
    return res.status(200).json({ from, to, expenses: r.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed expense report.' });
  }
});

router.get('/reports/checkins', async (req, res) => {
  if (!guardReport(req, res, 'checkins')) return;
  try {
    const { from, to } = parseRange(req);
    const vals = [from, to];
    let extra = '';
    const ag = agentBookingClause(req.user.role, req.user.userId, vals.length + 1);
    vals.push(...ag.params);
    extra += ag.sql;

    if (req.query.flightId && isUuid(String(req.query.flightId))) {
      vals.push(String(req.query.flightId));
      extra += ` AND c.flight_id = $${vals.length}::uuid`;
    }
    if (canFilterByAgent(req.user.role) && req.query.agentId && isUuid(String(req.query.agentId))) {
      vals.push(String(req.query.agentId));
      extra += ` AND b.created_by = $${vals.length}::uuid`;
    }

    const r = await pool.query(
      `SELECT c.id, c.checkin_time, c.seat_number, c.boarding_pass_no, c.boarding_status,
              c.checkin_status, c.boarded_at, c.boarding_gate,
              b.pnr, f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time,
              p.first_name, p.last_name
       FROM checkins c
       JOIN bookings b ON b.id = c.booking_id
       JOIN flights f ON f.id = c.flight_id
       JOIN passengers p ON p.id = c.passenger_id
       WHERE DATE(c.checkin_time) >= DATE($1::date) AND DATE(c.checkin_time) <= DATE($2::date)
       ${extra}
       ORDER BY c.checkin_time DESC
       LIMIT 5000`,
      vals
    );

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      return sendCsv(
        res,
        `checkins-${from}-${to}.csv`,
        [
          'checkin_time',
          'pnr',
          'flight_number',
          'seat_number',
          'boarding_status',
          'checkin_status',
          'boarded_at',
          'boarding_gate',
          'first_name',
          'last_name'
        ],
        r.rows.map((x) => [
          x.checkin_time,
          x.pnr,
          x.flight_number,
          x.seat_number,
          x.boarding_status,
          x.checkin_status,
          x.boarded_at,
          x.boarding_gate,
          x.first_name,
          x.last_name
        ])
      );
    }
    return res.status(200).json({ from, to, checkins: r.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed check-in report.' });
  }
});

router.get('/reports/flight-performance', async (req, res) => {
  if (!guardReport(req, res, 'flight-performance')) return;
  try {
    const { from, to } = parseRange(req);
    const vals = [from, to];
    let fr = applyFlightRouteFilters(req, vals, 'f');

    const r = await pool.query(
      `SELECT f.id AS flight_id, f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time, f.arrival_time, f.status,
              ac.tail_number,
              (SELECT COUNT(DISTINCT bf2.booking_id)::int FROM booking_flights bf2
               JOIN bookings b2 ON b2.id = bf2.booking_id
               WHERE bf2.flight_id = f.id
                 AND UPPER(TRIM(COALESCE(b2.booking_status, ''))) <> 'CANCELLED') AS booking_count,
              (SELECT COUNT(DISTINCT t.id)::int FROM tickets t
               JOIN booking_flights bfx ON bfx.booking_id = t.booking_id AND bfx.flight_id = f.id) AS tickets_on_leg,
              (SELECT COUNT(*)::int FROM checkins c2 WHERE c2.flight_id = f.id) AS checkin_count,
              (SELECT COALESCE(SUM(bf3.fare_amount), 0)::numeric FROM booking_flights bf3
               JOIN bookings b3 ON b3.id = bf3.booking_id
               WHERE bf3.flight_id = f.id
                 AND UPPER(TRIM(COALESCE(b3.booking_status, ''))) <> 'CANCELLED') AS itinerary_fare_sum
       FROM flights f
       LEFT JOIN aircraft ac ON ac.id = f.aircraft_id
       WHERE DATE(f.departure_time) >= DATE($1::date) AND DATE(f.departure_time) <= DATE($2::date)
       ${fr}
       ORDER BY f.departure_time ASC
       LIMIT 2000`,
      vals
    );

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      return sendCsv(
        res,
        `flight-performance-${from}-${to}.csv`,
        [
          'flight_number',
          'route',
          'departure_time',
          'booking_count',
          'tickets_on_leg',
          'checkin_count',
          'itinerary_fare_sum'
        ],
        r.rows.map((x) => [
          x.flight_number,
          `${x.departure_airport}→${x.arrival_airport}`,
          x.departure_time,
          x.booking_count,
          x.tickets_on_leg,
          x.checkin_count,
          x.itinerary_fare_sum
        ])
      );
    }
    return res.status(200).json({ from, to, flights: r.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed flight performance report.' });
  }
});

router.get('/reports/route-performance', async (req, res) => {
  if (!guardReport(req, res, 'route-performance')) return;
  try {
    const { from, to } = parseRange(req);
    const vals = [from, to];
    const { dep, arr } = parseRouteFilter(req);
    let routeSql = '';
    if (dep) {
      vals.push(dep);
      routeSql += ` AND f.departure_airport = $${vals.length}`;
    }
    if (arr) {
      vals.push(arr);
      routeSql += ` AND f.arrival_airport = $${vals.length}`;
    }

    const r = await pool.query(
      `SELECT f.departure_airport, f.arrival_airport,
              f.departure_airport || '→' || f.arrival_airport AS route_label,
              COUNT(DISTINCT f.id)::int AS flight_count,
              COUNT(DISTINCT bf.booking_id) FILTER (
                WHERE UPPER(TRIM(COALESCE(b.booking_status, ''))) <> 'CANCELLED'
              )::int AS booking_leg_count,
              COUNT(DISTINCT c.id)::int AS checkin_count,
              COALESCE(SUM(bf.fare_amount) FILTER (
                WHERE UPPER(TRIM(COALESCE(b.booking_status, ''))) <> 'CANCELLED'
              ), 0)::numeric AS itinerary_fare_sum
       FROM flights f
       LEFT JOIN booking_flights bf ON bf.flight_id = f.id
       LEFT JOIN bookings b ON b.id = bf.booking_id
       LEFT JOIN checkins c ON c.flight_id = f.id
       WHERE DATE(f.departure_time) >= DATE($1::date) AND DATE(f.departure_time) <= DATE($2::date)
       ${routeSql}
       GROUP BY f.departure_airport, f.arrival_airport
       ORDER BY itinerary_fare_sum DESC NULLS LAST
       LIMIT 500`,
      vals
    );

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      return sendCsv(
        res,
        `route-performance-${from}-${to}.csv`,
        ['route_label', 'flight_count', 'booking_leg_count', 'checkin_count', 'itinerary_fare_sum'],
        r.rows.map((x) => [x.route_label, x.flight_count, x.booking_leg_count, x.checkin_count, x.itinerary_fare_sum])
      );
    }
    return res.status(200).json({ from, to, routes: r.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed route performance report.' });
  }
});

router.get('/reports/crew-utilization', async (req, res) => {
  if (!guardReport(req, res, 'crew-utilization')) return;
  try {
    const { from, to } = parseRange(req);
    const r = await pool.query(
      `SELECT u.id AS crew_user_id, u.full_name,
              COUNT(ca.id)::int AS duty_assignments,
              COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (f.arrival_time - f.departure_time)) / 3600, 0)), 0)::numeric AS block_hours_approx
       FROM crew_assignments ca
       JOIN flights f ON f.id = ca.flight_id
       JOIN users u ON u.id = ca.crew_user_id
       WHERE DATE(f.departure_time) >= DATE($1::date) AND DATE(f.departure_time) <= DATE($2::date)
       GROUP BY u.id, u.full_name
       ORDER BY block_hours_approx DESC NULLS LAST
       LIMIT 500`,
      [from, to]
    );

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      return sendCsv(
        res,
        `crew-utilization-${from}-${to}.csv`,
        ['full_name', 'duty_assignments', 'block_hours_approx'],
        r.rows.map((x) => [x.full_name, x.duty_assignments, x.block_hours_approx])
      );
    }
    return res.status(200).json({ from, to, crew: r.rows, note: 'Block hours are flight arrival minus departure per assignment (approximate).' });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed crew utilization report.' });
  }
});

router.get('/reports/aircraft-utilization', async (req, res) => {
  if (!guardReport(req, res, 'aircraft-utilization')) return;
  try {
    const { from, to } = parseRange(req);
    const r = await pool.query(
      `SELECT ac.id, ac.tail_number, ac.model,
              COUNT(f.id)::int AS flight_legs,
              COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (f.arrival_time - f.departure_time)) / 3600, 0)), 0)::numeric AS block_hours_approx
       FROM aircraft ac
       LEFT JOIN flights f ON f.aircraft_id = ac.id
         AND DATE(f.departure_time) >= DATE($1::date) AND DATE(f.departure_time) <= DATE($2::date)
       GROUP BY ac.id, ac.tail_number, ac.model
       ORDER BY block_hours_approx DESC NULLS LAST`,
      [from, to]
    );

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      return sendCsv(
        res,
        `aircraft-utilization-${from}-${to}.csv`,
        ['tail_number', 'model', 'flight_legs', 'block_hours_approx'],
        r.rows.map((x) => [x.tail_number, x.model, x.flight_legs, x.block_hours_approx])
      );
    }
    return res.status(200).json({ from, to, aircraft: r.rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed aircraft utilization report.' });
  }
});

router.get('/reports/customer-service', async (req, res) => {
  if (!guardReport(req, res, 'customer-service')) return;
  try {
    const { from, to } = parseRange(req);
    const vals = [from, to];
    let scope = '';
    if (!userHasAnyRole(req.user.role, ['admin', 'super_admin', 'finance'])) {
      vals.push(req.user.userId);
      scope = `AND (c.assigned_to IS NULL OR c.assigned_to = $3::uuid OR c.created_by = $3::uuid)`;
    }

    const byType = await pool.query(
      `SELECT c.case_type, COUNT(*)::int AS cnt
       FROM cs_service_cases c
       WHERE DATE(c.created_at) >= DATE($1::date) AND DATE(c.created_at) <= DATE($2::date)
       ${scope}
       GROUP BY c.case_type
       ORDER BY cnt DESC`,
      vals
    );
    const byStatus = await pool.query(
      `SELECT c.status, COUNT(*)::int AS cnt
       FROM cs_service_cases c
       WHERE DATE(c.created_at) >= DATE($1::date) AND DATE(c.created_at) <= DATE($2::date)
       ${scope}
       GROUP BY c.status
       ORDER BY cnt DESC`,
      vals
    );
    const linkedRefunds = await pool.query(
      `SELECT COUNT(*)::int AS cnt
       FROM cs_service_cases c
       WHERE DATE(c.created_at) >= DATE($1::date) AND DATE(c.created_at) <= DATE($2::date)
         AND c.refund_request_id IS NOT NULL
       ${scope}`,
      vals
    );

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      const rows = byType.rows.map((x) => ['by_type', x.case_type, x.cnt]);
      byStatus.rows.forEach((x) => rows.push(['by_status', x.status, x.cnt]));
      return sendCsv(res, `customer-service-${from}-${to}.csv`, ['bucket', 'key', 'count'], rows);
    }

    return res.status(200).json({
      from,
      to,
      byType: byType.rows,
      byStatus: byStatus.rows,
      casesWithFinanceRefundLink: linkedRefunds.rows[0]?.cnt ?? 0
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed customer service report.' });
  }
});

export default router;
