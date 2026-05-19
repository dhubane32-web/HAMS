/**
 * Fail fast in production when critical secrets are weak or missing.
 * Call once at process startup before listening.
 */
function parseJwtExpiresToSeconds(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const m = /^(\d+)([smhd])$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = u === 's' ? 1 : u === 'm' ? 60 : u === 'h' ? 3600 : 86400;
  return n * mult;
}

export function validateProductionEnv() {
  if (process.env.NODE_ENV !== 'production') return;

  const jwt = process.env.JWT_SECRET;
  if (!jwt || String(jwt).length < 32) {
    throw new Error('Production requires JWT_SECRET with at least 32 characters.');
  }

  if (!process.env.FRONTEND_URL || !String(process.env.FRONTEND_URL).trim()) {
    throw new Error('Production requires FRONTEND_URL (comma-separated allowed web origins).');
  }

  const origins = String(process.env.FRONTEND_URL)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const o of origins) {
    if (/localhost|127\.0\.0\.1/i.test(o)) {
      throw new Error('Production FRONTEND_URL must not include localhost or 127.0.0.1.');
    }
  }

  const dbUrl = process.env.DATABASE_URL || '';
  if (!String(dbUrl).trim() || !/^postgres(ql)?:\/\//i.test(dbUrl)) {
    throw new Error('Production requires a valid DATABASE_URL (postgresql://…).');
  }
  if (/localhost|127\.0\.0\.1/i.test(dbUrl) && !/\.railway\.internal|\.rlwy\.net/i.test(dbUrl)) {
    throw new Error('Production DATABASE_URL must not point to localhost.');
  }

  const publicApi = process.env.NEXT_PUBLIC_API_URL || '';
  if (/localhost|127\.0\.0\.1/i.test(publicApi)) {
    throw new Error('Production must not set NEXT_PUBLIC_API_URL to localhost (use /api proxy).');
  }

  const enc = process.env.HAMS_ENCRYPTION_KEY;
  if (!enc || String(enc).length < 32) {
    throw new Error('Production requires HAMS_ENCRYPTION_KEY with at least 32 characters (TOTP and sensitive fields).');
  }

  const backupEnc = process.env.BACKUP_ENCRYPTION_KEY;
  if (!backupEnc || String(backupEnc).length < 32) {
    throw new Error('Production requires BACKUP_ENCRYPTION_KEY with at least 32 characters (encrypted backups).');
  }

  const devBackupDefault = 'hams-backup-dev-key-change-in-production';
  if (String(backupEnc) === devBackupDefault) {
    throw new Error('Production must not use the default BACKUP_ENCRYPTION_KEY.');
  }

  const jwtExp = process.env.JWT_EXPIRES_IN || '1h';
  const sec = parseJwtExpiresToSeconds(jwtExp);
  if (sec != null && sec > 48 * 3600) {
    throw new Error('Production JWT_EXPIRES_IN must not exceed 48h (use a shorter access token).');
  }

  const pwdMax = process.env.HAMS_PASSWORD_MAX_AGE_DAYS;
  if (pwdMax != null && String(pwdMax).trim() !== '') {
    const n = Number(pwdMax);
    if (!Number.isFinite(n) || n < 0 || n > 3650) {
      throw new Error('HAMS_PASSWORD_MAX_AGE_DAYS must be between 0 and 3650 when set.');
    }
  }
}
