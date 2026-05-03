import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import { CABIN_SAFETY_TRAINING_CODE } from '../../services/crewCompliance.js';

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

router.get('/health', (_req, res) => {
  res.json({ module: 'crew', status: 'ready' });
});

function parseIsoDate(s) {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

router.get(
  '/roster',
  requireAuth,
  requireRoles('admin', 'operations', 'agent', 'super_admin', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const defTo = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    let from = parseIsoDate(req.query.from) || today;
    let to = parseIsoDate(req.query.to) || defTo;
    if (from > to) {
      const x = from;
      from = to;
      to = x;
    }
    try {
      const rows = await pool.query(
        `SELECT
          ca.id AS assignment_id,
          ca.duty_role,
          ca.assigned_at,
          f.id AS flight_id,
          f.flight_number,
          f.departure_airport,
          f.arrival_airport,
          f.departure_time,
          f.arrival_time,
          f.status AS flight_status,
          u.id AS user_id,
          u.full_name,
          u.email,
          cp.crew_category,
          cp.employee_number
        FROM crew_assignments ca
        JOIN flights f ON f.id = ca.flight_id
        JOIN users u ON u.id = ca.crew_user_id
        LEFT JOIN crew_profiles cp ON cp.user_id = u.id
        WHERE DATE(f.departure_time) >= DATE($1::date)
          AND DATE(f.departure_time) <= DATE($2::date)
        ORDER BY f.departure_time ASC, u.full_name ASC`,
        [from, to]
      );
      return res.status(200).json({ from, to, assignments: rows.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load roster.', error: error.message });
    }
  }
);

router.get(
  '/alerts',
  requireAuth,
  requireRoles('admin', 'operations', 'super_admin', 'agent', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const withinDays = Math.min(365, Math.max(1, Number(req.query.withinDays) || 30));
    try {
      const soon = new Date();
      soon.setDate(soon.getDate() + withinDays);
      const soonStr = soon.toISOString().slice(0, 10);

      const settled = await Promise.allSettled([
        pool.query(
          `SELECT l.id, l.user_id, u.full_name, l.license_type, l.expiry_date, 'LICENSE' AS alert_kind
           FROM crew_licenses l
           JOIN users u ON u.id = l.user_id
           WHERE u.role = 'crew'::user_role AND l.is_active = TRUE AND l.expiry_date <= $1::date AND l.expiry_date >= CURRENT_DATE
           ORDER BY l.expiry_date ASC`,
          [soonStr]
        ),
        pool.query(
          `SELECT l.id, l.user_id, u.full_name, l.license_type, l.expiry_date, 'LICENSE_EXPIRED' AS alert_kind
           FROM crew_licenses l
           JOIN users u ON u.id = l.user_id
           WHERE u.role = 'crew'::user_role AND l.is_active = TRUE AND l.expiry_date < CURRENT_DATE
           ORDER BY l.expiry_date DESC`
        ),
        pool.query(
          `SELECT m.id, m.user_id, u.full_name, m.medical_class, m.expiry_date, 'MEDICAL' AS alert_kind
           FROM crew_medicals m
           JOIN users u ON u.id = m.user_id
           WHERE u.role = 'crew'::user_role AND m.is_active = TRUE AND m.expiry_date <= $1::date AND m.expiry_date >= CURRENT_DATE
           ORDER BY m.expiry_date ASC`,
          [soonStr]
        ),
        pool.query(
          `SELECT m.id, m.user_id, u.full_name, m.medical_class, m.expiry_date, 'MEDICAL_EXPIRED' AS alert_kind
           FROM crew_medicals m
           JOIN users u ON u.id = m.user_id
           WHERE u.role = 'crew'::user_role AND m.is_active = TRUE AND m.expiry_date < CURRENT_DATE
           ORDER BY m.expiry_date DESC`
        ),
        pool.query(
          `SELECT t.id, t.user_id, u.full_name, t.training_code, t.title, t.expiry_date, 'TRAINING' AS alert_kind
           FROM crew_training t
           JOIN users u ON u.id = t.user_id
           WHERE u.role = 'crew'::user_role AND t.expiry_date IS NOT NULL AND t.expiry_date <= $1::date AND t.expiry_date >= CURRENT_DATE
           ORDER BY t.expiry_date ASC`,
          [soonStr]
        ),
        pool.query(
          `SELECT t.id, t.user_id, u.full_name, t.training_code, t.title, t.expiry_date, 'TRAINING_EXPIRED' AS alert_kind
           FROM crew_training t
           JOIN users u ON u.id = t.user_id
           WHERE u.role = 'crew'::user_role AND t.expiry_date IS NOT NULL AND t.expiry_date < CURRENT_DATE
           ORDER BY t.expiry_date DESC`
        ),
        pool.query(
          `SELECT d.id, d.user_id, u.full_name, d.doc_type, d.title, d.expiry_date, 'DOCUMENT' AS alert_kind
           FROM crew_documents d
           JOIN users u ON u.id = d.user_id
           WHERE u.role = 'crew'::user_role AND d.expiry_date IS NOT NULL AND d.expiry_date <= $1::date AND d.expiry_date >= CURRENT_DATE
           ORDER BY d.expiry_date ASC`,
          [soonStr]
        ),
        pool.query(
          `SELECT d.id, d.user_id, u.full_name, d.doc_type, d.title, d.expiry_date, 'DOCUMENT_EXPIRED' AS alert_kind
           FROM crew_documents d
           JOIN users u ON u.id = d.user_id
           WHERE u.role = 'crew'::user_role AND d.expiry_date IS NOT NULL AND d.expiry_date < CURRENT_DATE
           ORDER BY d.expiry_date DESC`
        )
      ]);

      const row = (i) => (settled[i].status === 'fulfilled' ? settled[i].value.rows : []);
      const warn = settled
        .map((r, i) => (r.status === 'rejected' ? `query[${i}]: ${r.reason?.message || r.reason}` : null))
        .filter(Boolean);
      if (warn.length) {
        console.warn('[crew/alerts]', warn.join('; '));
      }

      return res.status(200).json({
        withinDays,
        expiringSoon: {
          licenses: row(0),
          medicals: row(2),
          training: row(4),
          documents: row(6)
        },
        expired: {
          licenses: row(1),
          medicals: row(3),
          training: row(5),
          documents: row(7)
        }
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load alerts.', error: error.message });
    }
  }
);

router.get(
  '/',
  requireAuth,
  requireRoles('admin', 'operations', 'agent', 'super_admin', 'customer_service', 'sales_manager'),
  async (_req, res) => {
    try {
      const rows = await pool.query(
        `SELECT
          u.id,
          u.full_name,
          u.email,
          u.role::text AS role,
          u.is_active,
          cp.crew_category,
          cp.employee_number,
          cp.base_airport,
          cp.hire_date,
          (cp.user_id IS NOT NULL) AS has_profile
        FROM users u
        LEFT JOIN crew_profiles cp ON cp.user_id = u.id
        WHERE u.role = 'crew'::user_role
        ORDER BY u.is_active DESC NULLS LAST, u.full_name ASC`
      );
      return res.status(200).json({ crew: rows.rows });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to list crew.', error: error.message });
    }
  }
);

router.post(
  '/profiles',
  requireAuth,
  requireRoles('admin', 'operations'),
  async (req, res) => {
    const { userId, crewCategory, employeeNumber, baseAirport, phone, emergencyContact, hireDate, notes } = req.body;
    if (!userId || !isUuid(String(userId)) || !crewCategory) {
      return res.status(400).json({ message: 'userId and crewCategory (PILOT or CABIN) are required.' });
    }
    const cat = String(crewCategory).toUpperCase();
    if (!['PILOT', 'CABIN'].includes(cat)) {
      return res.status(400).json({ message: 'crewCategory must be PILOT or CABIN.' });
    }
    try {
      const u = await pool.query(`SELECT id, role::text AS role FROM users WHERE id = $1`, [userId]);
      if (!u.rows[0] || u.rows[0].role !== 'crew') {
        return res.status(400).json({ message: 'User must exist with crew role.' });
      }
      const ins = await pool.query(
        `INSERT INTO crew_profiles (
          user_id, crew_category, employee_number, base_airport, phone, emergency_contact, hire_date, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id) DO UPDATE SET
          crew_category = EXCLUDED.crew_category,
          employee_number = EXCLUDED.employee_number,
          base_airport = EXCLUDED.base_airport,
          phone = EXCLUDED.phone,
          emergency_contact = EXCLUDED.emergency_contact,
          hire_date = EXCLUDED.hire_date,
          notes = EXCLUDED.notes,
          updated_at = NOW()
        RETURNING *`,
        [
          userId,
          cat,
          employeeNumber ? String(employeeNumber).slice(0, 40) : null,
          baseAirport ? String(baseAirport).toUpperCase().slice(0, 10) : null,
          phone ? String(phone).slice(0, 40) : null,
          emergencyContact ? String(emergencyContact).slice(0, 150) : null,
          hireDate || null,
          notes ? String(notes).slice(0, 4000) : null
        ]
      );
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.userId, 'CREW_PROFILE_UPSERT', 'crew_profiles', userId, JSON.stringify({ crewCategory: cat })]
      );
      return res.status(201).json({ profile: ins.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to save crew profile.', error: error.message });
    }
  }
);

router.delete(
  '/licenses/:licenseId',
  requireAuth,
  requireRoles('admin', 'operations'),
  async (req, res) => {
    const { licenseId } = req.params;
    if (!isUuid(licenseId)) {
      return res.status(400).json({ message: 'Invalid id.' });
    }
    try {
      await pool.query(`UPDATE crew_licenses SET is_active = FALSE WHERE id = $1`, [licenseId]);
      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ message: 'Failed to deactivate license.', error: error.message });
    }
  }
);

router.delete(
  '/medicals/:medicalId',
  requireAuth,
  requireRoles('admin', 'operations'),
  async (req, res) => {
    const { medicalId } = req.params;
    if (!isUuid(medicalId)) {
      return res.status(400).json({ message: 'Invalid id.' });
    }
    try {
      await pool.query(`UPDATE crew_medicals SET is_active = FALSE WHERE id = $1`, [medicalId]);
      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ message: 'Failed to deactivate medical.', error: error.message });
    }
  }
);

router.delete(
  '/availability/:availabilityId',
  requireAuth,
  requireRoles('admin', 'operations'),
  async (req, res) => {
    const { availabilityId } = req.params;
    if (!isUuid(availabilityId)) {
      return res.status(400).json({ message: 'Invalid id.' });
    }
    try {
      await pool.query(`DELETE FROM crew_availability WHERE id = $1`, [availabilityId]);
      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ message: 'Failed to delete availability.', error: error.message });
    }
  }
);

