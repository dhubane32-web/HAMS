/**
 * Production site / back-office URLs. Uses NEXT_PUBLIC_* (available in browser and middleware).
 */

export function getCanonicalHost(): string {
  return (process.env.NEXT_PUBLIC_CANONICAL_HOST || '').trim().toLowerCase();
}

/**
 * Where the staff back office sign-in lives.
 * Set e.g. https://office.hawana.example/login when the workspace is on a separate origin.
 */
export function getBackOfficeLoginHref(): string {
  const explicit = (process.env.NEXT_PUBLIC_BACKOFFICE_LOGIN_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  return '/login';
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}
