/** Demo OCC command-center payload when DB has no flights or summary queries fail partially. */

const OCC_STATIONS = ['MGQ', 'NBO', 'HGA', 'BSA', 'GGR'];

export function buildOccDemoPhase3(updatedAt = new Date().toISOString()) {
  const stations = OCC_STATIONS.map((code) => ({
    code,
    flightsToday: 0,
    delays: 0,
    turnaroundPct: null,
    boardingProgressPct: 0,
    baggageDelay: false,
    status: 'green'
  }));

  return {
    version: 1,
    updatedAt,
    demoMode: true,
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
    alerts: [
      {
        id: 'occ-demo-standby',
        severity: 'normal',
        category: 'dispatch',
        timestamp: updatedAt,
        message: 'OCC command center online — awaiting today’s flight program',
        actionLabel: 'Flight schedule',
        href: '/flights'
      }
    ],
    operationsFeed: [
      {
        id: 'occ-demo-standby',
        severity: 'normal',
        category: 'dispatch',
        timestamp: updatedAt,
        message: 'OCC command center online — awaiting today’s flight program',
        actionLabel: 'Flight schedule',
        href: '/flights'
      }
    ],
    stations,
    crew: {
      onDuty: 0,
      standby: 0,
      legalityWarnings: [],
      dutyHours: [
        { label: 'Block (avg)', hours: 0, maxHours: 8 },
        { label: 'Duty day', hours: 0, maxHours: 12 },
        { label: 'Rest buffer', hours: 0, maxHours: 10 }
      ],
      assignmentGaps: 0,
      restAlerts: 0,
      pairingSummary: { complete: 0, open: 0, status: 'nominal' }
    },
    maintenance: {
      fleetHealthPct: null,
      groundedCount: 0,
      utilizationPct: null,
      melAlerts: [],
      inspectionCountdowns: [],
      cards: []
    },
    aircraftBoard: {
      fleetHealthPct: null,
      groundedCount: 0,
      utilizationPct: null,
      aircraft: [],
      melAlerts: [],
      cards: []
    },
    crewBoard: {
      onDuty: 0,
      standby: 0,
      legalityWarnings: [],
      dutyHours: [
        { label: 'Block (avg)', hours: 0, maxHours: 8 },
        { label: 'Duty day', hours: 0, maxHours: 12 },
        { label: 'Rest buffer', hours: 0, maxHours: 10 }
      ],
      assignmentGaps: 0,
      restAlerts: 0,
      pairingSummary: { complete: 0, open: 0, status: 'nominal' }
    },
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
