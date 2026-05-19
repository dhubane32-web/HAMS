'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import DocumentHeader from '@/components/documents/DocumentHeader';
import type { UserRole } from '@/lib/roles';
import { getPublicApiBaseUrl } from '@/lib/api-base';

const API_BASE_URL = getPublicApiBaseUrl();

const CASE_TYPES = ['SUPPORT', 'COMPLAINT', 'REFUND_REQUEST', 'BOOKING_CHANGE', 'LOST_BAGGAGE', 'GENERAL'] as const;
const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

type Tab = 'dashboard' | 'cases' | 'new' | 'passenger';

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

function isAdminRole(role: UserRole | null) {
  return role === 'admin' || role === 'super_admin';
}

export default function CustomerServicePage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(false);

  const [dashboard, setDashboard] = useState<{
    scope?: string;
    byStatus?: Array<{ status: string; count: number }>;
    byType?: Array<{ case_type: string; count: number }>;
    openCases?: number;
    summary?: { open: number; pending: number; resolved: number; closed: number };
    refundRequestsPendingLinked?: number;
  } | null>(null);

  const [cases, setCases] = useState<Array<Record<string, unknown>>>([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [searchQ, setSearchQ] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [caseRow, setCaseRow] = useState<Record<string, unknown> | null>(null);
  const [notes, setNotes] = useState<Array<Record<string, unknown>>>([]);
  const [editStatus, setEditStatus] = useState('');
  const [editPriority, setEditPriority] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [notePublic, setNotePublic] = useState(false);

  const [payments, setPayments] = useState<Array<Record<string, unknown>>>([]);
  const [refPayId, setRefPayId] = useState('');
  const [refAmount, setRefAmount] = useState('');
  const [refReason, setRefReason] = useState('');

  const [newType, setNewType] = useState<string>('SUPPORT');
  const [newSubject, setNewSubject] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState('NORMAL');
  const [newPassengerId, setNewPassengerId] = useState('');
  const [newBookingId, setNewBookingId] = useState('');
  const [newBaggageId, setNewBaggageId] = useState('');
  const [newMeta, setNewMeta] = useState('');

  const [paxId, setPaxId] = useState('');
  const [paxHistory, setPaxHistory] = useState<Record<string, unknown> | null>(null);
  const [paxProfile, setPaxProfile] = useState<{
    passenger: Record<string, unknown>;
    profile: Record<string, unknown> | null;
  } | null>(null);
  const [profLang, setProfLang] = useState('');
  const [profVip, setProfVip] = useState(false);
  const [profNotes, setProfNotes] = useState('');
  const [profContact, setProfContact] = useState('');

  const admin = useMemo(() => isAdminRole(role), [role]);

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

  const fetchCustomerDashboard = useCallback(async () => {
    const d = await fetchJson<{
      scope?: string;
      byStatus?: Array<{ status: string; count: number }>;
      byType?: Array<{ case_type: string; count: number }>;
      openCases?: number;
      summary?: { open: number; pending: number; resolved: number; closed: number };
      refundRequestsPendingLinked?: number;
    }>('/api/customer-service/dashboard');
    setDashboard(d);
  }, [fetchJson]);

  const loadCases = useCallback(async () => {
    const q = new URLSearchParams();
    if (filterStatus) q.set('status', filterStatus);
    if (filterType) q.set('caseType', filterType);
    if (searchQ.trim()) q.set('q', searchQ.trim());
    const path = `/api/customer-service/cases${q.toString() ? `?${q}` : ''}`;
    const d = await fetchJson<{ cases: Array<Record<string, unknown>> }>(path);
    setCases(d.cases || []);
  }, [fetchJson, filterStatus, filterType, searchQ]);

  const openCase = useCallback(
    async (id: string) => {
      setSelectedId(id);
      const d = await fetchJson<{ case: Record<string, unknown>; notes: Array<Record<string, unknown>> }>(
        `/api/customer-service/cases/${id}`
      );
      setCaseRow(d.case);
      setNotes(d.notes || []);
      setEditStatus(String(d.case.status || ''));
      setEditPriority(String(d.case.priority || ''));
      setEditSubject(String(d.case.subject || ''));
      const bid = d.case.booking_id as string | undefined;
      if (bid) {
        const pay = await fetchJson<{ payments: Array<Record<string, unknown>> }>(
          `/api/customer-service/bookings/${bid}/payments`
        );
        setPayments(pay.payments || []);
      } else {
        setPayments([]);
      }
      setRefPayId('');
      setRefAmount('');
      setRefReason('');
    },
    [fetchJson]
  );

  useEffect(() => {
    if (tab !== 'dashboard') return;
    setLoading(true);
    void fetchCustomerDashboard()
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [tab, fetchCustomerDashboard]);

  useEffect(() => {
    if (tab !== 'cases') return;
    setLoading(true);
    void loadCases()
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [tab, loadCases]);

  async function saveCase(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    try {
      await fetchJson(`/api/customer-service/cases/${selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: editStatus,
          priority: editPriority,
          subject: editSubject
        })
      });
      toast.success('Case updated.');
      await loadCases();
      await openCase(selectedId);
      if (tab === 'dashboard') await fetchCustomerDashboard();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || !noteBody.trim()) return;
    try {
      await fetchJson(`/api/customer-service/cases/${selectedId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: noteBody, isInternal: !notePublic })
      });
      toast.success('Note added.');
      setNoteBody('');
      await openCase(selectedId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function submitRefund(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || !refPayId) return;
    try {
      await fetchJson(`/api/customer-service/cases/${selectedId}/refund-request`, {
        method: 'POST',
        body: JSON.stringify({
          paymentId: refPayId,
          refundAmount: Number(refAmount),
          reason: refReason || undefined
        })
      });
      toast.success('Refund request created — finance will approve in Finance & Accounting.');
      await openCase(selectedId);
      await loadCases();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function createCase(e: FormEvent) {
    e.preventDefault();
    let metadata: unknown = undefined;
    if (newMeta.trim()) {
      try {
        metadata = JSON.parse(newMeta) as unknown;
      } catch {
        toast.error('Metadata must be valid JSON.');
        return;
      }
    }
    try {
      const body: Record<string, unknown> = {
        caseType: newType,
        subject: newSubject,
        description: newDesc || undefined,
        priority: newPriority,
        passengerId: newPassengerId || undefined,
        bookingId: newBookingId || undefined,
        baggageId: newBaggageId || undefined,
        metadata
      };
      const d = await fetchJson<{ case: { id: string } }>('/api/customer-service/cases', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      toast.success('Case created.');
      setNewSubject('');
      setNewDesc('');
      setNewPassengerId('');
      setNewBookingId('');
      setNewBaggageId('');
      setNewMeta('');
      setTab('cases');
      await loadCases();
      await openCase(d.case.id);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function loadPassenger() {
    if (!paxId.trim()) {
      toast.error('Enter a passenger UUID.');
      return;
    }
    setLoading(true);
    try {
      const [h, prof] = await Promise.all([
        fetchJson<Record<string, unknown>>(`/api/customer-service/passengers/${paxId.trim()}/history`),
        fetchJson<{ passenger: Record<string, unknown>; profile: Record<string, unknown> | null }>(
          `/api/customer-service/passengers/${paxId.trim()}/profile`
        )
      ]);
      setPaxHistory(h);
      setPaxProfile(prof);
      setProfLang(String(prof.profile?.preferred_language || ''));
      setProfVip(Boolean(prof.profile?.vip_flag));
      setProfNotes(String(prof.profile?.service_notes || ''));
      setProfContact(String(prof.profile?.preferred_contact || ''));
    } catch (e) {
      toast.error((e as Error).message);
      setPaxHistory(null);
      setPaxProfile(null);
    } finally {
      setLoading(false);
    }
  }

  async function savePassengerProfile(e: FormEvent) {
    e.preventDefault();
    if (!paxId.trim()) return;
    try {
      await fetchJson(`/api/customer-service/passengers/${paxId.trim()}/profile`, {
        method: 'PUT',
        body: JSON.stringify({
          preferredLanguage: profLang || null,
          vipFlag: profVip,
          serviceNotes: profNotes || null,
          preferredContact: profContact || null
        })
      });
      toast.success('Profile saved.');
      await loadPassenger();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <main className="module-page">
      <DocumentHeader documentTitle="Passenger Services" className="mb-6" />
      <section className="module-card">
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>
          Service cases tied to passengers and bookings, passenger history and profiles, internal notes, lost baggage
          linked to check-in baggage records, and refund requests that create finance approval rows. Admins see all
          cases; agents work assigned or unassigned queue cases.
        </p>
        {dashboard?.scope ? (
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#0369a1' }}>
            Case list scope:{' '}
            <strong>{dashboard.scope === 'all' ? 'Full organization (admin)' : 'Your queue & unassigned'}</strong>
          </p>
        ) : null}
      </section>

      <div className="module-form-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        {(['dashboard', 'cases', 'new', 'passenger'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? '' : 'secondary'}
            onClick={() => setTab(t)}
            style={{ textTransform: 'capitalize' }}
          >
            {t === 'new' ? 'New case' : t}
          </button>
        ))}
      </div>

      {loading ? <p style={{ color: '#64748b' }}>Loading…</p> : null}

      {tab === 'dashboard' && dashboard ? (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>Service dashboard</h2>
          <div className="stats-inline">
            <article>
              <p>Open (status)</p>
              <strong>{dashboard.summary?.open ?? 0}</strong>
            </article>
            <article>
              <p>Pending / in progress</p>
              <strong>{dashboard.summary?.pending ?? 0}</strong>
            </article>
            <article>
              <p>Resolved</p>
              <strong>{dashboard.summary?.resolved ?? 0}</strong>
            </article>
            <article>
              <p>Closed</p>
              <strong>{dashboard.summary?.closed ?? 0}</strong>
            </article>
            <article>
              <p>Active (not resolved/closed)</p>
              <strong>{dashboard.openCases ?? 0}</strong>
            </article>
            <article>
              <p>Linked refunds pending</p>
              <strong>{dashboard.refundRequestsPendingLinked ?? 0}</strong>
            </article>
          </div>
          <h3>By status</h3>
          <table className="module-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {(dashboard.byStatus || []).map((r) => (
                <tr key={r.status}>
                  <td>{r.status}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>By type</h3>
          <table className="module-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {(dashboard.byType || []).map((r) => (
                <tr key={r.case_type}>
                  <td>{r.case_type}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === 'cases' ? (
        <>
          <section className="module-card">
            <h2 style={{ marginTop: 0 }}>Cases</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
              <label>
                Status
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="module-input">
                  <option value="">All</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Type
                <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="module-input">
                  <option value="">All</option>
                  {CASE_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ flex: 1, minWidth: '160px' }}>
                Search
                <input
                  className="module-input"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Subject, ref, PNR"
                />
              </label>
              <button type="button" onClick={() => void loadCases().catch((e) => toast.error(e.message))}>
                Refresh
              </button>
            </div>
            <table className="module-table" style={{ marginTop: '1rem' }}>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Subject</th>
                  <th>Passenger</th>
                  <th>PNR</th>
                  <th>Assigned</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr
                    key={String(c.id)}
                    style={{ cursor: 'pointer', background: selectedId === c.id ? '#f0f9ff' : undefined }}
                    onClick={() => void openCase(String(c.id)).catch((e) => toast.error(e.message))}
                  >
                    <td>{String(c.case_ref)}</td>
                    <td>{String(c.case_type)}</td>
                    <td>{String(c.status)}</td>
                    <td>{String(c.subject).slice(0, 48)}</td>
                    <td>
                      {c.passenger_first_name || c.passenger_last_name
                        ? `${c.passenger_first_name || ''} ${c.passenger_last_name || ''}`.trim()
                        : '—'}
                    </td>
                    <td>{c.booking_pnr ? String(c.booking_pnr) : '—'}</td>
                    <td>{c.assigned_to_name ? String(c.assigned_to_name) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {caseRow ? (
            <section className="module-card">
              <h2 style={{ marginTop: 0 }}>
                {String(caseRow.case_ref)} — {String(caseRow.case_type)}
              </h2>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                Created {caseRow.created_at ? new Date(String(caseRow.created_at)).toLocaleString() : ''} ·{' '}
                {caseRow.created_by_name ? `Opened by ${String(caseRow.created_by_name)}` : ''}
                {caseRow.baggage_tag ? ` · Bag tag ${String(caseRow.baggage_tag)}` : ''}
              </p>
              {caseRow.refund_request_id ? (
                <p style={{ color: '#0f766e' }}>
                  Finance refund request: <strong>{String(caseRow.refund_request_status)}</strong> ·{' '}
                  <Link href="/finance">Open Finance module</Link> for approval.
                </p>
              ) : null}

              <form onSubmit={saveCase} style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <label>
                    Status
                    <select className="module-input" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Priority
                    <select className="module-input" value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
                      {PRIORITIES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Subject
                  <input className="module-input" value={editSubject} onChange={(e) => setEditSubject(e.target.value)} />
                </label>
                <button type="submit">Save case</button>
              </form>

              <h3>Notes</h3>
              <ul style={{ paddingLeft: '1.1rem', maxHeight: '220px', overflow: 'auto' }}>
                {notes.map((n) => (
                  <li key={String(n.id)} style={{ marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {n.created_at ? new Date(String(n.created_at)).toLocaleString() : ''} ·{' '}
                      {n.author_name ? String(n.author_name) : 'User'} · {n.is_internal === false ? 'Customer-visible' : 'Internal'}
                    </span>
                    <div>{String(n.body)}</div>
                  </li>
                ))}
              </ul>
              <form onSubmit={addNote} style={{ display: 'grid', gap: '0.35rem' }}>
                <textarea
                  className="module-input"
                  rows={3}
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Add a case note…"
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input type="checkbox" checked={notePublic} onChange={(e) => setNotePublic(e.target.checked)} />
                  Customer-visible (not internal)
                </label>
                <button type="submit" className="secondary">
                  Add note
                </button>
              </form>

              {caseRow.booking_id && !caseRow.refund_request_id ? (
                <>
                  <h3>Refund (finance approval)</h3>
                  <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                    Creates a pending row in <code>refund_requests</code> for the same booking as this case.
                  </p>
                  <form onSubmit={submitRefund} style={{ display: 'grid', gap: '0.35rem', maxWidth: '420px' }}>
                    <label>
                      Payment
                      <select className="module-input" value={refPayId} onChange={(e) => setRefPayId(e.target.value)} required>
                        <option value="">Select payment</option>
                        {payments.map((p) => (
                          <option key={String(p.id)} value={String(p.id)}>
                            {String(p.payment_status)} · {String(p.amount)} {String(p.currency)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Amount
                      <input className="module-input" value={refAmount} onChange={(e) => setRefAmount(e.target.value)} required />
                    </label>
                    <label>
                      Reason
                      <input className="module-input" value={refReason} onChange={(e) => setRefReason(e.target.value)} />
                    </label>
                    <button type="submit">Submit refund request</button>
                  </form>
                </>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}

      {tab === 'new' ? (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>New case</h2>
          <form onSubmit={createCase} style={{ display: 'grid', gap: '0.5rem', maxWidth: '520px' }}>
            <label>
              Case type
              <select className="module-input" value={newType} onChange={(e) => setNewType(e.target.value)}>
                {CASE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject
              <input className="module-input" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} required />
            </label>
            <label>
              Description
              <textarea className="module-input" rows={4} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            </label>
            <label>
              Priority
              <select className="module-input" value={newPriority} onChange={(e) => setNewPriority(e.target.value)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Passenger ID (UUID)
              <input className="module-input" value={newPassengerId} onChange={(e) => setNewPassengerId(e.target.value)} />
            </label>
            <label>
              Booking ID (UUID)
              <input className="module-input" value={newBookingId} onChange={(e) => setNewBookingId(e.target.value)} />
            </label>
            <label>
              Baggage ID (for lost baggage — from check-in)
              <input className="module-input" value={newBaggageId} onChange={(e) => setNewBaggageId(e.target.value)} />
            </label>
            <label>
              Metadata (JSON, optional — e.g. booking change details)
              <textarea className="module-input" rows={2} value={newMeta} onChange={(e) => setNewMeta(e.target.value)} />
            </label>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>
              <strong>LOST_BAGGAGE</strong> requires baggage ID; passenger and booking are taken from the check-in record.{' '}
              <strong>BOOKING_CHANGE</strong> requires booking ID. <strong>REFUND_REQUEST</strong> requires booking ID; then
              use the case detail to submit the finance refund.
            </p>
            <button type="submit">Create case</button>
          </form>
        </section>
      ) : null}

      {tab === 'passenger' ? (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>Passenger profile &amp; history</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ flex: 1, minWidth: '220px' }}>
              Passenger UUID
              <input className="module-input" value={paxId} onChange={(e) => setPaxId(e.target.value)} placeholder="Passenger id" />
            </label>
            <button type="button" onClick={() => void loadPassenger()}>
              Load
            </button>
          </div>

          {paxProfile ? (
            <form onSubmit={savePassengerProfile} style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem', maxWidth: '480px' }}>
              <h3>Service profile</h3>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>
                {String(paxProfile.passenger.first_name)} {String(paxProfile.passenger.last_name)} ·{' '}
                {paxProfile.passenger.email ? String(paxProfile.passenger.email) : '—'}
              </p>
              <label>
                Preferred language
                <input className="module-input" value={profLang} onChange={(e) => setProfLang(e.target.value)} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <input type="checkbox" checked={profVip} onChange={(e) => setProfVip(e.target.checked)} />
                VIP flag
              </label>
              <label>
                Preferred contact
                <input className="module-input" value={profContact} onChange={(e) => setProfContact(e.target.value)} />
              </label>
              <label>
                Service notes
                <textarea className="module-input" rows={3} value={profNotes} onChange={(e) => setProfNotes(e.target.value)} />
              </label>
              <button type="submit">Save profile</button>
            </form>
          ) : null}

          {paxHistory ? (
            <div style={{ marginTop: '1.5rem' }}>
              <h3>History</h3>
              <h4>Bookings</h4>
              <table className="module-table">
                <thead>
                  <tr>
                    <th>PNR</th>
                    <th>Status</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {((paxHistory.bookings as Array<Record<string, unknown>>) || []).map((b) => (
                    <tr key={String(b.id)}>
                      <td>{String(b.pnr)}</td>
                      <td>{String(b.booking_status)}</td>
                      <td>
                        {String(b.total_amount)} {String(b.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h4>Check-ins &amp; baggage</h4>
              <table className="module-table">
                <thead>
                  <tr>
                    <th>Flight</th>
                    <th>Seat</th>
                    <th>Boarding</th>
                  </tr>
                </thead>
                <tbody>
                  {((paxHistory.checkins as Array<Record<string, unknown>>) || []).map((c) => (
                    <tr key={String(c.id)}>
                      <td>{String(c.flight_number)}</td>
                      <td>{c.seat_number ? String(c.seat_number) : '—'}</td>
                      <td>{String(c.boarding_status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="module-table">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Weight</th>
                    <th>Booking</th>
                  </tr>
                </thead>
                <tbody>
                  {((paxHistory.baggage as Array<Record<string, unknown>>) || []).map((b) => (
                    <tr key={String(b.id)}>
                      <td>{String(b.tag_number)}</td>
                      <td>{String(b.weight_kg)} kg</td>
                      <td style={{ fontSize: '0.75rem' }}>{String(b.booking_id).slice(0, 8)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h4>Complaint history</h4>
              <table className="module-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Status</th>
                    <th>Subject</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    (paxHistory.complaintHistory as Array<Record<string, unknown>> | undefined) ||
                    (paxHistory.serviceCases as Array<Record<string, unknown>>)?.filter(
                      (c) => String(c.case_type).toUpperCase() === 'COMPLAINT'
                    ) ||
                    []
                  ).map((c) => (
                    <tr key={String(c.id)}>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setTab('cases');
                            void openCase(String(c.id)).catch((e: Error) => toast.error(e.message));
                          }}
                        >
                          {String(c.case_ref)}
                        </button>
                      </td>
                      <td>{String(c.status)}</td>
                      <td>{String(c.subject).slice(0, 40)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h4>All service cases</h4>
              <table className="module-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {((paxHistory.serviceCases as Array<Record<string, unknown>>) || []).map((c) => (
                    <tr key={String(c.id)}>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setTab('cases');
                            void openCase(String(c.id)).catch((e: Error) => toast.error(e.message));
                          }}
                        >
                          {String(c.case_ref)}
                        </button>
                      </td>
                      <td>{String(c.case_type)}</td>
                      <td>{String(c.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {!admin && tab === 'cases' ? (
        <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
          Non-admin users see unassigned cases, cases assigned to them, and cases they created.
        </p>
      ) : null}
    </main>
  );
}
