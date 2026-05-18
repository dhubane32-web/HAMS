'use client';

import Link from 'next/link';
import { Users } from 'lucide-react';
import type { OperationalIntel } from './ops-types';

function sevTone(sev: string) {
  if (sev === 'critical') return 'border-l-red-600 bg-red-50';
  if (sev === 'warning') return 'border-l-amber-500 bg-amber-50';
  return 'border-l-sky-500 bg-sky-50';
}

function formatTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type Props = { intel: OperationalIntel };

export function CrewAlertsPanel({ intel }: Props) {
  const alerts = intel.crewAlerts;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 sm:text-base">
        <Users className="h-4 w-4 text-hawana-blue" aria-hidden />
        Crew alerts
      </h3>
      <p className="text-xs text-slate-500">Roster, credentials, and operational crew signals</p>
      <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
        {alerts.length === 0 ? (
          <li className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-4 text-sm text-slate-500">No crew alerts.</li>
        ) : (
          alerts.map((a) => (
            <li key={a.id} className={`rounded-lg border-l-4 px-3 py-2.5 text-sm ${sevTone(a.severity)}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{a.crewId}</p>
                  <p className="text-slate-700">{a.message}</p>
                </div>
                <span className="shrink-0 text-xs text-slate-500">{formatTime(a.timestamp)}</span>
              </div>
              <Link href={a.href} className="mt-1 inline-block text-xs font-semibold text-hawana-blue hover:underline">
                {a.actionLabel} →
              </Link>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