router.post(
  '/:userId/licenses',
  requireAuth,
  requireRoles('admin', 'operations'),
  async (req, res) => {
    const { userId } = req.params;
    const { licenseType, licenseNumber, issuingAuthority, issueDate, expiryDate } = req.body;
    if (!isUuid(userId) || !licenseType || !expiryDate) {
      return res.status(400).json({ message: 'licenseType and expiryDate are required.' });
    }
    const u = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'crew'::user_role`, [userId]);
    if (u.rowCount === 0) {
      return res.status(404).json({ message: 'Crew user not found.' });
    }
    try {
      const r = await pool.query(
        `INSERT INTO crew_licenses (user_id, license_type, license_number, issuing_authority, issue_date, expiry_date)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          userId,
          String(licenseType).slice(0, 40),
          licenseNumber ? String(licenseNumber).slice(0, 80) : null,
          issuingAuthority ? String(issuingAuthority).slice(0, 120) : null,
          issueDate || null,
          expiryDate
        ]
      );
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.userId, 'CREW_LICENSE_ADDED', 'crew_licenses', r.rows[0].id, JSON.stringify({ crewUserId: userId })]
      );
      return res.status(201).json({ license: r.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to add license.', error: error.message });
    }
  }
);

router.post(
  '/:userId/medicals',
  requireAuth,
  requireRoles('admin', 'operations'),
  async (req, res) => {
    const { userId } = req.params;
    const { medicalClass, expiryDate, examinerName } = req.body;
    if (!isUuid(userId) || !expiryDate) {
      return res.status(400).json({ message: 'expiryDate is required.' });
    }
    const u = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'crew'::user_role`, [userId]);
    if (u.rowCount === 0) {
      return res.status(404).json({ message: 'Crew user not found.' });
    }
    try {
      const r = await pool.query(
        `INSERT INTO crew_medicals (user_id, medical_class, expiry_date, examiner_name)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [
          userId,
          medicalClass ? String(medicalClass).slice(0, 20) : null,
          expiryDate,
          examinerName ? String(examinerName).slice(0, 120) : null
        ]
      );
      return res.status(201).json({ medical: r.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to add medical.', error: error.message });
    }
  }
);

