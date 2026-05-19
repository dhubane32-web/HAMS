import { apiFetchJson } from '@/lib/api-client';

export type EnterpriseFlight = {
  id: string;
  flight_number: string;
  departure_airport: string;
  arrival_airport: string;
  departure_time: string;
  arrival_time: string;
  status: string;
  tail_number?: string | null;
  model?: string | null;
  dispatch_release_status?: string | null;
  total_delay_min?: number;
};

export type EnterpriseConflict = {
  kind: string;
  severity: string;
  message: string;
  flightId?: string;
  flightNumber?: string;
  tailNumber?: string;
};

export type OpsRouteTemplate = {
  id: string;
  origin_airport: string;
  dest_airport: string;
  label: string | null;
  is_active: boolean;
};

export type CompatibleAircraft = {
  id: string;
  tail_number: string;
  model: string;
  seat_capacity: number;
  release_status: string;
  compatible: boolean;
  errors: string[];
  warnings: string[];
};

export type EnterpriseFeed = {
  serverTime: string;
  operationalDate: string;
  flights: EnterpriseFlight[];
  rotations?: {
    id: string;
    tail_number: string;
    sequence_no: number;
    flight_number?: string | null;
    overnight_station?: string | null;
    planned_turnaround_min?: number | null;
    planned_block_min?: number | null;
    rotation_status: string;
    conflict_reason?: string | null;
  }[];
  alerts: {
    id: string;
    alert_type: string;
    severity: string;
    message: string;
    flight_number?: string | null;
    tail_number?: string | null;
    created_at: string;
  }[];
  conflicts: EnterpriseConflict[];
  conflictCount: number;
  utilization: {
    id: string;
    tail_number: string;
    model: string;
    block_hours: string | number;
    flight_count: number;
    utilizationPct: number;
    release_status: string;
    status: string;
  }[];
  dispatchQueue: {
    id: string;
    flight_number: string;
    departure_time: string;
    release_status?: string | null;
    needsRelease: boolean;
  }[];
  activeSchedules: number;
  constants?: { minTurnaroundMinutes: number };
};

const emptyFeed = (date: string): EnterpriseFeed => ({
  serverTime: new Date().toISOString(),
  operationalDate: date,
  flights: [],
  rotations: [],
  alerts: [],
  conflicts: [],
  conflictCount: 0,
  utilization: [],
  dispatchQueue: [],
  activeSchedules: 0,
  constants: { minTurnaroundMinutes: 45 }
});

export async function fetchEnterpriseFeed(date: string, retries = 2): Promise<EnterpriseFeed> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i += 1) {
    try {
      const data = await apiFetchJson<EnterpriseFeed>(
        `/api/operations/enterprise/feed?date=${encodeURIComponent(date)}`,
        { retries: 0 }
      );
      return {
        ...emptyFeed(date),
        ...data,
        flights: data.flights ?? [],
        rotations: data.rotations ?? [],
        alerts: data.alerts ?? [],
        conflicts: data.conflicts ?? [],
        utilization: data.utilization ?? [],
        dispatchQueue: data.dispatchQueue ?? []
      };
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('503') || msg.includes('schema')) return emptyFeed(date);
      if (i < retries) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function fetchRouteTemplates() {
  const data = await apiFetchJson<{ routes: OpsRouteTemplate[] }>('/api/operations/enterprise/routes/templates');
  return data.routes || [];
}

export async function fetchCompatibleAircraft(flightId: string) {
  return apiFetchJson<{ flightId: string; distanceNm: number | null; aircraft: CompatibleAircraft[] }>(
    `/api/operations/enterprise/assignments/compatible?flightId=${encodeURIComponent(flightId)}`
  );
}

export async function rescheduleFlightDrag(flightId: string, departureTime: string, arrivalTime: string) {
  const data = await apiFetchJson<{ flight: EnterpriseFlight }>(
    `/api/operations/enterprise/flights/${flightId}/reschedule`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ departureTime, arrivalTime })
    }
  );
  return data.flight;
}

export async function scanConflictAlerts(date: string) {
  return apiFetchJson<{ scanned: number; alertsCreated: number }>(
    '/api/operations/enterprise/conflicts/scan',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }) }
  );
}

export async function ackEnterpriseAlert(alertId: string) {
  return apiFetchJson(`/api/operations/enterprise/alerts/${alertId}/ack`, { method: 'PATCH' });
}

export async function cancelEnterpriseFlight(flightId: string, reason: string) {
  return apiFetchJson(`/api/operations/enterprise/flights/${flightId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
}

export async function recordEnterpriseDelay(flightId: string, delayMinutes: number, reason: string) {
  return apiFetchJson(`/api/operations/enterprise/flights/${flightId}/delays`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delayMinutes, reason })
  });
}
