'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { apiFetchJson } from '@/lib/api-client';
import './operations-erp.css';
import { OperationsOccHub } from './OperationsOccHub';

const FLIGHT_STATUSES = [
  'SCHEDULED',
  'CHECKIN_OPEN',
  'BOARDING',
  'GATE_CLOSED',
  'DEPARTED',
  'IN_AIR',
  'ARRIVED',
  'DELAYED',
  'CANCELLED'
] as const;

type Flight = {
  id: string;
  flight_number: string;
  departure_airport: string;
  arrival_airport: string;
  departure_time: string;
  arrival_time: string;
  status: string;
  gate?: string | null;
  boarding_time?: string | null;
  aircraft_id?: string | null;
  route_id?: string | null;
  route_label?: string | null;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  tail_number?: string | null;
  model?: string | null;
  aircraft_release_status?: string | null;
};

type OpsRoute = {
  id: string;
  origin_airport: string;
  dest_airport: string;
  label: string | null;
  is_active: boolean;
};

type Aircraft = {
  id: string;
  tail_number: string;
  model: string;
  release_status: string;
};

type Crew = {
  id: string;
  full_name: string;
  email: string;
};

type CrewAssignment = { id: string; crew_user_id: string; full_name: string; email: string; duty_role: string; assigned_at: string };

type OpsAlert = { code: string; severity: string; message: string };

type OperationalSummaryPayload = {
  load: {
    passengersBooked: number;
    passengersCheckedIn: number;
    passengersBoarded: number;
    baggagePieces: number;
    baggageWeightKg: number;
    cargoWeightKg: number;
    estimatedFuelKg: number;
  };
  alerts: OpsAlert[];
  constants?: { minTurnaroundMinutes: number };
};

type AuditTimelineRow = { id: string; action: string; metadata: unknown; created_at: string };

type OpsDrawerTab = 'overview' | 'load' | 'dispatch' | 'timeline' | 'delays';

type DispatchLogRow = {
  id: string;
  dispatch_status: string;
  remarks: string | null;
  dispatched_at: string;
  checklist_json?: unknown;
};

type DelayRow = {
  id: string;
  delay_minutes: number;
  reason: string;
  created_at: string;
  revised_departure?: string | null;
  operational_notes?: string | null;
};

type FlightDetails = {
  flight: Flight;
  crew: CrewAssignment[];
  dispatchLogs: DispatchLogRow[];
  delays: DelayRow[];
  operationalSummary?: OperationalSummaryPayload | null;
  auditTimeline?: AuditTimelineRow[];
};

type DispatchChecklistState = {
  aircraftRelease: boolean;
  crewRelease: boolean;
  weatherOk: boolean;
  notamOk: boolean;
  captainApproval: boolean;
  dispatcherApproval: boolean;
};

function emptyDispatchChecklist(): DispatchChecklistState {
  return {
    aircraftRelease: false,
    crewRelease: false,
    weatherOk: false,
    notamOk: false,
    captainApproval: false,
    dispatcherApproval: false
  };
}

const DISPATCH_CHECKLIST_FIELDS: { key: keyof DispatchChecklistState; label: string }[] = [
  { key: 'aircraftRelease', label: 'Aircraft release (maintenance)' },
  { key: 'crewRelease', label: 'Crew release / legality' },
  { key: 'weatherOk', label: 'Weather check' },
  { key: 'notamOk', label: 'NOTAM check' },
  { key: 'captainApproval', label: 'Captain approval' },
  { key: 'dispatcherApproval', label: 'Dispatcher / OCC approval' }
];

function opsStatusBadgeClass(status: string): string {
  const raw = String(status || 'SCHEDULED').toUpperCase();
  const slug =
    raw === 'LANDED'
      ? 'arrived'
      : raw
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9_]/g, '');
  return `ops-badge ops-badge--${slug || 'scheduled'}`;
}

function summarizeFlightsByStatus(flights: Flight[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const s of FLIGHT_STATUSES) summary[s] = 0;
  for (const f of flights) {
    const k = String(f.status || 'SCHEDULED').toUpperCase();
    if (summary[k] === undefined) summary[k] = 0;
    summary[k] += 1;
  }
  return summary;
}

function formatChecklistSnippet(j: unknown): string {
  if (j == null || j === '') return '';
  if (typeof j === 'object') {
    try {
      return JSON.stringify(j);
    } catch {
      return '';
    }
  }
  return String(j);
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('hams_token') : null;
}

type ScheduleFormState = {
  flightNumber: string;
  routeId: string;
  aircraftId: string;
  departureTime: string;
  arrivalTime: string;
  gate: string;
  boardingTime: string;
};

const EMPTY_SCHEDULE: ScheduleFormState = {
  flightNumber: '',
  routeId: '',
  aircraftId: '',
  departureTime: '',
  arrivalTime: '',
  gate: '',
  boardingTime: ''
};

function cloneSchedule(s: ScheduleFormState): ScheduleFormState {
  return { ...s };
}

function bumpFlightNumber(fn: string): string {
  const u = fn.toUpperCase().trim().slice(0, 20);
  const m = u.match(/^([A-Z]{1,4})(\d{1,5})$/);
  if (m) {
    const next = parseInt(m[2], 10) + 1;
    const w = Math.max(m[2].length, String(next).length);
    return `${m[1]}${String(next).padStart(w, '0')}`.slice(0, 20);
  }
  return u ? `${u}B`.slice(0, 20) : 'HW001';
}

