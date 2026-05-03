import jwt from 'jsonwebtoken';
import { userHasAnyRole, isSuperAdmin, canManageUsers } from '../lib/roles.js';

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing or invalid authorization header.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

/** Any of the listed roles; Super Admin matches lists that include `admin`. */
export function requireRoles(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user?.role) {
      return res.status(403).json({ message: 'Access denied for this role.' });
    }
    if (userHasAnyRole(req.user.role, roles)) {
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
