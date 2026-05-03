'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import toast from 'react-hot-toast';
import { getPublicApiBaseUrl } from '@/lib/api-base';
import { hydrateSessionFromCookie } from '@/lib/auth-session';

const API_BASE_URL = getPublicApiBaseUrl();

type LegInfo = {
  flight_id: string;
  flight_number: string;
  departure_airport: string;
  arrival_airport: string;
  flight_status?: string;
  ticket_status?: string | null;
  gate_display?: string;
  boarding_display_time?: string;
  ticket_number?: string | null;
  checkin_id?: string | null;
  seat_number?: string | null;
  boarding_sequence?: number | null;
  is_checked_in?: boolean;
  boarding_status?: string | null;
  operational_status?: string;
  checkin_closed?: boolean;
};

type PassengerView = {
  id: string;
  first_name: string;
  last_name: string;
  passport_no?: string | null;
  travel_status?: string;
  legs: LegInfo[];
};

type PnrResponse = {
  matchType?: string;
  booking: { id: string; pnr: string; booking_status: string; payment_status: string; trip_type: string };
  lookup?: { source: string; ticket_number?: string | null };
  verification?: {
    booking_status: string;
    payment_status: string;
    flight_status_blocked_legs?: Array<{ flight_id: string; flight_number: string; status: string }>;
    last_name_match_required?: boolean;
    passport_last4_required_when_on_file?: boolean;
  };
  checkInEligible: boolean;
  checkInBlockedReason: string | null;
  itinerary: Array<{
    id: string;
    flight_number: string;
    departure_airport: string;
    arrival_airport: string;
    departure_time: string;
    leg_type: string;
    status?: string;
    gate_display?: string;
    boarding_display_time?: string;
    checkin_closed?: boolean;
  }>;
  passengers: PassengerView[];
};

type BagRow = { weightKg: string; pieces: string };

type BoardingPassPayload = {
  checkin_id?: string;
  passengerName: string;
  pnr: string;
  ticketNumber: string | null;
  flightNumber: string;
  route: string;
  seat: string;
  gate: string;
  boardingTime: string;
  boardingPassNo: string;
  departureTime?: string;
  boarding_sequence?: number | null;
  boarding_status?: string | null;
  checkin_status?: string | null;
};

type SeatMapCell = { id: string; cabin: string; available: boolean };

type ManifestPassenger = {
  booking_id: string;
  pnr: string;
  passenger_id: string;
  first_name: string;
  last_name: string;
  passenger_travel_status?: string;
  checkin_id: string | null;
  seat_number: string | null;
  boarding_pass_no: string | null;
  checkin_time: string | null;
  boarding_status: string | null;
  boarding_sequence?: number | null;
  baggage_weight_kg?: string | number | null;
  baggage_pieces?: number | null;
  ticket_number: string | null;
};

type NameSearchHit = {
  booking_id: string;
  pnr: string;
  booking_status: string;
  payment_status: string;
  passenger: { id: string; first_name: string; last_name: string };
};

type ReconciliationPayload = {
  flight: Record<string, unknown>;
  reconciliation: Record<string, unknown>;
  notes?: string[];
};

function getToken() {
  if (typeof window === 'undefined') return null;
  hydrateSessionFromCookie();
  return localStorage.getItem('hams_token');
}

