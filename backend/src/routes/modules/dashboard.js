import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.js';
import { userHasAnyRole } from '../../lib/roles.js';

const router = express.Router();

/** Safe row extractors for Promise.allSettled — avoids 500 when one table/column is missing. */
function rowCountFromSettled(settled, idx, scope) {
  const r = settled[idx];
  if (r.status === 'fulfilled' && r.value?.rows?.[0] && r.value.rows[0].count != null) {
    return Number(r.value.rows[0].count);
  }
  if (r.status === 'rejected') {
    console.warn(`[dashboard/${scope}] query[${idx}]:`, r.reason?.message || r.reason);
  }
  return 0;
}

function rowValueFromSettled(settled, idx, scope) {
  const r = settled[idx];
  if (r.status === 'fulfilled' && r.value?.rows?.[0] && r.value.rows[0].value != null) {
    return Number(r.value.rows[0].value);
  }
  if (r.status === 'rejected') {
    console.warn(`[dashboard/${scope}] query[${idx}]:`, r.reason?.message || r.reason);
  }
  return 0;
}

function canAccessRole(requesterRole, targetRole) {
  if (requesterRole === 'super_admin') return true;
  if (requesterRole === 'admin') return true;
  if (requesterRole === 'customer_service' && targetRole === 'customer_service') return true;
  if (requesterRole === 'sales_manager' && targetRole === 'sales_manager') return true;
  return requesterRole === targetRole;
}

function quickLinksForRole(role) {
  const all = [
    { label: 'New booking', href: '/booking' },
    { label: 'PNR & tickets', href: '/bookings' },
    { label: 'Check-in desk', href: '/checkin' },
    { label: 'Flight schedule', href: '/flights' },
    { label: 'Operations control', href: '/operations' },
    { label: 'Crew roster', href: '/crew' },
    { label: 'Payments', href: '/finance' },
    { label: 'Record expense', href: '/add-expense' },
    { label: 'Sales & campaigns', href: '/sales' },
    { label: 'Passenger CRM', href: '/customers' },
    { label: 'Support inbox', href: '/customer-service' },
    { label: 'Reports', href: '/reports' },
    { label: 'Analytics', href: '/reports-analytics' },
    { label: 'Master data', href: '/settings' },
    { label: 'System settings', href: '/system-settings' },
    { label: 'Administration', href: '/system-administration' },
    { label: 'Aircraft & MX', href: '/maintenance' },
    { label: 'User admin', href: '/admin' },
    { label: 'Workspace settings', href: '/workspace-settings' }
  ];
  if (role === 'super_admin' || role === 'admin') return all;
  if (role === 'finance') {
    return all.filter((l) => ['/finance', '/add-expense', '/reports', '/reports-analytics'].includes(l.href));
  }
  if (role === 'operations') {
    return all.filter((l) =>
      ['/checkin', '/flights', '/operations', '/crew', '/maintenance', '/reports', '/reports-analytics'].includes(l.href)
    );
  }
  if (role === 'agent') {
    return all.filter((l) =>
      [
        '/booking',
        '/bookings',
        '/checkin',
        '/customers',
        '/customer-service',
        '/sales',
        '/sales-marketing',
        '/reports',
        '/reports-analytics'
      ].includes(l.href)
    );
  }
  if (role === 'crew') {
    return [
      { label: 'Alerts & notices', href: '/notifications' },
      { label: 'Workspace settings', href: '/workspace-settings' }
    ];
  }
  if (role === 'maintenance') {
    return all.filter((l) => ['/maintenance', '/flights', '/reports'].includes(l.href));
  }
  if (role === 'customer_service') {
    return all.filter((l) =>
      ['/booking', '/bookings', '/checkin', '/customers', '/customer-service', '/reports', '/reports-analytics'].includes(l.href)
    );
  }
  if (role === 'sales_manager') {
    return all.filter((l) =>
      ['/booking', '/bookings', '/checkin', '/sales', '/customers', '/reports', '/reports-analytics'].includes(l.href)
    );
  }
  return [];
}

