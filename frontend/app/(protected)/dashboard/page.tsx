'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  BookOpen,
  Calendar,
  Clock,
  CreditCard,
  DollarSign,
  Headphones,
  Plane,
  Radar,
  RefreshCw,
  Scale,
  Shield,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet
} from 'lucide-react';
import { BRAND } from '@/lib/brand';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { UserRole } from '@/lib/roles';
import { roleDisplayName } from '@/lib/roles';
import { erpModuleTilesForRole } from '@/lib/dashboard-modules';
import { clearClientSession, hydrateSessionFromCookie } from '@/lib/auth-session';
import { apiFetchJson } from '@/lib/api-client';

const MIX_COLORS = ['#0047AB', '#0EA5E9', '#16A34A', '#F59E0B', '#8B5CF6', '#DB2777'];

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

type ExecutiveBoard = {
  kpis: {
    bookingsToday: number;
    revenueToday: number;
    activeFlights: number;
    loadFactorPct: number | null;
    checkInCompleted: number;
    delayedFlights: number;
    cancelledFlights: number;
    pendingPaymentsCount: number;
    pendingPaymentsAmount: number;
  };
  flightOperations: {
    departuresToday: number;
    arrivalsToday: number;
    aircraftInService: number;
    aircraftOnHold: number;
    crewReadinessPct: number | null;
    onTimePerformancePct: number | null;
    statusBreakdown: Record<string, number>;
  };
  salesInsight: {
    topRoutes: { route: string; bookings: number }[];
    agentSales: number;
    directSales: number;
    refundRequestsOpen: number;
    outstandingBalances: number;
  };
  customerService: {
    openCases: number;
    complaintsOpen: number;
    lostBaggageOpen: number;
    refundQueueOpen: number;
  };
  financeInsight: {
    dailyNetCash: number;
    revenueTrend7d: { date: string; amount: number }[];
    expenseMtd: number;
    profitMarginPct: number | null;
    revenueMtd: number;
    refundsMtd: number;
  };
  operationalAlertsExtra: {
    crewDocumentsExpiring: number;
    pendingPaymentsCount: number;
  };
  reportQuickLinks: { label: string; href: string }[];
};

