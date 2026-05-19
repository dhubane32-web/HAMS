'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { apiFetchJson } from '@/lib/api-client';
import {
  addBookingOsi,
  addBookingSsr,
  createMultiCityBooking,
  fetchCommercialHealth,
  fetchCommercialNotifications,
  fetchFlightInventory,
  fetchPassengerProfile,
  fetchSsrOsi,
  fetchTicketCoupons,
  modifyBookingCommercial,
  reissueTicket,
  refundTicketCommercial,
  searchPassengerProfiles,
  sendBookingNotifications,
  type CommercialNotification,
  type PassengerProfile
} from '@/lib/commercial-api';

type Tab = 'multi' | 'pnr' | 'crm' | 'notify';

export default function CommercialHubPage() {
  const [tab, setTab] = useState<Tab>('multi');
  const [health, setHealth] = useState<string>('…');
  const [loading, setLoading] = useState(false);

  const [leg1, setLeg1] = useState('');
  const [leg2, setLeg2] = useState('');
  const [paxJson, setPaxJson] = useState(
    '[{"fullName":"Demo Passenger","gender":"M","dateOfBirth":"1990-01-01","email":"pax@example.com","phone":"+252600000001"}]'
  );
  const [multiResult, setMultiResult] = useState<string>('');

  const [pnr, setPnr] = useState('');
  const [bookingId, setBookingId] = useState('');
  const [ssrCode, setSsrCode] = useState('WCHR');
  const [osiLine, setOsiLine] = useState('CTCM +252600000001');
  const [pnrDetail, setPnrDetail] = useState<string>('');

  const [profileQ, setProfileQ] = useState('');
  const [profiles, setProfiles] = useState<PassengerProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');

  const [notifications, setNotifications] = useState<CommercialNotification[]>([]);

  useEffect(() => {
    fetchCommercialHealth()
      .then((h) => setHealth(`${h.module} · phase ${h.phase}`))
      .catch(() => setHealth('offline — apply migration 006'));
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const r = await fetchCommercialNotifications();
      setNotifications(r.notifications);
    } catch {
      setNotifications([]);
    }
  }, []);

  useEffect(() => {
    if (tab === 'notify') loadNotifications();
  }, [tab, loadNotifications]);

  async function onMultiCity(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    if (!leg1 || !leg2) {
      toast.error('Select two flight IDs for multi-city demo');
      return;
    }
    let passengers: unknown[];
    try {
      passengers = JSON.parse(paxJson);
    } catch {
      toast.error('Invalid passengers JSON');
      return;
    }
    try {
      for (const id of [leg1, leg2]) {
        const inv = await fetchFlightInventory(id);
        if (!inv.inventory.openForSale) {
          toast.error(`No inventory on ${inv.inventory.flightNumber}`);
          return;
        }
      }
      const out = await createMultiCityBooking({
        legs: [{ flightId: leg1 }, { flightId: leg2 }],
        passengers,
        collectPayment: true,
        paymentType: 'CARD',
        ssr: [{ code: 'DOCS', text: 'API/PP/' }],
        osi: ['HAMS PHASE2 COMMERCIAL']
      });
      setMultiResult(JSON.stringify(out, null, 2));
      setBookingId(String((out.booking as { id?: string }).id || ''));
      toast.success(`PNR ${(out.booking as { pnr?: string }).pnr} created`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Multi-city booking failed');
    } finally {
      setLoading(false);
    }
  }

  async function loadPnr() {
    setLoading(true);
    if (!pnr.trim()) return;
    try {
      const data = await apiFetchJson<{
        booking: { id: string; pnr: string };
        ssr?: unknown[];
        osi?: unknown[];
        tickets?: unknown[];
      }>(`/api/booking/pnr/${encodeURIComponent(pnr.trim())}`);
      setBookingId(data.booking.id);
      let extra = '';
      if (bookingId || data.booking.id) {
        try {
          const coupons = await fetchTicketCoupons(data.booking.id);
          extra += `\nCoupons: ${JSON.stringify(coupons.coupons, null, 2)}`;
        } catch {
          /* optional */
        }
      }
      setPnrDetail(JSON.stringify(data, null, 2) + extra);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'PNR not found');
    } finally {
      setLoading(false);
    }
  }

  async function onAddSsr() {
    if (!bookingId) {
      toast.error('Load a PNR first');
      return;
    }
    try {
      await addBookingSsr(bookingId, { ssrCode, ssrText: 'Added from commercial hub' });
      const s = await fetchSsrOsi(bookingId);
      setPnrDetail((prev) => `${prev}\n\nSSR/OSI:\n${JSON.stringify(s, null, 2)}`);
      toast.success('SSR added');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'SSR failed');
    }
  }

  async function onAddOsi() {
    if (!bookingId) return;
    try {
      await addBookingOsi(bookingId, osiLine);
      toast.success('OSI added');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'OSI failed');
    }
  }

  async function onModify() {
    if (!bookingId) return;
    try {
      await modifyBookingCommercial(bookingId, { notes: `Modified ${new Date().toISOString()}` });
      toast.success('Booking updated');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Modify failed');
    }
  }

  async function onReissue() {
    const ticketId = prompt('Ticket UUID to reissue');
    if (!ticketId) return;
    try {
      const out = await reissueTicket(ticketId);
      toast.success(`Reissued → ${(out as { newTicket?: { ticket_number?: string } }).newTicket?.ticket_number}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Reissue failed');
    }
  }

  async function onRefund() {
    const ticketId = prompt('Ticket UUID to refund');
    if (!ticketId) return;
    try {
      await refundTicketCommercial(ticketId, { reason: 'Commercial desk refund' });
      toast.success('Ticket refunded');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Refund failed');
    }
  }

  async function onSearchProfiles() {
    try {
      const r = await searchPassengerProfiles(profileQ);
      setProfiles(r.profiles);
    } catch {
      setProfiles([]);
    }
  }

  async function onLoadProfile() {
    if (!selectedProfile) return;
    try {
      const r = await fetchPassengerProfile(selectedProfile);
      setPnrDetail(JSON.stringify(r, null, 2));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Profile load failed');
    }
  }

  async function onNotifyBooking() {
    if (!bookingId) {
      toast.error('Set booking ID from PNR load');
      return;
    }
    try {
      const out = await sendBookingNotifications(bookingId, ['EMAIL']);
      toast.success(`Notifications queued (${(out as { queued?: number }).queued ?? 0})`);
      loadNotifications();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Notify failed');
    }
  }

  return (
    <main className="module-page commercial-hub">
      <section className="module-card">
        <div className="commercial-hub__head">
          <div>
            <h1 style={{ margin: 0 }}>Commercial Core · Phase 2</h1>
            <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
              Booking, PNR, e-tickets, CRM & notifications — connected to PostgreSQL & OCC.
            </p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>{health}</p>
          </div>
          <div className="commercial-hub__links">
            <Link href="/booking" className="btn-secondary">
              Booking desk
            </Link>
            <Link href="/checkin" className="btn-secondary">
              Check-in
            </Link>
            <Link href="/customer-service" className="btn-secondary">
              Customer service
            </Link>
          </div>
        </div>

        <div className="commercial-tabs" role="tablist">
          {(
            [
              ['multi', 'Multi-city'],
              ['pnr', 'PNR & tickets'],
              ['crm', 'CRM profiles'],
              ['notify', 'Notifications']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'commercial-tab active' : 'commercial-tab'}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {tab === 'multi' && (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>Multi-city booking</h2>
          <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
            Enter flight UUIDs from Operations schedule. Inventory is checked before create.
          </p>
          <form onSubmit={onMultiCity} className="module-form-grid">
            <label>
              Leg 1 flight ID
              <input value={leg1} onChange={(e) => setLeg1(e.target.value)} placeholder="UUID" required />
            </label>
            <label>
              Leg 2 flight ID
              <input value={leg2} onChange={(e) => setLeg2(e.target.value)} placeholder="UUID" required />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Passengers (JSON)
              <textarea value={paxJson} onChange={(e) => setPaxJson(e.target.value)} rows={4} />
            </label>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Working…' : 'Create multi-city PNR'}
            </button>
          </form>
          {multiResult ? (
            <pre className="commercial-pre" style={{ marginTop: '1rem' }}>
              {multiResult}
            </pre>
          ) : null}
        </section>
      )}

      {tab === 'pnr' && (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>PNR · SSR/OSI · modify · reissue · refund</h2>
          <div className="module-form-grid" style={{ gridTemplateColumns: '1fr auto' }}>
            <label>
              PNR
              <input value={pnr} onChange={(e) => setPnr(e.target.value.toUpperCase())} placeholder="HW3K9P" />
            </label>
            <button type="button" className="btn-primary" onClick={loadPnr} disabled={loading}>
              {loading ? 'Loading…' : 'Retrieve'}
            </button>
          </div>
          <div className="module-form-grid" style={{ marginTop: '1rem' }}>
            <label>
              SSR code
              <input value={ssrCode} onChange={(e) => setSsrCode(e.target.value.toUpperCase())} />
            </label>
            <label>
              OSI line
              <input value={osiLine} onChange={(e) => setOsiLine(e.target.value)} />
            </label>
            <button type="button" className="btn-secondary" onClick={onAddSsr}>
              Add SSR
            </button>
            <button type="button" className="btn-secondary" onClick={onAddOsi}>
              Add OSI
            </button>
            <button type="button" className="btn-secondary" onClick={onModify}>
              Modify notes
            </button>
            <button type="button" className="btn-secondary" onClick={onReissue}>
              Reissue ticket
            </button>
            <button type="button" className="btn-secondary" onClick={onRefund}>
              Refund ticket
            </button>
            <button type="button" className="btn-secondary" onClick={onNotifyBooking}>
              Send confirmation
            </button>
          </div>
          {pnrDetail ? (
            <pre className="commercial-pre" style={{ marginTop: '1rem' }}>
              {pnrDetail}
            </pre>
          ) : null}
        </section>
      )}

      {tab === 'crm' && (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>Passenger profiles & travel history</h2>
          <div className="module-form-grid" style={{ gridTemplateColumns: '1fr auto' }}>
            <label>
              Search email / phone / ref
              <input value={profileQ} onChange={(e) => setProfileQ(e.target.value)} />
            </label>
            <button type="button" className="btn-primary" onClick={onSearchProfiles}>
              Search
            </button>
          </div>
          {profiles.length > 0 && (
            <label style={{ display: 'block', marginTop: '1rem' }}>
              Profile
              <select value={selectedProfile} onChange={(e) => setSelectedProfile(e.target.value)}>
                <option value="">—</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.profile_ref} · {p.primary_email || p.primary_phone || '—'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="btn-secondary" style={{ marginTop: '0.75rem' }} onClick={onLoadProfile}>
            Load profile + history
          </button>
        </section>
      )}

      {tab === 'notify' && (
        <section className="module-card">
          <h2 style={{ marginTop: 0 }}>Notification outbox</h2>
          <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
            Email uses SMTP; WhatsApp uses <code>HAMS_WHATSAPP_WEBHOOK_URL</code>. Delay alerts fire from OCC
            delay recording.
          </p>
          <button type="button" className="btn-secondary" onClick={loadNotifications}>
            Refresh
          </button>
          <div className="commercial-notify-list">
            {notifications.length === 0 ? (
              <p style={{ color: '#94a3b8' }}>No notifications yet.</p>
            ) : (
              <table className="module-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Channel</th>
                    <th>Template</th>
                    <th>Recipient</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {notifications.map((n) => (
                    <tr key={n.id}>
                      <td>{new Date(n.created_at).toLocaleString()}</td>
                      <td>{n.channel}</td>
                      <td>{n.template_code}</td>
                      <td>{n.recipient}</td>
                      <td>{n.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      <style jsx>{`
        .commercial-hub__head {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 1rem;
          align-items: flex-start;
        }
        .commercial-hub__links {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .commercial-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-top: 1.25rem;
        }
        .commercial-tab {
          padding: 0.45rem 0.9rem;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #fff;
          font-size: 0.88rem;
          cursor: pointer;
        }
        .commercial-tab.active {
          background: #0f172a;
          color: #fff;
          border-color: #0f172a;
        }
        .commercial-pre {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 1rem;
          overflow: auto;
          font-size: 0.78rem;
          max-height: 420px;
        }
        .commercial-notify-list {
          margin-top: 1rem;
          overflow-x: auto;
        }
        @media (max-width: 640px) {
          .commercial-tabs {
            overflow-x: auto;
            flex-wrap: nowrap;
          }
        }
      `}</style>
    </main>
  );
}
