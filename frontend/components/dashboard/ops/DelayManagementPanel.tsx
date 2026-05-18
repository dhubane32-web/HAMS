'use client';

import Link from 'next/link';
import { Timer } from 'lucide-react';
import type { OperationalIntel } from './ops-types';

function categoryChip(cat: string) {
  const c = String(cat || 'OPERATIONAL').toUpperCase();
  const tones: Record<string, string> = {
    WEATHER: 'bg-sky-100 text-sky-900 ring-sky-200',
    ATC: 'bg-violet-100 text-violet-900 ring-violet-200',
    TECHNICAL: 'bg-red-100 text-red-900 ring-red-200',
    CREW: 'bg-amber-100 text-amber-900 ring-amber-200',
    SECURITY: 'bg-slate-200 text-slate-900 ring-slate-300',
    DIVERSION: 'bg-orange-100 text-orange-900 ring-orange-200'
  };
  return tones[c] || 'bg-slate-100 text-slate-800 ring-slate-200';
}

function formatTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type Props = { intel: OperationalIntel };

export function DelayManagementPanel({ intel }: Props) {
  const rows = intel.delayedFlights;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 sm:text-base">
            <Timer className="h-4 w-4 text-hawana-blue" aria-hidden />
            Delay management
          </h3>
          <p className="text-xs text-slate-500">Active delays with operational category</p>
        </div>
        <Link href="/operations" className="text-sm font-semibold text-hawana-blue hover:underline">Operations hub →</Link>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-100">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Flight</th>
              <th className="px-3 py-2">Route</th>
              <th className="px-3 py-2">STD</th>
              <th className="px-3 py-2">Delay</th>
              <th className="px-3 py-2">Category</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No delayed flights recorded today.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="bg-white hover:bg-slate-50/80">
                  <td className="px-3 py-2 font-semibold text-slate-900">{r.flightNumber}</td>
                  <td className="px-3 py-2 text-slate-600">{r.route}</td>
                  <td className="px-3 py-2 text-slate-600">{formatTime(r.std)}</td>
                  <td className="px-3 py-2 font-semibold text-amber-800">+{r.delayMinutes}m</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${categoryChip(r.category)}`}>{r.category}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
