'use client';

import { Plane } from 'lucide-react';
import type { OperationalIntel } from './ops-types';

function stateTone(state: string) {
  const s = String(state || '').toUpperCase();
  if (s.includes('DELAY')) return 'bg-amber-100 text-amber-900 ring-amber-200';
  if (s.includes('CANCEL')) return 'bg-red-100 text-red-800 ring-red-200';
  if (s.includes('BOARD') || s.includes('DEPART') || s.includes('AIR')) return 'bg-emerald-100 text-emerald-900 ring-emerald-200';
  return 'bg-slate-100 text-slate-800 ring-slate-200';
}

function formatTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type Props = { intel: OperationalIntel };

export function AircraftStatusPanel({ intel }: Props) {
  const fleet = intel.aircraftStatus;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 sm:text-base">
        <Plane className="h-4 w-4 text-hawana-blue" aria-hidden />
        Aircraft status
      </h3>
      <p className="text-xs text-slate-500">Fleet posture from today&apos;s departures</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {fleet.length === 0 ? (
          <p className="col-span-full rounded-lg border border-slate-100 bg-slate-50 px-3 py-4 text-sm text-slate-500">No aircraft on today&apos;s flights.</p>
        ) : (
          fleet.map((ac) => (
            <article key={ac.registration} className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-slate-900">{ac.registration}</p>
                <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold ring-1 ${stateTone(ac.state)}`}>{ac.state}</span>
              </div>
              <p className="text-xs text-slate-600">{ac.type}</p>
              <p className="mt-1 text-xs text-slate-500">{ac.airport} · {ac.nextFlight ?? '—'} · STD {formatTime(ac.nextDeparture)}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
