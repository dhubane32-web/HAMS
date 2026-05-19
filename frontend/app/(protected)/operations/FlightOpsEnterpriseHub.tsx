'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiFetchJson } from '@/lib/api-client';
import {
  fetchEnterpriseFeed,
  recordEnterpriseDelay,
  scanConflictAlerts,
  type EnterpriseFeed,
  type EnterpriseFlight
} from '@/lib/flight-ops-enterprise';
import { LiveOccPanel } from './enterprise/LiveOccPanel';
import { SchedulingPanel } from './enterprise/SchedulingPanel';
import { RotationsPanel } from './enterprise/RotationsPanel';
import { AssignmentPanel } from './enterprise/AssignmentPanel';
import { DispatchPanel } from './enterprise/DispatchPanel';
import { TurnaroundPanel } from './enterprise/TurnaroundPanel';

type EnterpriseTab =
  | 'live'
  | 'scheduling'
  | 'rotations'
  | 'assignments'
  | 'dispatch'
  | 'slots'
  | 'turnaround'
  | 'delays';

export function FlightOpsEnterpriseHub() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [opsDate, setOpsDate] = useState(today);
  const [panel, setPanel] = useState<EnterpriseTab>('live');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [schemaHint, setSchemaHint] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [feed, setFeed] = useState<EnterpriseFeed | null>(null);
  const [selectedFlightId, setSelectedFlightId] = useState('');
  const [delayMin, setDelayMin] = useState('15');
  const [delayReason, setDelayReason] = useState('');

  const [slotKind, setSlotKind] = useState<'DEP' | 'ARR'>('DEP');
  const [slotAirport, setSlotAirport] = useState('');
  const [slotTime, setSlotTime] = useState('');
  const [slots, setSlots] = useState<
    { id: string; slot_kind: string; airport: string; slot_time: string; slot_status: string }[]
  >([]);

  const flights = (feed?.flights || []) as EnterpriseFlight[];
  const selectedFlight = flights.find((f) => f.id === selectedFlightId);

  const loadFeed = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setLoadError(null);
      setSchemaHint(null);
      try {
        const data = await fetchEnterpriseFeed(opsDate);
        setFeed(data);
        setLastSync(data.serverTime);
        setSelectedFlightId((prev) => prev || data.flights[0]?.id || '');
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Operational feed failed';
        setLoadError(msg);
        if (msg.includes('503') || msg.includes('schema')) {
          setSchemaHint('Apply database/migrations/005_flight_ops_enterprise.sql on PostgreSQL (Railway).');
        } else if (!quiet) toast.error(msg);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [opsDate]
  );

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    const t = window.setInterval(() => void loadFeed(true), 20_000);
    return () => window.clearInterval(t);
  }, [loadFeed]);

  useEffect(() => {
    if (panel !== 'slots' || !selectedFlightId) return;
    void apiFetchJson<{ slots: typeof slots }>(
      `/api/operations/enterprise/slots?flightId=${encodeURIComponent(selectedFlightId)}`
    )
      .then((d) => setSlots(d.slots || []))
      .catch(() => setSlots([]));
  }, [panel, selectedFlightId]);

  async function generateFlights() {
    try {
      const res = await apiFetchJson<{ createdCount: number }>('/api/operations/enterprise/schedules/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opsDate })
      });
      toast.success(`Generated ${res.createdCount} flight(s).`);
      await loadFeed(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Generate failed');
    }
  }

  async function runConflictScan() {
    try {
      const r = await scanConflictAlerts(opsDate);
      toast.success(`Scanned ${r.scanned}, created ${r.alertsCreated} alerts.`);
      await loadFeed(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Scan failed');
    }
  }

  const tabs: { id: EnterpriseTab; label: string }[] = [
    { id: 'live', label: 'Live OCC' },
    { id: 'scheduling', label: 'Scheduling' },
    { id: 'rotations', label: 'Rotations' },
    { id: 'assignments', label: 'Assignments' },
    { id: 'dispatch', label: 'Dispatch' },
    { id: 'turnaround', label: 'Turnaround' },
    { id: 'delays', label: 'Delays' },
    { id: 'slots', label: 'Slots' }
  ];

  return (
    <section className="module-card ops-enterprise">
      <div className="ops-enterprise-head">
        <h2>Enterprise flight operations</h2>
        <p>PostgreSQL-backed OCC: scheduling, rotations, dispatch releases, turnaround, slots — live feed every 20s.</p>
        <div className="ops-enterprise-toolbar">
          <label>
            Ops day (UTC)
            <input type="date" value={opsDate} onChange={(e) => setOpsDate(e.target.value)} />
          </label>
          <button type="button" className="secondary" disabled={loading} onClick={() => void loadFeed()}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" className="secondary" onClick={() => void generateFlights()}>
            Generate flights
          </button>
          <button type="button" className="secondary" onClick={() => void runConflictScan()}>
            Scan conflicts
          </button>
          {lastSync && <span className="ops-muted" style={{ fontSize: '0.75rem' }}>Synced {new Date(lastSync).toLocaleTimeString()}</span>}
        </div>
      </div>

      {schemaHint && <p className="ops-enterprise-schema-hint">{schemaHint}</p>}
      {loadError && !schemaHint && (
        <p className="ops-enterprise-schema-hint" role="alert">
          {loadError}{' '}
          <button type="button" className="secondary" onClick={() => void loadFeed()}>
            Retry
          </button>
        </p>
      )}

      <div className="ops-enterprise-tabs" role="tablist">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={panel === id}
            className={panel === id ? '' : 'secondary'}
            onClick={() => setPanel(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ops-enterprise-flight-picker">
        <label>
          Focus flight
          <select value={selectedFlightId} onChange={(e) => setSelectedFlightId(e.target.value)}>
            <option value="">— select —</option>
            {flights.map((f) => (
              <option key={f.id} value={f.id}>
                {f.flight_number} {f.departure_airport}→{f.arrival_airport}
              </option>
            ))}
          </select>
        </label>
        {selectedFlight && (
          <span className="ops-enterprise-flight-meta">
            {selectedFlight.tail_number || 'No tail'} · {selectedFlight.status}
          </span>
        )}
      </div>

      {panel === 'live' && (
        <LiveOccPanel
          flights={flights}
          alerts={feed?.alerts || []}
          conflicts={feed?.conflicts || []}
          dispatchQueue={feed?.dispatchQueue || []}
          activeSchedules={feed?.activeSchedules || 0}
          selectedFlightId={selectedFlightId}
          onSelectFlight={setSelectedFlightId}
          onRefresh={() => void loadFeed(true)}
          loading={loading}
        />
      )}

      {panel === 'scheduling' && (
        <SchedulingPanel
          opsDate={opsDate}
          flights={flights}
          selectedFlightId={selectedFlightId}
          onSelectFlight={setSelectedFlightId}
          onRefresh={() => void loadFeed(true)}
        />
      )}

      {panel === 'rotations' && (
        <RotationsPanel
          opsDate={opsDate}
          rotations={feed?.rotations || []}
          utilization={feed?.utilization || []}
          onRebuilt={() => void loadFeed(true)}
        />
      )}

      {panel === 'assignments' && (
        <AssignmentPanel selectedFlightId={selectedFlightId} onAssigned={() => void loadFeed(true)} />
      )}

      {panel === 'dispatch' && <DispatchPanel flightId={selectedFlightId} />}

      {panel === 'turnaround' && (
        <TurnaroundPanel flightId={selectedFlightId} stationCode={selectedFlight?.departure_airport} />
      )}

      {panel === 'delays' && (
        <div className="ops-enterprise-delays">
          <p className="ops-muted">Records delay, updates status, audit log, and operational alert.</p>
          <div className="ops-enterprise-form-grid">
            <label>
              Minutes
              <input type="number" min={1} value={delayMin} onChange={(e) => setDelayMin(e.target.value)} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Reason
              <input value={delayReason} onChange={(e) => setDelayReason(e.target.value)} />
            </label>
          </div>
          <button
            type="button"
            disabled={!selectedFlightId || delayReason.trim().length < 3}
            onClick={async () => {
              try {
                await recordEnterpriseDelay(selectedFlightId, Number(delayMin), delayReason.trim());
                toast.success('Delay recorded.');
                setDelayReason('');
                await loadFeed(true);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Delay failed');
              }
            }}
          >
            Record delay
          </button>
        </div>
      )}

      {panel === 'slots' && (
        <div className="ops-enterprise-slots">
          <form
            className="ops-enterprise-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!selectedFlightId) return;
              try {
                await apiFetchJson('/api/operations/enterprise/slots', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    flightId: selectedFlightId,
                    airport: slotAirport || selectedFlight?.departure_airport,
                    slotKind,
                    slotTime: slotTime ? new Date(slotTime).toISOString() : new Date().toISOString(),
                    slotStatus: 'REQUESTED'
                  })
                });
                toast.success('Slot saved.');
                const d = await apiFetchJson<{ slots: typeof slots }>(
                  `/api/operations/enterprise/slots?flightId=${encodeURIComponent(selectedFlightId)}`
                );
                setSlots(d.slots || []);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Slot failed');
              }
            }}
          >
            <div className="ops-enterprise-form-grid">
              <label>
                Kind
                <select value={slotKind} onChange={(e) => setSlotKind(e.target.value as 'DEP' | 'ARR')}>
                  <option value="DEP">Departure</option>
                  <option value="ARR">Arrival</option>
                </select>
              </label>
              <label>
                Airport
                <input value={slotAirport} onChange={(e) => setSlotAirport(e.target.value.toUpperCase())} />
              </label>
              <label>
                Time
                <input type="datetime-local" value={slotTime} onChange={(e) => setSlotTime(e.target.value)} />
              </label>
            </div>
            <button type="submit" disabled={!selectedFlightId}>
              Add slot
            </button>
          </form>
          <ul className="ops-slot-list">
            {slots.map((s) => (
              <li key={s.id}>
                {s.slot_kind} {s.airport} — {s.slot_status}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
