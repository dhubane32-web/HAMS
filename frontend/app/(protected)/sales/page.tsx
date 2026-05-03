'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import type { UserRole } from '@/lib/roles';
import { getPublicApiBaseUrl } from '@/lib/api-base';
import SalesCommercialWorkspace from '@/components/sales/SalesCommercialWorkspace';
import {
  formatPercent1Decimal,
  formatPromoDiscountDisplay,
  formatSalesCurrency,
  SALES_DISPLAY_CURRENCY
} from '@/lib/sales-format';

const API_BASE_URL = getPublicApiBaseUrl();

type Tab =
  | 'dashboard'
  | 'commercial'
  | 'leads'
  | 'corporate'
  | 'agents'
  | 'promos'
  | 'segments'
  | 'performance';

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const;

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('hams_token') : null;
}

function roleFromToken(): UserRole | null {
  const t = getToken();
  if (!t) return null;
  try {
    return (JSON.parse(atob(t.split('.')[1])).role as UserRole) || null;
  } catch {
    return null;
  }
}

function canEditSalesContent(role: UserRole | null) {
  if (!role) return false;
  return ['admin', 'super_admin', 'sales_manager'].includes(role);
}

function canViewMarketingDash(role: UserRole | null) {
  if (!role) return false;
  return ['admin', 'super_admin', 'sales_manager', 'finance'].includes(role);
}

