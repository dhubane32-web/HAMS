import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import { logFinanceTransaction } from '../../services/financeLedger.js';

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

const CASE_TYPES = ['SUPPORT', 'COMPLAINT', 'REFUND_REQUEST', 'BOOKING_CHANGE', 'LOST_BAGGAGE', 'GENERAL'];
const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

function isAdminRole(role) {
  return role === 'admin' || role === 'super_admin';
}

/** Admin: any case. Agent/CS: unassigned, assigned to self, or created by self. */
function canViewCase(user, row) {
  if (isAdminRole(user.role)) return true;
  const uid = String(user.userId);
  if (String(row.created_by) === uid) return true;
  if (row.assigned_to == null) return true;
  return String(row.assigned_to) === uid;
}

/** Admin: any. Others: unassigned (triage) or assigned to self. */
function canMutateCase(user, row) {
  if (isAdminRole(user.role)) return true;
  const uid = String(user.userId);
  if (row.assigned_to == null) return true;
  return String(row.assigned_to) === uid;
}

function nextCaseRef() {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CS-${t}-${r}`;
}

const csRoles = requireRoles('admin', 'super_admin', 'agent', 'customer_service');

router.get('/health', (_req, res) => {
  res.json({ module: 'customer-service', status: 'ready' });
});

router.get('/dashboard', requireAuth, csRoles, async (req, res) => {
  const uid = req.user.userId;
  const admin = isAdminRole(req.user.role);
  try {
    const scopeFilter = admin
      ? ''
      : `WHERE (c.assigned_to IS NULL OR c.assigned_to = $1::uuid OR c.created_by = $1::uuid)`;
    const params = admin ? [] : [uid];
    const baseFrom = `FROM cs_service_cases c ${scopeFilter}`;

    const byStatus = await pool.query(
      `SELECT c.status, COUNT(*)::int AS count ${baseFrom} GROUP BY c.status ORDER BY c.status`,
      params
    );
    const byType = await pool.query(
      `SELECT c.case_type, COUNT(*)::int AS count ${baseFrom} GROUP BY c.case_type ORDER BY c.case_type`,
      params
    );
    const openCountSql = admin
      ? `SELECT COUNT(*)::int AS count FROM cs_service_cases c WHERE c.status NOT IN ('RESOLVED', 'CLOSED')`
      : `SELECT COUNT(*)::int AS count FROM cs_service_cases c
         WHERE (c.assigned_to IS NULL OR c.assigned_to = $1::uuid OR c.created_by = $1::uuid)
           AND c.status NOT IN ('RESOLVED', 'CLOSED')`;
    const openCount = await pool.query(openCountSql, admin ? [] : [uid]);

    const summarySql = `SELECT
        COUNT(*) FILTER (WHERE c.status = 'OPEN')::int AS open,
        COUNT(*) FILTER (WHERE c.status IN ('IN_PROGRESS', 'WAITING_CUSTOMER'))::int AS pending,
        COUNT(*) FILTER (WHERE c.status = 'RESOLVED')::int AS resolved,
        COUNT(*) FILTER (WHERE c.status = 'CLOSED')::int AS closed
      FROM cs_service_cases c ${scopeFilter}`;
    const summary = await pool.query(summarySql, params);

    let refundsPending = { rows: [{ count: 0 }] };
    try {
      refundsPending = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM cs_service_cases c
         INNER JOIN refund_requests rr ON rr.id = c.refund_request_id
         WHERE rr.status = 'PENDING'
           ${admin ? '' : 'AND (c.assigned_to IS NULL OR c.assigned_to = $1::uuid OR c.created_by = $1::uuid)'}`,
        admin ? [] : [uid]
      );
    } catch {
      refundsPending = { rows: [{ count: 0 }] };
    }

    const s = summary.rows[0] || {};
    return res.status(200).json({
      scope: admin ? 'all' : 'queue',
      byStatus: byStatus.rows,
      byType: byType.rows,
      openCases: openCount.rows[0]?.count ?? 0,
      summary: {
        open: s.open ?? 0,
        pending: s.pending ?? 0,
        resolved: s.resolved ?? 0,
        closed: s.closed ?? 0
      },
      refundRequestsPendingLinked: refundsPending.rows[0]?.count ?? 0
    });
  } catch (error) {
    return res.status(500).json({ message: 'Dashboard failed.', error: error.message });
  }
});

