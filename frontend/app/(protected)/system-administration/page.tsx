'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import SystemAdministrationApp from '@/components/system-admin/SystemAdministrationApp';
import type { UserRole } from '@/lib/roles';

export default function SystemAdministrationPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('hams_user');
      const role = raw ? ((JSON.parse(raw) as { role?: UserRole }).role ?? null) : null;
      if (role !== 'admin' && role !== 'super_admin') {
        router.replace('/dashboard');
        return;
      }
    } catch {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <main className="module-page" style={{ padding: '1rem' }}>
        <p style={{ color: '#64748b' }}>Checking access…</p>
      </main>
    );
  }

  return (
    <main className="module-page" style={{ padding: '1rem', maxWidth: 1280, margin: '0 auto' }}>
      <header className="module-card" style={{ marginBottom: '0.75rem' }}>
        <h1 style={{ margin: 0 }}>System administration</h1>
        <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
          Users, audit trail, login history, and platform settings. <strong>Super Admin</strong> manages roles and
          security; <strong>Admin</strong> manages day‑to‑day accounts. All sensitive actions are written to audit logs
          on the server.
        </p>
      </header>
      <SystemAdministrationApp />
    </main>
  );
}
