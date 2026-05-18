import jwt from 'jsonwebtoken';

const COOKIE_NAME = 'hams_token';

export function isHttpOnlySessionEnabled() {
  const isProd = process.env.NODE_ENV === 'production';
  const raw = String(process.env.HAMS_HTTPONLY_SESSION ?? (isProd ? 'true' : 'false')).toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on';
}

export function sessionCookieMaxAgeMs(token) {
  try {
    const d = jwt.decode(String(token));
    if (d && typeof d.exp === 'number' && typeof d.iat === 'number') {
      return Math.max(60_000, (d.exp - d.iat) * 1000);
    }
  } catch {
    /* ignore */
  }
  return 60 * 60 * 1000;
}

/**
 * Attach session JWT cookie (optionally httpOnly for XSS resistance; SPA may still use Bearer from body).
 * @param {import('express').Response} res
 */
export function attachSessionCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  const httpOnly = isHttpOnlySessionEnabled();
  const maxAge = sessionCookieMaxAgeMs(token);
  res.cookie(COOKIE_NAME, token, {
    httpOnly,
    secure: isProd,
    sameSite: 'lax',
    maxAge,
    path: '/'
  });
}

export function clearSessionCookie(res) {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/'
  });
  res.clearCookie(COOKIE_NAME, {
    httpOnly: false,
    secure: isProd,
    sameSite: 'lax',
    path: '/'
  });
}
