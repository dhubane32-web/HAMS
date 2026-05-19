'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { getPublicApiBaseUrl } from '@/lib/api-base';
import './operations-erp.css';

const API_BASE_URL = getPublicApiBaseUrl();

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('hams_token') : null;
}

function formatCountdown(targetIso: string) {
  const ms = new Date(targetIso).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatElapsed(sinceIso: string) {
  const ms = Date.now() - new Date(sinceIso).getTime();
  if (ms < 0) return '—';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function isDelayedFlight(f: DashboardFlight) {
  const s = (f.live?.status || f.status || '').toUpperCase();
  return s === 'DELAYED';
}

type OccLive = {
  phase: string;
  status: string;
  eta: string | null;
  departedAt: string | null;
  airborneAt: string | null;
  landedAt: string | null;
};

type DashboardFlight = {
  id: string;
  flight_number: string;
  departure_airport: string;
  arrival_airport: string;
  departure_time: string;
  arrival_time: string;
  status: string;
  gate?: string | null;
  tail_number?: string | null;
  live: OccLive;
};

type OccEvent = {
  id: string;
  event_type: string;
  source_system: string;
  payload_json: unknown;
  created_at: string;
  created_by: string | null;
};

export function OperationsOccHub({ embedded = false }: { embedded?: boolean } = {}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [occDate, setOccDate] = useState(today);
  const [dashboardFlights, setDashboardFlights] = useState<DashboardFlight[]>([]);
  const [dashLoading, setDashLoading] = useState(false);
  const [selectedFlightId, setSelectedFlightId] = useState('');
  const [detailTab, setDetailTab] = useState<
    'live' | 'rotation' | 'fuel' | 'load' | 'irops' | 'slots' | 'station' | 'timeline' | 'crew'
  >('live');

  const [delayCodes, setDelayCodes] = useState<{ code: string; label: string; default_cost_usd: number }[]>([]);
  const [dutyLimits, setDutyLimits] = useState<Record<string, unknown> | null>(null);
  const [dutyLimitsError, setDutyLimitsError] = useState<string | null>(null);
  const [dashError, setDashError] = useState<string | null>(null);
  const [schemaNote, setSchemaNote] = useState<string | null>(null);
  const [lastBoardSync, setLastBoardSync] = useState<string | null>(null);
  const [occDark, setOccDark] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [liveRow, setLiveRow] = useState<{ flight: Record<string, unknown>; live: OccLive } | null>(null);
  const [rotation, setRotation] = useState<{ id: string; flight_number: string; departure_airport: string; arrival_airport: string; departure_time: string; status: string }[]>([]);
  const [timeline, setTimeline] = useState<OccEvent[]>([]);
  const [fuel, setFuel] = useState<{ plan: Record<string, unknown> | null; uplifts: unknown[] }>({ plan: null, uplifts: [] });
  const [loadsheets, setLoadsheets] = useState<unknown[]>([]);
  const [iropsCases, setIropsCases] = useState<{ id: string; category: string; status: string; title: string; created_at: string }[]>([]);
  const [slots, setSlots] = useState<unknown[]>([]);
  const [crewLegality, setCrewLegality] = useState<{ crewUserId: string; fullName: string; dutyRole: string; assignable: boolean; message: string | null }[]>([]);
  const [station, setStation] = useState<Record<string, unknown> | null>(null);
  const [stationAirport, setStationAirport] = useState('');

  const [etaLocal, setEtaLocal] = useState('');
  const [iropsTitle, setIropsTitle] = useState('');
  const [iropsCat, setIropsCat] = useState('OTHER');
  const [slotKind, setSlotKind] = useState<'DEP' | 'ARR'>('DEP');
  const [slotTime, setSlotTime] = useState('');
  const [rampStatus, setRampStatus] = useState('NORMAL');
  const [stationNotes, setStationNotes] = useState('');

  const fetchJson = useCallback(async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
    const token = getToken();
    if (!token) throw new Error('Please login first from /login.');
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });
    const text = await response.text();
    let body: { message?: string } & Partial<T> = {};
    if (text) {
      try {
        body = JSON.parse(text) as { message?: string } & T;
      } catch {
        body = {};
      }
    }
    if (!response.ok) {
      const detail = (body as { error?: string }).error;
      const msg = body.message || 'Request failed.';
      throw new Error(detail ? `${msg} (${detail})` : msg);
    }
    return body as T;
  }, []);

  const [enterprisePulse, setEnterprisePulse] = useState<{
    conflictCount: number;
    openAlerts: number;
    dispatchPending: number;
  } | null>(null);

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    setDashError(null);
    try {
      const d = await fetchJson<{
        flights: DashboardFlight[];
        enterprise?: { conflictCount: number; openAlerts: number; dispatchPending: number } | null;
        schemaMode?: string;
        etaNote?: string | null;
      }>(`/api/operations/occ/dashboard?date=${encodeURIComponent(occDate)}`);
      setDashboardFlights(d.flights || []);
      setEnterprisePulse(d.enterprise ?? null);
      setSchemaNote(d.etaNote || (d.schemaMode === 'compat' ? 'ETA from scheduled arrival until tracking columns are migrated.' : null));
      setLastBoardSync(new Date().toISOString());
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Dashboard failed';
      setDashError(msg);
      toast.error(msg);
      setDashboardFlights([]);
    } finally {
      setDashLoading(false);
    }
  }, [fetchJson, occDate]);

  const loadRefs = useCallback(async () => {
    setDutyLimitsError(null);
    try {
      const dc = await fetchJson<{ delayCodes: { code: string; label: string; default_cost_usd: number }[] }>(
        '/api/operations/occ/delay-codes'
      );
      setDelayCodes(dc.delayCodes || []);
    } catch {
      setDelayCodes([]);
    }
    try {
      const dl = await fetchJson<{ limits: Record<string, unknown> | null }>('/api/operations/occ/duty-limits');
      setDutyLimits(dl.limits);
      if (dl.limits) {
        setDutyLimitsError(null);
      } else {
        setDutyLimitsError(
          'Duty display limits are not in the database. Apply occ_control_center_v2.sql (includes occ_duty_limit_config) or run backend/scripts/apply-occ-migrations.sh.'
        );
      }
    } catch (e) {
      setDutyLimits(null);
      setDutyLimitsError(e instanceof Error ? e.message : 'Could not load duty limits.');
    }
  }, [fetchJson]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('hams_occ_dark');
    if (saved === '1') setOccDark(true);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('hams_occ_dark', occDark ? '1' : '0');
  }, [occDark]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = window.setInterval(() => void loadDashboard(), 30_000);
    return () => window.clearInterval(t);
  }, [autoRefresh, loadDashboard]);

  const loadFlightDetail = useCallback(
    async (fid: string) => {
      if (!fid) return;
      try {
        const [lv, rot, tl, fu, ls, ir, sl, cl] = await Promise.all([
          fetchJson<{ flight: Record<string, unknown>; live: OccLive }>(`/api/operations/occ/flights/${fid}/live`),
          fetchJson<{ rotation: typeof rotation }>(`/api/operations/occ/flights/${fid}/rotation`),
          fetchJson<{ events: OccEvent[] }>(`/api/operations/occ/flights/${fid}/timeline`),
          fetchJson<{ plan: Record<string, unknown> | null; uplifts: unknown[] }>(`/api/operations/occ/flights/${fid}/fuel`),
          fetchJson<{ loadsheets: unknown[] }>(`/api/operations/occ/flights/${fid}/loadsheets`),
          fetchJson<{ cases: typeof iropsCases }>(`/api/operations/occ/flights/${fid}/irops`),
          fetchJson<{ slots: unknown[] }>(`/api/operations/occ/flights/${fid}/slots`),
          fetchJson<{ crewLegality: typeof crewLegality }>(`/api/operations/occ/flights/${fid}/crew-legality`)
        ]);
        setLiveRow(lv);
        setRotation(rot.rotation || []);
        setTimeline(tl.events || []);
        setFuel({ plan: fu.plan, uplifts: fu.uplifts || [] });
        setLoadsheets(ls.loadsheets || []);
        setIropsCases(ir.cases || []);
        setSlots(sl.slots || []);
        setCrewLegality(cl.crewLegality || []);
        const dep = String(lv.flight.departure_airport || '');
        const arr = String(lv.flight.arrival_airport || '');
        setStationAirport((prev) => (prev && (prev === dep || prev === arr) ? prev : dep || arr));
        if (dep) {
          const st = await fetchJson<{ station: Record<string, unknown> | null }>(
            `/api/operations/occ/stations/${encodeURIComponent(dep)}?date=${encodeURIComponent(occDate)}`
          );
          setStation(st.station);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Flight detail failed');
      }
    },
    [fetchJson, occDate]
  );

  useEffect(() => {
    if (selectedFlightId) void loadFlightDetail(selectedFlightId);
  }, [selectedFlightId, loadFlightDetail]);

  const refreshStation = useCallback(async () => {
    if (!stationAirport) return;
    try {
      const st = await fetchJson<{ station: Record<string, unknown> | null }>(
        `/api/operations/occ/stations/${encodeURIComponent(stationAirport)}?date=${encodeURIComponent(occDate)}`
      );
      setStation(st.station);
    } catch {
      setStation(null);
    }
  }, [fetchJson, stationAirport, occDate]);

  useEffect(() => {
    if (selectedFlightId && stationAirport) void refreshStation();
  }, [stationAirport, occDate, selectedFlightId, refreshStation]);

  const onEtaSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFlightId || !etaLocal) return;
    const iso = new Date(etaLocal).toISOString();
    try {
      const out = await fetchJson<{ live: OccLive }>(`/api/operations/occ/flights/${selectedFlightId}/eta`, {
        method: 'POST',
        body: JSON.stringify({ etaCurrentAt: iso })
      });
      setLiveRow((prev) => (prev ? { ...prev, live: out.live } : prev));
      toast.success('ETA updated');
      void loadFlightDetail(selectedFlightId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ETA failed');
    }
  };

  const onOpenIrops = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFlightId || iropsTitle.trim().length < 3) return;
    try {
      await fetchJson(`/api/operations/occ/flights/${selectedFlightId}/irops`, {
        method: 'POST',
        body: JSON.stringify({ category: iropsCat, title: iropsTitle.trim() })
      });
      setIropsTitle('');
      toast.success('IROPS case opened');
      void loadFlightDetail(selectedFlightId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'IROPS failed');
    }
  };

  const closeIrops = async (caseId: string) => {
    if (!selectedFlightId) return;
    try {
      await fetchJson(`/api/operations/occ/flights/${selectedFlightId}/irops/${caseId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'CLOSED', resolutionNotes: 'Closed from OCC hub.' })
      });
      toast.success('Case closed');
      void loadFlightDetail(selectedFlightId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Close failed');
    }
  };

  const onSlotSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFlightId || !stationAirport || !slotTime) return;
    try {
      await fetchJson(`/api/operations/occ/flights/${selectedFlightId}/slots`, {
        method: 'POST',
        body: JSON.stringify({ airport: stationAirport, slotKind: slotKind, slotTime: new Date(slotTime).toISOString() })
      });
      toast.success('Slot recorded');
      void loadFlightDetail(selectedFlightId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Slot failed');
    }
  };

  const onStationSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!stationAirport) return;
    try {
      await fetchJson(`/api/operations/occ/stations/${encodeURIComponent(stationAirport)}`, {
        method: 'PUT',
        body: JSON.stringify({ stateDate: occDate, rampStatus, notes: stationNotes || null })
      });
      toast.success('Station state saved');
      void refreshStation();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Station save failed');
    }
  };

  const phaseBadgeClass = (phase: string) => {
    const p = phase.toUpperCase();
    if (p === 'AIRBORNE') return 'ops-badge ops-badge--in_air';
    if (p === 'LANDED') return 'ops-badge ops-badge--arrived';
    if (p === 'DEPARTED') return 'ops-badge ops-badge--departed';
    if (p === 'CANCELLED') return 'ops-badge ops-badge--cancelled';
    if (p === 'GROUND') return 'ops-badge ops-badge--boarding';
    return 'ops-badge ops-badge--scheduled';
  };

  const openAlertCount = enterprisePulse?.openAlerts ?? 0;

  return (
    <div className={occDark ? 'occ-hub occ-hub--dark' : 'occ-hub'}>
      <section className="module-card">
        {!embedded ? (
          <>
            <h2>OCC Control Center</h2>
            <p style={{ marginTop: 0, color: '#64748b', fontSize: '0.88rem', maxWidth: '48rem' }}>
              Day-wide operational picture with live phase, ETA, rotation, fuel, loadsheet, IROPS, slots, station control,
              crew legality, and the append-only flight timeline. Booking, check-in, crew assignments, maintenance, and
              finance refunds emit events into the same timeline.
            </p>
          </>
        ) : null}
        {dashError ? (
          <div
            role="alert"
            style={{
              marginBottom: '0.75rem',
              padding: '0.65rem 0.85rem',
              borderRadius: 8,
              border: '1px solid #fecaca',
              background: '#fef2f2',
              color: '#991b1b',
              fontSize: '0.85rem'
            }}
          >
            <strong>OCC board unavailable.</strong> {dashError}{' '}
            <button type="button" className="secondary" style={{ marginLeft: '0.35rem' }} onClick={() => void loadDashboard()}>
              Retry
            </button>
          </div>
        ) : null}
        {schemaNote ? (
          <p className="occ-schema-note" role="status">
            {schemaNote}
          </p>
        ) : null}
        {!embedded ? (
        <div className="ops-filters occ-toolbar" style={{ marginBottom: '0.75rem' }}>
          <label>
            UTC ops date
            <input type="date" value={occDate} onChange={(e) => setOccDate(e.target.value)} />
          </label>
          <button type="button" disabled={dashLoading} onClick={() => void loadDashboard()}>
            {dashLoading ? 'Loading…' : 'Refresh board'}
          </button>
          <label className="occ-toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Live refresh (30s)
          </label>
          <button type="button" className="secondary" onClick={() => setOccDark((d) => !d)}>
            {occDark ? 'Light mode' : 'Dark OCC'}
          </button>
          {lastBoardSync ? (
            <span className="occ-live-pulse" title="Last board sync">
              <span className="occ-live-dot" aria-hidden />
              {new Date(lastBoardSync).toLocaleTimeString()}
            </span>
          ) : null}
          {openAlertCount > 0 ? (
            <span className="occ-alert-badge" role="status">
              {openAlertCount} alert{openAlertCount === 1 ? '' : 's'}
            </span>
          ) : null}
          <Link href="/checkin" className="secondary" style={{ alignSelf: 'end', fontSize: '0.85rem' }}>
            Check-in / manifest
          </Link>
        </div>
        ) : null}

        {!embedded && enterprisePulse && (
          <div className="ops-enterprise-kpis" style={{ marginBottom: '0.75rem' }}>
            <div>
              <strong>{enterprisePulse.conflictCount}</strong>
              <span>Conflicts</span>
            </div>
            <div>
              <strong>{enterprisePulse.openAlerts}</strong>
              <span>Open alerts</span>
            </div>
            <div>
              <strong>{enterprisePulse.dispatchPending}</strong>
              <span>Dispatch pending</span>
            </div>
          </div>
        )}

        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Flight</th>
                <th>Leg</th>
                <th>Dep (UTC)</th>
                <th>Phase</th>
                <th>ETA</th>
                <th>Timer</th>
                <th>Tail</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dashboardFlights.length === 0 && !dashLoading ? (
                <tr>
                  <td colSpan={8} style={{ color: '#64748b' }}>
                    No flights for this date.
                  </td>
                </tr>
              ) : null}
              {dashboardFlights.map((f) => (
                <tr
                  key={f.id}
                  className={isDelayedFlight(f) ? 'occ-row--delayed' : undefined}
                  style={selectedFlightId === f.id ? { background: 'rgba(59,130,246,0.08)' } : undefined}
                >
                  <td style={{ fontWeight: 700 }}>
                    {f.flight_number}
                    {isDelayedFlight(f) ? <span className="ops-badge ops-badge--delayed occ-delay-tag">DELAY</span> : null}
                  </td>
                  <td>
                    {f.departure_airport}→{f.arrival_airport}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{new Date(f.departure_time).toLocaleString()}</td>
                  <td>
                    <span className={phaseBadgeClass(f.live.phase)}>{f.live.phase}</span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                    {f.live.eta ? new Date(f.live.eta).toLocaleString() : '—'}
                  </td>
                  <td style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                    {f.live.landedAt
                      ? `GND ${formatElapsed(f.live.landedAt)}`
                      : f.live.phase === 'GROUND' || f.live.phase === 'PLANNED'
                        ? `DEP ${formatCountdown(f.departure_time)}`
                        : '—'}
                  </td>
                  <td>{f.tail_number || '—'}</td>
                  <td>
                    <button type="button" className="secondary" onClick={() => setSelectedFlightId(f.id)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="module-card">
        <h3>Reference</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.85rem' }}>Delay codes (finance impact)</h4>
            <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem', color: '#475569' }}>
              {delayCodes.map((d) => (
                <li key={d.code}>
                  <strong>{d.code}</strong> — {d.label} (default ${Number(d.default_cost_usd).toFixed(0)})
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.85rem' }}>Crew duty display limits</h4>
            {dutyLimits ? (
              <pre style={{ margin: 0, fontSize: '0.75rem', background: '#f8fafc', padding: '0.5rem', borderRadius: 6 }}>
                {JSON.stringify(dutyLimits, null, 2)}
              </pre>
            ) : dutyLimitsError ? (
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#b45309' }}>{dutyLimitsError}</p>
            ) : (
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
                No duty limits row yet. Apply <code style={{ fontSize: '0.75rem' }}>database/occ_control_center_v2.sql</code> or{' '}
                <code style={{ fontSize: '0.75rem' }}>bash backend/scripts/apply-occ-migrations.sh</code>.
              </p>
            )}
          </div>
        </div>
      </section>

      {selectedFlightId ? (
        <section className="module-card">
          <h3>Flight workspace</h3>
          <p style={{ marginTop: 0, fontSize: '0.8rem', color: '#64748b' }}>
            Selected: <strong>{String(liveRow?.flight?.flight_number || '…')}</strong> — use{' '}
            <Link href={`/checkin?flightId=${encodeURIComponent(selectedFlightId)}`}>check-in</Link> for passenger
            workflow; delays and dispatch remain in <strong>Flight control</strong> tab.
          </p>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            {(
              [
                ['live', 'Live & ETA'],
                ['rotation', 'Rotation'],
                ['fuel', 'Fuel'],
                ['load', 'Loadsheet'],
                ['irops', 'IROPS'],
                ['slots', 'Slots'],
                ['station', 'Station'],
                ['timeline', 'Timeline / audit'],
                ['crew', 'Crew legality']
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" className={detailTab === k ? '' : 'secondary'} onClick={() => setDetailTab(k)}>
                {label}
              </button>
            ))}
          </div>

          {detailTab === 'live' && liveRow && (
            <div>
              <p>
                Status <strong>{liveRow.live.status}</strong> · Phase{' '}
                <span className={phaseBadgeClass(liveRow.live.phase)}>{liveRow.live.phase}</span>
                {liveRow.live.landedAt ? (
                  <span className="occ-turnaround-chip"> Turnaround {formatElapsed(liveRow.live.landedAt)}</span>
                ) : null}
              </p>
              <ul style={{ fontSize: '0.85rem', color: '#334155' }}>
                <li>Off-block: {liveRow.live.departedAt ? new Date(liveRow.live.departedAt).toLocaleString() : '—'}</li>
                <li>Airborne: {liveRow.live.airborneAt ? new Date(liveRow.live.airborneAt).toLocaleString() : '—'}</li>
                <li>Landed: {liveRow.live.landedAt ? new Date(liveRow.live.landedAt).toLocaleString() : '—'}</li>
                <li>Current ETA: {liveRow.live.eta ? new Date(liveRow.live.eta).toLocaleString() : '—'}</li>
              </ul>
              <form onSubmit={onEtaSubmit} className="module-form-grid" style={{ maxWidth: '24rem' }}>
                <label>
                  Revise ETA (local)
                  <input type="datetime-local" value={etaLocal} onChange={(e) => setEtaLocal(e.target.value)} />
                </label>
                <button type="submit">Post ETA to OCC</button>
              </form>
              {timeline.length > 0 ? (
                <div className="occ-dispatch-timeline">
                  <h4 style={{ fontSize: '0.85rem', margin: '0.75rem 0 0.35rem' }}>Dispatch timeline</h4>
                  <ol>
                    {timeline.slice(0, 12).map((ev) => (
                      <li key={ev.id}>
                        <time>{new Date(ev.created_at).toLocaleTimeString()}</time>
                        <strong>{ev.event_type}</strong>
                        <span>{ev.source_system}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
          )}

          {detailTab === 'rotation' && (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Flight</th>
                    <th>Leg</th>
                    <th>Departure</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rotation.map((r) => (
                    <tr key={r.id} style={r.id === selectedFlightId ? { background: 'rgba(59,130,246,0.08)' } : undefined}>
                      <td>{r.flight_number}</td>
                      <td>
                        {r.departure_airport}→{r.arrival_airport}
                      </td>
                      <td>{new Date(r.departure_time).toLocaleString()}</td>
                      <td>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {detailTab === 'fuel' && (
            <div>
              <h4 style={{ fontSize: '0.9rem' }}>Plan</h4>
              <pre style={{ fontSize: '0.75rem', background: '#f8fafc', padding: '0.5rem' }}>{JSON.stringify(fuel.plan, null, 2)}</pre>
              <h4 style={{ fontSize: '0.9rem' }}>Uplifts</h4>
              <pre style={{ fontSize: '0.75rem', background: '#f8fafc', padding: '0.5rem' }}>{JSON.stringify(fuel.uplifts, null, 2)}</pre>
            </div>
          )}

          {detailTab === 'load' && (
            <pre style={{ fontSize: '0.75rem', background: '#f8fafc', padding: '0.5rem' }}>{JSON.stringify(loadsheets, null, 2)}</pre>
          )}

          {detailTab === 'irops' && (
            <div>
              <ul style={{ fontSize: '0.85rem' }}>
                {iropsCases.map((c) => (
                  <li key={c.id}>
                    <strong>{c.title}</strong> ({c.category}, {c.status})
                    {c.status !== 'CLOSED' ? (
                      <button type="button" className="secondary" style={{ marginLeft: 8 }} onClick={() => void closeIrops(c.id)}>
                        Close
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <form onSubmit={onOpenIrops} className="module-form-grid" style={{ maxWidth: '28rem' }}>
                <label>
                  Category
                  <select value={iropsCat} onChange={(e) => setIropsCat(e.target.value)}>
                    {['MISCONNECT', 'WX', 'MX', 'CREW', 'STATION', 'SECURITY', 'OTHER'].map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Title
                  <input value={iropsTitle} onChange={(e) => setIropsTitle(e.target.value)} placeholder="Min 3 chars" />
                </label>
                <button type="submit">Open case</button>
              </form>
            </div>
          )}

          {detailTab === 'slots' && (
            <div>
              <form onSubmit={onSlotSubmit} className="module-form-grid" style={{ maxWidth: '24rem' }}>
                <label>
                  Airport (slot)
                  <input value={stationAirport} onChange={(e) => setStationAirport(e.target.value.toUpperCase())} maxLength={10} />
                </label>
                <label>
                  Kind
                  <select value={slotKind} onChange={(e) => setSlotKind(e.target.value as 'DEP' | 'ARR')}>
                    <option value="DEP">DEP</option>
                    <option value="ARR">ARR</option>
                  </select>
                </label>
                <label>
                  Slot time
                  <input type="datetime-local" value={slotTime} onChange={(e) => setSlotTime(e.target.value)} />
                </label>
                <button type="submit">Record slot</button>
              </form>
              <pre style={{ fontSize: '0.75rem', marginTop: '0.75rem' }}>{JSON.stringify(slots, null, 2)}</pre>
            </div>
          )}

          {detailTab === 'station' && (
            <div>
              <form onSubmit={onStationSave} className="module-form-grid" style={{ maxWidth: '24rem' }}>
                <label>
                  Airport
                  <input value={stationAirport} onChange={(e) => setStationAirport(e.target.value.toUpperCase())} maxLength={10} />
                </label>
                <label>
                  Ramp status
                  <input value={rampStatus} onChange={(e) => setRampStatus(e.target.value)} />
                </label>
                <label>
                  Notes
                  <textarea value={stationNotes} onChange={(e) => setStationNotes(e.target.value)} rows={3} />
                </label>
                <button type="submit">Save station day</button>
              </form>
              <p style={{ fontSize: '0.8rem', color: '#64748b' }}>Current row: {station ? JSON.stringify(station) : 'None'}</p>
            </div>
          )}

          {detailTab === 'timeline' && (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Source</th>
                    <th>Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((ev) => (
                    <tr key={ev.id}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.75rem' }}>{new Date(ev.created_at).toLocaleString()}</td>
                      <td>{ev.event_type}</td>
                      <td>{ev.source_system}</td>
                      <td style={{ fontSize: '0.7rem', maxWidth: 280, wordBreak: 'break-all' }}>
                        {typeof ev.payload_json === 'object' ? JSON.stringify(ev.payload_json) : String(ev.payload_json)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {detailTab === 'crew' && (
            <ul style={{ fontSize: '0.85rem' }}>
              {crewLegality.map((c) => (
                <li key={c.crewUserId}>
                  {c.fullName} ({c.dutyRole}): {c.assignable ? 'OK' : <span style={{ color: '#b91c1c' }}>{c.message}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
