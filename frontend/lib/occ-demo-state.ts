import type { OccPhase3 } from '@/components/dashboard/occ-phase3/occ-phase3-types';

/** Client-side fallback when API returns executive without occCommandCenter. */
export function buildOccDemoStateClient(updatedAt?: string): OccPhase3 {
  const ts = updatedAt ?? new Date().toISOString();
  const stations = ['MGQ', 'NBO', 'HGA', 'BSA', 'GGR'].map((code) => ({
    code,
    flightsToday: 0,
    delays: 0,
    turnaroundPct: null,
    boardingProgressPct: 0,
    baggageDelay: false,
    status: 'green' as const
  }));

  const feed = [
    {
      id: 'occ-demo-standby',
      severity: 'normal' as const,
      category: 'dispatch',
      timestamp: ts,
      message: 'OCC command center online — awaiting today’s flight program',
      actionLabel: 'Flight schedule',
      href: '/flights'
    }
  ];

  const maintenance = {
    fleetHealthPct: null,
    groundedCount: 0,
    utilizationPct: null,
    melAlerts: [] as OccPhase3['maintenance']['melAlerts'],
    inspectionCountdowns: [] as OccPhase3['maintenance']['inspectionCountdowns'],
    cards: [] as OccPhase3['maintenance']['cards']
  };

  const crew = {
    onDuty: 0,
    standby: 0,
    legalityWarnings: [] as OccPhase3['crew']['legalityWarnings'],
    dutyHours: [
      { label: 'Block (avg)', hours: 0, maxHours: 8 },
      { label: 'Duty day', hours: 0, maxHours: 12 },
      { label: 'Rest buffer', hours: 0, maxHours: 10 }
    ],
    assignmentGaps: 0,
    restAlerts: 0,
    pairingSummary: { complete: 0, open: 0, status: 'nominal' }
  };

  return {
    version: 1,
    updatedAt: ts,
    networkHealth: {
      otpPct: null,
      targetOtp: 85,
      delayedCount: 0,
      cancelledCount: 0,
      activeFlights: 0,
      departuresToday: 0,
      fleetAvailable: 0,
      groundedCount: 0,
      avgDelayMinutes: 0,
      loadFactorPct: null,
      utilizationPct: null,
      dispatchReleased: 0,
      dispatchPending: 0,
      boardingFlights: 0,
      otpStatus: 'green',
      impactSummary:
        'No departures scheduled today — network standing by. Add flights in Flight Operations to activate live OCC tracking.'
    },
    criticalAlerts: [],
    dispatchQueue: [],
    flightMovement: [],
    liveFlights: [],
    alerts: feed,
    operationsFeed: feed,
    stations,
    crew,
    maintenance,
    aircraftBoard: {
      fleetHealthPct: null,
      groundedCount: 0,
      utilizationPct: null,
      aircraft: [],
      melAlerts: [],
      cards: []
    },
    crewBoard: crew,
    analytics: {
      otpTrend: [],
      cancellationTrend: [],
      delayMinutesTrend: [],
      disruptionCategories: [],
      todayLoadFactorPct: null,
      todayUtilizationPct: null
    }
  };
}

export function resolveOccCommandCenter(
  raw: OccPhase3 | null | undefined,
  updatedAt?: string
): OccPhase3 {
  if (raw?.networkHealth) return raw;
  return buildOccDemoStateClient(updatedAt);
}
