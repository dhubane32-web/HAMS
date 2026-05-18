/** Production must not use api.hawanaairways.com until DNS + API are live. */
export function isDeadApiHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 'api.hawanaairways.com';
  } catch {
    return false;
  }
}

export function sanitizeBackendUrl(url: string | undefined): string {
  const s = typeof url === 'string' ? url.trim().replace(/\/+$/, '') : '';
  if (!s || isDeadApiHost(s)) return '';
  return s;
}
