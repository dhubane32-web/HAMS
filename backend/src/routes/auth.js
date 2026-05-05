import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { writeAudit, writeLoginHistory } from '../services/auditService.js';
import { validatePasswordStrength } from '../lib/passwordPolicy.js';
import { MAX_FAILED, LOCK_MS } from '../lib/loginSecurity.js';
import { authLoginLimiter } from '../middleware/apiRateLimits.js';
import { requireAuth } from '../middleware/auth.js';
import { isPasswordExpired } from '../lib/passwordExpiry.js';
import { attachSessionCookie, clearSessionCookie } from '../lib/sessionCookie.js';

const router = express.Router();
const isProd = process.env.NODE_ENV === 'production';

function jwtExpiresInSeconds(token) {
  try {
    const d = jwt.decode(token);
    if (d && typeof d.exp === 'number' && typeof d.iat === 'number') return Math.max(60, d.exp - d.iat);
  } catch {
    /* ignore */
  }
  return 3600;
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

router.post('/login', authLoginLimiter, async (req, res) => {
  const { email, password } = req.body;
  const emailNorm = email ? String(email).toLowerCase().trim() : '';

  if (!emailNorm || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const userResult = await pool.query(
      `SELECT id, full_name, email, password_hash, role, is_active,
              COALESCE(failed_login_count, 0)::int AS failed_login_count,
              locked_until,
              COALESCE(totp_enabled, FALSE) AS totp_enabled,
              password_changed_at
       FROM users
       WHERE email = $1`,
      [emailNorm]
    );

    const user = userResult.rows[0];

    if (!user) {
      await writeLoginHistory({ email: emailNorm, success: false, req, reason: 'USER_NOT_FOUND' });
      await writeAudit(pool, {
        userId: null,
        action: 'LOGIN_FAILED',
        entity: 'users',
        entityId: null,
        metadata: { email: emailNorm, reason: 'USER_NOT_FOUND' },
        req
      });
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await writeLoginHistory({ userId: user.id, email: emailNorm, success: false, req, reason: 'ACCOUNT_LOCKED' });
      await writeAudit(pool, {
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'users',
        entityId: user.id,
        metadata: { email: emailNorm, reason: 'ACCOUNT_LOCKED' },
        req
      });
      return res.status(423).json({ message: 'Account is temporarily locked. Try again later or contact support.' });
    }

    if (!user.is_active) {
      await writeLoginHistory({ userId: user.id, email: emailNorm, success: false, req, reason: 'USER_INACTIVE' });
      await writeAudit(pool, {
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'users',
        entityId: user.id,
        metadata: { email: emailNorm, reason: 'USER_INACTIVE' },
        req
      });
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    let passwordOk = false;
    try {
      passwordOk = Boolean(user.password_hash) && (await bcrypt.compare(password, String(user.password_hash)));
    } catch {
      passwordOk = false;
    }

    if (passwordOk && isPasswordExpired(user.password_changed_at)) {
      const changePasswordToken = jwt.sign(
        { typ: 'pwd_change', sub: user.id },
        process.env.JWT_SECRET,
        { expiresIn: '20m' }
      );
      await writeAudit(pool, {
        userId: user.id,
        action: 'LOGIN_PASSWORD_EXPIRED',
        entity: 'users',
        entityId: user.id,
        metadata: { email: user.email },
        req
      });
      return res.status(200).json({
        passwordChangeRequired: true,
        changePasswordToken,
        user: { id: user.id, name: user.full_name, email: user.email, role: user.role }
      });
    }

    if (!passwordOk) {
      const next = Number(user.failed_login_count || 0) + 1;
      const lockUntil = next >= MAX_FAILED ? new Date(Date.now() + LOCK_MS) : null;
      await pool.query(
        `UPDATE users SET failed_login_count = $2, locked_until = $3, updated_at = NOW()
         WHERE id = $1::uuid`,
        [user.id, next, lockUntil]
      );
      await writeLoginHistory({ userId: user.id, email: emailNorm, success: false, req, reason: 'BAD_PASSWORD' });
      await writeAudit(pool, {
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'users',
        entityId: user.id,
        metadata: { email: emailNorm, reason: 'BAD_PASSWORD', failed_attempts: next },
        req
      });
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    if (user.totp_enabled) {
      const twoFactorToken = jwt.sign({ typ: '2fa', sub: user.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
      await writeAudit(pool, {
        userId: user.id,
        action: 'LOGIN_2FA_REQUIRED',
        entity: 'users',
        entityId: user.id,
        metadata: { email: user.email },
        req
      });
      return res.status(200).json({
        requiresTwoFactor: true,
        twoFactorToken,
        user: { id: user.id, name: user.full_name, email: user.email, role: user.role }
      });
    }

    const isProd = process.env.NODE_ENV === 'production';
    const expiresIn = process.env.JWT_EXPIRES_IN || (isProd ? '1h' : '8h');
    const token = jwt.sign(
      {
        userId: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn }
    );

    await pool.query(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1::uuid`,
      [user.id]
    );

    await writeLoginHistory({ userId: user.id, email: emailNorm, success: true, req, reason: null });
    await writeAudit(pool, {
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      entity: 'users',
      entityId: user.id,
      metadata: { email: user.email },
      req
    });

    try {
      await pool.query(
        `UPDATE users SET last_activity_at = NOW() WHERE id = $1::uuid
         AND (last_activity_at IS NULL OR last_activity_at < NOW() - INTERVAL '2 minutes')`,
        [user.id]
      );
    } catch {
      /* optional column before migration */
    }

    attachSessionCookie(res, token);

    return res.status(200).json({
      token,
      expiresInSec: jwtExpiresInSeconds(token),
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    return res.status(500).json({ message: 'Login failed.', error: isProd ? undefined : error.message });
  }
});

/** Rotate password while authenticated. */
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'currentPassword and newPassword are required.' });
  }
  const pwCheck = validatePasswordStrength(newPassword);
  if (!pwCheck.ok) {
    return res.status(400).json({ message: pwCheck.message });
  }
  try {
    const r = await pool.query(`SELECT id, password_hash FROM users WHERE id = $1::uuid`, [req.user.userId]);
    const u = r.rows[0];
    if (!u) return res.status(404).json({ message: 'User not found.' });
    const ok = await bcrypt.compare(String(currentPassword), u.password_hash);
    if (!ok) return res.status(401).json({ message: 'Current password is incorrect.' });
    const hash = await bcrypt.hash(String(newPassword), 10);
    await pool.query(
      `UPDATE users SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW() WHERE id = $2::uuid`,
      [hash, u.id]
    );
    await writeAudit(pool, {
      userId: u.id,
      action: 'PASSWORD_CHANGED',
      entity: 'users',
      entityId: u.id,
      metadata: { channel: 'self_service' },
      req
    });
    return res.json({ message: 'Password updated.' });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to change password.', error: isProd ? undefined : e.message });
  }
});

/**
 * After login flagged `passwordChangeRequired`, submit new password using short-lived `changePasswordToken`.
 */
router.post('/change-password-expired', authLoginLimiter, async (req, res) => {
  const { changePasswordToken, newPassword } = req.body || {};
  if (!changePasswordToken || !newPassword) {
    return res.status(400).json({ message: 'changePasswordToken and newPassword are required.' });
  }
  const pwCheck = validatePasswordStrength(newPassword);
  if (!pwCheck.ok) {
    return res.status(400).json({ message: pwCheck.message });
  }
  try {
    const payload = jwt.verify(String(changePasswordToken), process.env.JWT_SECRET);
    if (payload.typ !== 'pwd_change' || !payload.sub) {
      return res.status(400).json({ message: 'Invalid password change token.' });
    }
    const r = await pool.query(
      `SELECT id, full_name, email, role, is_active FROM users WHERE id = $1::uuid`,
      [payload.sub]
    );
    const user = r.rows[0];
    if (!user?.is_active) {
      return res.status(401).json({ message: 'Account is not active.' });
    }
    const hash = await bcrypt.hash(String(newPassword), 10);
    await pool.query(
      `UPDATE users SET password_hash = $1, password_changed_at = NOW(), failed_login_count = 0, locked_until = NULL, updated_at = NOW()
       WHERE id = $2::uuid`,
      [hash, user.id]
    );
    await writeAudit(pool, {
      userId: user.id,
      action: 'PASSWORD_EXPIRY_RESET',
      entity: 'users',
      entityId: user.id,
      metadata: {},
      req
    });

    const expiresIn = process.env.JWT_EXPIRES_IN || (isProd ? '1h' : '8h');
    const token = jwt.sign(
      { userId: user.id, name: user.full_name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn }
    );
    attachSessionCookie(res, token);
    await writeLoginHistory({ userId: user.id, email: user.email, success: true, req, reason: null });
    await writeAudit(pool, {
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      entity: 'users',
      entityId: user.id,
      metadata: { via: 'password_expiry_flow' },
      req
    });

    return res.status(200).json({
      token,
      expiresInSec: jwtExpiresInSeconds(token),
      user: { id: user.id, name: user.full_name, email: user.email, role: user.role }
    });
  } catch (e) {
    if (e?.name === 'JsonWebTokenError' || e?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Password change session expired. Sign in again.' });
    }
    return res.status(500).json({ message: 'Failed to update password.', error: isProd ? undefined : e.message });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  try {
    await writeAudit(pool, {
      userId: req.user.userId,
      action: 'LOGOUT',
      entity: 'users',
      entityId: req.user.userId,
      metadata: {},
      req
    });
    clearSessionCookie(res);
    return res.status(200).json({ message: 'Signed out.' });
  } catch (e) {
    return res.status(500).json({ message: 'Logout failed.', error: isProd ? undefined : e.message });
  }
});

/** Always 200 — do not reveal whether the email exists. */
router.post('/forgot-password', async (req, res) => {
  const email = req.body?.email ? String(req.body.email).toLowerCase().trim() : '';
  try {
    if (email) {
      const r = await pool.query(`SELECT id FROM users WHERE email = $1 AND is_active = TRUE`, [email]);
      if (r.rows[0]) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashResetToken(rawToken);
        const expires = new Date(Date.now() + 60 * 60 * 1000);
        await pool.query(
          `UPDATE users SET password_reset_token = $1, password_reset_expires_at = $2, updated_at = NOW() WHERE id = $3`,
          [tokenHash, expires, r.rows[0].id]
        );
        await writeAudit(pool, {
          userId: r.rows[0].id,
          action: 'PASSWORD_RESET_REQUESTED',
          entity: 'users',
          entityId: r.rows[0].id,
          metadata: { channel: 'self_service' },
          req
        });
        if (process.env.NODE_ENV !== 'production') {
          return res.status(200).json({
            message: 'If the account exists, a reset token was generated (dev only).',
            devResetToken: rawToken
          });
        }
      }
    }
    return res.status(200).json({ message: 'If the account exists, password reset instructions will be sent.' });
  } catch (error) {
    return res.status(500).json({ message: 'Request failed.', error: error.message });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ message: 'token and newPassword are required.' });
  }
  const pwCheck = validatePasswordStrength(newPassword);
  if (!pwCheck.ok) {
    return res.status(400).json({ message: pwCheck.message });
  }
  const tokenHash = hashResetToken(token);
  const client = await pool.connect();
  try {
    const u = await client.query(
      `SELECT id FROM users
       WHERE password_reset_token = $1 AND password_reset_expires_at > NOW() AND is_active = TRUE`,
      [tokenHash]
    );
    if (!u.rows[0]) {
      return res.status(400).json({ message: 'Invalid or expired reset token.' });
    }
    const hash = await bcrypt.hash(String(newPassword), 10);
    await client.query(
      `UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires_at = NULL,
         password_changed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [hash, u.rows[0].id]
    );
    await writeAudit(client, {
      userId: u.rows[0].id,
      action: 'PASSWORD_RESET_COMPLETED',
      entity: 'users',
      entityId: u.rows[0].id,
      metadata: {},
      req
    });
    return res.json({ message: 'Password has been reset. You can sign in.' });
  } catch (error) {
    return res.status(500).json({ message: 'Reset failed.', error: error.message });
  } finally {
    client.release();
  }
});

export default router;
