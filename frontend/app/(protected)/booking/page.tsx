'use client';

import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CSSProperties } from 'react';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { getPublicApiBaseUrl } from '@/lib/api-base';
import {
  downloadBookingInvoicePdf,
  downloadTicketPdf,
  emailTicketPdf,
  printTicketPdf
} from '@/lib/booking-documents';

type Flight = {
  id: string;
  flight_number: string;
  departure_airport: string;
  arrival_airport: string;
  departure_time: string;
  arrival_time: string;
  status: string;
  tail_number?: string | null;
  model?: string | null;
  seat_capacity?: number | string | null;
  duration_minutes?: number | string | null;
  seats_available?: number | string | null;
  fare_amount?: number | string | null;
  fare_currency?: string | null;
};

type BookingResponse = {
  booking: {
    id: string;
    pnr: string;
    trip_type: 'ONE_WAY' | 'RETURN';
    booking_status?: string;
    payment_status?: string;
    total_amount: string;
    currency: string;
    outboundFlight: Flight;
    inboundFlight: Flight | null;
    fare: {
      outboundPerPassenger: number;
      inboundPerPassenger: number;
      totalPerPassenger: number;
      passengerCount: number;
      breakdown?: Array<{ code: string; label: string; amount: number; type?: string }>;
    };
  };
  tickets?: Array<{
    id: string;
    ticket_number: string;
    issued_at?: string;
    passenger_id?: string;
    ticket_status?: string;
  }>;
};

type TicketResponse = {
  pnr: string;
  bookingId: string;
  tickets: Array<{ id: string; ticket_number: string; issued_at: string; ticket_status?: string }>;
};

type SearchResponse = {
  outboundFlights: Flight[];
  inboundFlights: Flight[];
};

type FareClassRow = { id: string; code: string; name: string; booking_class: string };

type PricingPreview = {
  outboundPerPax: number;
  inboundPerPax: number;
  totalPerPax: number;
  currency: string;
  bookingClass: string;
  breakdown: Array<{ code: string; label: string; amount: number; type?: string }>;
};

const API_BASE_URL = getPublicApiBaseUrl();