type Summary = {
  role: UserRole;
  date: string;
  executive?: ExecutiveBoard | null;
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

function formatMoney(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

function formatMoney2(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}

function formatPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n}%`;
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

function statusTone(status: string) {
  const s = String(status || '').toUpperCase().replace(/\s+/g, '_');
  if (s.includes('DELAY')) return 'bg-amber-100 text-amber-900 ring-amber-200';
  if (s.includes('CANCEL')) return 'bg-red-100 text-red-800 ring-red-200';
  if (s.includes('DEPART') || s.includes('AIRBORNE') || s.includes('LAND')) return 'bg-emerald-100 text-emerald-900 ring-emerald-200';
  if (s.includes('BOARD')) return 'bg-sky-100 text-sky-900 ring-sky-200';
  return 'bg-slate-100 text-slate-800 ring-slate-200';
}

function alertBorder(sev: string) {
  if (sev === 'critical') return 'border-l-4 border-l-red-600 bg-red-50/80';
  if (sev === 'warning') return 'border-l-4 border-l-amber-500 bg-amber-50/70';
  return 'border-l-4 border-l-sky-500 bg-sky-50/70';
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
      const data = await apiFetchJson<Summary>('/api/dashboard/summary', {
        headers: { Authorization: `Bearer ${token}` },
        endpointTag: 'dashboard.summary'
      });
      setSummary(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load dashboard.');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const ex = summary?.executive;

  const chart7d = useMemo(() => {
    const series =
      ex?.financeInsight?.revenueTrend7d?.length && ex.financeInsight.revenueTrend7d.some((r) => r.amount > 0)
        ? ex.financeInsight.revenueTrend7d
        : summary?.bookingRevenue?.series7d ?? [];
    if (!summary?.date) return [];
    return normalizeSeries7d(series, summary.date);
  }, [summary, ex]);

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
  const canFinance = moduleRole && ['admin', 'super_admin', 'finance', 'sales_manager'].includes(moduleRole as UserRole);
  const canOps = moduleRole && ['admin', 'super_admin', 'operations', 'maintenance'].includes(moduleRole as UserRole);
  const canCs = moduleRole && ['admin', 'super_admin', 'customer_service', 'sales_manager', 'agent'].includes(moduleRole as UserRole);

  const execCards = ex
    ? [
        { label: 'Bookings today', value: String(ex.kpis.bookingsToday), sub: 'New PNRs created', icon: BookOpen, href: '/bookings' },
        { label: 'Revenue today', value: formatMoney2(ex.kpis.revenueToday), sub: 'Posted payments', icon: DollarSign, href: '/finance' },
        { label: 'Active flights', value: String(ex.kpis.activeFlights), sub: 'Non-cancelled departures', icon: Plane, href: '/flights' },
        {
          label: 'Network load factor',
          value: ex.kpis.loadFactorPct != null ? `${ex.kpis.loadFactorPct}%` : '—',
          sub: 'Issued seats / capacity (today)',
          icon: TrendingUp,
          href: '/sales'
        },
        {
          label: 'Check-in completed',
          value: String(ex.kpis.checkInCompleted),
          sub: "Today's departing legs",
          icon: Users,
          href: '/checkin'
        },
        { label: 'Delayed flights', value: String(ex.kpis.delayedFlights), sub: 'Departures today', icon: Clock, href: '/operations' },
        { label: 'Cancelled flights', value: String(ex.kpis.cancelledFlights), sub: 'Departures today', icon: Ban, href: '/operations' },
        {
          label: 'Pending payments',
          value: String(ex.kpis.pendingPaymentsCount),
          sub: formatMoney2(ex.kpis.pendingPaymentsAmount),
          icon: CreditCard,
          href: '/finance'
        }
      ]
    : [];

  return (
    <main className="min-h-dvh min-w-0 overflow-x-hidden bg-gradient-to-b from-slate-100 via-slate-50 to-slate-100 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-12">
      <div className="mx-auto max-w-[1600px] min-w-0 px-3 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pt-6 lg:px-8">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-hawana-blue">{BRAND.companyName}</p>
            <h1 className="mt-1 text-balance text-lg font-bold tracking-tight text-slate-900 sm:text-3xl">Executive command center</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Live operational, commercial, and financial snapshot for <strong>{roleTitle}</strong>. Data sourced from
              HAMS core services — refresh for latest counters.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
              <Calendar className="h-3.5 w-3.5 text-hawana-blue" aria-hidden />
              {summary?.date
                ? new Date(`${summary.date}T12:00:00Z`).toLocaleDateString('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })
                : '—'}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-hawana-blue/40 hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Refresh
            </button>
            <Link
              href="/reports"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-hawana-blue to-hawana-navy px-3 py-2 text-sm font-semibold text-white shadow-md transition hover:brightness-105"
            >
              Reports <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </header>

        {loadError && (
          <div
            role="alert"
            className="mb-6 flex gap-3 rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-900"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div className="flex-1">
              <p className="font-semibold">Unable to load dashboard</p>
              <p className="text-red-800/90">{loadError}</p>
              <button type="button" className="mt-2 text-sm font-semibold text-red-900 underline" onClick={() => void load()}>
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Executive KPI strip */}
        {execCards.length > 0 && (
          <section className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Executive KPIs">
            {execCards.map((c) => {
              const Icon = c.icon;
              return (
                <Link
                  key={c.label}
                  href={c.href}
                  className="group flex flex-col rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/5 transition hover:-translate-y-0.5 hover:border-hawana-blue/30 hover:shadow-md"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="rounded-lg bg-slate-100 p-2 text-hawana-blue transition group-hover:bg-hawana-blue/10">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-slate-300 transition group-hover:text-hawana-blue" aria-hidden />
                  </div>
                  <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">{c.label}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{c.value}</p>
                  <p className="mt-0.5 text-[0.7rem] leading-snug text-slate-500">{c.sub}</p>
                </Link>
              );
            })}
          </section>
        )}

        <div className="grid gap-6 xl:grid-cols-12">
          {/* Flight operations */}
          <section className="xl:col-span-7">
            <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-balance text-base font-bold text-slate-900 sm:text-lg">
                    <Radar className="h-5 w-5 shrink-0 text-hawana-blue" aria-hidden />
                    Flight Operations
                  </h2>
                  <p className="text-sm text-slate-500">Departures, arrivals, punctuality, and fleet posture (today).</p>
                </div>
                {canOps && (
                  <Link href="/operations" className="text-sm font-semibold text-hawana-blue hover:underline">
                    Flight Operations →
                  </Link>
                )}
              </div>
              {ex ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    { label: 'Departures', value: ex.flightOperations.departuresToday, tone: 'text-slate-900' },
                    { label: 'Arrivals', value: ex.flightOperations.arrivalsToday, tone: 'text-slate-900' },
                    { label: 'Aircraft on hold', value: ex.flightOperations.aircraftOnHold, tone: 'text-amber-800' },
                    {
                      label: 'Crew roster coverage',
                      value: formatPct(ex.flightOperations.crewReadinessPct),
                      tone: 'text-slate-900'
                    },
                    {
                      label: 'On-time performance',
                      value: formatPct(ex.flightOperations.onTimePerformancePct),
                      tone: 'text-emerald-800'
                    },
                    { label: 'Active departures', value: ex.flightOperations.aircraftInService, tone: 'text-slate-900' }
                  ].map((m) => (
                    <div key={m.label} className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{m.label}</p>
                      <p className={`mt-1 text-2xl font-bold tabular-nums ${m.tone}`}>{m.value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Loading operations metrics…</p>
              )}

              {summary?.todaysFlights && summary.todaysFlights.length > 0 && (
                <div className="mt-6 overflow-x-auto rounded-xl border border-slate-100">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Flight</th>
                        <th className="px-3 py-2">Route</th>
                        <th className="px-3 py-2">STD</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {summary.todaysFlights.slice(0, 8).map((f) => (
                        <tr key={f.id} className="bg-white hover:bg-slate-50/80">
                          <td className="px-3 py-2 font-semibold text-slate-900">{f.flightNumber}</td>
                          <td className="px-3 py-2 text-slate-600">
                            {f.dep} → {f.arr}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{safeTimeLabel(f.departureTime)}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${statusTone(f.status)}`}>
                              {f.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Charts row */}
            {(canFinance || chart7d.some((d) => d.amount > 0)) && (
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/5 sm:p-5">
                  <h3 className="text-sm font-bold text-slate-900">Revenue trend (7 days)</h3>
                  <p className="text-xs text-slate-500">Posted payment totals by day</p>
                  <div className="mt-3 h-44 w-full min-w-0 overflow-hidden sm:h-56">
                    {chart7d.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chart7d}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                          <YAxis
                            tick={{ fontSize: 10 }}
                            stroke="#94a3b8"
                            tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`}
                          />
                          <Tooltip formatter={(v) => formatMoney(Number(v))} />
                          <Line type="monotone" dataKey="amount" stroke="#0047AB" strokeWidth={2.5} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="flex h-full items-center justify-center text-sm text-slate-400">No revenue data in window.</p>
                    )}
                  </div>
                </div>
                {mixData.length > 0 && canFinance && (
                  <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/5 sm:p-5">
                    <h3 className="text-sm font-bold text-slate-900">Payment mix (7 days)</h3>
                    <div className="mt-2 h-44 w-full min-w-0 overflow-hidden sm:h-52">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={mixData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={2}>
                            {mixData.map((entry) => (
                              <Cell key={entry.key} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v) => formatMoney(Number(v))} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="mt-2 grid gap-1 text-xs text-slate-600">
                      {mixData.map((e) => (
                        <li key={e.key} className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: e.color }} />
                          {e.name} — {formatMoney(e.value)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Right column: sales, CS, finance, alerts */}
          <aside className="flex flex-col gap-6 xl:col-span-5">
            {ex && (
              <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
                <h2 className="flex items-center gap-2 text-balance text-base font-bold text-slate-900 sm:text-lg">
                  <ShoppingCart className="h-5 w-5 shrink-0 text-hawana-blue" aria-hidden />
                  Commercial & sales
                </h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-medium text-slate-500">Direct (today)</p>
                    <p className="text-lg font-bold text-slate-900">{formatMoney2(ex.salesInsight.directSales)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-medium text-slate-500">Agents (today)</p>
                    <p className="text-lg font-bold text-slate-900">{formatMoney2(ex.salesInsight.agentSales)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-medium text-slate-500">Refund requests (open)</p>
                    <p className="text-lg font-bold text-amber-800">{ex.salesInsight.refundRequestsOpen}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-medium text-slate-500">Booking holds (value)</p>
                    <p className="text-lg font-bold text-slate-900">{formatMoney2(ex.salesInsight.outstandingBalances)}</p>
                  </div>
                </div>
                <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-slate-500">Top routes (14d)</h3>
                <div className="mt-2 h-36 w-full min-w-0 overflow-hidden sm:h-40">
                  {ex.salesInsight.topRoutes.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={ex.salesInsight.topRoutes} layout="vertical" margin={{ left: 4, right: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="route" width={88} tick={{ fontSize: 10 }} stroke="#64748b" />
                        <Tooltip />
                        <Bar dataKey="bookings" fill="#0047AB" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-xs text-slate-400">No route concentration in the last 14 days.</p>
                  )}
                </div>
                <Link href="/sales" className="mt-3 inline-block text-sm font-semibold text-hawana-blue hover:underline">
                  Sales workspace →
                </Link>
              </div>
            )}

            {ex && canCs && (
              <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
                <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                  <Headphones className="h-5 w-5 text-hawana-blue" aria-hidden />
                  Customer service
                </h2>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">Open cases</p>
                    <p className="text-xl font-bold text-slate-900">{ex.customerService.openCases}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">Complaints</p>
                    <p className="text-xl font-bold text-amber-900">{ex.customerService.complaintsOpen}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">Lost baggage</p>
                    <p className="text-xl font-bold text-red-800">{ex.customerService.lostBaggageOpen}</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">Refund queue</p>
                    <p className="text-xl font-bold text-slate-900">{ex.customerService.refundQueueOpen}</p>
                  </div>
                </div>
                <Link href="/customer-service" className="mt-3 inline-block text-sm font-semibold text-hawana-blue hover:underline">
                  Service desk →
                </Link>
              </div>
            )}

            {ex && canFinance && (
              <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
                <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                  <Wallet className="h-5 w-5 text-hawana-blue" aria-hidden />
                  Financial pulse
                </h2>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-slate-600">Daily net cash</span>
                    <span className="font-bold text-slate-900">{formatMoney2(ex.financeInsight.dailyNetCash)}</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-slate-600">Expenses MTD</span>
                    <span className="font-bold text-slate-900">{formatMoney2(ex.financeInsight.expenseMtd)}</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-slate-600">Profit margin (MTD est.)</span>
                    <span className="font-bold text-emerald-800">{formatPct(ex.financeInsight.profitMarginPct)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Revenue MTD</span>
                    <span>{formatMoney2(ex.financeInsight.revenueMtd)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Refunds MTD</span>
                    <span>{formatMoney2(ex.financeInsight.refundsMtd)}</span>
                  </div>
                </div>
                <Link href="/finance" className="mt-3 inline-block text-sm font-semibold text-hawana-blue hover:underline">
                  Finance & accounting →
                </Link>
              </div>
            )}

            {/* Alerts */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <Shield className="h-5 w-5 text-hawana-blue" aria-hidden />
                Operational alerts
              </h2>
              <p className="text-xs text-slate-500">Delays, maintenance, fleet holds, payments, and compliance signals.</p>
              <ul className="mt-3 space-y-2">
                {!summary?.alerts?.length ? (
                  <li className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-4 text-sm text-slate-500">No active alerts.</li>
                ) : (
                  summary.alerts.slice(0, 8).map((item) => (
                    <li key={item.id} className={`rounded-xl px-3 py-2.5 text-sm ${alertBorder(item.severity)}`}>
                      <div className="flex justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-900">{item.title}</p>
                          <p className="text-slate-700">{item.detail}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          {item.time && <p className="text-xs text-slate-500">{safeDateTimeLabel(item.time)}</p>}
                          <Link href={item.href} className="text-xs font-semibold text-hawana-blue hover:underline">
                            Open
                          </Link>
                        </div>
                      </div>
                    </li>
                  ))
                )}
              </ul>
              {ex?.operationalAlertsExtra?.crewDocumentsExpiring ? (
                <p className="mt-3 text-xs text-amber-800">
                  <strong>Crew documents:</strong> {ex.operationalAlertsExtra.crewDocumentsExpiring} license(s) in review
                  window — see <Link href="/crew" className="font-semibold underline">crew</Link>.
                </p>
              ) : null}
            </div>

            {/* Report quick access */}
            {ex?.reportQuickLinks?.length ? (
              <div className="rounded-2xl border border-dashed border-hawana-blue/25 bg-hawana-blue/[0.04] p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-hawana-navy">
                  <Scale className="h-4 w-4" aria-hidden />
                  Reports quick access
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {ex.reportQuickLinks.map((r) => (
                    <Link
                      key={r.href + r.label}
                      href={r.href}
                      className="rounded-lg border border-white/60 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:border-hawana-blue/40 hover:text-hawana-blue"
                    >
                      {r.label}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </div>

        {/* Check-in + crew row */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {summary?.checkinStatus && (
            <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
              <h3 className="font-bold text-slate-900">Check-in (today&apos;s legs)</h3>
              <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-slate-50 py-3">
                  <p className="text-xs text-slate-500">Booked pax</p>
                  <p className="text-xl font-bold">{summary.checkinStatus.passengersOnTodayFlights}</p>
                </div>
                <div className="rounded-xl bg-emerald-50 py-3">
                  <p className="text-xs text-emerald-800">Checked in</p>
                  <p className="text-xl font-bold text-emerald-900">{summary.checkinStatus.checkedInOnTodayFlights}</p>
                </div>
                <div className="rounded-xl bg-amber-50 py-3">
                  <p className="text-xs text-amber-800">Outstanding</p>
                  <p className="text-xl font-bold text-amber-900">{summary.checkinStatus.outstanding}</p>
                </div>
              </div>
              <Link href="/checkin" className="mt-3 inline-block text-sm font-semibold text-hawana-blue hover:underline">
                Open check-in →
              </Link>
            </div>
          )}
          {summary?.crewOverview && summary.crewOverview.length > 0 && canOps && (
            <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
              <h3 className="font-bold text-slate-900">Crew on today&apos;s departures</h3>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
                {summary.crewOverview.slice(0, 10).map((r, i) => (
                  <li key={`${r.flightNumber}-${r.name}-${i}`} className="flex justify-between border-b border-slate-100 py-1.5">
                    <span className="font-medium text-slate-800">{r.flightNumber}</span>
                    <span className="text-slate-600">{r.name}</span>
                    <span className="text-xs text-slate-500">{r.duty}</span>
                  </li>
                ))}
              </ul>
              <Link href="/crew" className="mt-2 inline-block text-sm font-semibold text-hawana-blue hover:underline">
                Crew management →
              </Link>
            </div>
          )}
        </div>

        {/* Crew personal */}
            {summary?.myFlights && summary.role === 'crew' && (
          <div className="mt-6 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="font-bold text-slate-900">My flights today</h3>
            {summary.myFlights.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No rostered flights.</p>
            ) : (
              <div className="hams-table-wrap mt-3">
              <table className="w-full min-w-[28rem] text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-1">Flight</th>
                    <th>Route</th>
                    <th>Time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.myFlights.map((f) => (
                    <tr key={f.id} className="border-t border-slate-100">
                      <td className="py-2 font-medium">{f.flight_number}</td>
                      <td>
                        {f.departure_airport} → {f.arrival_airport}
                      </td>
                      <td>{safeDateTimeLabel(f.departure_time)}</td>
                      <td>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${statusTone(f.status)}`}>
                          {f.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )}

        {/* Legacy role KPIs (compact) */}
        {summary?.kpis && summary.kpis.length > 0 && (
          <section className="mt-8 rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-800">Role snapshot</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {summary.kpis.map((k) => (
                <Link
                  key={k.id}
                  href={k.href}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm transition hover:border-hawana-blue/30"
                >
                  <span className="text-slate-500">{k.label}: </span>
                  <strong className="text-slate-900">
                    {k.format === 'money' ? formatMoney(k.value) : String(k.value)}
                  </strong>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Module tiles */}
        {erpTiles.length > 0 && (
          <section className="mt-8">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">HAMS modules</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {erpTiles.map((m) => (
                <Link
                  key={m.id}
                  href={m.href}
                  className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm transition hover:border-hawana-blue/30 hover:shadow-md"
                >
                  <p className="font-semibold text-slate-900">{m.title}</p>
                  <p className="mt-1 text-xs text-slate-600">{m.description}</p>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-hawana-blue">
                    Open <ArrowUpRight className="h-3 w-3" />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Quick links bar */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-900 p-5 text-slate-100">
          <h3 className="text-sm font-bold uppercase tracking-wide text-hawana-gold">Shortcuts</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {(summary?.quickLinks ?? []).map((a) => (
              <Link
                key={a.href + a.label}
                href={a.href}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white ring-1 ring-white/20 transition hover:bg-white/20"
              >
                {a.label}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