function addOneDayToDatetimeLocal(val: string): string {
  if (!val) return '';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type ScheduleFlightEditForm = {
  flightNumber: string;
  routeId: string;
  departureTime: string;
  arrivalTime: string;
  gate: string;
  boardingTime: string;
};

export default function OperationsPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [tab, setTab] = useState<'board' | 'routes' | 'schedule' | 'control' | 'occ'>('board');

  const [date, setDate] = useState(today);
  const [boardViewDate, setBoardViewDate] = useState(today);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [boardFlights, setBoardFlights] = useState<Flight[]>([]);
  const [summaryByStatus, setSummaryByStatus] = useState<Record<string, number>>({});
  const [routes, setRoutes] = useState<OpsRoute[]>([]);
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [crew, setCrew] = useState<Crew[]>([]);
  const [selectedFlightId, setSelectedFlightId] = useState('');
  const [selectedAircraftId, setSelectedAircraftId] = useState('');
  const [selectedCrewId, setSelectedCrewId] = useState('');
  const [dutyRole, setDutyRole] = useState('PIC');
  const [dispatchStatus, setDispatchStatus] = useState<string>('BOARDING');
  const [dispatchRemarks, setDispatchRemarks] = useState('');
  const [dispatchReleaseRemarks, setDispatchReleaseRemarks] = useState('');
  const [dispatchChecklist, setDispatchChecklist] = useState<DispatchChecklistState>(() => emptyDispatchChecklist());
  const [delayMinutes, setDelayMinutes] = useState('20');
  const [delayReason, setDelayReason] = useState('');
  const [delayRevisedDeparture, setDelayRevisedDeparture] = useState('');
  const [delayOperationalNotes, setDelayOperationalNotes] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [statusPick, setStatusPick] = useState<string>('SCHEDULED');
  const [details, setDetails] = useState<FlightDetails | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [newRoute, setNewRoute] = useState({ origin: '', dest: '', label: '' });

  const [scheduleData, setScheduleData] = useState<ScheduleFormState>(cloneSchedule(EMPTY_SCHEDULE));
  const scheduleBaselineRef = useRef<ScheduleFormState>(cloneSchedule(EMPTY_SCHEDULE));
  const [scheduleFormKey, setScheduleFormKey] = useState(0);
  const [scheduleSuccess, setScheduleSuccess] = useState('');
  const [isSchedulingSubmit, setIsSchedulingSubmit] = useState(false);
  const [scheduledFlights, setScheduledFlights] = useState<Flight[]>([]);
  const [scheduleListLoading, setScheduleListLoading] = useState(false);
  const [lastCreatedFlight, setLastCreatedFlight] = useState<Flight | null>(null);
  const [editFlight, setEditFlight] = useState<Flight | null>(null);
  const [editForm, setEditForm] = useState<ScheduleFlightEditForm>({
    flightNumber: '',
    routeId: '',
    departureTime: '',
    arrivalTime: '',
    gate: '',
    boardingTime: ''
  });
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [tableActionFlightId, setTableActionFlightId] = useState<string | null>(null);
  const [boardFilterStatus, setBoardFilterStatus] = useState('');
  const [boardFilterRoute, setBoardFilterRoute] = useState('');
  const [boardFilterTail, setBoardFilterTail] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerFlightId, setDrawerFlightId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<OpsDrawerTab>('overview');
  const [drawerDetails, setDrawerDetails] = useState<FlightDetails | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerDelayMinutes, setDrawerDelayMinutes] = useState('20');
  const [drawerDelayReason, setDrawerDelayReason] = useState('');
  const [drawerDelayRevised, setDrawerDelayRevised] = useState('');
  const [drawerDelayNotes, setDrawerDelayNotes] = useState('');
  const [tableDispatchModal, setTableDispatchModal] = useState<{ flightId: string; flightNo: string } | null>(null);
  const [tableDispatchChecklist, setTableDispatchChecklist] = useState<DispatchChecklistState>(() => emptyDispatchChecklist());
  const [tableDispatchRemarks, setTableDispatchRemarks] = useState('');
  const [drawerDispatchChecklist, setDrawerDispatchChecklist] = useState<DispatchChecklistState>(() => emptyDispatchChecklist());
  const [drawerDispatchRemarks, setDrawerDispatchRemarks] = useState('');

  const fetchJson = useCallback(async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
    const token = getToken();
    if (!token) throw new Error('Please login first from /login.');
    return apiFetchJson<T>(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`
      },
      endpointTag: `operations:${path}`
    });
  }, []);

  const loadCatalog = useCallback(async () => {
    setCatalogError('');
    setCatalogLoading(true);
    try {
      const [r, a, c] = await Promise.all([
        fetchJson<{ routes: OpsRoute[] }>('/api/operations/routes'),
        fetchJson<{ aircraft: Aircraft[] }>('/api/operations/aircraft'),
        fetchJson<{ crew: Crew[] }>('/api/operations/crew')
      ]);
      setRoutes(r.routes || []);
      setAircraft(a.aircraft || []);
      setCrew(c.crew || []);
    } catch (e) {
      setRoutes([]);
      setAircraft([]);
      setCrew([]);
      const msg = e instanceof Error ? e.message : 'Failed to load routes, aircraft, or crew';
      setCatalogError(msg);
      toast.error(msg);
    } finally {
      setCatalogLoading(false);
    }
  }, [fetchJson]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const loadOpsBoard = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const d = await fetchJson<{ flights: Flight[]; summaryByStatus: Record<string, number> }>(
        `/api/operations/dashboard?date=${encodeURIComponent(boardViewDate)}`
      );
      const list = d.flights || [];
      setBoardFlights(list);
      setSummaryByStatus(d.summaryByStatus && Object.keys(d.summaryByStatus).length ? d.summaryByStatus : summarizeFlightsByStatus(list));
    } catch (e) {
      setBoardFlights([]);
      setSummaryByStatus(summarizeFlightsByStatus([]));
      setError(e instanceof Error ? e.message : 'Failed to load operations board');
      toast.error(e instanceof Error ? e.message : 'Failed to load operations board');
    } finally {
      setIsLoading(false);
    }
  }, [fetchJson, boardViewDate]);

  /** Refresh the operations board for the current board date without toggling global loading. */
  const loadOpsBoardQuiet = useCallback(async () => {
    try {
      const d = await fetchJson<{ flights: Flight[]; summaryByStatus: Record<string, number> }>(
        `/api/operations/dashboard?date=${encodeURIComponent(boardViewDate)}`
      );
      const list = d.flights || [];
      setBoardFlights(list);
      setSummaryByStatus(d.summaryByStatus && Object.keys(d.summaryByStatus).length ? d.summaryByStatus : summarizeFlightsByStatus(list));
    } catch {
      /* ignore */
    }
  }, [fetchJson, boardViewDate]);

  const loadScheduledFlightsList = useCallback(async () => {
    setScheduleListLoading(true);
    try {
      const res = await fetchJson<{ flights: Flight[] }>('/api/operations/flights/recent?limit=50');
      setScheduledFlights(res.flights || []);
    } catch {
      setScheduledFlights([]);
    } finally {
      setScheduleListLoading(false);
    }
  }, [fetchJson]);

  const loadDayAndDetails = useCallback(
    async (opts?: { date?: string; selectFlightId?: string | null }) => {
      const day = opts?.date ?? date;
      setIsLoading(true);
      setError('');
      try {
        setDate(day);
        const [flightRes, aircraftRes, crewRes] = await Promise.all([
          fetchJson<{ flights: Flight[] }>(`/api/operations/flights?date=${encodeURIComponent(day)}`),
          fetchJson<{ aircraft: Aircraft[] }>('/api/operations/aircraft'),
          fetchJson<{ crew: Crew[] }>('/api/operations/crew')
        ]);
        const flightsArr = flightRes.flights || [];
        setFlights(flightsArr);
        setAircraft(aircraftRes.aircraft || []);
        setCrew(crewRes.crew || []);
        const preferred = opts?.selectFlightId ?? undefined;
        const first =
          preferred && flightsArr.some((f) => f.id === preferred) ? preferred : flightsArr[0]?.id || '';
        setSelectedFlightId(first);
        if (first) {
          const d = await fetchJson<FlightDetails>(`/api/operations/flights/${first}/details`);
          setDetails(d);
        } else {
          setDetails(null);
        }
      } catch (e) {
        setFlights([]);
        setDetails(null);
        setError(e instanceof Error ? e.message : 'Failed to load');
        toast.error(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setIsLoading(false);
      }
    },
    [fetchJson, date]
  );

  async function refreshFlightDetails(flightId: string) {
    if (!flightId) {
      setDetails(null);
      return;
    }
    try {
      const d = await fetchJson<FlightDetails>(`/api/operations/flights/${flightId}/details`);
      setDetails(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Details failed');
    }
  }

  async function refreshDrawerDetails(flightId: string) {
    try {
      const d = await fetchJson<FlightDetails>(`/api/operations/flights/${flightId}/details`);
      setDrawerDetails(d);
    } catch {
      /* ignore */
    }
  }

  async function openOpsDrawer(flightId: string, tab: OpsDrawerTab = 'overview') {
    setDrawerOpen(true);
    setDrawerFlightId(flightId);
    setDrawerTab(tab);
    if (tab === 'dispatch') {
      setDrawerDispatchChecklist(emptyDispatchChecklist());
      setDrawerDispatchRemarks('');
    }
    setDrawerLoading(true);
    setDrawerDetails(null);
    try {
      const d = await fetchJson<FlightDetails>(`/api/operations/flights/${flightId}/details`);
      setDrawerDetails(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load flight details');
      setDrawerOpen(false);
      setDrawerFlightId(null);
    } finally {
      setDrawerLoading(false);
    }
  }

  function closeOpsDrawer() {
    setDrawerOpen(false);
    setDrawerFlightId(null);
    setDrawerDetails(null);
    setDrawerTab('overview');
  }

  async function patchFlightStatusById(fid: string, status: string) {
    setTableActionFlightId(fid);
    setError('');
    try {
      await fetchJson(`/api/operations/flights/${fid}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      toast.success(`Flight status → ${status}`);
      await loadOpsBoardQuiet();
      void loadScheduledFlightsList();
      if (selectedFlightId === fid) await refreshFlightDetails(fid);
      if (drawerFlightId === fid) await refreshDrawerDetails(fid);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Status update failed');
    } finally {
      setTableActionFlightId(null);
    }
  }

  async function recordDrawerDelay() {
    if (!drawerFlightId || drawerDelayReason.trim().length < 3) {
      toast.error('Delay reason is required (min 3 characters).');
      return;
    }
    const mins = Number(drawerDelayMinutes);
    if (!Number.isInteger(mins) || mins < 1) {
      toast.error('Delay minutes must be a positive integer.');
      return;
    }
    setTableActionFlightId(drawerFlightId);
    try {
      const body: Record<string, unknown> = {
        delayMinutes: mins,
        reason: drawerDelayReason.trim()
      };
      if (drawerDelayRevised.trim()) {
        body.revisedDepartureTime = new Date(drawerDelayRevised).toISOString();
      }
      if (drawerDelayNotes.trim()) body.operationalNotes = drawerDelayNotes.trim();
      await fetchJson(`/api/operations/flights/${drawerFlightId}/delays`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      toast.success('Delay recorded');
      await refreshDrawerDetails(drawerFlightId);
      await loadOpsBoardQuiet();
      if (selectedFlightId === drawerFlightId) await refreshFlightDetails(drawerFlightId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delay failed');
    } finally {
      setTableActionFlightId(null);
    }
  }

  function openTableDispatchModal(flightId: string, flightNo: string) {
    setTableDispatchModal({ flightId, flightNo });
    setTableDispatchChecklist(emptyDispatchChecklist());
    setTableDispatchRemarks('');
  }

  async function drawerConfirmDispatchRelease() {
    if (!drawerFlightId) return;
    setTableActionFlightId(drawerFlightId);
    try {
      await fetchJson(`/api/operations/flights/${drawerFlightId}/dispatch-release`, {
        method: 'POST',
        body: JSON.stringify({
          remarks: drawerDispatchRemarks.trim() || undefined,
          checklist: drawerDispatchChecklist
        })
      });
      toast.success('Dispatch release complete.');
      setDrawerDispatchChecklist(emptyDispatchChecklist());
      await refreshDrawerDetails(drawerFlightId);
      await loadOpsBoardQuiet();
      if (selectedFlightId === drawerFlightId) await refreshFlightDetails(drawerFlightId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dispatch release failed');
    } finally {
      setTableActionFlightId(null);
    }
  }

  async function confirmTableDispatchRelease() {
    if (!tableDispatchModal) return;
    const { flightId, flightNo } = tableDispatchModal;
    setTableActionFlightId(flightId);
    setError('');
    try {
      await fetchJson(`/api/operations/flights/${flightId}/dispatch-release`, {
        method: 'POST',
        body: JSON.stringify({
          remarks: tableDispatchRemarks.trim() || `Dispatch release — ${flightNo}`,
          checklist: tableDispatchChecklist
        })
      });
      toast.success('Dispatch release complete.');
      setTableDispatchModal(null);
      await loadScheduledFlightsList();
      await loadOpsBoardQuiet();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dispatch release failed');
    } finally {
      setTableActionFlightId(null);
    }
  }

  async function fetchSuggestedFlightNumber(): Promise<string> {
    try {
      const r = await fetchJson<{ suggestedFlightNumber?: string }>('/api/operations/flights/suggest-flight-number');
      return (r.suggestedFlightNumber || '').trim().toUpperCase();
    } catch {
      return '';
    }
  }

  async function handleNewFlight() {
    setScheduleSuccess('');
    setLastCreatedFlight(null);
    setError('');
    const suggested = await fetchSuggestedFlightNumber();
    const next: ScheduleFormState = suggested
      ? { ...EMPTY_SCHEDULE, flightNumber: suggested }
      : cloneSchedule(EMPTY_SCHEDULE);
    setScheduleData(next);
    scheduleBaselineRef.current = cloneSchedule(next);
    setScheduleFormKey((k) => k + 1);
    toast.success(suggested ? `New flight — suggested number ${suggested} (editable).` : 'Form cleared for a new flight.');
  }

  async function handleSuggestFlightNumber() {
    setScheduleSuccess('');
    setError('');
    const suggested = await fetchSuggestedFlightNumber();
    if (!suggested) {
      toast.error('Could not suggest a flight number.');
      return;
    }
    setScheduleData((prev) => ({ ...prev, flightNumber: suggested }));
    toast.success(`Flight number set to ${suggested}.`);
  }

  function handleClearScheduleForm() {
    setScheduleSuccess('');
    setLastCreatedFlight(null);
    setError('');
    const cleared = cloneSchedule(EMPTY_SCHEDULE);
    setScheduleData(cleared);
    scheduleBaselineRef.current = cloneSchedule(cleared);
    setScheduleFormKey((k) => k + 1);
    toast.success('Schedule form cleared.');
  }

  function handleResetScheduleForm() {
    setScheduleSuccess('');
    setLastCreatedFlight(null);
    setError('');
    setScheduleData(cloneSchedule(scheduleBaselineRef.current));
    setScheduleFormKey((k) => k + 1);
    toast('Form reset to the last snapshot (new flight, clear, duplicate, or after create).');
  }

  function handleDuplicateScheduleFlight() {
    setScheduleSuccess('');
    setError('');
    const dup: ScheduleFormState = {
      ...scheduleData,
      flightNumber: bumpFlightNumber(scheduleData.flightNumber || 'HW001'),
      departureTime: scheduleData.departureTime ? addOneDayToDatetimeLocal(scheduleData.departureTime) : '',
      arrivalTime: scheduleData.arrivalTime ? addOneDayToDatetimeLocal(scheduleData.arrivalTime) : '',
      boardingTime: scheduleData.boardingTime ? addOneDayToDatetimeLocal(scheduleData.boardingTime) : ''
    };
    setScheduleData(dup);
    scheduleBaselineRef.current = cloneSchedule(dup);
    setScheduleFormKey((k) => k + 1);
    toast.success('Duplicated — review route, aircraft, and times before creating.');
  }

  useEffect(() => {
    if (tab === 'board') void loadOpsBoard();
  }, [tab, loadOpsBoard]);

  useEffect(() => {
    if (tab === 'schedule') void loadScheduledFlightsList();
  }, [tab, loadScheduledFlightsList]);

  const filteredBoardFlights = useMemo(() => {
    let rows = boardFlights;
    const st = boardFilterStatus.trim().toUpperCase();
    if (st) rows = rows.filter((f) => String(f.status || '').toUpperCase() === st);
    const rt = boardFilterRoute.trim().toUpperCase();
    if (rt) {
      rows = rows.filter((f) => {
        const fn = f.flight_number.toUpperCase();
        const leg = `${f.departure_airport}-${f.arrival_airport}`.toUpperCase();
        const compact = `${f.departure_airport}${f.arrival_airport}`.toUpperCase();
        const label = (f.route_label || '').toUpperCase();
        return fn.includes(rt) || leg.includes(rt) || compact.includes(rt.replace(/[^A-Z0-9]/g, '')) || label.includes(rt);
      });
    }
    const tail = boardFilterTail.trim().toUpperCase();
    if (tail) rows = rows.filter((f) => (f.tail_number || '').toUpperCase().includes(tail));
    return rows;
  }, [boardFlights, boardFilterStatus, boardFilterRoute, boardFilterTail]);

  async function handleCreateRoute(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await fetchJson('/api/operations/routes', {
        method: 'POST',
        body: JSON.stringify({
          originAirport: newRoute.origin,
          destAirport: newRoute.dest,
          label: newRoute.label || undefined
        })
      });
      toast.success('Route created');
      setNewRoute({ origin: '', dest: '', label: '' });
      await loadCatalog();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function toggleRouteActive(r: OpsRoute) {
    try {
      await fetchJson(`/api/operations/routes/${r.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !r.is_active })
      });
      await loadCatalog();
      toast.success('Route updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function handleScheduleFlight(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!scheduleData.flightNumber.trim()) {
      setError('Flight number is required.');
      return;
    }
    if (!scheduleData.aircraftId) {
      setError('Select an aircraft (required for every flight).');
      return;
    }
    if (!scheduleData.routeId) {
      setError('Select an operational route.');
      return;
    }
    if (!scheduleData.departureTime || !scheduleData.arrivalTime) {
      setError('Departure and arrival times are required.');
      return;
    }
    setIsSchedulingSubmit(true);
    try {
      const depIso = scheduleData.departureTime ? new Date(scheduleData.departureTime).toISOString() : '';
      const arrIso = scheduleData.arrivalTime ? new Date(scheduleData.arrivalTime).toISOString() : '';
      const created = await fetchJson<{ flight: Flight }>('/api/operations/flights', {
        method: 'POST',
        body: JSON.stringify({
          flightNumber: scheduleData.flightNumber,
          routeId: scheduleData.routeId,
          departureTime: depIso,
          arrivalTime: arrIso,
          aircraftId: scheduleData.aircraftId,
          gate: scheduleData.gate || undefined,
          boardingTime: scheduleData.boardingTime ? new Date(scheduleData.boardingTime).toISOString() : undefined
        })
      });
      const fn = created.flight?.flight_number || String(scheduleData.flightNumber).toUpperCase();
      toast.success(`Flight ${fn} created successfully and saved.`);
      setScheduleSuccess(`Flight ${fn} was scheduled and saved to the database. The form has been cleared for the next entry.`);
      const f = created.flight;
      if (f) {
        const tail = aircraft.find((a) => a.id === f.aircraft_id)?.tail_number;
        setLastCreatedFlight({ ...f, tail_number: tail ?? f.tail_number ?? null });
      } else {
        setLastCreatedFlight(null);
      }
      const cleared = cloneSchedule(EMPTY_SCHEDULE);
      setScheduleData(cleared);
      scheduleBaselineRef.current = cloneSchedule(cleared);
      setScheduleFormKey((k) => k + 1);
      await Promise.all([loadOpsBoardQuiet(), loadScheduledFlightsList()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Schedule failed');
    } finally {
      setIsSchedulingSubmit(false);
    }
  }

  async function assignAircraft() {
    if (!selectedFlightId || !selectedAircraftId) {
      setError('Select flight and aircraft.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      await fetchJson(`/api/operations/flights/${selectedFlightId}/assign-aircraft`, {
        method: 'POST',
        body: JSON.stringify({ aircraftId: selectedAircraftId })
      });
      toast.success('Aircraft assigned');
      await loadDayAndDetails();
      await refreshFlightDetails(selectedFlightId);
      await loadOpsBoardQuiet();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assign failed');
    } finally {
      setIsLoading(false);
    }
  }

  async function assignCrew() {
    if (!selectedFlightId || !selectedCrewId) return;
    setIsLoading(true);
    setError('');
    try {
      await fetchJson(`/api/operations/flights/${selectedFlightId}/assign-crew`, {
        method: 'POST',
        body: JSON.stringify({ crewUserId: selectedCrewId, dutyRole })
      });
      toast.success('Crew saved');
      await refreshFlightDetails(selectedFlightId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Crew failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  }

  async function removeCrew(assignmentId: string) {
    if (!selectedFlightId) return;
    try {
      await fetchJson(`/api/operations/flights/${selectedFlightId}/crew/${assignmentId}`, { method: 'DELETE' });
      toast.success('Crew removed');
      await refreshFlightDetails(selectedFlightId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Remove failed');
    }
  }

  async function logDispatch() {
    if (!selectedFlightId) return;
    setIsLoading(true);
    setError('');
    try {
      await fetchJson(`/api/operations/flights/${selectedFlightId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ dispatchStatus, remarks: dispatchRemarks })
      });
      toast.success('Dispatch logged');
      await loadDayAndDetails();
      await refreshFlightDetails(selectedFlightId);
      await loadOpsBoardQuiet();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dispatch failed');
    } finally {
      setIsLoading(false);
    }
  }

  async function dispatchRelease() {
    if (!selectedFlightId) return;
    setIsLoading(true);
    setError('');
    try {
      await fetchJson(`/api/operations/flights/${selectedFlightId}/dispatch-release`, {
        method: 'POST',
        body: JSON.stringify({
          remarks: dispatchReleaseRemarks || undefined,
          checklist: dispatchChecklist
        })
      });
      toast.success('Dispatch release logged — check-in may open when flight was scheduled.');
      setDispatchChecklist(emptyDispatchChecklist());
      setDispatchReleaseRemarks('');
      await loadDayAndDetails();
      await refreshFlightDetails(selectedFlightId);
      await loadOpsBoardQuiet();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Release failed');
    } finally {
      setIsLoading(false);
    }
  }

  async function patchStatus() {
    if (!selectedFlightId) return;
    setIsLoading(true);
    setError('');
    try {
      await fetchJson(`/api/operations/flights/${selectedFlightId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: statusPick })
      });
      toast.success('Status updated');
      await loadDayAndDetails();
      await refreshFlightDetails(selectedFlightId);
      await loadOpsBoardQuiet();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status failed');
    } finally {
      setIsLoading(false);
    }
  }

  async function logDelay() {
    if (!selectedFlightId || !delayReason.trim()) {
      setError('Delay reason required (min 3 chars in API).');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const delayBody: Record<string, unknown> = {
        delayMinutes: Number(delayMinutes),
        reason: delayReason.trim()
      };
      if (delayRevisedDeparture.trim()) {
        delayBody.revisedDepartureTime = new Date(delayRevisedDeparture).toISOString();
      }
      if (delayOperationalNotes.trim()) {
        delayBody.operationalNotes = delayOperationalNotes.trim();
      }
      await fetchJson(`/api/operations/flights/${selectedFlightId}/delays`, {
        method: 'POST',
        body: JSON.stringify(delayBody)
      });
      toast.success('Delay recorded');
      await loadDayAndDetails();
      await refreshFlightDetails(selectedFlightId);
      await loadOpsBoardQuiet();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delay failed');
    } finally {
      setIsLoading(false);
    }
  }

  async function cancelFlight() {
    if (!selectedFlightId || cancelReason.trim().length < 3) {
      setError('Cancellation reason (min 3 characters) required.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      await fetchJson(`/api/operations/flights/${selectedFlightId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason })
      });
      toast.success('Flight cancelled');
      setCancelReason('');
      await loadDayAndDetails();
      await loadOpsBoardQuiet();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setIsLoading(false);
    }
  }

  async function goToFlightInControl(f: Flight) {
    const utcDay = new Date(f.departure_time).toISOString().slice(0, 10);
    setTab('control');
    await loadDayAndDetails({ date: utcDay, selectFlightId: f.id });
  }

  async function cancelFlightFromTable(flightId: string, flightNo: string) {
    const reason = window.prompt(`Cancel flight ${flightNo} — enter a reason (minimum 3 characters):`);
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error('Cancellation reason must be at least 3 characters.');
      return;
    }
    setTableActionFlightId(flightId);
    try {
      await fetchJson(`/api/operations/flights/${flightId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });
      toast.success(`Flight ${flightNo} cancelled.`);
      await loadScheduledFlightsList();
      await loadOpsBoardQuiet();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setTableActionFlightId(null);
    }
  }

  function openScheduleFlightEdit(f: Flight) {
    setEditFlight(f);
    setEditForm({
      flightNumber: f.flight_number,
      routeId: f.route_id || '',
      departureTime: toDatetimeLocalValue(f.departure_time),
      arrivalTime: toDatetimeLocalValue(f.arrival_time),
      gate: f.gate || '',
      boardingTime: f.boarding_time ? toDatetimeLocalValue(f.boarding_time) : ''
    });
  }

  async function saveScheduleFlightEdit() {
    if (!editFlight) return;
    if (!editForm.flightNumber.trim()) {
      toast.error('Flight number is required.');
      return;
    }
    if (!editForm.departureTime || !editForm.arrivalTime) {
      toast.error('Departure and arrival are required.');
      return;
    }
    setIsEditSaving(true);
    try {
      await fetchJson(`/api/operations/flights/${editFlight.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          flightNumber: editForm.flightNumber.trim().toUpperCase(),
          routeId: editForm.routeId || undefined,
          departureTime: new Date(editForm.departureTime).toISOString(),
          arrivalTime: new Date(editForm.arrivalTime).toISOString(),
          gate: editForm.gate.trim() || null,
          boardingTime: editForm.boardingTime ? new Date(editForm.boardingTime).toISOString() : null
        })
      });
      toast.success('Flight updated.');
      setEditFlight(null);
      await loadScheduledFlightsList();
      await loadOpsBoardQuiet();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setIsEditSaving(false);
    }
  }

  return (
    <main className="module-page ops-shell-page">
      <section className="module-card">
        <h1>Flight Operations</h1>
        <p style={{ marginTop: 0, color: '#64748b', maxWidth: '52rem' }}>
          Airline-style OCC: status workflow, dispatch release checklist, load snapshot, crew roles with overlap protection,
          delay capture with revised times, operational alerts, and audit timeline per flight.
        </p>
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {(['board', 'routes', 'schedule', 'control', 'occ'] as const).map((t) => (
            <button key={t} type="button" className={tab === t ? '' : 'secondary'} onClick={() => setTab(t)}>
              {t === 'board' && 'Operations board'}
              {t === 'routes' && 'Routes'}
              {t === 'schedule' && 'Schedule flight'}
              {t === 'control' && 'Flight control'}
              {t === 'occ' && 'OCC hub'}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <p className="module-card" style={{ color: '#b91c1c', margin: 0 }}>
          {error}
        </p>
      )}

      {tab === 'board' && (
        <section className="module-card ops-board">
          <h2>Operations board (OCC)</h2>
          <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 0 }}>
            Flights load by <strong>UTC departure date</strong>. Align this date with Flight control when local “today”
            differs from UTC. Check-in and boarding scans require flight status <strong>CHECKIN_OPEN</strong>,{' '}
            <strong>BOARDING</strong>, or <strong>DELAYED</strong> (boarding ops also allow <strong>GATE_CLOSED</strong>).
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
            <button type="button" onClick={() => void loadOpsBoard()} disabled={isLoading}>
              {isLoading ? 'Refreshing…' : 'Refresh'}
            </button>
            {isLoading && boardFlights.length === 0 ? (
              <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Loading…</span>
            ) : null}
          </div>
          <div className="ops-filters">
            <label>
              Board date (UTC)
              <input
                type="date"
                value={boardViewDate}
                onChange={(e) => {
                  setBoardViewDate(e.target.value);
                }}
              />
            </label>
            <label>
              Status
              <select value={boardFilterStatus} onChange={(e) => setBoardFilterStatus(e.target.value)}>
                <option value="">All</option>
                {FLIGHT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Route / flight
              <input
                placeholder="e.g. HKG-NRT or HW101"
                value={boardFilterRoute}
                onChange={(e) => setBoardFilterRoute(e.target.value)}
              />
            </label>
            <label>
              Aircraft tail
              <input placeholder="Tail" value={boardFilterTail} onChange={(e) => setBoardFilterTail(e.target.value)} />
            </label>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#475569', margin: '0 0 0.75rem' }}>
            {Object.entries(summaryByStatus)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${k}: ${n}`)
              .join(' · ') || 'No flights on this date'}
          </p>
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Flight</th>
                  <th>Route</th>
                  <th>Departs</th>
                  <th>Status</th>
                  <th>Aircraft</th>
                  <th>Gate</th>
                  <th>Manifest</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {boardFlights.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ color: '#64748b' }}>
                      No flights for this UTC date.
                    </td>
                  </tr>
                ) : filteredBoardFlights.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ color: '#64748b' }}>
                      No flights match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredBoardFlights.map((f) => {
                    const st = String(f.status || '').toUpperCase();
                    const cancelled = st === 'CANCELLED';
                    const busy = tableActionFlightId === f.id;
                    return (
                      <tr key={f.id}>
                        <td style={{ fontWeight: 700 }}>{f.flight_number}</td>
                        <td>
                          {f.departure_airport}→{f.arrival_airport}
                          {f.route_label ? <span style={{ color: '#64748b' }}> ({f.route_label})</span> : null}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{new Date(f.departure_time).toLocaleString()}</td>
                        <td>
                          <span className={opsStatusBadgeClass(f.status)}>{f.status}</span>
                        </td>
                        <td>{f.tail_number || '—'}</td>
                        <td>{f.gate || '—'}</td>
                        <td>
                          <Link href={`/checkin?flightId=${encodeURIComponent(f.id)}`} className="secondary" style={{ fontSize: '0.72rem' }}>
                            Manifest
                          </Link>
                        </td>
                        <td>
                          <div className="ops-actions">
                            <button type="button" className="secondary" onClick={() => void openOpsDrawer(f.id, 'overview')}>
                              View
                            </button>
                            <button type="button" className="secondary" onClick={() => void goToFlightInControl(f)}>
                              Edit
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              disabled={cancelled || busy}
                              onClick={() => void openOpsDrawer(f.id, 'delays')}
                            >
                              Delay
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              disabled={cancelled || busy}
                              onClick={() => void cancelFlightFromTable(f.id, f.flight_number)}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              disabled={cancelled || busy}
                              onClick={() => void patchFlightStatusById(f.id, 'CHECKIN_OPEN')}
                            >
                              Open ck-in
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              disabled={cancelled || busy}
                              onClick={() => void patchFlightStatusById(f.id, 'BOARDING')}
                            >
                              Boarding
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              disabled={cancelled || busy}
                              onClick={() => void patchFlightStatusById(f.id, 'GATE_CLOSED')}
                            >
                              Close gate
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              disabled={cancelled || busy}
                              onClick={() => void openOpsDrawer(f.id, 'dispatch')}
                            >
                              Dispatch rel.
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'routes' && (
        <section className="module-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 style={{ margin: 0 }}>Route management</h2>
            <button type="button" className="secondary" disabled={catalogLoading} onClick={() => void loadCatalog()}>
              {catalogLoading ? 'Refreshing…' : 'Refresh routes'}
            </button>
          </div>
          {catalogError ? (
            <p style={{ color: '#b91c1c', fontSize: '0.9rem' }} role="alert">
              {catalogError}
            </p>
          ) : null}
          <form onSubmit={handleCreateRoute} className="module-form-grid" style={{ marginBottom: '1rem' }}>
            <input
              placeholder="Origin IATA"
              value={newRoute.origin}
              onChange={(e) => setNewRoute({ ...newRoute, origin: e.target.value.toUpperCase() })}
            />
            <input
              placeholder="Dest IATA"
              value={newRoute.dest}
              onChange={(e) => setNewRoute({ ...newRoute, dest: e.target.value.toUpperCase() })}
            />
            <input
              placeholder="Label (optional)"
              value={newRoute.label}
              onChange={(e) => setNewRoute({ ...newRoute, label: e.target.value })}
            />
            <button type="submit">Add route</button>
          </form>
          <table className="module-table">
            <thead>
              <tr>
                <th>Origin</th>
                <th>Dest</th>
                <th>Label</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {routes.length === 0 && !catalogLoading && !catalogError ? (
                <tr>
                  <td colSpan={5} style={{ color: '#64748b', fontSize: '0.85rem' }}>
                    No routes yet. Add one above or run database fixes to load sample routes.
                  </td>
                </tr>
              ) : null}
              {routes.map((r) => (
                <tr key={r.id}>
                  <td>{r.origin_airport}</td>
                  <td>{r.dest_airport}</td>
                  <td>{r.label || '—'}</td>
                  <td>{r.is_active ? 'Yes' : 'No'}</td>
                  <td>
                    <button type="button" className="secondary" onClick={() => void toggleRouteActive(r)}>
                      Toggle active
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'schedule' && (
        <section className="module-card">
          <h2>Flight scheduling</h2>
          <p style={{ fontSize: '0.88rem', color: '#64748b' }}>
            Every flight needs <strong>route</strong> (or explicit airports via route picker), <strong>aircraft</strong>,{' '}
            <strong>departure &amp; arrival times</strong>, and a <strong>flight number</strong>. Overlapping aircraft
            assignments are blocked. Use <strong>New flight</strong> to start fresh with a suggested number, or{' '}
            <strong>Clear form</strong> / <strong>Reset</strong> to avoid the form staying on old values.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.75rem' }}>
            <button type="button" onClick={() => void handleNewFlight()} disabled={isSchedulingSubmit}>
              New flight
            </button>
            <button type="button" className="secondary" onClick={() => void handleSuggestFlightNumber()} disabled={isSchedulingSubmit}>
              Suggest flight number
            </button>
            <button type="button" className="secondary" onClick={handleClearScheduleForm} disabled={isSchedulingSubmit}>
              Clear form
            </button>
            <button type="button" className="secondary" onClick={handleResetScheduleForm} disabled={isSchedulingSubmit}>
              Reset
            </button>
            <button type="button" className="secondary" onClick={handleDuplicateScheduleFlight} disabled={isSchedulingSubmit}>
              Duplicate flight
            </button>
          </div>
          {scheduleSuccess ? (
            <div
              style={{
                margin: '0 0 0.75rem',
                padding: '0.55rem 0.65rem',
                borderRadius: 8,
                background: '#ecfdf5',
                color: '#065f46',
                fontSize: '0.9rem'
              }}
              role="status"
            >
              <p style={{ margin: 0 }}>{scheduleSuccess}</p>
              {lastCreatedFlight ? (
                <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  <button type="button" className="secondary" onClick={() => void goToFlightInControl(lastCreatedFlight)}>
                    View created flight (Flight control)
                  </button>
                  <Link href={`/checkin?flightId=${encodeURIComponent(lastCreatedFlight.id)}`} className="secondary" style={{ fontSize: '0.88rem' }}>
                    Open check-in / manifest
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
          <form key={scheduleFormKey} autoComplete="off" onSubmit={handleScheduleFlight} className="module-form-grid">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Flight number (editable)</span>
              <input
                name="schedule_flight_number"
                autoComplete="off"
                placeholder="e.g. HW101"
                value={scheduleData.flightNumber}
                onChange={(e) => setScheduleData({ ...scheduleData, flightNumber: e.target.value.toUpperCase() })}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Route (required, editable)</span>
              <select
                name="schedule_route_id"
                autoComplete="off"
                value={scheduleData.routeId}
                onChange={(e) => setScheduleData({ ...scheduleData, routeId: e.target.value })}
              >
                <option value="">Select route</option>
                {routes
                  .filter((r) => r.is_active)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.origin_airport}→{r.dest_airport} {r.label ? `— ${r.label}` : ''}
                    </option>
                  ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Aircraft (required, editable)</span>
              <select
                name="schedule_aircraft_id"
                autoComplete="off"
                value={scheduleData.aircraftId}
                onChange={(e) => setScheduleData({ ...scheduleData, aircraftId: e.target.value })}
              >
                <option value="">Select aircraft</option>
                {aircraft.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.tail_number} ({a.release_status})
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Departure (local, editable)</span>
              <input
                name="schedule_departure"
                autoComplete="off"
                type="datetime-local"
                value={scheduleData.departureTime}
                onChange={(e) => setScheduleData({ ...scheduleData, departureTime: e.target.value })}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Arrival (local, editable)</span>
              <input
                name="schedule_arrival"
                autoComplete="off"
                type="datetime-local"
                value={scheduleData.arrivalTime}
                onChange={(e) => setScheduleData({ ...scheduleData, arrivalTime: e.target.value })}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Gate (optional, editable)</span>
              <input
                name="schedule_gate"
                autoComplete="off"
                placeholder="Gate (optional)"
                value={scheduleData.gate}
                onChange={(e) => setScheduleData({ ...scheduleData, gate: e.target.value })}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Boarding time (optional, editable)</span>
              <input
                name="schedule_boarding"
                autoComplete="off"
                type="datetime-local"
                value={scheduleData.boardingTime}
                onChange={(e) => setScheduleData({ ...scheduleData, boardingTime: e.target.value })}
              />
            </label>
            <button type="submit" disabled={isSchedulingSubmit}>
              {isSchedulingSubmit ? 'Creating…' : 'Create flight'}
            </button>
          </form>
          <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
            Dispatch release (boarding) requires this route link plus aircraft on the flight record.
          </p>
          <button type="button" className="secondary" disabled={catalogLoading} onClick={() => void loadCatalog()}>
            {catalogLoading ? 'Reloading…' : 'Reload routes & aircraft'}
          </button>
          {catalogError ? (
            <p style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: '0.35rem' }} role="alert">
              {catalogError}
            </p>
          ) : null}

          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Scheduled flights (recent)</h3>
              <button type="button" className="secondary" disabled={scheduleListLoading} onClick={() => void loadScheduledFlightsList()}>
                {scheduleListLoading ? 'Refreshing…' : 'Refresh list'}
              </button>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
              New flights appear here immediately after create. Today&apos;s board (UTC date) refreshes at the same time.
            </p>
            <div style={{ overflowX: 'auto', marginTop: '0.5rem' }}>
              <table className="module-table">
                <thead>
                  <tr>
                    <th>Flight number</th>
                    <th>Route</th>
                    <th>Aircraft</th>
                    <th>Departure</th>
                    <th>Arrival</th>
                    <th>Gate</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleListLoading && scheduledFlights.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ color: '#64748b' }}>
                        Loading…
                      </td>
                    </tr>
                  ) : null}
                  {!scheduleListLoading && scheduledFlights.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ color: '#64748b', fontSize: '0.88rem' }}>
                        No flights yet. Create one above — it will show in this list and on Today&apos;s board when the departure date (UTC) matches today.
                      </td>
                    </tr>
                  ) : null}
                  {scheduledFlights.map((f) => {
                    const cancelled = String(f.status || '').toUpperCase() === 'CANCELLED';
                    const busy = tableActionFlightId === f.id;
                    return (
                      <tr key={f.id}>
                        <td>{f.flight_number}</td>
                        <td>
                          {f.departure_airport}→{f.arrival_airport}
                          {f.route_label ? <span style={{ color: '#64748b', fontSize: '0.78rem' }}> ({f.route_label})</span> : null}
                        </td>
                        <td>{f.tail_number || '—'}</td>
                        <td>{new Date(f.departure_time).toLocaleString()}</td>
                        <td>{new Date(f.arrival_time).toLocaleString()}</td>
                        <td>{f.gate || '—'}</td>
                        <td>
                          <span className={opsStatusBadgeClass(f.status)}>{f.status}</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                            <button type="button" className="secondary" style={{ fontSize: '0.75rem' }} onClick={() => void goToFlightInControl(f)}>
                              View
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              style={{ fontSize: '0.75rem' }}
                              disabled={cancelled || busy}
                              onClick={() => openScheduleFlightEdit(f)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              style={{ fontSize: '0.75rem' }}
                              disabled={cancelled || busy}
                              onClick={() => void cancelFlightFromTable(f.id, f.flight_number)}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              style={{ fontSize: '0.75rem' }}
                              disabled={cancelled || busy}
                              onClick={() => openTableDispatchModal(f.id, f.flight_number)}
                            >
                              Dispatch release
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {editFlight ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-flight-title"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.45)',
                zIndex: 50,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem'
              }}
            >
              <div className="module-card" style={{ maxWidth: 520, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
                <h3 id="edit-flight-title" style={{ marginTop: 0 }}>
                  Edit flight {editFlight.flight_number}
                </h3>
                <div className="module-form-grid">
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Flight number</span>
                    <input
                      value={editForm.flightNumber}
                      onChange={(e) => setEditForm({ ...editForm, flightNumber: e.target.value.toUpperCase() })}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Route</span>
                    <select value={editForm.routeId} onChange={(e) => setEditForm({ ...editForm, routeId: e.target.value })}>
                      <option value="">Keep / no change</option>
                      {routes
                        .filter((r) => r.is_active)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.origin_airport}→{r.dest_airport}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Departure</span>
                    <input
                      type="datetime-local"
                      value={editForm.departureTime}
                      onChange={(e) => setEditForm({ ...editForm, departureTime: e.target.value })}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Arrival</span>
                    <input
                      type="datetime-local"
                      value={editForm.arrivalTime}
                      onChange={(e) => setEditForm({ ...editForm, arrivalTime: e.target.value })}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Gate</span>
                    <input value={editForm.gate} onChange={(e) => setEditForm({ ...editForm, gate: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Boarding time</span>
                    <input
                      type="datetime-local"
                      value={editForm.boardingTime}
                      onChange={(e) => setEditForm({ ...editForm, boardingTime: e.target.value })}
                    />
                  </label>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                  <button type="button" disabled={isEditSaving} onClick={() => void saveScheduleFlightEdit()}>
                    {isEditSaving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button type="button" className="secondary" disabled={isEditSaving} onClick={() => setEditFlight(null)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      )}

      {tab === 'control' && (
        <>
          <section className="module-card ops-board">
            <h2>Daily operations — flight list</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void loadDayAndDetails();
              }}
              className="module-form-grid"
            >
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <button type="submit" disabled={isLoading}>
                {isLoading ? 'Loading…' : 'Load day'}
              </button>
              <button type="button" className="secondary" disabled={isLoading} onClick={() => void loadDayAndDetails()}>
                Refresh
              </button>
            </form>
            <div className="ops-table-wrap" style={{ marginTop: '0.75rem' }}>
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Flight</th>
                    <th>Leg</th>
                    <th>Departure</th>
                    <th>Status</th>
                    <th>Tail</th>
                    <th>Manifest</th>
                    <th>Quick</th>
                  </tr>
                </thead>
                <tbody>
                  {flights.length === 0 && !isLoading ? (
                    <tr>
                      <td colSpan={7} style={{ color: '#64748b', fontSize: '0.85rem' }}>
                        No flights for this UTC date. Pick another date or schedule a flight.
                      </td>
                    </tr>
                  ) : null}
                  {flights.map((f) => {
                    const st = String(f.status || '').toUpperCase();
                    const cancelled = st === 'CANCELLED';
                    const busy = tableActionFlightId === f.id;
                    return (
                      <tr key={f.id}>
                        <td style={{ fontWeight: 700 }}>{f.flight_number}</td>
                        <td>
                          {f.departure_airport}→{f.arrival_airport}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{new Date(f.departure_time).toLocaleString()}</td>
                        <td>
                          <span className={opsStatusBadgeClass(f.status)}>{f.status}</span>
                        </td>
                        <td>{f.tail_number || '—'}</td>
                        <td>
                          <Link href={`/checkin?flightId=${encodeURIComponent(f.id)}`} className="secondary" style={{ fontSize: '0.72rem' }}>
                            Manifest
                          </Link>
                        </td>
                        <td>
                          <div className="ops-actions">
                            <button type="button" className="secondary" onClick={() => void openOpsDrawer(f.id)}>
                              View
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              disabled={cancelled || busy}
                              onClick={() => {
                                setSelectedFlightId(f.id);
                                void refreshFlightDetails(f.id);
                              }}
                            >
                              Select
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="module-card">
            <h2>Flight control (OCC)</h2>
            <div className="module-form-grid">
              <select
                value={selectedFlightId}
                onChange={(e) => {
                  setSelectedFlightId(e.target.value);
                  void refreshFlightDetails(e.target.value);
                }}
              >
                <option value="">Select flight</option>
                {flights.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.flight_number} {f.departure_airport}-{f.arrival_airport} ({f.status})
                  </option>
                ))}
              </select>
            </div>

            {details && (
              <div style={{ marginTop: '1rem', display: 'grid', gap: '1rem' }}>
                <div style={{ fontSize: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  <strong>{details.flight.flight_number}</strong>
                  <span style={{ color: '#64748b' }}>
                    Route link: {details.flight.route_id ? 'yes' : 'no'} · Tail: {details.flight.tail_number || '—'} ·
                    Maint.: {details.flight.aircraft_release_status || '—'}
                  </span>
                  <Link href={`/checkin?flightId=${encodeURIComponent(details.flight.id)}`} className="secondary" style={{ fontSize: '0.85rem' }}>
                    Open check-in / manifest
                  </Link>
                  <button type="button" className="secondary" onClick={() => void openOpsDrawer(details.flight.id, 'overview')}>
                    OCC drawer
                  </button>
                  {details.flight.cancellation_reason ? (
                    <div style={{ color: '#b91c1c', width: '100%' }}>Cancelled: {details.flight.cancellation_reason}</div>
                  ) : null}
                </div>

                {details.operationalSummary?.alerts?.length ? (
                  <div>
                    <h3 style={{ fontSize: '1rem', marginBottom: '0.35rem' }}>Operational alerts</h3>
                    {details.operationalSummary.alerts.map((a) => (
                      <div
                        key={`${a.code}-${a.message}`}
                        className={`ops-alert ops-alert--${a.severity === 'error' ? 'error' : a.severity === 'warning' ? 'warning' : 'info'}`}
                      >
                        <strong>{a.code}</strong> — {a.message}
                      </div>
                    ))}
                  </div>
                ) : null}

                {details.operationalSummary?.load ? (
                  <div>
                    <h3 style={{ fontSize: '1rem', marginBottom: '0.35rem' }}>Load snapshot</h3>
                    <div className="ops-kpi">
                      <div>
                        <strong>{details.operationalSummary.load.passengersBooked}</strong>
                        <span>Booked</span>
                      </div>
                      <div>
                        <strong>{details.operationalSummary.load.passengersCheckedIn}</strong>
                        <span>Checked-in</span>
                      </div>
                      <div>
                        <strong>{details.operationalSummary.load.passengersBoarded}</strong>
                        <span>Boarded</span>
                      </div>
                      <div>
                        <strong>{details.operationalSummary.load.baggagePieces}</strong>
                        <span>Bag pieces</span>
                      </div>
                      <div>
                        <strong>{details.operationalSummary.load.baggageWeightKg}</strong>
                        <span>Bag kg</span>
                      </div>
                      <div>
                        <strong>{details.operationalSummary.load.cargoWeightKg}</strong>
                        <span>Cargo kg</span>
                      </div>
                      <div>
                        <strong>{details.operationalSummary.load.estimatedFuelKg}</strong>
                        <span>Est. fuel kg</span>
                      </div>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0.35rem 0 0' }}>
                      Fuel figure is a planning estimate from booked load and baggage; confirm against flight plan.
                    </p>
                  </div>
                ) : null}

                <div>
                  <h3 style={{ fontSize: '1rem' }}>Aircraft</h3>
                  <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 0 }}>
                    Assignment enforces same-tail separation (minimum{' '}
                    {details.operationalSummary?.constants?.minTurnaroundMinutes ?? 45} minutes including ground
                    servicing). Dispatch release requires maintenance release (RELEASED) on the assigned aircraft.
                  </p>
                  <div className="module-form-grid">
                    <select value={selectedAircraftId} onChange={(e) => setSelectedAircraftId(e.target.value)}>
                      <option value="">Select aircraft</option>
                      {aircraft.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.tail_number} ({a.release_status})
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => void assignAircraft()}>
                      Assign / change aircraft
                    </button>
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: '1rem' }}>Crew roster</h3>
                  <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 0 }}>
                    Captain (PIC), First Officer (FO), and cabin positions. The server blocks assignments that break duty /
                    overlap rules — watch for error messages after assign.
                  </p>
                  <div className="module-form-grid">
                    <select value={selectedCrewId} onChange={(e) => setSelectedCrewId(e.target.value)}>
                      <option value="">Select crew</option>
                      {crew.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_name}
                        </option>
                      ))}
                    </select>
                    <select value={dutyRole} onChange={(e) => setDutyRole(e.target.value)}>
                      <option value="PIC">Captain (PIC)</option>
                      <option value="FO">First Officer (FO)</option>
                      <option value="SCC">Senior cabin (SCC)</option>
                      <option value="CC">Cabin crew (CC)</option>
                    </select>
                    <button type="button" onClick={() => void assignCrew()}>
                      Assign crew
                    </button>
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {details.crew.map((c) => (
                      <li key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <span>
                          {c.full_name} — {c.duty_role}
                        </span>
                        <button type="button" className="secondary" onClick={() => void removeCrew(c.id)}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 style={{ fontSize: '1rem' }}>Status &amp; dispatch</h3>
                  <div className="module-form-grid">
                    <select value={statusPick} onChange={(e) => setStatusPick(e.target.value)}>
                      {FLIGHT_STATUSES.filter((s) => s !== 'CANCELLED').map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="secondary" onClick={() => void patchStatus()}>
                      Set flight status
                    </button>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.5rem' }}>
                    Dispatch release moves the flight toward operations (typically <strong>CHECKIN_OPEN</strong>) after
                    checklist and maintenance release are satisfied.
                  </p>
                  <div className="ops-checklist" style={{ marginTop: '0.35rem' }}>
                    <strong style={{ fontSize: '0.85rem' }}>Dispatch release checklist</strong>
                    {DISPATCH_CHECKLIST_FIELDS.map(({ key, label }) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={dispatchChecklist[key]}
                          onChange={(e) => setDispatchChecklist({ ...dispatchChecklist, [key]: e.target.checked })}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="module-form-grid" style={{ marginTop: 8 }}>
                    <input
                      value={dispatchReleaseRemarks}
                      onChange={(e) => setDispatchReleaseRemarks(e.target.value)}
                      placeholder="Dispatch release remarks (optional)"
                    />
                    <button type="button" onClick={() => void dispatchRelease()}>
                      Submit dispatch release
                    </button>
                  </div>
                  <div className="module-form-grid" style={{ marginTop: 12 }}>
                    <select value={dispatchStatus} onChange={(e) => setDispatchStatus(e.target.value)}>
                      {FLIGHT_STATUSES.filter((s) => s !== 'CANCELLED').map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <input
                      value={dispatchRemarks}
                      onChange={(e) => setDispatchRemarks(e.target.value)}
                      placeholder="Dispatch log remarks"
                    />
                    <button type="button" className="secondary" onClick={() => void logDispatch()}>
                      Log dispatch (status + log)
                    </button>
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: '1rem' }}>Delay management</h3>
                  <div className="module-form-grid">
                    <input type="number" min={1} value={delayMinutes} onChange={(e) => setDelayMinutes(e.target.value)} />
                    <input
                      value={delayReason}
                      onChange={(e) => setDelayReason(e.target.value)}
                      placeholder="Delay reason (required, min 3 chars)"
                    />
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                      <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Revised departure (optional, shifts leg)</span>
                      <input type="datetime-local" value={delayRevisedDeparture} onChange={(e) => setDelayRevisedDeparture(e.target.value)} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                      <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Operational notes (optional)</span>
                      <textarea
                        rows={2}
                        value={delayOperationalNotes}
                        onChange={(e) => setDelayOperationalNotes(e.target.value)}
                        placeholder="Internal OCC notes"
                      />
                    </label>
                    <button type="button" onClick={() => void logDelay()}>
                      Record delay
                    </button>
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: '1rem' }}>Cancellation</h3>
                  <div className="module-form-grid">
                    <input
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="Cancellation reason (min 3 chars)"
                    />
                    <button type="button" className="secondary" onClick={() => void cancelFlight()}>
                      Cancel flight
                    </button>
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: '1rem' }}>Dispatch log</h3>
                  {details.dispatchLogs.map((l) => (
                    <p key={l.id} style={{ margin: '0.2rem 0', fontSize: '0.88rem' }}>
                      {l.dispatch_status} — {l.remarks || '—'} — {new Date(l.dispatched_at).toLocaleString()}
                      {l.checklist_json ? (
                        <span style={{ color: '#64748b' }}> · Checklist {formatChecklistSnippet(l.checklist_json)}</span>
                      ) : null}
                    </p>
                  ))}
                </div>
                <div>
                  <h3 style={{ fontSize: '1rem' }}>Delays</h3>
                  {details.delays.map((d) => (
                    <p key={d.id} style={{ margin: '0.2rem 0', fontSize: '0.88rem' }}>
                      {d.delay_minutes} min — {d.reason}
                      {d.revised_departure ? (
                        <span style={{ color: '#64748b' }}> · Revised dep {new Date(d.revised_departure).toLocaleString()}</span>
                      ) : null}
                      {d.operational_notes ? (
                        <span style={{ color: '#64748b' }}> · Notes: {d.operational_notes}</span>
                      ) : null}
                    </p>
                  ))}
                </div>

                {details.auditTimeline?.length ? (
                  <div>
                    <h3 style={{ fontSize: '1rem' }}>Audit timeline (recent)</h3>
                    <div className="ops-timeline">
                      {details.auditTimeline.slice(0, 40).map((row) => (
                        <div key={row.id} className="ops-timeline-item" style={{ fontSize: '0.84rem' }}>
                          <strong>{row.action}</strong>
                          <div style={{ color: '#64748b' }}>{new Date(row.created_at).toLocaleString()}</div>
                          {row.metadata != null ? (
                            <pre style={{ margin: '0.25rem 0 0', fontSize: '0.72rem', overflow: 'auto', maxHeight: 120 }}>
                              {formatChecklistSnippet(row.metadata)}
                            </pre>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </>
      )}

      {drawerOpen ? (
        <div
          className="ops-drawer-overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeOpsDrawer();
          }}
        >
          <aside
            className="ops-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ops-drawer-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="ops-drawer-header">
              <div>
                <h2 id="ops-drawer-title" style={{ margin: 0, fontSize: '1.12rem', fontWeight: 800 }}>
                  {drawerDetails?.flight.flight_number ?? 'Flight'}
                </h2>
                <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.35rem' }}>
                  {drawerDetails
                    ? `${drawerDetails.flight.departure_airport}→${drawerDetails.flight.arrival_airport} · ${new Date(
                        drawerDetails.flight.departure_time
                      ).toLocaleString()}`
                    : 'Loading…'}
                </div>
              </div>
              <button type="button" className="secondary" onClick={closeOpsDrawer}>
                Close
              </button>
            </div>
            <div className="ops-drawer-tabs">
              {(
                [
                  ['overview', 'Overview'],
                  ['load', 'Load control'],
                  ['dispatch', 'Dispatch release'],
                  ['delays', 'Delays'],
                  ['timeline', 'Timeline & audit']
                ] as const
              ).map(([tid, label]) => (
                <button
                  key={tid}
                  type="button"
                  data-active={drawerTab === tid}
                  onClick={() => {
                    setDrawerTab(tid);
                    if (tid === 'dispatch') {
                      setDrawerDispatchChecklist(emptyDispatchChecklist());
                      setDrawerDispatchRemarks('');
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="ops-drawer-body">
              {drawerLoading ? <p style={{ color: '#64748b' }}>Loading operational record…</p> : null}
              {!drawerLoading && drawerDetails ? (
                <>
                  {drawerTab === 'overview' ? (
                    <div>
                      <p style={{ marginTop: 0 }}>
                        <span className={opsStatusBadgeClass(drawerDetails.flight.status)}>{drawerDetails.flight.status}</span>{' '}
                        <span style={{ color: '#64748b' }}>
                          Gate {drawerDetails.flight.gate || '—'} · Maint. {drawerDetails.flight.aircraft_release_status || '—'}
                        </span>
                      </p>
                      {drawerDetails.operationalSummary?.alerts?.length ? (
                        <div style={{ marginTop: '0.5rem' }}>
                          {drawerDetails.operationalSummary.alerts.map((a) => (
                            <div
                              key={`${a.code}-${a.message}`}
                              className={`ops-alert ops-alert--${
                                a.severity === 'error' ? 'error' : a.severity === 'warning' ? 'warning' : 'info'
                              }`}
                            >
                              <strong>{a.code}</strong> — {a.message}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ color: '#64748b', fontSize: '0.86rem' }}>No active operational alerts.</p>
                      )}
                      <div className="ops-actions" style={{ marginTop: '0.75rem' }}>
                        <Link href={`/checkin?flightId=${encodeURIComponent(drawerDetails.flight.id)}`} className="secondary" style={{ fontSize: '0.75rem' }}>
                          Manifest
                        </Link>
                        <button
                          type="button"
                          className="secondary"
                          disabled={tableActionFlightId === drawerDetails.flight.id}
                          onClick={() => void goToFlightInControl(drawerDetails.flight)}
                        >
                          Edit in control
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={
                            String(drawerDetails.flight.status || '').toUpperCase() === 'CANCELLED' ||
                            tableActionFlightId === drawerDetails.flight.id
                          }
                          onClick={() => void patchFlightStatusById(drawerDetails.flight.id, 'CHECKIN_OPEN')}
                        >
                          Open ck-in
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={
                            String(drawerDetails.flight.status || '').toUpperCase() === 'CANCELLED' ||
                            tableActionFlightId === drawerDetails.flight.id
                          }
                          onClick={() => void patchFlightStatusById(drawerDetails.flight.id, 'BOARDING')}
                        >
                          Boarding
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={
                            String(drawerDetails.flight.status || '').toUpperCase() === 'CANCELLED' ||
                            tableActionFlightId === drawerDetails.flight.id
                          }
                          onClick={() => void patchFlightStatusById(drawerDetails.flight.id, 'GATE_CLOSED')}
                        >
                          Close gate
                        </button>
                        <button type="button" className="secondary" onClick={() => setDrawerTab('dispatch')}>
                          Dispatch checklist
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {drawerTab === 'load' && drawerDetails.operationalSummary?.load ? (
                    <div>
                      <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Load control</h3>
                      <div className="ops-kpi">
                        <div>
                          <strong>{drawerDetails.operationalSummary.load.passengersBooked}</strong>
                          <span>Booked</span>
                        </div>
                        <div>
                          <strong>{drawerDetails.operationalSummary.load.passengersCheckedIn}</strong>
                          <span>Checked-in</span>
                        </div>
                        <div>
                          <strong>{drawerDetails.operationalSummary.load.passengersBoarded}</strong>
                          <span>Boarded</span>
                        </div>
                        <div>
                          <strong>{drawerDetails.operationalSummary.load.baggagePieces}</strong>
                          <span>Bag pieces</span>
                        </div>
                        <div>
                          <strong>{drawerDetails.operationalSummary.load.baggageWeightKg}</strong>
                          <span>Bag kg</span>
                        </div>
                        <div>
                          <strong>{drawerDetails.operationalSummary.load.cargoWeightKg}</strong>
                          <span>Cargo kg</span>
                        </div>
                        <div>
                          <strong>{drawerDetails.operationalSummary.load.estimatedFuelKg}</strong>
                          <span>Est. fuel kg</span>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {drawerTab === 'dispatch' ? (
                    <div>
                      <p style={{ marginTop: 0, fontSize: '0.86rem', color: '#475569' }}>
                        All items must be checked before release. Aircraft must be maintenance-released and assigned with a
                        valid route.
                      </p>
                      <div className="ops-checklist">
                        {DISPATCH_CHECKLIST_FIELDS.map(({ key, label }) => (
                          <label key={key}>
                            <input
                              type="checkbox"
                              checked={drawerDispatchChecklist[key]}
                              onChange={(e) =>
                                setDrawerDispatchChecklist({ ...drawerDispatchChecklist, [key]: e.target.checked })
                              }
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: '0.65rem' }}>
                        <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Remarks</span>
                        <input
                          value={drawerDispatchRemarks}
                          onChange={(e) => setDrawerDispatchRemarks(e.target.value)}
                          placeholder="Optional remarks"
                        />
                      </label>
                      <button
                        type="button"
                        style={{ marginTop: '0.75rem' }}
                        disabled={
                          String(drawerDetails.flight.status || '').toUpperCase() === 'CANCELLED' ||
                          tableActionFlightId === drawerFlightId
                        }
                        onClick={() => void drawerConfirmDispatchRelease()}
                      >
                        Submit dispatch release
                      </button>
                    </div>
                  ) : null}

                  {drawerTab === 'delays' ? (
                    <div>
                      <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Record delay</h3>
                      <div className="module-form-grid">
                        <input
                          type="number"
                          min={1}
                          value={drawerDelayMinutes}
                          onChange={(e) => setDrawerDelayMinutes(e.target.value)}
                        />
                        <input
                          value={drawerDelayReason}
                          onChange={(e) => setDrawerDelayReason(e.target.value)}
                          placeholder="Reason (min 3 chars)"
                        />
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Revised departure</span>
                          <input type="datetime-local" value={drawerDelayRevised} onChange={(e) => setDrawerDelayRevised(e.target.value)} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Operational notes</span>
                          <textarea rows={3} value={drawerDelayNotes} onChange={(e) => setDrawerDelayNotes(e.target.value)} />
                        </label>
                        <button type="button" disabled={!drawerFlightId || tableActionFlightId === drawerFlightId} onClick={() => void recordDrawerDelay()}>
                          Record delay
                        </button>
                      </div>
                      <h4 style={{ margin: '1rem 0 0.35rem', fontSize: '0.88rem' }}>Delay history</h4>
                      {drawerDetails.delays.length === 0 ? (
                        <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No delays logged.</p>
                      ) : (
                        drawerDetails.delays.map((d) => (
                          <p key={d.id} style={{ margin: '0.25rem 0', fontSize: '0.84rem' }}>
                            {d.delay_minutes} min — {d.reason}
                            {d.revised_departure ? (
                              <span style={{ color: '#64748b' }}> · Rev. {new Date(d.revised_departure).toLocaleString()}</span>
                            ) : null}
                          </p>
                        ))
                      )}
                    </div>
                  ) : null}

                  {drawerTab === 'timeline' ? (
                    <div>
                      <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Operational timeline</h3>
                      <div className="ops-timeline">
                        {(drawerDetails.auditTimeline || []).slice(0, 80).map((row) => (
                          <div key={row.id} className="ops-timeline-item" style={{ fontSize: '0.84rem' }}>
                            <strong>{row.action}</strong>
                            <div style={{ color: '#64748b' }}>{new Date(row.created_at).toLocaleString()}</div>
                            {row.metadata != null ? (
                              <pre style={{ margin: '0.25rem 0 0', fontSize: '0.7rem', overflow: 'auto', maxHeight: 100 }}>
                                {formatChecklistSnippet(row.metadata)}
                              </pre>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      {!(drawerDetails.auditTimeline || []).length ? (
                        <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No audit entries for this flight yet.</p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {tab === 'occ' ? <OperationsOccHub /> : null}

      {tableDispatchModal ? (
        <div
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.5)',
            zIndex: 90,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem'
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setTableDispatchModal(null);
          }}
        >
          <div
            className="module-card"
            style={{ maxWidth: 500, width: '100%' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="table-dispatch-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="table-dispatch-title" style={{ marginTop: 0 }}>
              Dispatch release — {tableDispatchModal.flightNo}
            </h3>
            <p style={{ fontSize: '0.86rem', color: '#64748b', marginTop: 0 }}>
              Confirm each operational item. The server requires maintenance release on the assigned aircraft.
            </p>
            <div className="ops-checklist">
              {DISPATCH_CHECKLIST_FIELDS.map(({ key, label }) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={tableDispatchChecklist[key]}
                    onChange={(e) => setTableDispatchChecklist({ ...tableDispatchChecklist, [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: '0.65rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Remarks</span>
              <input value={tableDispatchRemarks} onChange={(e) => setTableDispatchRemarks(e.target.value)} placeholder="Optional" />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem', flexWrap: 'wrap' }}>
              <button type="button" disabled={tableActionFlightId === tableDispatchModal.flightId} onClick={() => void confirmTableDispatchRelease()}>
                Submit release
              </button>
              <button type="button" className="secondary" onClick={() => setTableDispatchModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </main>
  );
}
