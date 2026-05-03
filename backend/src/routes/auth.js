import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { writeAudit, writeLoginHistory } from '../services/auditService.js';

const router = express.Router();

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const emailNorm = email ? String(email).toLowerCase().trim() : '';

  if (!emailNorm || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const userResult = await pool.query(
      `SELECT id, full_name, email, password_hash, role, is_active
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

    const passwordOk = await bcrypt.compare(password, user.password_hash);

    if (!passwordOk) {
      await writeLoginHistory({ userId: user.id, email: emailNorm, success: false, req, reason: 'BAD_PASSWORD' });
      await writeAudit(pool, {
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'users',
        entityId: user.id,
        metadata: { email: emailNorm, reason: 'BAD_PASSWORD' },
        req
      });
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
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

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    return res.status(500).json({ message: 'Login failed.', error: error.message });
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
  if (!token || !newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ message: 'token and newPassword (min 8 chars) are required.' });
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
      `UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires_at = NULL, updated_at = NOW()
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
