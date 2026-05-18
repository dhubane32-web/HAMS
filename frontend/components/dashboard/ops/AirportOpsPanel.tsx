'use client';

import { Building2 } from 'lucide-react';
import type { OperationalIntel } from './ops-types';

function congestionTone(level: string) {
  if (level === 'high') return 'text-red-800 bg-red-50 ring-red-200';
  if (level === 'medium') return 'text-amber-800 bg-amber-50 ring-amber-200';
  return 'text-emerald-800 bg-emerald-50 ring-emerald-200';
}

function baggageTone(status: string) {
  if (status === 'critical') return 'text-red-700';
  if (status === 'delayed') return 'text-amber-700';
  return 'text-emerald-700';
}

type Props = { intel: OperationalIntel };

export function AirportOpsPanel({ intel }: Props) {
  const airports = intel.airportOps;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 sm:text-base">
        <Building2 className="h-4 w-4 text-hawana-blue" aria-hidden />
        Airport operations
      </h3>
      <p className="text-xs text-slate-500">Gates, boarding, turnaround, baggage — derived from live flights</p>
      <div className="mt-3 space-y-2">
        {airports.length === 0 ? (
          <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-4 text-sm text-slate-500">No airport activity today.</p>
        ) : (
          airports.map((ap) => (
            <article key={ap.airport} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-slate-900">{ap.airport}</p>
                <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase ring-1 ${congestionTone(ap.congestion)}`}>{ap.congestion} congestion</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <p><span className="text-slate-500">Gates</span> <strong className="text-slate-900">{ap.gatesActive}</strong></p>
                <p><span className="text-slate-500">Boarding</span> <strong className="text-slate-900">{ap.boardingFlights}</strong></p>
                <p><span className="text-slate-500">Turnaround</span> <strong className="text-slate-900">{ap.avgTurnaroundMin}m</strong></p>
                <p><span className="text-slate-500">Baggage</span> <strong className={baggageTone(ap.baggageStatus)}>{ap.baggageStatus}</strong></p>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
