'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { EnterpriseModuleShell } from '@/components/enterprise/EnterpriseModuleShell';
import { ENTERPRISE_MODULES } from '@/lib/enterprise-modules';
import { FlightMovementBoard } from '@/components/dashboard/occ-phase3/FlightMovementBoard';
import type { OccFlightMovement } from '@/components/dashboard/occ-phase3/occ-phase3-types';
import { getPublicApiBaseUrl } from '@/lib/api-base';

const API = getPublicApiBaseUrl();

export default function LiveFlightsPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [movements, setMovements] = useState<OccFlightMovement[]>([]);

  const load = useCallback(async () => {
    const token = localStorage.getItem('hams_token');
    if (!token) return;
    try {
      const dash = await fetch(`${API}/api/dashboard/summary?date=${today}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = await dash.json();
      const occ = d?.executive?.occPhase3 || d?.executive?.occCommandCenter;
      const rows = occ?.flightMovements || [];
      if (rows.length) {
        setMovements(rows);
        return;
      }
      const occDash = await fetch(`${API}/api/operations/occ/dashboard?date=${today}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const od = await occDash.json();
      setMovements(
        (od.flights || []).map(
          (f: {
            id: string;
            flight_number: string;
            departure_airport: string;
            arrival_airport: string;
            departure_time: string;
            status: string;
            gate?: string;
            tail_number?: string;
            live?: { phase: string };
          }) => ({
            id: f.id,
            flightNumber: f.flight_number,
            route: `${f.departure_airport}→${f.arrival_airport}`,
            departureTime: f.departure_time,
            gate: f.gate || '—',
            tail: f.tail_number || '',
            status: f.live?.phase || f.status,
            priority:
              String(f.status).toUpperCase() === 'DELAYED' || String(f.status).toUpperCase() === 'CANCELLED'
                ? 'critical'
                : 'normal'
          })
        )
      );
    } catch {
      setMovements([]);
    }
  }, [today]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 25_000);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <EnterpriseModuleShell
      meta={ENTERPRISE_MODULES['live-flights']}
      dark
      toolbar={
        <button type="button" className="secondary" onClick={() => void load()}>
          Refresh
        </button>
      }
    >
      <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
        MGQ hub network movements · OTP and delay propagation feed executive dashboard and OCC.
      </p>
      <FlightMovementBoard flights={movements} />
      <p style={{ marginTop: '1rem', fontSize: '0.8rem' }}>
        <Link href="/occ" className="text-sky-300 hover:underline">
          OCC control center
        </Link>{' '}
        ·{' '}
        <Link href="/operations" className="text-sky-300 hover:underline">
          Flight operations
        </Link>
      </p>
    </EnterpriseModuleShell>
  );
}
