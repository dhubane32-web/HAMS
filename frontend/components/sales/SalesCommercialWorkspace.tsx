'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import type { UserRole } from '@/lib/roles';
import { getPublicApiBaseUrl } from '@/lib/api-base';
import { getClientAuthToken } from '@/lib/auth-session';
import {
  formatLoadFactorPercent,
  formatPercent1Decimal,
  formatSalesCurrency
} from '@/lib/sales-format';

type FetchJson = <T,>(path: string, init?: RequestInit) => Promise<T>;

type Sub = 'kpi' | 'rm' | 'channels' | 'crm' | 'loyalty' | 'ancillary' | 'automation' | 'routes' | 'export';

export default function SalesCommercialWorkspace({
  fetchJson,
  role
}: {
  fetchJson: FetchJson;
  role: UserRole | null;
}) {
  const [sub, setSub] = useState<Sub>('kpi');
  const [busy, setBusy] = useState(false);

  const canFin = role && ['admin', 'super_admin', 'sales_manager', 'finance'].includes(role);
  const canEdit = role && ['admin', 'super_admin', 'sales_manager'].includes(role);

  const [kpi, setKpi] = useState<Record<string, unknown> | null>(null);
  const [rm, setRm] = useState<Record<string, unknown> | null>(null);
  const [channels, setChannels] = useState<Array<Record<string, unknown>>>([]);
  const [chReport, setChReport] = useState<Array<Record<string, unknown>>>([]);
  const [crm, setCrm] = useState<Array<Record<string, unknown>>>([]);
  const [loyalty, setLoyalty] = useState<Array<Record<string, unknown>>>([]);
  const [ancillary, setAncillary] = useState<Array<Record<string, unknown>>>([]);
  const [autoRules, setAutoRules] = useState<Array<Record<string, unknown>>>([]);
  const [routeProfit, setRouteProfit] = useState<Array<Record<string, unknown>>>([]);
  const [salesChannels, setSalesChannels] = useState<Array<Record<string, unknown>>>([]);

  const loadKpi = useCallback(async () => {
    if (!canFin) return;
    const d = await fetchJson<Record<string, unknown>>('/api/sales/commercial/kpis');
    setKpi(d);
  }, [fetchJson, canFin]);

  const loadRm = useCallback(async () => {
    if (!canFin) return;
    const d = await fetchJson<Record<string, unknown>>('/api/sales/revenue-management/summary');
    setRm(d);
  }, [fetchJson, canFin]);

  const loadChannels = useCallback(async () => {
    if (!canFin) return;
    const [c, r] = await Promise.all([
      fetchJson<{ channels: Array<Record<string, unknown>> }>('/api/sales/sales-channels'),
      fetchJson<{ rows: Array<Record<string, unknown>> }>(
        `/api/sales/distribution/channel-report?from=${new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`
      )
    ]);
    setSalesChannels(c.channels || []);
    setChReport(r.rows || []);
  }, [fetchJson, canFin]);

  const loadCrm = useCallback(async () => {
    if (!canFin) return;
    const d = await fetchJson<{ customers: Array<Record<string, unknown>> }>('/api/sales/crm/customers?limit=120');
    setCrm(d.customers || []);
  }, [fetchJson, canFin]);

  const loadLoyalty = useCallback(async () => {
    if (!canFin) return;
    const d = await fetchJson<{ accounts: Array<Record<string, unknown>> }>('/api/sales/loyalty/accounts');
    setLoyalty(d.accounts || []);
  }, [fetchJson, canFin]);

  const loadAncillary = useCallback(async () => {
    if (!canFin) return;
    const d = await fetchJson<{ sales: Array<Record<string, unknown>> }>('/api/sales/ancillary-sales');
    setAncillary(d.sales || []);
  }, [fetchJson, canFin]);

  const loadAuto = useCallback(async () => {
    if (!canEdit) return;
    const d = await fetchJson<{ rules: Array<Record<string, unknown>> }>('/api/sales/automation-rules');
    setAutoRules(d.rules || []);
  }, [fetchJson, canEdit]);

  const loadRoutes = useCallback(async () => {
    if (!canFin) return;
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const d = await fetchJson<{ rows: Array<Record<string, unknown>> }>(
      `/api/sales/route-profitability?from=${from}&to=${to}`
    );
    setRouteProfit(d.rows || []);
  }, [fetchJson, canFin]);

  useEffect(() => {
    if (!canFin && !canEdit) return;
    setBusy(true);
    const run = async () => {
      try {
        if (sub === 'kpi') await loadKpi();
        if (sub === 'rm') await loadRm();
        if (sub === 'channels') await loadChannels();
        if (sub === 'crm') await loadCrm();
        if (sub === 'loyalty') await loadLoyalty();
        if (sub === 'ancillary') await loadAncillary();
        if (sub === 'automation') await loadAuto();
        if (sub === 'routes') await loadRoutes();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    void run();
  }, [sub, canFin, canEdit, loadKpi, loadRm, loadChannels, loadCrm, loadLoyalty, loadAncillary, loadAuto, loadRoutes]);

  if (!canFin && !canEdit) {
    return <p className="module-card">Commercial workspace requires Sales or Finance access.</p>;
  }

  const tabs: { id: Sub; label: string }[] = [
    { id: 'kpi', label: 'Executive KPIs' },
    { id: 'rm', label: 'Revenue management' },
    { id: 'channels', label: 'Distribution' },
    { id: 'crm', label: 'CRM' },
    { id: 'loyalty', label: 'Loyalty' },
    { id: 'ancillary', label: 'Ancillaries' },
    { id: 'automation', label: 'Email / SMS rules' },
    { id: 'routes', label: 'Route P&L' },
    { id: 'export', label: 'Export' }
  ];

  return (
    <section className="module-card" style={{ marginTop: '0.75rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '0.75rem' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={sub === t.id ? undefined : 'secondary'}
            style={{ fontSize: '0.78rem', padding: '0.35rem 0.55rem' }}
            onClick={() => setSub(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {busy && <p style={{ color: '#64748b', fontSize: '0.85rem' }}>Loading commercial data…</p>}

      {sub === 'kpi' && kpi && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.65rem' }}>
          <KpiCard
            label="Today revenue"
            value={formatSalesCurrency((kpi.today as { revenue?: number })?.revenue ?? 0)}
          />
          <KpiCard
            label="Week revenue"
            value={formatSalesCurrency((kpi.week as { revenue?: number })?.revenue ?? 0)}
          />
          <KpiCard
            label="Month revenue"
            value={formatSalesCurrency((kpi.month as { revenue?: number })?.revenue ?? 0)}
          />
          <KpiCard label="Avg fare (30d)" value={formatSalesCurrency(kpi.averageFare ?? 0)} />
          <KpiCard label="Network load factor (MTD)" value={formatLoadFactorPercent(kpi.loadFactor)} />
          <KpiCard
            label="Top route (revenue)"
            value={
              (kpi.topRoute as { route?: string; revenue?: number } | null)?.route
                ? `${String((kpi.topRoute as { route?: string }).route)} · ${formatSalesCurrency((kpi.topRoute as { revenue?: number }).revenue)}`
                : '—'
            }
          />
        </div>
      )}

      {sub === 'kpi' && kpi && (kpi.loadFactorScope as Record<string, unknown> | undefined) && (
        <div style={{ marginTop: '0.65rem', fontSize: '0.82rem', color: '#475569' }}>
          <p style={{ margin: '0 0 0.35rem' }}>
            <strong>Load factor audit (scheduled departures)</strong> —{' '}
            {String((kpi.loadFactorScope as { departureFrom?: string }).departureFrom || '').slice(0, 10)} to{' '}
            {String((kpi.loadFactorScope as { departureBeforeExclusive?: string }).departureBeforeExclusive || '').slice(0, 10)}{' '}
            (exclusive end):{' '}
            <strong>{Number((kpi.loadFactorScope as { totalSeatsSold?: number }).totalSeatsSold || 0).toLocaleString('en-US')}</strong>{' '}
            seats sold /{' '}
            <strong>
              {Number((kpi.loadFactorScope as { totalSeatsAvailable?: number }).totalSeatsAvailable || 0).toLocaleString(
                'en-US'
              )}
            </strong>{' '}
            seats available on{' '}
            <strong>{Number((kpi.loadFactorScope as { flightLegCount?: number }).flightLegCount || 0)}</strong> legs (aircraft
            assigned). <strong>Sold</strong> counts passengers with <strong>issued tickets</strong> on each leg (
            <code>sm_seat_leg_allocation</code>). Network LF = sold ÷ available (not an average of leg ratios).
          </p>
          {(Array.isArray(kpi.perFlightLoadFactor) ? kpi.perFlightLoadFactor : []).length > 0 ? (
            <div style={{ overflow: 'auto', maxHeight: 260 }}>
              <table className="module-table" style={{ fontSize: '0.76rem' }}>
                <thead>
                  <tr>
                    <th>Flight</th>
                    <th>Route</th>
                    <th>Departs</th>
                    <th>Sold</th>
                    <th>Capacity</th>
                    <th>LF</th>
                  </tr>
                </thead>
                <tbody>
                  {(kpi.perFlightLoadFactor as Array<Record<string, unknown>>).map((row) => (
                    <tr key={String(row.flightId)}>
                      <td>{String(row.flightNumber)}</td>
                      <td>
                        {String(row.origin)}→{String(row.dest)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{String(row.departureTime).slice(0, 16)}</td>
                      <td>{String(row.seatsSold)}</td>
                      <td>{String(row.seatsAvailable)}</td>
                      <td>{formatLoadFactorPercent(row.loadFactor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ margin: 0, color: '#94a3b8' }}>No qualifying flight legs in this departure window.</p>
          )}
        </div>
      )}

      {sub === 'kpi' && kpi && kpi.routeAnalytics && typeof kpi.routeAnalytics === 'object' && (
        <RouteAnalyticsPanel analytics={kpi.routeAnalytics as Record<string, unknown>} title="Route analytics (MTD departures)" />
      )}

      {sub === 'rm' && rm && (
        <div style={{ fontSize: '0.86rem', color: '#334155' }}>
          <p style={{ marginTop: 0 }}>
            <strong>Hawana Airways — revenue management.</strong> Fare families, RBD mapping (Y/B/M/K/Q/V/L), seasonal rules,
            and bucket policy are stored in Postgres. Use master data for published fares; this view summarizes RM
            configuration.
          </p>
          <p>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() =>
                fetchJson('/api/sales/revenue-management/recalculate-buckets', { method: 'POST', body: '{}' }).then(
                  () => toast.success('Buckets refreshed'),
                  (e: Error) => toast.error(e.message)
                )
              }
            >
              Recalculate load-factor buckets
            </button>
          </p>
          {rm.loadFactor &&
            typeof rm.loadFactor === 'object' &&
            (rm.loadFactor as { perFlightLoadFactor?: unknown }).perFlightLoadFactor != null && (
              <div style={{ marginBottom: '0.75rem' }}>
                <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.9rem' }}>
                  Load factor ({String((rm.loadFactor as { departureFrom?: string }).departureFrom || '').slice(0, 10)} →{' '}
                  {String((rm.loadFactor as { departureBeforeExclusive?: string }).departureBeforeExclusive || '').slice(0, 10)})
                </h4>
                <p style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', color: '#64748b' }}>
                  Network: {formatLoadFactorPercent((rm.loadFactor as { networkLoadFactor?: number }).networkLoadFactor)} —{' '}
                  {(rm.loadFactor as { totalSeatsSold?: number }).totalSeatsSold?.toLocaleString('en-US')} sold /{' '}
                  {(rm.loadFactor as { totalSeatsAvailable?: number }).totalSeatsAvailable?.toLocaleString('en-US')} seats on{' '}
                  {(rm.loadFactor as { flightLegCount?: number }).flightLegCount} legs.
                </p>
                <div style={{ overflow: 'auto', maxHeight: 220 }}>
                  <table className="module-table" style={{ fontSize: '0.76rem' }}>
                    <thead>
                      <tr>
                        <th>Flight</th>
                        <th>Route</th>
                        <th>Sold</th>
                        <th>Cap</th>
                        <th>LF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        (rm.loadFactor as { perFlightLoadFactor: Array<Record<string, unknown>> }).perFlightLoadFactor ||
                        []
                      )
                        .slice(0, 40)
                        .map((row) => (
                          <tr key={String(row.flightId)}>
                            <td>{String(row.flightNumber)}</td>
                            <td>
                              {String(row.origin)}→{String(row.dest)}
                            </td>
                            <td>{String(row.seatsSold)}</td>
                            <td>{String(row.seatsAvailable)}</td>
                            <td>{formatLoadFactorPercent(row.loadFactor)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          {rm.routeAnalytics && typeof rm.routeAnalytics === 'object' && (
            <RouteAnalyticsPanel
              analytics={rm.routeAnalytics as Record<string, unknown>}
              title="Route analytics (summary date range)"
            />
          )}
          <pre style={{ maxHeight: 280, overflow: 'auto', background: '#f8fafc', padding: '0.75rem', fontSize: '0.72rem' }}>
            {JSON.stringify(
              {
                policy: rm.rmPolicy,
                fareFamilies: rm.fareFamilies,
                fareClasses: (rm.fareClasses as unknown[])?.slice(0, 30),
                topRoutes: rm.topRoutes
              },
              null,
              2
            )}
          </pre>
        </div>
      )}

      {sub === 'channels' && (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <h4 style={{ margin: 0 }}>Channel catalog</h4>
          <div style={{ overflow: 'auto', maxHeight: 200 }}>
            <table className="module-table" style={{ fontSize: '0.78rem' }}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Default commission %</th>
                </tr>
              </thead>
              <tbody>
                {salesChannels.map((c) => (
                  <tr key={String(c.code)}>
                    <td>{String(c.code)}</td>
                    <td>{String(c.name)}</td>
                    <td>{formatPercent1Decimal(c.default_commission_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4 style={{ margin: 0 }}>30-day performance</h4>
          <div style={{ overflow: 'auto', maxHeight: 220 }}>
            <table className="module-table" style={{ fontSize: '0.78rem' }}>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Bookings</th>
                  <th>Revenue</th>
                  <th>Avg value</th>
                </tr>
              </thead>
              <tbody>
                {chReport.map((r) => (
                  <tr key={String(r.channel)}>
                    <td>{String(r.channel)}</td>
                    <td>{String(r.bookings)}</td>
                    <td>{formatSalesCurrency(r.revenue)}</td>
                    <td>{formatSalesCurrency(r.avg_booking_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sub === 'crm' && (
        <div style={{ overflow: 'auto', maxHeight: 360 }}>
          <table className="module-table" style={{ fontSize: '0.78rem' }}>
            <thead>
              <tr>
                <th>Passenger</th>
                <th>Status</th>
                <th>Bookings</th>
                <th>Spend</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {crm.map((c) => (
                <tr key={String(c.passenger_id)}>
                  <td>
                    {String(c.first_name)} {String(c.last_name)}
                  </td>
                  <td>
                    <span className="hams-rbac-badge hams-rbac-badge--commercial">{String(c.status)}</span>
                  </td>
                  <td>{String(c.booking_count)}</td>
                  <td>{formatSalesCurrency(c.total_spend)}</td>
                  <td>{String(c.updated_at || '').slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'loyalty' && (
        <div style={{ overflow: 'auto', maxHeight: 360 }}>
          <table className="module-table" style={{ fontSize: '0.78rem' }}>
            <thead>
              <tr>
                <th>Member</th>
                <th>Tier</th>
                <th>Miles</th>
              </tr>
            </thead>
            <tbody>
              {loyalty.map((a) => (
                <tr key={String(a.id)}>
                  <td>
                    {String(a.first_name)} {String(a.last_name)}
                  </td>
                  <td>{String(a.tier)}</td>
                  <td>{String(a.miles_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'ancillary' && (
        <div style={{ overflow: 'auto', maxHeight: 360 }}>
          <table className="module-table" style={{ fontSize: '0.78rem' }}>
            <thead>
              <tr>
                <th>Booking</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {ancillary.map((a) => (
                <tr key={String(a.id)}>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{String(a.booking_id).slice(0, 8)}…</td>
                  <td>{String(a.product_code)}</td>
                  <td>{String(a.quantity)}</td>
                  <td>{formatSalesCurrency(a.unit_price)}</td>
                  <td>{String(a.created_at || '').slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'automation' && (
        <pre style={{ maxHeight: 320, overflow: 'auto', background: '#f8fafc', fontSize: '0.72rem', padding: '0.75rem' }}>
          {JSON.stringify(autoRules, null, 2)}
        </pre>
      )}

      {sub === 'routes' && (
        <div>
          <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
            Snapshots from <code>sm_route_profitability</code>. Finance can recompute periodically.
          </p>
          <button
            type="button"
            disabled={!canEdit}
            onClick={() =>
              void fetchJson('/api/sales/route-profitability/recompute', {
                method: 'POST',
                body: JSON.stringify({})
              })
                .then(() => {
                  toast.success('Route P&L recomputed');
                  return loadRoutes();
                })
                .catch((e: Error) => toast.error(e.message))
            }
          >
            Recompute snapshot
          </button>
          <pre style={{ maxHeight: 280, overflow: 'auto', marginTop: '0.5rem', fontSize: '0.72rem' }}>
            {JSON.stringify(routeProfit.slice(0, 40), null, 2)}
          </pre>
        </div>
      )}

      {sub === 'export' && canFin && (
        <p style={{ fontSize: '0.88rem' }}>
          <button
            type="button"
            onClick={async () => {
              const token = getClientAuthToken() || '';
              const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
              const to = new Date().toISOString().slice(0, 10);
              const base = getPublicApiBaseUrl();
              const res = await fetch(`${base}/api/sales/reports/sales-export?format=csv&from=${from}&to=${to}`, {
                headers: { Authorization: `Bearer ${token || ''}` }
              });
              if (!res.ok) {
                toast.error('Export failed');
                return;
              }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `hawana-sales-${from}_${to}.csv`;
              a.click();
              URL.revokeObjectURL(url);
              toast.success('CSV downloaded');
            }}
          >
            Download sales CSV (7 days)
          </button>
        </p>
      )}
    </section>
  );
}

type RouteLeader = {
  route?: string;
  revenue?: number;
  bookings?: number;
  yieldPerPax?: number;
  yieldPerSeat?: number | null;
  loadFactor?: number | null;
  seatsAvailable?: number;
  seatsSold?: number;
} | null;

function RouteAnalyticsPanel({
  analytics,
  title
}: {
  analytics: Record<string, unknown>;
  title?: string;
}) {
  const scope = analytics.scope as
    | { minCapacityForLfLeader?: number; minBookingsForWorst?: number; routeCount?: number }
    | undefined;
  const rows: { key: string; label: string; row: RouteLeader; detail: string }[] = [
    {
      key: 'rev',
      label: 'Highest revenue',
      row: analytics.highestRevenue as RouteLeader,
      detail: 'Sum of segment fare on legs with at least one issued ticket (same departure window).'
    },
    {
      key: 'book',
      label: 'Highest booked',
      row: analytics.highestBooked as RouteLeader,
      detail: 'Distinct PNRs with ≥1 issued-ticket seat on the O&D in the window.'
    },
    {
      key: 'yield',
      label: 'Best yield',
      row: analytics.bestYield as RouteLeader,
      detail: 'Best of revenue ÷ issued seat or revenue ÷ ticketed pax-legs on the O&D.'
    },
    {
      key: 'lf',
      label: 'Best load factor',
      row: analytics.bestLoadFactor as RouteLeader,
      detail: `Network LF on O&D: sold ÷ offered seats; only routes with ≥${scope?.minCapacityForLfLeader ?? 48} seats offered.`
    },
    {
      key: 'worst',
      label: 'Worst performing',
      row: analytics.worstPerforming as RouteLeader,
      detail: `Lowest LF when capacity ≥${scope?.minCapacityForLfLeader ?? 48} and bookings ≥${scope?.minBookingsForWorst ?? 2}; else lowest revenue among booked routes.`
    }
  ];

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <h4 style={{ margin: '0 0 0.25rem', fontSize: '0.9rem' }}>{title || 'Route analytics'}</h4>
      <p style={{ margin: 0, fontSize: '0.72rem', color: '#64748b' }}>
        {String(analytics.departureFrom || '').slice(0, 10)} → {String(analytics.departureBeforeExclusive || '').slice(0, 10)}{' '}
        · {scope?.routeCount ?? 0} {'O&D'} rows in scope.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '0.5rem',
          marginTop: '0.45rem'
        }}
      >
        {rows.map(({ key, label, row, detail }) => (
          <div
            key={key}
            title={detail}
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '0.5rem 0.6rem',
              background: '#fff',
              fontSize: '0.78rem',
              color: '#334155'
            }}
          >
            <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              {label}
            </div>
            <div style={{ fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{row?.route || '—'}</div>
            {key === 'rev' && row?.revenue != null && (
              <div style={{ marginTop: 2 }}>{formatSalesCurrency(row.revenue)}</div>
            )}
            {key === 'book' && row?.bookings != null && <div style={{ marginTop: 2 }}>{String(row.bookings)} bookings</div>}
            {key === 'yield' && (
              <div style={{ marginTop: 2 }}>
                {row?.yieldPerSeat != null && Number.isFinite(row.yieldPerSeat) ? (
                  <div>{formatSalesCurrency(row.yieldPerSeat)} / issued seat</div>
                ) : null}
                {row?.yieldPerPax != null && Number.isFinite(row.yieldPerPax) ? (
                  <div style={{ marginTop: 2, fontSize: '0.72rem', color: '#64748b' }}>
                    {formatSalesCurrency(row.yieldPerPax)} / pax-leg
                  </div>
                ) : null}
              </div>
            )}
            {key === 'lf' && row?.loadFactor != null && (
              <div style={{ marginTop: 2 }}>
                {formatLoadFactorPercent(row.loadFactor)} · {String(row.seatsSold ?? '—')} /{' '}
                {String(row.seatsAvailable ?? '—')} seats
              </div>
            )}
            {key === 'worst' && (
              <div style={{ marginTop: 2 }}>
                {row?.loadFactor != null && Number.isFinite(row.loadFactor)
                  ? formatLoadFactorPercent(row.loadFactor)
                  : row?.revenue != null
                    ? formatSalesCurrency(row.revenue)
                    : '—'}
                {row?.bookings != null ? ` · ${row.bookings} bookings` : ''}
              </div>
            )}
          </div>
        ))}
      </div>
      {(() => {
        const cabin = analytics.cabinAnalytics as
          | { byCabin?: Array<Record<string, unknown>>; byRouteAndCabin?: Array<Record<string, unknown>> }
          | undefined;
        const byCabin = cabin?.byCabin || [];
        const byRc = cabin?.byRouteAndCabin || [];
        if (byCabin.length === 0 && byRc.length === 0) return null;
        return (
          <div style={{ marginTop: '0.65rem' }}>
            <h5 style={{ margin: '0 0 0.35rem', fontSize: '0.82rem' }}>Cabin seat analytics (issued tickets)</h5>
            {byCabin.length > 0 ? (
              <div style={{ overflow: 'auto', maxHeight: 160, marginBottom: '0.45rem' }}>
                <table className="module-table" style={{ fontSize: '0.74rem' }}>
                  <thead>
                    <tr>
                      <th>Cabin</th>
                      <th>Seats sold</th>
                      <th>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCabin.map((c) => (
                      <tr key={String(c.cabin)}>
                        <td>{String(c.cabin)}</td>
                        <td>{String(c.seats_sold ?? c.seatsSold ?? '—')}</td>
                        <td>{formatSalesCurrency(c.revenue ?? c.segment_fare_sum)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {byRc.length > 0 ? (
              <div style={{ overflow: 'auto', maxHeight: 200 }}>
                <table className="module-table" style={{ fontSize: '0.72rem' }}>
                  <thead>
                    <tr>
                      <th>Route</th>
                      <th>Cabin</th>
                      <th>Sold</th>
                      <th>Revenue</th>
                      <th>Yield / seat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byRc.map((r, i) => (
                      <tr key={`${String(r.origin)}-${String(r.dest)}-${String(r.cabin)}-${i}`}>
                        <td>
                          {String(r.origin)}→{String(r.dest)}
                        </td>
                        <td>{String(r.cabin)}</td>
                        <td>{String(r.seats_sold ?? r.seatsSold ?? '—')}</td>
                        <td>{formatSalesCurrency(r.revenue ?? r.segment_fare_sum)}</td>
                        <td>
                          {r.yield_per_seat != null || r.yieldPerSeat != null
                            ? formatSalesCurrency(Number(r.yield_per_seat ?? r.yieldPerSeat))
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        );
      })()}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: '0.65rem 0.75rem',
        background: 'linear-gradient(180deg,#fff,#f8fafc)'
      }}
    >
      <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{value}</div>
    </div>
  );
}
