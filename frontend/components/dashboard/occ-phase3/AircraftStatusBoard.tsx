'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Plane } from 'lucide-react';
import type { OccAircraftBoard } from './occ-phase3-types';

type Props = { board: OccAircraftBoard };

export const AircraftStatusBoard = memo(function AircraftStatusBoard({ board }: Props) {
  return (
    <div className="occ-glass occ-card-lift h-full rounded-2xl border border-slate-200/90 p-4 shadow-sm ring-1 ring-slate-900/5 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Plane className="h-5 w-5 text-hawana-blue" aria-hidden />
            Aircraft status board
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {board.groundedCount > 0
              ? `${board.groundedCount} grounded — utilization and dispatch capacity reduced`
              : 'Fleet available for today’s program'}
          </p>
        </div>
        <Link href="/maintenance" className="text-xs font-semibold text-hawana-blue hover:underline">
          MX control →
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-2">
          <p className="text-[0.6rem] font-bold uppercase text-slate-500">Fleet health</p>
          <p className="text-lg font-bold text-slate-900">{board.fleetHealthPct != null ? `${board.fleetHealthPct}%` : '—'}</p>
        </div>
        <div className="rounded-lg border border-red-100 bg-red-50 px-2 py-2">
          <p className="text-[0.6rem] font-bold uppercase text-red-700">Grounded</p>
          <p className="text-lg font-bold text-red-900">{board.groundedCount}</p>
        </div>
        <div className="rounded-lg border border-sky-100 bg-sky-50 px-2 py-2">
          <p className="text-[0.6rem] font-bold uppercase text-sky-800">Utilization</p>
          <p className="text-lg font-bold text-sky-900">{board.utilizationPct != null ? `${board.utilizationPct}%` : '—'}</p>
        </div>
      </div>
      <ul className="occ-feed-scroll mt-3 max-h-48 space-y-1.5 overflow-y-auto">
        {board.aircraft.length === 0 ? (
          <li className="text-xs text-slate-500">No aircraft posture data</li>
        ) : (
          board.aircraft.map((a) => (
            <li
              key={a.registration}
              className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs ${
                String(a.state).toLowerCase().includes('hold') || String(a.state).toLowerCase().includes('aog')
                  ? 'border-red-200 bg-red-50'
                  : 'border-slate-100 bg-white'
              }`}
            >
              <div>
                <span className="font-bold text-slate-900">{a.registration}</span>
                <span className="ml-1.5 text-slate-500">{a.type}</span>
              </div>
              <div className="text-right">
                <p className="font-medium text-slate-700">{a.state}</p>
                <p className="text-slate-500">{a.airport}{a.nextFlight ? ` · ${a.nextFlight}` : ''}</p>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
});