router.post(
  '/:userId/training',
  requireAuth,
  requireRoles('admin', 'operations'),
  async (req, res) => {
    const { userId } = req.params;
    const { trainingCode, title, completedDate, expiryDate, instructor } = req.body;
    if (!isUuid(userId) || !trainingCode || !title) {
      return res.status(400).json({ message: 'trainingCode and title are required.' });
    }
    const u = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'crew'::user_role`, [userId]);
    if (u.rowCount === 0) {
      return res.status(404).json({ message: 'Crew user not found.' });
    }
    try {
      const r = await pool.query(
        `INSERT INTO crew_training (user_id, training_code, title, completed_date, expiry_date, instructor)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          userId,
          String(trainingCode).slice(0, 40),
          String(title).slice(0, 200),
          completedDate || null,
          expiryDate || null,
          instructor ? String(instructor).slice(0, 120) : null
        ]
      );
      return res.status(201).json({ training: r.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to add training.', error: error.message });
    }
  }
);

router.post(
  '/:userId/availability',
  requireAuth,
  requireRoles('admin', 'operations'),
  async (req, res) => {
    const { userId } = req.params;
    const { periodStart, periodEnd, status, reason } = req.body;
    if (!isUuid(userId) || !periodStart || !periodEnd || !status) {
      return res.status(400).json({ message: 'periodStart, periodEnd, and status are required.' });
    }
    const st = String(status).toUpperCase();
    if (!['AVAILABLE', 'UNAVAILABLE'].includes(st)) {
      return res.status(400).json({ message: 'status must be AVAILABLE or UNAVAILABLE.' });
    }
    if (new Date(periodEnd) <= new Date(periodStart)) {
      return res.status(400).json({ message: 'periodEnd must be after periodStart.' });
    }
    const u = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'crew'::user_role`, [userId]);
    if (u.rowCount === 0) {
      return res.status(404).json({ message: 'Crew user not found.' });
    }
    try {
      const r = await pool.query(
        `INSERT INTO crew_availability (user_id, period_start, period_end, status, reason)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [userId, new Date(periodStart).toISOString(), new Date(periodEnd).toISOString(), st, reason || null]
      );
      return res.status(201).json({ availability: r.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to add availability.', error: error.message });
    }
  }
);

