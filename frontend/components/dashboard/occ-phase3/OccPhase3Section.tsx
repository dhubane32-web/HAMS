'use client';

import dynamic from 'next/dynamic';
import { Satellite } from 'lucide-react';
import { LiveDataBadge } from '@/components/dashboard/ops/LiveDataBadge';
import type { OccPhase3 } from './occ-phase3-types';
import { LiveFlightTrackingPanel } from './LiveFlightTrackingPanel';
import { OccCommandCenter } from './OccCommandCenter';
import { StationMonitorPanel } from './StationMonitorPanel';
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
};

export function OccPhase3Section({ data, onRefresh, loading }: Props) {
  return (
    <section className="mb-8" aria-label="Operations Command Center Phase 3">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-hawana-gold">Phase 3</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-bold text-slate-900 sm:text-2xl">
            <Satellite className="h-5 w-5 text-hawana-blue" aria-hidden />
            Operations Command Center
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Live flight tracking, station monitoring, crew and maintenance intelligence, and executive analytics.
          </p>
        </div>
        <LiveDataBadge updatedAt={data.updatedAt} onRefresh={onRefresh} loading={loading} />
      </div>

      <LiveFlightTrackingPanel flights={data.liveFlights} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OccCommandCenter alerts={data.alerts} />
        <StationMonitorPanel stations={data.stations} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CrewOpsPanel crew={data.crew} />
        <MaintenanceIntelPanel maintenance={data.maintenance} />
      </div>

      <div className="mt-4">
        <ExecutiveOpsAnalytics analytics={data.analytics} />
      </div>
    </section>
  );
}
