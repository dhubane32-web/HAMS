'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import toast from 'react-hot-toast';
import type { UserRole } from '@/lib/roles';
import { getPublicApiBaseUrl } from '@/lib/api-base';

const API_BASE_URL = getPublicApiBaseUrl();

type ReportDef = {
  id: string;
  label: string;
  path: string;
  roles: readonly UserRole[];
  chartKeys?: { x: string; lines?: string[]; bars?: string[] };
};

const REPORTS: ReportDef[] = [
  {
    id: 'daily-sales',
    label: 'Daily sales',
    path: '/api/reports-analytics/reports/daily-sales',
    roles: ['super_admin', 'admin', 'finance', 'sales_manager', 'agent'],
    chartKeys: { x: 'day', bars: ['gross_collected'] }
  },
  {
    id: 'bookings',
    label: 'Bookings',
    path: '/api/reports-analytics/reports/bookings',
    roles: ['super_admin', 'admin', 'finance', 'sales_manager', 'agent']
  },
  {
    id: 'tickets',
    label: 'Tickets',
    path: '/api/reports-analytics/reports/tickets',
    roles: ['super_admin', 'admin', 'finance', 'sales_manager', 'agent']
  },
  {
    id: 'passengers',
    label: 'Passengers',
    path: '/api/reports-analytics/reports/passengers',
    roles: ['super_admin', 'admin', 'finance', 'sales_manager', 'agent']
  },
  {
    id: 'revenue',
    label: 'Revenue',
    path: '/api/reports-analytics/reports/revenue',
    roles: ['super_admin', 'admin', 'finance', 'sales_manager', 'agent'],
    chartKeys: { x: 'day', lines: ['net_collected'] }
  },
  {
    id: 'agent-sales',
    label: 'Agent sales',
    path: '/api/reports-analytics/reports/agent-sales',
    roles: ['super_admin', 'admin', 'finance', 'sales_manager', 'agent'],
    chartKeys: { x: 'agent_name', bars: ['booked_gross'] }
  },
  {
    id: 'refunds',
    label: 'Refunds',
    path: '/api/reports-analytics/reports/refunds',
    roles: ['super_admin', 'admin', 'finance', 'sales_manager', 'agent']
  },
  {
    id: 'expenses',
    label: 'Expenses',
    path: '/api/reports-analytics/reports/expenses',
    roles: ['super_admin', 'admin', 'finance']
  },
  {
    id: 'flight-performance',
    label: 'Flight performance',
    path: '/api/reports-analytics/reports/flight-performance',
    roles: ['super_admin', 'admin', 'finance', 'sales_manager', 'operations', 'maintenance'],
    chartKeys: { x: 'flight_number', bars: ['checkin_count', 'booking_count'] }
  },
  {
    id: 'route-performance',
    label: 'Route performance',
    path: '/api/reports-analytics/reports/route-performance',
    roles: ['super_admin', 'admin', 'finance', 'sales_manager', 'operations', 'maintenance'],
    chartKeys: { x: 'route_label', bars: ['itinerary_fare_sum'] }
  },
  {
    id: 'checkins',
    label: 'Check-in',
    path: '/api/reports-analytics/reports/checkins',
    roles: ['super_admin', 'admin', 'finance', 'sales_manager', 'operations', 'customer_service']
  },
  {
    id: 'crew-utilization',
    label: 'Crew utilization',
    path: '/api/reports-analytics/reports/crew-utilization',
    roles: ['super_admin', 'admin', 'operations'],
    chartKeys: { x: 'full_name', bars: ['block_hours_approx'] }
  },
  {
    id: 'aircraft-utilization',
    label: 'Aircraft utilization',
    path: '/api/reports-analytics/reports/aircraft-utilization',
    roles: ['super_admin', 'admin', 'operations', 'maintenance'],
    chartKeys: { x: 'tail_number', bars: ['block_hours_approx'] }
  },
  {
    id: 'customer-service',
    label: 'Customer service',
    path: '/api/reports-analytics/reports/customer-service',
    roles: ['super_admin', 'admin', 'finance', 'customer_service'],
    chartKeys: { x: 'case_type', bars: ['cnt'] }
  }
];

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('hams_token') : null;
}

function roleFromToken(): UserRole | null {
  const t = getToken();
  if (!t) return null;
  try {
    const payload = JSON.parse(atob(t.split('.')[1]));
    return (payload.role as UserRole) || null;
  } catch {
    return null;
  }
}

function canSeeReport(role: UserRole | null, def: ReportDef): boolean {
  if (!role) return false;
  if (def.roles.includes(role)) return true;
  if (role === 'super_admin' && def.roles.includes('admin')) return true;
  return false;
}