router.post(
  '/:userId/documents',
  requireAuth,
  requireRoles('admin', 'operations'),
  async (req, res) => {
    const { userId } = req.params;
    const { docType, title, referenceNumber, issueDate, expiryDate, storageUrl } = req.body;
    if (!isUuid(userId) || !docType || !title) {
      return res.status(400).json({ message: 'docType and title are required.' });
    }
    const u = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'crew'::user_role`, [userId]);
    if (u.rowCount === 0) {
      return res.status(404).json({ message: 'Crew user not found.' });
    }
    try {
      const r = await pool.query(
        `INSERT INTO crew_documents (user_id, doc_type, title, reference_number, issue_date, expiry_date, storage_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          userId,
          String(docType).slice(0, 60),
          String(title).slice(0, 200),
          referenceNumber ? String(referenceNumber).slice(0, 120) : null,
          issueDate || null,
          expiryDate || null,
          storageUrl ? String(storageUrl).slice(0, 2000) : null
        ]
      );
      return res.status(201).json({ document: r.rows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to add document.', error: error.message });
    }
  }
);

router.get(
  '/:userId',
  requireAuth,
  requireRoles('admin', 'operations', 'agent', 'super_admin', 'customer_service', 'sales_manager'),
  async (req, res) => {
    const { userId } = req.params;
    if (!isUuid(userId)) {
      return res.status(400).json({ message: 'Invalid user id.' });
    }
    try {
      const u = await pool.query(
        `SELECT id, full_name, email, role::text AS role, is_active FROM users WHERE id = $1`,
        [userId]
      );
      if (!u.rows[0] || u.rows[0].role !== 'crew') {
        return res.status(404).json({ message: 'Crew user not found.' });
      }
      const settled = await Promise.allSettled([
        pool.query(`SELECT * FROM crew_profiles WHERE user_id = $1`, [userId]),
        pool.query(
          `SELECT * FROM crew_licenses WHERE user_id = $1 ORDER BY expiry_date DESC, created_at DESC`,
          [userId]
        ),
        pool.query(`SELECT * FROM crew_medicals WHERE user_id = $1 ORDER BY expiry_date DESC`, [userId]),
        pool.query(`SELECT * FROM crew_training WHERE user_id = $1 ORDER BY expiry_date NULLS LAST`, [userId]),
        pool.query(
          `SELECT * FROM crew_availability WHERE user_id = $1 ORDER BY period_start DESC LIMIT 100`,
          [userId]
        ),
        pool.query(`SELECT * FROM crew_documents WHERE user_id = $1 ORDER BY expiry_date NULLS LAST`, [userId]),
        pool.query(`SELECT * FROM crew_duty_logs WHERE user_id = $1 ORDER BY duty_start DESC LIMIT 50`, [userId]),
        pool.query(
          `SELECT ca.*, f.flight_number, f.departure_time, f.arrival_time, f.departure_airport, f.arrival_airport, f.status
           FROM crew_assignments ca
           JOIN flights f ON f.id = ca.flight_id
           WHERE ca.crew_user_id = $1
           ORDER BY f.departure_time DESC
           LIMIT 40`,
          [userId]
        )
      ]);

      const rowsAt = (i) => (settled[i].status === 'fulfilled' ? settled[i].value.rows : []);
      const failed = settled
        .map((r, i) => (r.status === 'rejected' ? `[${i}] ${r.reason?.message || r.reason}` : null))
        .filter(Boolean);
      if (failed.length) {
        console.warn('[crew/:userId] partial load:', failed.join('; '));
      }

      const profileRows = rowsAt(0);

      return res.status(200).json({
        user: u.rows[0],
        profile: profileRows[0] || null,
        licenses: rowsAt(1),
        medicals: rowsAt(2),
        training: rowsAt(3),
        availability: rowsAt(4),
        documents: rowsAt(5),
        dutyLogs: rowsAt(6),
        assignments: rowsAt(7),
        cabinSafetyTrainingCode: CABIN_SAFETY_TRAINING_CODE
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to load crew detail.', error: error.message });
    }
  }
);

export default router;
