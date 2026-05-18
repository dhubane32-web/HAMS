'use client';

import { memo } from 'react';
import { AlertTriangle, Ban, Clock, Plane, Users, Wrench } from 'lucide-react';
import type { OccCriticalAlert, OccNetworkHealth } from './occ-phase3-types';

const OTP_TONE: Record<string, string> = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  amber: 'border-amber-200 bg-amber-50 text-amber-950',
  red: 'border-red-200 bg-red-50 text-red-950'
};

type Props = {
  health: OccNetworkHealth;
  criticalAlerts: OccCriticalAlert[];
};

export const CriticalOpsRibbon = memo(function CriticalOpsRibbon({ health, criticalAlerts }: Props) {
  const critCount = criticalAlerts.filter((a) => a.severity === 'critical').length;

  return (
    <section className="occ-glass rounded-2xl border border-slate-200/90 p-4 shadow-sm ring-1 ring-slate-900/5 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-red-700">Network posture</p>
          <p className="mt-1 text-sm font-medium text-slate-800 sm:text-base">{health.impactSummary}</p>
          {critCount > 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-900">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              {critCount} critical escalation{critCount === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <div
          className={`shrink-0 rounded-xl border px-4 py-3 text-center ${OTP_TONE[health.otpStatus] || OTP_TONE.amber}`}
        >
          <p className="text-[0.65rem] font-bold uppercase tracking-wide">OTP today</p>
          <p className="text-3xl font-bold tabular-nums">{health.otpPct != null ? `${health.otpPct}%` : '—'}</p>
          <p className="text-[0.65rem] opacity-80">Target {health.targetOtp}%</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Delayed', value: health.delayedCount, icon: Clock, tone: 'text-amber-900 bg-amber-50 border-amber-100' },
          { label: 'Cancelled', value: health.cancelledCount, icon: Ban, tone: 'text-red-900 bg-red-50 border-red-100' },
          { label: 'Grounded', value: health.groundedCount, icon: Wrench, tone: 'text-red-900 bg-red-50 border-red-100' },
          { label: 'Fleet avail.', value: health.fleetAvailable, icon: Plane, tone: 'text-slate-900 bg-slate-50 border-slate-100' },
          { label: 'Dispatch pend.', value: health.dispatchPending, icon: AlertTriangle, tone: 'text-amber-900 bg-amber-50 border-amber-100' },
          { label: 'Boarding', value: health.boardingFlights, icon: Users, tone: 'text-sky-900 bg-sky-50 border-sky-100' }
        ].map((m) => {
          const Icon = m.icon;
          return (
            <article key={m.label} className={`rounded-xl border px-3 py-2.5 ${m.tone}`}>
              <header className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                <p className="text-[0.6rem] font-bold uppercase tracking-wide opacity-80">{m.label}</p>
              </header>
              <p className="mt-1 text-xl font-bold tabular-nums">{m.value}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
});
