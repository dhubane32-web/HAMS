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

export type OccAnalytics = {
  otpTrend: { date: string; label: string; otpPct: number | null }[];
  cancellationTrend: { date: string; label: string; cancellations: number }[];
  loadFactorTrend: { date: string; label: string; loadFactorPct: number }[];
  utilizationTrend: { date: string; label: string; utilizationPct: number }[];
  revenueTrend: { date: string; label: string; amount: number }[];
};

export type OccPhase3 = {
  updatedAt: string;
  liveFlights: OccLiveFlight[];
  alerts: OccAlert[];
  stations: OccStation[];
  crew: OccCrewIntel;
  maintenance: OccMaintenanceIntel;
  analytics: OccAnalytics;
};
