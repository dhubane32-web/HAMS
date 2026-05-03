import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import { userHasAnyRole } from '../../lib/roles.js';
import { ROLES_FINANCE_ORG, ROLES_REFUND_QUEUE, ROLES_REFUND_REQUEST } from '../../lib/airlineRbac.js';
import { logFinanceTransaction } from '../../services/financeLedger.js';
import { syncBookingPaymentStatus } from '../../services/bookingPaymentSync.js';

const router = express.Router();

function canViewAllFinance(role) {
  return userHasAnyRole(role, ['admin', 'finance', 'sales_manager']);
}

function isDeskRefundRequester(role) {
  return role === 'agent' || role === 'booking_agent';
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

router.get('/health', (_req, res) => {
  res.json({ module: 'finance', status: 'ready' });
});

/** Summary cards: finance leadership and admin (desk agents use booking module, not finance dashboard). */
router.get('/dashboard', requireAuth, requireRoles(...ROLES_FINANCE_ORG), async (req, res) => {
  const role = req.user.role;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  try {
    const settled = await Promise.allSettled([
      pool.query(
        `SELECT COALESCE(SUM(p.amount - COALESCE(rf.refunded, 0)), 0)::numeric AS v
         FROM payments p
         JOIN bookings b ON b.id = p.booking_id
         LEFT JOIN (SELECT payment_id, SUM(refund_amount)::numeric AS refunded FROM refunds GROUP BY payment_id) rf ON rf.payment_id = p.id
         WHERE DATE(p.processed_at) = DATE($1::date)
           AND UPPER(TRIM(p.payment_status)) IN ('PAID', 'SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED')`,
        [today]
      ),
      pool.query(
        `SELECT COALESCE(SUM(r.refund_amount), 0)::numeric AS v
         FROM refunds r
         JOIN payments p ON p.id = r.payment_id
         JOIN bookings b ON b.id = p.booking_id
         WHERE DATE(r.refunded_at) = DATE($1::date)`,
        [today]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c, COALESCE(SUM(b.total_amount), 0)::numeric AS gross
         FROM bookings b
         WHERE UPPER(TRIM(b.booking_status)) <> 'CANCELLED'
           AND UPPER(TRIM(b.payment_status)) IN ('UNPAID', 'PARTIALLY_PAID')`,
        []
      ),
      canViewAllFinance(role)
        ? pool.query(`SELECT COUNT(*)::int AS c FROM refund_requests WHERE status = 'PENDING'`)
        : Promise.resolve({ rows: [{ c: 0 }] }),
      pool.query(
        `SELECT COALESCE(SUM(bf.fare_amount), 0)::numeric AS v
         FROM tickets t
         JOIN bookings b ON b.id = t.booking_id
         JOIN booking_flights bf ON bf.booking_id = b.id
         WHERE t.issued_at >= $1::date
           AND t.issued_at < ($1::date + INTERVAL '1 month')`,
        [monthStart]
      ),
      canViewAllFinance(role)
        ? pool.query(
            `SELECT COALESCE(SUM(amount), 0)::numeric AS v FROM finance_expenses
             WHERE incurred_on >= $1::date AND incurred_on < ($1::date + INTERVAL '1 month')`,
            [monthStart]
          )
        : Promise.resolve({ rows: [{ v: 0 }] })
    ]);

    const rowV = (i) => {
      const r = settled[i];
      if (r.status === 'fulfilled' && r.value?.rows?.[0]?.v != null) return Number(r.value.rows[0].v);
      if (r.status === 'rejected') console.warn('[finance/dashboard] query failed:', r.reason?.message || r.reason);
      return 0;
    };
    const rowOutstanding = (i) => {
      const r = settled[i];
      if (r.status === 'fulfilled' && r.value?.rows?.[0]) {
        return { c: Number(r.value.rows[0].c || 0), gross: Number(r.value.rows[0].gross || 0) };
      }
      if (r.status === 'rejected') console.warn('[finance/dashboard] query failed:', r.reason?.message || r.reason);
      return { c: 0, gross: 0 };
    };
    const rowCount = (i) => {
      const r = settled[i];
      if (r.status === 'fulfilled' && r.value?.rows?.[0]?.c != null) return Number(r.value.rows[0].c);
      if (r.status === 'rejected') console.warn('[finance/dashboard] query failed:', r.reason?.message || r.reason);
      return 0;
    };

    const payToday = rowV(0);
    const refToday = rowV(1);
    const out = rowOutstanding(2);
    const pendingRefunds = rowCount(3);
    const ticketMonth = rowV(4);
    const expensesMonth = rowV(5);

    return res.status(200).json({
      asOf: today,
      scope: 'organization',
      cards: {
        netPaymentsToday: payToday - refToday,
        refundsToday: refToday,
        outstandingBookings: out.c,
        outstandingGrossAmount: out.gross,
        pendingRefundRequests: pendingRefunds,
        ticketLinkedFareMonth: ticketMonth,
        expensesMonth
      }
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load finance dashboard.', error: error.message });
  }
});

router.get(
  '/payments',
  requireAuth,
  requireRoles(...ROLES_FINANCE_ORG),
  async (req, res) => {
    const { date, status, export: exportCsv } = req.query;

    try {
      const filters = [];
      const values = [];
      if (date) {
        values.push(date);
        filters.push(`DATE(p.processed_at) = DATE($${values.length})`);
      }
      if (status) {
        values.push(String(status).toUpperCase());
        filters.push(`UPPER(TRIM(p.payment_status)) = $${values.length}`);
      }

      const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

      const payments = await pool.query(
        `SELECT
          p.id,
          p.booking_id,
          b.pnr,
          b.created_by AS booking_created_by,
          p.payment_type,
          p.amount,
          p.currency,
          p.payment_status,
          p.transaction_ref,
          p.processed_at
        FROM payments p
        LEFT JOIN bookings b ON b.id = p.booking_id
        ${whereClause}
        ORDER BY p.processed_at DESC
        LIMIT 2000`,
        values
      );

      if (exportCsv === 'csv' || exportCsv === '1') {
        return sendCsv(
          res,
          'payments.csv',
          ['id', 'booking_id', 'pnr', 'payment_type', 'amount', 'currency', 'payment_status', 'transaction_ref', 'processed_at'],
          payments.rows.map((r) => [
            r.id,
            r.booking_id,
            r.pnr,
            r.payment_type,
            r.amount,
            r.currency,
            r.payment_status,
            r.transaction_ref,
            r.processed_at
          ])
        );
      }

      return res.status(200).json({ payments: payments.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to retrieve payments.', error: error.message });
    }
  }
);

router.get(
  '/ledger',
  requireAuth,
  requireRoles('admin', 'finance'),
  async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    try {
      const r = await pool.query(
        `SELECT ft.*, u.full_name AS created_by_name
         FROM finance_transactions ft
         LEFT JOIN users u ON u.id = ft.created_by
         ORDER BY ft.created_at DESC
         LIMIT $1`,
        [limit]
      );
      return res.status(200).json({ transactions: r.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load ledger.', error: error.message });
    }
  }
);

router.post(
  '/expenses',
  requireAuth,
  requireRoles('admin', 'finance'),
  async (req, res) => {
    const { category, amount, currency, incurredOn, description, reference, flightId } = req.body;
    const amt = Number(amount);
    if (!category || !Number.isFinite(amt) || amt <= 0 || !incurredOn) {
      return res.status(400).json({ message: 'category, amount, and incurredOn are required.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO finance_expenses (category, amount, currency, incurred_on, description, reference, flight_id, entered_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          String(category).slice(0, 60),
          amt,
          String(currency || 'USD').slice(0, 3).toUpperCase(),
          String(incurredOn).slice(0, 10),
          description ? String(description).slice(0, 4000) : null,
          reference ? String(reference).slice(0, 120) : null,
          flightId && /^[0-9a-f-]{36}$/i.test(String(flightId)) ? flightId : null,
          req.user.userId
        ]
      );
      await logFinanceTransaction(client, {
        txnType: 'EXPENSE_RECORDED',
        amount: amt,
        currency: ins.rows[0].currency,
        expenseId: ins.rows[0].id,
        description: `Expense: ${category}`,
        metadata: { category, flightId: ins.rows[0].flight_id },
        userId: req.user.userId
      });
      await client.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.userId, 'FINANCE_EXPENSE', 'finance_expenses', ins.rows[0].id, JSON.stringify({ amount: amt })]
      );
      await client.query('COMMIT');
      return res.status(201).json({ expense: ins.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: 'Failed to record expense.', error: error.message });
    } finally {
      client.release();
    }
  }
);

router.get('/expenses', requireAuth, requireRoles('admin', 'finance'), async (req, res) => {
  const from = req.query.from ? String(req.query.from) : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const to = req.query.to ? String(req.query.to) : new Date().toISOString().slice(0, 10);
  try {
    const r = await pool.query(
      `SELECT e.*, u.full_name AS entered_by_name
       FROM finance_expenses e
       JOIN users u ON u.id = e.entered_by
       WHERE e.incurred_on >= $1::date AND e.incurred_on <= $2::date
       ORDER BY e.incurred_on DESC, e.created_at DESC
       LIMIT 2000`,
      [from, to]
    );
    return res.status(200).json({ from, to, expenses: r.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to list expenses.', error: error.message });
  }
});

router.post(
  '/refund-requests',
  requireAuth,
  requireRoles(...ROLES_REFUND_REQUEST),
  async (req, res) => {
    const { paymentId, refundAmount, reason } = req.body;
    const amount = Number(refundAmount);
    if (!paymentId || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'paymentId and a valid positive refundAmount are required.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const pay = await client.query(
        `SELECT p.id, p.amount, p.currency, p.booking_id, p.payment_status, b.created_by
         FROM payments p
         JOIN bookings b ON b.id = p.booking_id
         WHERE p.id = $1`,
        [paymentId]
      );
      const p = pay.rows[0];
      if (!p) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Payment not found.' });
      }
      if (isDeskRefundRequester(req.user.role) && String(p.created_by) !== String(req.user.userId)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ message: 'You can only request refunds for your own sales.' });
      }

      const refundedSoFar = await client.query(
        `SELECT COALESCE(SUM(refund_amount), 0)::numeric AS v FROM refunds WHERE payment_id = $1`,
        [paymentId]
      );
      const remaining = Number(p.amount) - Number(refundedSoFar.rows[0].v);
      if (amount > remaining) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Refund amount exceeds remaining refundable balance.', remainingRefundable: remaining });
      }

      const pend = await client.query(
        `SELECT 1 FROM refund_requests WHERE payment_id = $1 AND status = 'PENDING'`,
        [paymentId]
      );
      if (pend.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'A pending refund request already exists for this payment.' });
      }

      const ins = await client.query(
        `INSERT INTO refund_requests (payment_id, amount, currency, reason, status, requested_by)
         VALUES ($1, $2, $3, $4, 'PENDING', $5)
         RETURNING *`,
        [paymentId, amount, p.currency || 'USD', reason ? String(reason).slice(0, 2000) : null, req.user.userId]
      );

      await logFinanceTransaction(client, {
        txnType: 'REFUND_REQUESTED',
        amount,
        currency: p.currency,
        bookingId: p.booking_id,
        paymentId,
        refundRequestId: ins.rows[0].id,
        description: 'Refund approval requested',
        metadata: { reason: reason || null },
        userId: req.user.userId
      });

      await client.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.userId, 'REFUND_REQUEST_CREATED', 'refund_requests', ins.rows[0].id, JSON.stringify({ paymentId, amount })]
      );

      await client.query('COMMIT');
      return res.status(201).json({ refundRequest: ins.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: 'Failed to create refund request.', error: error.message });
    } finally {
      client.release();
    }
  }
);

router.get('/refund-requests', requireAuth, requireRoles(...ROLES_REFUND_QUEUE), async (req, res) => {
  const status = req.query.status ? String(req.query.status).toUpperCase() : null;
  const role = req.user.role;
  try {
    const filters = [];
    const vals = [];
    if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      vals.push(status);
      filters.push(`rr.status = $${vals.length}`);
    }
    if (isDeskRefundRequester(role)) {
      vals.push(req.user.userId);
      filters.push(`rr.requested_by = $${vals.length}::uuid`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT rr.*, p.booking_id, b.pnr, rq_user.full_name AS requested_by_name
       FROM refund_requests rr
       JOIN payments p ON p.id = rr.payment_id
       JOIN bookings b ON b.id = p.booking_id
       JOIN users rq_user ON rq_user.id = rr.requested_by
       ${where}
       ORDER BY rr.created_at DESC
       LIMIT 500`,
      vals
    );
    return res.status(200).json({ refundRequests: r.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to list refund requests.', error: error.message });
  }
});

router.post(
  '/refund-requests/:requestId/approve',
  requireAuth,
  requireRoles('admin', 'finance'),
  async (req, res) => {
    const { requestId } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rq = await client.query(`SELECT * FROM refund_requests WHERE id = $1 FOR UPDATE`, [requestId]);
      const row = rq.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Refund request not found.' });
      }
      if (row.status !== 'PENDING') {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Request is not pending.' });
      }

      const paymentResult = await client.query(`SELECT * FROM payments WHERE id = $1 FOR UPDATE`, [row.payment_id]);
      const payment = paymentResult.rows[0];
      if (!payment) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Payment not found.' });
      }
      if (String(payment.payment_status).toUpperCase() === 'REFUNDED') {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Payment already fully refunded.' });
      }

      const refundedSoFar = await client.query(
        `SELECT COALESCE(SUM(refund_amount), 0)::numeric AS v FROM refunds WHERE payment_id = $1`,
        [row.payment_id]
      );
      const remaining = Number(payment.amount) - Number(refundedSoFar.rows[0].v);
      const amount = Number(row.amount);
      if (amount > remaining) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Request amount no longer valid.', remainingRefundable: remaining });
      }

      const refundResult = await client.query(
        `INSERT INTO refunds (payment_id, refund_amount, reason, approved_by, refund_request_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, payment_id, refund_amount, reason, refunded_at`,
        [row.payment_id, amount, row.reason, req.user.userId, row.id]
      );

      const newRefundedTotal = Number(refundedSoFar.rows[0].v) + amount;
      const newStatus = newRefundedTotal >= Number(payment.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      await client.query(`UPDATE payments SET payment_status = $1 WHERE id = $2`, [newStatus, row.payment_id]);

      await client.query(
        `UPDATE refund_requests
         SET status = 'APPROVED', reviewed_by = $2, reviewed_at = NOW()
         WHERE id = $1`,
        [requestId, req.user.userId]
      );

      await logFinanceTransaction(client, {
        txnType: 'REFUND_EXECUTED',
        amount: -Math.abs(amount),
        currency: payment.currency,
        bookingId: payment.booking_id,
        paymentId: payment.id,
        refundId: refundResult.rows[0].id,
        refundRequestId: row.id,
        description: 'Refund approved and processed',
        metadata: { paymentStatus: newStatus },
        userId: req.user.userId
      });

      await syncBookingPaymentStatus(client, payment.booking_id);

      await client.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          req.user.userId,
          'REFUND_APPROVED',
          'payments',
          row.payment_id,
          JSON.stringify({ refundRequestId: requestId, refundAmount: amount })
        ]
      );

      await client.query('COMMIT');
      return res.status(200).json({
        message: 'Refund approved and processed.',
        refund: refundResult.rows[0],
        paymentStatus: newStatus
      });
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: 'Failed to approve refund.', error: error.message });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/refund-requests/:requestId/reject',
  requireAuth,
  requireRoles('admin', 'finance'),
  async (req, res) => {
    const { requestId } = req.params;
    const { reason } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rq = await client.query(`SELECT * FROM refund_requests WHERE id = $1 FOR UPDATE`, [requestId]);
      const row = rq.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Refund request not found.' });
      }
      if (row.status !== 'PENDING') {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Request is not pending.' });
      }
      await client.query(
        `UPDATE refund_requests
         SET status = 'REJECTED', reviewed_by = $2, reviewed_at = NOW(), rejection_reason = $3
         WHERE id = $1`,
        [requestId, req.user.userId, reason ? String(reason).slice(0, 2000) : null]
      );
      await logFinanceTransaction(client, {
        txnType: 'REFUND_REJECTED',
        amount: null,
        currency: row.currency,
        refundRequestId: row.id,
        paymentId: row.payment_id,
        description: 'Refund request rejected',
        metadata: { reason: reason || null },
        userId: req.user.userId
      });
      await client.query('COMMIT');
      return res.status(200).json({ message: 'Refund request rejected.' });
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: 'Failed to reject refund.', error: error.message });
    } finally {
      client.release();
    }
  }
);

