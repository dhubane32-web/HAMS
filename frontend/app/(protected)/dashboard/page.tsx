'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  BookOpen,
  DollarSign,
  Plane,
  Users,
  AlertTriangle,
  ClipboardList
} from 'lucide-react';
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  CartesianGrid
} from 'recharts';
import type { UserRole } from '@/lib/roles';
import { roleDisplayName } from '@/lib/roles';
import { erpModuleTilesForRole } from '@/lib/dashboard-modules';
import { clearClientSession, hydrateSessionFromCookie } from '@/lib/auth-session';
import { getPublicApiBaseUrl } from '@/lib/api-base';

const API_BASE_URL = getPublicApiBaseUrl();

type Kpi = {
  id: string;
  label: string;
  value: number;
  href: string;
  format?: 'money';
};

type FlightRow = {
  id: string;
  flightNumber: string;
  dep: string;
  arr: string;
  departureTime: string;
  status: string;
  tail: string | null;
  model: string | null;
};

type CrewFlight = {
  id: string;
  flight_number: string;
  departure_airport: string;
  arrival_airport: string;
  departure_time: string;
  status: string;
  duty_role: string;
};

type AlertItem = {
  id: string;
  severity: string;
  title: string;
  detail: string;
  href: string;
  time: string | null;
};

type Summary = {
  role: UserRole;
  date: string;
  kpis: Kpi[];
  quickLinks: { label: string; href: string }[];
  alerts: AlertItem[];
  todaysFlights: FlightRow[] | null;
  myFlights: CrewFlight[] | null;
  operationalSummary: { byStatus: Record<string, number>; flightsCount: number } | null;
  checkinStatus: { passengersOnTodayFlights: number; checkedInOnTodayFlights: number; outstanding: number } | null;
  crewOverview: { flightNumber: string; departureTime: string; name: string; duty: string }[] | null;
  bookingRevenue: {
    paymentsToday: number;
    refundsToday: number;
    bookingsToday: number;
    ticketsToday: number;
    series7d: { date: string; amount: number }[];
    paymentMix7d: { type: string; amount: number }[];
  } | null;
  financeSnapshot: {
    revenueMonth: number;
    refundsMonth: number;
    netMonth: number;
    holdsOutstanding: number;
  } | null;
};

const MIX_COLORS = ['#2563EB', '#16A34A', '#F59E0B', '#8B5CF6', '#0D9488', '#DB2777'];

