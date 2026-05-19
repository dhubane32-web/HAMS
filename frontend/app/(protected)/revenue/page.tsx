'use client';

import Link from 'next/link';
import { EnterpriseModuleShell } from '@/components/enterprise/EnterpriseModuleShell';
import { ENTERPRISE_MODULES } from '@/lib/enterprise-modules';

export default function RevenueManagementPage() {
  return (
    <EnterpriseModuleShell meta={ENTERPRISE_MODULES.revenue}>
      <section className="module-card">
        <h2 style={{ marginTop: 0 }}>Revenue management</h2>
        <p style={{ color: '#64748b', fontSize: '0.88rem' }}>
          Fare buckets, yield, seat inventory (<code>sm_seat_leg_allocation</code>), load factor, route profitability, and
          channel performance — built on the commercial platform already in HAMS.
        </p>
        <div className="aep-kpi-row">
          <div className="aep-kpi">
            <strong>RM</strong>
            <span>Buckets & LF</span>
          </div>
          <div className="aep-kpi">
            <strong>Yield</strong>
            <span>Route P&amp;L</span>
          </div>
          <div className="aep-kpi">
            <strong>Channels</strong>
            <span>Agent / direct</span>
          </div>
        </div>
        <p style={{ fontSize: '0.85rem' }}>
          Use <Link href="/sales">Commercial &amp; Revenue</Link> for live RM workspace, promo codes, and agent
          performance. Network load factor feeds from OCC seat inventory sync.
        </p>
        <Link href="/sales" className="secondary">
          Open commercial workspace →
        </Link>
      </section>
    </EnterpriseModuleShell>
  );
}
