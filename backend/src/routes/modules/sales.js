import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import { validateAndLockPromo, PromoValidationError } from '../../services/salesPromo.js';

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'];

router.get('/health', (_req, res) => {
  res.json({ module: 'sales', status: 'ready' });
});

/** Campaign performance + booking conversion + lead funnel */
router.get(
  '/marketing-dashboard',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager', 'finance'),
  async (_req, res) => {
    try {
      const settled = await Promise.allSettled([
        pool.query(
          `SELECT c.id, c.name, c.channel, c.start_date, c.end_date, c.budget_amount, c.currency,
                  COUNT(DISTINCT b.id)::int AS bookings_count,
                  COALESCE(SUM(b.total_amount), 0)::numeric AS booking_revenue,
                  COUNT(DISTINCT l.id)::int AS leads_count,
                  COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'WON')::int AS leads_won
           FROM sales_campaigns c
           LEFT JOIN bookings b ON b.campaign_id = c.id
           LEFT JOIN sales_leads l ON l.campaign_id = c.id
           GROUP BY c.id
           ORDER BY c.start_date DESC
           LIMIT 100`
        ),
        pool.query(
          `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(expected_value), 0)::numeric AS pipeline_value
           FROM sales_leads
           GROUP BY status
           ORDER BY
             CASE status
               WHEN 'NEW' THEN 1
               WHEN 'CONTACTED' THEN 2
               WHEN 'QUALIFIED' THEN 3
               WHEN 'PROPOSAL' THEN 4
               WHEN 'WON' THEN 5
               WHEN 'LOST' THEN 6
               ELSE 9
             END`
        ),
        pool.query(
          `SELECT id, code, used_count, usage_limit, valid_from, valid_until, active
           FROM sales_promo_codes
           ORDER BY used_count DESC, code ASC
           LIMIT 50`
        )
      ]);

      const rows = (i) => {
        const r = settled[i];
        if (r.status === 'fulfilled') return r.value.rows;
        console.warn('[sales/marketing-dashboard] query failed:', r.reason?.message || r.reason);
        return [];
      };

      return res.status(200).json({
        campaigns: rows(0),
        leadPipeline: rows(1),
        promoUsage: rows(2)
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load marketing dashboard.', error: error.message });
    }
  }
);

router.get(
  '/leads/pipeline',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager', 'agent', 'customer_service'),
  async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(expected_value), 0)::numeric AS pipeline_value
         FROM sales_leads
         GROUP BY status
         ORDER BY
           CASE status
             WHEN 'NEW' THEN 1
             WHEN 'CONTACTED' THEN 2
             WHEN 'QUALIFIED' THEN 3
             WHEN 'PROPOSAL' THEN 4
             WHEN 'WON' THEN 5
             WHEN 'LOST' THEN 6
             ELSE 9
           END`
      );
      return res.status(200).json({ pipeline: r.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load sales pipeline.', error: error.message });
    }
  }
);

router.get(
  '/reports/agent-performance',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager', 'finance', 'agent'),
  async (req, res) => {
    const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
    const to = String(req.query.to || new Date().toISOString().slice(0, 10));
    const role = req.user.role;
    const agentOnly = role === 'agent';

    try {
      const params = agentOnly ? [from, to, req.user.userId] : [from, to];
      const scope = agentOnly ? 'AND b.created_by = $3::uuid' : '';

      const r = await pool.query(
        `SELECT u.id AS user_id, u.full_name, u.email,
                COUNT(DISTINCT b.id)::int AS bookings_count,
                COALESCE(SUM(b.total_amount), 0)::numeric AS booking_revenue,
                COUNT(DISTINCT t.id)::int AS tickets_issued
         FROM users u
         JOIN bookings b ON b.created_by = u.id AND DATE(b.created_at) >= DATE($1::date) AND DATE(b.created_at) <= DATE($2::date)
         LEFT JOIN tickets t ON t.booking_id = b.id
         WHERE u.role = 'agent'::user_role ${scope}
         GROUP BY u.id, u.full_name, u.email
         HAVING COUNT(DISTINCT b.id) > 0
         ORDER BY booking_revenue DESC`,
        params
      );
      return res.status(200).json({ from, to, agents: r.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load agent performance.', error: error.message });
    }
  }
);

router.get(
  '/leads',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager', 'agent', 'customer_service'),
  async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT l.*, u.full_name AS assigned_to_name, c.name AS campaign_name
         FROM sales_leads l
         LEFT JOIN users u ON u.id = l.assigned_to
         LEFT JOIN sales_campaigns c ON c.id = l.campaign_id
         ORDER BY l.updated_at DESC
         LIMIT 500`
      );
      return res.status(200).json({ leads: r.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to list leads.', error: error.message });
    }
  }
);

