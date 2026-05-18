const isProd = process.env.NODE_ENV === 'production';

const canonicalHost = (process.env.NEXT_PUBLIC_CANONICAL_HOST || '').trim().toLowerCase();

const redirects = [];
if (canonicalHost) {
  redirects.push({
    source: '/:path*',
    has: [{ type: 'host', value: `www.${canonicalHost}` }],
    destination: `https://${canonicalHost}/:path*`,
    permanent: true
  });
}

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
];

/** Prevent browsers/CDN from serving stale HTML for authenticated app routes (sidebar labels). */
const appShellCacheHeaders = [
  { key: 'Cache-Control', value: 'private, no-cache, no-store, max-age=0, must-revalidate' },
  { key: 'Pragma', value: 'no-cache' },
  { key: 'CDN-Cache-Control', value: 'no-store' },
  { key: 'Vercel-CDN-Cache-Control', value: 'no-store' }
];

const APP_SHELL_PATHS = [
  '/dashboard',
  '/booking',
  '/bookings',
  '/checkin',
  '/operations',
  '/flights',
  '/maintenance',
  '/crew',
  '/finance',
  '/sales',
  '/customers',
  '/reports',
  '/settings',
  '/admin',
  '/notifications',
  '/workspace-settings',
  '/system-settings',
  '/system-administration',
  '/add-expense',
  '/customer-service',
  '/sales-marketing',
  '/settings-master-data',
  '/reports-analytics',
  '/crew-management'
];

if (isProd) {
  securityHeaders.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' });
  // Intentionally no global Content-Security-Policy here: a single CSP on `/:path*`
  // also applies to `/_next/static/*` responses and has caused real browsers to skip
  // stylesheets/scripts (unstyled Tailwind + “collapsed” shell on Vercel). Re-introduce
  // CSP via nonces + route-scoped headers or Edge middleware once audited for Next.js 14.
}

/** Backend URL for Vercel rewrites (server-only). Set when api.hawanaairways.com is not live yet. */
function backendProxyTarget() {
  const raw = process.env.HAMS_BACKEND_INTERNAL_URL || process.env.HAMS_API_PROXY_TARGET;
  return typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const target = backendProxyTarget();
    if (!target) return [];
    return [
      { source: '/health', destination: `${target}/health` },
      { source: '/api/:path*', destination: `${target}/api/:path*` }
    ];
  },
  async redirects() {
    return redirects;
  },
  ...(isProd
    ? {
        compiler: {
          removeConsole: { exclude: ['error', 'warn'] }
        }
      }
    : {}),
  async headers() {
    const appShellRoutes = APP_SHELL_PATHS.map((p) => ({
      source: `${p}`,
      headers: [...securityHeaders, ...appShellCacheHeaders]
    }));
    const appShellNested = APP_SHELL_PATHS.map((p) => ({
      source: `${p}/:path*`,
      headers: [...securityHeaders, ...appShellCacheHeaders]
    }));
    return [
      { source: '/build-id.txt', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
      ...appShellRoutes,
      ...appShellNested,
      { source: '/:path*', headers: securityHeaders }
    ];
  }
};

export default nextConfig;
