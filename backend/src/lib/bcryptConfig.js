/**
 * bcrypt cost factor — production uses 12+ rounds (OWASP recommendation).
 */
const isProd = process.env.NODE_ENV === 'production';

export const BCRYPT_ROUNDS = (() => {
  const n = Number(process.env.HAMS_BCRYPT_ROUNDS);
  if (Number.isFinite(n) && n >= 10 && n <= 14) return Math.floor(n);
  return isProd ? 12 : 10;
})();
