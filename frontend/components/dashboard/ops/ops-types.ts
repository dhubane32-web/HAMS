export type OpsKpiKey =
  | 'flightsToday'
  | 'activeFlights'
  | 'departures'
  | 'arrivals'
  | 'delayed'
  | 'cancelled'
  | 'diversions'
  | 'boardingFlights'
  | 'aircraftUtilization'
  | 'loadFactor'
  | 'dispatchReleases'
  | 'crewOnDuty';

export type OperationalIntel = {
  updatedAt: string;
  kpis: {
    flightsToday: number;
    activeFlights: number;
    departures: number;
    arrivals: number;
    delayed: number;
    cancelled: number;
    diversions: number;
    boardingFlights: number;
    aircraftUtilizationPct: number | null;
    loadFactorPct: number | null;
    dispatchReleases: number;
    crewOnDuty: number;
  };
  kpiTrends: Partial<Record<OpsKpiKey, number>>;
  otpPanel: {
    otpPct: number | null;
    departurePunctualityPct: number | null;
    arrivalPunctualityPct: number | null;
    avgDelayMinutes: number;
    trendPct: number;
    status: 'green' | 'amber' | 'red';
  };
  crewAlerts: {
    id: string;
    severity: 'critical' | 'warning' | 'info';
    timestamp: string | null;
    crewId: string;
    message: string;
    actionLabel: string;
    href: string;
  }[];
  aircraftStatus: {
    registration: string;
    type: string;
    state: string;
    airport: string;
    nextDeparture: string | null;
    nextFlight: string | null;
  }[];
  airportOps: {
    airport: string;
    gatesActive: number;
    boardingFlights: number;
    avgTurnaroundMin: number;
    baggageStatus: 'normal' | 'delayed' | 'critical';
    congestion: 'low' | 'medium' | 'high';
  }[];
  delayedFlights: {
    id: string;
    flightNumber: string;
    route: string;
    std: string | null;
    delayMinutes: number;
    category: string;
    status: string;
  }[];
};
