/** Production must not use api.hawanaairways.com until DNS + API are live. */
export function isDeadApiHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 'api.hawanaairways.com';
  } catch {
    return false;
  }
}

/** Block direct browser calls to loopback in production builds. */
export function isLocalhostApiUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return /localhost|127\.0\.0\.1/i.test(url);
  }
}

export function sanitizeBackendUrl(url: string | undefined): string {
  const s = typeof url === 'string' ? url.trim().replace(/\/+$/, '') : '';
  if (!s || isDeadApiHost(s)) return '';
  return s;
}
