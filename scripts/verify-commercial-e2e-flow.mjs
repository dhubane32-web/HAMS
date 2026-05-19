#!/usr/bin/env node
/**
 * End-to-end commercial + OCC flow validation (10 steps).
 * Usage:
 *   BASE_URL=https://hams.hawanaairways.com \
 *   EMAIL=admin@hawanaairways.com PASSWORD='…' \
 *   node scripts/verify-commercial-e2e-flow.mjs
 */
const base = (process.env.BASE_URL || 'http://127.0.0.1:5013').replace(/\/$/, '');
const email = process.env.EMAIL || 'admin@hawanaairways.com';
const password = process.env.PASSWORD || 'Admin123!';
const today = new Date().toISOString().slice(0, 10);

const steps = [];
let fail = 0;

function ok(n, msg) {
  steps.push({ n, ok: true, msg });
  console.log(`OK  ${n}. ${msg}`);
}
function bad(n, msg) {
  steps.push({ n, ok: false, msg });
  console.error(`FAIL ${n}. ${msg}`);
  fail = 1;
}

async function login() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Login ${res.status}: ${body.message || ''}`);
  return { Authorization: `Bearer ${body.token}`, 'Content-Type': 'application/json' };
}

async function main() {
  console.log('=== Commercial E2E flow ===');
  console.log('BASE_URL', base);

  const health = await fetch(`${base}/api/commercial/health`);
  const h = await health.json().catch(() => ({}));
  if (health.ok && h.module === 'commercial-core') ok(0, 'Commercial module health');
  else bad(0, `Commercial health ${health.status}`);

  let auth;
  try {
    auth = await login();
    ok(1, 'Authenticated');
  } catch (e) {
    bad(1, e.message);
    process.exit(1);
  }

  // 2–3 PNR retrieve + tickets (seed HW9K2M)
  const pnrRes = await fetch(`${base}/api/booking/pnr/HW9K2M`, { headers: auth });
  const pnrBody = await pnrRes.json().catch(() => ({}));
  if (!pnrRes.ok || !pnrBody.booking) {
    bad(2, 'PNR HW9K2M not found — run commercial seed');
  } else {
    ok(2, `PNR HW9K2M (${pnrBody.booking.trip_type})`);
    const tickets = pnrBody.tickets || [];
    if (tickets.some((t) => String(t.ticket_status).toUpperCase() === 'ISSUED')) {
      ok(3, `E-ticket issued (${tickets[0]?.ticket_number})`);
    } else {
      bad(3, 'No issued ticket on HW9K2M');
    }
  }

  const bookingId = pnrBody.booking?.id;
  const ticketId = pnrBody.tickets?.[0]?.id;

  // 4 Invoice PDF
  if (bookingId) {
    const inv = await fetch(`${base}/api/booking/${bookingId}/documents/invoice.pdf`, { headers: auth });
    if (inv.ok && inv.headers.get('content-type')?.includes('pdf')) ok(4, 'Invoice PDF');
    else bad(4, `Invoice PDF ${inv.status}`);
  } else bad(4, 'No booking id');

  // 5 Check-in lookup
  const lookup = await fetch(
    `${base}/api/checkin/lookup?pnr=HW9K2M&lastName=Hassan`,
    { headers: auth }
  );
  const lookupBody = await lookup.json().catch(() => ({}));
  if (lookup.ok && (lookupBody.passengers?.length || lookupBody.booking)) {
    ok(5, 'Check-in PNR lookup');
  } else {
    bad(5, `Check-in lookup ${lookup.status}`);
  }

  // 6 Boarding pass PDF
  const bp = await fetch(
    `${base}/api/checkin/documents/boarding-pass-pdf?ref=HWBP9K2M301`,
    { headers: auth }
  );
  if (bp.ok && bp.headers.get('content-type')?.includes('pdf')) ok(6, 'Boarding pass PDF');
  else bad(6, `Boarding pass ${bp.status} (seed HWBP9K2M301)`);

  // 7 Manifest
  const flightId = pnrBody.flights?.[0]?.id;
  if (flightId) {
    const man = await fetch(`${base}/api/checkin/flights/${flightId}/manifest`, { headers: auth });
    const manBody = await man.json().catch(() => ({}));
    if (man.ok && (manBody.passengers || manBody.manifest)) ok(7, 'Passenger manifest');
    else bad(7, `Manifest ${man.status}`);
  } else bad(7, 'No flight on PNR');

  // 8 OCC dashboard
  const occ = await fetch(`${base}/api/operations/occ/dashboard?date=${today}`, { headers: auth });
  const occBody = await occ.json().catch(() => ({}));
  if (occ.ok && Array.isArray(occBody.flights)) {
    ok(8, `OCC dashboard (${occBody.flights.length} flights)`);
    if (occBody.enterprise) ok(8.1, 'OCC enterprise pulse linked');
  } else {
    bad(8, `OCC dashboard ${occ.status}`);
  }

  // 9 Enterprise feed
  const feed = await fetch(`${base}/api/operations/enterprise/feed?date=${today}`, { headers: auth });
  if (feed.ok) ok(9, 'Enterprise ops feed');
  else if (feed.status === 404) bad(9, 'Enterprise API not deployed');
  else bad(9, `Enterprise feed ${feed.status}`);

  // 10 E-ticket PDF
  if (bookingId && ticketId) {
    const et = await fetch(`${base}/api/booking/${bookingId}/documents/tickets/${ticketId}.pdf`, {
      headers: auth
    });
    if (et.ok && et.headers.get('content-type')?.includes('pdf')) ok(10, 'E-ticket PDF');
    else bad(10, `E-ticket PDF ${et.status}`);
  } else bad(10, 'Missing ticket for PDF');

  // Commercial extras
  if (bookingId) {
    const ssr = await fetch(`${base}/api/commercial/bookings/${bookingId}/ssr-osi`, { headers: auth });
    if (ssr.ok) ok(11, 'SSR/OSI on PNR');
    const coupons = await fetch(`${base}/api/commercial/bookings/${bookingId}/coupons`, { headers: auth });
    if (coupons.ok) ok(12, 'Ticket coupons API');
  }

  console.log('\n' + (fail ? 'E2E flow had failures.' : 'E2E commercial + OCC flow passed.'));
  process.exit(fail);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