router.post(
  '/leads',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager', 'agent', 'customer_service'),
  async (req, res) => {
    const { companyName, contactName, email, phone, source, status, expectedValue, currency, assignedTo, campaignId, notes } =
      req.body;
    if (!contactName) {
      return res.status(400).json({ message: 'contactName is required.' });
    }
    const st = String(status || 'NEW').toUpperCase();
    if (!LEAD_STATUSES.includes(st)) {
      return res.status(400).json({ message: `status must be one of: ${LEAD_STATUSES.join(', ')}` });
    }
    try {
      const ins = await pool.query(
        `INSERT INTO sales_leads (
          company_name, contact_name, email, phone, source, status, expected_value, currency, assigned_to, campaign_id, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          companyName ? String(companyName).slice(0, 200) : null,
          String(contactName).slice(0, 150),
          email ? String(email).slice(0, 150) : null,
          phone ? String(phone).slice(0, 40) : null,
          source ? String(source).slice(0, 80) : null,
          st,
          expectedValue != null && Number.isFinite(Number(expectedValue)) ? Number(expectedValue) : null,
          String(currency || 'USD').slice(0, 3).toUpperCase(),
          assignedTo && isUuid(String(assignedTo)) ? assignedTo : null,
          campaignId && isUuid(String(campaignId)) ? campaignId : null,
          notes ? String(notes).slice(0, 8000) : null
        ]
      );
      return res.status(201).json({ lead: ins.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to create lead.', error: error.message });
    }
  }
);

router.patch(
  '/leads/:leadId',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager', 'agent', 'customer_service'),
  async (req, res) => {
    const { leadId } = req.params;
    if (!isUuid(leadId)) return res.status(400).json({ message: 'Invalid lead id.' });
    const { status, notes, assignedTo, expectedValue } = req.body;
    const sets = [];
    const vals = [];
    if (status !== undefined) {
      const st = String(status).toUpperCase();
      if (!LEAD_STATUSES.includes(st)) {
        return res.status(400).json({ message: `status must be one of: ${LEAD_STATUSES.join(', ')}` });
      }
      vals.push(st);
      sets.push(`status = $${vals.length}`);
    }
    if (notes !== undefined) {
      vals.push(notes == null ? null : String(notes).slice(0, 8000));
      sets.push(`notes = $${vals.length}`);
    }
    if (assignedTo !== undefined) {
      vals.push(assignedTo && isUuid(String(assignedTo)) ? assignedTo : null);
      sets.push(`assigned_to = $${vals.length}`);
    }
    if (expectedValue !== undefined) {
      vals.push(expectedValue == null || !Number.isFinite(Number(expectedValue)) ? null : Number(expectedValue));
      sets.push(`expected_value = $${vals.length}`);
    }
    if (sets.length === 0) {
      return res.status(400).json({ message: 'No updates provided.' });
    }
    vals.push(leadId);
    sets.push(`updated_at = NOW()`);
    try {
      const r = await pool.query(
        `UPDATE sales_leads SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
        vals
      );
      if (r.rowCount === 0) return res.status(404).json({ message: 'Lead not found.' });
      return res.status(200).json({ lead: r.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to update lead.', error: error.message });
    }
  }
);

router.get(
  '/corporate-customers',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager', 'finance'),
  async (_req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM sales_corporate_customers ORDER BY legal_name ASC LIMIT 500`);
      return res.status(200).json({ corporateCustomers: r.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to list corporate customers.', error: error.message });
    }
  }
);

router.post(
  '/corporate-customers',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager'),
  async (req, res) => {
    const { legalName, taxId, billingEmail, phone, defaultDiscountPercent, notes } = req.body;
    if (!legalName) return res.status(400).json({ message: 'legalName is required.' });
    try {
      const ins = await pool.query(
        `INSERT INTO sales_corporate_customers (legal_name, tax_id, billing_email, phone, default_discount_percent, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          String(legalName).slice(0, 200),
          taxId ? String(taxId).slice(0, 80) : null,
          billingEmail ? String(billingEmail).slice(0, 150) : null,
          phone ? String(phone).slice(0, 40) : null,
          defaultDiscountPercent != null && Number.isFinite(Number(defaultDiscountPercent))
            ? Number(defaultDiscountPercent)
            : null,
          notes ? String(notes).slice(0, 8000) : null
        ]
      );
      return res.status(201).json({ corporateCustomer: ins.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to create corporate customer.', error: error.message });
    }
  }
);

router.get(
  '/travel-agents',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager', 'operations'),
  async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT t.*, u.full_name AS linked_user_name
         FROM sales_travel_agents t
         LEFT JOIN users u ON u.id = t.user_id
         ORDER BY t.company_name ASC
         LIMIT 500`
      );
      return res.status(200).json({ travelAgents: r.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to list travel agents.', error: error.message });
    }
  }
);

router.post(
  '/travel-agents',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager'),
  async (req, res) => {
    const { companyName, contactName, email, phone, iataCode, userId, commissionPercent, notes } = req.body;
    if (!companyName) return res.status(400).json({ message: 'companyName is required.' });
    try {
      const ins = await pool.query(
        `INSERT INTO sales_travel_agents (company_name, contact_name, email, phone, iata_code, user_id, commission_percent, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          String(companyName).slice(0, 200),
          contactName ? String(contactName).slice(0, 150) : null,
          email ? String(email).slice(0, 150) : null,
          phone ? String(phone).slice(0, 40) : null,
          iataCode ? String(iataCode).slice(0, 20) : null,
          userId && isUuid(String(userId)) ? userId : null,
          commissionPercent != null && Number.isFinite(Number(commissionPercent)) ? Number(commissionPercent) : null,
          notes ? String(notes).slice(0, 8000) : null
        ]
      );
      return res.status(201).json({ travelAgent: ins.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to create travel agent.', error: error.message });
    }
  }
);

router.get(
  '/campaigns',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager', 'finance', 'agent', 'customer_service'),
  async (_req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM sales_campaigns ORDER BY start_date DESC LIMIT 200`);
      return res.status(200).json({ campaigns: r.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to list campaigns.', error: error.message });
    }
  }
);

router.post(
  '/campaigns',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager'),
  async (req, res) => {
    const {
      name,
      channel,
      startDate,
      endDate,
      budgetAmount,
      currency,
      utmSource,
      utmMedium,
      utmCampaign,
      notes
    } = req.body;
    if (!name || !startDate || !endDate) {
      return res.status(400).json({ message: 'name, startDate, and endDate are required.' });
    }
    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ message: 'endDate must be on or after startDate.' });
    }
    try {
      const ins = await pool.query(
        `INSERT INTO sales_campaigns (
          name, channel, start_date, end_date, budget_amount, currency, utm_source, utm_medium, utm_campaign, notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          String(name).slice(0, 200),
          channel ? String(channel).slice(0, 80) : null,
          String(startDate).slice(0, 10),
          String(endDate).slice(0, 10),
          budgetAmount != null && Number.isFinite(Number(budgetAmount)) ? Number(budgetAmount) : null,
          String(currency || 'USD').slice(0, 3).toUpperCase(),
          utmSource ? String(utmSource).slice(0, 120) : null,
          utmMedium ? String(utmMedium).slice(0, 120) : null,
          utmCampaign ? String(utmCampaign).slice(0, 160) : null,
          notes ? String(notes).slice(0, 8000) : null,
          req.user.userId
        ]
      );
      return res.status(201).json({ campaign: ins.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to create campaign.', error: error.message });
    }
  }
);

router.get(
  '/promo-codes',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager', 'finance', 'agent', 'customer_service'),
  async (_req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM sales_promo_codes ORDER BY created_at DESC LIMIT 200`);
      return res.status(200).json({ promoCodes: r.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to list promo codes.', error: error.message });
    }
  }
);

router.post(
  '/promo-codes/validate',
  requireAuth,
  requireRoles('admin', 'super_admin', 'agent', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const { code, travelDate, origin, dest, subtotal } = req.body;
    if (!code || travelDate == null || subtotal == null) {
      return res.status(400).json({ message: 'code, travelDate, and subtotal are required.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await validateAndLockPromo(client, {
        code,
        travelDate,
        origin: origin || '',
        dest: dest || '',
        subtotal: Number(subtotal)
      });
      await client.query('ROLLBACK');
      return res.status(200).json({
        valid: true,
        discountAmount: out.discountAmount,
        promoCodeId: out.promo ? out.promo.id : null
      });
    } catch (e) {
      await client.query('ROLLBACK');
      if (e instanceof PromoValidationError) {
        return res.status(400).json({ valid: false, key: e.key, message: e.message });
      }
      return res.status(400).json({ valid: false, message: e.message });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/promo-codes',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager'),
  async (req, res) => {
    const {
      code,
      description,
      discountType,
      discountValue,
      currency,
      validFrom,
      validUntil,
      usageLimit
    } = req.body;
    if (!code || !discountType || discountValue == null || !validFrom || !validUntil || usageLimit == null) {
      return res.status(400).json({
        message: 'code, discountType, discountValue, validFrom, validUntil, and usageLimit are required.'
      });
    }
    const dt = String(discountType).toUpperCase();
    if (!['PERCENT', 'FIXED_AMOUNT'].includes(dt)) {
      return res.status(400).json({ message: 'discountType must be PERCENT or FIXED_AMOUNT.' });
    }
    const lim = Number(usageLimit);
    if (!Number.isFinite(lim) || lim < 1) {
      return res.status(400).json({ message: 'usageLimit must be an integer >= 1.' });
    }
    const dv = Number(discountValue);
    if (!Number.isFinite(dv) || dv < 0) {
      return res.status(400).json({ message: 'discountValue must be a non-negative number.' });
    }
    if (dt === 'PERCENT' && (dv > 100 || dv < 0)) {
      return res.status(400).json({ message: 'For PERCENT, discountValue must be between 0 and 100.' });
    }
    if (new Date(validUntil) < new Date(validFrom)) {
      return res.status(400).json({ message: 'validUntil must be on or after validFrom.' });
    }

    try {
      const dup = await pool.query(`SELECT 1 FROM sales_promo_codes WHERE upper(code) = upper($1)`, [
        String(code).trim()
      ]);
      if (dup.rowCount > 0) {
        return res.status(409).json({ message: 'Promo code already exists.' });
      }
      const ins = await pool.query(
        `INSERT INTO sales_promo_codes (
          code, description, discount_type, discount_value, currency, valid_from, valid_until, usage_limit, used_count, active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, TRUE)
        RETURNING *`,
        [
          String(code).trim().slice(0, 40),
          description ? String(description).slice(0, 500) : null,
          dt,
          dv,
          String(currency || 'USD').slice(0, 3).toUpperCase(),
          String(validFrom).slice(0, 10),
          String(validUntil).slice(0, 10),
          Math.floor(lim)
        ]
      );
      return res.status(201).json({ promoCode: ins.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to create promo code.', error: error.message });
    }
  }
);

router.patch(
  '/promo-codes/:promoId',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager'),
  async (req, res) => {
    const { promoId } = req.params;
    if (!isUuid(promoId)) return res.status(400).json({ message: 'Invalid id.' });
    const { active, validUntil, description } = req.body;
    const sets = [];
    const vals = [];
    if (active !== undefined) {
      vals.push(Boolean(active));
      sets.push(`active = $${vals.length}`);
    }
    if (validUntil !== undefined) {
      vals.push(String(validUntil).slice(0, 10));
      sets.push(`valid_until = $${vals.length}`);
    }
    if (description !== undefined) {
      vals.push(description == null ? null : String(description).slice(0, 500));
      sets.push(`description = $${vals.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ message: 'No updates provided.' });
    vals.push(promoId);
    try {
      const r = await pool.query(
        `UPDATE sales_promo_codes SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
        vals
      );
      if (r.rowCount === 0) return res.status(404).json({ message: 'Promo code not found.' });
      return res.status(200).json({ promoCode: r.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to update promo code.', error: error.message });
    }
  }
);

router.post(
  '/promo-codes/:promoId/route-promotions',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager'),
  async (req, res) => {
    const { promoId } = req.params;
    const { originAirport, destAirport } = req.body;
    if (!isUuid(promoId) || !originAirport || !destAirport) {
      return res.status(400).json({ message: 'promoId, originAirport, and destAirport are required.' });
    }
    try {
      const ins = await pool.query(
        `INSERT INTO sales_route_promotions (promo_code_id, origin_airport, dest_airport)
         VALUES ($1, $2, $3)
         ON CONFLICT (promo_code_id, origin_airport, dest_airport) DO NOTHING
         RETURNING *`,
        [promoId, String(originAirport).toUpperCase().slice(0, 10), String(destAirport).toUpperCase().slice(0, 10)]
      );
      if (ins.rowCount === 0) {
        return res.status(200).json({ message: 'Route promotion already exists.', routePromotion: null });
      }
      return res.status(201).json({ routePromotion: ins.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to add route promotion.', error: error.message });
    }
  }
);

router.get(
  '/promo-codes/:promoId/route-promotions',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager', 'finance'),
  async (req, res) => {
    const { promoId } = req.params;
    if (!isUuid(promoId)) return res.status(400).json({ message: 'Invalid id.' });
    try {
      const r = await pool.query(`SELECT * FROM sales_route_promotions WHERE promo_code_id = $1 ORDER BY origin_airport`, [
        promoId
      ]);
      return res.status(200).json({ routePromotions: r.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to list route promotions.', error: error.message });
    }
  }
);

router.delete(
  '/promo-codes/:promoId/route-promotions/:routePromoId',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager'),
  async (req, res) => {
    const { promoId, routePromoId } = req.params;
    if (!isUuid(promoId) || !isUuid(routePromoId)) {
      return res.status(400).json({ message: 'Invalid id.' });
    }
    try {
      await pool.query(`DELETE FROM sales_route_promotions WHERE id = $1 AND promo_code_id = $2`, [
        routePromoId,
        promoId
      ]);
      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ message: 'Failed to delete route promotion.', error: error.message });
    }
  }
);

router.get(
  '/segments',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager'),
  async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT s.*, (SELECT COUNT(*)::int FROM sales_segment_members m WHERE m.segment_id = s.id) AS member_count
         FROM sales_customer_segments s
         ORDER BY s.name ASC`
      );
      return res.status(200).json({ segments: r.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to list segments.', error: error.message });
    }
  }
);

router.post(
  '/segments',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager'),
  async (req, res) => {
    const { name, description, rulesJson } = req.body;
    if (!name) return res.status(400).json({ message: 'name is required.' });
    try {
      const ins = await pool.query(
        `INSERT INTO sales_customer_segments (name, description, rules_json)
         VALUES ($1, $2, $3::jsonb)
         RETURNING *`,
        [String(name).slice(0, 120), description ? String(description).slice(0, 4000) : null, JSON.stringify(rulesJson ?? {})]
      );
      return res.status(201).json({ segment: ins.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to create segment.', error: error.message });
    }
  }
);

router.post(
  '/segments/:segmentId/members',
  requireAuth,
  requireRoles('admin', 'super_admin', 'sales_manager'),
  async (req, res) => {
    const { segmentId } = req.params;
    const { passengerId } = req.body;
    if (!isUuid(segmentId) || !isUuid(String(passengerId))) {
      return res.status(400).json({ message: 'segmentId and passengerId are required UUIDs.' });
    }
    try {
      await pool.query(
        `INSERT INTO sales_segment_members (segment_id, passenger_id) VALUES ($1, $2)
         ON CONFLICT (segment_id, passenger_id) DO NOTHING`,
        [segmentId, passengerId]
      );
      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ message: 'Failed to add segment member.', error: error.message });
    }
  }
);

export default router;
