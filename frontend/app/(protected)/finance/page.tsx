'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import type { UserRole } from '@/lib/roles';
import { getPublicApiBaseUrl } from '@/lib/api-base';
import { getClientAuthToken } from '@/lib/auth-session';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import './finance-erp.css';

const API_BASE_URL = getPublicApiBaseUrl();

const EXPENSE_CATEGORIES = [
  'FUEL',
  'ACMI_LEASE',
  'AIRPORT_FEES',
  'GROUND_HANDLING',
  'CREW',
  'MAINTENANCE',
  'CATERING',
  'OFFICE_ADMIN',
  'OTHER'
] as const;

const CHART_COLORS = ['#0047AB', '#0d9488', '#ea580c', '#7c3aed', '#db2777', '#64748b'];

type Tab = 'overview' | 'payments' | 'refunds' | 'expenses' | 'treasury' | 'reports';

function getToken() {
  return getClientAuthToken();
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

function canManageRefunds(role: UserRole | null) {
  return role && ['admin', 'super_admin', 'finance'].includes(role);
}

function canRecordExpenses(role: UserRole | null) {
  return role && ['admin', 'super_admin', 'finance'].includes(role);
}

function canSeeOrgReports(role: UserRole | null) {
  return role && ['admin', 'super_admin', 'finance', 'sales_manager'].includes(role);
}

export default function FinancePage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [tab, setTab] = useState<Tab>('overview');
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(false);

  const [dash, setDash] = useState<Record<string, unknown> | null>(null);
  const [dashError, setDashError] = useState('');
  const [payDate, setPayDate] = useState(today);
  const [payStatus, setPayStatus] = useState('');
  const [payments, setPayments] = useState<Array<Record<string, unknown>>>([]);
  const [daily, setDaily] = useState<{ totals?: Record<string, number> } | null>(null);

  const [refundReqs, setRefundReqs] = useState<Array<Record<string, unknown>>>([]);
  const [rqPaymentId, setRqPaymentId] = useState('');
  const [rqAmount, setRqAmount] = useState('');
  const [rqReason, setRqReason] = useState('');

  const [expFrom, setExpFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [expTo, setExpTo] = useState(today);
  const [expenses, setExpenses] = useState<Array<Record<string, unknown>>>([]);
  const [expForm, setExpForm] = useState({
    category: 'FUEL',
    amount: '',
    incurredOn: today,
    description: '',
    reference: '',
    flightId: ''
  });

  const [repFrom, setRepFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  });
  const [repTo, setRepTo] = useState(today);
  const [outstanding, setOutstanding] = useState<Array<Record<string, unknown>>>([]);
  const [routeRev, setRouteRev] = useState<Array<Record<string, unknown>>>([]);
  const [dailyRev, setDailyRev] = useState<Array<Record<string, unknown>>>([]);
  const [recon, setRecon] = useState<Record<string, unknown> | null>(null);
  const [flightProfit, setFlightProfit] = useState<Array<Record<string, unknown>>>([]);
  const [agentSales, setAgentSales] = useState<Array<Record<string, unknown>>>([]);
  const [cashRep, setCashRep] = useState<{ paymentsByDay?: unknown[]; refundsByDay?: unknown[] } | null>(null);
  const [ticketRev, setTicketRev] = useState<Array<Record<string, unknown>>>([]);
  const [reconDetail, setReconDetail] = useState<Record<string, unknown> | null>(null);
  const [routeProfit, setRouteProfit] = useState<Array<Record<string, unknown>>>([]);
  const [expTrend, setExpTrend] = useState<Array<Record<string, unknown>>>([]);
  const [cashSummary, setCashSummary] = useState<Record<string, unknown> | null>(null);
  const [monthlyPnl, setMonthlyPnl] = useState<Record<string, unknown> | null>(null);
  const [cashRunway, setCashRunway] = useState<Record<string, unknown> | null>(null);
  const [arList, setArList] = useState<Array<Record<string, unknown>>>([]);
  const [apList, setApList] = useState<Array<Record<string, unknown>>>([]);
  const [agentLedger, setAgentLedger] = useState<Array<Record<string, unknown>>>([]);
  const [repFlightId, setRepFlightId] = useState('');
  const [repRouteFilter, setRepRouteFilter] = useState('');
  const [pnlMonth, setPnlMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [runwayCash, setRunwayCash] = useState('250000');
  const [refundAudit, setRefundAudit] = useState<Record<string, unknown> | null>(null);
  const [viVendor, setViVendor] = useState('');
  const [viAmount, setViAmount] = useState('');
  const [viDue, setViDue] = useState(today);
  const [viCat, setViCat] = useState('AIRPORT_FEES');
  const [depAmount, setDepAmount] = useState('');
  const [depDate, setDepDate] = useState(today);

  const fetchJson = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const token = getToken();
    if (!token) throw new Error('Please login first from /login.');
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });
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

  const loadDashboard = useCallback(async () => {
    setDashError('');
    try {
      const d = await fetchJson<{ cards: Record<string, number>; scope?: string }>('/api/finance/dashboard');
      setDash(d as unknown as Record<string, unknown>);
    } catch (e) {
      setDash(null);
      const msg = (e as Error).message;
      setDashError(msg);
      toast.error(msg);
    }
  }, [fetchJson]);

  const loadPaymentsBlock = useCallback(async () => {
    const q = new URLSearchParams({ date: payDate });
    if (payStatus) q.set('status', payStatus);
    const [p, r] = await Promise.all([
      fetchJson<{ payments: Array<Record<string, unknown>> }>(`/api/finance/payments?${q}`),
      fetchJson<{ totals: Record<string, number> }>(`/api/finance/reports/daily?date=${payDate}`)
    ]);
    setPayments(p.payments || []);
    setDaily(r);
  }, [fetchJson, payDate, payStatus]);

  const loadRefundRequests = useCallback(async () => {
    const d = await fetchJson<{ refundRequests: Array<Record<string, unknown>> }>('/api/finance/refund-requests');
    setRefundReqs(d.refundRequests || []);
  }, [fetchJson]);

  const loadExpenses = useCallback(async () => {
    const d = await fetchJson<{ expenses: Array<Record<string, unknown>> }>(
      `/api/finance/expenses?from=${expFrom}&to=${expTo}`
    );
    setExpenses(d.expenses || []);
  }, [fetchJson, expFrom, expTo]);

  useEffect(() => {
    if (tab === 'overview') {
      setLoading(true);
      void loadDashboard().finally(() => setLoading(false));
    }
  }, [tab, loadDashboard]);

  useEffect(() => {
    if (tab !== 'overview' || !canSeeOrgReports(role)) return;
    let cancel = false;
    void (async () => {
      try {
        const [dr, et] = await Promise.all([
          fetchJson<{ series: unknown[] }>(`/api/finance/reports/daily-revenue?from=${repFrom}&to=${repTo}`),
          fetchJson<{ series: unknown[] }>(`/api/finance/reports/expense-trend?from=${repFrom}&to=${repTo}`).catch(() => ({
            series: []
          }))
        ]);
        if (cancel) return;
        setDailyRev((dr.series || []) as Array<Record<string, unknown>>);
        setExpTrend((et.series || []) as Array<Record<string, unknown>>);
      } catch {
        /* charts optional */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [tab, repFrom, repTo, role, fetchJson]);

  useEffect(() => {
    if (tab === 'payments') {
      setLoading(true);
      void loadPaymentsBlock()
        .catch((e: Error) => toast.error(e.message))
        .finally(() => setLoading(false));
    }
  }, [tab, loadPaymentsBlock]);

  useEffect(() => {
    if (tab === 'refunds') {
      setLoading(true);
      void loadRefundRequests()
        .catch((e: Error) => toast.error(e.message))
        .finally(() => setLoading(false));
    }
  }, [tab, loadRefundRequests]);

  useEffect(() => {
    if (tab === 'expenses' && canRecordExpenses(role)) {
      setLoading(true);
      void loadExpenses()
        .catch((e: Error) => toast.error(e.message))
        .finally(() => setLoading(false));
    }
  }, [tab, expFrom, expTo, role, loadExpenses]);

  async function downloadPaymentsCsv() {
    const token = getToken();
    if (!token) return toast.error('Login required.');
    const q = new URLSearchParams({ date: payDate, export: 'csv' });
    if (payStatus) q.set('status', payStatus);
    const res = await fetch(`${API_BASE_URL}/api/finance/payments?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    if (!res.ok) {
      toast.error('Export failed.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payments-${payDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Download started.');
  }

  async function submitRefundRequest(e: FormEvent) {
    e.preventDefault();
    try {
      await fetchJson('/api/finance/refund-requests', {
        method: 'POST',
        body: JSON.stringify({
          paymentId: rqPaymentId,
          refundAmount: Number(rqAmount),
          reason: rqReason || undefined
        })
      });
      toast.success('Refund request submitted for approval.');
      setRqAmount('');
      setRqReason('');
      await loadRefundRequests();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function approveRequest(id: string) {
    try {
      await fetchJson(`/api/finance/refund-requests/${id}/approve`, { method: 'POST', body: JSON.stringify({}) });
      toast.success('Refund approved.');
      await loadRefundRequests();
      await loadDashboard();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function rejectRequest(id: string) {
    const reason = window.prompt('Rejection reason (optional):') ?? '';
    try {
      await fetchJson(`/api/finance/refund-requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      toast.success('Request rejected.');
      await loadRefundRequests();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function submitExpense(e: FormEvent) {
    e.preventDefault();
    try {
      await fetchJson('/api/finance/expenses', {
        method: 'POST',
        body: JSON.stringify({
          category: expForm.category,
          amount: Number(expForm.amount),
          incurredOn: expForm.incurredOn,
          description: expForm.description || undefined,
          reference: expForm.reference || undefined,
          flightId: expForm.flightId || undefined
        })
      });
      toast.success('Expense recorded.');
      setExpForm((f) => ({ ...f, amount: '', description: '', reference: '', flightId: '' }));
      await loadExpenses();
      await loadDashboard();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function loadReportsPack() {
    if (!canSeeOrgReports(role) && role !== 'agent') return;
    setLoading(true);
    try {
      const fpQ =
        repFlightId.trim().length >= 36
          ? `flightId=${encodeURIComponent(repFlightId.trim())}`
          : repRouteFilter.trim()
            ? `route=${encodeURIComponent(repRouteFilter.trim())}`
            : '';
      const [o, rr, dr, cs, tr, ag] = await Promise.all([
        fetchJson<{ bookings: unknown[] }>(`/api/finance/reports/outstanding-balances`).catch(() => ({ bookings: [] })),
        fetchJson<{ routes: unknown[] }>(`/api/finance/reports/route-revenue?from=${repFrom}&to=${repTo}`).catch(() => ({
          routes: []
        })),
        fetchJson<{ series: unknown[] }>(`/api/finance/reports/daily-revenue?from=${repFrom}&to=${repTo}`).catch(() => ({
          series: []
        })),
        fetchJson<{ paymentsByDay: unknown[]; refundsByDay: unknown[] }>(
          `/api/finance/reports/cash?from=${repFrom}&to=${repTo}`
        ).catch(() => ({ paymentsByDay: [], refundsByDay: [] })),
        fetchJson<{ byDay: unknown[] }>(`/api/finance/reports/ticket-revenue?from=${repFrom}&to=${repTo}`).catch(() => ({
          byDay: []
        })),
        fetchJson<{ agentSales: unknown[] }>(`/api/finance/reports/agent-sales?from=${repFrom}&to=${repTo}`).catch(() => ({
          agentSales: []
        }))
      ]);
      setOutstanding((o.bookings || []) as Array<Record<string, unknown>>);
      setRouteRev((rr.routes || []) as Array<Record<string, unknown>>);
      setDailyRev((dr.series || []) as Array<Record<string, unknown>>);
      setCashRep(cs as { paymentsByDay?: unknown[]; refundsByDay?: unknown[] });
      setTicketRev((tr.byDay || []) as Array<Record<string, unknown>>);
      setAgentSales((ag.agentSales || []) as Array<Record<string, unknown>>);

      if (canSeeOrgReports(role)) {
        const fpPath = `/api/finance/reports/flight-profitability?from=${repFrom}&to=${repTo}${fpQ ? `&${fpQ}` : ''}`;
        const [
          rc,
          fp,
          rd,
          rp,
          et,
          csum,
          pnl,
          run,
          ar,
          ap,
          al
        ] = await Promise.all([
          fetchJson<Record<string, unknown>>(`/api/finance/reports/sales-reconciliation?from=${repFrom}&to=${repTo}`),
          fetchJson<{ flights: unknown[] }>(fpPath).catch(() => ({ flights: [] })),
          fetchJson<Record<string, unknown>>(
            `/api/finance/reports/reconciliation-detail?from=${repFrom}&to=${repTo}`
          ).catch(() => ({})),
          fetchJson<{ routes: unknown[] }>(
            `/api/finance/reports/route-profitability?from=${repFrom}&to=${repTo}`
          ).catch(() => ({ routes: [] })),
          fetchJson<{ series: unknown[] }>(
            `/api/finance/reports/expense-trend?from=${repFrom}&to=${repTo}`
          ).catch(() => ({ series: [] })),
          fetchJson<Record<string, unknown>>(
            `/api/finance/reports/cash-summary?from=${repFrom}&to=${repTo}`
          ).catch(() => ({})),
          fetchJson<Record<string, unknown>>(
            `/api/finance/reports/monthly-pnl?month=${pnlMonth}-01`
          ).catch(() => ({})),
          fetchJson<Record<string, unknown>>(
            `/api/finance/reports/cash-runway?from=${repFrom}&to=${repTo}&cashOnHand=${encodeURIComponent(runwayCash || '0')}`
          ).catch(() => ({})),
          fetchJson<{ receivables: unknown[] }>(`/api/finance/accounts-receivable`).catch(() => ({ receivables: [] })),
          fetchJson<{ payables: unknown[] }>(`/api/finance/accounts-payable`).catch(() => ({ payables: [] })),
          fetchJson<{ agents: unknown[] }>(
            `/api/finance/reports/agent-ledger?from=${repFrom}&to=${repTo}`
          ).catch(() => ({ agents: [] }))
        ]);
        setRecon(rc);
        setFlightProfit((fp.flights || []) as Array<Record<string, unknown>>);
        setReconDetail(rd);
        setRouteProfit((rp.routes || []) as Array<Record<string, unknown>>);
        setExpTrend((et.series || []) as Array<Record<string, unknown>>);
        setCashSummary(csum);
        setMonthlyPnl(pnl);
        setCashRunway(run);
        setArList((ar.receivables || []) as Array<Record<string, unknown>>);
        setApList((ap.payables || []) as Array<Record<string, unknown>>);
        setAgentLedger((al.agents || []) as Array<Record<string, unknown>>);
      } else {
        setRecon(null);
        setFlightProfit([]);
        setReconDetail(null);
        setRouteProfit([]);
        setExpTrend([]);
        setCashSummary(null);
        setMonthlyPnl(null);
        setCashRunway(null);
        setArList([]);
        setApList([]);
        setAgentLedger([]);
      }
      toast.success('Reports refreshed.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const cards = (dash?.cards as Record<string, number> | undefined) || undefined;
  const kpis = dash?.kpis as Record<string, number> | null | undefined;
  const scope = dash?.scope as string | undefined;

  const revenueTrendData = useMemo(() => {
    return dailyRev.map((row) => ({
      day: String((row as { day: string }).day).slice(5),
      revenue: Number((row as { net_collected: string }).net_collected)
    }));
  }, [dailyRev]);

  const { expenseStackData, expenseBarKeys } = useMemo(() => {
    const byDay: Record<string, Record<string, number>> = {};
    const cats = new Set<string>();
    for (const row of expTrend) {
      const d = String((row as { day: string }).day);
      const cat = String((row as { category: string }).category);
      const t = Number((row as { total: string }).total);
      if (!byDay[d]) byDay[d] = {};
      byDay[d][cat] = (byDay[d][cat] || 0) + t;
      cats.add(cat);
    }
    const keys = Array.from(cats).slice(0, 8);
    const rows = Object.keys(byDay)
      .sort()
      .map((day) => ({ day: day.slice(5), ...byDay[day] }));
    return { expenseStackData: rows, expenseBarKeys: keys };
  }, [expTrend]);

  const channelPieData = useMemo(() => {
    const ch = reconDetail?.paymentChannels as Array<{ channel: string; net_collected: string }> | undefined;
    if (!ch?.length) return [];
    return ch.slice(0, 8).map((c) => ({
      name: String(c.channel),
      value: Math.round(Number(c.net_collected))
    }));
  }, [reconDetail]);

  return (
    <main className="module-page finance-erp">
      <section className="module-card finance-erp-shell">
        <h1>Finance &amp; accounting</h1>
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>
          Sales reconciliation, revenue, refund approvals, expenses, cash and agent reports, outstanding balances, and
          flight-level margin. Ticket issuance requires a fully paid booking; refunds require finance approval and every
          money movement is written to the finance ledger.
        </p>
        {scope ? (
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#0369a1' }}>
            Data scope: <strong>{scope === 'agent_own_sales' ? 'Your sales only' : 'Organization'}</strong>
          </p>
        ) : null}
      </section>

      <div className="finance-tabs finance-erp-shell">
        {(['overview', 'payments', 'refunds', 'expenses', 'treasury', 'reports'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? '' : 'secondary'}
            onClick={() => setTab(t)}
            disabled={
              (t === 'expenses' && role !== null && !canRecordExpenses(role)) ||
              (t === 'treasury' && role !== null && !canSeeOrgReports(role))
            }
          >
            {t === 'overview'
              ? 'Dashboard'
              : t === 'treasury'
                ? 'Treasury (AR/AP)'
                : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <section className="module-card finance-erp-shell">
          <h2>Finance control tower</h2>
          {dashError ? (
            <p style={{ margin: '0 0 0.5rem', color: '#b91c1c', fontSize: '0.9rem' }} role="alert">
              {dashError}
            </p>
          ) : null}
          {loading && !cards ? (
            <p style={{ margin: 0, color: '#64748b' }}>Loading…</p>
          ) : null}
          {kpis && canSeeOrgReports(role) ? (
            <div className="finance-kpi-grid" style={{ marginBottom: '0.75rem' }}>
              {[
                ['Revenue today', kpis.revenueToday],
                ['Revenue MTD (net collected)', kpis.revenueMTD],
                ['Refunds today', kpis.refundsToday],
                ['Refunds MTD', kpis.refundsMTD],
                ['Outstanding bookings (#)', kpis.outstandingBookings],
                ['Outstanding bookings ($)', kpis.outstandingBookingsAmount],
                ['Agent desk exposure (unpaid)', kpis.outstandingAgentBalances],
                ['Expenses MTD', kpis.expensesMTD],
                ['AP open (vendor)', kpis.accountsPayableOpen],
                ['Net cash MTD', kpis.netCashMTD],
                ['Gross margin %', kpis.grossMarginPct != null ? (Number(kpis.grossMarginPct) * 100).toFixed(1) : '—']
              ].map(([label, val]) => (
                <div key={String(label)} className="finance-kpi-card">
                  <h4>{label}</h4>
                  <p className="val">{typeof val === 'number' && Number.isFinite(val) ? val.toFixed(2) : String(val ?? '—')}</p>
                </div>
              ))}
            </div>
          ) : null}
          {cards ? (
            <div className="finance-kpi-grid">
              {[
                ['Net payments − refunds (today)', cards.netPaymentsToday],
                ['Refunds (today)', cards.refundsToday],
                ['Outstanding bookings', cards.outstandingBookings],
                ['Outstanding gross (PNR)', cards.outstandingGrossAmount],
                ['Pending refund requests', cards.pendingRefundRequests],
                ['Ticket-linked fare (MTD)', cards.ticketLinkedFareMonth],
                ['Expenses (MTD)', cards.expensesMonth]
              ].map(([label, val]) => (
                <div key={String(label)} className="finance-kpi-card">
                  <h4>{label}</h4>
                  <p className="val">{Number.isFinite(Number(val)) ? Number(val).toFixed(2) : '0.00'}</p>
                </div>
              ))}
            </div>
          ) : !loading ? (
            <p style={{ margin: 0, color: '#64748b' }}>No summary data yet.</p>
          ) : null}
          {canSeeOrgReports(role) && revenueTrendData.length > 0 ? (
            <div className="finance-chart-card">
              <h3>Revenue trend (net collected)</h3>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={revenueTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => (typeof v === 'number' ? v.toFixed(2) : String(v ?? ''))} />
                    <Line type="monotone" dataKey="revenue" stroke="#0047AB" strokeWidth={2} dot={false} name="Net revenue" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}
          {canSeeOrgReports(role) && expenseStackData.length > 0 && expenseBarKeys.length > 0 ? (
            <div className="finance-chart-card">
              <h3>Expense trend by category</h3>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={expenseStackData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {expenseBarKeys.map((k, i) => (
                      <Bar key={k} dataKey={k} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} name={k} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}
          {canSeeOrgReports(role) && channelPieData.length > 0 ? (
            <div className="finance-chart-card">
              <h3>Payment channels (after reports refresh)</h3>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={channelPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={78} label>
                      {channelPieData.map((_, i) => (
                        <Cell key={String(i)} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}
          <div className="finance-toolbar" style={{ marginTop: '0.65rem' }}>
            <label>
              Chart range (reports)
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="date" value={repFrom} onChange={(e) => setRepFrom(e.target.value)} />
                <input type="date" value={repTo} onChange={(e) => setRepTo(e.target.value)} />
              </div>
            </label>
            <button
              type="button"
              className="secondary"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                void loadDashboard().finally(() => setLoading(false));
              }}
            >
              {loading ? 'Refreshing…' : 'Refresh KPIs'}
            </button>
          </div>
        </section>
      )}

      {tab === 'payments' && (
        <section className="module-card">
          <h2>Payment tracking</h2>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
            Statuses: Pending, Paid, Failed, Refunded, Partially Refunded. Export CSV for spreadsheets.
          </p>
          <form
            className="module-form-grid"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'flex-end' }}
            onSubmit={(e) => {
              e.preventDefault();
              void loadPaymentsBlock().catch((err) => toast.error(err.message));
            }}
          >
            <label>
              Date
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </label>
            <label>
              Status
              <select value={payStatus} onChange={(e) => setPayStatus(e.target.value)}>
                <option value="">All</option>
                <option value="PAID">Paid</option>
                <option value="PENDING">Pending</option>
                <option value="FAILED">Failed</option>
                <option value="REFUNDED">Refunded</option>
                <option value="PARTIALLY_REFUNDED">Partially refunded</option>
              </select>
            </label>
            <button type="submit">Load</button>
            <button type="button" className="secondary" onClick={() => void downloadPaymentsCsv()}>
              Export CSV
            </button>
          </form>
          {daily?.totals && (
            <p style={{ margin: 0, fontSize: '0.85rem' }}>
              Day net (payments net − refunds):{' '}
              <strong>{(Number(daily.totals.totalCollected) - Number(daily.totals.totalRefunded)).toFixed(2)}</strong>
            </p>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table className="module-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>PNR</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Ref</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={String(p.id)}>
                    <td>{String(p.processed_at)}</td>
                    <td>{String(p.pnr || '—')}</td>
                    <td>{String(p.payment_type)}</td>
                    <td>
                      {String(p.amount)} {String(p.currency)}
                    </td>
                    <td>{String(p.payment_status)}</td>
                    <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(p.transaction_ref)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'refunds' && (
        <>
          <section className="module-card">
            <h2>Request a refund</h2>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
              Finance or admin must approve before funds are reversed. Use a payment id from the Payments tab or booking
              detail.
            </p>
            <form onSubmit={submitRefundRequest} className="module-form-grid" style={{ display: 'grid', gap: '0.45rem', maxWidth: 480 }}>
              <label>
                Payment ID
                <input required value={rqPaymentId} onChange={(e) => setRqPaymentId(e.target.value)} placeholder="UUID" />
              </label>
              <label>
                Amount
                <input required type="number" step="0.01" min="0.01" value={rqAmount} onChange={(e) => setRqAmount(e.target.value)} />
              </label>
              <label>
                Reason
                <input value={rqReason} onChange={(e) => setRqReason(e.target.value)} />
              </label>
              <button type="submit">Submit request</button>
            </form>
          </section>
          <section className="module-card">
            <h2>Refund requests</h2>
            <table className="module-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>PNR</th>
                  <th>Amount</th>
                  <th>Approval</th>
                  <th>Payment</th>
                  <th>Reason</th>
                  <th>Requested by</th>
                  <th>Audit</th>
                  {canManageRefunds(role) ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {refundReqs.map((r) => (
                  <tr key={String(r.id)}>
                    <td>{String(r.created_at)}</td>
                    <td>{String(r.pnr || '—')}</td>
                    <td>
                      {String(r.amount)} {String(r.currency)}
                    </td>
                    <td>{String(r.status)}</td>
                    <td>{String(r.payment_status || '—')}</td>
                    <td style={{ maxWidth: 160, fontSize: '0.78rem' }}>{String(r.reason || '—')}</td>
                    <td>{String(r.requested_by_name || '—')}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        style={{ fontSize: '0.72rem' }}
                        onClick={async () => {
                          try {
                            const d = await fetchJson<Record<string, unknown>>(
                              `/api/finance/refund-requests/${String(r.id)}/audit-trail`
                            );
                            setRefundAudit(d);
                          } catch (err) {
                            toast.error((err as Error).message);
                          }
                        }}
                      >
                        Trail
                      </button>
                    </td>
                    {canManageRefunds(role) ? (
                      <td>
                        {String(r.status) === 'PENDING' ? (
                          <span style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <button type="button" onClick={() => void approveRequest(String(r.id))}>
                              Approve
                            </button>
                            <button type="button" className="secondary" onClick={() => void rejectRequest(String(r.id))}>
                              Reject
                            </button>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === 'expenses' && canRecordExpenses(role) && (
        <>
          <section className="module-card">
            <h2>Record expense</h2>
            <form onSubmit={submitExpense} style={{ display: 'grid', gap: '0.45rem', maxWidth: 520 }}>
              <label>
                Category
                <select value={expForm.category} onChange={(e) => setExpForm((f) => ({ ...f, category: e.target.value }))}>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Amount
                <input type="number" step="0.01" required value={expForm.amount} onChange={(e) => setExpForm((f) => ({ ...f, amount: e.target.value }))} />
              </label>
              <label>
                Incurred on
                <input type="date" required value={expForm.incurredOn} onChange={(e) => setExpForm((f) => ({ ...f, incurredOn: e.target.value }))} />
              </label>
              <label>
                Description
                <input value={expForm.description} onChange={(e) => setExpForm((f) => ({ ...f, description: e.target.value }))} />
              </label>
              <label>
                Reference
                <input value={expForm.reference} onChange={(e) => setExpForm((f) => ({ ...f, reference: e.target.value }))} />
              </label>
              <label>
                Flight ID (optional)
                <input value={expForm.flightId} onChange={(e) => setExpForm((f) => ({ ...f, flightId: e.target.value }))} placeholder="Optional flight UUID (allocates to flight profitability)" />
              </label>
              <button type="submit">Save expense</button>
            </form>
          </section>
          <section className="module-card">
            <h2>Expense list</h2>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label>
                From
                <input type="date" value={expFrom} onChange={(e) => setExpFrom(e.target.value)} />
              </label>
              <label>
                To
                <input type="date" value={expTo} onChange={(e) => setExpTo(e.target.value)} />
              </label>
              <button type="button" onClick={() => void loadExpenses().catch((e) => toast.error(e.message))}>
                Load
              </button>
            </div>
            <table className="module-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Amount</th>
                  <th>Entered by</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((x) => (
                  <tr key={String(x.id)}>
                    <td>{String(x.incurred_on)}</td>
                    <td>{String(x.category)}</td>
                    <td>
                      {String(x.amount)} {String(x.currency)}
                    </td>
                    <td>{String(x.entered_by_name || '')}</td>
                    <td>{String(x.description || '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === 'treasury' && canSeeOrgReports(role) && (
        <section className="module-card finance-erp-shell">
          <h2>Treasury — AR / AP / bank</h2>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: '#64748b' }}>
            Accounts receivable from unpaid PNRs; accounts payable from vendor invoices; bank deposits tighten the cash
            summary closing balance.
          </p>
          <div className="finance-toolbar">
            <button type="button" onClick={() => void loadReportsPack()} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh treasury data'}
            </button>
          </div>
          <h3 className="finance-section-title">Accounts receivable</h3>
          <p style={{ margin: '0 0 0.35rem', fontSize: '0.8rem' }}>
            Open exposure: <strong>{arList.reduce((s, r) => s + Number(r.total_amount || 0), 0).toFixed(2)}</strong> USD
            (sample currency)
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="module-table">
              <thead>
                <tr>
                  <th>PNR</th>
                  <th>Amount</th>
                  <th>Aging</th>
                  <th>Bucket</th>
                  <th>Agent</th>
                </tr>
              </thead>
              <tbody>
                {arList.slice(0, 40).map((b) => (
                  <tr key={String(b.id)}>
                    <td>{String(b.pnr)}</td>
                    <td>
                      {Number(b.total_amount).toFixed(2)} {String(b.currency)}
                    </td>
                    <td>{String(b.age_days)} d</td>
                    <td>{String(b.aging_bucket)}</td>
                    <td>{String(b.agent_name || '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="finance-section-title">Accounts payable (vendor)</h3>
          <form
            className="module-form-grid"
            style={{ maxWidth: 520, marginBottom: '0.75rem' }}
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await fetchJson('/api/finance/vendor-invoices', {
                  method: 'POST',
                  body: JSON.stringify({
                    vendorName: viVendor,
                    amount: Number(viAmount),
                    dueOn: viDue,
                    category: viCat,
                    currency: 'USD'
                  })
                });
                toast.success('Vendor invoice recorded.');
                setViVendor('');
                setViAmount('');
                void loadReportsPack();
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          >
            <label>
              Vendor
              <input required value={viVendor} onChange={(e) => setViVendor(e.target.value)} />
            </label>
            <label>
              Amount
              <input required type="number" step="0.01" value={viAmount} onChange={(e) => setViAmount(e.target.value)} />
            </label>
            <label>
              Due
              <input type="date" required value={viDue} onChange={(e) => setViDue(e.target.value)} />
            </label>
            <label>
              Category
              <select value={viCat} onChange={(e) => setViCat(e.target.value)}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Add AP invoice</button>
          </form>
          <table className="module-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Due</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {apList.map((v) => (
                <tr key={String(v.id)}>
                  <td>{String(v.vendor_name)}</td>
                  <td>{String(v.due_on)}</td>
                  <td>
                    {Number(v.amount).toFixed(2)} {String(v.currency)}
                  </td>
                  <td>{String(v.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="finance-section-title">Bank deposits</h3>
          <form
            className="module-form-grid"
            style={{ maxWidth: 420 }}
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await fetchJson('/api/finance/bank-deposits', {
                  method: 'POST',
                  body: JSON.stringify({ depositDate: depDate, amount: Number(depAmount), currency: 'USD' })
                });
                toast.success('Deposit recorded.');
                setDepAmount('');
                void loadReportsPack();
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          >
            <label>
              Date
              <input type="date" value={depDate} onChange={(e) => setDepDate(e.target.value)} />
            </label>
            <label>
              Amount
              <input required type="number" step="0.01" value={depAmount} onChange={(e) => setDepAmount(e.target.value)} />
            </label>
            <button type="submit">Record deposit</button>
          </form>
          {cashSummary ? (
            <pre style={{ fontSize: '0.78rem', background: '#f8fafc', padding: '0.65rem', borderRadius: 8 }}>
              {JSON.stringify(cashSummary, null, 2)}
            </pre>
          ) : null}
        </section>
      )}

      {tab === 'reports' && (
        <section className="module-card finance-erp-shell">
          <h2>Management reports</h2>
          <div className="finance-toolbar">
            <label>
              From
              <input type="date" value={repFrom} onChange={(e) => setRepFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={repTo} onChange={(e) => setRepTo(e.target.value)} />
            </label>
            <label>
              P&amp;L month
              <input type="month" value={pnlMonth} onChange={(e) => setPnlMonth(e.target.value)} />
            </label>
            <label>
              Runway cash on hand
              <input value={runwayCash} onChange={(e) => setRunwayCash(e.target.value)} />
            </label>
            <label>
              Flight UUID filter
              <input
                placeholder="Optional"
                value={repFlightId}
                onChange={(e) => setRepFlightId(e.target.value)}
                style={{ minWidth: 220 }}
              />
            </label>
            <label>
              Route / flight # contains
              <input value={repRouteFilter} onChange={(e) => setRepRouteFilter(e.target.value)} placeholder="e.g. HKG" />
            </label>
            <button type="button" onClick={() => void loadReportsPack()} disabled={loading}>
              Load / refresh
            </button>
          </div>

          <h3 style={{ fontSize: '0.95rem', marginTop: '0.75rem' }}>Outstanding balances</h3>
          <table className="module-table">
            <thead>
              <tr>
                <th>PNR</th>
                <th>Total</th>
                <th>Pay status</th>
                <th>Itinerary fare</th>
                <th>Agent</th>
              </tr>
            </thead>
            <tbody>
              {outstanding.map((b) => (
                <tr key={String(b.id)}>
                  <td>{String(b.pnr)}</td>
                  <td>
                    {String(b.total_amount)} {String(b.currency)}
                  </td>
                  <td>{String(b.payment_status)}</td>
                  <td>{String(b.itinerary_fare_sum)}</td>
                  <td>{String(b.agent_name || '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ fontSize: '0.95rem', marginTop: '0.75rem' }}>Daily revenue (net collected)</h3>
          <table className="module-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Net collected</th>
              </tr>
            </thead>
            <tbody>
              {dailyRev.map((row) => (
                <tr key={String((row as { day: string }).day)}>
                  <td>{String((row as { day: string }).day)}</td>
                  <td>{Number((row as { net_collected: string }).net_collected).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ fontSize: '0.95rem', marginTop: '0.75rem' }}>Route revenue (booking create date)</h3>
          <table className="module-table">
            <thead>
              <tr>
                <th>Route</th>
                <th>Fare sum</th>
                <th>Bookings</th>
              </tr>
            </thead>
            <tbody>
              {routeRev.map((row) => (
                <tr key={String((row as { route: string }).route)}>
                  <td>{String((row as { route: string }).route)}</td>
                  <td>{Number((row as { ticket_fare_sum: string }).ticket_fare_sum).toFixed(2)}</td>
                  <td>{String((row as { booking_count: number }).booking_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ fontSize: '0.95rem', marginTop: '0.75rem' }}>Cash movement (gross in by day + refunds out)</h3>
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b' }}>
            Payments-by-day shows gross amounts on processed date; refunds-by-day shows outflows.
          </p>
          <pre style={{ fontSize: '0.75rem', background: '#f1f5f9', padding: '0.5rem', borderRadius: 8, overflow: 'auto' }}>
            {JSON.stringify(cashRep, null, 2)}
          </pre>

          <h3 style={{ fontSize: '0.95rem', marginTop: '0.75rem' }}>Ticket revenue (issued tickets)</h3>
          <table className="module-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Tickets</th>
                <th>Itinerary fare (joined legs)</th>
              </tr>
            </thead>
            <tbody>
              {ticketRev.map((row) => (
                <tr key={String((row as { day: string }).day)}>
                  <td>{String((row as { day: string }).day)}</td>
                  <td>{String((row as { tickets_issued: number }).tickets_issued)}</td>
                  <td>{Number((row as { itinerary_fare_on_issued_bookings: string }).itinerary_fare_on_issued_bookings).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ fontSize: '0.95rem', marginTop: '0.75rem' }}>Agent sales</h3>
          <table className="module-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Bookings</th>
                <th>Booked gross</th>
                <th>Net payments</th>
              </tr>
            </thead>
            <tbody>
              {agentSales.map((row) => (
                <tr key={String((row as { agent_id: string }).agent_id)}>
                  <td>{String((row as { agent_name: string }).agent_name)}</td>
                  <td>{String((row as { booking_count: number }).booking_count)}</td>
                  <td>{Number((row as { booked_gross: string }).booked_gross).toFixed(2)}</td>
                  <td>{Number((row as { net_payments: string }).net_payments).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {recon && (
            <>
              <h3 className="finance-section-title">Sales reconciliation (summary)</h3>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>
                Booked itinerary fare: <strong>{Number(recon.bookedSalesItineraryFare).toFixed(2)}</strong> · Net
                payments (processed in range): <strong>{Number(recon.netPaymentsProcessedInPeriod).toFixed(2)}</strong> ·
                Variance: <strong>{Number(recon.variance).toFixed(2)}</strong>
              </p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: '#64748b' }}>{String(recon.note || '')}</p>
            </>
          )}

          {reconDetail && Object.keys(reconDetail).length > 0 ? (
            <div style={{ marginTop: '0.75rem' }}>
              <h3 className="finance-section-title">Revenue reconciliation detail</h3>
              <p style={{ fontSize: '0.84rem', margin: '0 0 0.35rem' }}>
                Ticket sales (issued): <strong>{Number(reconDetail.ticketSales).toFixed(2)}</strong> · Booking payments
                (net): <strong>{Number(reconDetail.bookingPayments).toFixed(2)}</strong> · Unpaid bookings:{' '}
                <strong>{Number((reconDetail.unpaidBookings as { count?: number })?.count || 0)}</strong> /{' '}
                <strong>{Number((reconDetail.unpaidBookings as { grossAmount?: number })?.grossAmount || 0).toFixed(2)}</strong>{' '}
                · Online <strong>{Number(reconDetail.onlinePayments).toFixed(2)}</strong> · Cash{' '}
                <strong>{Number(reconDetail.cashPayments).toFixed(2)}</strong> · Agent-channel{' '}
                <strong>{Number(reconDetail.agentPayments).toFixed(2)}</strong>
              </p>
            </div>
          ) : null}

          {monthlyPnl && Object.keys(monthlyPnl).length > 0 ? (
            <div style={{ marginTop: '0.75rem' }}>
              <h3 className="finance-section-title">Monthly P&amp;L (cash view)</h3>
              <p style={{ fontSize: '0.84rem', margin: 0 }}>
                Month <strong>{String(monthlyPnl.month)}</strong> — Revenue <strong>{Number(monthlyPnl.revenue).toFixed(2)}</strong>{' '}
                · Refunds <strong>{Number(monthlyPnl.refunds).toFixed(2)}</strong> · Expenses{' '}
                <strong>{Number(monthlyPnl.expenses).toFixed(2)}</strong> · Net operating cash{' '}
                <strong>{Number(monthlyPnl.netOperatingCash).toFixed(2)}</strong>
              </p>
            </div>
          ) : null}

          {cashRunway && Object.keys(cashRunway).length > 0 ? (
            <p style={{ fontSize: '0.84rem', marginTop: '0.5rem' }}>
              Cash runway (est.): <strong>{cashRunway.runwayDays != null ? Number(cashRunway.runwayDays).toFixed(1) : '—'}</strong>{' '}
              days at avg burn <strong>{Number(cashRunway.averageDailyCashBurn || 0).toFixed(2)}</strong>/day —{' '}
              {String(cashRunway.note || '')}
            </p>
          ) : null}

          {routeProfit.length > 0 ? (
            <>
              <h3 className="finance-section-title">Route profitability</h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="module-table">
                  <thead>
                    <tr>
                      <th>Route</th>
                      <th>Flights</th>
                      <th>Revenue</th>
                      <th>Cost</th>
                      <th>Margin</th>
                      <th>Pax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routeProfit.map((row) => (
                      <tr key={String((row as { route: string }).route)}>
                        <td>{String((row as { route: string }).route)}</td>
                        <td>{String((row as { flight_count: number }).flight_count)}</td>
                        <td>{Number((row as { route_revenue: string }).route_revenue).toFixed(2)}</td>
                        <td>{Number((row as { route_cost_estimate: string }).route_cost_estimate).toFixed(2)}</td>
                        <td>{Number((row as { route_margin: number }).route_margin).toFixed(2)}</td>
                        <td>{String((row as { passenger_count: number }).passenger_count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {routeProfit.length > 1 ? (
                <div className="finance-chart-card">
                  <h3>Route margin (top)</h3>
                  <div style={{ width: '100%', height: 220 }}>
                    <ResponsiveContainer>
                      <BarChart data={routeProfit.slice(0, 12).map((r) => ({ name: String((r as { route: string }).route), margin: Number((r as { route_margin: number }).route_margin) }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={70} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="margin" fill="#0047AB" name="Margin" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {agentLedger.length > 0 ? (
            <>
              <h3 className="finance-section-title">Agent ledger</h3>
              <table className="module-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Bookings</th>
                    <th>Gross</th>
                    <th>Net paid</th>
                    <th>Outstanding</th>
                    <th>Comm. %</th>
                    <th>Comm. est.</th>
                  </tr>
                </thead>
                <tbody>
                  {agentLedger.map((row) => (
                    <tr key={String((row as { agent_id: string }).agent_id)}>
                      <td>{String((row as { agent_name: string }).agent_name)}</td>
                      <td>{String((row as { booking_count: number }).booking_count)}</td>
                      <td>{Number((row as { booked_gross: string }).booked_gross).toFixed(2)}</td>
                      <td>{Number((row as { net_payments: string }).net_payments).toFixed(2)}</td>
                      <td>{Number((row as { outstanding_balance: string }).outstanding_balance).toFixed(2)}</td>
                      <td>{Number((row as { commission_pct: string }).commission_pct).toFixed(2)}</td>
                      <td>{Number((row as { commission_estimate: number }).commission_estimate).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {flightProfit.length > 0 && (
            <>
              <h3 className="finance-section-title">Flight profitability</h3>
              <table className="module-table">
                <thead>
                  <tr>
                    <th>Flight</th>
                    <th>Route</th>
                    <th>Departure</th>
                    <th>Revenue</th>
                    <th>Direct exp.</th>
                    <th>Margin</th>
                    <th>Pax</th>
                    <th>LF</th>
                    <th>Yield/pax</th>
                  </tr>
                </thead>
                <tbody>
                  {flightProfit.map((f) => (
                    <tr key={String(f.flight_id)}>
                      <td>{String(f.flight_number)}</td>
                      <td>
                        {String(f.departure_airport)}→{String(f.arrival_airport)}
                      </td>
                      <td>{String(f.departure_time)}</td>
                      <td>{Number(f.revenue_from_bookings).toFixed(2)}</td>
                      <td>{Number(f.direct_expenses).toFixed(2)}</td>
                      <td>{Number(f.estimated_margin).toFixed(2)}</td>
                      <td>{String(f.passenger_count ?? '—')}</td>
                      <td>
                        {f.load_factor != null && Number.isFinite(Number(f.load_factor))
                          ? `${(Number(f.load_factor) * 100).toFixed(0)}%`
                          : '—'}
                      </td>
                      <td>
                        {f.yield_per_passenger != null && Number.isFinite(Number(f.yield_per_passenger))
                          ? Number(f.yield_per_passenger).toFixed(2)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      {refundAudit ? (
        <div
          role="dialog"
          aria-modal
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            zIndex: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem'
          }}
          onMouseDown={() => setRefundAudit(null)}
        >
          <div
            className="module-card"
            style={{ maxWidth: 720, width: '100%', maxHeight: '85vh', overflow: 'auto' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Refund audit trail</h3>
            <pre style={{ fontSize: '0.72rem', background: '#f8fafc', padding: '0.5rem', borderRadius: 8 }}>
              {JSON.stringify(refundAudit, null, 2)}
            </pre>
            <button type="button" className="secondary" onClick={() => setRefundAudit(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