export default function SalesPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(false);

  const [dash, setDash] = useState<{
    campaigns?: Array<Record<string, unknown>>;
    leadPipeline?: Array<Record<string, unknown>>;
    promoUsage?: Array<Record<string, unknown>>;
  } | null>(null);
  const [marketingDashError, setMarketingDashError] = useState('');
  const [leadsBlockError, setLeadsBlockError] = useState('');
  const [campaignsError, setCampaignsError] = useState('');
  const [promosError, setPromosError] = useState('');
  const [agentPerfError, setAgentPerfError] = useState('');

  const [leads, setLeads] = useState<Array<Record<string, unknown>>>([]);
  const [pipeline, setPipeline] = useState<Array<Record<string, unknown>>>([]);
  const [leadForm, setLeadForm] = useState({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    source: 'WEB',
    status: 'NEW' as (typeof LEAD_STATUSES)[number],
    expectedValue: '',
    campaignId: ''
  });

  const [corporate, setCorporate] = useState<Array<Record<string, unknown>>>([]);
  const [corpForm, setCorpForm] = useState({ legalName: '', taxId: '', billingEmail: '', phone: '', defaultDiscountPercent: '', notes: '' });

  const [travelAgents, setTravelAgents] = useState<Array<Record<string, unknown>>>([]);
  const [taForm, setTaForm] = useState({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    iataCode: '',
    userId: '',
    commissionPercent: '',
    notes: ''
  });

  const [campaigns, setCampaigns] = useState<Array<Record<string, unknown>>>([]);
  const [campForm, setCampForm] = useState({
    name: '',
    channel: 'EMAIL',
    startDate: today,
    endDate: today,
    budgetAmount: '',
    utmCampaign: ''
  });

  const [promos, setPromos] = useState<Array<Record<string, unknown>>>([]);
  const [promoForm, setPromoForm] = useState({
    code: '',
    description: '',
    discountType: 'PERCENT' as 'PERCENT' | 'FIXED_AMOUNT',
    discountValue: '',
    validFrom: today,
    validUntil: today,
    usageLimit: '100'
  });
  const [routePromo, setRoutePromo] = useState({ promoId: '', origin: '', dest: '' });
  const [validateForm, setValidateForm] = useState({
    code: '',
    travelDate: today,
    origin: '',
    dest: '',
    subtotal: '500'
  });

  const [segments, setSegments] = useState<Array<Record<string, unknown>>>([]);
  const [segForm, setSegForm] = useState({ name: '', description: '' });
  const [segMember, setSegMember] = useState({ segmentId: '', passengerId: '' });

  const [perfFrom, setPerfFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [perfTo, setPerfTo] = useState(today);
  const [agentPerf, setAgentPerf] = useState<Array<Record<string, unknown>>>([]);

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
      throw new Error(body.message || 'Request failed.');
    }
    return body as T;
  }, []);

  useEffect(() => {
    setRole(roleFromToken());
  }, []);

  const loadCampaigns = useCallback(
    async (opts?: { silent?: boolean }) => {
      setCampaignsError('');
      try {
        const c = await fetchJson<{ campaigns: Array<Record<string, unknown>> }>('/api/sales/campaigns');
        setCampaigns(c.campaigns || []);
      } catch (e) {
        setCampaigns([]);
        const msg = (e as Error).message;
        setCampaignsError(msg);
        if (!opts?.silent) toast.error(msg);
      }
    },
    [fetchJson]
  );

  const loadMarketingDashboard = useCallback(async () => {
    setMarketingDashError('');
    try {
      const d = await fetchJson<{
        campaigns: Array<Record<string, unknown>>;
        leadPipeline: Array<Record<string, unknown>>;
        promoUsage: Array<Record<string, unknown>>;
      }>('/api/sales/marketing-dashboard');
      setDash(d);
      await loadCampaigns({ silent: true });
    } catch (e) {
      setDash(null);
      const msg = (e as Error).message;
      setMarketingDashError(msg);
      toast.error(msg);
    }
  }, [fetchJson, loadCampaigns]);

  const loadLeadsBlock = useCallback(async () => {
    setLeadsBlockError('');
    try {
      const [l, p] = await Promise.all([
        fetchJson<{ leads: Array<Record<string, unknown>> }>('/api/sales/leads'),
        fetchJson<{ pipeline: Array<Record<string, unknown>> }>('/api/sales/leads/pipeline')
      ]);
      setLeads(l.leads || []);
      setPipeline(p.pipeline || []);
    } catch (e) {
      setLeads([]);
      setPipeline([]);
      const msg = (e as Error).message;
      setLeadsBlockError(msg);
      toast.error(msg);
    }
  }, [fetchJson]);

  useEffect(() => {
    if (tab === 'dashboard' && canViewMarketingDash(role)) {
      setLoading(true);
      void loadMarketingDashboard().finally(() => setLoading(false));
    }
  }, [tab, role, loadMarketingDashboard]);

  useEffect(() => {
    if (tab === 'leads') {
      setLoading(true);
      void loadLeadsBlock().finally(() => setLoading(false));
    }
  }, [tab, loadLeadsBlock]);

  useEffect(() => {
    if (tab === 'corporate' && role && ['admin', 'super_admin', 'sales_manager', 'finance'].includes(role)) {
      setLoading(true);
      void fetchJson<{ corporateCustomers: Array<Record<string, unknown>> }>('/api/sales/corporate-customers')
        .then((r) => setCorporate(r.corporateCustomers || []))
        .catch((e: Error) => toast.error(e.message))
        .finally(() => setLoading(false));
    }
  }, [tab, role, fetchJson]);

  useEffect(() => {
    if (tab === 'agents' && role && ['admin', 'super_admin', 'sales_manager', 'operations'].includes(role)) {
      setLoading(true);
      void fetchJson<{ travelAgents: Array<Record<string, unknown>> }>('/api/sales/travel-agents')
        .then((r) => setTravelAgents(r.travelAgents || []))
        .catch((e: Error) => toast.error(e.message))
        .finally(() => setLoading(false));
    }
  }, [tab, role, fetchJson]);

  const loadPromos = useCallback(async () => {
    setPromosError('');
    try {
      const r = await fetchJson<{ promoCodes: Array<Record<string, unknown>> }>('/api/sales/promo-codes');
      setPromos(r.promoCodes || []);
    } catch (e) {
      setPromos([]);
      const msg = (e as Error).message;
      setPromosError(msg);
      toast.error(msg);
    }
  }, [fetchJson]);

  useEffect(() => {
    if (tab === 'promos') {
      setLoading(true);
      void loadPromos().finally(() => setLoading(false));
    }
  }, [tab, loadPromos]);

  useEffect(() => {
    if (tab === 'segments' && canEditSalesContent(role)) {
      setLoading(true);
      void fetchJson<{ segments: Array<Record<string, unknown>> }>('/api/sales/segments')
        .then((r) => setSegments(r.segments || []))
        .catch((e: Error) => toast.error(e.message))
        .finally(() => setLoading(false));
    }
  }, [tab, role, fetchJson]);

  useEffect(() => {
    if (tab === 'leads') {
      void loadCampaigns();
    }
  }, [tab, loadCampaigns]);

  const loadAgentPerformance = useCallback(async () => {
    setAgentPerfError('');
    setLoading(true);
    try {
      const r = await fetchJson<{ agents: Array<Record<string, unknown>> }>(
        `/api/sales/reports/agent-performance?from=${perfFrom}&to=${perfTo}`
      );
      setAgentPerf(r.agents || []);
    } catch (e) {
      setAgentPerf([]);
      const msg = (e as Error).message;
      setAgentPerfError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [fetchJson, perfFrom, perfTo]);

  useEffect(() => {
    if (tab === 'performance') {
      void loadAgentPerformance();
    }
  }, [tab, loadAgentPerformance]);

  async function onCreateLead(e: FormEvent) {
    e.preventDefault();
    try {
      await fetchJson('/api/sales/leads', {
        method: 'POST',
        body: JSON.stringify({
          companyName: leadForm.companyName || undefined,
          contactName: leadForm.contactName,
          email: leadForm.email || undefined,
          phone: leadForm.phone || undefined,
          source: leadForm.source,
          status: leadForm.status,
          expectedValue: leadForm.expectedValue ? Number(leadForm.expectedValue) : undefined,
          campaignId: leadForm.campaignId || undefined
        })
      });
      toast.success('Lead created.');
      setLeadForm((f) => ({ ...f, companyName: '', contactName: '', email: '', phone: '', expectedValue: '' }));
      await loadLeadsBlock();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onCreateCorp(e: FormEvent) {
    e.preventDefault();
    try {
      await fetchJson('/api/sales/corporate-customers', {
        method: 'POST',
        body: JSON.stringify({
          legalName: corpForm.legalName,
          taxId: corpForm.taxId || undefined,
          billingEmail: corpForm.billingEmail || undefined,
          phone: corpForm.phone || undefined,
          defaultDiscountPercent: corpForm.defaultDiscountPercent ? Number(corpForm.defaultDiscountPercent) : undefined,
          notes: corpForm.notes || undefined
        })
      });
      toast.success('Corporate customer saved.');
      setCorpForm({ legalName: '', taxId: '', billingEmail: '', phone: '', defaultDiscountPercent: '', notes: '' });
      const r = await fetchJson<{ corporateCustomers: Array<Record<string, unknown>> }>('/api/sales/corporate-customers');
      setCorporate(r.corporateCustomers || []);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onCreateTA(e: FormEvent) {
    e.preventDefault();
    try {
      await fetchJson('/api/sales/travel-agents', {
        method: 'POST',
        body: JSON.stringify({
          companyName: taForm.companyName,
          contactName: taForm.contactName || undefined,
          email: taForm.email || undefined,
          phone: taForm.phone || undefined,
          iataCode: taForm.iataCode || undefined,
          userId: taForm.userId || undefined,
          commissionPercent: taForm.commissionPercent ? Number(taForm.commissionPercent) : undefined,
          notes: taForm.notes || undefined
        })
      });
      toast.success('Travel agent profile saved.');
      setTaForm({
        companyName: '',
        contactName: '',
        email: '',
        phone: '',
        iataCode: '',
        userId: '',
        commissionPercent: '',
        notes: ''
      });
      const r = await fetchJson<{ travelAgents: Array<Record<string, unknown>> }>('/api/sales/travel-agents');
      setTravelAgents(r.travelAgents || []);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onCreateCampaign(e: FormEvent) {
    e.preventDefault();
    try {
      await fetchJson('/api/sales/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: campForm.name,
          channel: campForm.channel,
          startDate: campForm.startDate,
          endDate: campForm.endDate,
          budgetAmount: campForm.budgetAmount ? Number(campForm.budgetAmount) : undefined,
          utmCampaign: campForm.utmCampaign || undefined
        })
      });
      toast.success('Campaign created.');
      await loadCampaigns();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onCreatePromo(e: FormEvent) {
    e.preventDefault();
    try {
      await fetchJson('/api/sales/promo-codes', {
        method: 'POST',
        body: JSON.stringify({
          code: promoForm.code,
          description: promoForm.description || undefined,
          discountType: promoForm.discountType,
          discountValue: Number(promoForm.discountValue),
          validFrom: promoForm.validFrom,
          validUntil: promoForm.validUntil,
          usageLimit: Number(promoForm.usageLimit)
        })
      });
      toast.success('Promo code created.');
      setPromoForm((f) => ({ ...f, code: '', description: '', discountValue: '' }));
      await loadPromos();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onValidatePromo(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await fetchJson<{ valid: boolean; discountAmount?: number; message?: string }>('/api/sales/promo-codes/validate', {
        method: 'POST',
        body: JSON.stringify({
          code: validateForm.code,
          travelDate: validateForm.travelDate,
          origin: validateForm.origin,
          dest: validateForm.dest,
          subtotal: Number(validateForm.subtotal)
        })
      });
      if (r.valid) toast.success(`Valid — discount ${formatSalesCurrency(r.discountAmount)}`);
      else toast.error(r.message || 'Invalid');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onAddRoutePromo(e: FormEvent) {
    e.preventDefault();
    if (!routePromo.promoId) return;
    try {
      await fetchJson(`/api/sales/promo-codes/${routePromo.promoId}/route-promotions`, {
        method: 'POST',
        body: JSON.stringify({ originAirport: routePromo.origin, destAirport: routePromo.dest })
      });
      toast.success('Route restriction added (promo applies only to listed routes when any exist).');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onCreateSegment(e: FormEvent) {
    e.preventDefault();
    try {
      await fetchJson('/api/sales/segments', {
        method: 'POST',
        body: JSON.stringify({ name: segForm.name, description: segForm.description || undefined, rulesJson: {} })
      });
      toast.success('Segment created.');
      const r = await fetchJson<{ segments: Array<Record<string, unknown>> }>('/api/sales/segments');
      setSegments(r.segments || []);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onAddSegmentMember(e: FormEvent) {
    e.preventDefault();
    try {
      await fetchJson(`/api/sales/segments/${segMember.segmentId}/members`, {
        method: 'POST',
        body: JSON.stringify({ passengerId: segMember.passengerId })
      });
      toast.success('Member added (if passenger exists).');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <main className="module-page">
      <section className="module-card">
        <h1>Sales &amp; marketing</h1>
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>
          Hawana Airways Management System (HAMS) commercial stack: revenue management signals, multi-channel
          distribution, corporate and agency programs, loyalty, ancillaries, automation rules, and executive KPIs — wired
          to bookings, finance, and audit. Pass <code>promoCode</code>, <code>campaignId</code>,{' '}
          <code>salesChannel</code>, <code>corporateAccountId</code>, and <code>travelAgentId</code> on booking creation
          where applicable.
        </p>
      </section>

      <div className="module-form-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        {(
          [
            ['dashboard', 'Marketing dashboard'],
            ['commercial', 'Commercial suite'],
            ['leads', 'Leads & pipeline'],
            ['corporate', 'Corporate'],
            ['agents', 'Travel agents'],
            ['promos', 'Promos & codes'],
            ['segments', 'Segments'],
            ['performance', 'Agent performance']
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? '' : 'secondary'}
            onClick={() => setTab(id)}
            disabled={
              (id === 'dashboard' && !canViewMarketingDash(role)) ||
              (id === 'commercial' && !canViewMarketingDash(role)) ||
              (id === 'corporate' && role && !['admin', 'super_admin', 'sales_manager', 'finance'].includes(role)) ||
              (id === 'agents' && role && !['admin', 'super_admin', 'sales_manager', 'operations'].includes(role)) ||
              (id === 'segments' && !canEditSalesContent(role))
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'commercial' && canViewMarketingDash(role) && (
        <SalesCommercialWorkspace fetchJson={fetchJson} role={role} />
      )}

      {tab === 'dashboard' && canViewMarketingDash(role) && (
        <section className="module-card">
          <h2>Campaign performance &amp; conversion</h2>
          {marketingDashError ? (
            <p style={{ margin: '0 0 0.5rem', color: '#b91c1c', fontSize: '0.9rem' }} role="alert">
              {marketingDashError}
            </p>
          ) : null}
          {loading && !dash ? (
            <p style={{ margin: 0, color: '#64748b' }}>Loading…</p>
          ) : (
            <>
              <h3 style={{ fontSize: '0.95rem' }}>Campaigns → bookings &amp; leads</h3>
              <table className="module-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Dates</th>
                    <th>Channel</th>
                    <th>Bookings</th>
                    <th>Revenue</th>
                    <th>Leads</th>
                    <th>Won leads</th>
                  </tr>
                </thead>
                <tbody>
                  {(dash?.campaigns || []).length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ color: '#64748b', fontSize: '0.85rem' }}>
                        No campaigns yet. Create one under Leads &amp; pipeline or via API.
                      </td>
                    </tr>
                  ) : null}
                  {(dash?.campaigns || []).map((c) => (
                    <tr key={String(c.id)}>
                      <td>{String(c.name)}</td>
                      <td>
                        {String(c.start_date)} → {String(c.end_date)}
                      </td>
                      <td>{String(c.channel || '—')}</td>
                      <td>{String(c.bookings_count)}</td>
                      <td>{formatSalesCurrency(c.booking_revenue)}</td>
                      <td>{String(c.leads_count)}</td>
                      <td>{String(c.leads_won)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3 style={{ fontSize: '0.95rem', marginTop: '0.75rem' }}>Lead pipeline</h3>
              <table className="module-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Count</th>
                    <th>Pipeline value</th>
                  </tr>
                </thead>
                <tbody>
                  {(dash?.leadPipeline || []).length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ color: '#64748b', fontSize: '0.85rem' }}>
                        No leads in the funnel yet.
                      </td>
                    </tr>
                  ) : null}
                  {(dash?.leadPipeline || []).map((p) => (
                    <tr key={String(p.status)}>
                      <td>{String(p.status)}</td>
                      <td>{String(p.count)}</td>
                      <td>{formatSalesCurrency(p.pipeline_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3 style={{ fontSize: '0.95rem', marginTop: '0.75rem' }}>Promo usage</h3>
              <table className="module-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Used / limit</th>
                    <th>Valid</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {(dash?.promoUsage || []).length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ color: '#64748b', fontSize: '0.85rem' }}>
                        No promo codes configured.
                      </td>
                    </tr>
                  ) : null}
                  {(dash?.promoUsage || []).map((p) => (
                    <tr key={String(p.id)}>
                      <td>{String(p.code)}</td>
                      <td>
                        {String(p.used_count)} / {String(p.usage_limit)}
                      </td>
                      <td>
                        {String(p.valid_from)} → {String(p.valid_until)}
                      </td>
                      <td>{p.active ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <button
            type="button"
            className="secondary"
            style={{ marginTop: '0.5rem' }}
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void loadMarketingDashboard().finally(() => setLoading(false));
            }}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </section>
      )}

      {tab === 'leads' && (
        <>
          {leadsBlockError ? (
            <section className="module-card">
              <p style={{ margin: 0, color: '#b91c1c', fontSize: '0.9rem' }} role="alert">
                {leadsBlockError}
              </p>
              <button
                type="button"
                className="secondary"
                style={{ marginTop: '0.5rem' }}
                disabled={loading}
                onClick={() => {
                  setLoading(true);
                  void loadLeadsBlock().finally(() => setLoading(false));
                }}
              >
                {loading ? 'Retrying…' : 'Retry'}
              </button>
            </section>
          ) : null}
          <section className="module-card">
            <h2>New lead</h2>
            <form onSubmit={onCreateLead} style={{ display: 'grid', gap: '0.45rem', maxWidth: 520 }}>
              <input placeholder="Company" value={leadForm.companyName} onChange={(e) => setLeadForm((f) => ({ ...f, companyName: e.target.value }))} />
              <input required placeholder="Contact name" value={leadForm.contactName} onChange={(e) => setLeadForm((f) => ({ ...f, contactName: e.target.value }))} />
              <input placeholder="Email" value={leadForm.email} onChange={(e) => setLeadForm((f) => ({ ...f, email: e.target.value }))} />
              <input placeholder="Phone" value={leadForm.phone} onChange={(e) => setLeadForm((f) => ({ ...f, phone: e.target.value }))} />
              <input placeholder="Source" value={leadForm.source} onChange={(e) => setLeadForm((f) => ({ ...f, source: e.target.value }))} />
              <label>
                Status
                <select value={leadForm.status} onChange={(e) => setLeadForm((f) => ({ ...f, status: e.target.value as (typeof LEAD_STATUSES)[number] }))}>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <input placeholder="Expected value" value={leadForm.expectedValue} onChange={(e) => setLeadForm((f) => ({ ...f, expectedValue: e.target.value }))} />
              <input placeholder="Campaign ID (optional)" value={leadForm.campaignId} onChange={(e) => setLeadForm((f) => ({ ...f, campaignId: e.target.value }))} />
              <button type="submit">Save lead</button>
            </form>
          </section>
          <section className="module-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h2 style={{ margin: 0 }}>Pipeline summary</h2>
              <button
                type="button"
                className="secondary"
                disabled={loading}
                onClick={() => {
                  setLoading(true);
                  void loadLeadsBlock().finally(() => setLoading(false));
                }}
              >
                {loading ? 'Refreshing…' : 'Refresh pipeline'}
              </button>
            </div>
            <table className="module-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Count</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {pipeline.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={3} style={{ color: '#64748b', fontSize: '0.85rem' }}>
                      No lead rows yet.
                    </td>
                  </tr>
                ) : null}
                {pipeline.map((p) => (
                  <tr key={String(p.status)}>
                    <td>{String(p.status)}</td>
                    <td>{String(p.count)}</td>
                    <td>{formatSalesCurrency(p.pipeline_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="module-card">
            <h2>All leads</h2>
            <table className="module-table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Campaign</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={String(l.id)}>
                    <td>{String(l.contact_name)}</td>
                    <td>{String(l.company_name || '—')}</td>
                    <td>{String(l.status)}</td>
                    <td>{String(l.campaign_name || '—')}</td>
                    <td>{String(l.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === 'corporate' && role && ['admin', 'super_admin', 'sales_manager', 'finance'].includes(role) && (
        <section className="module-card">
          <h2>Corporate customers</h2>
          {canEditSalesContent(role) ? (
            <form onSubmit={onCreateCorp} style={{ display: 'grid', gap: '0.45rem', maxWidth: 520 }}>
              <input required placeholder="Legal name" value={corpForm.legalName} onChange={(e) => setCorpForm((f) => ({ ...f, legalName: e.target.value }))} />
              <input placeholder="Tax ID" value={corpForm.taxId} onChange={(e) => setCorpForm((f) => ({ ...f, taxId: e.target.value }))} />
              <input placeholder="Billing email" value={corpForm.billingEmail} onChange={(e) => setCorpForm((f) => ({ ...f, billingEmail: e.target.value }))} />
              <input placeholder="Phone" value={corpForm.phone} onChange={(e) => setCorpForm((f) => ({ ...f, phone: e.target.value }))} />
              <input placeholder="Default discount %" value={corpForm.defaultDiscountPercent} onChange={(e) => setCorpForm((f) => ({ ...f, defaultDiscountPercent: e.target.value }))} />
              <textarea placeholder="Notes" value={corpForm.notes} onChange={(e) => setCorpForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
              <button type="submit">Add corporate</button>
            </form>
          ) : null}
          <table className="module-table" style={{ marginTop: '0.75rem' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Discount %</th>
              </tr>
            </thead>
            <tbody>
              {corporate.map((c) => (
                <tr key={String(c.id)}>
                  <td>{String(c.legal_name)}</td>
                  <td>{String(c.billing_email || '—')}</td>
                  <td>
                    {c.default_discount_percent != null ? formatPercent1Decimal(c.default_discount_percent) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'agents' && role && ['admin', 'super_admin', 'sales_manager', 'operations'].includes(role) && (
        <section className="module-card">
          <h2>Travel agents (B2B)</h2>
          {canEditSalesContent(role) ? (
            <form onSubmit={onCreateTA} style={{ display: 'grid', gap: '0.45rem', maxWidth: 520 }}>
              <input required placeholder="Company name" value={taForm.companyName} onChange={(e) => setTaForm((f) => ({ ...f, companyName: e.target.value }))} />
              <input placeholder="Contact" value={taForm.contactName} onChange={(e) => setTaForm((f) => ({ ...f, contactName: e.target.value }))} />
              <input placeholder="Email" value={taForm.email} onChange={(e) => setTaForm((f) => ({ ...f, email: e.target.value }))} />
              <input placeholder="IATA" value={taForm.iataCode} onChange={(e) => setTaForm((f) => ({ ...f, iataCode: e.target.value }))} />
              <input placeholder="Linked user UUID (optional)" value={taForm.userId} onChange={(e) => setTaForm((f) => ({ ...f, userId: e.target.value }))} />
              <input placeholder="Commission %" value={taForm.commissionPercent} onChange={(e) => setTaForm((f) => ({ ...f, commissionPercent: e.target.value }))} />
              <button type="submit">Save agent</button>
            </form>
          ) : null}
          <table className="module-table" style={{ marginTop: '0.75rem' }}>
            <thead>
              <tr>
                <th>Company</th>
                <th>IATA</th>
                <th>Commission</th>
                <th>Credit limit</th>
                <th>Credit balance</th>
                <th>Debt</th>
                <th>Linked user</th>
              </tr>
            </thead>
            <tbody>
              {travelAgents.map((t) => (
                <tr key={String(t.id)}>
                  <td>{String(t.company_name)}</td>
                  <td>{String(t.iata_code || '—')}</td>
                  <td>{t.commission_percent != null ? formatPercent1Decimal(t.commission_percent) : '—'}</td>
                  <td>{t.credit_limit != null ? formatSalesCurrency(t.credit_limit) : '—'}</td>
                  <td>{t.credit_balance != null ? formatSalesCurrency(t.credit_balance) : '—'}</td>
                  <td>{formatSalesCurrency(t.debt_balance)}</td>
                  <td>{String(t.linked_user_name || t.user_id || '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'promos' && (
        <>
          {promosError ? (
            <section className="module-card">
              <p style={{ margin: 0, color: '#b91c1c', fontSize: '0.9rem' }} role="alert">
                {promosError}
              </p>
              <button
                type="button"
                className="secondary"
                style={{ marginTop: '0.5rem' }}
                disabled={loading}
                onClick={() => {
                  setLoading(true);
                  void loadPromos().finally(() => setLoading(false));
                }}
              >
                {loading ? 'Retrying…' : 'Retry'}
              </button>
            </section>
          ) : null}
          {canEditSalesContent(role) && (
            <section className="module-card">
              <h2>New promotional / discount code</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
                Requires start and end date, discount type (percent or fixed), and usage limit. Route restrictions are
                optional; if any exist, the code only applies to those airport pairs.
              </p>
              <form onSubmit={onCreatePromo} style={{ display: 'grid', gap: '0.45rem', maxWidth: 520 }}>
                <input required placeholder="Code" value={promoForm.code} onChange={(e) => setPromoForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />
                <input placeholder="Description" value={promoForm.description} onChange={(e) => setPromoForm((f) => ({ ...f, description: e.target.value }))} />
                <label>
                  Type
                  <select
                    value={promoForm.discountType}
                    onChange={(e) => setPromoForm((f) => ({ ...f, discountType: e.target.value as 'PERCENT' | 'FIXED_AMOUNT' }))}
                  >
                    <option value="PERCENT">Percent</option>
                    <option value="FIXED_AMOUNT">Fixed amount</option>
                  </select>
                </label>
                <input required type="number" step="0.01" placeholder="Value (% or amount)" value={promoForm.discountValue} onChange={(e) => setPromoForm((f) => ({ ...f, discountValue: e.target.value }))} />
                <label>
                  Valid from
                  <input type="date" value={promoForm.validFrom} onChange={(e) => setPromoForm((f) => ({ ...f, validFrom: e.target.value }))} />
                </label>
                <label>
                  Valid until
                  <input type="date" value={promoForm.validUntil} onChange={(e) => setPromoForm((f) => ({ ...f, validUntil: e.target.value }))} />
                </label>
                <input required type="number" min={1} placeholder="Usage limit" value={promoForm.usageLimit} onChange={(e) => setPromoForm((f) => ({ ...f, usageLimit: e.target.value }))} />
                <button type="submit">Create code</button>
              </form>
              <h3 style={{ fontSize: '0.95rem', marginTop: '0.75rem' }}>Route promotion</h3>
              <form onSubmit={onAddRoutePromo} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'flex-end' }}>
                <input placeholder="Promo UUID" value={routePromo.promoId} onChange={(e) => setRoutePromo((f) => ({ ...f, promoId: e.target.value }))} />
                <input placeholder="Origin" value={routePromo.origin} onChange={(e) => setRoutePromo((f) => ({ ...f, origin: e.target.value.toUpperCase() }))} />
                <input placeholder="Dest" value={routePromo.dest} onChange={(e) => setRoutePromo((f) => ({ ...f, dest: e.target.value.toUpperCase() }))} />
                <button type="submit">Add route</button>
              </form>
            </section>
          )}
          <section className="module-card">
            <h2>Validate promo (preview)</h2>
            <form onSubmit={onValidatePromo} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'flex-end' }}>
              <input placeholder="Code" value={validateForm.code} onChange={(e) => setValidateForm((f) => ({ ...f, code: e.target.value }))} />
              <input type="date" value={validateForm.travelDate} onChange={(e) => setValidateForm((f) => ({ ...f, travelDate: e.target.value }))} />
              <input placeholder="Origin" value={validateForm.origin} onChange={(e) => setValidateForm((f) => ({ ...f, origin: e.target.value.toUpperCase() }))} />
              <input placeholder="Dest" value={validateForm.dest} onChange={(e) => setValidateForm((f) => ({ ...f, dest: e.target.value.toUpperCase() }))} />
              <input placeholder="Subtotal" value={validateForm.subtotal} onChange={(e) => setValidateForm((f) => ({ ...f, subtotal: e.target.value }))} />
              <button type="submit">Validate</button>
            </form>
          </section>
          <section className="module-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h2 style={{ margin: 0 }}>Codes</h2>
              <button
                type="button"
                className="secondary"
                disabled={loading}
                onClick={() => {
                  setLoading(true);
                  void loadPromos().finally(() => setLoading(false));
                }}
              >
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <table className="module-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Type</th>
                  <th>Value</th>
                  <th>Validity</th>
                  <th>Used / limit</th>
                </tr>
              </thead>
              <tbody>
                {promos.length === 0 && !loading && !promosError ? (
                  <tr>
                    <td colSpan={5} style={{ color: '#64748b', fontSize: '0.85rem' }}>
                      No promo codes yet.
                    </td>
                  </tr>
                ) : null}
                {promos.map((p) => (
                  <tr key={String(p.id)}>
                    <td>{String(p.code)}</td>
                    <td>{String(p.discount_type)}</td>
                    <td>{formatPromoDiscountDisplay(p.discount_type, p.discount_value)}</td>
                    <td>
                      {String(p.valid_from)} → {String(p.valid_until)}
                    </td>
                    <td>
                      {String(p.used_count)} / {String(p.usage_limit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === 'segments' && canEditSalesContent(role) && (
        <section className="module-card">
          <h2>Customer segments</h2>
          <form onSubmit={onCreateSegment} style={{ display: 'grid', gap: '0.45rem', maxWidth: 480 }}>
            <input required placeholder="Name" value={segForm.name} onChange={(e) => setSegForm((f) => ({ ...f, name: e.target.value }))} />
            <textarea placeholder="Description" value={segForm.description} onChange={(e) => setSegForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
            <button type="submit">Create segment</button>
          </form>
          <form onSubmit={onAddSegmentMember} style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'flex-end' }}>
            <input placeholder="Segment UUID" value={segMember.segmentId} onChange={(e) => setSegMember((f) => ({ ...f, segmentId: e.target.value }))} />
            <input placeholder="Passenger UUID" value={segMember.passengerId} onChange={(e) => setSegMember((f) => ({ ...f, passengerId: e.target.value }))} />
            <button type="submit">Add member</button>
          </form>
          <table className="module-table" style={{ marginTop: '0.75rem' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Members</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => (
                <tr key={String(s.id)}>
                  <td>{String(s.name)}</td>
                  <td>{String(s.member_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'performance' && (
        <section className="module-card">
          <h2>Agent performance (bookings &amp; tickets)</h2>
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#64748b' }}>
            Metrics use bookings where <code>created_by</code> is an agent user, in the selected date range.
          </p>
          {agentPerfError ? (
            <p style={{ margin: '0 0 0.5rem', color: '#b91c1c', fontSize: '0.9rem' }} role="alert">
              {agentPerfError}
            </p>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'flex-end' }}>
            <label>
              From
              <input type="date" value={perfFrom} onChange={(e) => setPerfFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={perfTo} onChange={(e) => setPerfTo(e.target.value)} />
            </label>
            <button type="button" onClick={() => void loadAgentPerformance()} disabled={loading}>
              {loading ? 'Loading…' : 'Load'}
            </button>
          </div>
          <table className="module-table" style={{ marginTop: '0.65rem' }}>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Bookings</th>
                <th>Revenue</th>
                <th>Tickets issued</th>
              </tr>
            </thead>
            <tbody>
              {agentPerf.length === 0 && !loading && !agentPerfError ? (
                <tr>
                  <td colSpan={4} style={{ color: '#64748b', fontSize: '0.85rem' }}>
                    No agent booking activity in this range.
                  </td>
                </tr>
              ) : null}
              {agentPerf.map((a) => (
                <tr key={String(a.user_id)}>
                  <td>{String(a.full_name)}</td>
                  <td>{String(a.bookings_count)}</td>
                  <td>{formatSalesCurrency(a.booking_revenue)}</td>
                  <td>{String(a.tickets_issued)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {canEditSalesContent(role) && tab === 'leads' && (
        <section className="module-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 style={{ margin: 0 }}>Campaign list (for lead / booking attribution)</h2>
            <button
              type="button"
              className="secondary"
              disabled={loading}
              onClick={() => void loadCampaigns()}
            >
              Refresh list
            </button>
          </div>
          {campaignsError ? (
            <p style={{ margin: '0.5rem 0', color: '#b91c1c', fontSize: '0.9rem' }} role="alert">
              {campaignsError}
            </p>
          ) : null}
          <form onSubmit={onCreateCampaign} style={{ display: 'grid', gap: '0.45rem', maxWidth: 520 }}>
            <input required placeholder="Campaign name" value={campForm.name} onChange={(e) => setCampForm((f) => ({ ...f, name: e.target.value }))} />
            <input placeholder="Channel" value={campForm.channel} onChange={(e) => setCampForm((f) => ({ ...f, channel: e.target.value }))} />
            <label>
              Start
              <input type="date" value={campForm.startDate} onChange={(e) => setCampForm((f) => ({ ...f, startDate: e.target.value }))} />
            </label>
            <label>
              End
              <input type="date" value={campForm.endDate} onChange={(e) => setCampForm((f) => ({ ...f, endDate: e.target.value }))} />
            </label>
            <input placeholder="Budget" value={campForm.budgetAmount} onChange={(e) => setCampForm((f) => ({ ...f, budgetAmount: e.target.value }))} />
            <input placeholder="UTM campaign" value={campForm.utmCampaign} onChange={(e) => setCampForm((f) => ({ ...f, utmCampaign: e.target.value }))} />
            <button type="submit">Create campaign</button>
          </form>
          <table className="module-table" style={{ marginTop: '0.75rem' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Dates</th>
                <th>Channel</th>
                <th>Budget</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 && !campaignsError ? (
                <tr>
                  <td colSpan={4} style={{ color: '#64748b', fontSize: '0.85rem' }}>
                    No campaigns yet. Create one above.
                  </td>
                </tr>
              ) : null}
              {campaigns.map((c) => {
                const rawCur = String(c.currency || '').trim().toUpperCase();
                const cur = /^[A-Z]{3}$/.test(rawCur) ? rawCur : SALES_DISPLAY_CURRENCY;
                return (
                  <tr key={String(c.id)}>
                    <td>{String(c.name)}</td>
                    <td>
                      {String(c.start_date)} → {String(c.end_date)}
                    </td>
                    <td>{String(c.channel || '—')}</td>
                    <td>
                      {c.budget_amount != null && Number.isFinite(Number(c.budget_amount))
                        ? formatSalesCurrency(c.budget_amount, cur)
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
