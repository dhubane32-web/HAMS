import rateLimit from 'express-rate-limit';

const isProd = process.env.NODE_ENV === 'production';
const windowMs = Number(process.env.HAMS_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);

/** Broad API throttle (per IP). */
export const apiLimiter = rateLimit({
  windowMs,
  max: Number(process.env.HAMS_RATE_LIMIT_MAX || (isProd ? 400 : 600)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' }
});

/** Strict limit on credential attempts. */
export const authLoginLimiter = rateLimit({
  windowMs: Number(process.env.HAMS_AUTH_LOGIN_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.HAMS_AUTH_LOGIN_MAX || (isProd ? 10 : 25)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts from this address. Try again later.' }
});

/** Forgot / reset password (enumeration-hardened responses; still throttle). */
export const authPasswordResetLimiter = rateLimit({
  windowMs: Number(process.env.HAMS_AUTH_RESET_WINDOW_MS || 60 * 60 * 1000),
  max: Number(process.env.HAMS_AUTH_RESET_MAX || (isProd ? 8 : 30)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many password reset requests. Try again later.' }
});
