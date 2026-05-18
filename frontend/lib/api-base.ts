import { isDeadApiHost, sanitizeBackendUrl } from '@/lib/dead-api-host';

/**
 * Public API origin for browser fetches (no trailing slash).
 * Production: Path B proxy — NEXT_PUBLIC_API_URL=/api + HAMS_BACKEND_INTERNAL_URL (Railway).
 */
export function getPublicApiBaseUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? '';
  const useProxy =
    process.env.NEXT_PUBLIC_USE_API_PROXY === 'true' ||
    apiUrl === '/api' ||
    isDeadApiHost(apiUrl);

  if (useProxy) {
    if (typeof window !== 'undefined') return '';
    const internal = sanitizeBackendUrl(process.env.HAMS_BACKEND_INTERNAL_URL);
    if (internal) return internal;
  }

  const s = sanitizeBackendUrl(apiUrl);
  if (s && s !== '/api' && /^https?:\/\//i.test(s)) return s;

  if (process.env.NODE_ENV === 'production') return '';
  return 'http://localhost:5013';
}
