import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { userHasAnyRole, isSuperAdmin, canManageUsers } from '../lib/roles.js';

const strictSession =
  process.env.NODE_ENV === 'production' && String(process.env.HAMS_STRICT_SESSION || 'true').toLowerCase() !== 'false';

function canonicalRole(role) {
  const raw = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const aliases = {
    superadmin: 'super_admin',
    super_admin: 'super_admin',
    ticketing_agent: 'booking_agent',
    reservations_agent: 'booking_agent',
    finance_admin: 'finance'
  };
  return aliases[raw] || raw;
}

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing or invalid authorization header.' });
  }

  const token = authHeader.split(' ')[1];

  void (async () => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;

      if (strictSession && decoded.userId) {
        const r = await pool.query(`SELECT is_active, role FROM users WHERE id = $1::uuid LIMIT 1`, [decoded.userId]);
        const row = r.rows[0];
        if (!row || !row.is_active) {
          return res.status(401).json({ message: 'Session invalid or account inactive.' });
        }
        if (row.role !== decoded.role) {
          return res.status(403).json({ message: 'Your role changed; please sign in again.' });
        }
      }

      if (strictSession && decoded.userId) {
        try {
          await pool.query(
            `UPDATE users SET last_activity_at = NOW()
             WHERE id = $1::uuid
               AND (last_activity_at IS NULL OR last_activity_at < NOW() - INTERVAL '2 minutes')`,
            [decoded.userId]
          );
        } catch {
          /* last_activity_at column optional until migration */
        }
      }

      return next();
    } catch (error) {
      if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Invalid or expired token.' });
      }
      return next(error);
    }
  })().catch(next);
}

/** Any of the listed roles; Super Admin matches lists that include `admin`. */
export function requireRoles(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user?.role) {
      return res.status(401).json({ message: 'Unauthenticated.' });
    }
    const userRole = canonicalRole(req.user.role);
    const allowed = roles.map((r) => canonicalRole(r));
    // Super Admin always bypasses role restrictions.
    if (userRole === 'super_admin') {
      return next();
    }
    if (userHasAnyRole(userRole, allowed)) {
      return next();
    }
    return res.status(403).json({ message: 'Access denied for this role.' });
  };
}

export function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req.user?.role)) {
    return res.status(403).json({ message: 'Super Admin only.' });
  }
  return next();
}

/** Admin or Super Admin — user lifecycle, audit read, non-security settings. */
export function requireUserManager(req, res, next) {
  if (!canManageUsers(req.user?.role)) {
    return res.status(403).json({ message: 'Admin access required.' });
  }
  return next();
}