export default function BookingPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const defaultReturn = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, []);

  const [tripType, setTripType] = useState<'ONE_WAY' | 'RETURN'>('ONE_WAY');
  const [from, setFrom] = useState('DXB');
  const [to, setTo] = useState('NBO');
  const [departureDate, setDepartureDate] = useState(today);
  const [returnDate, setReturnDate] = useState(defaultReturn);
  const [passengerCount, setPassengerCount] = useState(1);
  const [outboundFlights, setOutboundFlights] = useState<Flight[]>([]);
  const [inboundFlights, setInboundFlights] = useState<Flight[]>([]);
  const [selectedOutboundFlightId, setSelectedOutboundFlightId] = useState('');
  const [selectedInboundFlightId, setSelectedInboundFlightId] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  const [passengerFullName, setPassengerFullName] = useState('Hawana Traveler');
  const [passengerGender, setPassengerGender] = useState('MALE');
  const [passengerDob, setPassengerDob] = useState('1996-01-10');
  const [passengerNationality, setPassengerNationality] = useState('Kenyan');
  const [passengerPassportNo, setPassengerPassportNo] = useState('P1234567');
  const [passengerPassportExpiry, setPassengerPassportExpiry] = useState('2030-12-31');
  const [passengerPhone, setPassengerPhone] = useState('+254700000000');
  const [passengerEmail, setPassengerEmail] = useState('guest@hawana.aero');
  const [passengerEmergencyContact, setPassengerEmergencyContact] = useState('+254711111111');
  const [outboundFareAmount, setOutboundFareAmount] = useState('220');
  const [inboundFareAmount, setInboundFareAmount] = useState('220');
  const [fareClasses, setFareClasses] = useState<FareClassRow[]>([]);
  const [fareClassId, setFareClassId] = useState('');
  const [pricingPreview, setPricingPreview] = useState<PricingPreview | null>(null);
  const [pricingError, setPricingError] = useState('');
  const [isBooking, setIsBooking] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [bookingSuccess, setBookingSuccess] = useState<BookingResponse | null>(null);
  const [ticketInfo, setTicketInfo] = useState<TicketResponse | null>(null);
  const [collectPayment, setCollectPayment] = useState(true);
  const [bookingNotes, setBookingNotes] = useState('');
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);
  const [docAction, setDocAction] = useState<string | null>(null);
  const [docMessage, setDocMessage] = useState('');
  const [issueTicketModalOpen, setIssueTicketModalOpen] = useState(false);
  const [issueTicketSubmitting, setIssueTicketSubmitting] = useState(false);

  function getToken() {
    return localStorage.getItem('hams_token');
  }

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE_URL}/api/master-data/catalog/booking`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = (await res.json()) as { fareClasses?: FareClassRow[]; message?: string };
        if (!res.ok || cancelled) return;
        const list = data.fareClasses || [];
        setFareClasses(list);
        setFareClassId((prev) => {
          if (prev) return prev;
          const econ = list.find((f) => f.code === 'ECON');
          return econ ? econ.id : '';
        });
      } catch {
        /* catalog optional when master-data not migrated */
      }
    }
    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPricing() {
      setPricingError('');
      setPricingPreview(null);
      if (!fareClassId || !selectedOutboundFlightId) return;
      const token = getToken();
      if (!token) return;
      const params = new URLSearchParams({
        outboundFlightId: selectedOutboundFlightId,
        fareClassId,
        tripType
      });
      if (tripType === 'RETURN' && selectedInboundFlightId) {
        params.set('inboundFlightId', selectedInboundFlightId);
      }
      try {
        const res = await fetch(`${API_BASE_URL}/api/master-data/pricing-preview?${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = (await res.json()) as PricingPreview & { message?: string };
        if (cancelled) return;
        if (!res.ok) {
          setPricingError(data.message || 'Could not load master-data pricing.');
          return;
        }
        setPricingPreview(data);
      } catch {
        if (!cancelled) setPricingError('Pricing preview unavailable.');
      }
    }
    void loadPricing();
    return () => {
      cancelled = true;
    };
  }, [fareClassId, selectedOutboundFlightId, selectedInboundFlightId, tripType]);

  function formatDurationMinutes(raw: number | string | null | undefined): string {
    const m = Math.max(0, Math.round(Number(raw ?? 0)));
    if (!Number.isFinite(m) || m <= 0) return '—';
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (h <= 0) return `${r}m`;
    if (r === 0) return `${h}h`;
    return `${h}h ${r}m`;
  }

  function formatFlightTime(iso: string | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  }

  function formatLegFare(f: Flight): string {
    const amt = f.fare_amount != null && f.fare_amount !== '' ? Number(f.fare_amount) : NaN;
    if (!Number.isFinite(amt)) return '—';
    const cur = (f.fare_currency || 'USD').toUpperCase();
    return `${amt.toFixed(2)} ${cur}`;
  }

  function validateTripDates() {
    if (tripType === 'RETURN' && new Date(returnDate) <= new Date(departureDate)) {
      setSearchError('Return date must be after departure date.');
      return false;
    }
    return true;
  }

  const manualFarePerPassenger =
    Number(outboundFareAmount || 0) + (tripType === 'RETURN' ? Number(inboundFareAmount || 0) : 0);
  const farePerPassenger = pricingPreview ? pricingPreview.totalPerPax : manualFarePerPassenger;
  const estimatedTotalFare = farePerPassenger * passengerCount;

  async function handleSearchFlights(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchError('');
    setIsSearching(true);
    setHasSearched(false);
    setOutboundFlights([]);
    setInboundFlights([]);
    setSelectedOutboundFlightId('');
    setSelectedInboundFlightId('');

    if (from.trim().toUpperCase() === to.trim().toUpperCase()) {
      setSearchError('Origin and destination must be different.');
      setIsSearching(false);
      return;
    }
    if (!validateTripDates()) {
      setIsSearching(false);
      return;
    }

    try {
      const token = getToken();
      if (!token) {
        setSearchError('Please login first from /login to get a token.');
        return;
      }

      const query = new URLSearchParams({
        from,
        to,
        date: departureDate,
        tripType,
        ...(tripType === 'RETURN' ? { returnDate } : {}),
        ...(fareClassId ? { fareClassId } : {})
      }).toString();
      const response = await fetch(`${API_BASE_URL}/api/booking/flights/search?${query}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const result = (await response.json()) as SearchResponse & { message?: string };
      if (!response.ok) {
        setSearchError(result.message || 'Flight search failed.');
        return;
      }
      setOutboundFlights(result.outboundFlights || []);
      setInboundFlights(result.inboundFlights || []);
      setHasSearched(true);
    } catch {
      setSearchError('Unable to connect to booking service.');
    } finally {
      setIsSearching(false);
    }
  }

  async function handleCreateBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBookingError('');
    setDocMessage('');
    setBookingSuccess(null);
    setTicketInfo(null);

    if (!selectedOutboundFlightId) {
      setBookingError('Select an outbound flight before creating booking.');
      return;
    }
    if (tripType === 'RETURN' && !selectedInboundFlightId) {
      setBookingError('Select an inbound flight for return trip booking.');
      return;
    }
    if (from.trim().toUpperCase() === to.trim().toUpperCase()) {
      setBookingError('Origin and destination must be different.');
      return;
    }
    if (tripType === 'RETURN' && new Date(returnDate) <= new Date(departureDate)) {
      setBookingError('Return date must be after departure date.');
      return;
    }
    if (passengerCount < 1) {
      setBookingError('Passenger count must be at least 1.');
      return;
    }
    if (!passengerFullName.trim()) {
      setBookingError('Passenger full name is required.');
      return;
    }
    if (!passengerGender) {
      setBookingError('Passenger gender is required.');
      return;
    }
    if (!passengerDob) {
      setBookingError('Passenger date of birth is required.');
      return;
    }
    if (!passengerNationality.trim()) {
      setBookingError('Passenger nationality is required.');
      return;
    }
    if (!passengerPassportNo.trim()) {
      setBookingError('Passenger passport number is required.');
      return;
    }
    if (!passengerPassportExpiry) {
      setBookingError('Passenger passport expiry is required.');
      return;
    }
    if (!passengerPhone.trim()) {
      setBookingError('Passenger phone number is required.');
      return;
    }
    if (!passengerEmail.trim()) {
      setBookingError('Passenger email is required.');
      return;
    }
    if (!passengerEmergencyContact.trim()) {
      setBookingError('Passenger emergency contact is required.');
      return;
    }
    if (fareClassId && (!pricingPreview || pricingError)) {
      setBookingError(
        'Master-data pricing is not ready for this flight and fare class. Fix route fares or clear the fare class to use manual amounts.'
      );
      return;
    }

    setIsBooking(true);
    try {
      const token = getToken();
      if (!token) {
        setBookingError('Please login first from /login to get a token.');
        return;
      }

      const useMasterPricing = Boolean(fareClassId && pricingPreview && !pricingError);
      const response = await fetch(`${API_BASE_URL}/api/booking`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          tripType,
          outboundFlightId: selectedOutboundFlightId,
          inboundFlightId: tripType === 'RETURN' ? selectedInboundFlightId : undefined,
          departureDate,
          returnDate: tripType === 'RETURN' ? returnDate : undefined,
          ...(useMasterPricing
            ? {
                fareClassId,
                currency: pricingPreview?.currency || 'USD',
                pricedTotalPerPax: pricingPreview?.totalPerPax,
                pricedCurrency: pricingPreview?.currency
              }
            : {
                outboundFareAmount: Number(outboundFareAmount),
                inboundFareAmount: tripType === 'RETURN' ? Number(inboundFareAmount) : undefined,
                currency: 'USD'
              }),
          paymentType: 'CARD',
          collectPayment,
          notes: bookingNotes.trim() || undefined,
          passengers: [
            {
              fullName: passengerFullName,
              gender: passengerGender,
              dateOfBirth: passengerDob,
              nationality: passengerNationality,
              passportNo: passengerPassportNo,
              passportExpiry: passengerPassportExpiry,
              phone: passengerPhone,
              email: passengerEmail,
              emergencyContact: passengerEmergencyContact,
              passengerType: 'ADT'
            }
          ].concat(
            Array.from({ length: Math.max(0, passengerCount - 1) }, (_, i) => ({
              fullName: `${passengerFullName} ${i + 2}`,
              gender: passengerGender,
              dateOfBirth: passengerDob,
              nationality: passengerNationality,
              passportNo: `${passengerPassportNo}-${i + 2}`,
              passportExpiry: passengerPassportExpiry,
              phone: passengerPhone,
              email: `guest${i + 2}@hawana.aero`,
              emergencyContact: passengerEmergencyContact,
              passengerType: 'ADT'
            }))
          )
        })
      });
      const result = (await response.json()) as BookingResponse & { message?: string };
      if (!response.ok) {
        setBookingError(result.message || 'Booking creation failed.');
        return;
      }

      setBookingSuccess(result);
      if (result.tickets?.length && result.booking?.pnr && result.booking?.id) {
        setTicketInfo({ pnr: result.booking.pnr, bookingId: result.booking.id, tickets: result.tickets });
      }
    } catch {
      setBookingError('Unable to create booking.');
    } finally {
      setIsBooking(false);
    }
  }

  async function handleRecordPayment() {
    if (!bookingSuccess?.booking.id) return;
    const amt = Number(bookingSuccess.booking.total_amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    setBookingError('');
    setIsRecordingPayment(true);
    try {
      const token = getToken();
      if (!token) {
        setBookingError('Please login first from /login to get a token.');
        return;
      }
      const response = await fetch(`${API_BASE_URL}/api/booking/${bookingSuccess.booking.id}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ amount: amt, paymentType: 'CARD', paymentStatus: 'PAID' })
      });
      const data = (await response.json()) as {
        booking?: { payment_status?: string };
        tickets?: TicketResponse['tickets'];
        message?: string;
      };
      if (!response.ok) {
        setBookingError(data.message || 'Payment recording failed.');
        return;
      }
      if (data.booking?.payment_status) {
        setBookingSuccess((prev) =>
          prev
            ? {
                ...prev,
                booking: { ...prev.booking, payment_status: data.booking!.payment_status }
              }
            : prev
        );
      }
      if (data.tickets?.length && bookingSuccess?.booking.pnr && bookingSuccess?.booking.id) {
        setTicketInfo({
          pnr: bookingSuccess.booking.pnr,
          bookingId: bookingSuccess.booking.id,
          tickets: data.tickets as TicketResponse['tickets']
        });
        setBookingSuccess((prev) =>
          prev ? { ...prev, tickets: data.tickets as BookingResponse['tickets'] } : prev
        );
        setIssueTicketModalOpen(false);
      }
    } catch {
      setBookingError('Unable to record payment.');
    } finally {
      setIsRecordingPayment(false);
    }
  }

  const passengerCountForTickets = bookingSuccess?.booking?.fare?.passengerCount ?? 1;
  const mergedTickets = useMemo(() => {
    if (ticketInfo?.tickets?.length) return ticketInfo.tickets;
    return bookingSuccess?.tickets ?? [];
  }, [ticketInfo, bookingSuccess?.tickets]);

  const allTicketsIssued = useMemo(() => {
    if (!bookingSuccess?.booking?.id) return false;
    if (mergedTickets.length < passengerCountForTickets) return false;
    return mergedTickets.every((t) => String(t.ticket_status || 'ISSUED').toUpperCase() === 'ISSUED');
  }, [bookingSuccess?.booking?.id, mergedTickets, passengerCountForTickets]);

  const paidForBooking = String(bookingSuccess?.booking.payment_status || '').toUpperCase() === 'PAID';

  const routeLabelForModal = useMemo(() => {
    if (!bookingSuccess?.booking) return '—';
    const o = bookingSuccess.booking.outboundFlight;
    const leg = `${o.departure_airport}→${o.arrival_airport}`;
    const inc = bookingSuccess.booking.inboundFlight;
    if (!inc) return leg;
    return `${leg} / ${inc.departure_airport}→${inc.arrival_airport}`;
  }, [bookingSuccess]);

  const primaryPassengerLabel =
    passengerCountForTickets > 1
      ? `${passengerFullName.trim()} (+ ${passengerCountForTickets - 1} more passenger(s))`
      : passengerFullName.trim();

  async function issueTicketAfterConfirm() {
    if (!bookingSuccess?.booking.id) return;
    if (!paidForBooking) return;
    setBookingError('');
    setIssueTicketSubmitting(true);
    try {
      const token = getToken();
      if (!token) {
        setBookingError('Please login first from /login to get a token.');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/booking/${bookingSuccess.booking.id}/tickets/issue`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const result = (await response.json()) as TicketResponse & { message?: string };
      if (!response.ok) {
        setBookingError(result.message || 'Ticket issuance failed.');
        return;
      }
      setTicketInfo({
        pnr: result.pnr,
        bookingId: bookingSuccess.booking.id,
        tickets: result.tickets
      });
      setIssueTicketModalOpen(false);
      setDocMessage('');
    } catch {
      setBookingError('Unable to issue ticket.');
    } finally {
      setIssueTicketSubmitting(false);
    }
  }

  return (
    <main style={{ padding: '2rem', display: 'grid', gap: '1rem' }}>
      <h1 style={{ margin: 0, color: '#0d47a1' }}>Flight Booking Module</h1>
      <p style={{ marginTop: 0 }}>Search flights, create booking with PNR, and issue ticket.</p>

      <section style={cardStyle}>
        <h2 style={h2Style}>1) Search Flights</h2>
        <div style={tripTypeWrapStyle}>
          <button
            type="button"
            style={tripType === 'ONE_WAY' ? activeTripButtonStyle : tripButtonStyle}
            onClick={() => setTripType('ONE_WAY')}
          >
            One Way
          </button>
          <button
            type="button"
            style={tripType === 'RETURN' ? activeTripButtonStyle : tripButtonStyle}
            onClick={() => setTripType('RETURN')}
          >
            Return
          </button>
        </div>
        <form onSubmit={handleSearchFlights} style={gridStyle}>
          <input value={from} onChange={(e) => setFrom(e.target.value.toUpperCase())} placeholder="From (IATA)" style={inputStyle} />
          <input value={to} onChange={(e) => setTo(e.target.value.toUpperCase())} placeholder="To (IATA)" style={inputStyle} />
          <input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} style={inputStyle} />
          {tripType === 'RETURN' && (
            <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} style={inputStyle} />
          )}
          <input
            value={passengerCount}
            onChange={(e) => setPassengerCount(Math.max(1, Number(e.target.value) || 1))}
            placeholder="Passengers"
            type="number"
            min="1"
            style={inputStyle}
          />
          {fareClasses.length > 0 && (
            <label style={{ ...inputStyle, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Fare class (for table route fares — re-search after change)</span>
              <select value={fareClassId} onChange={(e) => setFareClassId(e.target.value)} style={{ padding: '0.5rem' }}>
                <option value="">Lowest available (all classes)</option>
                {fareClasses.map((fc) => (
                  <option key={fc.id} value={fc.id}>
                    {fc.code} — {fc.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" style={buttonStyle} disabled={isSearching}>
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </form>
        {searchError && <p style={errorStyle}>{searchError}</p>}
        {fareClasses.length === 0 && (
          <p style={{ marginTop: '0.35rem', fontSize: '0.82rem', color: '#64748b' }}>
            Route fares in the table use master data when loaded; otherwise fare shows &quot;—&quot; (use manual amounts in step 2).
          </p>
        )}

        {hasSearched && (
          <div style={{ marginTop: '1rem' }}>
            <h3 style={h3Style}>
              Outbound flights — {departureDate} ({from} → {to})
            </h3>
            {outboundFlights.length === 0 ? (
              <p style={{ fontSize: '0.9rem', color: '#64748b' }}>No outbound flights found for this route and date.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={flightTableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Flight</th>
                      <th style={thStyle}>Departs</th>
                      <th style={thStyle}>Arrives</th>
                      <th style={thStyle}>Duration</th>
                      <th style={thStyle}>Seats</th>
                      <th style={thStyle}>Fare (base)</th>
                      <th style={thStyle} />
                    </tr>
                  </thead>
                  <tbody>
                    {outboundFlights.map((flight) => {
                      const selected = selectedOutboundFlightId === flight.id;
                      const cell = (content: ReactNode) => (
                        <td style={{ ...tdStyle, background: selected ? '#eff6ff' : '#fff' }}>{content}</td>
                      );
                      return (
                        <tr key={flight.id}>
                          {cell(
                            <>
                              <strong>{flight.flight_number}</strong>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                {flight.departure_airport} → {flight.arrival_airport}
                              </div>
                            </>
                          )}
                          {cell(formatFlightTime(flight.departure_time))}
                          {cell(formatFlightTime(flight.arrival_time))}
                          {cell(formatDurationMinutes(flight.duration_minutes))}
                          {cell(flight.seats_available ?? '—')}
                          {cell(formatLegFare(flight))}
                          {cell(
                            <button
                              type="button"
                              style={selected ? selectFlightBtnActiveStyle : selectFlightBtnStyle}
                              onClick={() => setSelectedOutboundFlightId(flight.id)}
                            >
                              {selected ? 'Selected' : 'Select flight'}
                            </button>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {tripType === 'RETURN' && (
              <div style={{ marginTop: '1.25rem' }}>
                <h3 style={h3Style}>
                  Inbound flights — {returnDate} ({to} → {from})
                </h3>
                {inboundFlights.length === 0 ? (
                  <p style={{ fontSize: '0.9rem', color: '#64748b' }}>No inbound flights found for the return date.</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={flightTableStyle}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Flight</th>
                          <th style={thStyle}>Departs</th>
                          <th style={thStyle}>Arrives</th>
                          <th style={thStyle}>Duration</th>
                          <th style={thStyle}>Seats</th>
                          <th style={thStyle}>Fare (base)</th>
                          <th style={thStyle} />
                        </tr>
                      </thead>
                      <tbody>
                        {inboundFlights.map((flight) => {
                          const selected = selectedInboundFlightId === flight.id;
                          const cell = (content: ReactNode) => (
                            <td style={{ ...tdStyle, background: selected ? '#eff6ff' : '#fff' }}>{content}</td>
                          );
                          return (
                            <tr key={flight.id}>
                              {cell(
                                <>
                                  <strong>{flight.flight_number}</strong>
                                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                    {flight.departure_airport} → {flight.arrival_airport}
                                  </div>
                                </>
                              )}
                              {cell(formatFlightTime(flight.departure_time))}
                              {cell(formatFlightTime(flight.arrival_time))}
                              {cell(formatDurationMinutes(flight.duration_minutes))}
                              {cell(flight.seats_available ?? '—')}
                              {cell(formatLegFare(flight))}
                              {cell(
                                <button
                                  type="button"
                                  style={selected ? selectFlightBtnActiveStyle : selectFlightBtnStyle}
                                  onClick={() => setSelectedInboundFlightId(flight.id)}
                                >
                                  {selected ? 'Selected' : 'Select flight'}
                                </button>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {selectedOutboundFlightId && (
        <section style={cardStyle}>
          <h2 style={h2Style}>Booking summary (before submit)</h2>
          <p style={{ marginTop: 0, fontSize: '0.9rem', color: '#334155' }}>
            <strong>Trip:</strong> {tripType === 'RETURN' ? 'Return' : 'One way'} | <strong>Route:</strong> {from} → {to} |{' '}
            <strong>Depart:</strong> {departureDate}
            {tripType === 'RETURN' && (
              <>
                {' '}
                | <strong>Return:</strong> {returnDate}
              </>
            )}{' '}
            | <strong>Passengers:</strong> {passengerCount}
          </p>
          {(() => {
            const out = outboundFlights.find((f) => f.id === selectedOutboundFlightId);
            const inn = inboundFlights.find((f) => f.id === selectedInboundFlightId);
            return (
              <div style={{ marginTop: '0.65rem', display: 'grid', gap: '0.75rem' }}>
                {out && (
                  <div style={summaryLegStyle}>
                    <strong style={{ color: '#1d4ed8' }}>Outbound</strong>
                    <table style={summaryTableStyle}>
                      <tbody>
                        <tr>
                          <td style={summaryLabelCellStyle}>Flight</td>
                          <td>{out.flight_number}</td>
                        </tr>
                        <tr>
                          <td style={summaryLabelCellStyle}>Route</td>
                          <td>
                            {out.departure_airport} → {out.arrival_airport}
                          </td>
                        </tr>
                        <tr>
                          <td style={summaryLabelCellStyle}>Departure</td>
                          <td>{formatFlightTime(out.departure_time)}</td>
                        </tr>
                        <tr>
                          <td style={summaryLabelCellStyle}>Arrival</td>
                          <td>{formatFlightTime(out.arrival_time)}</td>
                        </tr>
                        <tr>
                          <td style={summaryLabelCellStyle}>Duration</td>
                          <td>{formatDurationMinutes(out.duration_minutes)}</td>
                        </tr>
                        <tr>
                          <td style={summaryLabelCellStyle}>Seats available</td>
                          <td>{out.seats_available ?? '—'}</td>
                        </tr>
                        <tr>
                          <td style={summaryLabelCellStyle}>Route fare (base)</td>
                          <td>{formatLegFare(out)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
                {tripType === 'RETURN' && (
                  <div style={summaryLegStyle}>
                    <strong style={{ color: '#1d4ed8' }}>Inbound</strong>
                    {inn ? (
                      <table style={summaryTableStyle}>
                        <tbody>
                          <tr>
                            <td style={summaryLabelCellStyle}>Flight</td>
                            <td>{inn.flight_number}</td>
                          </tr>
                          <tr>
                            <td style={summaryLabelCellStyle}>Route</td>
                            <td>
                              {inn.departure_airport} → {inn.arrival_airport}
                            </td>
                          </tr>
                          <tr>
                            <td style={summaryLabelCellStyle}>Departure</td>
                            <td>{formatFlightTime(inn.departure_time)}</td>
                          </tr>
                          <tr>
                            <td style={summaryLabelCellStyle}>Arrival</td>
                            <td>{formatFlightTime(inn.arrival_time)}</td>
                          </tr>
                          <tr>
                            <td style={summaryLabelCellStyle}>Duration</td>
                            <td>{formatDurationMinutes(inn.duration_minutes)}</td>
                          </tr>
                          <tr>
                            <td style={summaryLabelCellStyle}>Seats available</td>
                            <td>{inn.seats_available ?? '—'}</td>
                          </tr>
                          <tr>
                            <td style={summaryLabelCellStyle}>Route fare (base)</td>
                            <td>{formatLegFare(inn)}</td>
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.88rem', color: '#92400e' }}>
                        Select an inbound flight from the list above to complete the return itinerary.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          <div style={{ marginTop: '0.65rem', fontSize: '0.88rem', color: '#0f172a' }}>
            <strong>Fare</strong>
            {pricingPreview ? (
              <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
                {pricingPreview.breakdown.map((line) => (
                  <li key={line.code + line.label}>
                    {line.label}: {Number(line.amount).toFixed(2)} {pricingPreview.currency}
                    {line.type ? ` (${line.type})` : ''}
                  </li>
                ))}
                <li>
                  <strong>Total per passenger:</strong> {pricingPreview.totalPerPax.toFixed(2)} {pricingPreview.currency}
                </li>
                <li>
                  <strong>Grand total ({passengerCount} pax):</strong> {(pricingPreview.totalPerPax * passengerCount).toFixed(2)}{' '}
                  {pricingPreview.currency}
                </li>
              </ul>
            ) : (
              <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
                <li>
                  Outbound (per pax): {Number(outboundFareAmount || 0).toFixed(2)} USD (manual base; taxes/fees not split)
                </li>
                {tripType === 'RETURN' && (
                  <li>Inbound (per pax): {Number(inboundFareAmount || 0).toFixed(2)} USD</li>
                )}
                <li>
                  <strong>Total per passenger:</strong> {farePerPassenger.toFixed(2)} USD
                </li>
                <li>
                  <strong>Grand total ({passengerCount} pax):</strong> {estimatedTotalFare.toFixed(2)} USD
                </li>
              </ul>
            )}
          </div>
        </section>
      )}

      <section style={cardStyle}>
        <h2 style={h2Style}>2) Passenger Details & Booking</h2>
        <form onSubmit={handleCreateBooking} style={gridStyle}>
          <input value={passengerFullName} onChange={(e) => setPassengerFullName(e.target.value)} placeholder="Full Name" style={inputStyle} />
          <select value={passengerGender} onChange={(e) => setPassengerGender(e.target.value)} style={inputStyle}>
            <option value="">Gender</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
          </select>
          <input value={passengerDob} onChange={(e) => setPassengerDob(e.target.value)} placeholder="Date of Birth" type="date" style={inputStyle} />
          <input value={passengerNationality} onChange={(e) => setPassengerNationality(e.target.value)} placeholder="Nationality" style={inputStyle} />
          <input value={passengerPassportNo} onChange={(e) => setPassengerPassportNo(e.target.value)} placeholder="Passport Number" style={inputStyle} />
          <input
            value={passengerPassportExpiry}
            onChange={(e) => setPassengerPassportExpiry(e.target.value)}
            placeholder="Passport Expiry"
            type="date"
            style={inputStyle}
          />
          <input value={passengerPhone} onChange={(e) => setPassengerPhone(e.target.value)} placeholder="Phone Number" style={inputStyle} />
          <input value={passengerEmail} onChange={(e) => setPassengerEmail(e.target.value)} placeholder="Passenger email" style={inputStyle} />
          <input
            value={passengerEmergencyContact}
            onChange={(e) => setPassengerEmergencyContact(e.target.value)}
            placeholder="Emergency Contact"
            style={inputStyle}
          />
          {fareClasses.length > 0 && (
            <p style={{ gridColumn: '1 / -1', fontSize: '0.82rem', color: '#64748b', margin: 0 }}>
              Fare class for master pricing is chosen in step 1. Totals here use full itinerary pricing (base + taxes/fees) when a fare class is selected.
            </p>
          )}
          {(!fareClassId || pricingError || !pricingPreview) && (
            <>
              <input value={outboundFareAmount} onChange={(e) => setOutboundFareAmount(e.target.value)} placeholder="Outbound fare amount" type="number" min="1" style={inputStyle} />
              {tripType === 'RETURN' && (
                <input value={inboundFareAmount} onChange={(e) => setInboundFareAmount(e.target.value)} placeholder="Inbound fare amount" type="number" min="1" style={inputStyle} />
              )}
            </>
          )}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', gridColumn: '1 / -1', fontSize: '0.88rem' }}>
            <input type="checkbox" checked={collectPayment} onChange={(e) => setCollectPayment(e.target.checked)} />
            Collect payment now (uncheck to create an unpaid booking for pay-later workflow)
          </label>
          <input
            value={bookingNotes}
            onChange={(e) => setBookingNotes(e.target.value)}
            placeholder="Booking notes (optional)"
            style={{ ...inputStyle, gridColumn: '1 / -1' }}
          />
          {pricingError && <p style={{ ...errorStyle, gridColumn: '1 / -1' }}>{pricingError}</p>}
          {pricingPreview && (
            <div style={{ gridColumn: '1 / -1', fontSize: '0.85rem', color: '#0f172a', background: '#f8fafc', padding: '0.65rem', borderRadius: 8 }}>
              <strong>Master pricing</strong> ({pricingPreview.currency}, cabin {pricingPreview.bookingClass}): total{' '}
              <strong>{pricingPreview.totalPerPax.toFixed(2)}</strong> per passenger including taxes/fees.
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: 'pointer' }}>Breakdown</summary>
                <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
                  {pricingPreview.breakdown.map((line) => (
                    <li key={line.code + line.label}>
                      {line.label}: {Number(line.amount).toFixed(2)}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
          <button type="submit" style={buttonStyle} disabled={isBooking}>
            {isBooking ? 'Creating booking...' : 'Create Booking'}
          </button>
        </form>
        <p style={{ marginTop: '0.5rem' }}>
          Estimated fare: <strong>
            {farePerPassenger.toFixed(2)} {pricingPreview?.currency || 'USD'} per passenger
          </strong>{' '}
          | <strong>{estimatedTotalFare.toFixed(2)} {pricingPreview?.currency || 'USD'} total</strong>
        </p>
        {bookingError && <p style={errorStyle}>{bookingError}</p>}

        {bookingSuccess && (
          <div style={successBoxStyle}>
            <p style={{ margin: 0 }}>
              Booking created. <strong>PNR: {bookingSuccess.booking.pnr}</strong>
            </p>
            <p style={{ margin: '0.35rem 0 0' }}>
              Trip type: <strong>{bookingSuccess.booking.trip_type === 'RETURN' ? 'Return' : 'One Way'}</strong>
            </p>
            <p style={{ margin: '0.35rem 0 0' }}>
              Outbound: {bookingSuccess.booking.outboundFlight.flight_number} |{' '}
              {bookingSuccess.booking.outboundFlight.departure_airport} → {bookingSuccess.booking.outboundFlight.arrival_airport}
            </p>
            {bookingSuccess.booking.inboundFlight && (
              <p style={{ margin: '0.35rem 0 0' }}>
                Inbound: {bookingSuccess.booking.inboundFlight.flight_number} |{' '}
                {bookingSuccess.booking.inboundFlight.departure_airport} → {bookingSuccess.booking.inboundFlight.arrival_airport}
              </p>
            )}
            <p style={{ margin: '0.35rem 0 0' }}>
              Total: {bookingSuccess.booking.total_amount} {bookingSuccess.booking.currency}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: '0.65rem' }}>
              <button
                type="button"
                className="secondary"
                disabled={Boolean(docAction)}
                style={{ ...buttonStyle, background: '#334155', width: 'auto', fontSize: '0.82rem' }}
                onClick={() => {
                  setBookingError('');
                  setDocAction('inv');
                  void downloadBookingInvoicePdf(bookingSuccess.booking.id, bookingSuccess.booking.pnr)
                    .catch((e: Error) => setBookingError(e.message))
                    .finally(() => setDocAction(null));
                }}
              >
                {docAction === 'inv' ? 'Preparing…' : 'Booking invoice (PDF)'}
              </button>
            </div>
            <p style={{ margin: '0.35rem 0 0' }}>
              Payment status:{' '}
              <strong>{String(bookingSuccess.booking.payment_status || 'UNKNOWN').toUpperCase()}</strong>
            </p>
            {String(bookingSuccess.booking.payment_status || '').toUpperCase() !== 'PAID' && (
              <button
                type="button"
                onClick={handleRecordPayment}
                disabled={isRecordingPayment}
                style={{ ...buttonStyle, marginTop: '0.75rem', width: 'auto', background: '#047857' }}
              >
                {isRecordingPayment ? 'Recording…' : `Record full payment (${bookingSuccess.booking.total_amount})`}
              </button>
            )}
            {allTicketsIssued ? (
              <p style={{ marginTop: '0.75rem', fontWeight: 700, color: '#047857' }}>Ticket Issued</p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setBookingError('');
                    setIssueTicketModalOpen(true);
                  }}
                  disabled={issueTicketSubmitting}
                  style={{
                    ...buttonStyle,
                    marginTop: '0.75rem',
                    width: 'auto'
                  }}
                >
                  Issue Ticket
                </button>
                {!paidForBooking ? (
                  <p style={{ ...errorStyle, margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                    Payment must be completed before ticket issuance. Use Record full payment above, then confirm in the
                    dialog.
                  </p>
                ) : null}
              </>
            )}
          </div>
        )}
      </section>

      <ConfirmModal
        open={issueTicketModalOpen && Boolean(bookingSuccess?.booking.id)}
        title="Confirm Ticket Issuance"
        message="Are you sure you want to issue this ticket? Once issued, this ticket number will be generated and the booking status will change to ISSUED."
        confirmText="Confirm Issue Ticket"
        confirmDisabled={!paidForBooking || issueTicketSubmitting}
        warning={
          !paidForBooking ? 'Payment must be completed before ticket issuance.' : undefined
        }
        onCancel={() => {
          if (!issueTicketSubmitting) setIssueTicketModalOpen(false);
        }}
        onConfirm={() => void issueTicketAfterConfirm()}
      >
        {bookingSuccess?.booking ? (
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              gap: '0.35rem 1rem',
              fontSize: '0.88rem',
              margin: 0
            }}
          >
            <dt style={{ color: '#64748b' }}>PNR</dt>
            <dd style={{ margin: 0 }}>{bookingSuccess.booking.pnr}</dd>
            <dt style={{ color: '#64748b' }}>Passenger name</dt>
            <dd style={{ margin: 0 }}>{primaryPassengerLabel || '—'}</dd>
            <dt style={{ color: '#64748b' }}>Route</dt>
            <dd style={{ margin: 0 }}>{routeLabelForModal}</dd>
            <dt style={{ color: '#64748b' }}>Trip type</dt>
            <dd style={{ margin: 0 }}>{bookingSuccess.booking.trip_type === 'RETURN' ? 'Return' : 'One way'}</dd>
            <dt style={{ color: '#64748b' }}>Total fare</dt>
            <dd style={{ margin: 0 }}>
              {bookingSuccess.booking.total_amount} {bookingSuccess.booking.currency}
            </dd>
            <dt style={{ color: '#64748b' }}>Payment status</dt>
            <dd style={{ margin: 0 }}>{String(bookingSuccess.booking.payment_status || '—').toUpperCase()}</dd>
          </dl>
        ) : null}
      </ConfirmModal>

      {ticketInfo?.bookingId && (
        <section style={cardStyle}>
          <h2 style={h2Style}>3) Ticket issuance &amp; documents</h2>
          {docMessage ? (
            <p style={{ marginTop: 0, color: '#047857', fontWeight: 600 }}>{docMessage}</p>
          ) : null}
          <p style={{ marginTop: docMessage ? '0.35rem' : 0 }}>
            PNR <strong>{ticketInfo.pnr}</strong> · Branded e-ticket PDF includes QR, fare/tax lines, itinerary, and seat when
            checked in.
          </p>
          {ticketInfo.tickets.map((ticket) => {
            const bid = ticketInfo.bookingId;
            const loadingPrint = docAction === `pr:${ticket.id}`;
            const loadingDl = docAction === `dl:${ticket.id}`;
            const loadingEm = docAction === `em:${ticket.id}`;
            return (
              <div key={ticket.id} style={{ ...ticketRowStyle, paddingTop: '0.75rem' }}>
                <div>
                  Ticket <strong>{ticket.ticket_number}</strong>
                  {ticket.ticket_status ? ` · ${ticket.ticket_status}` : ''}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={Boolean(docAction)}
                    style={{ ...buttonStyle, width: 'auto', fontSize: '0.82rem', padding: '0.45rem 0.65rem' }}
                    onClick={() => {
                      setBookingError('');
                      setDocAction(`pr:${ticket.id}`);
                      void printTicketPdf(bid, ticket.id).catch((e: Error) => setBookingError(e.message)).finally(() => setDocAction(null));
                    }}
                  >
                    {loadingPrint ? 'Opening…' : 'Print ticket'}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(docAction)}
                    style={{ ...buttonStyle, width: 'auto', fontSize: '0.82rem', padding: '0.45rem 0.65rem', background: '#0f766e' }}
                    onClick={() => {
                      setBookingError('');
                      setDocAction(`dl:${ticket.id}`);
                      void downloadTicketPdf(bid, ticket.id, ticket.ticket_number)
                        .catch((e: Error) => setBookingError(e.message))
                        .finally(() => setDocAction(null));
                    }}
                  >
                    {loadingDl ? 'Downloading…' : 'Download PDF'}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(docAction)}
                    style={{ ...buttonStyle, width: 'auto', fontSize: '0.82rem', padding: '0.45rem 0.65rem', background: '#6d28d9' }}
                    onClick={() => {
                      setBookingError('');
                      setDocAction(`em:${ticket.id}`);
                      void emailTicketPdf(bid, ticket.id)
                        .then(() => {
                          setBookingError('');
                          setDocMessage('E-ticket emailed to the passenger address on file.');
                        })
                        .catch((e: Error & { code?: string }) => {
                          setDocMessage('');
                          setBookingError(
                            e.code === 'SMTP_NOT_CONFIGURED'
                              ? 'Email not configured on server (SMTP_HOST, SMTP_FROM).'
                              : e.message
                          );
                        })
                        .finally(() => setDocAction(null));
                    }}
                  >
                    {loadingEm ? 'Sending…' : 'Email ticket'}
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}

const cardStyle: CSSProperties = {
  background: '#ffffff',
  borderRadius: 12,
  padding: '1rem',
  boxShadow: '0 8px 30px rgba(13, 71, 161, 0.1)'
};

const h2Style: CSSProperties = {
  marginTop: 0,
  color: '#0d47a1'
};

const h3Style: CSSProperties = {
  marginTop: 0,
  marginBottom: '0.35rem',
  color: '#1d4ed8'
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '0.6rem'
};

const tripTypeWrapStyle: CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  marginBottom: '0.75rem'
};

const tripButtonStyle: CSSProperties = {
  border: '1px solid #93c5fd',
  borderRadius: 8,
  padding: '0.45rem 0.7rem',
  fontWeight: 700,
  background: '#ffffff',
  color: '#1d4ed8',
  cursor: 'pointer'
};

const activeTripButtonStyle: CSSProperties = {
  ...tripButtonStyle,
  background: '#1d4ed8',
  color: '#ffffff',
  borderColor: '#1d4ed8'
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '0.65rem',
  borderRadius: 8,
  border: '1px solid #bfdbfe'
};

const buttonStyle: CSSProperties = {
  border: 'none',
  borderRadius: 8,
  padding: '0.65rem 0.9rem',
  fontWeight: 700,
  background: '#0d47a1',
  color: '#fff',
  cursor: 'pointer'
};

const errorStyle: CSSProperties = {
  color: '#b91c1c'
};

const successBoxStyle: CSSProperties = {
  marginTop: '0.75rem',
  background: '#eff6ff',
  padding: '0.75rem',
  borderRadius: 10
};

const flightTableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.88rem',
  background: '#f8fafc',
  borderRadius: 8,
  overflow: 'hidden'
};

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '0.55rem 0.65rem',
  background: '#e2e8f0',
  color: '#0f172a',
  fontWeight: 700,
  borderBottom: '1px solid #cbd5e1'
};

const tdStyle: CSSProperties = {
  padding: '0.55rem 0.65rem',
  borderBottom: '1px solid #e2e8f0',
  verticalAlign: 'middle',
  background: '#fff'
};

const selectFlightBtnStyle: CSSProperties = {
  ...buttonStyle,
  padding: '0.45rem 0.65rem',
  fontSize: '0.8rem',
  whiteSpace: 'nowrap'
};

const selectFlightBtnActiveStyle: CSSProperties = {
  ...selectFlightBtnStyle,
  background: '#1d4ed8',
  cursor: 'default'
};

const summaryLegStyle: CSSProperties = {
  padding: '0.65rem',
  background: '#f1f5f9',
  borderRadius: 8,
  border: '1px solid #e2e8f0'
};

const summaryTableStyle: CSSProperties = {
  width: '100%',
  marginTop: '0.35rem',
  fontSize: '0.86rem',
  borderCollapse: 'collapse'
};

const summaryLabelCellStyle: CSSProperties = {
  color: '#64748b',
  padding: '0.2rem 0.75rem 0.2rem 0',
  whiteSpace: 'nowrap',
  verticalAlign: 'top'
};

const ticketRowStyle: CSSProperties = {
  padding: '0.45rem 0',
  borderTop: '1px solid #e5e7eb'
};
