'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Wrench } from 'lucide-react';
import type { OccMaintenanceIntel } from './occ-phase3-types';

type Props = { maintenance: OccMaintenanceIntel };

export const MaintenanceIntelPanel = memo(function MaintenanceIntelPanel({ maintenance }: Props) {
  const health = maintenance.fleetHealthPct;
  return (
    <div className="occ-glass occ-card-lift h-full rounded-2xl border border-slate-200/90 p-4 shadow-sm ring-1 ring-slate-900/5 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
        <Wrench className="h-5 w-5 text-hawana-blue" aria-hidden />
        Maintenance intelligence
      </h2>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-xl bg-slate-50 py-2">
          <p className="text-xs text-slate-500">Fleet health</p>
          <p className="text-lg font-bold text-emerald-800">{health != null ? `${health}%` : '—'}</p>
        </div>
        <div className="rounded-xl bg-red-50 py-2">
          <p className="text-xs text-red-700">Grounded</p>
          <p className="text-lg font-bold text-red-800">{maintenance.groundedCount}</p>
        </div>
        <div className="rounded-xl bg-slate-50 py-2">
          <p className="text-xs text-slate-500">Utilization</p>
          <p className="text-lg font-bold text-slate-900">
            {maintenance.utilizationPct != null ? `${maintenance.utilizationPct}%` : '—'}
          </p>
        </div>
      </div>
      {maintenance.melAlerts.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {maintenance.melAlerts.map((m) => (
            <li key={m.id} className="occ-severity-warning rounded-lg px-2 py-1.5 text-xs">
              <strong>{m.tail}</strong> [{m.code}] {m.message}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {maintenance.cards.map((c) => (
          <Link
            key={`${c.tail}-${c.title}`}
            href={c.href}
            className="occ-card-lift rounded-xl border border-slate-100 bg-white/90 p-2.5 text-xs hover:border-hawana-blue/30"
          >
            <p className="font-bold text-slate-900">{c.tail}</p>
            <p className="mt-0.5 text-slate-600 line-clamp-2">{c.title}</p>
            <p className="mt-1 text-[0.65rem] font-semibold text-slate-500">{c.dueLabel}</p>
          </Link>
        ))}
      </div>
    </div>
  );
});
