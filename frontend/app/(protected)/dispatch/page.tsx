'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { EnterpriseModuleShell } from '@/components/enterprise/EnterpriseModuleShell';
import { ENTERPRISE_MODULES } from '@/lib/enterprise-modules';
import { fetchEnterpriseFeed, type EnterpriseFlight } from '@/lib/flight-ops-enterprise';
import { DispatchPanel } from '../operations/enterprise/DispatchPanel';
import '../operations/operations-erp.css';

export default function DispatchModulePage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [opsDate, setOpsDate] = useState(today);
  const [flights, setFlights] = useState<EnterpriseFlight[]>([]);
  const [selectedId, setSelectedId] = useState('');

  const load = useCallback(async () => {
    try {
      const feed = await fetchEnterpriseFeed(opsDate);
      setFlights(feed.flights || []);
      setSelectedId((prev) => prev || feed.flights[0]?.id || '');
    } catch {
      setFlights([]);
    }
  }, [opsDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = flights.find((f) => f.id === selectedId);

  return (
    <EnterpriseModuleShell
      meta={ENTERPRISE_MODULES.dispatch}
      dark
      toolbar={
        <>
          <label style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
            Ops day
            <input type="date" value={opsDate} onChange={(e) => setOpsDate(e.target.value)} style={{ marginLeft: 6 }} />
          </label>
          <button type="button" className="secondary" onClick={() => void load()}>
            Refresh
          </button>
        </>
      }
    >
      <section className="module-card">
        <h2 style={{ marginTop: 0 }}>Dispatch queue</h2>
        <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
          Operational flight plan (OFP), fuel, weather/NOTAM notes, payload, loadsheet, and release PDFs — powered by
          existing enterprise dispatch APIs.
        </p>
        <div className="ops-enterprise-flight-picker" style={{ marginBottom: '1rem' }}>
          <label>
            Flight
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {flights.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.flight_number} {f.departure_airport}→{f.arrival_airport}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <span className="ops-enterprise-flight-meta">
              {selected.status} · {new Date(selected.departure_time).toLocaleString()}
            </span>
          ) : null}
        </div>
        {selectedId ? <DispatchPanel flightId={selectedId} /> : <p>Select a flight to manage dispatch release.</p>}
        <p style={{ marginTop: '1rem', fontSize: '0.8rem' }}>
          <Link href="/operations?tab=enterprise">Full enterprise ops</Link> ·{' '}
          <Link href="/occ">OCC control center</Link>
        </p>
      </section>
    </EnterpriseModuleShell>
  );
}
