'use client';

import { useEffect, useState } from 'react';
import SystemAdministrationApp from '@/components/system-admin/SystemAdministrationApp';
import { readSessionUser } from '@/lib/auth-session';
import { canAccessModule } from '@/lib/airline-rbac';

export default function SystemAdministrationPage() {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const user = readSessionUser();
    if (!user) {
      setAllowed(false);
      setReady(true);
      return;
    }
    setAllowed(canAccessModule(user.role, 'admin'));
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <main className="module-page" style={{ padding: '1rem' }}>
        <p style={{ color: '#64748b' }}>Checking access…</p>
      </main>
    );
  }

  if (!allowed) {
    return (
      <main className="module-page">
        <div className="hams-access-denied">
          <h1>Access denied</h1>
          <p>System Administration is restricted to Admin and Super Admin roles.</p>
          <span className="code">RBAC · ADMIN</span>
        </div>
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
