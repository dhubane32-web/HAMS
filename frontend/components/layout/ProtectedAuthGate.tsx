'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  hydrateSessionFromCookie,
  persistSessionCookie,
  syncSessionCookieFromStorage
} from '@/lib/auth-session';

/**
 * Ensures workspace routes are not used without a session token (client guard; middleware handles first hop).
 */
export default function ProtectedAuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    hydrateSessionFromCookie();
    syncSessionCookieFromStorage();
    const token = typeof window !== 'undefined' ? localStorage.getItem('hams_token') : null;
    if (!token) {
      const path = pathname || '/dashboard';
      const next = encodeURIComponent(path);
      router.replace(`/login?next=${next}`);
      setAllowed(false);
      setReady(true);
      return;
    }
    persistSessionCookie(token);
    setAllowed(true);
    setReady(true);
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
        <p style={{ margin: 0 }}>Redirecting to sign in…</p>
      </div>
    );
  }

  return <>{children}</>;
}
