import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { pool } from '../../config/db.js';
import { requireAuth, requireSuperAdmin, requireUserManager } from '../../middleware/auth.js';
import { isSuperAdmin, canManageUsers } from '../../lib/roles.js';
import { writeAudit } from '../../services/auditService.js';
import { validatePasswordStrength } from '../../lib/passwordPolicy.js';
import {
  cleanupBackupsByRetention,
  decryptBackupToTemp,
  getBackupHealthSummary,
  getOffsiteProviderStatus,
  listBackupLogs,
  resolveBackupFileById,
  restoreFromBackupLog,
  runFullBackup,
  simulateRestoreFromBackupLog
} from '../../services/backupService.js';

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
  const pwCheck = validatePasswordStrength(password);
  if (!pwCheck.ok) {
    return res.status(400).json({ message: pwCheck.message });
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
    if (!isSuperAdmin(req.user.role) && target.role === 'super_admin') {
      return res.status(403).json({ message: 'Only Super Admin may modify a Super Admin account.' });
    }
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
    const roleChanged = role !== undefined && String(role) !== String(target.role);
    const deactivated = is_active !== undefined && target.is_active === true && nextActive === false;
    const activated = is_active !== undefined && target.is_active === false && nextActive === true;

    if (roleChanged) {
      await writeAudit(client, {
        userId: req.user.userId,
        action: 'USER_ROLE_CHANGED',
        entity: 'users',
        entityId: id,
        metadata: {
          fromRole: target.role,
          toRole: r.rows[0].role,
          ...(full_name !== undefined ? { full_name } : {})
        },
        req
      });
    }
    if (deactivated) {
      await writeAudit(client, {
        userId: req.user.userId,
        action: 'USER_DEACTIVATED',
        entity: 'users',
        entityId: id,
        metadata: { email: r.rows[0].email },
        req
      });
    }
    if (activated) {
      await writeAudit(client, {
        userId: req.user.userId,
        action: 'USER_ACTIVATED',
        entity: 'users',
        entityId: id,
        metadata: { email: r.rows[0].email },
        req
      });
    }
    if (!roleChanged && !deactivated && !activated) {
      await writeAudit(client, {
        userId: req.user.userId,
        action: 'USER_UPDATED',
        entity: 'users',
        entityId: id,
        metadata: { changes: { full_name, role, is_active } },
        req
      });
    }
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: 'Failed to update user.', error: e.message });
  } finally {
    client.release();
  }
});

