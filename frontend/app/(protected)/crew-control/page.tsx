'use client';

import Link from 'next/link';
import { EnterpriseModuleShell } from '@/components/enterprise/EnterpriseModuleShell';
import { ENTERPRISE_MODULES } from '@/lib/enterprise-modules';

export default function CrewControlPage() {
  return (
    <EnterpriseModuleShell meta={ENTERPRISE_MODULES['crew-control']} dark>
      <section className="module-card">
        <h2 style={{ marginTop: 0 }}>Crew control center</h2>
        <p style={{ color: '#64748b', fontSize: '0.88rem' }}>
          Real-time crew operations: FDTL duty timers, legality checks, assignments, standby, disruptions, and training /
          medical validity — integrated with OCC crew-legality APIs and the crew roster module.
        </p>
        <ul style={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
          <li>
            <strong>Legality engine</strong> — per-flight checks via OCC (<code>/api/operations/occ/flights/:id/crew-legality</code>
            )
          </li>
          <li>
            <strong>Roster & HR</strong> — qualifications, documents, and long-term roster in{' '}
            <Link href="/crew">Crew Management</Link>
          </li>
          <li>
            <strong>Disruptions</strong> — tie into IROPS and operational alerts from OCC
          </li>
        </ul>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
          <Link href="/crew" className="secondary">
            Open crew management
          </Link>
          <Link href="/occ" className="secondary">
            OCC hub (crew legality tab)
          </Link>
          <Link href="/operations?tab=control" className="secondary">
            Flight control assignments
          </Link>
        </div>
      </section>
    </EnterpriseModuleShell>
  );
}