/** Full ERP dashboard payload derived from live database rows. */
router.get('/summary', requireAuth, async (req, res) => {
  const role = req.user.role;
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0, 10);

  const include = {
    flights: userHasAnyRole(role, ['admin', 'operations', 'maintenance', 'agent', 'crew', 'customer_service', 'sales_manager']),
    operational: userHasAnyRole(role, ['admin', 'operations', 'maintenance']),
    checkin: userHasAnyRole(role, ['admin', 'operations', 'agent', 'customer_service', 'sales_manager']),
    crewRoster: userHasAnyRole(role, ['admin', 'operations']),
    finance: userHasAnyRole(role, ['admin', 'finance', 'sales_manager']),
    revenueChart: userHasAnyRole(role, ['admin', 'finance', 'sales_manager']),
    bookingPulse: userHasAnyRole(role, ['admin', 'agent', 'customer_service', 'sales_manager']),
    alerts: true
  };

  try {
    const settled = await Promise.allSettled([
      include.flights || include.operational
        ? pool.query(
            `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport,
                f.departure_time, f.arrival_time, f.status,
                a.tail_number, a.model
             FROM flights f
             LEFT JOIN aircraft a ON a.id = f.aircraft_id
             WHERE DATE(f.departure_time) = DATE($1::date)
             ORDER BY f.departure_time ASC
             LIMIT 40`,
            [today]
          )
        : Promise.resolve({ rows: [] }),
      include.operational
        ? pool.query(
            `SELECT UPPER(TRIM(status)) AS status, COUNT(*)::int AS count
             FROM flights
             WHERE DATE(departure_time) = DATE($1::date)
             GROUP BY UPPER(TRIM(status))`,
            [today]
          )
        : Promise.resolve({ rows: [] }),
      include.checkin
        ? pool.query(
            `SELECT COUNT(*)::int AS c
             FROM booking_passengers bp
             JOIN booking_flights bf ON bf.booking_id = bp.booking_id
             JOIN flights f ON f.id = bf.flight_id
             WHERE DATE(f.departure_time) = DATE($1::date)`,
            [today]
          )
        : Promise.resolve({ rows: [{ c: 0 }] }),
      include.checkin
        ? pool.query(
            `SELECT COUNT(*)::int AS c
             FROM checkins c
             JOIN flights f ON f.id = c.flight_id
             WHERE DATE(f.departure_time) = DATE($1::date)`,
            [today]
          )
        : Promise.resolve({ rows: [{ c: 0 }] }),
      include.crewRoster
        ? pool.query(
            `SELECT f.flight_number, f.departure_time, u.full_name, ca.duty_role
             FROM crew_assignments ca
             JOIN flights f ON f.id = ca.flight_id
             JOIN users u ON u.id = ca.crew_user_id
             WHERE DATE(f.departure_time) = DATE($1::date)
             ORDER BY f.departure_time ASC, u.full_name ASC
             LIMIT 40`,
            [today]
          )
        : Promise.resolve({ rows: [] }),
      include.finance || userHasAnyRole(role, ['admin'])
        ? pool.query(
            `SELECT COALESCE(SUM(amount), 0)::float AS v
             FROM payments
             WHERE DATE(processed_at) = DATE($1::date)
               AND UPPER(COALESCE(payment_status, '')) NOT IN ('FAILED', 'DECLINED')`,
            [today]
          )
        : Promise.resolve({ rows: [{ v: 0 }] }),
      include.finance || userHasAnyRole(role, ['admin'])
        ? pool.query(
            `SELECT COALESCE(SUM(refund_amount), 0)::float AS v FROM refunds WHERE DATE(refunded_at) = DATE($1::date)`,
            [today]
          )
        : Promise.resolve({ rows: [{ v: 0 }] }),
      include.bookingPulse || userHasAnyRole(role, ['admin'])
        ? pool.query(`SELECT COUNT(*)::int AS c FROM bookings WHERE DATE(created_at) = DATE($1::date)`, [today])
        : Promise.resolve({ rows: [{ c: 0 }] }),
      include.bookingPulse || userHasAnyRole(role, ['admin'])
        ? pool.query(`SELECT COUNT(*)::int AS c FROM tickets WHERE DATE(issued_at) = DATE($1::date)`, [today])
        : Promise.resolve({ rows: [{ c: 0 }] }),
      include.bookingPulse || userHasAnyRole(role, ['admin'])
        ? pool.query(`SELECT COUNT(*)::int AS c FROM checkins WHERE DATE(checkin_time) = DATE($1::date)`, [today])
        : Promise.resolve({ rows: [{ c: 0 }] }),
      userHasAnyRole(role, ['admin'])
        ? pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE is_active = TRUE`)
        : Promise.resolve({ rows: [{ c: 0 }] }),
      userHasAnyRole(role, ['admin']) || role === 'maintenance' || role === 'operations'
        ? pool.query(`SELECT COUNT(*)::int AS c FROM maintenance_logs WHERE status = 'OPEN'`)
        : Promise.resolve({ rows: [{ c: 0 }] }),
      include.finance || userHasAnyRole(role, ['admin'])
        ? pool.query(
            `SELECT COALESCE(SUM(amount), 0)::float AS v
             FROM payments
             WHERE DATE_TRUNC('month', processed_at) = DATE_TRUNC('month', DATE($1::date)::timestamp)
               AND UPPER(COALESCE(payment_status, '')) NOT IN ('FAILED', 'DECLINED')`,
            [today]
          )
        : Promise.resolve({ rows: [{ v: 0 }] }),
      include.finance || userHasAnyRole(role, ['admin'])
        ? pool.query(
            `SELECT COALESCE(SUM(refund_amount), 0)::float AS v
             FROM refunds
             WHERE DATE_TRUNC('month', refunded_at) = DATE_TRUNC('month', DATE($1::date)::timestamp)`,
            [today]
          )
        : Promise.resolve({ rows: [{ v: 0 }] }),
      include.finance || userHasAnyRole(role, ['admin'])
        ? pool.query(
            `SELECT COALESCE(SUM(total_amount), 0)::float AS v
             FROM bookings
             WHERE UPPER(booking_status) IN ('HOLD', 'PENDING')`
          )
        : Promise.resolve({ rows: [{ v: 0 }] }),
      include.revenueChart
        ? pool.query(
            `SELECT DATE(processed_at)::text AS d, COALESCE(SUM(amount), 0)::float AS amount
             FROM payments
             WHERE processed_at::date >= (DATE($1::date) - INTERVAL '6 days')
               AND processed_at::date <= DATE($1::date)
               AND UPPER(COALESCE(payment_status, '')) NOT IN ('FAILED', 'DECLINED')
             GROUP BY DATE(processed_at)
             ORDER BY d ASC`,
            [today]
          )
        : Promise.resolve({ rows: [] }),
      include.revenueChart
        ? pool.query(
            `SELECT payment_type, COALESCE(SUM(amount), 0)::float AS total
             FROM payments
             WHERE processed_at::date >= (DATE($1::date) - INTERVAL '6 days')
               AND processed_at::date <= DATE($1::date)
               AND UPPER(COALESCE(payment_status, '')) NOT IN ('FAILED', 'DECLINED')
             GROUP BY payment_type`,
            [today]
          )
        : Promise.resolve({ rows: [] }),
      include.alerts
        ? pool.query(
            `SELECT f.flight_number, f.departure_airport, f.arrival_airport, fd.delay_minutes, fd.reason, fd.created_at
             FROM flight_delays fd
             JOIN flights f ON f.id = fd.flight_id
             WHERE DATE(f.departure_time) = DATE($1::date)
             ORDER BY fd.created_at DESC
             LIMIT 8`,
            [today]
          )
        : Promise.resolve({ rows: [] }),
      include.alerts
        ? pool.query(
            `SELECT ml.id, ml.defect_description, ml.severity, a.tail_number, ml.opened_at
             FROM maintenance_logs ml
             JOIN aircraft a ON a.id = ml.aircraft_id
             WHERE ml.status = 'OPEN'
             ORDER BY ml.opened_at DESC
             LIMIT 6`
          )
        : Promise.resolve({ rows: [] }),
      include.alerts
        ? pool.query(
            `SELECT tail_number, model, release_status FROM aircraft WHERE UPPER(release_status) <> 'RELEASED' LIMIT 6`
          )
        : Promise.resolve({ rows: [] }),
      include.alerts
        ? pool.query(
            `SELECT mi.id, mi.inspection_type, mi.scheduled_for, a.tail_number
             FROM maintenance_inspections mi
             JOIN aircraft a ON a.id = mi.aircraft_id
             WHERE DATE(mi.scheduled_for) = DATE($1::date) AND mi.status = 'SCHEDULED'
             LIMIT 6`,
            [today]
          )
        : Promise.resolve({ rows: [] }),
      role === 'maintenance' || userHasAnyRole(role, ['admin']) || role === 'operations'
        ? pool.query(
            `SELECT COUNT(*)::int AS c
             FROM maintenance_inspections
             WHERE DATE(scheduled_for) = DATE($1::date) AND status = 'SCHEDULED'`,
            [today]
          )
        : Promise.resolve({ rows: [{ c: 0 }] }),
      role === 'maintenance' || userHasAnyRole(role, ['admin']) || role === 'operations'
        ? pool.query(`SELECT COUNT(*)::int AS c FROM aircraft WHERE UPPER(release_status) <> 'RELEASED'`)
        : Promise.resolve({ rows: [{ c: 0 }] }),
      userHasAnyRole(role, ['admin', 'agent', 'customer_service', 'sales_manager'])
        ? pool.query(
            `SELECT COUNT(*)::int AS c FROM bookings WHERE UPPER(booking_status) IN ('HOLD', 'PENDING')`
          )
        : Promise.resolve({ rows: [{ c: 0 }] }),
      role === 'crew'
        ? pool.query(
            `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport,
                f.departure_time, f.status, ca.duty_role
             FROM crew_assignments ca
             JOIN flights f ON f.id = ca.flight_id
             WHERE ca.crew_user_id = $1 AND DATE(f.departure_time) = DATE($2::date)
             ORDER BY f.departure_time ASC`,
            [userId, today]
          )
        : Promise.resolve({ rows: [] })
    ]);

    const empty = { rows: [] };
    const q = (idx) => {
      const r = settled[idx];
      if (r.status === 'fulfilled') return r.value;
      console.warn('[dashboard/summary] query failed:', r.reason?.message || r.reason);
      return empty;
    };

    const flightsTodayRes = q(0);
    const statusBreakdownRes = q(1);
    const paxExpectedRes = q(2);
    const checkinsTodayFlightsRes = q(3);
    const crewOverviewRes = q(4);
    const paymentsTodayRes = q(5);
    const refundsTodayRes = q(6);
    const bookingsCreatedRes = q(7);
    const ticketsIssuedRes = q(8);
    const checkinsAllRes = q(9);
    const activeUsersRes = q(10);
    const openDefectsRes = q(11);
    const revenueMonthRes = q(12);
    const refundsMonthRes = q(13);
    const holdsRes = q(14);
    const revenue7dRes = q(15);
    const paymentMixRes = q(16);
    const delayedListRes = q(17);
    const mxOpenListRes = q(18);
    const aircraftHoldRes = q(19);
    const inspectionsDueRes = q(20);
    const inspectionsDueCountRes = q(21);
    const aircraftHoldCountRes = q(22);
    const holdPnrsRes = q(23);
    const myCrewFlightsRes = q(24);

    const statusMap = {};
    for (const row of statusBreakdownRes.rows) {
      statusMap[row.status || 'UNKNOWN'] = row.count;
    }

    const flights = flightsTodayRes.rows.map((r) => ({
      id: r.id,
      flightNumber: r.flight_number,
      dep: r.departure_airport,
      arr: r.arrival_airport,
      departureTime: r.departure_time,
      status: r.status,
      tail: r.tail_number,
      model: r.model
    }));

    const paxExpected = Number(paxExpectedRes.rows[0]?.c || 0);
    const checkinsOnToday = Number(checkinsTodayFlightsRes.rows[0]?.c || 0);

    const crewOverview = crewOverviewRes.rows.map((r) => ({
      flightNumber: r.flight_number,
      departureTime: r.departure_time,
      name: r.full_name,
      duty: r.duty_role
    }));

    const payToday = Number(paymentsTodayRes.rows[0]?.v || 0);
    const refToday = Number(refundsTodayRes.rows[0]?.v || 0);
    const bookingsToday = Number(bookingsCreatedRes.rows[0]?.c || 0);
    const ticketsToday = Number(ticketsIssuedRes.rows[0]?.c || 0);
    const checkinsAllToday = Number(checkinsAllRes.rows[0]?.c || 0);
    const activeUsers = Number(activeUsersRes.rows[0]?.c || 0);
    const openDefects = Number(openDefectsRes.rows[0]?.c || 0);
    const revenueMonth = Number(revenueMonthRes.rows[0]?.v || 0);
    const refundsMonth = Number(refundsMonthRes.rows[0]?.v || 0);
    const holdsOutstanding = Number(holdsRes.rows[0]?.v || 0);
    const inspectionsDueTotal = Number(inspectionsDueCountRes.rows[0]?.c || 0);
    const aircraftHoldTotal = Number(aircraftHoldCountRes.rows[0]?.c || 0);
    const holdPnrs = Number(holdPnrsRes.rows[0]?.c || 0);

    const kpis = [];
    if (userHasAnyRole(role, ['admin'])) {
      kpis.push(
        { id: 'users', label: 'Active users', value: activeUsers, href: '/system-administration' },
        { id: 'flights', label: 'Flights today', value: flights.length, href: '/flights' },
        { id: 'defects', label: 'Open defects', value: openDefects, href: '/maintenance' },
        { id: 'revenue', label: 'Payments today (USD)', value: payToday, href: '/finance', format: 'money' },
        { id: 'hold', label: 'PNRs on hold / pending', value: holdPnrs, href: '/bookings' }
      );
    } else if (role === 'finance') {
      kpis.push(
        { id: 'pay', label: 'Payments today', value: payToday, href: '/finance', format: 'money' },
        { id: 'ref', label: 'Refunds today', value: refToday, href: '/finance', format: 'money' },
        { id: 'net', label: 'Net today', value: payToday - refToday, href: '/finance', format: 'money' },
        { id: 'month', label: 'Revenue MTD', value: revenueMonth, href: '/reports', format: 'money' }
      );
    } else if (role === 'operations') {
      kpis.push(
        { id: 'sched', label: 'Flights scheduled', value: flights.length, href: '/flights' },
        { id: 'del', label: 'Delayed', value: statusMap.DELAYED || 0, href: '/operations' },
        { id: 'pax', label: 'Passengers to board', value: paxExpected, href: '/checkin' },
        { id: 'ck', label: 'Checked in (today legs)', value: checkinsOnToday, href: '/checkin' }
      );
    } else if (role === 'agent' || role === 'customer_service' || role === 'sales_manager') {
      kpis.push(
        { id: 'bkg', label: 'Bookings today', value: bookingsToday, href: '/bookings' },
        { id: 'tix', label: 'Tickets issued', value: ticketsToday, href: '/bookings' },
        { id: 'ck', label: 'Check-ins today', value: checkinsAllToday, href: '/checkin' },
        { id: 'hold', label: 'PNRs on hold / pending', value: holdPnrs, href: '/bookings' }
      );
    } else if (role === 'crew') {
      kpis.push({
        id: 'mine',
        label: 'My flights today',
        value: myCrewFlightsRes.rows.length,
        href: '/dashboard'
      });
    } else if (role === 'maintenance') {
      kpis.push(
        { id: 'def', label: 'Open defects', value: openDefects, href: '/maintenance' },
        {
          id: 'insp',
          label: 'Inspections due today',
          value: inspectionsDueTotal,
          href: '/maintenance'
        },
        { id: 'hold', label: 'Aircraft not released', value: aircraftHoldTotal, href: '/maintenance' }
      );
    }

    const alerts = [];
    for (const d of delayedListRes.rows) {
      alerts.push({
        id: `delay-${d.flight_number}-${d.created_at}`,
        severity: 'warning',
        title: `Delay — ${d.flight_number}`,
        detail: `${d.departure_airport}→${d.arrival_airport}: ${d.delay_minutes} min — ${d.reason || 'Operational'}`,
        href: '/operations',
        time: d.created_at
      });
    }
    for (const m of mxOpenListRes.rows) {
      alerts.push({
        id: `mx-${m.id}`,
        severity: m.severity === 'AOG' || m.severity === 'CRITICAL' ? 'critical' : 'warning',
        title: `Maintenance — ${m.tail_number}`,
        detail: m.defect_description,
        href: '/maintenance',
        time: m.opened_at
      });
    }
    for (const a of aircraftHoldRes.rows) {
      alerts.push({
        id: `hold-${a.tail_number}`,
        severity: 'warning',
        title: `Aircraft hold — ${a.tail_number}`,
        detail: `${a.model} — status ${a.release_status}`,
        href: '/maintenance',
        time: null
      });
    }
    for (const i of inspectionsDueRes.rows) {
      alerts.push({
        id: `insp-${i.id}`,
        severity: 'info',
        title: `Inspection due — ${i.tail_number}`,
        detail: i.inspection_type,
        href: '/maintenance',
        time: i.scheduled_for
      });
    }

    const payload = {
      role,
      date: today,
      kpis,
      quickLinks: quickLinksForRole(role),
      alerts: alerts.slice(0, 12),
      todaysFlights: include.flights && role !== 'crew' ? flights : null,
      myFlights: role === 'crew' ? myCrewFlightsRes.rows : null,
      operationalSummary:
        include.operational
          ? {
              byStatus: statusMap,
              flightsCount: flights.length
            }
          : null,
      checkinStatus: include.checkin
        ? {
            passengersOnTodayFlights: paxExpected,
            checkedInOnTodayFlights: checkinsOnToday,
            outstanding: Math.max(0, paxExpected - checkinsOnToday)
          }
        : null,
      crewOverview: include.crewRoster ? crewOverview : null,
      bookingRevenue: userHasAnyRole(role, ['admin', 'finance', 'sales_manager'])
        ? {
            paymentsToday: payToday,
            refundsToday: refToday,
            bookingsToday,
            ticketsToday,
            series7d: revenue7dRes.rows.map((r) => ({ date: r.d, amount: Number(r.amount) })),
            paymentMix7d: paymentMixRes.rows.map((r) => ({ type: r.payment_type, amount: Number(r.total) }))
          }
        : null,
      financeSnapshot:
        include.finance || userHasAnyRole(role, ['admin'])
          ? {
              revenueMonth,
              refundsMonth,
              netMonth: revenueMonth - refundsMonth,
              holdsOutstanding
            }
          : null
    };

    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load dashboard summary.', error: error.message });
  }
});

router.get('/:role', requireAuth, async (req, res) => {
  const targetRole = String(req.params.role || '').toLowerCase();
  if (
    !['admin', 'finance', 'operations', 'agent', 'crew', 'maintenance', 'super_admin', 'customer_service', 'sales_manager'].includes(
      targetRole
    )
  ) {
    return res.status(400).json({ message: 'Invalid role dashboard requested.' });
  }

  if (!canAccessRole(req.user.role, targetRole)) {
    return res.status(403).json({ message: 'Not authorized for this role dashboard.' });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);

    if (targetRole === 'admin' || targetRole === 'super_admin') {
      const s = await Promise.allSettled([
        pool.query(`SELECT COUNT(*)::int AS count FROM users WHERE is_active = TRUE`),
        pool.query(`SELECT COUNT(*)::int AS count FROM flights WHERE DATE(departure_time) = DATE($1)`, [today]),
        pool.query(`SELECT COUNT(*)::int AS count FROM maintenance_logs WHERE status = 'OPEN'`),
        pool.query(`SELECT COALESCE(SUM(amount),0)::float AS value FROM payments`)
      ]);
      return res.json({
        role: targetRole,
        cards: [
          { label: 'Active Users', value: rowCountFromSettled(s, 0, 'admin') },
          { label: 'Flights Today', value: rowCountFromSettled(s, 1, 'admin') },
          { label: 'Open Defects', value: rowCountFromSettled(s, 2, 'admin') },
          { label: 'Total Revenue (USD)', value: rowValueFromSettled(s, 3, 'admin') }
        ]
      });
    }

    if (targetRole === 'sales_manager') {
      const s = await Promise.allSettled([
        pool.query(`SELECT COUNT(*)::int AS count FROM bookings WHERE DATE(created_at)=DATE($1)`, [today]),
        pool.query(`SELECT COALESCE(SUM(amount),0)::float AS value FROM payments WHERE DATE(processed_at)=DATE($1)`, [today])
      ]);
      return res.json({
        role: 'sales_manager',
        cards: [
          { label: 'Bookings Today', value: rowCountFromSettled(s, 0, 'sales') },
          { label: 'Payments Today (USD)', value: rowValueFromSettled(s, 1, 'sales') }
        ]
      });
    }

    if (targetRole === 'finance') {
      const s = await Promise.allSettled([
        pool.query(`SELECT COALESCE(SUM(amount),0)::float AS value FROM payments WHERE DATE(processed_at)=DATE($1)`, [today]),
        pool.query(`SELECT COALESCE(SUM(refund_amount),0)::float AS value FROM refunds WHERE DATE(refunded_at)=DATE($1)`, [today]),
        pool.query(
          `SELECT
             COALESCE((SELECT SUM(amount) FROM payments WHERE DATE(processed_at)=DATE($1)),0) -
             COALESCE((SELECT SUM(refund_amount) FROM refunds WHERE DATE(refunded_at)=DATE($1)),0)
           AS value`,
          [today]
        )
      ]);
      return res.json({
        role: 'finance',
        cards: [
          { label: 'Payments Today', value: rowValueFromSettled(s, 0, 'finance') },
          { label: 'Refunds Today', value: rowValueFromSettled(s, 1, 'finance') },
          { label: 'Net Today', value: rowValueFromSettled(s, 2, 'finance') }
        ]
      });
    }

    if (targetRole === 'operations') {
      const s = await Promise.allSettled([
        pool.query(`SELECT COUNT(*)::int AS count FROM flights WHERE DATE(departure_time)=DATE($1)`, [today]),
        pool.query(`SELECT COUNT(*)::int AS count FROM flights WHERE DATE(departure_time)=DATE($1) AND status='DELAYED'`, [today]),
        pool.query(`SELECT COUNT(*)::int AS count FROM dispatch_logs WHERE DATE(dispatched_at)=DATE($1)`, [today])
      ]);
      return res.json({
        role: 'operations',
        cards: [
          { label: 'Flights Scheduled Today', value: rowCountFromSettled(s, 0, 'ops') },
          { label: 'Delayed Flights Today', value: rowCountFromSettled(s, 1, 'ops') },
          { label: 'Dispatch Events Today', value: rowCountFromSettled(s, 2, 'ops') }
        ]
      });
    }

    if (targetRole === 'agent' || targetRole === 'customer_service') {
      const s = await Promise.allSettled([
        pool.query(`SELECT COUNT(*)::int AS count FROM bookings WHERE DATE(created_at)=DATE($1)`, [today]),
        pool.query(`SELECT COUNT(*)::int AS count FROM tickets WHERE DATE(issued_at)=DATE($1)`, [today]),
        pool.query(`SELECT COUNT(*)::int AS count FROM checkins WHERE DATE(checkin_time)=DATE($1)`, [today])
      ]);
      return res.json({
        role: targetRole,
        cards: [
          { label: 'Bookings Today', value: rowCountFromSettled(s, 0, 'agent') },
          { label: 'Tickets Issued Today', value: rowCountFromSettled(s, 1, 'agent') },
          { label: 'Check-ins Today', value: rowCountFromSettled(s, 2, 'agent') }
        ]
      });
    }

    if (targetRole === 'crew') {
      let count = 0;
      try {
        const assignedFlights = await pool.query(
          `SELECT COUNT(DISTINCT ca.flight_id)::int AS count
           FROM crew_assignments ca
           JOIN flights f ON f.id = ca.flight_id
           WHERE ca.crew_user_id = $1
             AND DATE(f.departure_time) = DATE($2)`,
          [req.user.userId, today]
        );
        count = Number(assignedFlights.rows[0]?.count ?? 0);
      } catch (e) {
        console.warn('[dashboard/crew]:', e?.message || e);
      }
      return res.json({
        role: 'crew',
        cards: [{ label: 'My Flights Today', value: count }]
      });
    }

    const s = await Promise.allSettled([
      pool.query(`SELECT COUNT(*)::int AS count FROM maintenance_logs WHERE status='OPEN'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM maintenance_inspections WHERE DATE(scheduled_for)=DATE($1) AND status='SCHEDULED'`, [today]),
      pool.query(`SELECT COUNT(*)::int AS count FROM aircraft WHERE release_status <> 'RELEASED'`)
    ]);
    return res.json({
      role: 'maintenance',
      cards: [
        { label: 'Open Defects', value: rowCountFromSettled(s, 0, 'mx') },
        { label: 'Inspections Due Today', value: rowCountFromSettled(s, 1, 'mx') },
        { label: 'Aircraft Not Released', value: rowCountFromSettled(s, 2, 'mx') }
      ]
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load dashboard.', error: error.message });
  }
});

export default router;
