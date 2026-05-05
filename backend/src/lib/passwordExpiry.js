/**
 * Optional password max age (days). 0 = disabled.
 */
export function passwordMaxAgeDays() {
  const n = Number(process.env.HAMS_PASSWORD_MAX_AGE_DAYS || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(3650, Math.floor(n));
}

export function isPasswordExpired(passwordChangedAt) {
  const maxDays = passwordMaxAgeDays();
  if (maxDays <= 0) return false;
  if (!passwordChangedAt) return false;
  const t = new Date(passwordChangedAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t > maxDays * 86400000;
}