function formatMoney(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

function formatKpiValue(k: Kpi) {
  const v = Number(k.value);
  if (!Number.isFinite(v)) return '—';
  if (k.format === 'money') return formatMoney(v);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function statusClass(status: string) {
  const s = String(status || '').toUpperCase().replace(/\s+/g, '_');
  if (s.includes('DELAY')) return 'delayed';
  if (s.includes('DEPART') || s.includes('AIRBORNE')) return 'departed';
  if (s.includes('CANCEL')) return 'cancelled';
  if (s.includes('SCHEDULE')) return 'scheduled';
  return 'on-time';
}

function normalizeSeries7d(series: { date: string; amount: number }[], endDate: string) {
  const end = new Date(`${endDate}T12:00:00`);
  const map = new Map(series.map((r) => [r.date, Number(r.amount)]));
  const out: { key: string; label: string; amount: number }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({
      key,
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      amount: map.get(key) ?? 0
    });
  }
  return out;
}

function safeTimeLabel(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function safeDateTimeLabel(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function kpiIcon(id: string) {
  if (id.includes('rev') || id.includes('pay') || id.includes('net') || id.includes('month')) return DollarSign;
  if (id.includes('flight') || id.includes('sched') || id.includes('del') || id.includes('mine')) return Plane;
  if (id.includes('user') || id.includes('pax') || id.includes('ck') || id.includes('bkg') || id.includes('tix')) return Users;
  if (id.includes('def') || id.includes('hold') || id.includes('insp')) return AlertTriangle;
  return BookOpen;
}

export default function DashboardPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    hydrateSessionFromCookie();
    const token = localStorage.getItem('hams_token');
    const rawUser = localStorage.getItem('hams_user');
    if (!token) {
      router.replace('/login');
      return;
    }
    let role: UserRole | null = null;
    if (rawUser) {
      try {
        const u = JSON.parse(rawUser) as { role?: UserRole };
        if (u.role) role = u.role;
      } catch {
        // ignore
      }
    }
    setUserRole(role);
    setLoadError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/dashboard/summary`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) {
        clearClientSession();
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Dashboard unavailable.');
      }
      setSummary((await res.json()) as Summary);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load dashboard.');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const chart7d = useMemo(() => {
    if (!summary?.bookingRevenue) return [];
    return normalizeSeries7d(summary.bookingRevenue.series7d, summary.date);
  }, [summary]);

  const mixData = useMemo(() => {
    if (!summary?.bookingRevenue?.paymentMix7d?.length) return [];
    return summary.bookingRevenue.paymentMix7d.map((r, i) => ({
      key: `${String(r.type || 'unknown')}-${i}`,
      name: r.type || 'Other',
      value: Math.round(Number(r.amount)),
      color: MIX_COLORS[i % MIX_COLORS.length]
    }));
  }, [summary]);

  const roleTitle = roleDisplayName(userRole ?? undefined);
  const moduleRole = summary?.role ?? userRole;
  const erpTiles = moduleRole ? erpModuleTilesForRole(moduleRole as UserRole) : [];
  const canOpenReports =
    moduleRole &&
    ['admin', 'super_admin', 'finance', 'operations', 'sales_manager'].includes(moduleRole as UserRole);

  return (
    <main className="dashboard-page">
      <section className="dashboard-intro">
        <div>
          <h1 className="dashboard-h1">Operations control center</h1>
          <p className="dashboard-sub">
            Live network snapshot for <strong>{roleTitle}</strong> — data refreshed from HAMS core services.
          </p>
        </div>
        <div className="dashboard-intro-meta">
          <span>{summary?.date ? new Date(`${summary.date}T12:00:00Z`).toLocaleDateString('en-US', { dateStyle: 'full' }) : '—'}</span>
          {canOpenReports && (
            <Link href="/reports" className="dashboard-text-link">
              Open reports <ArrowUpRight size={14} />
            </Link>
          )}
        </div>
      </section>

      {loadError && (
        <div className="dashboard-banner dashboard-banner-error">
          <AlertTriangle size={18} />
          <div>
            <strong>Unable to load dashboard</strong>
            <p>{loadError}</p>
            <button type="button" className="dashboard-retry" onClick={() => void load()}>
              Retry
            </button>
          </div>
        </div>
      )}

      <section className="dashboard-stat-grid">
        {(summary?.kpis ?? []).map((k, idx) => {
          const Icon = kpiIcon(k.id);
          const tone = ['blue', 'green', 'orange', 'purple'][idx % 4];
          return (
            <Link key={k.id} href={k.href} className={`dashboard-stat-card dashboard-stat-link`}>
              <div className={`stat-icon ${tone}`}>
                <Icon size={18} />
              </div>
              <div>
                <p>{k.label}</p>
                <h3>{summary ? formatKpiValue(k) : '—'}</h3>
                <span>View module</span>
              </div>
              <ArrowUpRight size={20} className="stat-trend" aria-hidden />
            </Link>
          );
        })}
        {!summary?.kpis?.length && !loadError && (
          <p className="dashboard-empty-inline">Loading KPIs…</p>
        )}
      </section>

      {erpTiles.length > 0 && (
        <section className="dashboard-erp-modules" aria-labelledby="erp-modules-heading">
          <div className="dashboard-section-head">
            <h2 id="erp-modules-heading" className="dashboard-section-title">
              HAMS business areas
            </h2>
            <p className="dashboard-section-lead">Open a live module — each tile links to a real screen in this workspace.</p>
          </div>
          <div className="dashboard-module-grid">
            {erpTiles.map((m) => (
              <Link key={m.id} href={m.href} className="dashboard-module-tile">
                <h3>{m.title}</h3>
                <p>{m.description}</p>
                <span className="dashboard-module-go">
                  Open module <ArrowUpRight size={14} aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="dashboard-main-grid">
        {summary?.bookingRevenue &&
          ['admin', 'super_admin', 'finance', 'sales_manager'].includes(summary.role as UserRole) && (
          <article className="dashboard-card large">
            <div className="card-head">
              <h3>Booking revenue summary</h3>
              <span className="card-head-muted">Posted payments — last 7 days</span>
            </div>
            {chart7d.length > 0 ? (
              <div style={{ width: '100%', height: 240, minWidth: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart7d}>
                  <CartesianGrid stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => {
                      const n = Number(v);
                      if (!Number.isFinite(n)) return '$0';
                      return `$${Math.round(n / 1000)}k`;
                    }}
                  />
                  <Tooltip formatter={(value) => formatMoney(Number(value))} />
                  <Line type="monotone" dataKey="amount" stroke="#0047AB" strokeWidth={2.5} dot />
                </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="dashboard-muted">No payment postings in the last seven days.</p>
            )}
            <div className="dashboard-inline-metrics">
              <span>
                Today collected: <strong>{formatMoney(summary.bookingRevenue.paymentsToday)}</strong>
              </span>
              <span>
                Refunds today: <strong>{formatMoney(summary.bookingRevenue.refundsToday)}</strong>
              </span>
              {['admin', 'super_admin', 'finance', 'sales_manager'].includes(summary.role as UserRole) && (
                <Link href="/finance" className="mini-link">
                  Payment register
                </Link>
              )}
            </div>
          </article>
        )}

        {summary?.bookingRevenue &&
          mixData.length > 0 &&
          ['admin', 'super_admin', 'finance', 'sales_manager'].includes(summary.role as UserRole) && (
          <article className="dashboard-card">
            <h3>Payments by channel (7 days)</h3>
            <p className="dashboard-muted small">Grouped by payment type from the ledger</p>
            <div style={{ width: '100%', height: 220, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={mixData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={86} paddingAngle={2}>
                  {mixData.map((entry) => (
                    <Cell key={entry.key} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatMoney(Number(value))} />
              </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="legend-list">
              {mixData.map((entry) => (
                <li key={entry.key}>
                  <span style={{ background: entry.color }} />
                  {entry.name} — {formatMoney(entry.value)}
                </li>
              ))}
            </ul>
          </article>
        )}

        {summary?.operationalSummary &&
          ['admin', 'super_admin', 'operations', 'maintenance'].includes(summary.role as UserRole) && (
          <article className="dashboard-card wide">
            <div className="card-head">
              <h3>Airline operational summary</h3>
              <Link href="/operations" className="mini-link">
                Open operations control
              </Link>
            </div>
            <div className="ops-metrics">
              <p>
                Flights today: <strong>{summary.operationalSummary.flightsCount}</strong>
              </p>
              {Object.entries(summary.operationalSummary.byStatus).map(([st, n]) => (
                <p key={st}>
                  {st}: <strong>{n}</strong>
                </p>
              ))}
            </div>
            {summary.todaysFlights && summary.todaysFlights.length > 0 ? (
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Flight</th>
                    <th>Route</th>
                    <th>Aircraft</th>
                    <th>STD (local)</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {summary.todaysFlights.map((f) => (
                    <tr key={f.id}>
                      <td>{f.flightNumber}</td>
                      <td>
                        {f.dep} → {f.arr}
                      </td>
                      <td>
                        {f.tail ? `${f.tail} (${f.model || ''})` : '—'}
                      </td>
                      <td>{safeTimeLabel(f.departureTime)}</td>
                      <td>
                        <span className={`status ${statusClass(f.status)}`}>{f.status}</span>
                      </td>
                      <td>
                        <Link href="/operations" className="mini-link">
                          Details
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="dashboard-muted">No flights scheduled for today in the network calendar.</p>
            )}
          </article>
        )}

        {summary?.todaysFlights && !summary.operationalSummary && summary.role !== 'crew' && (
          <article className="dashboard-card wide">
            <div className="card-head">
              <h3>Today&apos;s flights</h3>
              <Link href="/flights" className="mini-link">
                Full schedule board
              </Link>
            </div>
            {summary.todaysFlights.length === 0 ? (
              <p className="dashboard-muted">No departures today.</p>
            ) : (
              <table className="dashboard-mini-table">
                <tbody>
                  {summary.todaysFlights.map((flight) => (
                    <tr key={flight.id}>
                      <td>{flight.flightNumber}</td>
                      <td>
                        {flight.dep} → {flight.arr}
                      </td>
                      <td>{safeTimeLabel(flight.departureTime)}</td>
                      <td>
                        <span className={`status ${statusClass(flight.status)}`}>{flight.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        )}

        {summary?.myFlights && summary.role === 'crew' && (
          <article className="dashboard-card wide">
            <div className="card-head">
              <h3>My assigned flights (today)</h3>
              <Link href="/notifications" className="mini-link">
                Alerts
              </Link>
            </div>
            {summary.myFlights.length === 0 ? (
              <p className="dashboard-muted">You have no rostered flights today.</p>
            ) : (
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Flight</th>
                    <th>Route</th>
                    <th>Report time</th>
                    <th>Status</th>
                    <th>Duty</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.myFlights.map((f) => (
                    <tr key={f.id}>
                      <td>{f.flight_number}</td>
                      <td>
                        {f.departure_airport} → {f.arrival_airport}
                      </td>
                      <td>{safeDateTimeLabel(f.departure_time)}</td>
                      <td>
                        <span className={`status ${statusClass(f.status)}`}>{f.status}</span>
                      </td>
                      <td>{f.duty_role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        )}

        {summary?.checkinStatus &&
          ['admin', 'super_admin', 'operations', 'agent', 'customer_service', 'sales_manager'].includes(
            summary.role as UserRole
          ) && (
          <article className="dashboard-card">
            <div className="card-head">
              <h3>Check-in status (today&apos;s legs)</h3>
              <Link href="/checkin" className="mini-link">
                Open check-in
              </Link>
            </div>
            <ul className="dashboard-metric-list">
              <li>
                <span>Passengers booked on today&apos;s departures</span>
                <strong>{summary.checkinStatus.passengersOnTodayFlights}</strong>
              </li>
              <li>
                <span>Checked in against those flights</span>
                <strong>{summary.checkinStatus.checkedInOnTodayFlights}</strong>
              </li>
              <li>
                <span>Outstanding</span>
                <strong>{summary.checkinStatus.outstanding}</strong>
              </li>
            </ul>
            <ClipboardList size={40} className="dashboard-watermark" aria-hidden />
          </article>
        )}

        {summary?.crewOverview &&
          summary.crewOverview.length > 0 &&
          ['admin', 'super_admin', 'operations'].includes(summary.role as UserRole) && (
          <article className="dashboard-card">
            <div className="card-head">
              <h3>Crew assignment overview</h3>
              <Link href="/crew" className="mini-link">
                Crew management
              </Link>
            </div>
            <table className="dashboard-mini-table">
              <tbody>
                {summary.crewOverview.map((r, idx) => (
                  <tr key={`${r.flightNumber}-${r.name}-${idx}`}>
                    <td>{r.flightNumber}</td>
                    <td>{r.name}</td>
                    <td>{r.duty}</td>
                    <td className="dashboard-td-muted">
                      {safeTimeLabel(r.departureTime)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        )}

        {summary?.financeSnapshot &&
          ['admin', 'super_admin', 'finance', 'sales_manager'].includes(summary.role as UserRole) && (
          <article className="dashboard-card">
            <div className="card-head">
              <h3>Finance snapshot (month-to-date)</h3>
              <Link href="/finance" className="mini-link">
                Accounting workspace
              </Link>
            </div>
            <ul className="dashboard-metric-list">
              <li>
                <span>Recognized payments (MTD)</span>
                <strong>{formatMoney(summary.financeSnapshot.revenueMonth)}</strong>
              </li>
              <li>
                <span>Refunds (MTD)</span>
                <strong>{formatMoney(summary.financeSnapshot.refundsMonth)}</strong>
              </li>
              <li>
                <span>Net (MTD)</span>
                <strong>{formatMoney(summary.financeSnapshot.netMonth)}</strong>
              </li>
              <li>
                <span>Bookings on financial hold</span>
                <strong>{formatMoney(summary.financeSnapshot.holdsOutstanding)}</strong>
              </li>
            </ul>
            <Link href="/add-expense" className="mini-link">
              Record operating expense
            </Link>
          </article>
        )}

        <article className="dashboard-card" id="alerts">
          <div className="card-head">
            <h3>Alerts & notifications</h3>
            <Link href="/notifications" className="mini-link">
              View all
            </Link>
          </div>
          {!summary?.alerts?.length ? (
            <p className="dashboard-muted">No active alerts for your scope.</p>
          ) : (
            <ul className="alerts-list">
              {summary.alerts.slice(0, 6).map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                  <div className="alerts-list-right">
                    {item.time && <small>{safeDateTimeLabel(item.time)}</small>}
                    <Link href={item.href} className="mini-link">
                      Open
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="dashboard-actions-bar">
        <h3>Module shortcuts</h3>
        <p className="dashboard-muted small">Each shortcut opens a live HAMS screen.</p>
        <div className="dashboard-quick-grid">
          {(summary?.quickLinks ?? []).map((action) => (
            <Link key={`${action.href}-${action.label}`} href={action.href}>
              {action.label}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
