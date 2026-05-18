import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@/lib/auth-session';

function readTokenFromCookies(): string | null {
  const raw = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function hasLikelyStaffSession(token: string | null): boolean {
  return Boolean(token && token.length > 10);
}

/** Fallback when middleware does not run. Middleware already 302s `/` → login or dashboard. */
export default function HomePage() {
  const token = readTokenFromCookies();
  redirect(hasLikelyStaffSession(token) ? '/dashboard' : '/login');
}
