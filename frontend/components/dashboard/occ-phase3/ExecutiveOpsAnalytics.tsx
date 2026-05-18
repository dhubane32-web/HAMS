'use client';

import { memo, useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { OccAnalytics } from './occ-phase3-types';

function formatMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

const tooltipStyle = {
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  boxShadow: '0 8px 24px rgba(15,23,42,0.08)'
};

type Props = { analytics: OccAnalytics };

export const ExecutiveOpsAnalytics = memo(function ExecutiveOpsAnalytics({ analytics }: Props) {
  const charts = useMemo(
    () => [
      { title: 'OTP trend', data: analytics.otpTrend, key: 'otpPct', color: '#16A34A', suffix: '%' },
      {
        title: 'Cancellations',
        data: analytics.cancellationTrend,
        key: 'cancellations',
        color: '#DC2626',
        suffix: ''
      },
      {
        title: 'Load factor',
        data: analytics.loadFactorTrend,
        key: 'loadFactorPct',
        color: '#0047AB',
        suffix: '%'
      },
      {
        title: 'Utilization',
        data: analytics.utilizationTrend,
        key: 'utilizationPct',
        color: '#0EA5E9',
        suffix: '%'
      },
      {
        title: 'Revenue (7d)',
        data: analytics.revenueTrend,
        key: 'amount',
        color: '#0047AB',
        suffix: '$',
        money: true
      }
    ],
    [analytics]
  );

  return (
    <div className="occ-glass occ-card-lift rounded-2xl border border-slate-200/90 p-4 shadow-sm ring-1 ring-slate-900/5 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 sm:text-lg">
        <BarChart3 className="h-5 w-5 text-hawana-blue" aria-hidden />
        Executive operations analytics
      </h2>
      <p className="text-xs text-slate-500">Network performance — 7-day operational and commercial trends</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {charts.map((c) => (
          <div key={c.title} className="min-w-0 rounded-xl border border-slate-100 bg-white/90 p-3">
            <p className="text-xs font-bold text-slate-700">{c.title}</p>
            <div className="mt-2 h-44 w-full min-w-0 sm:h-56">
              {c.data.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={c.data as Record<string, number | string | null>[]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 9 }} stroke="#94a3b8" width={28} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v) =>
                        c.money ? formatMoney(Number(v)) : `${Number(v)}${c.suffix}`
                      }
                    />
                    <Line type="monotone" dataKey={c.key} stroke={c.color} strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="flex h-full items-center justify-center text-xs text-slate-400">No data</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
