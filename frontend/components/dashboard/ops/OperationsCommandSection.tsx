'use client';

import { Radio } from 'lucide-react';
import type { OperationalIntel } from './ops-types';
import { LiveDataBadge } from './LiveDataBadge';
import { OpsKpiStrip } from './OpsKpiStrip';
import { OtpPanel } from './OtpPanel';
import { CrewAlertsPanel } from './CrewAlertsPanel';
import { AircraftStatusPanel } from './AircraftStatusPanel';
import { AirportOpsPanel } from './AirportOpsPanel';
import { DelayManagementPanel } from './DelayManagementPanel';

type Props = {
  intel: OperationalIntel;
  onRefresh?: () => void;
  loading?: boolean;
};

export function OperationsCommandSection({ intel, onRefresh, loading }: Props) {
  return (
    <section className="mb-8" aria-label="Operations command center">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-hawana-blue">Phase 1 · Live ops</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-bold text-slate-900 sm:text-2xl">
            <Radio className="h-5 w-5 text-hawana-blue" aria-hidden />
            Operations command
          </h2>
          <p className="mt-1 max-w-xl text-sm text-slate-600">Real-time KPIs and intelligence from HAMS flight, crew, and dispatch data.</p>
        </div>
        <LiveDataBadge updatedAt={intel.updatedAt} onRefresh={onRefresh} loading={loading} />
      </div>
      <OpsKpiStrip intel={intel} />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OtpPanel intel={intel} />
        <CrewAlertsPanel intel={intel} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AircraftStatusPanel intel={intel} />
        <AirportOpsPanel intel={intel} />
      </div>
      <div className="mt-4">
        <DelayManagementPanel intel={intel} />
      </div>
    </section>
  );
}
