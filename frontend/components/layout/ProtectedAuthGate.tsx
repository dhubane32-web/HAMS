'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  authDebugLog,
  getClientAuthToken,
  hydrateSessionFromCookie,
  persistSessionCookie,
  syncSessionCookieFromStorage
} from '@/lib/auth-session';

const SESSION_CHECK_TIMEOUT_MS = 5000;

/**
 * Ensures workspace routes are not used without a session token (client guard; middleware handles first hop).
 */
export default function ProtectedAuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const grant = () => {
      if (cancelled) return true;
      hydrateSessionFromCookie();
      syncSessionCookieFromStorage();
      const token = getClientAuthToken();
      if (!token || token.length <= 10) return false;
      persistSessionCookie(token);
      setAllowed(true);
      setReady(true);
      return true;
    };

    if (grant()) {
      return () => {
        cancelled = true;
      };
    }

    const deadline = window.setTimeout(() => {
      if (cancelled) return;
      if (grant()) return;
      authDebugLog('ProtectedAuthGate.timeout', { pathname });
      setTimedOut(true);
      const path = pathname || '/dashboard';
      router.replace(`/login?next=${encodeURIComponent(path)}`);
      setAllowed(false);
      setReady(true);
    }, SESSION_CHECK_TIMEOUT_MS);

    const retry = window.setInterval(() => {
      if (grant()) {
        window.clearTimeout(deadline);
        window.clearInterval(retry);
      }
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
      window.clearInterval(retry);
    };
  }, [pathname, router]);

  if (!ready) {
    return (
      <div
        className="hams-auth-loading"
        style={{
          minHeight: '40vh',
          display: 'grid',
          placeItems: 'center',
          color: '#64748b',
          fontSize: '0.9rem'
        }}
      >
        Checking session…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div
        className="hams-auth-loading"
        style={{
          minHeight: '40vh',
          display: 'grid',
          placeItems: 'center',
          color: '#64748b',
          fontSize: '0.9rem',
          padding: '1.5rem',
          textAlign: 'center'
        }}
      >
        {timedOut ? (
          <>
            <p style={{ margin: '0 0 0.5rem', color: '#b45309', fontWeight: 600 }}>Session check timed out</p>
            <p style={{ margin: 0, maxWidth: '22rem' }}>
              No valid sign-in was found after {SESSION_CHECK_TIMEOUT_MS / 1000} seconds. Redirecting to sign in…
            </p>
          </>
        ) : (
          <p style={{ margin: 0 }}>Redirecting to sign in…</p>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