async function downloadAuthedPdf(pathWithQuery: string, filenameFallback: string) {
  const token = getToken();
  if (!token) {
    toast.error('Login required.');
    return;
  }
  const res = await fetch(`${API_BASE_URL}${pathWithQuery}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    toast.error(err.message || `PDF failed (${res.status})`);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFallback;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CheckinPage() {
  const pathname = usePathname();
  const [unifiedQuery, setUnifiedQuery] = useState('');
  const [searchType, setSearchType] = useState<'auto' | 'pnr' | 'ticket' | 'name'>('auto');
  const [nameSearchResults, setNameSearchResults] = useState<NameSearchHit[] | null>(null);

  const [pnrInput, setPnrInput] = useState('');
  const [pnrLookupLastName, setPnrLookupLastName] = useState('');
  const [ticketInput, setTicketInput] = useState('');
  const [pnrData, setPnrData] = useState<PnrResponse | null>(null);
  const [pnrLoading, setPnrLoading] = useState(false);
  const [pnrError, setPnrError] = useState('');

  const [selectedPassengerId, setSelectedPassengerId] = useState('');
  const [selectedFlightId, setSelectedFlightId] = useState('');
  const [verificationLastName, setVerificationLastName] = useState('');
  const [verificationFirstName, setVerificationFirstName] = useState('');
  const [verificationPassportLast4, setVerificationPassportLast4] = useState('');
  const [seatNumber, setSeatNumber] = useState('');
  const [seatMap, setSeatMap] = useState<{ seats: SeatMapCell[]; layoutSource?: string } | null>(null);
  const [seatMapLoading, setSeatMapLoading] = useState(false);
  const [baggageRows, setBaggageRows] = useState<BagRow[]>([{ weightKg: '20', pieces: '1' }]);
  const [acceptExcessCharge, setAcceptExcessCharge] = useState(false);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [boardingPass, setBoardingPass] = useState<BoardingPassPayload | null>(null);
  const [lastBaggageRows, setLastBaggageRows] = useState<Array<{ id: string; tag_number?: string }>>([]);

  const [flightIdManifest, setFlightIdManifest] = useState('');
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifest, setManifest] = useState<{
    flight: Record<string, unknown>;
    summary: Record<string, number>;
    passengers: ManifestPassenger[];
    lists: {
      checkedIn: ManifestPassenger[];
      notCheckedIn: ManifestPassenger[];
      boarding: ManifestPassenger[];
      noShows: ManifestPassenger[];
      boarded: ManifestPassenger[];
    };
  } | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationPayload | null>(null);
  const [reconciliationLoading, setReconciliationLoading] = useState(false);
  const [closeCheckinLoading, setCloseCheckinLoading] = useState(false);

  const [gateEdit, setGateEdit] = useState('');
  const [boardingEdit, setBoardingEdit] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [scanFlightId, setScanFlightId] = useState('');
  const [scanGateAtScan, setScanGateAtScan] = useState('');
  const [scanStrictGate, setScanStrictGate] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);

  const fetchPnr = useCallback(async (overridePnr?: string, overrideLastName?: string) => {
    const pnr = (overridePnr ?? pnrInput).trim().toUpperCase();
    const lastName = (overrideLastName ?? pnrLookupLastName).trim();
    if (!pnr) {
      setPnrError('Enter a PNR.');
      return;
    }
    if (!lastName) {
      setPnrError('Enter passenger last name (DCS: PNR + last name lookup).');
      return;
    }
    setPnrError('');
    setPnrLoading(true);
    setBoardingPass(null);
    setLastBaggageRows([]);
    try {
      const token = getToken();
      if (!token) {
        setPnrError('Login required.');
        return;
      }
      const res = await fetch(
        `${API_BASE_URL}/api/checkin/lookup?pnr=${encodeURIComponent(pnr)}&lastName=${encodeURIComponent(lastName)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = (await res.json()) as PnrResponse & { message?: string; results?: NameSearchHit[] };
      if (!res.ok) {
        setPnrData(null);
        setPnrError(data.message || 'Lookup failed.');
        return;
      }
      setPnrData(data);
      setNameSearchResults(null);
      if (overridePnr) setPnrInput(pnr);
      setSelectedPassengerId('');
      setSelectedFlightId('');
      setVerificationLastName('');
      setVerificationFirstName('');
      setVerificationPassportLast4('');
      setSeatNumber('');
      setSeatMap(null);
      toast.success(`Loaded PNR ${data.booking.pnr} (verified last name)`);
    } catch {
      setPnrError('Network error.');
      setPnrData(null);
    } finally {
      setPnrLoading(false);
    }
  }, [pnrInput, pnrLookupLastName]);

  const fetchTicket = useCallback(async () => {
    const t = ticketInput.trim();
    if (!t) {
      setPnrError('Enter a ticket number.');
      return;
    }
    setPnrError('');
    setPnrLoading(true);
    setBoardingPass(null);
    setLastBaggageRows([]);
    try {
      const token = getToken();
      if (!token) {
        setPnrError('Login required.');
        return;
      }
      const res = await fetch(
        `${API_BASE_URL}/api/checkin/search?q=${encodeURIComponent(t)}&type=ticket`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = (await res.json()) as PnrResponse & { message?: string; results?: NameSearchHit[] };
      if (!res.ok) {
        setPnrData(null);
        setPnrError(data.message || 'Ticket lookup failed.');
        return;
      }
      setPnrData(data);
      setNameSearchResults(null);
      setPnrInput(data.booking.pnr);
      setSelectedPassengerId('');
      setSelectedFlightId('');
      setVerificationLastName('');
      setVerificationFirstName('');
      setVerificationPassportLast4('');
      setSeatNumber('');
      setSeatMap(null);
      toast.success(`Loaded ticket → PNR ${data.booking.pnr}`);
    } catch {
      setPnrError('Network error.');
      setPnrData(null);
    } finally {
      setPnrLoading(false);
    }
  }, [ticketInput]);

  const runUnifiedSearch = useCallback(async () => {
    const q = unifiedQuery.trim();
    if (!q) {
      setPnrError('Enter PNR, ticket number, or passenger name.');
      return;
    }
    setPnrError('');
    setPnrLoading(true);
    setBoardingPass(null);
    setLastBaggageRows([]);
    setNameSearchResults(null);
    try {
      const token = getToken();
      if (!token) {
        setPnrError('Login required.');
        return;
      }
      const res = await fetch(
        `${API_BASE_URL}/api/checkin/search?q=${encodeURIComponent(q)}&type=${searchType}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = (await res.json()) as PnrResponse & {
        message?: string;
        results?: NameSearchHit[];
        matchType?: string;
      };
      if (!res.ok) {
        setPnrData(null);
        setPnrError(data.message || 'Search failed.');
        return;
      }
      if (data.matchType === 'NAME' && Array.isArray(data.results)) {
        setPnrData(null);
        setNameSearchResults(data.results);
        setPnrInput('');
        setTicketInput('');
        toast.success(`${data.results.length} name match(es)`);
        return;
      }
      if (!data.booking) {
        setPnrData(null);
        setPnrError('No booking payload in response.');
        return;
      }
      setPnrData(data as PnrResponse);
      setPnrInput(data.booking.pnr);
      setTicketInput(data.lookup?.ticket_number || '');
      setSelectedPassengerId('');
      setSelectedFlightId('');
      setVerificationLastName('');
      setVerificationFirstName('');
      setVerificationPassportLast4('');
      setSeatNumber('');
      setSeatMap(null);
      toast.success(`Loaded ${data.matchType || 'booking'} ${data.booking.pnr}`);
    } catch {
      setPnrError('Network error.');
      setPnrData(null);
    } finally {
      setPnrLoading(false);
    }
  }, [unifiedQuery, searchType]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    const fid = q.get('flightId') || q.get('flight');
    if (fid && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fid)) {
      setFlightIdManifest(fid);
    }
  }, [pathname]);

  useEffect(() => {
    if (!selectedFlightId) {
      setSeatMap(null);
      return;
    }
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    setSeatMapLoading(true);
    void (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/checkin/flights/${selectedFlightId}/seats`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = (await res.json()) as { seats?: SeatMapCell[]; layoutSource?: string; message?: string };
        if (cancelled) return;
        if (!res.ok || !data.seats) {
          setSeatMap(null);
          return;
        }
        setSeatMap({ seats: data.seats, layoutSource: data.layoutSource });
      } catch {
        if (!cancelled) setSeatMap(null);
      } finally {
        if (!cancelled) setSeatMapLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedFlightId]);

  async function handleCheckIn(e: FormEvent) {
    e.preventDefault();
    if (!pnrData?.booking) return;
    setCheckinLoading(true);
    try {
      const token = getToken();
      if (!token) {
        toast.error('Login required.');
        return;
      }
      const bags = baggageRows
        .filter((b) => Number(b.weightKg) > 0)
        .map((b) => ({ weightKg: Number(b.weightKg), pieces: Number(b.pieces) || 1 }));
      const res = await fetch(`${API_BASE_URL}/api/checkin/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          pnr: pnrData.booking.pnr,
          passengerId: selectedPassengerId,
          flightId: selectedFlightId,
          seatNumber,
          verificationLastName,
          verificationFirstName: verificationFirstName.trim() || undefined,
          verificationPassportLast4,
          baggage: bags.length ? bags : undefined,
          acceptExcessCharge: bags.length ? acceptExcessCharge : undefined
        })
      });
      const data = (await res.json()) as {
        message?: string;
        boardingPass?: BoardingPassPayload & { checkin_id?: string; boarding_sequence?: number | null };
        baggage?: Array<{ id: string; tag_number?: string }>;
        excessCharge?: number;
        currency?: string;
      };
      if (!res.ok) {
        toast.error(data.message || 'Check-in failed.');
        return;
      }
      setBoardingPass(data.boardingPass || null);
      setLastBaggageRows((data.baggage || []).filter((b) => b.id));
      toast.success(data.message || 'Checked in');
      await fetchPnr();
    } catch {
      toast.error('Check-in request failed.');
    } finally {
      setCheckinLoading(false);
    }
  }

  async function loadManifest() {
    const id = flightIdManifest.trim();
    if (!id) {
      toast.error('Enter flight UUID');
      return;
    }
    setManifestLoading(true);
    setManifest(null);
    setReconciliation(null);
    try {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE_URL}/api/checkin/flights/${id}/manifest`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (await res.json()) as typeof manifest & { message?: string };
      if (!res.ok) {
        toast.error(data.message || 'Manifest failed');
        return;
      }
      setManifest(data as typeof manifest);
      const fl = data.flight as { gate?: string | null; boarding_time?: string | null };
      setGateEdit(fl.gate || '');
      setBoardingEdit(fl.boarding_time ? String(fl.boarding_time).slice(0, 16) : '');
      toast.success('Manifest loaded');
    } catch {
      toast.error('Manifest request failed');
    } finally {
      setManifestLoading(false);
    }
  }

  async function loadReconciliation() {
    const id = flightIdManifest.trim();
    if (!id) {
      toast.error('Enter flight UUID');
      return;
    }
    setReconciliationLoading(true);
    setReconciliation(null);
    try {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE_URL}/api/checkin/flights/${id}/reconciliation`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (await res.json()) as ReconciliationPayload & { message?: string };
      if (!res.ok) {
        toast.error(data.message || 'Reconciliation failed');
        return;
      }
      setReconciliation(data);
      toast.success('Reconciliation loaded');
    } catch {
      toast.error('Reconciliation request failed');
    } finally {
      setReconciliationLoading(false);
    }
  }

  async function closeFlightCheckin() {
    const id = flightIdManifest.trim();
    if (!id) return;
    setCloseCheckinLoading(true);
    try {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE_URL}/api/checkin/flights/${id}/close-check-in`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        toast.error(data.message || 'Close check-in failed');
        return;
      }
      toast.success(data.message || 'Check-in closed');
      await loadManifest();
    } catch {
      toast.error('Close check-in request failed');
    } finally {
      setCloseCheckinLoading(false);
    }
  }

  async function reopenFlightCheckin() {
    const id = flightIdManifest.trim();
    if (!id) return;
    setCloseCheckinLoading(true);
    try {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE_URL}/api/checkin/flights/${id}/reopen-check-in`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        toast.error(data.message || 'Reopen failed');
        return;
      }
      toast.success(data.message || 'Check-in reopened');
      await loadManifest();
    } catch {
      toast.error('Reopen check-in request failed');
    } finally {
      setCloseCheckinLoading(false);
    }
  }

  async function saveGateBoarding() {
    const id = flightIdManifest.trim();
    if (!id) return;
    const token = getToken();
    if (!token) return;
    const res = await fetch(`${API_BASE_URL}/api/checkin/flights/${id}/gate-boarding`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        gate: gateEdit || null,
        boardingTime: boardingEdit ? new Date(boardingEdit).toISOString() : null
      })
    });
    const data = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(data.message || 'Update failed');
      return;
    }
    toast.success('Gate / boarding time saved');
    await loadManifest();
  }

  async function runBoardingScan() {
    const scan = scanInput.trim();
    if (!scan) {
      toast.error('Enter boarding pass #, ticket #, or PNR (PNR requires flight UUID).');
      return;
    }
    setScanLoading(true);
    try {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE_URL}/api/boarding/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          scan,
          flightId: scanFlightId.trim() || undefined,
          gateAtScan: scanGateAtScan.trim() || undefined,
          strictGate: scanStrictGate || undefined
        })
      });
      const data = (await res.json()) as { message?: string; boardingPass?: BoardingPassPayload & Record<string, unknown> };
      if (!res.ok) {
        toast.error(data.message || 'Scan failed');
        return;
      }
      toast.success(data.message || 'Boarded');
      if (data.boardingPass) {
        const bp = data.boardingPass;
        setBoardingPass({
          checkin_id: typeof bp.checkin_id === 'string' ? bp.checkin_id : undefined,
          passengerName: bp.passengerName,
          pnr: bp.pnr,
          ticketNumber: bp.ticketNumber ?? null,
          flightNumber: bp.flightNumber,
          route: bp.route,
          seat: bp.seat,
          gate: bp.gate,
          boardingTime: bp.boardingTime,
          boardingPassNo: bp.boardingPassNo,
          departureTime: bp.departureTime,
          boarding_sequence: (bp.boarding_sequence as number | null | undefined) ?? null,
          boarding_status: (bp.boarding_status as string | undefined) ?? null,
          checkin_status: (bp.checkin_status as string | undefined) ?? null
        });
      }
      setScanInput('');
      if (flightIdManifest.trim()) await loadManifest();
    } catch {
      toast.error('Scan request failed');
    } finally {
      setScanLoading(false);
    }
  }

  async function markBoarding(checkinId: string, boardingStatus: 'BOARDING' | 'BOARDED' | 'NO_SHOW') {
    const token = getToken();
    if (!token) return;
    const res = await fetch(`${API_BASE_URL}/api/boarding/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        checkinId,
        boardingStatus,
        gateAtScan: scanGateAtScan.trim() || undefined
      })
    });
    const data = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(data.message || 'Update failed');
      return;
    }
    toast.success(`Marked ${boardingStatus.replace('_', ' ')}`);
    await loadManifest();
  }

  const selectedPax = pnrData?.passengers.find((p) => p.id === selectedPassengerId);
  const legOptions = selectedPax?.legs.filter((l) => !l.is_checked_in) || [];

  return (
    <main className="module-page">
      <section className="module-card">
        <h1>Check-in &amp; Boarding</h1>
        <p style={{ marginTop: 0, color: '#64748b', maxWidth: '48rem' }}>
          Look up by PNR, verify identity, assign seats, tag baggage, and print boarding pass details. Only{' '}
          <strong>confirmed</strong> and <strong>paid</strong> bookings can check in. Each passenger may check in once per
          flight. Manifest view supports boarding and no-show updates.
        </p>
      </section>

      <section className="module-card">
        <h2>1) Retrieve booking</h2>
        <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Unified search (GET /api/checkin/search)</h3>
        <div className="module-form-grid" style={{ marginBottom: '1rem' }}>
          <input
            value={unifiedQuery}
            onChange={(e) => setUnifiedQuery(e.target.value)}
            placeholder="PNR, ticket number, or passenger name"
          />
          <select value={searchType} onChange={(e) => setSearchType(e.target.value as typeof searchType)}>
            <option value="auto">Auto</option>
            <option value="pnr">PNR</option>
            <option value="ticket">Ticket</option>
            <option value="name">Name</option>
          </select>
          <button type="button" onClick={() => void runUnifiedSearch()} disabled={pnrLoading}>
            {pnrLoading ? 'Loading…' : 'Search'}
          </button>
        </div>
        {nameSearchResults && nameSearchResults.length > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Name matches — open a booking by PNR:</p>
            <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
              {nameSearchResults.map((h) => (
                <li key={`${h.booking_id}-${h.passenger.id}`}>
                  <strong>
                    {h.passenger.first_name} {h.passenger.last_name}
                  </strong>{' '}
                  · PNR <strong>{h.pnr}</strong>{' '}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setPnrInput(h.pnr);
                      setPnrLookupLastName(h.passenger.last_name);
                      void fetchPnr(h.pnr, h.passenger.last_name);
                    }}
                  >
                    Load PNR
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>By PNR + passenger last name (DCS)</h3>
        <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 0 }}>
          Uses <code style={{ fontSize: '0.75rem' }}>GET /api/checkin/lookup</code> — record is returned only when the last name matches a passenger on the booking.
        </p>
        <div className="module-form-grid">
          <input
            value={pnrInput}
            onChange={(e) => setPnrInput(e.target.value.toUpperCase())}
            placeholder="PNR e.g. ABC12X"
          />
          <input
            value={pnrLookupLastName}
            onChange={(e) => setPnrLookupLastName(e.target.value)}
            placeholder="Passenger last name"
          />
          <button type="button" onClick={() => void fetchPnr()} disabled={pnrLoading}>
            {pnrLoading ? 'Loading…' : 'Retrieve'}
          </button>
        </div>
        <h3 style={{ fontSize: '0.95rem', margin: '1rem 0 0.5rem' }}>By ticket number</h3>
        <div className="module-form-grid">
          <input
            value={ticketInput}
            onChange={(e) => setTicketInput(e.target.value.trim())}
            placeholder="Ticket e.g. 555…"
          />
          <button type="button" onClick={() => void fetchTicket()} disabled={pnrLoading}>
            {pnrLoading ? 'Loading…' : 'Retrieve'}
          </button>
        </div>
        {pnrError && <p style={{ color: '#b91c1c' }}>{pnrError}</p>}
        {pnrData && (
          <div style={{ marginTop: '1rem' }}>
            {pnrData.lookup?.source && (
              <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                Loaded via <strong>{pnrData.lookup.source}</strong>
                {pnrData.lookup.ticket_number ? ` (ticket ${pnrData.lookup.ticket_number})` : ''}
              </p>
            )}
            <p>
              <strong>PNR:</strong> {pnrData.booking.pnr} | <strong>Status:</strong> {pnrData.booking.booking_status} |{' '}
              <strong>Payment:</strong> {pnrData.booking.payment_status} | <strong>Trip:</strong> {pnrData.booking.trip_type}
            </p>
            {pnrData.verification && (
              <p style={{ fontSize: '0.85rem', color: '#475569' }}>
                Identity checks: last name match required.
                {pnrData.verification.passport_last4_required_when_on_file
                  ? ' Passport last 4 required when a travel document is on file.'
                  : ' No passport on file — last 4 not required.'}{' '}
                Optional first name match available at check-in.
              </p>
            )}
            {pnrData.verification?.flight_status_blocked_legs &&
              pnrData.verification.flight_status_blocked_legs.length > 0 && (
                <p style={{ fontSize: '0.85rem', color: '#b45309', fontWeight: 600 }}>
                  Flight status: check-in is blocked on{' '}
                  {pnrData.verification.flight_status_blocked_legs.map((x) => `${x.flight_number} (${x.status})`).join(', ')}
                  .
                </p>
              )}
            {!pnrData.checkInEligible && (
              <p style={{ color: '#b45309', fontWeight: 600 }}>Check-in blocked: {pnrData.checkInBlockedReason}</p>
            )}
            <h3 style={{ fontSize: '1rem' }}>Itinerary</h3>
            <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem' }}>
              {pnrData.itinerary.map((f) => (
                <li key={f.id}>
              {f.leg_type}: <strong>{f.flight_number}</strong> {f.departure_airport}→{f.arrival_airport} —{' '}
              {new Date(f.departure_time).toLocaleString()} | <strong>{f.status ?? '—'}</strong> | Gate{' '}
              {f.gate_display ?? 'TBD'} | Boarding{' '}
              {f.boarding_display_time ? new Date(f.boarding_display_time).toLocaleString() : '—'}
              {f.checkin_closed ? (
                <span style={{ color: '#b45309', fontWeight: 600 }}> · Check-in closed</span>
              ) : null}
                </li>
              ))}
            </ul>
            <h3 style={{ fontSize: '1rem', marginTop: '0.75rem' }}>Passengers &amp; leg status</h3>
            <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
              {pnrData.passengers.map((p) => (
                <li key={p.id}>
                  <strong>
                    {p.first_name} {p.last_name}
                  </strong>
                  <ul style={{ margin: '0.2rem 0 0.4rem' }}>
                    {p.legs.map((l) => (
                      <li key={l.flight_id}>
                        {l.flight_number}: {l.operational_status ?? (l.is_checked_in ? 'CHECKED_IN' : 'NOT_CHECKED_IN')}
                        {l.flight_status ? ` · flt ${l.flight_status}` : ''}
                        {l.ticket_status ? ` · tkt ${l.ticket_status}` : ''}
                        {l.seat_number ? ` · seat ${l.seat_number}` : ''}
                        {l.boarding_sequence != null ? ` · seq ${l.boarding_sequence}` : ''}
                        {l.checkin_closed ? ' · ck-in closed' : ''}
                        {l.ticket_number ? ` · ticket ${l.ticket_number}` : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {pnrData && (
        <section className="module-card">
          <h2>2) Passenger verification &amp; check-in</h2>
          {!pnrData.checkInEligible ? (
            <p style={{ color: '#64748b' }}>Fix booking status or payment before check-in.</p>
          ) : (
            <form onSubmit={handleCheckIn} style={{ display: 'grid', gap: '0.75rem' }}>
              <div className="module-form-grid">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Passenger</span>
                  <select
                    required
                    value={selectedPassengerId}
                    onChange={(e) => {
                      setSelectedPassengerId(e.target.value);
                      setSelectedFlightId('');
                    }}
                  >
                    <option value="">Select passenger</option>
                    {pnrData.passengers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.first_name} {p.last_name} ({p.travel_status || 'BOOKED'})
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Flight (not yet checked in)</span>
                  <select required value={selectedFlightId} onChange={(e) => setSelectedFlightId(e.target.value)}>
                    <option value="">Select flight leg</option>
                    {legOptions.map((l) => (
                      <option key={l.flight_id} value={l.flight_id}>
                        {l.flight_number} {l.departure_airport}→{l.arrival_airport}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  required
                  value={verificationLastName}
                  onChange={(e) => setVerificationLastName(e.target.value)}
                  placeholder="Verify: passenger last name"
                />
                <input
                  value={verificationFirstName}
                  onChange={(e) => setVerificationFirstName(e.target.value)}
                  placeholder="Optional: first name (strict match)"
                />
                <input
                  value={verificationPassportLast4}
                  onChange={(e) => setVerificationPassportLast4(e.target.value.toUpperCase())}
                  placeholder="Last 4 of passport (if on file)"
                />
                <input
                  required
                  value={seatNumber}
                  onChange={(e) => setSeatNumber(e.target.value.toUpperCase())}
                  placeholder="Seat e.g. 12A"
                />
              </div>
              {selectedFlightId && (
                <div style={{ marginTop: '0.5rem' }}>
                  <strong style={{ fontSize: '0.85rem' }}>Seat map</strong>{' '}
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    ({seatMapLoading ? 'loading…' : seatMap?.layoutSource || '—'})
                  </span>
                  {seatMap?.seats && seatMap.seats.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 4,
                        marginTop: 6,
                        maxHeight: 160,
                        overflowY: 'auto',
                        padding: 4,
                        background: '#f8fafc',
                        borderRadius: 6
                      }}
                    >
                      {seatMap.seats
                        .filter((s) => s.available)
                        .slice(0, 120)
                        .map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className="secondary"
                            style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                            onClick={() => setSeatNumber(s.id)}
                          >
                            {s.id}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
              <div>
                <strong>Baggage</strong>
                {baggageRows.map((row, i) => (
                  <div key={i} className="module-form-grid" style={{ marginTop: 6 }}>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={row.weightKg}
                      onChange={(e) => {
                        const next = [...baggageRows];
                        next[i] = { ...next[i], weightKg: e.target.value };
                        setBaggageRows(next);
                      }}
                      placeholder="Weight kg"
                    />
                    <input
                      type="number"
                      min={1}
                      value={row.pieces}
                      onChange={(e) => {
                        const next = [...baggageRows];
                        next[i] = { ...next[i], pieces: e.target.value };
                        setBaggageRows(next);
                      }}
                      placeholder="Pieces"
                    />
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setBaggageRows((r) => r.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary"
                  style={{ marginTop: 6 }}
                  onClick={() => setBaggageRows((r) => [...r, { weightKg: '', pieces: '1' }])}
                >
                  Add bag row
                </button>
                <label style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={acceptExcessCharge} onChange={(e) => setAcceptExcessCharge(e.target.checked)} />
                  Accept excess baggage charge (if quoted by API)
                </label>
              </div>
              <button type="submit" disabled={checkinLoading || legOptions.length === 0}>
                {checkinLoading ? 'Checking in…' : 'Complete check-in'}
              </button>
              {selectedPax && legOptions.length === 0 && (
                <p style={{ color: '#64748b', fontSize: '0.9rem' }}>This passenger is already checked in on all legs.</p>
              )}
            </form>
          )}
        </section>
      )}

      {boardingPass && (
        <section className="module-card boarding-pass" style={{ border: '2px dashed #0d47a1', background: '#f8fafc' }}>
          <h2>Boarding pass</h2>
          <div style={{ fontFamily: 'ui-monospace, monospace', lineHeight: 1.6 }}>
            <div>
              <strong>{boardingPass.passengerName}</strong>
            </div>
            <div>PNR: {boardingPass.pnr}</div>
            <div>Ticket: {boardingPass.ticketNumber || '—'}</div>
            <div>Flight: {boardingPass.flightNumber}</div>
            <div>Route: {boardingPass.route}</div>
            <div>Seat: {boardingPass.seat}</div>
            <div>Gate: {boardingPass.gate}</div>
            <div>Boarding time: {new Date(boardingPass.boardingTime).toLocaleString()}</div>
            {boardingPass.departureTime && (
              <div>Departure: {new Date(boardingPass.departureTime).toLocaleString()}</div>
            )}
            <div>BP #: {boardingPass.boardingPassNo}</div>
            {boardingPass.boarding_sequence != null && <div>Boarding sequence: {boardingPass.boarding_sequence}</div>}
            {(boardingPass.boarding_status || boardingPass.checkin_status) && (
              <div>
                Status: {boardingPass.boarding_status || '—'} / {boardingPass.checkin_status || '—'}
              </div>
            )}
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void downloadAuthedPdf(
                  `/api/checkin/documents/boarding-pass-pdf?ref=${encodeURIComponent(
                    boardingPass.checkin_id || boardingPass.boardingPassNo
                  )}`,
                  `boarding-pass-${boardingPass.boardingPassNo}.pdf`
                )
              }
            >
              Download BP PDF
            </button>
            {lastBaggageRows.map((b) => (
              <button
                key={b.id}
                type="button"
                className="secondary"
                onClick={() =>
                  void downloadAuthedPdf(
                    `/api/checkin/documents/baggage-tag-pdf?baggageId=${encodeURIComponent(b.id)}`,
                    `bag-tag-${b.tag_number || b.id}.pdf`
                  )
                }
              >
                Bag tag {b.tag_number || b.id.slice(0, 8)}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="module-card">
        <h2>3) Flight manifest &amp; boarding</h2>
        <p style={{ marginTop: 0, color: '#64748b', fontSize: '0.9rem' }}>
          Paste a flight id (from Operations schedule or booking itinerary). Lists confirmed + paid passengers only.
        </p>
        <div className="module-form-grid">
          <input
            value={flightIdManifest}
            onChange={(e) => setFlightIdManifest(e.target.value)}
            placeholder="Flight UUID"
          />
          <button type="button" onClick={() => void loadManifest()} disabled={manifestLoading}>
            {manifestLoading ? 'Loading…' : 'Load manifest'}
          </button>
          <button type="button" className="secondary" onClick={() => void loadReconciliation()} disabled={reconciliationLoading}>
            {reconciliationLoading ? 'Loading…' : 'Reconciliation'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void closeFlightCheckin()}
            disabled={closeCheckinLoading || !flightIdManifest.trim()}
          >
            {closeCheckinLoading ? '…' : 'Close flight check-in'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void reopenFlightCheckin()}
            disabled={closeCheckinLoading || !flightIdManifest.trim()}
          >
            {closeCheckinLoading ? '…' : 'Reopen check-in'}
          </button>
        </div>
        {reconciliation && (
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.75rem',
              background: '#f1f5f9',
              borderRadius: 8,
              fontSize: '0.85rem'
            }}
          >
            <strong>Reconciliation</strong>
            <pre style={{ margin: '0.5rem 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {JSON.stringify(reconciliation.reconciliation, null, 2)}
            </pre>
          </div>
        )}
        {manifest && (
          <div style={{ marginTop: '1rem', display: 'grid', gap: '1rem' }}>
            <div>
              <strong>
                {(manifest.flight as { flight_number?: string }).flight_number} —{' '}
                {(manifest.flight as { departure_airport?: string }).departure_airport}→
                {(manifest.flight as { arrival_airport?: string }).arrival_airport}
              </strong>
              <div style={{ fontSize: '0.9rem', marginTop: 4 }}>
                Gate: {(manifest.flight as { gate_display?: string }).gate_display} | Boarding:{' '}
                {new Date(
                  String((manifest.flight as { boarding_display_time?: string }).boarding_display_time || '')
                ).toLocaleString()}
                {(manifest.flight as { checkin_closed_at?: string | null }).checkin_closed_at ? (
                  <span style={{ color: '#b45309', fontWeight: 600 }}> · Passenger check-in closed</span>
                ) : null}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: 4 }}>
                Expected {manifest.summary.expectedCount} | Checked in {manifest.summary.checkedInCount} | Pending{' '}
                {manifest.summary.pendingCount ?? manifest.summary.notCheckedInCount} | In boarding{' '}
                {manifest.summary.boardingCount ?? 0} | Boarded {manifest.summary.boardedCount} | No-show{' '}
                {manifest.summary.noShowCount} | Baggage {manifest.summary.totalBaggagePieces ?? 0} pcs /{' '}
                {Number(manifest.summary.totalBaggageKg ?? 0).toFixed(1)} kg
              </div>
            </div>
            <div>
              <h3 style={{ fontSize: '0.95rem' }}>Gate / boarding time (desk)</h3>
              <div className="module-form-grid">
                <input value={gateEdit} onChange={(e) => setGateEdit(e.target.value)} placeholder="Gate e.g. A4" />
                <input
                  type="datetime-local"
                  value={boardingEdit}
                  onChange={(e) => setBoardingEdit(e.target.value)}
                />
                <button type="button" className="secondary" onClick={() => void saveGateBoarding()}>
                  Save gate &amp; boarding
                </button>
              </div>
            </div>
            <div>
              <h3 style={{ fontSize: '0.95rem' }}>Boarding scan (POST /api/boarding/scan)</h3>
              <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 0 }}>
                PNR scans require the flight UUID below. Optional gate validates against the flight record when strict gate
                is enabled.
              </p>
              <div className="module-form-grid">
                <input
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  placeholder="Scan / paste BP, ticket, or PNR"
                />
                <input
                  value={scanFlightId}
                  onChange={(e) => setScanFlightId(e.target.value)}
                  placeholder="Flight UUID (if required)"
                />
                <input
                  value={scanGateAtScan}
                  onChange={(e) => setScanGateAtScan(e.target.value)}
                  placeholder="Gate at scan (optional)"
                />
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={scanStrictGate} onChange={(e) => setScanStrictGate(e.target.checked)} />
                  Strict gate match
                </label>
                <button type="button" onClick={() => void runBoardingScan()} disabled={scanLoading}>
                  {scanLoading ? 'Scanning…' : 'Mark boarded'}
                </button>
              </div>
            </div>
            <div>
              <h3 style={{ fontSize: '0.95rem' }}>In boarding (BOARDING)</h3>
              <ManifestTable
                rows={manifest.lists.boarding || []}
                onMark={(id, st) => void markBoarding(id, st)}
              />
            </div>
            <div>
              <h3 style={{ fontSize: '0.95rem' }}>Checked-in passengers</h3>
              <ManifestTable
                rows={manifest.lists.checkedIn}
                onMark={(id, st) => void markBoarding(id, st)}
              />
            </div>
            <div>
              <h3 style={{ fontSize: '0.95rem' }}>Not checked in (no-show candidates)</h3>
              <ManifestTable rows={manifest.lists.notCheckedIn} onMark={() => {}} />
            </div>
            <div>
              <h3 style={{ fontSize: '0.95rem' }}>No-show (recorded)</h3>
              <ManifestTable rows={manifest.lists.noShows} onMark={() => {}} />
            </div>
            <div>
              <h3 style={{ fontSize: '0.95rem' }}>Boarded</h3>
              <ManifestTable rows={manifest.lists.boarded} onMark={() => {}} />
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function ManifestTable({
  rows,
  onMark
}: {
  rows: ManifestPassenger[];
  onMark: (checkinId: string, st: 'BOARDING' | 'BOARDED' | 'NO_SHOW') => void;
}) {
  if (!rows.length) {
    return <p style={{ color: '#64748b', margin: 0 }}>None.</p>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="module-table">
        <thead>
          <tr>
            <th>PNR</th>
            <th>Passenger</th>
            <th>Ticket</th>
            <th>Seat</th>
            <th>Seq</th>
            <th>Bags</th>
            <th>BP</th>
            <th>Boarding</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.pnr}-${r.passenger_id}-${r.checkin_id || 'nc'}`}>
              <td>{r.pnr}</td>
              <td>
                {r.first_name} {r.last_name}
              </td>
              <td>{r.ticket_number || '—'}</td>
              <td>{r.seat_number || '—'}</td>
              <td>{r.boarding_sequence ?? '—'}</td>
              <td style={{ fontSize: '0.75rem' }}>
                {r.checkin_id
                  ? `${r.baggage_pieces ?? 0} pc / ${r.baggage_weight_kg != null ? Number(r.baggage_weight_kg).toFixed(1) : '0'} kg`
                  : '—'}
              </td>
              <td style={{ fontSize: '0.75rem' }}>{r.boarding_pass_no || '—'}</td>
              <td>{r.boarding_status || (r.checkin_id ? 'CHECKED_IN' : '—')}</td>
              <td className="actions">
                {r.checkin_id && String(r.boarding_status || '').toUpperCase() === 'CHECKED_IN' && (
                  <>
                    <button type="button" className="secondary" onClick={() => onMark(r.checkin_id!, 'BOARDING')}>
                      Boarding
                    </button>
                    <button type="button" className="secondary" onClick={() => onMark(r.checkin_id!, 'BOARDED')}>
                      Boarded
                    </button>
                    <button type="button" className="secondary" onClick={() => onMark(r.checkin_id!, 'NO_SHOW')}>
                      No-show
                    </button>
                  </>
                )}
                {r.checkin_id && String(r.boarding_status || '').toUpperCase() === 'BOARDING' && (
                  <>
                    <button type="button" className="secondary" onClick={() => onMark(r.checkin_id!, 'BOARDED')}>
                      Boarded
                    </button>
                    <button type="button" className="secondary" onClick={() => onMark(r.checkin_id!, 'NO_SHOW')}>
                      No-show
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
