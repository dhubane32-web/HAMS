'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Siren } from 'lucide-react';
import type { OccCriticalAlert } from './occ-phase3-types';

function formatTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type Props = { alerts: OccCriticalAlert[] };

export const LiveCriticalAlerts = memo(function LiveCriticalAlerts({ alerts }: Props) {
  return (
    <div className="occ-glass occ-card-lift flex h-full min-h-[240px] flex-col rounded-2xl border border-red-200/60 p-4 shadow-sm ring-1 ring-red-900/5 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-red-900">
        <Siren className="h-5 w-5" aria-hidden />
        Live critical alerts
      </h2>
      <p className="mt-0.5 text-xs text-red-800/80">Delays, cancellations, AOG, and crew escalations</p>
      <ul className="occ-feed-scroll mt-3 max-h-56 flex-1 space-y-2 overflow-y-auto pr-1">
        {alerts.length === 0 ? (
          <li className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
            No critical escalations — network nominal
          </li>
        ) : (
          alerts.map((a) => (
            <li
              key={a.id}
              className={`rounded-xl border px-3 py-2.5 text-sm ${
                a.severity === 'critical' ? 'occ-severity-critical' : 'occ-severity-warning'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.6rem] font-bold uppercase text-slate-600">
                    {a.domain}
                  </span>
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
          ))
        )}
      </ul>
    </div>
  );
});
