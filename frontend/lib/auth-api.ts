import { getPublicApiBaseUrl } from '@/lib/api-base';
import { getClientAuthToken } from '@/lib/auth-session';

/** Browser fetches to HAMS API with session cookies (httpOnly mode). */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getPublicApiBaseUrl();
  const headers = new Headers(init.headers);
  const token = getClientAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(`${base}${path}`, { ...init, headers, credentials: 'include' });
}

export async function notifyServerLogout(): Promise<void> {
  const token = getClientAuthToken();
  if (!token) return;
  try {
    await authFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    /* offline — still clear client */
  }
}
