'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  hydrateSessionFromCookie,
  middlewareCanSeeSession,
  persistSessionCookie,
  syncSessionCookieFromStorage
} from '@/lib/auth-session';

/**
 * Keeps session cookie in sync with localStorage (middleware only reads cookies).
 * If a valid session exists while on /login, send user to dashboard (or ?next=).
 */
export default function AuthCookieSync() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname !== '/login') return;
    hydrateSessionFromCookie();
    syncSessionCookieFromStorage();
    const token = typeof window !== 'undefined' ? localStorage.getItem('hams_token') : null;
    if (!token || token.length <= 10) return;
    if (!middlewareCanSeeSession()) {
      persistSessionCookie(token);
    }
    if (!middlewareCanSeeSession()) return;
    const nextRaw = new URLSearchParams(window.location.search).get('next');
    const dest =
      nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') && !nextRaw.startsWith('/login')
        ? nextRaw
        : '/dashboard';
    router.replace(dest);
  }, [pathname, router]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'hams_token') {
        if (e.newValue) persistSessionCookie(e.newValue);
        else syncSessionCookieFromStorage();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return null;
}
