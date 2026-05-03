import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Must match `SESSION_COOKIE_NAME` in `lib/auth-session.ts` (middleware cannot import client helpers). */
const SESSION_COOKIE_NAME = 'hams_token';

const PUBLIC_PREFIXES = ['/login', '/forgot-password', '/reset-password'];

function isPublicPath(pathname: string): boolean {
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

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = readSessionToken(request);
  const hasSession = Boolean(token && token.length > 10);

  if (pathname === '/' || pathname === '') {
    const url = request.nextUrl.clone();
    url.pathname = hasSession ? '/dashboard' : '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

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
  matcher: ['/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)']
};
