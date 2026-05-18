import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Must match `SESSION_COOKIE_NAME` in `lib/auth-session.ts` (middleware cannot import client helpers). */
const SESSION_COOKIE_NAME = 'hams_token';

const PUBLIC_PREFIXES = ['/login', '/forgot-password', '/reset-password'];

function isPublicPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '') return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function readSessionToken(request: NextRequest): string | null {
  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function safeInternalPath(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  if (next.startsWith('/login')) return null;
  return next;
}

/** Force HTTPS when the deployment forwards `x-forwarded-proto`. */
function httpsRedirect(request: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV !== 'production') return null;
  // Vercel terminates TLS at the edge; avoid redirect churn if a proxy mis-reports proto.
  if (process.env.VERCEL === '1') return null;
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded !== 'http') return null;
  const url = request.nextUrl.clone();
  url.protocol = 'https';
  return NextResponse.redirect(url, 301);
}

/**
 * Never run auth/session logic on static assets.
 * If middleware redirects these to /login, the browser loads HTML instead of CSS/JS → “Tailwind broken”.
 */
function isStaticAssetPath(pathname: string): boolean {
  // Entire Next/Vercel build output trees — never attach auth redirects here or CSS/JS load as HTML.
  if (pathname.startsWith('/_next')) return true;
  if (pathname.startsWith('/_vercel')) return true;
  if (pathname.startsWith('/brand/')) return true;
  if (pathname.startsWith('/favicon.ico')) return true;
  if (pathname === '/robots.txt' || pathname === '/sitemap.xml') return true;
  // `public/` files are served from site root (e.g. /login-aircraft.svg) — must not 302 to /login.
  return /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|mjs|wasm|woff2?|ttf|eot|map|json|webmanifest|txt|xml)$/i.test(
    pathname
  );
}

/** Path B: all `/api/*` and `/health` are proxied to Railway — never auth-redirect (breaks JSON + rewrites). */
function isProxiedApiPath(pathname: string): boolean {
  return pathname === '/health' || pathname.startsWith('/api/');
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isStaticAssetPath(pathname) || isProxiedApiPath(pathname)) {
    return NextResponse.next();
  }

  const https = httpsRedirect(request);
  if (https) return https;

  const { search } = request.nextUrl;
  const token = readSessionToken(request);
  const hasSession = Boolean(token && token.length > 10);

  if (isPublicPath(pathname)) {
    if (pathname === '/login' && hasSession) {
      const dest = safeInternalPath(request.nextUrl.searchParams.get('next')) || '/dashboard';
      const url = request.nextUrl.clone();
      url.pathname = dest;
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.searchParams.set('next', `${pathname}${search || ''}`);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Do not run middleware for:
     * - `/_next`, `/_vercel`, static assets under `/brand/`, robots, sitemap
     * - `/health` and `/api/*` (Path B proxy to Railway — must never 307 to /login)
     */
    '/((?!_next(?:/|$)|_vercel(?:/|$)|favicon\\.ico|brand/|robots\\.txt|sitemap\\.xml|health(?:/|$)|api(?:/|$)).*)'
  ]
};
