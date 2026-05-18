'use client';

import { memo } from 'react';
import { MapPin } from 'lucide-react';
import type { OccStation } from './occ-phase3-types';

const DOT: Record<string, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500'
};

type Props = { stations: OccStation[] };

export const StationMonitorPanel = memo(function StationMonitorPanel({ stations }: Props) {
  return (
    <div className="occ-glass occ-card-lift h-full rounded-2xl border border-slate-200/90 p-4 shadow-sm ring-1 ring-slate-900/5 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
        <MapPin className="h-5 w-5 text-hawana-blue" aria-hidden />
        Station monitor
      </h2>
      <p className="mt-0.5 text-xs text-slate-500">Network stations — MGQ, NBO, HGA, BSA, GGR</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {stations.map((s) => (
          <article key={s.code} className="rounded-xl border border-slate-100 bg-white/90 p-3">
            <div className="flex items-center justify-between">
              <p className="text-lg font-bold text-slate-900">{s.code}</p>
              <span className={`h-2.5 w-2.5 rounded-full ${DOT[s.status] || DOT.green} occ-live-pulse`} aria-hidden />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[0.65rem]">
              <div><p className="text-slate-500">Flights</p><p className="font-bold">{s.flightsToday}</p></div>
              <div><p className="text-slate-500">Delays</p><p className="font-bold text-amber-800">{s.delays}</p></div>
              <div><p className="text-slate-500">Turnaround</p><p className="font-bold">{s.turnaroundPct != null ? `${s.turnaroundPct}%` : '—'}</p></div>
              <div><p className="text-slate-500">Boarding</p><p className="font-bold">{s.boardingProgressPct}%</p></div>
            </div>
            {s.baggageDelay && <p className="mt-2 text-[0.65rem] font-semibold text-red-700">Baggage delay flag</p>}
          </article>
        ))}
      </div>
    </div>
  );
});
