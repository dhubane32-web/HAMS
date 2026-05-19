/** OCC command center payload — versioned for future WebSocket / live feed adapters */

export type OccLiveFlight = {
  id: string;
  flightNumber: string;
  dep: string;
  arr: string;
  progressPct: number;
  airborneMinutes: number;
  etaMinutes: number;
  gate: string;
  status: 'enroute' | 'boarding' | 'delayed' | 'cancelled' | 'scheduled';
  departureTime: string | null;
  arrivalTime: string | null;
};

export type OccAlert = {
  id: string;
  severity: 'normal' | 'warning' | 'critical';
  category: string;
  timestamp: string | null;
  message: string;
  actionLabel: string;
  href: string;
};

export type OccCriticalAlert = {
  id: string;
  severity: 'normal' | 'warning' | 'critical';
  domain: string;
  timestamp: string | null;
  message: string;
  actionLabel: string;
  href: string;
};

export type OccNetworkHealth = {
  otpPct: number | null;
  targetOtp: number;
  delayedCount: number;
  cancelledCount: number;
  activeFlights: number;
  departuresToday: number;
  fleetAvailable: number;
  groundedCount: number;
  avgDelayMinutes: number;
  loadFactorPct: number | null;
  utilizationPct: number | null;
  dispatchReleased: number;
  dispatchPending: number;
  boardingFlights: number;
  otpStatus: 'green' | 'amber' | 'red';
  impactSummary: string;
};

export type OccFlightMovement = {
  id: string;
  flightNumber: string;
  route: string;
  departureTime: string;
  arrivalTime: string | null;
  status: string;
  gate: string;
  tail: string | null;
  priority: 'critical' | 'warning' | 'normal';
};

export type OccDispatchItem = {
  id: string;
  flightNumber: string;
  route: string;
  status: string;
  gate: string;
  priority: 'critical' | 'warning' | 'normal';
  actionLabel: string;
  href: string;
};

export type OccStation = {
  code: string;
  flightsToday: number;
  delays: number;
  turnaroundPct: number | null;
  boardingProgressPct: number;
  baggageDelay: boolean;
  status: 'green' | 'amber' | 'red';
};

export type OccCrewIntel = {
  onDuty: number;
  standby: number;
  legalityWarnings: { id: string; message: string; severity: string }[];
  dutyHours: { label: string; hours: number; maxHours: number }[];
  assignmentGaps: number;
  restAlerts: number;
  pairingSummary: { complete: number; open: number; status: string };
};

export type OccMaintenanceIntel = {
  fleetHealthPct: number | null;
  groundedCount: number;
  utilizationPct: number | null;
  melAlerts: { id: string; tail: string; code: string; message: string }[];
  inspectionCountdowns: { tail: string; type: string; scheduledFor: string | null }[];
  cards: { tail: string; title: string; severity: string; dueLabel: string; href: string }[];
};

export type OccAircraftBoard = {
  fleetHealthPct: number | null;
  groundedCount: number;
  utilizationPct: number | null;
  aircraft: {
    registration: string;
    type: string;
    state: string;
    airport: string;
    nextDeparture: string | null;
    nextFlight: string | null;
  }[];
  melAlerts: OccMaintenanceIntel['melAlerts'];
  cards: OccMaintenanceIntel['cards'];
};

export type OccAnalytics = {
  otpTrend: { date: string; label: string; otpPct: number | null }[];
  cancellationTrend: { date: string; label: string; cancellations: number }[];
  delayMinutesTrend: { date: string; label: string; avgDelayMinutes: number }[];
  disruptionCategories: { category: string; count: number }[];
  todayLoadFactorPct: number | null;
  todayUtilizationPct: number | null;
};

export type OccPhase3 = {
  version?: number;
  demoMode?: boolean;
  updatedAt: string;
  networkHealth: OccNetworkHealth;
  criticalAlerts: OccCriticalAlert[];
  dispatchQueue: OccDispatchItem[];
  flightMovement: OccFlightMovement[];
  liveFlights: OccLiveFlight[];
  alerts: OccAlert[];
  operationsFeed: OccAlert[];
  stations: OccStation[];
  crew: OccCrewIntel;
  maintenance: OccMaintenanceIntel;
  aircraftBoard: OccAircraftBoard;
  crewBoard: OccCrewIntel;
  analytics: OccAnalytics;
};
