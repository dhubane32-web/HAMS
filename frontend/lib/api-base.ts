/**
 * Public API origin for browser fetches (no trailing slash).
 * Production options:
 * 1) NEXT_PUBLIC_API_URL=https://api.hawanaairways.com (direct; API must resolve in DNS)
 * 2) NEXT_PUBLIC_USE_API_PROXY=true + HAMS_BACKEND_INTERNAL_URL on Vercel (same-origin /api via Next rewrite)
 */
export function getPublicApiBaseUrl(): string {
  const useProxy =
    process.env.NEXT_PUBLIC_USE_API_PROXY === 'true' ||
    process.env.NEXT_PUBLIC_API_URL === '/api';

  if (useProxy) {
    // Browser: same origin → Vercel rewrites /api/* to HAMS_BACKEND_INTERNAL_URL
    if (typeof window !== 'undefined') return '';
    // SSR (rare for auth): use server-only backend URL if set
    const internal = process.env.HAMS_BACKEND_INTERNAL_URL?.trim();
    if (internal) return internal.replace(/\/+$/, '');
  }

  const raw = process.env.NEXT_PUBLIC_API_URL;
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s && s !== '/api') return s.replace(/\/+$/, '');

  // Path B on Vercel without NEXT_PUBLIC_* set at build → same-origin /api (requires rewrites + env in dashboard).
  if (process.env.NODE_ENV === 'production' && typeof window !== 'undefined') {
    return '';
  }
  if (process.env.NODE_ENV === 'production') {
    return 'https://api.hawanaairways.com';
  }
  return 'http://localhost:5013';
}
