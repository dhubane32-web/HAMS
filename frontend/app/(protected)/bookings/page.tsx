'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { SkeletonBlock } from '@/components/ui/StateBlocks';
import { getPublicApiBaseUrl } from '@/lib/api-base';
import {
  downloadBookingInvoicePdf,
  downloadPaymentReceiptPdf,
  downloadTicketPdf,
  emailTicketPdf,
  printTicketPdf
} from '@/lib/booking-documents';

const API_BASE_URL = getPublicApiBaseUrl();

type BookingListRow = {
  id: string;
  pnr: string;
  trip_type: string;
  booking_status: string;
  payment_status: string;
  total_amount: string;
  currency: string;
  created_at: string;
  return_date?: string | null;
  fare_breakdown?: Record<string, unknown> | null;
  fare_base_total?: string | null;
  fare_tax_total?: string | null;
  fare_fee_total?: string | null;
  primary_passenger_name: string | null;
  route_summary: string | null;
  ticket_numbers_summary?: string | null;
};

type FlightLeg = {
  id: string;
  flight_number: string;
  departure_airport: string;
  arrival_airport: string;
  departure_time: string;
  arrival_time: string;
  leg_type: string;
  fare_amount: string;
};

type DetailPassenger = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  passenger_type: string;
};

type DetailTicket = {
  id: string;
  ticket_number: string;
  passenger_id: string;
  issued_at: string;
  ticket_status: string;
};

type DetailPayment = {
  id: string;
  payment_type: string;
  amount: string;
  currency: string;
  payment_status: string;
  transaction_ref: string | null;
  processed_at: string;
};

type BookingDetail = {
  booking: {
    id: string;
    pnr: string;
    trip_type: string;
    booking_status: string;
    payment_status: string;
    total_amount: string;
    currency: string;
    created_at: string;
    notes: string | null;
    return_date?: string | null;
    fare_breakdown?: Record<string, unknown> | null;
    fare_base_total?: string | null;
    fare_tax_total?: string | null;
    fare_fee_total?: string | null;
  };
  flights: FlightLeg[];
  passengers: DetailPassenger[];
  tickets: DetailTicket[];
  payments: DetailPayment[];
};

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('hams_token') : null;
}

function paymentDisplayLabel(status: string) {
  const u = String(status || '').toUpperCase();
  const map: Record<string, string> = {
    UNPAID: 'Pending',
    PARTIALLY_PAID: 'Partially paid',
    PAID: 'Paid',
    PENDING: 'Payment pending',
    FAILED: 'Payment failed',
    REFUNDED: 'Refunded'
  };
  return map[u] || status;
}

