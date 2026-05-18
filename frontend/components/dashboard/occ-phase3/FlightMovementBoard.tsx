'use client';

import { memo } from 'react';
import Link from 'next/link';
import { PlaneTakeoff } from 'lucide-react';
import type { OccFlightMovement } from './occ-phase3-types';

const PRIORITY_CLASS: Record<string, string> = {
  critical: 'border-l-4 border-l-red-500 bg-red-50/80',
  warning: 'border-l-4 border-l-amber-500 bg-amber-50/60',
  normal: 'border-l-4 border-l-slate-200 bg-white/90'
};

function formatTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type Props = { flights: OccFlightMovement[] };

export const FlightMovementBoard = memo(function FlightMovementBoard({ flights }: Props) {
  return (
    <div className="occ-glass occ-card-lift flex h-full min-h-[320px] flex-col rounded-2xl border border-slate-200/90 p-4 shadow-sm ring-1 ring-slate-900/5 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <PlaneTakeoff className="h-5 w-5 text-hawana-blue" aria-hidden />
            Flight movement board
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">Today&apos;s departures — status, gate, and tail linked to network OTP</p>
        </div>
        <Link href="/flights" className="text-xs font-semibold text-hawana-blue hover:underline">
          Schedule →
        </Link>
      </div>
      <div className="occ-feed-scroll mt-3 flex-1 overflow-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="sticky top-0 bg-slate-50/95 text-[0.65rem] font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-2">Flight</th>
              <th className="px-2 py-2">Route</th>
              <th className="px-2 py-2">STD</th>
              <th className="px-2 py-2">Gate</th>
              <th className="px-2 py-2">Tail</th>
              <th className="px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {flights.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-8 text-center text-slate-400">
                  No movements scheduled today
                </td>
              </tr>
            ) : (
              flights.map((f) => (
                <tr key={f.id} className={`border-b border-slate-100 ${PRIORITY_CLASS[f.priority] || PRIORITY_CLASS.normal}`}>
                  <td className="px-2 py-2 font-semibold text-slate-900">{f.flightNumber}</td>
                  <td className="px-2 py-2 text-slate-700">{f.route}</td>
                  <td className="px-2 py-2 tabular-nums text-slate-600">{formatTime(f.departureTime)}</td>
                  <td className="px-2 py-2 text-slate-600">{f.gate}</td>
                  <td className="px-2 py-2 text-slate-600">{f.tail || '—'}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase ${
                        f.priority === 'critical'
                          ? 'bg-red-100 text-red-800'
                          : f.priority === 'warning'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {f.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
});
