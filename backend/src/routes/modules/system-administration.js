import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { pool } from '../../config/db.js';
import { requireAuth, requireSuperAdmin, requireUserManager } from '../../middleware/auth.js';
import { isSuperAdmin, canManageUsers } from '../../lib/roles.js';
import { writeAudit } from '../../services/auditService.js';

const router = express.Router();

const BCRYPT_ROUNDS = 10;

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

router.get('/capabilities', requireAuth, (req, res) => {
  const role = req.user.role;
  return res.json({
    role,
    isSuperAdmin: isSuperAdmin(role),
    canManageUsers: canManageUsers(role),
    canManageRoles: isSuperAdmin(role),
    canEditSecuritySettings: isSuperAdmin(role),
    canEditBackupSettings: canManageUsers(role),
    canEditNotificationSettings: canManageUsers(role)
  });
});

router.get('/users', requireAuth, requireUserManager, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, full_name, email, role, is_active, created_at, updated_at
       FROM users ORDER BY full_name`
    );
    res.json({ users: r.rows });
  } catch (e) {
    res.status(500).json({ message: 'Failed to list users.', error: e.message });
  }
});

router.post('/users', requireAuth, requireUserManager, async (req, res) => {
  const { full_name, email, password, role = 'agent' } = req.body;
  if (!full_name || !email || !password) {
    return res.status(400).json({ message: 'full_name, email, and password are required.' });
  }
  if (role === 'super_admin' && !isSuperAdmin(req.user.role)) {
    return res.status(403).json({ message: 'Only Super Admin can assign the Super Admin role.' });
  }

  const client = await pool.connect();
  try {
    const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    const ins = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4::user_role, TRUE)
       RETURNING id, full_name, email, role, is_active, created_at`,
      [full_name, String(email).toLowerCase(), hash, role]
    );
    await writeAudit(client, {
      userId: req.user.userId,
      action: 'USER_CREATED',
      entity: 'users',
      entityId: ins.rows[0].id,
      metadata: { email: ins.rows[0].email, role: ins.rows[0].role },
      req
    });
    res.status(201).json(ins.rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ message: 'Email already registered.' });
    }
    res.status(500).json({ message: 'Failed to create user.', error: e.message });
  } finally {
    client.release();
  }
});

router.put('/users/:id', requireAuth, requireUserManager, async (req, res) => {
  const { id } = req.params;
  const { full_name, role, is_active } = req.body;

  if (role === 'super_admin' && !isSuperAdmin(req.user.role)) {
    return res.status(403).json({ message: 'Only Super Admin can assign the Super Admin role.' });
  }

  const client = await pool.connect();
  try {
    const cur = await client.query(`SELECT id, role, is_active FROM users WHERE id = $1`, [id]);
    if (!cur.rows[0]) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const target = cur.rows[0];
    const nextRole = role !== undefined ? role : target.role;
    const nextActive = is_active !== undefined ? Boolean(is_active) : target.is_active;

    if (String(req.user.userId) === String(id) && nextActive === false) {
      return res.status(400).json({ message: 'You cannot deactivate your own account.' });
    }

    if (target.role === 'super_admin' && nextRole !== 'super_admin') {
      const c = await client.query(
        `SELECT COUNT(*)::int AS c FROM users WHERE role = 'super_admin' AND is_active = TRUE`
      );
      if (c.rows[0].c <= 1) {
        return res.status(400).json({ message: 'Cannot remove the last Super Admin role.' });
      }
    }
    if (target.role === 'super_admin' && nextActive === false) {
      const c = await client.query(
        `SELECT COUNT(*)::int AS c FROM users WHERE role = 'super_admin' AND is_active = TRUE`
      );
      if (c.rows[0].c <= 1) {
        return res.status(400).json({ message: 'Cannot deactivate the last Super Admin.' });
      }
    }

    const r = await client.query(
      `UPDATE users SET
         full_name = COALESCE($1::text, full_name),
         role = COALESCE($2::user_role, role),
         is_active = COALESCE($3::boolean, is_active),
         updated_at = NOW()
       WHERE id = $4::uuid
       RETURNING id, full_name, email, role, is_active, created_at, updated_at`,
      [
        full_name !== undefined ? full_name : null,
        role !== undefined ? role : null,
        is_active !== undefined ? nextActive : null,
        id
      ]
    );
    await writeAudit(client, {
      userId: req.user.userId,
      action: 'USER_UPDATED',
      entity: 'users',
      entityId: id,
      metadata: { changes: { full_name, role, is_active } },
      req
    });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: 'Failed to update user.', error: e.message });
  } finally {
    client.release();
  }
});

router.post('/users/:id/password-reset', requireAuth, requireUserManager, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ message: 'newPassword must be at least 8 characters.' });
  }

  const client = await pool.connect();
  try {
    const hash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
    const r = await client.query(
      `UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires_at = NULL, updated_at = NOW()
       WHERE id = $2::uuid RETURNING id, email`,
      [hash, req.params.id]
    );
    if (!r.rows[0]) {
      return res.status(404).json({ message: 'User not found.' });
    }
    await writeAudit(client, {
      userId: req.user.userId,
      action: 'USER_PASSWORD_RESET_BY_ADMIN',
      entity: 'users',
      entityId: req.params.id,
      metadata: { targetEmail: r.rows[0].email },
      req
    });
    res.json({ message: 'Password updated. User must use the new password on next login.' });
  } catch (e) {
    res.status(500).json({ message: 'Failed to reset password.', error: e.message });
  } finally {
    client.release();
  }
});