export default function BookingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openBookingIdFromQuery = searchParams.get('open');
  const openedBookingFromQueryRef = useRef<string | null>(null);

  const [rows, setRows] = useState<BookingListRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [confirmTicketId, setConfirmTicketId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [payBookingId, setPayBookingId] = useState<string | null>(null);
  const [docBusy, setDocBusy] = useState<string | null>(null);
  const [issueTicketSubmitting, setIssueTicketSubmitting] = useState(false);

  const fetchList = useCallback(async () => {
    setLoadError('');
    setIsLoading(true);
    try {
      const token = getToken();
      if (!token) {
        setLoadError('Please login from /login.');
        setRows([]);
        return;
      }
      const res = await fetch(`${API_BASE_URL}/api/booking`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (await res.json()) as { bookings?: BookingListRow[]; message?: string };
      if (!res.ok) {
        setLoadError(data.message || 'Failed to load bookings.');
        return;
      }
      setRows(data.bookings || []);
    } catch {
      setLoadError('Unable to reach API.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const openDetail = useCallback(async (bookingId: string) => {
    setDetail(null);
    setDetailLoading(true);
    setNotesDraft('');
    try {
      const token = getToken();
      if (!token) {
        toast.error('Please login first.');
        return;
      }
      const res = await fetch(`${API_BASE_URL}/api/booking/${bookingId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (await res.json()) as BookingDetail & { message?: string };
      if (!res.ok) {
        toast.error(data.message || 'Failed to load booking.');
        return;
      }
      setDetail(data);
      setNotesDraft(data.booking.notes || '');
    } catch {
      toast.error('Failed to load booking.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!openBookingIdFromQuery) {
      openedBookingFromQueryRef.current = null;
      return;
    }
    if (isLoading || rows.length === 0) return;
    if (openedBookingFromQueryRef.current === openBookingIdFromQuery) return;
    const row = rows.find((r) => r.id === openBookingIdFromQuery);
    if (!row) {
      toast.error('Booking not found in the current list.');
      openedBookingFromQueryRef.current = openBookingIdFromQuery;
      router.replace('/bookings', { scroll: false });
      return;
    }
    openedBookingFromQueryRef.current = openBookingIdFromQuery;
    void openDetail(openBookingIdFromQuery);
    router.replace('/bookings', { scroll: false });
  }, [openBookingIdFromQuery, isLoading, rows, router, openDetail]);

  async function saveNotes() {
    if (!detail) return;
    const token = getToken();
    if (!token) return;
    const res = await fetch(`${API_BASE_URL}/api/booking/${detail.booking.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ notes: notesDraft })
    });
    const data = (await res.json()) as { booking?: { notes?: string | null }; message?: string };
    if (!res.ok) {
      toast.error(data.message || 'Update failed.');
      return;
    }
    toast.success('Booking updated.');
    setDetail((prev) =>
      prev && data.booking
        ? { ...prev, booking: { ...prev.booking, notes: data.booking.notes ?? prev.booking.notes } }
        : prev
    );
    void fetchList();
  }

  async function issueTickets(bookingId: string) {
    const token = getToken();
    if (!token) return;
    setIssueTicketSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/booking/${bookingId}/tickets/issue`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (await res.json()) as { message?: string; tickets?: DetailTicket[] };
      if (!res.ok) {
        toast.error(data.message || 'Ticket issue failed.');
        return;
      }
      toast.success(`Issued ${data.tickets?.length ?? 0} ticket(s).`);
      setConfirmTicketId(null);
      if (detail?.booking.id === bookingId) void openDetail(bookingId);
      void fetchList();
    } finally {
      setIssueTicketSubmitting(false);
    }
  }

  async function cancelBooking(bookingId: string) {
    const token = getToken();
    if (!token) return;
    const res = await fetch(`${API_BASE_URL}/api/booking/${bookingId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(data.message || 'Cancel failed.');
      return;
    }
    toast.success('Booking cancelled.');
    setConfirmCancelId(null);
    setDetail(null);
    void fetchList();
  }

  async function recordFullPayment(bookingId: string, amount: string) {
    const token = getToken();
    if (!token) return;
    const res = await fetch(`${API_BASE_URL}/api/booking/${bookingId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: Number(amount), paymentType: 'CARD', paymentStatus: 'PAID' })
    });
    const data = (await res.json()) as { message?: string; booking?: { payment_status?: string } };
    if (!res.ok) {
      toast.error(data.message || 'Payment failed.');
      return;
    }
    toast.success(`Payment recorded (${data.booking?.payment_status || 'OK'}).`);
    setPayBookingId(null);
    if (detail?.booking.id === bookingId) void openDetail(bookingId);
    void fetchList();
  }

  const payTarget = rows.find((r) => r.id === payBookingId);

  const issueModalDetail = confirmTicketId && detail?.booking.id === confirmTicketId ? detail : null;
  const issueModalRow = confirmTicketId ? rows.find((r) => r.id === confirmTicketId) : null;
  const issueModalPaid = String(
    issueModalDetail?.booking.payment_status ?? issueModalRow?.payment_status ?? ''
  ).toUpperCase() === 'PAID';
  const issueModalCancelled = String(
    issueModalDetail?.booking.booking_status ?? issueModalRow?.booking_status ?? ''
  ).toUpperCase() === 'CANCELLED';
  const issueModalPnr = issueModalDetail?.booking.pnr ?? issueModalRow?.pnr ?? '—';
  const issueModalPassengerNames = issueModalDetail
    ? issueModalDetail.passengers.map((p) => `${p.first_name} ${p.last_name}`).join(', ')
    : issueModalRow?.primary_passenger_name || '—';
  const issueModalRoute = issueModalDetail
    ? issueModalDetail.flights.map((f) => `${f.departure_airport}→${f.arrival_airport}`).join(' · ')
    : issueModalRow?.route_summary || '—';
  const issueModalTrip =
    issueModalDetail?.booking.trip_type === 'RETURN' || issueModalRow?.trip_type === 'RETURN' ? 'Return' : 'One way';
  const issueModalTotal =
    issueModalDetail != null
      ? `${issueModalDetail.booking.total_amount} ${issueModalDetail.booking.currency}`
      : issueModalRow != null
        ? `${issueModalRow.total_amount} ${issueModalRow.currency}`
        : '—';
  const issueModalPayment = String(
    issueModalDetail?.booking.payment_status ?? issueModalRow?.payment_status ?? '—'
  ).toUpperCase();
  const issueDetailFullyIssued =
    issueModalDetail != null &&
    issueModalDetail.tickets.length > 0 &&
    issueModalDetail.tickets.length >= issueModalDetail.passengers.length &&
    issueModalDetail.tickets.every((t) => String(t.ticket_status || '').toUpperCase() === 'ISSUED');

  return (
    <main className="module-page">
      <section className="module-card">
        <h1>Bookings &amp; Ticketing</h1>
        <p style={{ marginTop: 0, color: '#64748b', maxWidth: '52rem' }}>
          Live list from the API. Trip type and payment status come from the database. Use{' '}
          <Link href="/booking">Flight booking</Link> to search, price, and create bookings.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void fetchList()}>
            Refresh
          </button>
          <Link href="/booking" className="secondary" style={{ padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid #cbd5e1' }}>
            New booking
          </Link>
          <Link
            href="/booking#retrieve"
            className="secondary"
            style={{ padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid #cbd5e1' }}
          >
            Retrieve ticket
          </Link>
        </div>
      </section>

      <section className="module-card">
        <h2>Bookings table</h2>
        {loadError && <p style={{ color: '#b91c1c' }}>{loadError}</p>}
        {isLoading ? (
          <SkeletonBlock rows={5} />
        ) : (
          <div className="hams-table-wrap">
            <table className="module-table">
              <thead>
                <tr>
                  <th>PNR</th>
                  <th>Passenger</th>
                  <th>Route</th>
                  <th>Trip</th>
                  <th>Return</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Tickets</th>
                  <th>Total</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ padding: '1rem', color: '#64748b' }}>
                      No bookings yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const paid = String(row.payment_status || '').toUpperCase() === 'PAID';
                    const cancelled = String(row.booking_status || '').toUpperCase() === 'CANCELLED';
                    return (
                      <tr key={row.id}>
                        <td>{row.pnr}</td>
                        <td>{row.primary_passenger_name || '—'}</td>
                        <td>{row.route_summary || '—'}</td>
                        <td>{row.trip_type === 'RETURN' ? 'Return' : 'One way'}</td>
                        <td style={{ fontSize: '0.85rem', color: '#64748b' }}>
                          {row.trip_type === 'RETURN' && row.return_date ? row.return_date : '—'}
                        </td>
                        <td>
                          <span className={`badge ${String(row.booking_status).toLowerCase()}`}>{row.booking_status}</span>
                        </td>
                        <td>
                          <span className={`badge ${String(row.payment_status).toLowerCase()}`}>
                            {paymentDisplayLabel(row.payment_status)}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8rem', maxWidth: '8rem' }} title={row.ticket_numbers_summary || ''}>
                          {row.ticket_numbers_summary || '—'}
                        </td>
                        <td>
                          {row.total_amount} {row.currency}
                        </td>
                        <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                          <button type="button" className="secondary" onClick={() => void openDetail(row.id)}>
                            View
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={
                              cancelled ||
                              Boolean(row.ticket_numbers_summary?.trim()) ||
                              issueTicketSubmitting
                            }
                            title={
                              cancelled
                                ? 'Cancelled'
                                : row.ticket_numbers_summary?.trim()
                                  ? 'Ticket already issued'
                                  : !paid
                                    ? 'Open to confirm — payment required before issuance'
                                    : ''
                            }
                            onClick={() => setConfirmTicketId(row.id)}
                          >
                            Issue ticket
                          </button>
                          {!paid && !cancelled && (
                            <button type="button" className="secondary" onClick={() => setPayBookingId(row.id)}>
                              Pay
                            </button>
                          )}
                          {!cancelled && (
                            <button type="button" className="secondary" onClick={() => setConfirmCancelId(row.id)}>
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(detail || detailLoading) && (
        <section className="module-card">
          <h2>Booking detail</h2>
          {detailLoading && <SkeletonBlock rows={3} />}
          {detail && !detailLoading && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  className="secondary"
                  disabled={Boolean(docBusy)}
                  onClick={() => {
                    setDocBusy('inv');
                    void downloadBookingInvoicePdf(detail.booking.id, detail.booking.pnr)
                      .catch((e: Error) => toast.error(e.message))
                      .finally(() => setDocBusy(null));
                  }}
                >
                  {docBusy === 'inv' ? 'Preparing invoice…' : 'Booking invoice (PDF)'}
                </button>
                {String(detail.booking.booking_status).toUpperCase() !== 'CANCELLED' &&
                  !(detail.tickets.length >= detail.passengers.length &&
                    detail.tickets.every((t) => String(t.ticket_status || '').toUpperCase() === 'ISSUED')) && (
                    <button
                      type="button"
                      disabled={issueTicketSubmitting}
                      onClick={() => setConfirmTicketId(detail.booking.id)}
                    >
                      Issue ticket
                    </button>
                  )}
                {detail.tickets.length > 0 &&
                  detail.tickets.length >= detail.passengers.length &&
                  detail.tickets.every((t) => String(t.ticket_status || '').toUpperCase() === 'ISSUED') && (
                    <span style={{ fontWeight: 700, color: '#047857', alignSelf: 'center' }}>Ticket Issued</span>
                  )}
              </div>
              <div>
                <strong>PNR:</strong> {detail.booking.pnr} | <strong>Trip:</strong>{' '}
                {detail.booking.trip_type === 'RETURN' ? 'Return' : 'One way'}
                {detail.booking.return_date ? (
                  <>
                    {' '}
                    | <strong>Return date:</strong> {detail.booking.return_date}
                  </>
                ) : null}{' '}
                | <strong>Payment:</strong> {paymentDisplayLabel(detail.booking.payment_status)} | <strong>Total:</strong>{' '}
                {detail.booking.total_amount} {detail.booking.currency}
              </div>
              {detail.booking.fare_breakdown && typeof detail.booking.fare_breakdown === 'object' ? (
                <div>
                  <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>Fare breakdown (stored)</h3>
                  <pre
                    style={{
                      margin: 0,
                      fontSize: '0.78rem',
                      background: '#f8fafc',
                      padding: '0.5rem',
                      borderRadius: 6,
                      overflow: 'auto',
                      maxHeight: '12rem'
                    }}
                  >
                    {JSON.stringify(detail.booking.fare_breakdown, null, 2)}
                  </pre>
                  {(detail.booking.fare_base_total != null ||
                    detail.booking.fare_tax_total != null ||
                    detail.booking.fare_fee_total != null) && (
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                      Base {detail.booking.fare_base_total ?? '—'} · Tax {detail.booking.fare_tax_total ?? '—'} · Fees{' '}
                      {detail.booking.fare_fee_total ?? '—'} ({detail.booking.currency})
                    </p>
                  )}
                </div>
              ) : null}
              <div>
                <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>Flights</h3>
                <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                  {detail.flights.map((f) => (
                    <li key={f.id}>
                      <strong>{f.leg_type === 'INBOUND' ? 'Inbound' : 'Outbound'}:</strong> {f.flight_number}{' '}
                      {f.departure_airport}→{f.arrival_airport} — {new Date(f.departure_time).toLocaleString()}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>Passengers</h3>
                <table className="module-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Phone</th>
                      <th>Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.passengers.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.first_name} {p.last_name}
                        </td>
                        <td>{p.passenger_type}</td>
                        <td>{p.phone || '—'}</td>
                        <td>{p.email || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>Tickets</h3>
                {detail.tickets.length === 0 ? (
                  <p style={{ margin: 0, color: '#64748b' }}>No tickets issued yet.</p>
                ) : (
                  <table className="module-table">
                    <thead>
                      <tr>
                        <th>Ticket #</th>
                        <th>Passenger</th>
                        <th>Status</th>
                        <th>Issued</th>
                        <th>Documents</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.tickets.map((t) => {
                        const pax = detail.passengers.find((p) => p.id === t.passenger_id);
                        const paxName = pax ? `${pax.first_name} ${pax.last_name}` : t.passenger_id.slice(0, 8) + '…';
                        const bkey = (k: string) => `${k}:${t.id}`;
                        return (
                          <tr key={t.id}>
                            <td>{t.ticket_number}</td>
                            <td style={{ fontSize: '0.85rem' }}>{paxName}</td>
                            <td>{t.ticket_status}</td>
                            <td>{new Date(t.issued_at).toLocaleString()}</td>
                            <td style={{ fontSize: '0.78rem' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={Boolean(docBusy)}
                                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
                                  onClick={() => {
                                    setDocBusy(bkey('pr'));
                                    void printTicketPdf(detail.booking.id, t.id)
                                      .catch((e: Error) => toast.error(e.message))
                                      .finally(() => setDocBusy(null));
                                  }}
                                >
                                  {docBusy === bkey('pr') ? '…' : 'Print'}
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={Boolean(docBusy)}
                                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
                                  onClick={() => {
                                    setDocBusy(bkey('dl'));
                                    void downloadTicketPdf(detail.booking.id, t.id, t.ticket_number)
                                      .catch((e: Error) => toast.error(e.message))
                                      .finally(() => setDocBusy(null));
                                  }}
                                >
                                  {docBusy === bkey('dl') ? '…' : 'PDF'}
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={Boolean(docBusy)}
                                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
                                  onClick={() => {
                                    setDocBusy(bkey('em'));
                                    void emailTicketPdf(detail.booking.id, t.id)
                                      .then(() => toast.success('E-ticket sent.'))
                                      .catch((e: Error & { code?: string }) =>
                                        toast.error(
                                          e.code === 'SMTP_NOT_CONFIGURED'
                                            ? 'Configure SMTP on the server to email tickets.'
                                            : e.message || 'Email failed'
                                        )
                                      )
                                      .finally(() => setDocBusy(null));
                                  }}
                                >
                                  {docBusy === bkey('em') ? '…' : 'Email / resend'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>Payments</h3>
                {detail.payments.length === 0 ? (
                  <p style={{ margin: 0, color: '#64748b' }}>No payments recorded.</p>
                ) : (
                  <table className="module-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Ref</th>
                        <th>At</th>
                        <th>Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.payments.map((p) => (
                        <tr key={p.id}>
                          <td>{p.payment_type}</td>
                          <td>
                            {p.amount} {p.currency}
                          </td>
                          <td>{p.payment_status}</td>
                          <td style={{ fontSize: '0.8rem' }}>{p.transaction_ref || '—'}</td>
                          <td>{new Date(p.processed_at).toLocaleString()}</td>
                          <td>
                            <button
                              type="button"
                              className="secondary"
                              disabled={Boolean(docBusy)}
                              style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
                              onClick={() => {
                                setDocBusy(`rc:${p.id}`);
                                void downloadPaymentReceiptPdf(detail.booking.id, p.id, detail.booking.pnr)
                                  .catch((e: Error) => toast.error(e.message))
                                  .finally(() => setDocBusy(null));
                              }}
                            >
                              {docBusy === `rc:${p.id}` ? '…' : 'PDF'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>Modify (notes)</h3>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={3}
                  style={{ width: '100%', maxWidth: '40rem', padding: '0.5rem' }}
                />
                <button type="button" style={{ marginTop: '0.35rem' }} onClick={() => void saveNotes()}>
                  Save notes
                </button>
              </div>
              <button type="button" className="secondary" onClick={() => setDetail(null)}>
                Close detail
              </button>
            </div>
          )}
        </section>
      )}

      <ConfirmModal
        open={Boolean(confirmTicketId)}
        title="Confirm Ticket Issuance"
        message="Are you sure you want to issue this ticket? Once issued, this ticket number will be generated and the booking status will change to ISSUED."
        confirmText="Confirm Issue Ticket"
        confirmDisabled={
          !issueModalPaid ||
          issueTicketSubmitting ||
          issueModalCancelled ||
          issueDetailFullyIssued ||
          (Boolean(issueModalRow?.ticket_numbers_summary?.trim()) && !issueModalDetail)
        }
        warning={
          !issueModalPaid
            ? 'Payment must be completed before ticket issuance.'
            : issueModalCancelled
              ? 'This booking is cancelled; tickets cannot be issued.'
              : undefined
        }
        onCancel={() => {
          if (!issueTicketSubmitting) setConfirmTicketId(null);
        }}
        onConfirm={() => {
          if (confirmTicketId && issueModalPaid && !issueTicketSubmitting) void issueTickets(confirmTicketId);
        }}
      >
        {(issueModalDetail || issueModalRow) && (
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
            <dd style={{ margin: 0 }}>{issueModalPnr}</dd>
            <dt style={{ color: '#64748b' }}>Passenger name</dt>
            <dd style={{ margin: 0 }}>{issueModalPassengerNames}</dd>
            <dt style={{ color: '#64748b' }}>Route</dt>
            <dd style={{ margin: 0 }}>{issueModalRoute}</dd>
            <dt style={{ color: '#64748b' }}>Trip type</dt>
            <dd style={{ margin: 0 }}>{issueModalTrip}</dd>
            <dt style={{ color: '#64748b' }}>Total fare</dt>
            <dd style={{ margin: 0 }}>{issueModalTotal}</dd>
            <dt style={{ color: '#64748b' }}>Payment status</dt>
            <dd style={{ margin: 0 }}>{issueModalPayment}</dd>
          </dl>
        )}
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(confirmCancelId)}
        title="Cancel booking"
        message="Mark this booking as cancelled? This cannot be undone from the UI."
        confirmText="Cancel booking"
        onCancel={() => setConfirmCancelId(null)}
        onConfirm={() => {
          if (confirmCancelId) void cancelBooking(confirmCancelId);
        }}
      />

      <ConfirmModal
        open={Boolean(payBookingId && payTarget)}
        title="Record payment"
        message={
          payTarget
            ? `Record full payment of ${payTarget.total_amount} ${payTarget.currency} for PNR ${payTarget.pnr}?`
            : ''
        }
        confirmText="Record payment"
        onCancel={() => setPayBookingId(null)}
        onConfirm={() => {
          if (payTarget) void recordFullPayment(payTarget.id, payTarget.total_amount);
        }}
      />
    </main>
  );
}
