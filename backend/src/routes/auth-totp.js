import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { encryptField, decryptField } from '../lib/cryptoField.js';
import { writeAudit, writeLoginHistory } from '../services/auditService.js';
import { authLoginLimiter } from '../middleware/apiRateLimits.js';
import { MAX_FAILED, LOCK_MS } from '../lib/loginSecurity.js';
import { attachSessionCookie } from '../lib/sessionCookie.js';

const router = express.Router();

authenticator.options = { window: 1 };

function jwtExpiresInSeconds(token) {
  try {
    const d = jwt.decode(token);
    if (d && typeof d.exp === 'number' && typeof d.iat === 'number') return Math.max(60, d.exp - d.iat);
  } catch {
    /* ignore */
  }
  return 3600;
}

/** POST /api/auth/login/2fa */
router.post('/login/2fa', authLoginLimiter, async (req, res) => {
  const { twoFactorToken, code } = req.body || {};
  if (!twoFactorToken || !code) {
    return res.status(400).json({ message: 'twoFactorToken and code are required.' });
  }
  try {
    const payload = jwt.verify(String(twoFactorToken), process.env.JWT_SECRET);
    if (payload.typ !== '2fa' || !payload.sub) {
      return res.status(400).json({ message: 'Invalid two-factor token.' });
    }
    const uid = payload.sub;
    const r = await pool.query(
      `SELECT id, full_name, email, role, is_active, totp_enabled, totp_secret_enc
       FROM users WHERE id = $1::uuid`,
      [uid]
    );
    const user = r.rows[0];
    if (!user || !user.is_active || !user.totp_enabled || !user.totp_secret_enc) {
      return res.status(401).json({ message: 'Two-factor authentication is not available for this account.' });
    }
    let secret;
    try {
      secret = decryptField(user.totp_secret_enc);
    } catch {
      return res.status(500).json({ message: 'Unable to read two-factor configuration.' });
    }
    const ok = authenticator.verify({ token: String(code).replace(/\s/g, ''), secret });
    if (!ok) {
      const cntQ = await pool.query(
        `SELECT COALESCE(failed_login_count, 0)::int AS c FROM users WHERE id = $1::uuid`,
        [user.id]
      );
      const next = Number(cntQ.rows[0]?.c || 0) + 1;
      const lockUntil = next >= MAX_FAILED ? new Date(Date.now() + LOCK_MS) : null;
      await pool.query(
        `UPDATE users SET failed_login_count = $2, locked_until = COALESCE($3, locked_until), updated_at = NOW() WHERE id = $1::uuid`,
        [user.id, next, lockUntil]
      );
      await writeLoginHistory({ userId: user.id, email: user.email, success: false, req, reason: 'BAD_TOTP' });
      await writeAudit(pool, {
        userId: user.id,
        action: 'LOGIN_2FA_FAILED',
        entity: 'users',
        entityId: user.id,
        metadata: { failed_attempts: next, locked: Boolean(lockUntil) },
        req
      });
      return res.status(401).json({ message: 'Invalid authentication code.' });
    }

    const isProd = process.env.NODE_ENV === 'production';
    const expiresIn = process.env.JWT_EXPIRES_IN || (isProd ? '1h' : '8h');
    const token = jwt.sign(
      { userId: user.id, name: user.full_name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn }
    );

    await pool.query(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1::uuid`,
      [user.id]
    );

    await writeLoginHistory({ userId: user.id, email: user.email, success: true, req, reason: null });
    await writeAudit(pool, {
      userId: user.id,
      action: 'LOGIN_SUCCESS_2FA',
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
      /* optional column */
    }

    attachSessionCookie(res, token);

    return res.status(200).json({
      token,
      expiresInSec: jwtExpiresInSeconds(token),
      user: { id: user.id, name: user.full_name, email: user.email, role: user.role }
    });
  } catch (e) {
    if (e?.name === 'JsonWebTokenError' || e?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Two-factor session expired. Sign in again.' });
    }
    return res.status(500).json({ message: 'Two-factor verification failed.', error: e.message });
  }
});

router.post('/2fa/setup', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, email, totp_enabled, totp_pending_secret_enc FROM users WHERE id = $1::uuid`,
      [req.user.userId]
    );
    const u = r.rows[0];
    if (!u) return res.status(404).json({ message: 'User not found.' });
    if (u.totp_enabled) {
      return res.status(400).json({ message: 'Two-factor authentication is already enabled.' });
    }
    const secret = authenticator.generateSecret();
    const enc = encryptField(secret);
    await pool.query(`UPDATE users SET totp_pending_secret_enc = $2, updated_at = NOW() WHERE id = $1::uuid`, [
      u.id,
      enc
    ]);
    const otpauthUrl = authenticator.keyuri(u.email, 'HAMS Hawana', secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
    await writeAudit(pool, {
      userId: u.id,
      action: 'TOTP_SETUP_STARTED',
      entity: 'users',
      entityId: u.id,
      metadata: {},
      req
    });
    return res.json({ otpauthUrl, qrDataUrl });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to start 2FA setup.', error: e.message });
  }
});

router.post('/2fa/confirm-setup', requireAuth, async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ message: 'code is required.' });
  try {
    const r = await pool.query(
      `SELECT id, totp_enabled, totp_pending_secret_enc FROM users WHERE id = $1::uuid`,
      [req.user.userId]
    );
    const u = r.rows[0];
    if (!u || u.totp_enabled) {
      return res.status(400).json({ message: 'Two-factor is already active or setup was not started.' });
    }
    if (!u.totp_pending_secret_enc) {
      return res.status(400).json({ message: 'Start setup first (POST /api/auth/2fa/setup).' });
    }
    const secret = decryptField(u.totp_pending_secret_enc);
    const ok = authenticator.verify({ token: String(code).replace(/\s/g, ''), secret });
    if (!ok) return res.status(400).json({ message: 'Invalid code. Try again.' });

    await pool.query(
      `UPDATE users SET totp_secret_enc = $2, totp_pending_secret_enc = NULL, totp_enabled = TRUE,
         updated_at = NOW() WHERE id = $1::uuid`,
      [u.id, encryptField(secret)]
    );
    await writeAudit(pool, {
      userId: u.id,
      action: 'TOTP_ENABLED',
      entity: 'users',
      entityId: u.id,
      metadata: {},
      req
    });
    return res.json({ message: 'Two-factor authentication is now enabled.' });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to confirm 2FA.', error: e.message });
  }
});

