'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Users } from 'lucide-react';
import type { OccCrewIntel } from './occ-phase3-types';

type Props = { crew: OccCrewIntel };

export const CrewOpsPanel = memo(function CrewOpsPanel({ crew }: Props) {
  return (
    <div className="occ-glass occ-card-lift h-full rounded-2xl border border-slate-200/90 p-4 shadow-sm ring-1 ring-slate-900/5 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
        <Users className="h-5 w-5 text-hawana-blue" aria-hidden />
        Crew operations
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-center">
          <p className="text-xs text-slate-500">On duty</p>
          <p className="text-xl font-bold text-slate-900">{crew.onDuty}</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-center">
          <p className="text-xs text-slate-500">Standby</p>
          <p className="text-xl font-bold text-slate-900">{crew.standby}</p>
        </div>
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-center">
          <p className="text-xs text-amber-800">Gaps</p>
          <p className="text-xl font-bold text-amber-900">{crew.assignmentGaps}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 px-3 py-2 text-center">
          <p className="text-xs text-emerald-800">Rest alerts</p>
          <p className="text-xl font-bold text-emerald-900">{crew.restAlerts}</p>
        </div>
      </div>
      <div className="mt-4">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Duty hours</p>
        <ul className="mt-2 space-y-2">
          {crew.dutyHours.map((d) => {
            const pct = Math.min(100, Math.round((d.hours / d.maxHours) * 100));
            return (
              <li key={d.label}>
                <div className="flex justify-between text-xs text-slate-600">
                  <span>{d.label}</span>
                  <span>
                    {d.hours}h / {d.maxHours}h
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${pct >= 90 ? 'bg-amber-500' : 'bg-hawana-blue'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {crew.legalityWarnings.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {crew.legalityWarnings.map((w) => (
            <li key={w.id} className="rounded-lg border border-amber-200 bg-amber-50/80 px-2 py-1.5 text-xs text-amber-900">
              {w.message}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-100 bg-white/80 px-3 py-2 text-sm">
        <span>
          Pairings: <strong>{crew.pairingSummary.complete}</strong> complete /{' '}
          <strong className="text-amber-800">{crew.pairingSummary.open}</strong> open
        </span>
        <Link href="/crew" className="text-xs font-semibold text-hawana-blue hover:underline">
          Roster →
        </Link>
      </div>
    </div>
  );
});
