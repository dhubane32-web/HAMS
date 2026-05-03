#!/usr/bin/env node
/**
 * Smoke-test check-in & boarding APIs. Requires running HAMS backend + DB with seed (e.g. BKTOW1, HW101).
 *
 *   BASE_URL=http://127.0.0.1:5013 node backend/scripts/verify-checkin-api.mjs
 *   TOKEN=eyJ... BASE_URL=... node backend/scripts/verify-checkin-api.mjs
 */
const base = (process.env.BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const email = process.env.EMAIL || 'admin@hams.aero';
const password = process.env.PASSWORD || 'Admin123!';

async function main() {
  const healthRes = await fetch(`${base}/api/health`).catch((e) => {
    console.error('Cannot reach backend:', e.message);
    process.exit(1);
  });
  const healthBody = await healthRes.json().catch(() => ({}));
  if (!healthRes.ok || healthBody.service !== 'hams-backend') {
    console.error('HAMS backend not on', base, healthRes.status, healthBody);
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
      process.exit(1);
    }
    token = loginBody.token;
  }
  const auth = { Authorization: `Bearer ${token}` };

  const pnrRes = await fetch(`${base}/api/checkin/pnr/BKTOW1`, { headers: auth });
  const pnrBody = await pnrRes.json().catch(() => ({}));
  if (!pnrRes.ok || !pnrBody.booking) {
    console.error('FAIL GET /api/checkin/pnr/BKTOW1', pnrRes.status, pnrBody);
    process.exit(1);
  }
  console.log('OK GET /api/checkin/pnr/BKTOW1', { eligible: pnrBody.checkInEligible, legs: pnrBody.itinerary?.length });

  const searchPnrRes = await fetch(`${base}/api/checkin/search?q=BKTOW1&type=pnr`, { headers: auth });
  const searchPnrBody = await searchPnrRes.json().catch(() => ({}));
  if (!searchPnrRes.ok || searchPnrBody.matchType !== 'PNR' || !searchPnrBody.booking) {
    console.error('FAIL GET /api/checkin/search (pnr)', searchPnrRes.status, searchPnrBody);
    process.exit(1);
  }
  console.log('OK GET /api/checkin/search type=pnr', searchPnrBody.booking.pnr);

  const lookupBad = await fetch(
    `${base}/api/checkin/lookup?pnr=BKTOW1&lastName=${encodeURIComponent('WrongName')}`,
    { headers: auth }
  );
  if (lookupBad.status !== 404) {
    console.error('FAIL GET /api/checkin/lookup wrong last name', lookupBad.status);
    process.exit(1);
  }
  console.log('OK GET /api/checkin/lookup wrong last name → 404');

  const lookupOk = await fetch(
    `${base}/api/checkin/lookup?pnr=BKTOW1&lastName=${encodeURIComponent('Passenger')}`,
    { headers: auth }
  );
  const lookupBody = await lookupOk.json().catch(() => ({}));
  if (!lookupOk.ok || !lookupBody.booking || lookupBody.matchType !== 'PNR_LASTNAME') {
    console.error('FAIL GET /api/checkin/lookup (Passenger)', lookupOk.status, lookupBody);
    process.exit(1);
  }
  console.log('OK GET /api/checkin/lookup PNR+last name', lookupBody.booking.pnr);

  const ticketNo = pnrBody.passengers?.[0]?.legs?.[0]?.ticket_number;
  if (ticketNo) {
    const tRes = await fetch(`${base}/api/checkin/ticket/${encodeURIComponent(ticketNo)}`, { headers: auth });
    const tBody = await tRes.json().catch(() => ({}));
    if (!tRes.ok || !tBody.booking) {
      console.error('FAIL GET /api/checkin/ticket/:ticketNumber', tRes.status, tBody);
      process.exit(1);
    }
    console.log('OK GET /api/checkin/ticket/', ticketNo, { lookup: tBody.lookup?.source });
  } else {
    console.log('SKIP ticket lookup (no ticket on first passenger leg — seed flights/tickets)');
  }

  const flightId = pnrBody.itinerary?.[0]?.id;
  if (!flightId) {
    console.error('FAIL no flight id on itinerary');
    process.exit(1);
  }
  const seatRes = await fetch(`${base}/api/checkin/flights/${flightId}/seats`, { headers: auth });
  const seatBody = await seatRes.json().catch(() => ({}));
  if (!seatRes.ok || !Array.isArray(seatBody.seats)) {
    console.error('FAIL GET .../seats', seatRes.status, seatBody);
    process.exit(1);
  }
  console.log('OK GET seat map', seatBody.layoutSource, seatBody.seats.length, 'cells');

  const manRes = await fetch(`${base}/api/checkin/flights/${flightId}/manifest`, { headers: auth });
  const manBody = await manRes.json().catch(() => ({}));
  if (!manRes.ok || manBody.summary == null) {
    console.error('FAIL GET manifest', manRes.status, manBody);
    process.exit(1);
  }
  const s = manBody.summary;
  for (const k of ['pendingCount', 'boardingCount', 'totalBaggageKg', 'totalBaggagePieces']) {
    if (s[k] === undefined) {
      console.error('FAIL manifest summary missing', k, s);
      process.exit(1);
    }
  }
  if (!Array.isArray(manBody.lists?.boarding)) {
    console.error('FAIL manifest lists.boarding missing', manBody.lists);
    process.exit(1);
  }
  console.log('OK GET manifest summary', {
    pending: s.pendingCount,
    boarding: s.boardingCount,
    baggageKg: s.totalBaggageKg
  });

  const recRes = await fetch(`${base}/api/checkin/flights/${flightId}/reconciliation`, { headers: auth });
  const recBody = await recRes.json().catch(() => ({}));
  if (!recRes.ok || !recBody.reconciliation || recBody.reconciliation.expected_pax == null) {
    console.error('FAIL GET reconciliation', recRes.status, recBody);
    process.exit(1);
  }
  console.log('OK GET reconciliation', {
    expected: recBody.reconciliation.expected_pax,
    checked_in: recBody.reconciliation.checked_in_total
  });

  const firstChecked = pnrBody.passengers?.flatMap((p) => p.legs.map((l) => ({ p, l }))).find(({ l }) => l.checkin_id);
  if (firstChecked?.l?.boarding_pass_no) {
    const bpRes = await fetch(
      `${base}/api/checkin/boarding-pass/${encodeURIComponent(firstChecked.l.boarding_pass_no)}`,
      { headers: auth }
    );
    const bpBody = await bpRes.json().catch(() => ({}));
    if (!bpRes.ok || !bpBody.boardingPass?.pnr) {
      console.error('FAIL GET boarding-pass', bpRes.status, bpBody);
      process.exit(1);
    }
    console.log('OK GET boarding-pass', bpBody.boardingPass.pnr, bpBody.boardingPass.seat);

    const pdfRes = await fetch(
      `${base}/api/checkin/documents/boarding-pass-pdf?ref=${encodeURIComponent(firstChecked.l.boarding_pass_no)}`,
      { headers: auth }
    );
    const pdfCt = pdfRes.headers.get('content-type') || '';
    if (!pdfRes.ok || !pdfCt.includes('application/pdf')) {
      const t = await pdfRes.text().catch(() => '');
      console.error('FAIL GET boarding-pass-pdf', pdfRes.status, pdfCt, t.slice(0, 200));
      process.exit(1);
    }
    console.log('OK GET boarding-pass-pdf', 'bytes', (await pdfRes.arrayBuffer()).byteLength);

    const scanRes = await fetch(`${base}/api/boarding/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ scan: firstChecked.l.boarding_pass_no, strictGate: false })
    });
    const scanBody = await scanRes.json().catch(() => ({}));
    if (!scanRes.ok || !scanBody.boardingPass) {
      console.error('FAIL POST /api/boarding/scan', scanRes.status, scanBody);
      process.exit(1);
    }
    console.log('OK POST /api/boarding/scan', scanBody.boardingPass.boarding_status);
  } else {
    console.log('SKIP boarding-pass (no existing check-in — complete check-in in UI first)');
  }

  const wideFrom = '2020-01-01';
  const wideTo = '2099-12-31';
  const repRes = await fetch(
    `${base}/api/reports-analytics/reports/checkins?from=${wideFrom}&to=${wideTo}`,
    { headers: auth }
  );
  const repBody = await repRes.json().catch(() => ({}));
  if (!repRes.ok || !Array.isArray(repBody.checkins)) {
    console.error('FAIL GET /api/reports-analytics/reports/checkins', repRes.status, repBody);
    process.exit(1);
  }
  const sample = repBody.checkins[0];
  if (
    sample &&
    (sample.boarding_status === undefined || sample.checkin_status === undefined)
  ) {
    console.error('FAIL check-ins report missing boarding_status / checkin_status columns in row', sample);
    process.exit(1);
  }
  console.log('OK GET reports/checkins', repBody.checkins.length, 'rows');

  const dashRes = await fetch(`${base}/api/dashboard/summary`, { headers: auth });
  const dashBody = await dashRes.json().catch(() => ({}));
  if (!dashRes.ok || typeof dashBody !== 'object') {
    console.error('FAIL GET /api/dashboard/summary', dashRes.status, dashBody);
    process.exit(1);
  }
  console.log('OK GET dashboard/summary');

  console.log('Check-in API smoke tests passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
