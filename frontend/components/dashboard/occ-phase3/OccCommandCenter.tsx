'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Radio } from 'lucide-react';
import type { OccAlert } from './occ-phase3-types';

const SEV_CLASS: Record<string, string> = {
  normal: 'occ-severity-normal',
  warning: 'occ-severity-warning',
  critical: 'occ-severity-critical'
};

function formatTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type Props = { alerts: OccAlert[] };

export const OccCommandCenter = memo(function OccCommandCenter({ alerts }: Props) {
  return (
    <div className="occ-glass occ-card-lift flex h-full min-h-[280px] flex-col rounded-2xl border border-slate-200/90 p-4 shadow-sm ring-1 ring-slate-900/5 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
        <Radio className="h-5 w-5 text-hawana-blue" aria-hidden />
        OCC command feed
      </h2>
      <p className="mt-0.5 text-xs text-slate-500">Dispatch, disruption, weather, and escalation signals</p>
      <ul className="occ-feed-scroll mt-3 max-h-72 flex-1 space-y-2 overflow-y-auto pr-1">
        {alerts.map((a) => (
          <li
            key={a.id}
            className={`rounded-xl border bg-white/90 px-3 py-2.5 text-sm ${SEV_CLASS[a.severity] || SEV_CLASS.normal}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.6rem] font-bold uppercase text-slate-600">
                    {a.category}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase ${
                      a.severity === 'critical'
                        ? 'bg-red-100 text-red-800'
                        : a.severity === 'warning'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-sky-100 text-sky-800'
                    }`}
                  >
                    {a.severity}
                  </span>
                </div>
                <p className="mt-1 font-medium text-slate-900">{a.message}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[0.65rem] text-slate-500">{formatTime(a.timestamp)}</p>
                <Link href={a.href} className="text-xs font-semibold text-hawana-blue hover:underline">
                  {a.actionLabel}
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
});
