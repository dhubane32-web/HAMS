import type { UserRole } from '@/lib/roles';
import { roleLabels } from '@/lib/roles';

/** Cookie name mirrors localStorage key so middleware can see the same JWT. */
export const SESSION_COOKIE_NAME = 'hams_token';

/** Profile used by the shell and nav; aligned with login `user` payload + JWT claims. */
export type SessionUser = { name: string; email: string; role: UserRole };

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && value in roleLabels;
}

/**
 * Resolves the signed-in user for client UI (sidebar, header).
 * Ensures cookie-only sessions still get role/name: `hydrateSessionFromCookie` may restore `hams_token`
 * without `hams_user`; we then read `role`/`name`/`email` from the JWT (same claims the backend issues).
 * Backfills `hams_user` when it was missing or had no role so other pages stay consistent.
 */
export function readSessionUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  hydrateSessionFromCookie();

  let fromStorage: Partial<SessionUser> | null = null;
  const raw = localStorage.getItem('hams_user');
  if (raw) {
    try {
      fromStorage = JSON.parse(raw) as Partial<SessionUser>;
    } catch {
      fromStorage = null;
    }
  }

  const token = localStorage.getItem('hams_token');
  let fromJwt: Partial<SessionUser> | null = null;
  if (token) {
    const p = decodeJwtPayload(token);
    if (p) {
      const role = isUserRole(p.role) ? p.role : null;
      if (role) {
        fromJwt = {
          name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'User',
          email: typeof p.email === 'string' ? p.email : '',
          role
        };
      }
    }
  }

  const roleFromStorage = fromStorage?.role && isUserRole(fromStorage.role) ? fromStorage.role : null;
  const role = roleFromStorage ?? fromJwt?.role ?? null;
  if (!role) return null;

  const name =
    (fromStorage?.name && String(fromStorage.name).trim()) ||
    (fromJwt?.name && String(fromJwt.name).trim()) ||
    'User';
  const email =
    (fromStorage?.email != null && String(fromStorage.email)) ||
    (fromJwt?.email != null && String(fromJwt.email)) ||
    '';

  const user: SessionUser = { name, email, role };

  if (token && fromJwt && (!raw || !roleFromStorage)) {
    try {
      localStorage.setItem('hams_user', JSON.stringify(user));
    } catch {
      // ignore
    }
  }

  return user;
}

const DEFAULT_MAX_AGE_SEC = 60 * 60 * 8;

function secureCookieSuffix(): string {
  if (typeof window === 'undefined') return '';
  return window.location.protocol === 'https:' ? '; Secure' : '';
}

/** Lax allows post-login navigation; Secure when on HTTPS (required for SameSite=None). */
function sameSitePolicy(): 'Lax' | 'None' {
  return 'Lax';
}

/** Persist JWT for middleware + API calls (localStorage is set by callers). */
export function persistSessionCookie(token: string, maxAgeSec?: number): void {
  if (typeof document === 'undefined') return;
  const age = Math.min(60 * 60 * 24 * 7, Math.max(120, maxAgeSec ?? DEFAULT_MAX_AGE_SEC));
  const ss = sameSitePolicy();
  document.cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${age}; SameSite=${ss}${secureCookieSuffix()}`;
}

/** Write token + optional profile; sync cookie so Edge middleware can authorize. */
export function setClientSession(
  token: string,
  user?: SessionUser & { id?: string },
  maxAgeSec?: number
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('hams_token', token);
    if (user) {
      localStorage.setItem(
        'hams_user',
        JSON.stringify({ name: user.name, email: user.email, role: user.role })
      );
    }
  } catch {
    // ignore
  }
  persistSessionCookie(token, maxAgeSec);
}

export function hasClientSession(): boolean {
  if (typeof window === 'undefined') return false;
  hydrateSessionFromCookie();
  syncSessionCookieFromStorage();
  const token = getClientAuthToken() ?? readSessionTokenFromCookie();
  return Boolean(token && token.length > 10);
}

/** True when `document.cookie` has a token Edge middleware can read (avoids login↔dashboard loops). */
export function middlewareCanSeeSession(): boolean {
  const t = readSessionTokenFromCookie();
  return Boolean(t && t.length > 10);
}

export function clearSessionCookie(): void {
  if (typeof document === 'undefined') return;
  const ss = sameSitePolicy();
  document.cookie = `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=${ss}${secureCookieSuffix()}`;
}

export function clearClientSession(): void {
  clearSessionCookie();
  try {
    localStorage.removeItem('hams_token');
    localStorage.removeItem('hams_user');
    localStorage.removeItem('hawana_saved_login');
  } catch {
    // ignore
  }
}

/** If user has a token in localStorage but no cookie (legacy), sync for middleware. */
export function syncSessionCookieFromStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const t = localStorage.getItem('hams_token');
    if (t) persistSessionCookie(t);
  } catch {
    // ignore
  }
}

/** Read JWT from document cookie (middleware path). */
export function readSessionTokenFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const raw = part.slice(idx + 1).trim();
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/**
 * If middleware allowed navigation (cookie) but localStorage is empty, copy token into localStorage
 * so client guards and fetch() Authorization stay aligned — avoids blank screen / redirect loops.
 */
export function hydrateSessionFromCookie(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (localStorage.getItem('hams_token')) return true;
    const t = readSessionTokenFromCookie();
    if (t && t.length > 10) {
      localStorage.setItem('hams_token', t);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * JWT for `Authorization: Bearer …` on API calls. Mirrors `localStorage.getItem('hams_token')` after
 * {@link hydrateSessionFromCookie} so cookie-only sessions (middleware) still send a valid token.
 */
export function getClientAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  hydrateSessionFromCookie();
  return localStorage.getItem('hams_token');
}
