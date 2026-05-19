#!/usr/bin/env node
/**
 * Phase 2 commercial API smoke test.
 * Usage: BASE_URL=http://127.0.0.1:5013 node backend/scripts/verify-commercial-phase2.mjs
 */
const base = (process.env.BASE_URL || 'http://127.0.0.1:5013').replace(/\/$/, '');
const email = process.env.EMAIL || 'admin@hawanaairways.com';
const password = process.env.PASSWORD || 'Admin123!';

async function login() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return { Authorization: `Bearer ${body.token}`, 'Content-Type': 'application/json' };
}

function fail(msg) {
  console.error('FAIL', msg);
  process.exit(1);
}

async function main() {
  console.log('=== Commercial Phase 2 verification ===');
  console.log('BASE_URL', base);

  const health = await fetch(`${base}/api/commercial/health`);
  const healthBody = await health.json().catch(() => ({}));
  if (!health.ok || healthBody.module !== 'commercial-core') {
    fail(`commercial/health ${health.status} ${JSON.stringify(healthBody)}`);
  }
  console.log('OK commercial health');

  const auth = await login();
  console.log('OK login');

  const today = new Date().toISOString().slice(0, 10);
  const search = await fetch(
    `${base}/api/booking/flights/search?from=DXB&to=NBO&date=${today}&tripType=ONE_WAY`,
    { headers: auth }
  );
  const searchBody = await search.json().catch(() => ({}));
  if (!search.ok || !searchBody.outboundFlights) {
    fail(`flight search ${search.status}`);
  }
  console.log('OK flight search', { flights: searchBody.outboundFlights?.length });

  const notif = await fetch(`${base}/api/commercial/notifications?limit=5`, { headers: auth });
  const notifBody = await notif.json().catch(() => ({}));
  if (notif.status === 503) {
    console.warn('WARN commercial schema — run migration 006');
    process.exit(2);
  }
  if (!notif.ok || !Array.isArray(notifBody.notifications)) {
    fail(`notifications ${notif.status}`);
  }
  console.log('OK notifications', { count: notifBody.notifications.length });

  if (process.env.FLIGHT_ID) {
    const inv = await fetch(`${base}/api/commercial/inventory/${process.env.FLIGHT_ID}`, { headers: auth });
    const invBody = await inv.json().catch(() => ({}));
    if (!inv.ok || !invBody.inventory) fail(`inventory ${inv.status}`);
    console.log('OK inventory', invBody.inventory);
  }

  console.log('\nCommercial phase 2 verification passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
