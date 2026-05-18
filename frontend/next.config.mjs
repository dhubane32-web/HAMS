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
    return [{ source: '/:path*', headers: securityHeaders }];
  }
};

export default nextConfig;