router.post('/2fa/disable', requireAuth, async (req, res) => {
  const { password, code } = req.body || {};
  if (!password || !code) {
    return res.status(400).json({ message: 'password and code are required.' });
  }
  try {
    const r = await pool.query(
      `SELECT id, email, password_hash, totp_enabled, totp_secret_enc FROM users WHERE id = $1::uuid`,
      [req.user.userId]
    );
    const u = r.rows[0];
    if (!u || !u.totp_enabled) {
      return res.status(400).json({ message: 'Two-factor authentication is not enabled.' });
    }
    const pwOk = await bcrypt.compare(String(password), u.password_hash);
    if (!pwOk) return res.status(401).json({ message: 'Invalid password.' });
    const secret = decryptField(u.totp_secret_enc);
    const ok = authenticator.verify({ token: String(code).replace(/\s/g, ''), secret });
    if (!ok) return res.status(401).json({ message: 'Invalid authentication code.' });

    await pool.query(
      `UPDATE users SET totp_enabled = FALSE, totp_secret_enc = NULL, totp_pending_secret_enc = NULL, updated_at = NOW()
       WHERE id = $1::uuid`,
      [u.id]
    );
    await writeAudit(pool, {
      userId: u.id,
      action: 'TOTP_DISABLED',
      entity: 'users',
      entityId: u.id,
      metadata: {},
      req
    });
    return res.json({ message: 'Two-factor authentication has been disabled.' });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to disable 2FA.', error: e.message });
  }
});

export default router;
