/** Parse comma-separated browser origins from env. */
export function parseOrigins(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Vercel / production Hawana HAMS frontends (e.g. hams-frontend.vercel.app). */
export function isAllowedVercelHamsOrigin(origin) {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'hams.hawanaairways.com') return true;
    if (host.endsWith('.vercel.app')) {
      const slug = host.replace(/\.vercel\.app$/i, '');
      if (/^hams(-[a-z0-9-]+)?$/i.test(slug)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isBrowserOriginAllowed(origin, { configuredOrigins, extraOrigins = [], isProd = false }) {
  if (!origin) return true;
  const devFrontendOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
  if (
    configuredOrigins.includes(origin) ||
    extraOrigins.includes(origin) ||
    devFrontendOrigins.includes(origin) ||
    isAllowedVercelHamsOrigin(origin)
  ) {
    return true;
  }
  if (!isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return true;
  }
  return false;
}

export function allTrustedMutationOrigins() {
  return [
    ...parseOrigins(process.env.FRONTEND_URL),
    ...parseOrigins(process.env.HAMS_EXTRA_CORS_ORIGINS)
  ];
}
