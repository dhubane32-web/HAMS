/**
 * Mitigate cross-site request forgery for browser-based API calls in production:
 * mutating requests must declare an Origin or Referer that matches FRONTEND_URL.
 * Native/mobile clients can send `X-HAMS-Client: trusted` with a shared HAMS_INTERNAL_API_KEY (optional).
 */

import {
  allTrustedMutationOrigins,
  isAllowedVercelHamsOrigin,
  isBrowserOriginAllowed
} from '../lib/corsOrigins.js';

function originAllowed(origin, allowed) {
  if (!origin) return false;
  if (isAllowedVercelHamsOrigin(origin)) return true;
  return allowed.some((a) => origin === a || origin.startsWith(`${a}/`));
}

function refererAllowed(referer, allowed) {
  if (!referer) return false;
  try {
    const refOrigin = new URL(referer).origin;
    if (isBrowserOriginAllowed(refOrigin, { configuredOrigins: allowed, isProd: true })) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return allowed.some((a) => referer.startsWith(a));
}

export function trustedOriginMutations(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();
  const method = req.method || 'GET';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  const path = req.path || req.url || '';
  if (
    path.startsWith('/health') ||
    path.startsWith('/api/health') ||
    path.startsWith('/api/auth/login') ||
    path.startsWith('/api/auth/login/2fa') ||
    path.startsWith('/api/auth/forgot-password') ||
    path.startsWith('/api/auth/reset-password') ||
    path.startsWith('/api/auth/change-password-expired')
  ) {
    return next();
  }

  const internalKey = process.env.HAMS_INTERNAL_API_KEY;
  if (internalKey && req.get('x-hams-client') === 'trusted' && req.get('x-hams-internal-key') === internalKey) {
    return next();
  }

  const allowed = allTrustedMutationOrigins();
  const origin = req.get('origin');
  const referer = req.get('referer');
  if (originAllowed(origin, allowed) || refererAllowed(referer, allowed)) {
    return next();
  }

  return res.status(403).json({
    message: 'Origin validation failed. Use an allowed web app origin or configure HAMS_INTERNAL_API_KEY for trusted clients.'
  });
}
