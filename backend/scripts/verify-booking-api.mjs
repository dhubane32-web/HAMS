#!/usr/bin/env node
/**
 * Verifies booking list + search. Requires a running HAMS backend + DB.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:5000 node backend/scripts/verify-booking-api.mjs
 *
 * Skip login (use an existing JWT from the app):
 *   BASE_URL=... TOKEN=eyJ... node backend/scripts/verify-booking-api.mjs
 */
const base = (process.env.BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const email = process.env.EMAIL || 'admin@hams.aero';
const password = process.env.PASSWORD || 'Admin123!';

async function main() {
  const healthRes = await fetch(`${base}/api/health`).catch((e) => {
    console.error('Cannot reach backend:', e.message);
    console.error('Start the API (e.g. npm run dev in backend) and set BASE_URL if not on', base);
    process.exit(1);
  });
  const healthBody = await healthRes.json().catch(() => ({}));
  if (!healthRes.ok || healthBody.service !== 'hams-backend') {
    console.error(
      'HAMS backend not detected on',
      base,
      '(GET /api/health expected { service: "hams-backend" }).',
      'Got:',
      healthRes.status,
      healthBody
    );
    process.exit(1);
  }

  let token = process.env.TOKEN?.trim();
  if (!token) {
    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const loginBody = await loginRes.json().catch(() => ({}));
    if (!loginRes.ok) {
      console.error('Login failed:', loginRes.status, loginBody);
      console.error('Use super_admin credentials (default admin@hams.aero) or TOKEN=... from a browser session.');
      process.exit(1);
    }
    token = loginBody.token;
  }
  const auth = { Authorization: `Bearer ${token}` };

  const listRes = await fetch(`${base}/api/booking`, { headers: auth });
  const listBody = await listRes.json().catch(() => ({}));
  if (!listRes.ok || !Array.isArray(listBody.bookings)) {
    console.error('FAIL GET /api/booking', listRes.status, listBody);
    process.exit(1);
  }
  console.log('OK GET /api/booking', listBody.bookings.length, 'rows');

  const listBookingsRes = await fetch(`${base}/api/bookings`, { headers: auth });
  const listBookingsBody = await listBookingsRes.json().catch(() => ({}));
  if (!listBookingsRes.ok || !Array.isArray(listBookingsBody.bookings)) {
    console.error('FAIL GET /api/bookings', listBookingsRes.status, listBookingsBody);
    process.exit(1);
  }
  console.log('OK GET /api/bookings', listBookingsBody.bookings.length, 'rows');

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const search = new URLSearchParams({
    from: 'DXB',
    to: 'NBO',
    date: tomorrow,
    tripType: 'ONE_WAY'
  });
  const searchRes = await fetch(`${base}/api/booking/flights/search?${search}`, { headers: auth });
  const searchBody = await searchRes.json().catch(() => ({}));
  if (!searchRes.ok || !Array.isArray(searchBody.outboundFlights)) {
    console.error('FAIL GET /api/booking/flights/search', searchRes.status, searchBody);
    process.exit(1);
  }
  console.log('OK GET /api/booking/flights/search (one-way)', searchBody.outboundFlights.length, 'outbound');

  const ret = new URLSearchParams({
    from: 'DXB',
    to: 'NBO',
    date: tomorrow,
    tripType: 'RETURN',
    returnDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  });
  const retRes = await fetch(`${base}/api/booking/flights/search?${ret}`, { headers: auth });
  const retBody = await retRes.json().catch(() => ({}));
  if (!retRes.ok || !Array.isArray(retBody.inboundFlights)) {
    console.error('FAIL GET /api/booking/flights/search (return)', retRes.status, retBody);
    process.exit(1);
  }
  console.log('OK GET /api/booking/flights/search (return)', {
    outbound: retBody.outboundFlights.length,
    inbound: retBody.inboundFlights.length
  });

  const first = listBody.bookings[0];
  if (first?.id) {
    const det = await fetch(`${base}/api/booking/${first.id}`, { headers: auth });
    const detBody = await det.json().catch(() => ({}));
    if (!det.ok || !detBody.booking) {
      console.error('FAIL GET /api/booking/:id', det.status, detBody);
      process.exit(1);
    }
    console.log('OK GET /api/booking/:id', detBody.booking.pnr);
  } else {
    console.log('SKIP detail (no bookings — run db:fix)');
  }

  const catRes = await fetch(`${base}/api/master-data/catalog/booking`, { headers: auth });
  const catBody = await catRes.json().catch(() => ({}));
  if (!catRes.ok || !Array.isArray(catBody.fareClasses)) {
    console.error('FAIL GET /api/master-data/catalog/booking', catRes.status, catBody);
    process.exit(1);
  }
  const econFc = catBody.fareClasses.find((x) => x.code === 'ECON');
  if (!econFc?.id) {
    console.error('FAIL catalog: no ECON fare class (run db:fix / master_data_seed)');
    process.exit(1);
  }
  console.log('OK GET /api/master-data/catalog/booking', catBody.fareClasses.length, 'fare classes');

  const searchRes2 = await fetch(`${base}/api/booking/flights/search?${search}`, { headers: auth });
  const searchBody2 = await searchRes2.json().catch(() => ({}));
  const outId = searchBody2.outboundFlights?.[0]?.id;
  if (!outId) {
    console.error('SKIP create booking (no outbound flight for pricing E2E)');
  } else {
    const prev = new URLSearchParams({
      outboundFlightId: outId,
      fareClassId: econFc.id,
      tripType: 'ONE_WAY'
    });
    const priceRes = await fetch(`${base}/api/master-data/pricing-preview?${prev}`, { headers: auth });
    const priceBody = await priceRes.json().catch(() => ({}));
    if (!priceRes.ok || typeof priceBody.totalPerPax !== 'number') {
      console.error('FAIL GET /api/master-data/pricing-preview', priceRes.status, priceBody);
      process.exit(1);
    }
    console.log('OK GET /api/master-data/pricing-preview totalPerPax=', priceBody.totalPerPax, priceBody.currency);

    const createRes = await fetch(`${base}/api/booking`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tripType: 'ONE_WAY',
        outboundFlightId: outId,
        passengers: [
          {
            fullName: 'Verify Api Pax',
            gender: 'MALE',
            dateOfBirth: '1990-01-15',
            nationality: 'Kenyan',
            passportNo: 'PV999001',
            passportExpiry: '2032-01-01',
            phone: '+254700000001',
            email: 'verify-api@hawana.aero',
            emergencyContact: '+254711111112',
            passengerType: 'ADT'
          }
        ],
        fareClassId: econFc.id,
        currency: priceBody.currency || 'USD',
        pricedTotalPerPax: priceBody.totalPerPax,
        pricedCurrency: priceBody.currency,
        paymentType: 'CARD',
        collectPayment: true,
        departureDate: tomorrow
      })
    });
    const createBody = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createBody.booking?.pnr) {
      console.error('FAIL POST /api/booking (E2E)', createRes.status, createBody);
      process.exit(1);
    }
    if (!Array.isArray(createBody.tickets) || createBody.tickets.length < 1) {
      console.error('FAIL POST /api/booking: expected auto-issued tickets', createBody);
      process.exit(1);
    }
    console.log('OK POST /api/booking E2E PNR', createBody.booking.pnr, 'tickets', createBody.tickets.length);
  }

  console.log('All booking API checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
