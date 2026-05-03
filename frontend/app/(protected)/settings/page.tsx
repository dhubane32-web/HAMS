'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MasterDataAdmin from '@/components/master-data/MasterDataAdmin';
import type { UserRole } from '@/lib/roles';

/** Settings & master data — same module as `/settings-master-data` (legacy URL). */
export default function SettingsAndMasterDataPage() {
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
    <main className="module-page" style={{ padding: '1rem', maxWidth: 1200, margin: '0 auto' }}>
      <header className="module-card" style={{ marginBottom: '0.75rem' }}>
        <h1 style={{ margin: 0 }}>Settings &amp; master data</h1>
        <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
          Airports, routes, fleet, fares, taxes, fees, baggage rules, and system defaults. Only administrators can change
          these records (API enforces <code>admin</code> on writes).
        </p>
      </header>
      <MasterDataAdmin />
    </main>
  );
}