router.get('/passengers/:passengerId/profile', requireAuth, csRoles, async (req, res) => {
  const { passengerId } = req.params;
  if (!isUuid(passengerId)) {
    return res.status(400).json({ message: 'Invalid passenger id.' });
  }
  try {
    const p = await pool.query(
      `SELECT id, first_name, last_name, email, phone, nationality, travel_status, created_at
       FROM passengers WHERE id = $1`,
      [passengerId]
    );
    if (p.rowCount === 0) {
      return res.status(404).json({ message: 'Passenger not found.' });
    }
    const prof = await pool.query(`SELECT * FROM cs_customer_profiles WHERE passenger_id = $1`, [passengerId]);
    return res.status(200).json({ passenger: p.rows[0], profile: prof.rows[0] || null });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load profile.', error: error.message });
  }
});

router.put('/passengers/:passengerId/profile', requireAuth, csRoles, async (req, res) => {
  const { passengerId } = req.params;
  if (!isUuid(passengerId)) {
    return res.status(400).json({ message: 'Invalid passenger id.' });
  }
  const { preferredLanguage, vipFlag, serviceNotes, preferredContact } = req.body;
  try {
    const ex = await pool.query(`SELECT 1 FROM passengers WHERE id = $1`, [passengerId]);
    if (ex.rowCount === 0) {
      return res.status(404).json({ message: 'Passenger not found.' });
    }
    const r = await pool.query(
      `INSERT INTO cs_customer_profiles (passenger_id, preferred_language, vip_flag, service_notes, preferred_contact, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (passenger_id) DO UPDATE SET
         preferred_language = COALESCE(EXCLUDED.preferred_language, cs_customer_profiles.preferred_language),
         vip_flag = COALESCE(EXCLUDED.vip_flag, cs_customer_profiles.vip_flag),
         service_notes = COALESCE(EXCLUDED.service_notes, cs_customer_profiles.service_notes),
         preferred_contact = COALESCE(EXCLUDED.preferred_contact, cs_customer_profiles.preferred_contact),
         updated_at = NOW()
       RETURNING *`,
      [
        passengerId,
        preferredLanguage != null ? String(preferredLanguage).slice(0, 20) : null,
        typeof vipFlag === 'boolean' ? vipFlag : null,
        serviceNotes != null ? String(serviceNotes).slice(0, 8000) : null,
        preferredContact != null ? String(preferredContact).slice(0, 40) : null
      ]
    );
    return res.status(200).json({ profile: r.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save profile.', error: error.message });
  }
});

router.get('/passengers/:passengerId/history', requireAuth, csRoles, async (req, res) => {
  const { passengerId } = req.params;
  if (!isUuid(passengerId)) {
    return res.status(400).json({ message: 'Invalid passenger id.' });
  }
  try {
    const ex = await pool.query(`SELECT 1 FROM passengers WHERE id = $1`, [passengerId]);
    if (ex.rowCount === 0) {
      return res.status(404).json({ message: 'Passenger not found.' });
    }
    const [bookings, tickets, checkins, baggage, cases] = await Promise.all([
      pool.query(
        `SELECT b.id, b.pnr, b.booking_status, b.total_amount, b.currency, b.created_at
         FROM bookings b
         JOIN booking_passengers bp ON bp.booking_id = b.id
         WHERE bp.passenger_id = $1
         ORDER BY b.created_at DESC
         LIMIT 100`,
        [passengerId]
      ),
      pool.query(
        `SELECT t.id, t.ticket_number, t.booking_id, t.ticket_status, t.issued_at
         FROM tickets t
         WHERE t.passenger_id = $1
         ORDER BY t.issued_at DESC
         LIMIT 100`,
        [passengerId]
      ),
      pool.query(
        `SELECT c.id, c.booking_id, c.flight_id, c.seat_number, c.checkin_time, c.boarding_pass_no, c.boarding_status,
                c.checkin_status, c.boarded_at, c.boarding_gate,
                f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time
         FROM checkins c
         JOIN flights f ON f.id = c.flight_id
         WHERE c.passenger_id = $1
         ORDER BY c.checkin_time DESC
         LIMIT 100`,
        [passengerId]
      ),
      pool.query(
        `SELECT bg.id, bg.tag_number, bg.weight_kg, bg.pieces, bg.created_at, bg.checkin_id, c.booking_id, c.flight_id
         FROM baggage bg
         JOIN checkins c ON c.id = bg.checkin_id
         WHERE c.passenger_id = $1
         ORDER BY bg.created_at DESC
         LIMIT 100`,
        [passengerId]
      ),
      pool.query(
        `SELECT c.id, c.case_ref, c.case_type, c.status, c.subject, c.booking_id, c.created_at
         FROM cs_service_cases c
         WHERE c.passenger_id = $1
         ORDER BY c.created_at DESC
         LIMIT 50`,
        [passengerId]
      )
    ]);
    const complaintHistory = cases.rows.filter((row) => String(row.case_type || '').toUpperCase() === 'COMPLAINT');
    return res.status(200).json({
      passengerId,
      bookings: bookings.rows,
      tickets: tickets.rows,
      checkins: checkins.rows,
      baggage: baggage.rows,
      serviceCases: cases.rows,
      complaintHistory
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load history.', error: error.message });
  }
});

router.get('/cases', requireAuth, csRoles, async (req, res) => {
  const uid = req.user.userId;
  const admin = isAdminRole(req.user.role);
  const status = req.query.status ? String(req.query.status).toUpperCase() : null;
  const caseType = req.query.caseType ? String(req.query.caseType).toUpperCase() : null;
  const q = req.query.q ? String(req.query.q).trim().slice(0, 80) : null;

  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ message: 'Invalid status filter.' });
  }
  if (caseType && !CASE_TYPES.includes(caseType)) {
    return res.status(400).json({ message: 'Invalid caseType filter.' });
  }

  const vals = [];
  const filters = [];
  if (!admin) {
    vals.push(uid);
    filters.push(`(c.created_by = $${vals.length}::uuid OR c.assigned_to IS NULL OR c.assigned_to = $${vals.length}::uuid)`);
  }
  if (status) {
    vals.push(status);
    filters.push(`c.status = $${vals.length}`);
  }
  if (caseType) {
    vals.push(caseType);
    filters.push(`c.case_type = $${vals.length}`);
  }
  if (q) {
    vals.push(`%${q}%`);
    filters.push(`(c.subject ILIKE $${vals.length} OR c.case_ref ILIKE $${vals.length} OR b.pnr ILIKE $${vals.length})`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  try {
    const r = await pool.query(
      `SELECT c.*,
              p.first_name AS passenger_first_name, p.last_name AS passenger_last_name,
              b.pnr AS booking_pnr,
              u.full_name AS assigned_to_name,
              cr.full_name AS created_by_name,
              rr.status AS refund_request_status,
              bg.tag_number AS baggage_tag
       FROM cs_service_cases c
       LEFT JOIN passengers p ON p.id = c.passenger_id
       LEFT JOIN bookings b ON b.id = c.booking_id
       LEFT JOIN users u ON u.id = c.assigned_to
       LEFT JOIN users cr ON cr.id = c.created_by
       LEFT JOIN refund_requests rr ON rr.id = c.refund_request_id
       LEFT JOIN baggage bg ON bg.id = c.baggage_id
       ${where}
       ORDER BY c.updated_at DESC
       LIMIT 500`,
      vals
    );
    return res.status(200).json({ cases: r.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to list cases.', error: error.message });
  }
});

router.get('/cases/:caseId', requireAuth, csRoles, async (req, res) => {
  const { caseId } = req.params;
  if (!isUuid(caseId)) {
    return res.status(400).json({ message: 'Invalid case id.' });
  }
  try {
    const r = await pool.query(
      `SELECT c.*,
              p.first_name AS passenger_first_name, p.last_name AS passenger_last_name,
              b.pnr AS booking_pnr,
              u.full_name AS assigned_to_name,
              cr.full_name AS created_by_name,
              rr.status AS refund_request_status, rr.amount AS refund_request_amount, rr.payment_id AS refund_payment_id,
              bg.tag_number AS baggage_tag
       FROM cs_service_cases c
       LEFT JOIN passengers p ON p.id = c.passenger_id
       LEFT JOIN bookings b ON b.id = c.booking_id
       LEFT JOIN users u ON u.id = c.assigned_to
       LEFT JOIN users cr ON cr.id = c.created_by
       LEFT JOIN refund_requests rr ON rr.id = c.refund_request_id
       LEFT JOIN baggage bg ON bg.id = c.baggage_id
       WHERE c.id = $1`,
      [caseId]
    );
    const row = r.rows[0];
    if (!row) {
      return res.status(404).json({ message: 'Case not found.' });
    }
    if (!canViewCase(req.user, row)) {
      return res.status(403).json({ message: 'You cannot view this case.' });
    }
    const notes = await pool.query(
      `SELECT n.*, u.full_name AS author_name
       FROM cs_case_notes n
       LEFT JOIN users u ON u.id = n.created_by
       WHERE n.case_id = $1
       ORDER BY n.created_at ASC`,
      [caseId]
    );
    return res.status(200).json({ case: row, notes: notes.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load case.', error: error.message });
  }
});

router.post('/cases', requireAuth, csRoles, async (req, res) => {
  const {
    caseType,
    subject,
    description,
    priority,
    passengerId,
    bookingId,
    baggageId,
    metadata
  } = req.body;

  const ct = caseType ? String(caseType).toUpperCase() : '';
  if (!CASE_TYPES.includes(ct)) {
    return res.status(400).json({ message: `caseType must be one of: ${CASE_TYPES.join(', ')}` });
  }
  if (!subject || typeof subject !== 'string') {
    return res.status(400).json({ message: 'subject is required.' });
  }
  const pr = priority ? String(priority).toUpperCase() : 'NORMAL';
  if (!PRIORITIES.includes(pr)) {
    return res.status(400).json({ message: 'Invalid priority.' });
  }

  let pid = passengerId && isUuid(passengerId) ? passengerId : null;
  let bid = bookingId && isUuid(bookingId) ? bookingId : null;
  let bidBag = baggageId && isUuid(baggageId) ? baggageId : null;

  const client = await pool.connect();
  try {
    if (ct === 'LOST_BAGGAGE') {
      if (!bidBag) {
        return res.status(400).json({ message: 'baggageId is required for LOST_BAGGAGE cases (check-in baggage record).' });
      }
      const bg = await loadBaggageContext(client, bidBag);
      if (!bg) {
        return res.status(404).json({ message: 'Baggage record not found.' });
      }
      pid = bg.passenger_id;
      bid = bg.booking_id;
    }

    if (ct === 'BOOKING_CHANGE' && !bid) {
      return res.status(400).json({ message: 'bookingId is required for BOOKING_CHANGE cases.' });
    }

    if (['SUPPORT', 'COMPLAINT', 'REFUND_REQUEST'].includes(ct) && !pid && !bid) {
      return res.status(400).json({ message: 'Link a passenger or booking for this case type when available.' });
    }

    if (ct === 'REFUND_REQUEST' && !bid) {
      return res.status(400).json({ message: 'bookingId is required for REFUND_REQUEST (finance links to payment/booking).' });
    }

    if (pid && bid) {
      const link = await client.query(
        `SELECT 1 FROM booking_passengers WHERE passenger_id = $1 AND booking_id = $2`,
        [pid, bid]
      );
      if (link.rowCount === 0) {
        return res.status(400).json({ message: 'Passenger is not on the specified booking.' });
      }
    } else if (pid && !bid && bidBag) {
      /* baggage path already set bid */
    } else if (bid && !pid && ct !== 'BOOKING_CHANGE') {
      /* ok — booking-level case */
    }

    if (bidBag && ct !== 'LOST_BAGGAGE') {
      const bg = await loadBaggageContext(client, bidBag);
      if (!bg) {
        return res.status(404).json({ message: 'Baggage record not found.' });
      }
      if (pid && String(bg.passenger_id) !== String(pid)) {
        return res.status(400).json({ message: 'baggageId does not match passenger check-in.' });
      }
      if (bid && String(bg.booking_id) !== String(bid)) {
        return res.status(400).json({ message: 'baggageId does not match booking check-in.' });
      }
    }

    const metaJson = metadata !== undefined && metadata !== null ? JSON.stringify(metadata) : null;

    let caseRef = nextCaseRef();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const ins = await client.query(
          `INSERT INTO cs_service_cases (
             case_ref, case_type, status, priority, passenger_id, booking_id, baggage_id,
             subject, description, metadata, assigned_to, created_by
           ) VALUES ($1, $2, 'OPEN', $3, $4, $5, $6, $7, $8, $9::jsonb, NULL, $10)
           RETURNING *`,
          [
            caseRef,
            ct,
            pr,
            pid,
            bid,
            ct === 'LOST_BAGGAGE' ? bidBag : null,
            String(subject).slice(0, 300),
            description != null ? String(description).slice(0, 20000) : null,
            metaJson,
            req.user.userId
          ]
        );
        await client.query(
          `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
           VALUES ($1, 'CS_CASE_CREATED', 'cs_service_cases', $2, $3)`,
          [req.user.userId, ins.rows[0].id, JSON.stringify({ caseRef, caseType: ct })]
        );
        return res.status(201).json({ case: ins.rows[0] });
      } catch (e) {
        if (e.code === '23505' && String(e.message || '').includes('case_ref')) {
          caseRef = nextCaseRef();
          continue;
        }
        throw e;
      }
    }
    return res.status(500).json({ message: 'Could not allocate case reference.' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create case.', error: error.message });
  } finally {
    client.release();
  }
});

async function loadBaggageContext(client, baggageId) {
  const r = await client.query(
    `SELECT bg.id AS baggage_id, bg.tag_number, c.passenger_id, c.booking_id
     FROM baggage bg
     JOIN checkins c ON c.id = bg.checkin_id
     WHERE bg.id = $1`,
    [baggageId]
  );
  return r.rows[0] || null;
}

router.patch('/cases/:caseId', requireAuth, csRoles, async (req, res) => {
  const { caseId } = req.params;
  if (!isUuid(caseId)) {
    return res.status(400).json({ message: 'Invalid case id.' });
  }
  const { status, subject, description, priority, assignedTo, metadata } = req.body;

  const client = await pool.connect();
  try {
    const cur = await client.query(`SELECT * FROM cs_service_cases WHERE id = $1`, [caseId]);
    const row = cur.rows[0];
    if (!row) {
      return res.status(404).json({ message: 'Case not found.' });
    }
    if (!canViewCase(req.user, row)) {
      return res.status(403).json({ message: 'You cannot view this case.' });
    }
    if (!canMutateCase(req.user, row)) {
      return res.status(403).json({ message: 'Only the assigned agent (or admin) can update this case.' });
    }

    const updates = [];
    const vals = [];

    if (status !== undefined) {
      const st = String(status).toUpperCase();
      if (!STATUSES.includes(st)) {
        return res.status(400).json({ message: 'Invalid status.' });
      }
      vals.push(st);
      updates.push(`status = $${vals.length}`);
      if (st === 'CLOSED') {
        updates.push(`closed_at = COALESCE(closed_at, NOW())`);
      }
    }
    if (subject !== undefined) {
      vals.push(String(subject).slice(0, 300));
      updates.push(`subject = $${vals.length}`);
    }
    if (description !== undefined) {
      vals.push(description != null ? String(description).slice(0, 20000) : null);
      updates.push(`description = $${vals.length}`);
    }
    if (priority !== undefined) {
      const pr = String(priority).toUpperCase();
      if (!PRIORITIES.includes(pr)) {
        return res.status(400).json({ message: 'Invalid priority.' });
      }
      vals.push(pr);
      updates.push(`priority = $${vals.length}`);
    }
    if (metadata !== undefined) {
      vals.push(metadata === null ? null : JSON.stringify(metadata));
      updates.push(`metadata = $${vals.length}::jsonb`);
    }

    if (assignedTo !== undefined) {
      if (assignedTo === null) {
        if (!isAdminRole(req.user.role)) {
          return res.status(403).json({ message: 'Only admin can unassign a case.' });
        }
        vals.push(null);
        updates.push(`assigned_to = $${vals.length}`);
      } else {
        if (!isUuid(assignedTo)) {
          return res.status(400).json({ message: 'Invalid assignedTo user id.' });
        }
        if (!isAdminRole(req.user.role) && String(assignedTo) !== String(req.user.userId)) {
          return res.status(403).json({ message: 'You can only assign a case to yourself unless you are admin.' });
        }
        const u = await client.query(`SELECT id FROM users WHERE id = $1 AND is_active = TRUE`, [assignedTo]);
        if (u.rowCount === 0) {
          return res.status(400).json({ message: 'Assignee user not found or inactive.' });
        }
        vals.push(assignedTo);
        updates.push(`assigned_to = $${vals.length}`);
      }
    } else if (row.assigned_to == null && updates.length > 0) {
      vals.push(req.user.userId);
      updates.push(`assigned_to = $${vals.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No valid fields to update.' });
    }

    vals.push(caseId);
    const setClause = updates.join(', ');
    const up = await client.query(
      `UPDATE cs_service_cases SET ${setClause}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    return res.status(200).json({ case: up.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update case.', error: error.message });
  } finally {
    client.release();
  }
});

router.post('/cases/:caseId/notes', requireAuth, csRoles, async (req, res) => {
  const { caseId } = req.params;
  if (!isUuid(caseId)) {
    return res.status(400).json({ message: 'Invalid case id.' });
  }
  const { body, isInternal } = req.body;
  if (!body || typeof body !== 'string') {
    return res.status(400).json({ message: 'body is required.' });
  }
  try {
    const cur = await pool.query(`SELECT * FROM cs_service_cases WHERE id = $1`, [caseId]);
    const row = cur.rows[0];
    if (!row) {
      return res.status(404).json({ message: 'Case not found.' });
    }
    if (!canViewCase(req.user, row)) {
      return res.status(403).json({ message: 'You cannot view this case.' });
    }
    if (!canMutateCase(req.user, row)) {
      return res.status(403).json({ message: 'Only the assigned agent (or admin) can add notes to this case.' });
    }
    const ins = await pool.query(
      `INSERT INTO cs_case_notes (case_id, body, is_internal, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [caseId, String(body).slice(0, 20000), isInternal === false ? false : true, req.user.userId]
    );
    await pool.query(`UPDATE cs_service_cases SET updated_at = NOW() WHERE id = $1`, [caseId]);
    return res.status(201).json({ note: ins.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to add note.', error: error.message });
  }
});

/** Creates a finance refund_requests row and links it to the case (Finance module handles approval). */
router.post('/cases/:caseId/refund-request', requireAuth, csRoles, async (req, res) => {
  const { caseId } = req.params;
  if (!isUuid(caseId)) {
    return res.status(400).json({ message: 'Invalid case id.' });
  }
  const { paymentId, refundAmount, reason } = req.body;
  const amount = Number(refundAmount);
  if (!paymentId || !isUuid(paymentId) || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: 'paymentId and a valid positive refundAmount are required.' });
  }

  const client = await pool.connect();
  try {
    const cRes = await client.query(`SELECT * FROM cs_service_cases WHERE id = $1`, [caseId]);
    const csRow = cRes.rows[0];
    if (!csRow) {
      return res.status(404).json({ message: 'Case not found.' });
    }
    if (!canViewCase(req.user, csRow)) {
      return res.status(403).json({ message: 'You cannot view this case.' });
    }
    if (!canMutateCase(req.user, csRow)) {
      return res.status(403).json({ message: 'Only the assigned agent (or admin) can submit a refund for this case.' });
    }
    if (csRow.case_type !== 'REFUND_REQUEST' && csRow.case_type !== 'COMPLAINT' && csRow.case_type !== 'SUPPORT') {
      return res.status(400).json({ message: 'Refund submission is only allowed for refund, complaint, or support cases.' });
    }
    if (csRow.refund_request_id) {
      return res.status(409).json({ message: 'This case already has a linked refund request.' });
    }
    if (!csRow.booking_id) {
      return res.status(400).json({ message: 'Case must have a booking_id to tie the refund to finance.' });
    }

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
    if (String(p.booking_id) !== String(csRow.booking_id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Payment does not belong to the case booking.' });
    }
    if (req.user.role === 'agent' && String(p.created_by) !== String(req.user.userId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'You can only request refunds for your own sales bookings.' });
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
      description: 'Refund approval requested (customer service case)',
      metadata: { reason: reason || null, caseId },
      userId: req.user.userId
    });

    await client.query(
      `UPDATE cs_service_cases
       SET refund_request_id = $1, updated_at = NOW(),
           assigned_to = COALESCE(assigned_to, $2::uuid)
       WHERE id = $3`,
      [ins.rows[0].id, req.user.userId, caseId]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1, 'CS_CASE_REFUND_LINKED', 'cs_service_cases', $2, $3)`,
      [req.user.userId, caseId, JSON.stringify({ refundRequestId: ins.rows[0].id, paymentId })]
    );

    await client.query('COMMIT');
    return res.status(201).json({ refundRequest: ins.rows[0] });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* not in a transaction */
    }
    return res.status(500).json({ message: 'Failed to create refund request.', error: error.message });
  } finally {
    client.release();
  }
});

router.get('/bookings/:bookingId/payments', requireAuth, csRoles, async (req, res) => {
  const { bookingId } = req.params;
  if (!isUuid(bookingId)) {
    return res.status(400).json({ message: 'Invalid booking id.' });
  }
  try {
    const r = await pool.query(
      `SELECT id, booking_id, payment_type, amount, currency, payment_status, transaction_ref, processed_at
       FROM payments WHERE booking_id = $1 ORDER BY processed_at DESC`,
      [bookingId]
    );
    return res.status(200).json({ payments: r.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to list payments.', error: error.message });
  }
});

export default router;
