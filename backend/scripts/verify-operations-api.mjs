#!/usr/bin/env node
/**
 * Verifies Flight & Operations APIs. Usage:
 *   BASE_URL=http://127.0.0.1:5000 node backend/scripts/verify-operations-api.mjs
 */
const base = process.env.BASE_URL || 'http://127.0.0.1:5000';
const email = process.env.EMAIL || 'admin@hams.aero';
const password = process.env.PASSWORD || 'Admin123!';

async function main() {
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
  const token = loginBody.token;
  const auth = { Authorization: `Bearer ${token}` };

  const today = new Date().toISOString().slice(0, 10);

  const dash = await fetch(`${base}/api/operations/dashboard/today`, { headers: auth });
  const dashBody = await dash.json().catch(() => ({}));
  if (!dash.ok || !Array.isArray(dashBody.flights) || typeof dashBody.summaryByStatus !== 'object') {
    console.error('FAIL /api/operations/dashboard/today', dash.status, dashBody);
    process.exit(1);
  }
  console.log('OK /api/operations/dashboard/today', { date: dashBody.date, count: dashBody.flights.length });

  const routes = await fetch(`${base}/api/operations/routes`, { headers: auth });
  const routesBody = await routes.json().catch(() => ({}));
  if (!routes.ok || !Array.isArray(routesBody.routes)) {
    console.error('FAIL /api/operations/routes', routes.status, routesBody);
    process.exit(1);
  }
  console.log('OK /api/operations/routes', routesBody.routes.length);

  const sched = await fetch(`${base}/api/operations/flights?date=${today}`, { headers: auth });
  const schedBody = await sched.json().catch(() => ({}));
  if (!sched.ok || !Array.isArray(schedBody.flights)) {
    console.error('FAIL /api/operations/flights', sched.status, schedBody);
    process.exit(1);
  }
  console.log('OK /api/operations/flights', schedBody.flights.length);

  const ac = await fetch(`${base}/api/operations/aircraft`, { headers: auth });
  const acBody = await ac.json().catch(() => ({}));
  if (!ac.ok || !Array.isArray(acBody.aircraft)) {
    console.error('FAIL /api/operations/aircraft', ac.status, acBody);
    process.exit(1);
  }
  console.log('OK /api/operations/aircraft', acBody.aircraft.length);

  const fid = schedBody.flights[0]?.id;
  if (fid) {
    const det = await fetch(`${base}/api/operations/flights/${fid}/details`, { headers: auth });
    const detBody = await det.json().catch(() => ({}));
    if (!det.ok || !detBody.flight || !Array.isArray(detBody.dispatchLogs) || !Array.isArray(detBody.crew)) {
      console.error('FAIL /api/operations/flights/:id/details', det.status, detBody);
      process.exit(1);
    }
    console.log('OK /api/operations/flights/:id/details', { flight: detBody.flight.flight_number, crew: detBody.crew.length });
  } else {
    console.log('SKIP details (no flights for UTC today — run npm run db:fix)');
  }

  console.log('All operations API checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
