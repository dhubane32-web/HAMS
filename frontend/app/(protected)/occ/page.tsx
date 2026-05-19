'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { EnterpriseModuleShell } from '@/components/enterprise/EnterpriseModuleShell';
import { AlertTicker } from '@/components/enterprise/AlertTicker';
import { FlightStripBoard } from '@/components/enterprise/FlightStripBoard';
import { ENTERPRISE_MODULES } from '@/lib/enterprise-modules';
import { OperationsOccHub } from '../operations/OperationsOccHub';
import { getPublicApiBaseUrl } from '@/lib/api-base';
import '../operations/operations-erp.css';

const API = getPublicApiBaseUrl();

type OccTab = 'board' | 'delays' | 'rotations' | 'dispatch' | 'irops' | 'network';

export default function OccModulePage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [occDate, setOccDate] = useState(today);
  const [tab, setTab] = useState<OccTab>('board');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [strips, setStrips] = useState<
    {
      id: string;
      flight_number: string;
      departure_airport: string;
      arrival_airport: string;
      departure_time: string;
      status: string;
      tail_number?: string | null;
      live?: { phase: string; eta: string | null };
    }[]
  >([]);
  const [pulse, setPulse] = useState<{ conflictCount: number; openAlerts: number; dispatchPending: number } | null>(
    null
  );

  const loadPulse = useCallback(async () => {
    const token = localStorage.getItem('hams_token');
    if (!token) return;
    try {
      const r = await fetch(`${API}/api/operations/occ/dashboard?date=${encodeURIComponent(occDate)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = await r.json();
      if (!r.ok) return;
      setStrips(
        (d.flights || []).map(
          (f: {
            id: string;
            flight_number: string;
            departure_airport: string;
            arrival_airport: string;
            departure_time: string;
            status: string;
            tail_number?: string | null;
            live?: { phase: string; eta: string | null };
          }) => ({
            ...f,
            phase: f.live?.phase
          })
        )
      );
      setPulse(d.enterprise ?? null);
      setLastSync(new Date().toISOString());
    } catch {
      /* keep last good data */
    }
  }, [occDate]);

  useEffect(() => {
    void loadPulse();
  }, [loadPulse]);

  useEffect(() => {
    const t = window.setInterval(() => void loadPulse(), 30_000);
    return () => window.clearInterval(t);
  }, [loadPulse]);

  const tickerAlerts = useMemo(() => {
    const lines: { id: string; text: string }[] = [];
    if (pulse?.openAlerts) lines.push({ id: 'alerts', text: `${pulse.openAlerts} open operational alert(s)` });
    if (pulse?.conflictCount) lines.push({ id: 'conflicts', text: `${pulse.conflictCount} rotation / resource conflict(s)` });
    if (pulse?.dispatchPending) lines.push({ id: 'dispatch', text: `${pulse.dispatchPending} dispatch release(s) pending` });
    const delayed = strips.filter((f) => String(f.status).toUpperCase() === 'DELAYED').length;
    if (delayed) lines.push({ id: 'delayed', text: `${delayed} delayed flight(s) on network` });
    if (!lines.length) lines.push({ id: 'ok', text: 'Network nominal — no critical OCC alerts' });
    return lines;
  }, [pulse, strips]);

  const tabs: { id: OccTab; label: string }[] = [
    { id: 'board', label: 'Live board' },
    { id: 'delays', label: 'Delays' },
    { id: 'rotations', label: 'Rotations' },
    { id: 'dispatch', label: 'Dispatch watch' },
    { id: 'irops', label: 'IROPS' },
    { id: 'network', label: 'Network disruption' }
  ];

  return (
    <EnterpriseModuleShell
      meta={ENTERPRISE_MODULES.occ}
      dark
      liveSyncLabel={lastSync ? `Synced ${new Date(lastSync).toLocaleTimeString()}` : null}
      toolbar={
        <>
          <label style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
            UTC day
            <input type="date" value={occDate} onChange={(e) => setOccDate(e.target.value)} style={{ marginLeft: 6 }} />
          </label>
          <button type="button" className="secondary" onClick={() => void loadPulse()}>
            Refresh
          </button>
          <Link href="/live-flights" className="secondary" style={{ fontSize: '0.85rem' }}>
            Movement board
          </Link>
          <Link href="/dispatch" className="secondary" style={{ fontSize: '0.85rem' }}>
            Dispatch center
          </Link>
        </>
      }
      tabs={tabs.map((t) => ({ ...t, active: tab === t.id, onSelect: () => setTab(t.id) }))}
    >
      <AlertTicker alerts={tickerAlerts} />

      {pulse ? (
        <div className="aep-kpi-row">
          <div className="aep-kpi">
            <strong>{pulse.conflictCount}</strong>
            <span>Conflicts</span>
          </div>
          <div className="aep-kpi">
            <strong>{pulse.openAlerts}</strong>
            <span>Alerts</span>
          </div>
          <div className="aep-kpi">
            <strong>{pulse.dispatchPending}</strong>
            <span>Dispatch pending</span>
          </div>
          <div className="aep-kpi">
            <strong>{strips.length}</strong>
            <span>Flights today</span>
          </div>
        </div>
      ) : null}

      {tab === 'board' && (
        <>
          <FlightStripBoard
            flights={strips.map((f) => ({
              id: f.id,
              flight_number: f.flight_number,
              departure_airport: f.departure_airport,
              arrival_airport: f.arrival_airport,
              departure_time: f.departure_time,
              status: f.status,
              phase: f.live?.phase,
              tail_number: f.tail_number,
              eta: f.live?.eta ?? null
            }))}
          />
          <OperationsOccHub embedded />
        </>
      )}

      {tab !== 'board' && (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>{tabs.find((t) => t.id === tab)?.label}</h2>
          <p style={{ color: '#64748b', fontSize: '0.88rem' }}>
            {tab === 'delays' && 'Delay codes, propagation, and OCC ETA updates are in the live board workspace below.'}
            {tab === 'rotations' && 'Tail rotations and turnaround chains — use Enterprise ops or open Flight Operations.'}
            {tab === 'dispatch' && 'Dispatch monitoring — open the dedicated Flight Dispatch center.'}
            {tab === 'irops' && 'IROPS cases are managed per-flight in the OCC workspace (IROPS tab on selected flight).'}
            {tab === 'network' && 'Network disruption tracking ties into operational alerts and executive dashboard.'}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Link href="/operations?tab=enterprise" className="secondary">
              Enterprise flight ops
            </Link>
            <Link href="/dispatch" className="secondary">
              Flight dispatch
            </Link>
            <button type="button" onClick={() => setTab('board')}>
              Return to live board
            </button>
          </div>
        </section>
      )}
    </EnterpriseModuleShell>
  );
}
