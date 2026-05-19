'use client';

import dynamic from 'next/dynamic';
import { Radio } from 'lucide-react';
import { LiveDataBadge } from '@/components/dashboard/ops/LiveDataBadge';
import type { OccPhase3 } from './occ-phase3-types';
import { CriticalOpsRibbon } from './CriticalOpsRibbon';
import { LiveCriticalAlerts } from './LiveCriticalAlerts';
import { DispatchQueuePanel } from './DispatchQueuePanel';
import { FlightMovementBoard } from './FlightMovementBoard';
import { OccCommandCenter } from './OccCommandCenter';
import { LiveFlightTrackingPanel } from './LiveFlightTrackingPanel';
import { StationMonitorPanel } from './StationMonitorPanel';
import { AircraftStatusBoard } from './AircraftStatusBoard';
import { CrewOpsPanel } from './CrewOpsPanel';
import { MaintenanceIntelPanel } from './MaintenanceIntelPanel';

const ExecutiveOpsAnalytics = dynamic(
  () => import('./ExecutiveOpsAnalytics').then((m) => m.ExecutiveOpsAnalytics),
  { ssr: false, loading: () => <div className="occ-glass h-48 animate-pulse rounded-2xl bg-slate-100" /> }
);

type Props = {
  data: OccPhase3;
  onRefresh?: () => void;
  loading?: boolean;
  apiError?: string | null;
};

function feedAlerts(data: OccPhase3) {
  return data.operationsFeed?.length ? data.operationsFeed : data.alerts ?? [];
}

function OccSkeleton() {
  return (
    <div className="space-y-4">
      <div className="occ-glass h-28 animate-pulse rounded-2xl bg-slate-100" />
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="occ-glass h-80 animate-pulse rounded-2xl bg-slate-100 xl:col-span-8" />
        <div className="grid gap-4 xl:col-span-4">
          <div className="occ-glass h-40 animate-pulse rounded-2xl bg-slate-100" />
          <div className="occ-glass h-48 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

export function OccPhase3Section({ data, onRefresh, loading, apiError }: Props) {
  if (loading && !data?.networkHealth) {
    return (
      <section className="mb-8" aria-label="Airline operations command center">
        <OccSkeleton />
      </section>
    );
  }

  const maintenance = data.maintenance ?? {
    fleetHealthPct: null,
    groundedCount: 0,
    utilizationPct: null,
    melAlerts: [],
    inspectionCountdowns: [],
    cards: []
  };
  const health = data.networkHealth;
  const aircraftBoard = data.aircraftBoard ?? {
    fleetHealthPct: maintenance.fleetHealthPct,
    groundedCount: maintenance.groundedCount,
    utilizationPct: maintenance.utilizationPct,
    aircraft: [],
    melAlerts: maintenance.melAlerts,
    cards: maintenance.cards
  };
  const crew = data.crewBoard ?? data.crew ?? {
    onDuty: 0,
    standby: 0,
    legalityWarnings: [],
    dutyHours: [],
    assignmentGaps: 0,
    restAlerts: 0,
    pairingSummary: { complete: 0, open: 0, status: 'nominal' }
  };
  const analytics = data.analytics ?? {
    otpTrend: [],
    cancellationTrend: [],
    delayMinutesTrend: [],
    disruptionCategories: [],
    todayLoadFactorPct: null,
    todayUtilizationPct: null
  };

  return (
    <section className="mb-8" aria-label="Airline operations command center">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-hawana-gold">Operations control</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-bold text-slate-900 sm:text-2xl">
            <Radio className="h-5 w-5 text-hawana-blue" aria-hidden />
            Airline OCC command center
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Connected network view — delays, cancellations, fleet, crew, and dispatch drive the same operational snapshot.
          </p>
        </div>
        <LiveDataBadge updatedAt={data.updatedAt} onRefresh={onRefresh} loading={loading} />
      </div>

      {(apiError || data.demoMode) && (
        <p
          className={`mb-3 rounded-xl border px-3 py-2 text-sm ${
            apiError
              ? 'border-amber-200 bg-amber-50 text-amber-950'
              : 'border-sky-200 bg-sky-50 text-sky-900'
          }`}
          role={apiError ? 'alert' : 'status'}
        >
          {apiError ??
            'Operational standby — no active departures today. Schedule flights to populate live OCC boards.'}
        </p>
      )}

      {health && (
        <CriticalOpsRibbon health={health} criticalAlerts={data.criticalAlerts ?? []} />
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <FlightMovementBoard flights={data.flightMovement ?? []} />
        </div>
        <div className="grid gap-4 xl:col-span-4">
          <LiveCriticalAlerts alerts={data.criticalAlerts ?? []} />
          <DispatchQueuePanel queue={data.dispatchQueue ?? []} />
        </div>
      </div>

      <div className="mt-4">
        <LiveFlightTrackingPanel flights={data.liveFlights} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OccCommandCenter alerts={feedAlerts(data)} />
        <StationMonitorPanel stations={data.stations} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AircraftStatusBoard board={aircraftBoard} />
        <CrewOpsPanel crew={crew} />
        <MaintenanceIntelPanel maintenance={maintenance} />
      </div>

      <div className="mt-4">
        <ExecutiveOpsAnalytics analytics={analytics} />
      </div>
    </section>
  );
}
