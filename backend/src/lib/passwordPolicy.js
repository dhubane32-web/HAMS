/**
 * Password policy for HAMS (registration, reset, admin-set password).
 * Production uses stricter rules via NODE_ENV.
 */

const MIN_LEN_DEV = 8;
const MIN_LEN_PROD = 10;

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validatePasswordStrength(password) {
  const p = String(password ?? '');
  const min = isProduction() ? MIN_LEN_PROD : MIN_LEN_DEV;
  if (p.length < min) {
    return { ok: false, message: `Password must be at least ${min} characters.` };
  }
  if (p.length > 128) {
    return { ok: false, message: 'Password must be at most 128 characters.' };
  }
  const hasUpper = /[A-Z]/.test(p);
  const hasLower = /[a-z]/.test(p);
  const hasDigit = /\d/.test(p);
  const hasSpecial = /[^A-Za-z0-9]/.test(p);
  const classes = [hasUpper, hasLower, hasDigit, hasSpecial].filter(Boolean).length;
  if (classes < 3) {
    return {
      ok: false,
      message:
        'Password must include at least three of: uppercase letter, lowercase letter, number, symbol.'
    };
  }
  const common = ['password', '12345678', 'qwerty', 'admin123', 'letmein'];
  if (common.some((c) => p.toLowerCase().includes(c))) {
    return { ok: false, message: 'Password is too common; choose a stronger phrase.' };
  }
  if (/(.)\1{3,}/.test(p)) {
    return { ok: false, message: 'Password must not contain more than three repeated characters in a row.' };
  }
  if (isProduction() && /012|123|234|345|456|567|678|789|890|abc|bcd|cde/i.test(p)) {
    return { ok: false, message: 'Password must not contain obvious keyboard or numeric sequences.' };
  }
  return { ok: true };
}
