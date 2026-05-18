'use client';

import { Clock, TrendingDown, TrendingUp } from 'lucide-react';
import type { OperationalIntel } from './ops-types';

function formatPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n}%`;
}

function statusRing(status: 'green' | 'amber' | 'red') {
  if (status === 'green') return 'border-emerald-500 bg-emerald-50 text-emerald-900';
  if (status === 'red') return 'border-red-500 bg-red-50 text-red-900';
  return 'border-amber-500 bg-amber-50 text-amber-900';
}

type Props = { intel: OperationalIntel };

export function OtpPanel({ intel }: Props) {
  const otp = intel.otpPanel;
  const trendUp = otp.trendPct >= 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 sm:text-base">
            <Clock className="h-4 w-4 text-hawana-blue" aria-hidden />
            On-time performance
          </h3>
          <p className="text-xs text-slate-500">Departure & arrival punctuality — today network</p>
        </div>
        <span
          className={`rounded-full border-2 px-3 py-1 text-xs font-bold uppercase tracking-wide ${statusRing(otp.status)}`}
        >
          {otp.status}
        </span>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="text-center sm:min-w-[7rem] sm:text-left">
          <p className="text-4xl font-bold tabular-nums text-slate-900">{formatPct(otp.otpPct)}</p>
          <p className="text-xs font-medium text-slate-500">Network OTP</p>
          <p
            className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${trendUp ? 'text-emerald-700' : 'text-amber-700'}`}
          >
            {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {otp.trendPct >= 0 ? '+' : ''}
            {otp.trendPct}% vs target
          </p>
        </div>
        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-[0.65rem] font-semibold uppercase text-slate-500">Dep punctuality</p>
            <p className="text-lg font-bold text-slate-900">{formatPct(otp.departurePunctualityPct)}</p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-[0.65rem] font-semibold uppercase text-slate-500">Arr punctuality</p>
            <p className="text-lg font-bold text-slate-900">{formatPct(otp.arrivalPunctualityPct)}</p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-[0.65rem] font-semibold uppercase text-slate-500">Avg delay</p>
            <p className="text-lg font-bold text-amber-800">{otp.avgDelayMinutes} min</p>
          </div>
        </div>
      </div>
    </section>
  );
}