router.post('/refunds', requireAuth, requireRoles('admin', 'finance'), async (_req, res) => {
  return res.status(400).json({
    message:
      'Direct refunds are disabled. Create a refund request (POST /api/finance/refund-requests), then a finance user approves it (POST /api/finance/refund-requests/:id/approve).'
  });
});

router.get('/reports/daily', requireAuth, requireRoles(...ROLES_FINANCE_ORG), async (req, res) => {
  const reportDate = String(req.query.date || new Date().toISOString().slice(0, 10));

  try {
    const totalsResult = await pool.query(
      `SELECT COALESCE(SUM(p.amount - COALESCE(rf.refunded, 0)), 0)::numeric AS total_collected, COUNT(*)::int AS payment_count
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       LEFT JOIN (SELECT payment_id, SUM(refund_amount)::numeric AS refunded FROM refunds GROUP BY payment_id) rf ON rf.payment_id = p.id
       WHERE DATE(p.processed_at) = DATE($1::date)
         AND UPPER(TRIM(p.payment_status)) IN ('PAID', 'SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED')`,
      [reportDate]
    );

    const refundsResult = await pool.query(
      `SELECT COALESCE(SUM(r.refund_amount), 0)::numeric AS total_refunded, COUNT(*)::int AS refund_count
       FROM refunds r
       JOIN payments p ON p.id = r.payment_id
       JOIN bookings b ON b.id = p.booking_id
       WHERE DATE(r.refunded_at) = DATE($1::date)`,
      [reportDate]
    );

    const totalCollected = Number(totalsResult.rows[0].total_collected);
    const totalRefunded = Number(refundsResult.rows[0].total_refunded);

    return res.status(200).json({
      date: reportDate,
      totals: {
        totalCollected,
        totalRefunded,
        netRevenue: totalCollected - totalRefunded,
        paymentCount: Number(totalsResult.rows[0].payment_count),
        refundCount: Number(refundsResult.rows[0].refund_count)
      }
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to generate daily finance report.', error: error.message });
  }
});

router.get('/reports/cash', requireAuth, requireRoles(...ROLES_FINANCE_ORG), async (req, res) => {
  const from = String(req.query.from || new Date().toISOString().slice(0, 10));
  const to = String(req.query.to || from);

  try {
    const rows = await pool.query(
      `SELECT DATE(p.processed_at)::text AS day,
              COALESCE(SUM(CASE WHEN UPPER(TRIM(p.payment_status)) IN ('PAID','SUCCESS') THEN p.amount ELSE 0 END), 0)::numeric AS gross_in,
              COALESCE(SUM(CASE WHEN UPPER(TRIM(p.payment_status)) IN ('PARTIALLY_REFUNDED','REFUNDED') THEN p.amount ELSE 0 END), 0)::numeric AS other_payment_rows
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       WHERE DATE(p.processed_at) >= DATE($1::date) AND DATE(p.processed_at) <= DATE($2::date)
       GROUP BY DATE(p.processed_at)
       ORDER BY day ASC`,
      [from, to]
    );

    const refunds = await pool.query(
      `SELECT DATE(r.refunded_at)::text AS day, COALESCE(SUM(r.refund_amount), 0)::numeric AS out
       FROM refunds r
       JOIN payments p ON p.id = r.payment_id
       JOIN bookings b ON b.id = p.booking_id
       WHERE DATE(r.refunded_at) >= DATE($1::date) AND DATE(r.refunded_at) <= DATE($2::date)
       GROUP BY DATE(r.refunded_at)
       ORDER BY day ASC`,
      [from, to]
    );

    return res.status(200).json({ from, to, paymentsByDay: rows.rows, refundsByDay: refunds.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to build cash report.', error: error.message });
  }
});

router.get('/reports/outstanding-balances', requireAuth, requireRoles(...ROLES_FINANCE_ORG), async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT b.id, b.pnr, b.total_amount, b.currency, b.payment_status, b.booking_status, b.created_at,
              u.full_name AS agent_name,
              COALESCE(SUM(bf.fare_amount), 0)::numeric AS itinerary_fare_sum
       FROM bookings b
       LEFT JOIN users u ON u.id = b.created_by
       LEFT JOIN booking_flights bf ON bf.booking_id = b.id
       WHERE UPPER(TRIM(b.booking_status)) <> 'CANCELLED'
         AND UPPER(TRIM(b.payment_status)) IN ('UNPAID', 'PARTIALLY_PAID')
       GROUP BY b.id, u.full_name
       ORDER BY b.created_at DESC
       LIMIT 2000`,
      []
    );
    return res.status(200).json({ bookings: r.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load outstanding balances.', error: error.message });
  }
});

router.get('/reports/agent-sales', requireAuth, requireRoles(...ROLES_FINANCE_ORG), async (req, res) => {
  const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const to = String(req.query.to || new Date().toISOString().slice(0, 10));
  const agentId = req.query.agentId ? String(req.query.agentId) : null;
  const role = req.user.role;

  let filterAgent = null;
  if (agentId && canViewAllFinance(role)) filterAgent = agentId;

  try {
    const vals = [from, to];
    let extra = '';
    if (filterAgent) {
      vals.push(filterAgent);
      extra = `AND b.created_by = $${vals.length}::uuid`;
    }

    const sales = await pool.query(
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
         AND u.role::text IN ('agent', 'booking_agent')
         ${extra}
       GROUP BY b.created_by, u.full_name
       ORDER BY booked_gross DESC NULLS LAST`,
      vals
    );

    return res.status(200).json({ from, to, agentSales: sales.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load agent sales.', error: error.message });
  }
});

router.get('/reports/daily-revenue', requireAuth, requireRoles(...ROLES_FINANCE_ORG), async (req, res) => {
  const from = String(req.query.from || new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10));
  const to = String(req.query.to || new Date().toISOString().slice(0, 10));

  try {
    const r = await pool.query(
      `SELECT DATE(p.processed_at)::text AS day,
              COALESCE(SUM(p.amount - COALESCE(rf.refunded, 0)), 0)::numeric AS net_collected
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       LEFT JOIN (SELECT payment_id, SUM(refund_amount)::numeric AS refunded FROM refunds GROUP BY payment_id) rf ON rf.payment_id = p.id
       WHERE DATE(p.processed_at) >= DATE($1::date) AND DATE(p.processed_at) <= DATE($2::date)
         AND UPPER(TRIM(p.payment_status)) IN ('PAID', 'SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED')
       GROUP BY DATE(p.processed_at)
       ORDER BY day ASC`,
      [from, to]
    );
    return res.status(200).json({ from, to, series: r.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load daily revenue.', error: error.message });
  }
});

router.get('/reports/route-revenue', requireAuth, requireRoles(...ROLES_FINANCE_ORG), async (req, res) => {
  const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const to = String(req.query.to || new Date().toISOString().slice(0, 10));

  try {
    const r = await pool.query(
      `SELECT f.departure_airport || '→' || f.arrival_airport AS route,
              COALESCE(SUM(bf.fare_amount), 0)::numeric AS ticket_fare_sum,
              COUNT(DISTINCT b.id)::int AS booking_count
       FROM booking_flights bf
       JOIN flights f ON f.id = bf.flight_id
       JOIN bookings b ON b.id = bf.booking_id
       WHERE DATE(b.created_at) >= DATE($1::date) AND DATE(b.created_at) <= DATE($2::date)
       GROUP BY f.departure_airport, f.arrival_airport
       ORDER BY ticket_fare_sum DESC`,
      [from, to]
    );
    return res.status(200).json({ from, to, routes: r.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load route revenue.', error: error.message });
  }
});

router.get('/reports/ticket-revenue', requireAuth, requireRoles(...ROLES_FINANCE_ORG), async (req, res) => {
  const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const to = String(req.query.to || new Date().toISOString().slice(0, 10));

  try {
    const r2 = await pool.query(
      `SELECT DATE(t.issued_at)::text AS day,
              COUNT(*)::int AS tickets_issued,
              COALESCE(SUM(bf.fare_amount), 0)::numeric AS itinerary_fare_on_issued_bookings
       FROM tickets t
       JOIN bookings b ON b.id = t.booking_id
       JOIN booking_flights bf ON bf.booking_id = b.id
       WHERE DATE(t.issued_at) >= DATE($1::date) AND DATE(t.issued_at) <= DATE($2::date)
       GROUP BY DATE(t.issued_at)
       ORDER BY day ASC`,
      [from, to]
    );
    return res.status(200).json({ from, to, byDay: r2.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load ticket revenue.', error: error.message });
  }
});

router.get('/reports/flight-profitability', requireAuth, requireRoles(...ROLES_FINANCE_ORG), async (req, res) => {
  const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const to = String(req.query.to || new Date().toISOString().slice(0, 10));

  try {
    const r = await pool.query(
      `SELECT f.id AS flight_id, f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time,
              (SELECT COALESCE(SUM(bf2.fare_amount), 0)::numeric
               FROM booking_flights bf2
               JOIN bookings b2 ON b2.id = bf2.booking_id
               WHERE bf2.flight_id = f.id
                 AND UPPER(TRIM(COALESCE(b2.booking_status, ''))) <> 'CANCELLED') AS revenue_from_bookings,
              (SELECT COALESCE(SUM(e2.amount), 0)::numeric
               FROM finance_expenses e2
               WHERE e2.flight_id = f.id
                 AND e2.incurred_on >= DATE($1::date)
                 AND e2.incurred_on <= DATE($2::date)) AS direct_expenses
       FROM flights f
       WHERE DATE(f.departure_time) >= DATE($1::date) AND DATE(f.departure_time) <= DATE($2::date)
       ORDER BY f.departure_time ASC`,
      [from, to]
    );
    const rows = r.rows.map((x) => ({
      ...x,
      estimated_margin: Number(x.revenue_from_bookings) - Number(x.direct_expenses)
    }));
    return res.status(200).json({ from, to, flights: rows, note: 'Margin is fare sum minus expenses tagged to the flight in this period.' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load flight profitability.', error: error.message });
  }
});

router.get('/reports/sales-reconciliation', requireAuth, requireRoles(...ROLES_FINANCE_ORG), async (req, res) => {
  const from = String(req.query.from || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const to = String(req.query.to || new Date().toISOString().slice(0, 10));

  try {
    const booked = await pool.query(
      `SELECT COALESCE(SUM(bf.fare_amount), 0)::numeric AS v
       FROM booking_flights bf
       JOIN bookings b ON b.id = bf.booking_id
       WHERE DATE(b.created_at) >= DATE($1::date) AND DATE(b.created_at) <= DATE($2::date)
         AND UPPER(TRIM(b.booking_status)) <> 'CANCELLED'`,
      [from, to]
    );
    const collected = await pool.query(
      `SELECT COALESCE(SUM(p.amount - COALESCE(rf.refunded, 0)), 0)::numeric AS v
       FROM payments p
       LEFT JOIN (SELECT payment_id, SUM(refund_amount)::numeric AS refunded FROM refunds GROUP BY payment_id) rf ON rf.payment_id = p.id
       JOIN bookings b ON b.id = p.booking_id
       WHERE DATE(p.processed_at) >= DATE($1::date) AND DATE(p.processed_at) <= DATE($2::date)
         AND UPPER(TRIM(p.payment_status)) IN ('PAID', 'SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED')`,
      [from, to]
    );
    const bBooked = Number(booked.rows[0].v);
    const bCollected = Number(collected.rows[0].v);
    return res.status(200).json({
      from,
      to,
      bookedSalesItineraryFare: bBooked,
      netPaymentsProcessedInPeriod: bCollected,
      variance: bCollected - bBooked,
      note: 'Booked sales use itinerary fare on bookings created in range; payments use processing date in range — periods differ by design.'
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to reconcile sales.', error: error.message });
  }
});

export default router;
