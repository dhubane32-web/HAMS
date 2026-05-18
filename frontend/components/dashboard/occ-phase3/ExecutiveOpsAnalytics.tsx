'use client';

import { memo, useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { OccAnalytics } from './occ-phase3-types';

const tooltipStyle = {
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  boxShadow: '0 8px 24px rgba(15,23,42,0.08)'
};

type Props = { analytics: OccAnalytics };

export const ExecutiveOpsAnalytics = memo(function ExecutiveOpsAnalytics({ analytics }: Props) {
  const lineCharts = useMemo(
    () => [
      { title: 'OTP (7d)', data: analytics.otpTrend, key: 'otpPct', color: '#16A34A', suffix: '%' },
      {
        title: 'Cancellations (7d)',
        data: analytics.cancellationTrend,
        key: 'cancellations',
        color: '#DC2626',
        suffix: ''
      },
      {
        title: 'Avg delay minutes (7d)',
        data: analytics.delayMinutesTrend,
        key: 'avgDelayMinutes',
        color: '#F59E0B',
        suffix: ' min'
      }
    ],
    [analytics]
  );

  const todayKpis = [
    { label: 'Load factor today', value: analytics.todayLoadFactorPct, suffix: '%' },
    { label: 'Fleet utilization today', value: analytics.todayUtilizationPct, suffix: '%' }
  ];

  return (
    <div className="occ-glass occ-card-lift rounded-2xl border border-slate-200/90 p-4 shadow-sm ring-1 ring-slate-900/5 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 sm:text-lg">
        <BarChart3 className="h-5 w-5 text-hawana-blue" aria-hidden />
        Operational analytics
      </h2>
      <p className="text-xs text-slate-500">Airline network metrics — OTP, disruptions, delays, and today&apos;s capacity</p>

      <div className="mt-3 flex flex-wrap gap-3">
        {todayKpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-slate-100 bg-white/90 px-4 py-2">
            <p className="text-[0.65rem] font-bold uppercase text-slate-500">{k.label}</p>
            <p className="text-xl font-bold tabular-nums text-slate-900">
              {k.value != null ? `${k.value}${k.suffix}` : '—'}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        {lineCharts.map((c) => (
          <div key={c.title} className="min-w-0 rounded-xl border border-slate-100 bg-white/90 p-3 lg:col-span-1">
            <p className="text-xs font-bold text-slate-700">{c.title}</p>
            <div className="mt-2 h-44 w-full min-w-0">
              {c.data.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={c.data as Record<string, number | string | null>[]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 9 }} stroke="#94a3b8" width={32} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v)}${c.suffix}`} />
                    <Line type="monotone" dataKey={c.key} stroke={c.color} strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="flex h-full items-center justify-center text-xs text-slate-400">No trend data</p>
              )}
            </div>
          </div>
        ))}

        <div className="min-w-0 rounded-xl border border-slate-100 bg-white/90 p-3 lg:col-span-1">
          <p className="text-xs font-bold text-slate-700">Disruption mix (today)</p>
          <div className="mt-2 h-44 w-full">
            {analytics.disruptionCategories.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.disruptionCategories} layout="vertical" margin={{ left: 4, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9 }} />
                  <YAxis type="category" dataKey="category" width={72} tick={{ fontSize: 8 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill="#0047AB" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-xs text-slate-400">No active disruptions</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
