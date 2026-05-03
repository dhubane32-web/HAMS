/** Public API origin for browser fetches. Trims and strips trailing slash. */
export function getPublicApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s) return s.replace(/\/+$/, '');
  return 'http://localhost:5013';
}
