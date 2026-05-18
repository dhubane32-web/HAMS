'use client';

import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Ban,
  Gauge,
  LogIn,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  Radio,
  Route,
  TrendingUp,
  Users,
  Zap
} from 'lucide-react';
import type { OperationalIntel, OpsKpiKey } from './ops-types';

type KpiDef = {
  key: OpsKpiKey;
  label: string;
  icon: LucideIcon;
  format?: (v: number | null) => string;
};

const KPI_DEFS: KpiDef[] = [
  { key: 'flightsToday', label: 'Flights Today', icon: Plane },
  { key: 'activeFlights', label: 'Active Flights', icon: Radio },
  { key: 'departures', label: 'Departures', icon: PlaneTakeoff },
  { key: 'arrivals', label: 'Arrivals', icon: PlaneLanding },
  { key: 'delayed', label: 'Delayed', icon: AlertTriangle },
  { key: 'cancelled', label: 'Cancelled', icon: Ban },
  { key: 'diversions', label: 'Diversions', icon: Route },
  { key: 'boardingFlights', label: 'Boarding Flights', icon: LogIn },
  {
    key: 'aircraftUtilization',
    label: 'Aircraft Utilization',
    icon: Gauge,
    format: (v) => (v == null ? '—' : `${v}%`)
  },
  {
    key: 'loadFactor',
    label: 'Load Factor',
    icon: TrendingUp,
    format: (v) => (v == null ? '—' : `${v}%`)
  },
  { key: 'dispatchReleases', label: 'Dispatch Releases', icon: Zap },
  { key: 'crewOnDuty', label: 'Crew On Duty', icon: Users }
];

function kpiValue(intel: OperationalIntel, key: OpsKpiKey): number | null {
  const k = intel.kpis;
  switch (key) {
    case 'flightsToday':
      return k.flightsToday;
    case 'activeFlights':
      return k.activeFlights;
    case 'departures':
      return k.departures;
    case 'arrivals':
      return k.arrivals;
    case 'delayed':
      return k.delayed;
    case 'cancelled':
      return k.cancelled;
    case 'diversions':
      return k.diversions;
    case 'boardingFlights':
      return k.boardingFlights;
    case 'aircraftUtilization':
      return k.aircraftUtilizationPct;
    case 'loadFactor':
      return k.loadFactorPct;
    case 'dispatchReleases':
      return k.dispatchReleases;
    case 'crewOnDuty':
      return k.crewOnDuty;
    default:
      return 0;
  }
}

function miniStatus(key: OpsKpiKey, value: number | null, trend: number | undefined): string {
  if (key === 'delayed' || key === 'cancelled' || key === 'diversions') {
    if ((value ?? 0) === 0) return 'Clear';
    if ((value ?? 0) >= 3) return 'Elevated';
    return 'Watch';
  }
  if (trend != null && trend > 5) return 'Rising';
  if (trend != null && trend < -5) return 'Easing';
  return 'Stable';
}

function statusTone(key: OpsKpiKey, value: number | null): string {
  if (key === 'delayed' || key === 'cancelled' || key === 'diversions') {
    if ((value ?? 0) === 0) return 'text-emerald-700 bg-emerald-50 ring-emerald-200';
    if ((value ?? 0) >= 3) return 'text-red-800 bg-red-50 ring-red-200';
    return 'text-amber-800 bg-amber-50 ring-amber-200';
  }
  return 'text-slate-600 bg-slate-50 ring-slate-200';
}

type Props = { intel: OperationalIntel };

export function OpsKpiStrip({ intel }: Props) {
  return (
    <section
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4 xl:grid-cols-6"
      aria-label="Operations KPIs"
    >
      {KPI_DEFS.map((def) => {
        const Icon = def.icon;
        const raw = kpiValue(intel, def.key);
        const display = def.format ? def.format(raw) : String(raw ?? 0);
        const trend = intel.kpiTrends[def.key];
        const trendLabel =
          trend == null || trend === 0 ? '0%' : `${trend > 0 ? '+' : ''}${trend}%`;
        const trendTone =
          trend == null || trend === 0
            ? 'text-slate-400'
            : trend > 0 && (def.key === 'delayed' || def.key === 'cancelled')
              ? 'text-red-600'
              : trend > 0
                ? 'text-emerald-600'
                : 'text-slate-500';

        return (
          <article
            key={def.key}
            className="flex flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-hawana-blue/25"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="rounded-lg bg-hawana-blue/10 p-2 text-hawana-blue">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className={`text-xs font-semibold tabular-nums ${trendTone}`}>{trendLabel}</span>
            </div>
            <p className="mt-2 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">{def.label}</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">{display}</p>
            <span
              className={`mt-2 inline-flex w-fit rounded-full px-2 py-0.5 text-[0.65rem] font-semibold ring-1 ${statusTone(def.key, raw)}`}
            >
              {miniStatus(def.key, raw, trend)}
            </span>
          </article>
        );
      })}
    </section>
  );
}
