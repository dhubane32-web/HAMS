import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import { writeAudit } from '../../services/auditService.js';
import { logFinanceTransaction } from '../../services/financeLedger.js';
import {
  dateRangeToDepartureWindow,
  monthToDateDepartureWindow,
  queryLoadFactorSnapshot
} from '../../services/loadFactor.js';

const ROLES_SALES = ['admin', 'super_admin', 'sales_manager'];
const ROLES_SALES_FIN = ['admin', 'super_admin', 'sales_manager', 'finance'];
function isUuid(v) {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

export function registerSalesCommercialRoutes(router) {
  router.get('/sales-channels', requireAuth, requireRoles(...ROLES_SALES_FIN), async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, code, name, default_commission_pct, active FROM sm_sales_channels ORDER BY name`
      );
      return res.json({ channels: r.rows });
    } catch (e) {
      return res.status(500).json({ message: 'Failed to load channels.', error: e.message });
    }
  });

  router.get('/commercial-kpi-dashboard', requireAuth, requireRoles(...ROLES_SALES_FIN), async (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;
    const lfWindow = monthToDateDepartureWindow(today);
    try {
      const [todaySales, weekSales, monthSales, avgFare, lfSnap, topRoute, topAgent, topCorp, channelMix] =
        await Promise.all([
          pool.query(
            `SELECT COALESCE(SUM(b.total_amount),0)::numeric AS v, COUNT(*)::int AS c
             FROM bookings b WHERE DATE(b.created_at) = DATE($1::date) AND upper(trim(b.booking_status)) <> 'CANCELLED'`,
            [today]
          ),
          pool.query(
            `SELECT COALESCE(SUM(b.total_amount),0)::numeric AS v, COUNT(*)::int AS c
             FROM bookings b WHERE b.created_at >= $1::timestamptz AND upper(trim(b.booking_status)) <> 'CANCELLED'`,
            [weekAgo]
          ),
          pool.query(
            `SELECT COALESCE(SUM(b.total_amount),0)::numeric AS v, COUNT(*)::int AS c
             FROM bookings b WHERE b.created_at >= $1::timestamptz AND upper(trim(b.booking_status)) <> 'CANCELLED'`,
            [monthStart]
          ),
          pool.query(
            `SELECT COALESCE(AVG(b.total_amount),0)::numeric AS v FROM bookings b
             WHERE b.created_at >= $1::timestamptz AND upper(trim(b.booking_status)) <> 'CANCELLED'`,
            [monthStart]
          ),
          queryLoadFactorSnapshot(pool, lfWindow.fromTs, lfWindow.toExclusiveTs),
          pool
            .query(
              `SELECT origin, dest, origin || '→' || dest AS route, itinerary_fare_sum AS revenue
               FROM sm_v_route_sales ORDER BY itinerary_fare_sum DESC NULLS LAST LIMIT 1`
            )
            .catch(() => ({ rows: [] })),
          pool.query(
            `SELECT u.full_name, COUNT(*)::int AS c, COALESCE(SUM(b.total_amount),0)::numeric AS rev
             FROM bookings b JOIN users u ON u.id = b.created_by
             WHERE b.created_at >= $1::timestamptz AND upper(trim(b.booking_status)) <> 'CANCELLED'
             GROUP BY u.id ORDER BY rev DESC LIMIT 1`,
            [monthStart]
          ),
          pool.query(
            `SELECT c.legal_name, COUNT(*)::int AS c, COALESCE(SUM(b.total_amount),0)::numeric AS rev
             FROM bookings b
             JOIN sales_corporate_customers c ON c.id = b.corporate_account_id
             WHERE b.created_at >= $1::timestamptz AND upper(trim(b.booking_status)) <> 'CANCELLED'
             GROUP BY c.id ORDER BY rev DESC LIMIT 1`,
            [monthStart]
          ),
          pool.query(`SELECT * FROM sm_v_channel_revenue ORDER BY paid_revenue DESC`).catch(() => ({ rows: [] }))
        ]);

      return res.json({
        asOf: new Date().toISOString(),
        today: { revenue: Number(todaySales.rows[0]?.v || 0), bookings: Number(todaySales.rows[0]?.c || 0) },
        week: { revenue: Number(weekSales.rows[0]?.v || 0), bookings: Number(weekSales.rows[0]?.c || 0) },
        month: { revenue: Number(monthSales.rows[0]?.v || 0), bookings: Number(monthSales.rows[0]?.c || 0) },
        averageFare: Number(avgFare.rows[0]?.v || 0),
        loadFactor: lfSnap.loadFactor,
        loadFactorScope: {
          departureFrom: lfWindow.fromTs,
          departureBeforeExclusive: lfWindow.toExclusiveTs,
          calendarMonthStart: lfWindow.monthStart,
          totalSeatsSold: lfSnap.totalSeatsSold,
          totalSeatsAvailable: lfSnap.totalSeatsAvailable,
          flightLegCount: lfSnap.flightLegCount,
          formula:
            'sum(seats_sold)/sum(seats_available) over scheduled legs; seats_sold = distinct passengers on non-cancelled bookings (INF excluded); capacity = aircraft.seat_capacity; legs without aircraft omitted from denominator'
        },
        perFlightLoadFactor: lfSnap.perFlightLoadFactor,
        topRoute: topRoute.rows[0] || null,
        topAgent: topAgent.rows[0] || null,
        topCorporate: topCorp.rows[0] || null,
        channelRevenue: channelMix.rows || []
      });
    } catch (e) {
      return res.status(500).json({ message: 'Failed to load commercial KPIs.', error: e.message });
    }
  });

  router.get('/revenue-management/summary', requireAuth, requireRoles(...ROLES_SALES_FIN), async (req, res) => {
    const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
    const to = String(req.query.to || new Date().toISOString().slice(0, 10));
    try {
      const { fromTs, toExclusiveTs } = dateRangeToDepartureWindow(from, to);
      const [routes, families, classes, policy, lfSnap] = await Promise.all([
        pool.query(`SELECT * FROM sm_v_route_sales ORDER BY itinerary_fare_sum DESC LIMIT 40`).catch(() => ({ rows: [] })),
        pool.query(`SELECT f.code, f.name, f.cabin FROM sm_fare_families f ORDER BY sort_order`).catch(() => ({ rows: [] })),
        pool
          .query(
            `SELECT fc.id, fc.code, fc.name, fc.booking_class, fam.code AS family_code
             FROM md_fare_classes fc
             LEFT JOIN sm_fare_class_family_map m ON m.fare_class_id = fc.id
             LEFT JOIN sm_fare_families fam ON fam.id = m.family_id
             WHERE fc.is_active = TRUE
             ORDER BY fc.code`
          )
          .catch(() => ({ rows: [] })),
        pool.query(`SELECT * FROM sm_rm_policy WHERE id = 1`).catch(() => ({ rows: [{}] })),
        queryLoadFactorSnapshot(pool, fromTs, toExclusiveTs).catch(() => ({
          loadFactor: 0,
          totalSeatsSold: 0,
          totalSeatsAvailable: 0,
          flightLegCount: 0,
          perFlightLoadFactor: []
        }))
      ]);
      return res.json({
        from,
        to,
        fareFamilies: families.rows,
        fareClasses: classes.rows,
        topRoutes: routes.rows,
        rmPolicy: policy.rows[0] || null,
        loadFactor: {
          departureFrom: fromTs,
          departureBeforeExclusive: toExclusiveTs,
          networkLoadFactor: lfSnap.loadFactor,
          totalSeatsSold: lfSnap.totalSeatsSold,
          totalSeatsAvailable: lfSnap.totalSeatsAvailable,
          flightLegCount: lfSnap.flightLegCount,
          perFlightLoadFactor: lfSnap.perFlightLoadFactor
        },
        note: 'Bucket inventory uses sm_rm_flight_bucket; call POST /revenue-management/recalculate-buckets to refresh.'
      });
    } catch (e) {
      return res.status(500).json({ message: 'Failed to load RM summary.', error: e.message });
    }
  });

  router.get('/revenue-management/load-factor', requireAuth, requireRoles(...ROLES_SALES_FIN), async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const fromQ = req.query.from ? String(req.query.from).slice(0, 10) : null;
    const toQ = req.query.to ? String(req.query.to).slice(0, 10) : null;
    let fromTs;
    let toExclusiveTs;
    if (fromQ && toQ) {
      const w = dateRangeToDepartureWindow(fromQ, toQ);
      fromTs = w.fromTs;
      toExclusiveTs = w.toExclusiveTs;
    } else {
      const w = monthToDateDepartureWindow(today);
      fromTs = w.fromTs;
      toExclusiveTs = w.toExclusiveTs;
    }
    try {
      const snap = await queryLoadFactorSnapshot(pool, fromTs, toExclusiveTs);
      return res.json({
        departureFrom: fromTs,
        departureBeforeExclusive: toExclusiveTs,
        ...snap
      });
    } catch (e) {
      return res.status(500).json({ message: 'Failed to load load factor.', error: e.message });
    }
  });

  router.post(
    '/revenue-management/recalculate-buckets',
    requireAuth,
    requireRoles(...ROLES_SALES),
    async (req, res) => {
      const flightId = req.body?.flightId ? String(req.body.flightId) : null;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const pol = await client.query(`SELECT load_factor_close_bucket, load_factor_open_upper FROM sm_rm_policy WHERE id = 1`);
        const closeLf = Number(pol.rows[0]?.load_factor_close_bucket || 0.78);
        const openLf = Number(pol.rows[0]?.load_factor_open_upper || 0.55);

        if (flightId && isUuid(flightId)) {
          await client.query(
            `WITH lf AS (
               SELECT f.id AS flight_id,
                 ac.seat_capacity::numeric AS cap,
                 COUNT(DISTINCT bp.passenger_id) FILTER (
                   WHERE bp.passenger_id IS NOT NULL
                     AND upper(trim(COALESCE(bp.passenger_type, 'ADT'))) <> 'INF'
                 )::numeric AS pax
               FROM flights f
               INNER JOIN aircraft ac ON ac.id = f.aircraft_id AND ac.seat_capacity > 0
               LEFT JOIN booking_flights bf ON bf.flight_id = f.id
               LEFT JOIN bookings b ON b.id = bf.booking_id AND upper(trim(COALESCE(b.booking_status,''))) <> 'CANCELLED'
               LEFT JOIN booking_passengers bp ON bp.booking_id = b.id
               WHERE f.id = $3::uuid
               GROUP BY f.id, ac.seat_capacity
             )
             UPDATE sm_rm_flight_bucket b
             SET bucket_open = CASE
               WHEN lf.pax / NULLIF(lf.cap, 0) >= $1::numeric THEN FALSE
               WHEN lf.pax / NULLIF(lf.cap, 0) <= $2::numeric THEN TRUE
               ELSE b.bucket_open
             END,
             seats_sold = LEAST(lf.pax, lf.cap)::int,
             updated_at = NOW()
             FROM lf
             WHERE b.flight_id = lf.flight_id`,
            [closeLf, openLf, flightId]
          );
        } else {
          await client.query(
            `WITH lf AS (
               SELECT f.id AS flight_id,
                 ac.seat_capacity::numeric AS cap,
                 COUNT(DISTINCT bp.passenger_id) FILTER (
                   WHERE bp.passenger_id IS NOT NULL
                     AND upper(trim(COALESCE(bp.passenger_type, 'ADT'))) <> 'INF'
                 )::numeric AS pax
               FROM flights f
               INNER JOIN aircraft ac ON ac.id = f.aircraft_id AND ac.seat_capacity > 0
               LEFT JOIN booking_flights bf ON bf.flight_id = f.id
               LEFT JOIN bookings b ON b.id = bf.booking_id AND upper(trim(COALESCE(b.booking_status,''))) <> 'CANCELLED'
               LEFT JOIN booking_passengers bp ON bp.booking_id = b.id
               GROUP BY f.id, ac.seat_capacity
             )
             UPDATE sm_rm_flight_bucket b
             SET bucket_open = CASE
               WHEN lf.pax / NULLIF(lf.cap, 0) >= $1::numeric THEN FALSE
               WHEN lf.pax / NULLIF(lf.cap, 0) <= $2::numeric THEN TRUE
               ELSE b.bucket_open
             END,
             seats_sold = LEAST(lf.pax, lf.cap)::int,
             updated_at = NOW()
             FROM lf
             WHERE b.flight_id = lf.flight_id`,
            [closeLf, openLf]
          );
        }
        await client.query('COMMIT');
        return res.json({ message: 'Bucket states refreshed from load factor policy.', closeLf, openLf });
      } catch (e) {
        await client.query('ROLLBACK');
        return res.status(500).json({ message: 'Bucket recalculation failed.', error: e.message });
      } finally {
        client.release();
      }
    }
  );

  router.get('/distribution/channel-report', requireAuth, requireRoles(...ROLES_SALES_FIN), async (req, res) => {
    const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
    const to = String(req.query.to || new Date().toISOString().slice(0, 10));
    try {
      const r = await pool.query(
        `SELECT COALESCE(b.sales_channel_code,'DIRECT_WEB') AS channel,
                COUNT(*)::int AS bookings,
                COALESCE(SUM(b.total_amount),0)::numeric AS revenue,
                COALESCE(AVG(b.total_amount),0)::numeric AS avg_booking_value
         FROM bookings b
         WHERE b.created_at::date BETWEEN $1::date AND $2::date
           AND upper(trim(COALESCE(b.booking_status,''))) <> 'CANCELLED'
         GROUP BY 1 ORDER BY revenue DESC`,
        [from, to]
      );
      return res.json({ from, to, rows: r.rows });
    } catch (e) {
      return res.status(500).json({ message: 'Failed channel report.', error: e.message });
    }
  });

  router.patch(
    '/corporate-customers/:id',
    requireAuth,
    requireRoles(...ROLES_SALES),
    async (req, res) => {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ message: 'Invalid id.' });
      const body = req.body || {};
      const sets = [];
      const vals = [];
      if (body.credit_limit !== undefined) {
        vals.push(Number(body.credit_limit));
        sets.push(`credit_limit = $${vals.length}`);
      }
      if (body.credit_balance !== undefined) {
        vals.push(Number(body.credit_balance));
        sets.push(`credit_balance = $${vals.length}`);
      }
      if (body.payment_terms !== undefined) {
        vals.push(String(body.payment_terms).slice(0, 40));
        sets.push(`payment_terms = $${vals.length}`);
      }
      if (body.billing_cycle_days !== undefined) {
        vals.push(body.billing_cycle_days == null ? null : Number(body.billing_cycle_days));
        sets.push(`billing_cycle_days = $${vals.length}`);
      }
      if (body.status !== undefined) {
        vals.push(String(body.status).slice(0, 20));
        sets.push(`status = $${vals.length}`);
      }
      if (body.travel_policy_json !== undefined) {
        vals.push(JSON.stringify(body.travel_policy_json || {}));
        sets.push(`travel_policy_json = $${vals.length}::jsonb`);
      }
      if (body.fare_agreement_json !== undefined) {
        vals.push(JSON.stringify(body.fare_agreement_json || {}));
        sets.push(`fare_agreement_json = $${vals.length}::jsonb`);
      }
      if (sets.length === 0) return res.status(400).json({ message: 'No updates.' });
      vals.push(id);
      const client = await pool.connect();
      try {
        const r = await client.query(
          `UPDATE sales_corporate_customers SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
          vals
        );
        if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
        await writeAudit(client, {
          userId: req.user.userId,
          action: 'CORPORATE_ACCOUNT_UPDATED',
          entity: 'sales_corporate_customers',
          entityId: id,
          metadata: { patch: body },
          req
        });
        return res.json({ corporateCustomer: r.rows[0] });
      } catch (e) {
        return res.status(500).json({ message: 'Update failed.', error: e.message });
      } finally {
        client.release();
      }
    }
  );

  router.post(
    '/corporate-contracts',
    requireAuth,
    requireRoles(...ROLES_SALES),
    async (req, res) => {
      const { corporateId, title, discountPercent, validFrom, validUntil, contractJson } = req.body;
      if (!isUuid(String(corporateId)) || !title || !validFrom || !validUntil) {
        return res.status(400).json({ message: 'corporateId, title, validFrom, validUntil required.' });
      }
      const client = await pool.connect();
      try {
        const ins = await client.query(
          `INSERT INTO sm_corporate_contracts (corporate_id, title, discount_percent, valid_from, valid_until, contract_json)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,
          [
            corporateId,
            String(title).slice(0, 200),
            discountPercent != null ? Number(discountPercent) : null,
            String(validFrom).slice(0, 10),
            String(validUntil).slice(0, 10),
            JSON.stringify(contractJson || {})
          ]
        );
        await writeAudit(client, {
          userId: req.user.userId,
          action: 'CORPORATE_CONTRACT_CREATED',
          entity: 'sm_corporate_contracts',
          entityId: ins.rows[0].id,
          metadata: { corporateId },
          req
        });
        return res.status(201).json({ contract: ins.rows[0] });
      } catch (e) {
        return res.status(500).json({ message: 'Failed.', error: e.message });
      } finally {
        client.release();
      }
    }
  );

  router.get(
    '/corporate-contracts',
    requireAuth,
    requireRoles(...ROLES_SALES_FIN),
    async (req, res) => {
      const corporateId = req.query.corporateId ? String(req.query.corporateId) : null;
      if (!corporateId || !isUuid(corporateId)) {
        return res.status(400).json({ message: 'corporateId query required.' });
      }
      try {
        const r = await pool.query(
          `SELECT * FROM sm_corporate_contracts WHERE corporate_id = $1 ORDER BY valid_from DESC`,
          [corporateId]
        );
        return res.json({ contracts: r.rows });
      } catch (e) {
        return res.status(500).json({ message: 'Failed.', error: e.message });
      }
    }
  );

  router.patch(
    '/travel-agents/:id',
    requireAuth,
    requireRoles(...ROLES_SALES),
    async (req, res) => {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ message: 'Invalid id.' });
      const { approvalStatus, creditLimit, creditBalance, debtBalance, commissionPercent } = req.body;
      const sets = [];
      const vals = [];
      if (approvalStatus !== undefined) {
        vals.push(String(approvalStatus).toUpperCase());
        sets.push(`approval_status = $${vals.length}`);
      }
      if (creditLimit !== undefined) {
        vals.push(Number(creditLimit));
        sets.push(`credit_limit = $${vals.length}`);
      }
      if (creditBalance !== undefined) {
        vals.push(Number(creditBalance));
        sets.push(`credit_balance = $${vals.length}`);
      }
      if (debtBalance !== undefined) {
        vals.push(Number(debtBalance));
        sets.push(`debt_balance = $${vals.length}`);
      }
      if (commissionPercent !== undefined) {
        vals.push(Number(commissionPercent));
        sets.push(`commission_percent = $${vals.length}`);
      }
      if (!sets.length) return res.status(400).json({ message: 'No updates.' });
      vals.push(id);
      const client = await pool.connect();
      try {
        const r = await client.query(
          `UPDATE sales_travel_agents SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
          vals
        );
        if (!r.rows[0]) return res.status(404).json({ message: 'Not found.' });
        await writeAudit(client, {
          userId: req.user.userId,
          action: 'TRAVEL_AGENT_UPDATED',
          entity: 'sales_travel_agents',
          entityId: id,
          metadata: { patch: req.body },
          req
        });
        return res.json({ travelAgent: r.rows[0] });
      } catch (e) {
        return res.status(500).json({ message: 'Failed.', error: e.message });
      } finally {
        client.release();
      }
    }
  );

  router.get('/commissions', requireAuth, requireRoles(...ROLES_SALES_FIN), async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    try {
      const r = await pool.query(
        `SELECT c.*, b.pnr FROM sm_agent_commissions c JOIN bookings b ON b.id = c.booking_id ORDER BY c.created_at DESC LIMIT $1`,
        [limit]
      );
      return res.json({ commissions: r.rows });
    } catch (e) {
      return res.status(500).json({ message: 'Failed.', error: e.message });
    }
  });

  router.get('/crm/customers', requireAuth, requireRoles(...ROLES_SALES_FIN), async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 80));
    try {
      const r = await pool.query(
        `SELECT c.*, p.first_name, p.last_name, p.email
         FROM sm_crm_customers c
         JOIN passengers p ON p.id = c.passenger_id
         ORDER BY c.updated_at DESC NULLS LAST
         LIMIT $1`,
        [limit]
      );
      return res.json({ customers: r.rows });
    } catch (e) {
      return res.status(500).json({ message: 'Failed.', error: e.message });
    }
  });

  router.get('/loyalty/accounts', requireAuth, requireRoles(...ROLES_SALES_FIN), async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT a.*, p.first_name, p.last_name FROM sm_loyalty_accounts a
         JOIN passengers p ON p.id = a.passenger_id ORDER BY a.miles_balance DESC LIMIT 200`
      );
      return res.json({ accounts: r.rows });
    } catch (e) {
      return res.status(500).json({ message: 'Failed.', error: e.message });
    }
  });

  router.get('/loyalty/transactions', requireAuth, requireRoles(...ROLES_SALES_FIN), async (req, res) => {
    const accountId = req.query.accountId ? String(req.query.accountId) : '';
    if (!isUuid(accountId)) return res.status(400).json({ message: 'accountId required.' });
    try {
      const r = await pool.query(
        `SELECT * FROM sm_loyalty_transactions WHERE loyalty_account_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [accountId]
      );
      return res.json({ transactions: r.rows });
    } catch (e) {
      return res.status(500).json({ message: 'Failed.', error: e.message });
    }
  });

  router.post('/ancillary-sales', requireAuth, requireRoles(...ROLES_SALES), async (req, res) => {
    const { bookingId, productCode, quantity, unitPrice, currency } = req.body;
    if (!isUuid(String(bookingId)) || !productCode) {
      return res.status(400).json({ message: 'bookingId and productCode required.' });
    }
    const client = await pool.connect();
    try {
      const ins = await client.query(
        `INSERT INTO sm_ancillary_sales (booking_id, product_code, quantity, unit_price, currency, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          bookingId,
          String(productCode).slice(0, 40),
          Math.max(1, Number(quantity) || 1),
          Number(unitPrice) || 0,
          String(currency || 'USD').slice(0, 3).toUpperCase(),
          req.user.userId
        ]
      );
      await logFinanceTransaction(client, {
        txnType: 'ANCILLARY_REVENUE',
        amount: Number(ins.rows[0].unit_price) * Number(ins.rows[0].quantity),
        currency: ins.rows[0].currency,
        bookingId: ins.rows[0].booking_id,
        description: `Ancillary ${ins.rows[0].product_code} x${ins.rows[0].quantity}`,
        metadata: { ancillarySaleId: ins.rows[0].id },
        userId: req.user.userId
      });
      await writeAudit(client, {
        userId: req.user.userId,
        action: 'ANCILLARY_SALE_CREATED',
        entity: 'sm_ancillary_sales',
        entityId: ins.rows[0].id,
        metadata: { bookingId, productCode },
        req
      });
      return res.status(201).json({ sale: ins.rows[0] });
    } catch (e) {
      return res.status(500).json({ message: 'Failed.', error: e.message });
    } finally {
      client.release();
    }
  });

  router.get('/ancillary-sales', requireAuth, requireRoles(...ROLES_SALES_FIN), async (req, res) => {
    const bookingId = req.query.bookingId ? String(req.query.bookingId) : null;
    try {
      const r = bookingId && isUuid(bookingId)
        ? await pool.query(`SELECT * FROM sm_ancillary_sales WHERE booking_id = $1 ORDER BY created_at DESC`, [
            bookingId
          ])
        : await pool.query(`SELECT * FROM sm_ancillary_sales ORDER BY created_at DESC LIMIT 200`);
      return res.json({ sales: r.rows });
    } catch (e) {
      return res.status(500).json({ message: 'Failed.', error: e.message });
    }
  });

  router.get('/fare-rules', requireAuth, requireRoles(...ROLES_SALES_FIN), async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT fr.*, fc.code AS fare_class_code FROM sm_fare_rules fr
         LEFT JOIN md_fare_classes fc ON fc.id = fr.fare_class_id ORDER BY fr.updated_at DESC LIMIT 200`
      );
      return res.json({ fareRules: r.rows });
    } catch (e) {
      return res.status(500).json({ message: 'Failed.', error: e.message });
    }
  });

  router.post('/fare-rules', requireAuth, requireRoles(...ROLES_SALES), async (req, res) => {
    const { fareClassId, ruleKey, ruleValueJson, effectiveFrom, effectiveTo } = req.body;
    if (!ruleKey) return res.status(400).json({ message: 'ruleKey required.' });
    const client = await pool.connect();
    try {
      const ins = await client.query(
        `INSERT INTO sm_fare_rules (fare_class_id, rule_key, rule_value_json, effective_from, effective_to, updated_by)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6) RETURNING *`,
        [
          fareClassId && isUuid(String(fareClassId)) ? fareClassId : null,
          String(ruleKey).slice(0, 80),
          JSON.stringify(ruleValueJson || {}),
          effectiveFrom ? String(effectiveFrom).slice(0, 10) : new Date().toISOString().slice(0, 10),
          effectiveTo ? String(effectiveTo).slice(0, 10) : null,
          req.user.userId
        ]
      );
      await writeAudit(client, {
        userId: req.user.userId,
        action: 'FARE_RULE_UPSERTED',
        entity: 'sm_fare_rules',
        entityId: ins.rows[0].id,
        metadata: { ruleKey },
        req
      });
      return res.status(201).json({ fareRule: ins.rows[0] });
    } catch (e) {
      return res.status(500).json({ message: 'Failed.', error: e.message });
    } finally {
      client.release();
    }
  });

  router.get('/commission-rules', requireAuth, requireRoles(...ROLES_SALES_FIN), async (_req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM sm_commission_rules ORDER BY priority ASC, created_at DESC`);
      return res.json({ rules: r.rows });
    } catch (e) {
      return res.status(500).json({ message: 'Failed.', error: e.message });
    }
  });

  router.post('/commission-rules', requireAuth, requireRoles(...ROLES_SALES), async (req, res) => {
    const { ruleType, channelCode, originAirport, destAirport, promoCodeId, commissionPercent, priority, active } =
      req.body;
    if (!ruleType || commissionPercent == null) {
      return res.status(400).json({ message: 'ruleType and commissionPercent required.' });
    }
    const client = await pool.connect();
    try {
      const ins = await client.query(
        `INSERT INTO sm_commission_rules (rule_type, channel_code, origin_airport, dest_airport, promo_code_id, commission_percent, priority, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          String(ruleType).toUpperCase().slice(0, 24),
          channelCode ? String(channelCode).slice(0, 40) : null,
          originAirport ? String(originAirport).toUpperCase().slice(0, 10) : null,
          destAirport ? String(destAirport).toUpperCase().slice(0, 10) : null,
          promoCodeId && isUuid(String(promoCodeId)) ? promoCodeId : null,
          Number(commissionPercent),
          priority != null ? Number(priority) : 100,
          active !== false
        ]
      );
      await writeAudit(client, {
        userId: req.user.userId,
        action: 'COMMISSION_RULE_CREATED',
        entity: 'sm_commission_rules',
        entityId: ins.rows[0].id,
        metadata: { ruleType },
        req
      });
      return res.status(201).json({ rule: ins.rows[0] });
    } catch (e) {
      return res.status(500).json({ message: 'Failed.', error: e.message });
    } finally {
      client.release();
    }
  });

  router.get('/automation-rules', requireAuth, requireRoles(...ROLES_SALES), async (_req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM sm_automation_rules ORDER BY created_at DESC LIMIT 100`);
      return res.json({ rules: r.rows });
    } catch (e) {
      return res.status(500).json({ message: 'Failed.', error: e.message });
    }
  });

  router.post('/automation-rules', requireAuth, requireRoles(...ROLES_SALES), async (req, res) => {
    const { triggerCode, channel, campaignId, templateKey, scheduleCron, active, metadataJson } = req.body;
    if (!triggerCode) return res.status(400).json({ message: 'triggerCode required.' });
    try {
      const ins = await pool.query(
        `INSERT INTO sm_automation_rules (trigger_code, channel, campaign_id, template_key, schedule_cron, active, metadata_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
        [
          String(triggerCode).slice(0, 48),
          String(channel || 'EMAIL').toUpperCase(),
          campaignId && isUuid(String(campaignId)) ? campaignId : null,
          templateKey ? String(templateKey).slice(0, 120) : null,
          scheduleCron ? String(scheduleCron).slice(0, 80) : null,
          active !== false,
          JSON.stringify(metadataJson || {})
        ]
      );
      return res.status(201).json({ rule: ins.rows[0] });
    } catch (e) {
      return res.status(500).json({ message: 'Failed.', error: e.message });
    }
  });

  router.get('/route-profitability', requireAuth, requireRoles(...ROLES_SALES_FIN), async (req, res) => {
    const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
    const to = String(req.query.to || new Date().toISOString().slice(0, 10));
    try {
      const r = await pool.query(
        `SELECT * FROM sm_route_profitability WHERE period_start >= $1::date AND period_end <= $2::date ORDER BY revenue DESC`,
        [from, to]
      );
      return res.json({ rows: r.rows, from, to });
    } catch (e) {
      return res.status(500).json({ message: 'Failed.', error: e.message });
    }
  });

  router.post(
    '/route-profitability/recompute',
    requireAuth,
    requireRoles(...ROLES_SALES),
    async (req, res) => {
      const from = String(req.body?.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
      const to = String(req.body?.to || new Date().toISOString().slice(0, 10));
      try {
        await pool.query(`DELETE FROM sm_route_profitability WHERE period_start = $1::date AND period_end = $2::date`, [
          from,
          to
        ]);
        await pool.query(
          `INSERT INTO sm_route_profitability (
             period_start, period_end, origin_airport, dest_airport, revenue, cost_estimate, bookings, passengers, load_factor, yield_per_pax
           )
           SELECT $1::date, $2::date,
                  upper(trim(f.departure_airport)),
                  upper(trim(f.arrival_airport)),
                  COALESCE(SUM(bf.fare_amount), 0)::numeric,
                  0::numeric,
                  COUNT(DISTINCT b.id)::int,
                  COUNT(DISTINCT bp.passenger_id)::int,
                  NULL::numeric,
                  CASE WHEN COUNT(DISTINCT bp.passenger_id) = 0 THEN 0::numeric
                       ELSE (COALESCE(SUM(bf.fare_amount), 0) / NULLIF(COUNT(DISTINCT bp.passenger_id), 0))::numeric END
           FROM booking_flights bf
           JOIN flights f ON f.id = bf.flight_id
           JOIN bookings b ON b.id = bf.booking_id AND upper(trim(COALESCE(b.booking_status, ''))) <> 'CANCELLED'
           JOIN booking_passengers bp ON bp.booking_id = b.id
           WHERE DATE(b.created_at) BETWEEN $1::date AND $2::date
           GROUP BY upper(trim(f.departure_airport)), upper(trim(f.arrival_airport))`,
          [from, to]
        );
        return res.json({ message: 'Route profitability snapshot stored.', from, to });
      } catch (e) {
        return res.status(500).json({ message: 'Recompute failed.', error: e.message });
      }
    }
  );

  router.get('/reports/sales-export', requireAuth, requireRoles(...ROLES_SALES_FIN), async (req, res) => {
    const format = String(req.query.format || 'csv').toLowerCase();
    const from = String(req.query.from || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
    const to = String(req.query.to || new Date().toISOString().slice(0, 10));
    try {
      const r = await pool.query(
        `SELECT b.pnr, b.created_at::text, b.total_amount, b.currency, b.sales_channel_code, b.payment_status, b.booking_status
         FROM bookings b
         WHERE b.created_at::date BETWEEN $1::date AND $2::date
         ORDER BY b.created_at DESC LIMIT 5000`,
        [from, to]
      );
      if (format === 'csv') {
        const cols = ['pnr', 'created_at', 'total_amount', 'currency', 'sales_channel_code', 'payment_status', 'booking_status'];
        const lines = [cols.join(',')];
        for (const row of r.rows) {
          lines.push(cols.map((c) => csvEscape(row[c])).join(','));
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="hams-sales-${from}_${to}.csv"`);
        return res.send(lines.join('\n'));
      }
      return res.json({ from, to, rows: r.rows });
    } catch (e) {
      return res.status(500).json({ message: 'Export failed.', error: e.message });
    }
  });
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