router.post('/users/:id/password-reset', requireAuth, requireUserManager, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword) {
    return res.status(400).json({ message: 'newPassword is required.' });
  }
  const pwCheck = validatePasswordStrength(newPassword);
  if (!pwCheck.ok) {
    return res.status(400).json({ message: pwCheck.message });
  }

  const client = await pool.connect();
  try {
    const tgt = await client.query(`SELECT id, email, role FROM users WHERE id = $1::uuid`, [req.params.id]);
    if (!tgt.rows[0]) {
      return res.status(404).json({ message: 'User not found.' });
    }
    if (!isSuperAdmin(req.user.role) && tgt.rows[0].role === 'super_admin') {
      return res.status(403).json({ message: 'Only Super Admin may reset a Super Admin password.' });
    }

    const hash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
    const r = await client.query(
      `UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires_at = NULL,
         password_changed_at = NOW(), updated_at = NOW()
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

router.post('/backup/now', requireAuth, requireUserManager, async (req, res) => {
  try {
    const triggerKind = ['daily', 'weekly', 'monthly'].includes(String(req.body?.tier || ''))
      ? String(req.body.tier)
      : 'manual';
    const out = await runFullBackup({ triggeredBy: req.user.userId, triggerKind });
    await writeAudit(pool, {
      userId: req.user.userId,
      action: 'BACKUP_TRIGGERED',
      entity: 'backup_logs',
      entityId: null,
      metadata: { files: out.rows.map((x) => x.id), count: out.rows.length, triggerKind },
      req
    });
    return res.status(201).json({
      message: 'Backup created.',
      backupCount: out.rows.length,
      rows: out.rows
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to run backup.', error: error.message });
  }
});

router.get('/backup/history', requireAuth, requireUserManager, async (req, res) => {
  try {
    const { rows, limit, offset } = await listBackupLogs({ limit: req.query.limit, offset: req.query.offset });
    return res.json({ rows, limit, offset });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load backup history.', error: error.message });
  }
});

router.get('/backup/download/:id', requireAuth, requireUserManager, async (req, res) => {
  try {
    const resolved = await decryptBackupToTemp(req.params.id);
    if (!resolved?.row) {
      return res.status(404).json({ message: 'Backup entry not found.' });
    }
    const { row, tmpPath } = resolved;
    const base = String(row.file_name).split('/').pop() || `backup-${row.id}`;
    const cleaned = base.endsWith('.enc') ? base.slice(0, -4) : base;
    return res.download(tmpPath, cleaned, async () => {
      await pool.query(`UPDATE backup_logs SET last_downloaded_at = NOW() WHERE id = $1::uuid`, [row.id]).catch(() => {});
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to download backup file.', error: error.message });
  }
});

router.post('/backup/restore/:id', requireAuth, requireUserManager, async (req, res) => {
  try {
    const restored = await restoreFromBackupLog({ id: req.params.id, restoredBy: req.user.userId });
    await writeAudit(pool, {
      userId: req.user.userId,
      action: 'BACKUP_RESTORED',
      entity: 'backup_logs',
      entityId: restored.id,
      metadata: { backup_type: restored.backup_type, file_name: restored.file_name },
      req
    });
    return res.json({ message: 'Restore completed.', row: restored });
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    return res.status(status).json({ message: 'Failed to restore backup.', error: error.message });
  }
});

router.post('/backup/restore-simulate/:id', requireAuth, requireUserManager, async (req, res) => {
  try {
    const simulated = await simulateRestoreFromBackupLog({ id: req.params.id });
    await writeAudit(pool, {
      userId: req.user.userId,
      action: 'BACKUP_RESTORE_SIMULATED',
      entity: 'backup_logs',
      entityId: simulated.id,
      metadata: { backup_type: simulated.backup_type },
      req
    });
    return res.json({ message: 'Restore simulation completed.', row: simulated });
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    return res.status(status).json({ message: 'Failed to run restore simulation.', error: error.message });
  }
});

router.post('/backup/cleanup', requireAuth, requireUserManager, async (req, res) => {
  try {
    const out = await cleanupBackupsByRetention();
    return res.json({ message: 'Backup cleanup completed.', ...out });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to run cleanup.', error: error.message });
  }
});

router.get('/backup/health', requireAuth, requireUserManager, async (_req, res) => {
  try {
    const [health, offsite] = await Promise.all([getBackupHealthSummary(), getOffsiteProviderStatus()]);
    return res.json({
      health,
      retentionPolicy: { daily: '7d', weekly: '4w', monthly: '12m' },
      scheduler: {
        daily: `${String(process.env.BACKUP_DAILY_HOUR_UTC || 2).padStart(2, '0')}:${String(process.env.BACKUP_DAILY_MINUTE_UTC || 0).padStart(2, '0')} UTC`,
        weekly: `Sunday ${String(process.env.BACKUP_WEEKLY_HOUR_UTC || 2).padStart(2, '0')}:${String(process.env.BACKUP_WEEKLY_MINUTE_UTC || 15).padStart(2, '0')} UTC`,
        monthly: `Day 1 ${String(process.env.BACKUP_MONTHLY_HOUR_UTC || 2).padStart(2, '0')}:${String(process.env.BACKUP_MONTHLY_MINUTE_UTC || 30).padStart(2, '0')} UTC`
      },
      offsite
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load backup health.', error: error.message });
  }
});

export default router;
