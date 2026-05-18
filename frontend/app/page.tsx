import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

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

/** Server redirect only — middleware 302s `/` → login or dashboard when it runs. */
export default function HomePage() {
  const token = readTokenFromCookies();
  redirect(hasLikelyStaffSession(token) ? '/dashboard' : '/login');
}