function defaultRange() {
  const to = new Date();
  const from = new Date(Date.now() - 30 * 86400000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function ReportsAnalyticsModule() {
  const [role, setRole] = useState<UserRole | null>(null);
  const { from: defFrom, to: defTo } = defaultRange();
  const [from, setFrom] = useState(defFrom);
  const [to, setTo] = useState(defTo);
  const [flightId, setFlightId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [route, setRoute] = useState('');
  const [active, setActive] = useState<string>('daily-sales');
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [kpis, setKpis] = useState<Record<string, unknown> | null>(null);
  const [flights, setFlights] = useState<Array<{ id: string; flight_number: string; route?: string }>>([]);
  const [routes, setRoutes] = useState<Array<{ route_label: string }>>([]);
  const [agents, setAgents] = useState<Array<{ id: string; full_name: string }>>([]);

  const visibleReports = useMemo(() => REPORTS.filter((r) => canSeeReport(role, r)), [role]);

  const activeDef = useMemo(() => REPORTS.find((r) => r.id === active) || visibleReports[0], [active, visibleReports]);

  const fetchJson = useCallback(async <T,>(path: string): Promise<T> => {
    const token = getToken();
    if (!token) throw new Error('Please login first.');
    const res = await fetch(`${API_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    let body: { message?: string } & Partial<T> = {};
    if (text) {
      try {
        body = JSON.parse(text) as { message?: string } & T;
      } catch {
        body = {};
      }
    }
    if (!res.ok) {
      const err = new Error(body.message || 'Request failed.') as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return body as T;
  }, []);

  useEffect(() => {
    setRole(roleFromToken());
  }, []);

  useEffect(() => {
    if (!role) return;
    const q = new URLSearchParams({ from, to });
    void fetchJson<{ flights: Array<{ id: string; flight_number: string; departure_airport: string; arrival_airport: string }> }>(
      `/api/reports-analytics/meta/flights?${q}`
    )
      .then((d) =>
        setFlights(
          (d.flights || []).map((f) => ({
            id: f.id,
            flight_number: f.flight_number,
            route: `${f.departure_airport}→${f.arrival_airport}`
          }))
        )
      )
      .catch(() => setFlights([]));
    void fetchJson<{ routes: Array<{ route_label: string }> }>(`/api/reports-analytics/meta/routes?${q}`)
      .then((d) => setRoutes(d.routes || []))
      .catch(() => setRoutes([]));
    if (role && ['super_admin', 'admin', 'finance', 'sales_manager'].includes(role)) {
      void fetchJson<{ agents: Array<{ id: string; full_name: string }> }>('/api/reports-analytics/meta/agents')
        .then((d) => setAgents(d.agents || []))
        .catch(() => setAgents([]));
    } else {
      setAgents([]);
    }
  }, [role, from, to, fetchJson]);

  const loadKpis = useCallback(async () => {
    if (!role) return;
    try {
      const q = new URLSearchParams({ from, to });
      const d = await fetchJson<{ kpis: Record<string, unknown> }>(`/api/reports-analytics/kpis?${q}`);
      setKpis(d.kpis || null);
    } catch {
      setKpis(null);
    }
  }, [role, from, to, fetchJson]);

  useEffect(() => {
    void loadKpis();
  }, [loadKpis]);

  const buildQuery = useCallback(() => {
    const q = new URLSearchParams({ from, to });
    if (flightId.trim() && /^[0-9a-f-]{36}$/i.test(flightId.trim())) q.set('flightId', flightId.trim());
    if (agentId && ['super_admin', 'admin', 'finance', 'sales_manager'].includes(role || '')) q.set('agentId', agentId);
    if (route.trim()) q.set('route', route.trim().toUpperCase());
    return q.toString();
  }, [from, to, flightId, agentId, route, role]);

  useEffect(() => {
    if (!role) return;
    const def = REPORTS.find((r) => r.id === active);
    if (!def || !canSeeReport(role, def)) {
      const first = visibleReports[0]?.id;
      if (first && first !== active) setActive(first);
    }
  }, [role, active, visibleReports]);

  useEffect(() => {
    if (!role) return;
    const def = REPORTS.find((r) => r.id === active);
    if (!def || !canSeeReport(role, def)) return;
    let cancelled = false;
    setLoading(true);
    const q = new URLSearchParams({ from, to });
    if (flightId.trim() && /^[0-9a-f-]{36}$/i.test(flightId.trim())) q.set('flightId', flightId.trim());
    if (agentId && ['super_admin', 'admin', 'finance', 'sales_manager'].includes(role)) q.set('agentId', agentId);
    if (route.trim()) q.set('route', route.trim().toUpperCase());
    void (async () => {
      try {
        const d = await fetchJson<Record<string, unknown>>(`${def.path}?${q}`);
        if (!cancelled) setPayload(d);
      } catch (e) {
        if (!cancelled) {
          toast.error((e as Error).message);
          setPayload(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, from, to, flightId, agentId, route, role, fetchJson, refreshNonce]);

  async function exportCsv() {
    if (!activeDef || !canSeeReport(role, activeDef)) return;
    const token = getToken();
    if (!token) return toast.error('Login required.');
    const qs = `${buildQuery()}&format=csv`;
    const res = await fetch(`${API_BASE_URL}${activeDef.path}?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      toast.error('CSV export failed.');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeDef.id}-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded.');
  }

  function printPdf() {
    window.print();
  }

  const chartData = useMemo(() => {
    if (!payload || !activeDef?.chartKeys) return [];
    const { x, lines, bars } = activeDef.chartKeys;
    if (activeDef.id === 'revenue' && Array.isArray(payload.series)) {
      return payload.series as Array<Record<string, unknown>>;
    }
    if (activeDef.id === 'daily-sales' && Array.isArray(payload.series)) {
      return payload.series as Array<Record<string, unknown>>;
    }
    if (activeDef.id === 'agent-sales' && Array.isArray(payload.agentSales)) {
      return payload.agentSales as Array<Record<string, unknown>>;
    }
    if (activeDef.id === 'flight-performance' && Array.isArray(payload.flights)) {
      return (payload.flights as Array<Record<string, unknown>>).slice(0, 40);
    }
    if (activeDef.id === 'route-performance' && Array.isArray(payload.routes)) {
      return (payload.routes as Array<Record<string, unknown>>).slice(0, 30);
    }
    if (activeDef.id === 'crew-utilization' && Array.isArray(payload.crew)) {
      return payload.crew as Array<Record<string, unknown>>;
    }
    if (activeDef.id === 'aircraft-utilization' && Array.isArray(payload.aircraft)) {
      return payload.aircraft as Array<Record<string, unknown>>;
    }
    if (activeDef.id === 'customer-service' && Array.isArray(payload.byType)) {
      return (payload.byType as Array<Record<string, unknown>>).map((r) => ({
        case_type: r.case_type,
        cnt: r.cnt
      }));
    }
    if (lines?.[0] && Array.isArray(payload.series)) return payload.series as Array<Record<string, unknown>>;
    if (bars?.[0] && x) {
      const key = Object.keys(payload).find((k) => Array.isArray(payload[k]));
      if (key) return (payload[key] as Array<Record<string, unknown>>).slice(0, 50);
    }
    return [];
  }, [payload, activeDef]);

  const summaryTableRows = useMemo(() => {
    if (!payload) return { headers: [] as string[], rows: [] as unknown[][] };
    if (
      activeDef &&
      (activeDef.id === 'revenue' || activeDef.id === 'daily-sales') &&
      Array.isArray(payload.series) &&
      (payload.series as unknown[]).length
    ) {
      const arr = payload.series as Array<Record<string, unknown>>;
      const headers = Object.keys(arr[0]);
      const rows = arr.map((row) => headers.map((h) => row[h]));
      return { headers, rows };
    }
    const skipArrays = new Set(['series', 'pendingRefundRequests']);
    const key = Object.keys(payload).find((k) => Array.isArray(payload[k]) && !skipArrays.has(k));
    if (!key) return { headers: [], rows: [] };
    const arr = payload[key] as Array<Record<string, unknown>>;
    if (!arr.length) return { headers: [], rows: [] };
    const headers = Object.keys(arr[0]);
    const rows = arr.slice(0, 200).map((row) => headers.map((h) => row[h]));
    return { headers, rows };
  }, [payload, activeDef]);

  return (
    <main className="module-page reports-analytics-print">
      <section className="module-card no-print">
        <h1>Reports &amp; Analytics</h1>
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>
          Live data from HAMS with role-based access: finance and commercial reports, operations and utilization, refunds
          and expenses, and customer service case analytics. Agents see only their own sales scope. Use CSV export or
          print / save as PDF from your browser.
        </p>
      </section>

      <section className="module-card no-print">
        <h2 style={{ marginTop: 0 }}>KPI snapshot</h2>
        {kpis ? (
          <div className="stats-inline">
            <article>
              <p>Bookings created</p>
              <strong>{String(kpis.bookingsCreated ?? '—')}</strong>
            </article>
            <article>
              <p>Net payments (period)</p>
              <strong>{Number(kpis.netPaymentsInPeriod ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
            </article>
            <article>
              <p>Check-ins</p>
              <strong>{kpis.checkins == null ? '—' : String(kpis.checkins)}</strong>
            </article>
            <article>
              <p>CS cases opened</p>
              <strong>{kpis.customerServiceCases == null ? '—' : String(kpis.customerServiceCases)}</strong>
            </article>
          </div>
        ) : (
          <p style={{ color: '#64748b' }}>KPIs unavailable for your role or while loading.</p>
        )}
      </section>

      <div className="module-card no-print" style={{ display: 'grid', gap: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>Filters</h2>
        <div className="module-form-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
          <label>
            From
            <input className="module-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input className="module-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            Flight
            <select className="module-input" value={flightId} onChange={(e) => setFlightId(e.target.value)}>
              <option value="">All flights</option>
              {flights.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.flight_number} {f.route ? `(${f.route})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Route (e.g. MGQ-HGA)
            <input className="module-input" value={route} onChange={(e) => setRoute(e.target.value)} placeholder="DEP-ARR" />
          </label>
          {role && ['super_admin', 'admin', 'finance', 'sales_manager'].includes(role) ? (
            <label>
              Agent
              <select className="module-input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">All agents</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="button" onClick={() => setRefreshNonce((n) => n + 1)}>
            Apply
          </button>
          <button type="button" className="secondary" onClick={() => void exportCsv()}>
            Export CSV
          </button>
          <button type="button" className="secondary" onClick={printPdf}>
            Print / PDF
          </button>
        </div>
        <datalist id="route-options">
          {routes.map((r) => (
            <option key={r.route_label} value={r.route_label.replace('→', '-')} />
          ))}
        </datalist>
      </div>

      <div className="module-form-grid no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        {visibleReports.map((r) => (
          <button key={r.id} type="button" className={active === r.id ? '' : 'secondary'} onClick={() => setActive(r.id)}>
            {r.label}
          </button>
        ))}
      </div>

      <section id="report-print-area" className="module-card">
        <h2 style={{ marginTop: 0 }}>{activeDef?.label}</h2>
        {loading ? <p style={{ color: '#64748b' }}>Loading…</p> : null}
        {payload && activeDef?.chartKeys && chartData.length > 0 ? (
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              {activeDef.chartKeys.lines?.length ? (
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey={activeDef.chartKeys.x} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  {activeDef.chartKeys.lines.map((k) => (
                    <Line key={k} type="monotone" dataKey={k} stroke="#0047AB" dot={false} name={k} />
                  ))}
                </LineChart>
              ) : (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey={activeDef.chartKeys.x} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  {(activeDef.chartKeys.bars || []).map((k) => (
                    <Bar key={k} dataKey={k} fill="#0ea5e9" name={k} />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        ) : null}

        {payload && activeDef?.id === 'refunds' && Array.isArray(payload.pendingRefundRequests) ? (
          <div style={{ marginTop: '0.75rem' }}>
            <h3>Pending refund requests (finance)</h3>
            <table className="module-table">
              <thead>
                <tr>
                  <th>PNR</th>
                  <th>Amount</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {(payload.pendingRefundRequests as Array<Record<string, unknown>>).map((p) => (
                  <tr key={String(p.id)}>
                    <td>{String(p.pnr)}</td>
                    <td>{String(p.amount)}</td>
                    <td>{p.created_at ? String(p.created_at) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {summaryTableRows.headers.length > 0 ? (
          <div style={{ marginTop: '1rem', overflow: 'auto' }}>
            <h3>Summary table</h3>
            <table className="module-table">
              <thead>
                <tr>
                  {summaryTableRows.headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summaryTableRows.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell == null ? '' : String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : payload && !loading ? (
          <p style={{ color: '#64748b' }}>No tabular rows for this report (try another date range).</p>
        ) : null}

        {payload && activeDef?.id === 'customer-service' && Array.isArray(payload.byStatus) ? (
          <div style={{ marginTop: '1rem' }}>
            <h3>By status</h3>
            <table className="module-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {(payload.byStatus as Array<{ status: string; cnt: number }>).map((r) => (
                  <tr key={r.status}>
                    <td>{r.status}</td>
                    <td>{r.cnt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Cases with finance refund link: <strong>{String(payload.casesWithFinanceRefundLink ?? '')}</strong>
            </p>
          </div>
        ) : null}

        {payload && activeDef?.id === 'revenue' && payload.summary ? (
          <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
            Itinerary fare on bookings created in range:{' '}
            <strong>{Number((payload.summary as Record<string, unknown>).itineraryFareBookingsCreatedInRange).toFixed(2)}</strong>
            <br />
            {String((payload.summary as Record<string, unknown>).note || '')}
          </p>
        ) : null}
      </section>

    </main>
  );
}
