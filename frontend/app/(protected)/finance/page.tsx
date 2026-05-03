'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import type { UserRole } from '@/lib/roles';
import { getPublicApiBaseUrl } from '@/lib/api-base';

const API_BASE_URL = getPublicApiBaseUrl();

type Tab = 'overview' | 'payments' | 'refunds' | 'expenses' | 'reports';

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
    category: 'GROUND_HANDLING',
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
        const [rc, fp] = await Promise.all([
          fetchJson<Record<string, unknown>>(`/api/finance/reports/sales-reconciliation?from=${repFrom}&to=${repTo}`),
          fetchJson<{ flights: unknown[] }>(`/api/finance/reports/flight-profitability?from=${repFrom}&to=${repTo}`)
        ]);
        setRecon(rc);
        setFlightProfit((fp.flights || []) as Array<Record<string, unknown>>);
      } else {
        setRecon(null);
        setFlightProfit([]);
      }
      toast.success('Reports refreshed.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const cards = (dash?.cards as Record<string, number> | undefined) || undefined;
  const scope = dash?.scope as string | undefined;

  return (
    <main className="module-page">
      <section className="module-card">
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

      <div className="module-form-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        {(['overview', 'payments', 'refunds', 'expenses', 'reports'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? '' : 'secondary'}
            onClick={() => setTab(t)}
            disabled={t === 'expenses' && role !== null && !canRecordExpenses(role)}
          >
            {t === 'overview' ? 'Dashboard' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <section className="module-card">
          <h2>Finance dashboard</h2>
          {dashError ? (
            <p style={{ margin: '0 0 0.5rem', color: '#b91c1c', fontSize: '0.9rem' }} role="alert">
              {dashError}
            </p>
          ) : null}
          {loading && !cards ? (
            <p style={{ margin: 0, color: '#64748b' }}>Loading…</p>
          ) : cards ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '0.65rem'
              }}
            >
              {[
                ['Net payments − refunds (today)', cards.netPaymentsToday],
                ['Refunds (today)', cards.refundsToday],
                ['Outstanding bookings', cards.outstandingBookings],
                ['Outstanding gross (PNR)', cards.outstandingGrossAmount],
                ['Pending refund requests', cards.pendingRefundRequests],
                ['Ticket-linked fare (MTD)', cards.ticketLinkedFareMonth],
                ['Expenses (MTD)', cards.expensesMonth]
              ].map(([label, val]) => (
                <div
                  key={String(label)}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 10,
                    padding: '0.55rem',
                    background: '#f8fafc'
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{label}</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
                    {Number.isFinite(Number(val)) ? Number(val).toFixed(2) : '0.00'}
                  </div>
                </div>
              ))}
            </div>
          ) : !loading ? (
            <p style={{ margin: 0, color: '#64748b' }}>No summary data yet.</p>
          ) : null}
          <button
            type="button"
            className="secondary"
            style={{ marginTop: '0.5rem' }}
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void loadDashboard().finally(() => setLoading(false));
            }}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
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
                  <th>Status</th>
                  <th>Requested by</th>
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
                    <td>{String(r.requested_by_name || '—')}</td>
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
                <input value={expForm.category} onChange={(e) => setExpForm((f) => ({ ...f, category: e.target.value }))} />
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

      {tab === 'reports' && (
        <section className="module-card">
          <h2>Reports</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'flex-end' }}>
            <label>
              From
              <input type="date" value={repFrom} onChange={(e) => setRepFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={repTo} onChange={(e) => setRepTo(e.target.value)} />
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
              <h3 style={{ fontSize: '0.95rem', marginTop: '0.75rem' }}>Sales reconciliation</h3>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>
                Booked itinerary fare: <strong>{Number(recon.bookedSalesItineraryFare).toFixed(2)}</strong> · Net
                payments (processed in range): <strong>{Number(recon.netPaymentsProcessedInPeriod).toFixed(2)}</strong> ·
                Variance: <strong>{Number(recon.variance).toFixed(2)}</strong>
              </p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: '#64748b' }}>{String(recon.note || '')}</p>
            </>
          )}

          {flightProfit.length > 0 && (
            <>
              <h3 style={{ fontSize: '0.95rem', marginTop: '0.75rem' }}>Flight profitability</h3>
              <table className="module-table">
                <thead>
                  <tr>
                    <th>Flight</th>
                    <th>Route</th>
                    <th>Departure</th>
                    <th>Revenue</th>
                    <th>Direct exp.</th>
                    <th>Margin</th>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </main>
  );
}
