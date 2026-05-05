/**
 * Shared login / 2FA lockout thresholds (env-tunable).
 */

export const MAX_FAILED = Math.max(3, Math.min(15, Number(process.env.HAMS_LOGIN_MAX_FAILED || 5)));
export const LOCK_MS = Math.max(5, Math.min(24 * 60, Number(process.env.HAMS_LOGIN_LOCK_MINUTES || 30))) * 60 * 1000;
