'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Plane } from 'lucide-react';
import type { OccLiveFlight } from './occ-phase3-types';

const STATUS_STYLES: Record<string, { bar: string; text: string; route: string }> = {
  enroute: { bar: 'bg-emerald-500', text: 'text-emerald-800 bg-emerald-50 ring-emerald-200', route: 'from-emerald-400 to-emerald-600' },
  boarding: { bar: 'bg-sky-500', text: 'text-sky-800 bg-sky-50 ring-sky-200', route: 'from-sky-400 to-sky-600' },
  delayed: { bar: 'bg-amber-500', text: 'text-amber-900 bg-amber-50 ring-amber-200', route: 'from-amber-400 to-amber-600' },
  cancelled: { bar: 'bg-red-400', text: 'text-red-800 bg-red-50 ring-red-200', route: 'from-red-400 to-red-600' },
  scheduled: { bar: 'bg-slate-400', text: 'text-slate-700 bg-slate-50 ring-slate-200', route: 'from-slate-300 to-slate-500' }
};

function formatEta(min: number) {
  if (min <= 0) return 'On block';
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

type Props = { flights: OccLiveFlight[] };

export const LiveFlightTrackingPanel = memo(function LiveFlightTrackingPanel({ flights }: Props) {
  return (
    <div className="occ-glass occ-card-lift rounded-2xl border border-slate-200/90 p-4 shadow-sm ring-1 ring-slate-900/5 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 sm:text-lg">
            <Plane className="h-5 w-5 text-hawana-blue" aria-hidden />
            Live flight tracking
          </h2>
          <p className="text-xs text-slate-500">Active legs with route progress and ETA</p>
        </div>
        <span className="text-xs text-slate-500">{flights.length} active leg(s)</span>
      </div>
      {flights.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
          No airborne or boarding flights in the current window.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {flights.map((f) => {
            const style = STATUS_STYLES[f.status] || STATUS_STYLES.scheduled;
            const pct = Math.max(0, Math.min(100, f.progressPct));
            return (
              <article
                key={f.id}
                className="rounded-xl border border-slate-100 bg-white/90 p-3 shadow-sm transition hover:border-hawana-blue/25"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-900">{f.flightNumber}</p>
                    <p className="text-xs text-slate-500">Gate {f.gate}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase ring-1 ${style.text}`}>
                    {f.status}
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-700">
                  {f.dep} → {f.arr}
                </p>
                <div className="mt-3">
                  <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${style.route} transition-all duration-700`}
                      style={{ width: `${pct}%` }}
                    />
                    <span
                      className="occ-plane-dot absolute top-1/2 z-10 -translate-y-1/2"
                      style={{ left: `calc(${pct}% - 6px)` }}
                      aria-hidden
                    >
                      <Plane className="h-3 w-3 text-hawana-navy" />
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between text-[0.65rem] text-slate-500">
                    <span>{f.dep}</span>
                    <span className="font-semibold text-slate-700">{pct}%</span>
                    <span>{f.arr}</span>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[0.65rem]">
                  <div className="rounded-lg bg-slate-50 py-1">
                    <p className="text-slate-500">Airborne</p>
                    <p className="font-bold text-slate-800">{f.airborneMinutes}m</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 py-1">
                    <p className="text-slate-500">ETA</p>
                    <p className="font-bold text-slate-800">{formatEta(f.etaMinutes)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 py-1">
                    <p className="text-slate-500">Track</p>
                    <Link href="/operations" className="font-bold text-hawana-blue hover:underline">
                      OCC
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
});