router.get('/audit-logs', requireAuth, requireUserManager, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  try {
    const r = await pool.query(
      `SELECT id, user_id, action, entity, entity_id, metadata, ip_address, user_agent, created_at
       FROM audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ rows: r.rows, limit, offset });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load audit logs.', error: e.message });
  }
});

router.get('/login-history', requireAuth, requireUserManager, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  try {
    const r = await pool.query(
      `SELECT lh.id, lh.user_id, lh.email, lh.success, lh.ip_address, lh.reason, lh.created_at, u.full_name
       FROM login_history lh
       LEFT JOIN users u ON u.id = lh.user_id
       ORDER BY lh.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ rows: r.rows, limit, offset });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load login history.', error: e.message });
  }
});

router.get('/activity', requireAuth, requireUserManager, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 80, 300);
  try {
    const [audit, logins] = await Promise.all([
      pool.query(
        `SELECT id, user_id, action, entity, entity_id, metadata, created_at, 'audit' AS source
         FROM audit_logs ORDER BY created_at DESC LIMIT $1`,
        [limit]
      ),
      pool.query(
        `SELECT id, user_id, email AS action_detail, success::text, reason, created_at, 'login' AS source
         FROM login_history ORDER BY created_at DESC LIMIT $1`,
        [limit]
      )
    ]);
    const merged = [...audit.rows, ...logins.rows]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
    res.json({ rows: merged });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load activity.', error: e.message });
  }
});

router.get('/permissions', requireAuth, requireSuperAdmin, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT code, description, category FROM sys_permissions ORDER BY category, code`);
    res.json({ permissions: r.rows });
  } catch (e) {
    res.status(500).json({ message: 'Failed to list permissions.', error: e.message });
  }
});

router.get('/roles', requireAuth, requireSuperAdmin, async (_req, res) => {
  try {
    const roles = await pool.query(
      `SELECT enumlabel AS role
       FROM pg_enum e
       JOIN pg_type t ON e.enumtypid = t.oid
       WHERE t.typname = 'user_role'
       ORDER BY e.enumsortorder`
    );
    res.json({ roles: roles.rows.map((x) => x.role) });
  } catch (e) {
    res.status(500).json({ message: 'Failed to list roles.', error: e.message });
  }
});

router.get('/roles/:role/permissions', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT permission_code FROM sys_role_permissions WHERE role = $1::user_role ORDER BY permission_code`,
      [req.params.role]
    );
    res.json({ role: req.params.role, permissionCodes: r.rows.map((x) => x.permission_code) });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load role permissions.', error: e.message });
  }
});

router.put('/roles/:role/permissions', requireAuth, requireSuperAdmin, async (req, res) => {
  const { permissionCodes } = req.body;
  if (!Array.isArray(permissionCodes)) {
    return res.status(400).json({ message: 'permissionCodes must be an array of strings.' });
  }
  const role = String(req.params.role);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM sys_role_permissions WHERE role = $1::user_role`, [role]);
    for (const code of permissionCodes) {
      await client.query(
        `INSERT INTO sys_role_permissions (role, permission_code) VALUES ($1::user_role, $2)`,
        [role, String(code)]
      );
    }
    await writeAudit(client, {
      userId: req.user.userId,
      action: 'ROLE_PERMISSIONS_UPDATED',
      entity: 'sys_role_permissions',
      entityId: null,
      metadata: { role, count: permissionCodes.length },
      req
    });
    await client.query('COMMIT');
    res.json({ role, permissionCodes });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Failed to update permissions.', error: e.message });
  } finally {
    client.release();
  }
});

router.get('/settings/:category', requireAuth, requireUserManager, async (req, res) => {
  const cat = String(req.params.category || '').toLowerCase();
  if (!['security', 'backup', 'notification'].includes(cat)) {
    return res.status(400).json({ message: 'Invalid category.' });
  }
  if (cat === 'security' && !isSuperAdmin(req.user.role)) {
    return res.status(403).json({ message: 'Security settings are visible to Super Admin only.' });
  }
  try {
    const r = await pool.query(`SELECT setting_key, value_json, updated_at FROM system_settings WHERE category = $1`, [cat]);
    res.json({ category: cat, settings: r.rows });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load settings.', error: e.message });
  }
});

router.put('/settings/:category/:key', requireAuth, async (req, res) => {
  const cat = String(req.params.category || '').toLowerCase();
  const key = String(req.params.key || '');
  const { value } = req.body;
  if (value === undefined || typeof value !== 'object') {
    return res.status(400).json({ message: 'value (object) is required.' });
  }
  if (!['security', 'backup', 'notification'].includes(cat)) {
    return res.status(400).json({ message: 'Invalid category.' });
  }
  if (cat === 'security' && !isSuperAdmin(req.user.role)) {
    return res.status(403).json({ message: 'Only Super Admin can edit security settings.' });
  }
  if ((cat === 'backup' || cat === 'notification') && !canManageUsers(req.user.role)) {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  const client = await pool.connect();
  try {
    const r = await client.query(
      `INSERT INTO system_settings (category, setting_key, value_json, updated_by)
       VALUES ($1, $2, $3::jsonb, $4::uuid)
       ON CONFLICT (category, setting_key)
       DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW(), updated_by = EXCLUDED.updated_by
       RETURNING category, setting_key, value_json, updated_at`,
      [cat, key, JSON.stringify(value), req.user.userId]
    );
    await writeAudit(client, {
      userId: req.user.userId,
      action: 'SYSTEM_SETTING_UPDATED',
      entity: 'system_settings',
      entityId: null,
      metadata: { category: cat, setting_key: key },
      req
    });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: 'Failed to save setting.', error: e.message });
  } finally {
    client.release();
  }
});

export default router;
