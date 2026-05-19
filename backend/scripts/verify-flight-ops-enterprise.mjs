#!/usr/bin/env node
/**
 * Full enterprise flight ops verification (scheduling, rotations, dispatch PDF, conflicts, feed).
 * Usage: BASE_URL=http://127.0.0.1:5013 node backend/scripts/verify-flight-ops-enterprise.mjs
 */
const base = (process.env.BASE_URL || 'http://127.0.0.1:5013').replace(/\/$/, '');
const email = process.env.EMAIL || process.env.HAMS_ADMIN_EMAIL || 'admin@hawanaairways.com';
const password = process.env.PASSWORD || 'Admin123!';

async function login() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${JSON.stringify(body)}`);
  return { token: body.token, auth: { Authorization: `Bearer ${body.token}`, 'Content-Type': 'application/json' } };
}

function fail(msg) {
  console.error('FAIL', msg);
  process.exit(1);
}

async function main() {
  console.log('=== Enterprise Flight Ops verification ===');
  console.log('BASE_URL', base);

  const health = await fetch(`${base}/api/operations/enterprise/health`);
  const healthBody = await health.json().catch(() => ({}));
  if (!health.ok || healthBody.module !== 'flight-ops-enterprise') {
    fail(`/enterprise/health ${health.status} ${JSON.stringify(healthBody)}`);
  }
  console.log('OK enterprise health');

  const { auth } = await login();
  const today = new Date().toISOString().slice(0, 10);

  const feedRes = await fetch(`${base}/api/operations/enterprise/feed?date=${today}`, { headers: auth });
  const feed = await feedRes.json().catch(() => ({}));
  if (feedRes.status === 503) {
    console.warn('WARN schema not applied — run migrations 005');
    process.exit(2);
  }
  if (!feedRes.ok || !Array.isArray(feed.flights)) {
    fail(`feed ${feedRes.status} ${JSON.stringify(feed)}`);
  }
  console.log('OK feed', { flights: feed.flights.length, conflicts: feed.conflictCount, alerts: feed.alerts?.length });

  const occDash = await fetch(`${base}/api/operations/occ/dashboard?date=${today}`, { headers: auth });
  const occBody = await occDash.json().catch(() => ({}));
  if (!occDash.ok) fail(`occ dashboard ${occDash.status}`);
  if (!occBody.enterprise) console.warn('WARN occ dashboard missing enterprise pulse (backend not deployed?)');
  else console.log('OK occ enterprise pulse', occBody.enterprise);

  const routes = await fetch(`${base}/api/operations/enterprise/routes/templates`, { headers: auth });
  const routesBody = await routes.json().catch(() => ({}));
  if (!routes.ok || !Array.isArray(routesBody.routes)) fail(`routes ${routes.status}`);
  console.log('OK route templates', routesBody.routes.length);

  const conflicts = await fetch(`${base}/api/operations/enterprise/conflicts?date=${today}`, { headers: auth });
  const confBody = await conflicts.json().catch(() => ({}));
  if (!conflicts.ok || !Array.isArray(confBody.conflicts)) fail(`conflicts ${conflicts.status}`);
  console.log('OK conflict scan', confBody.conflictCount);

  const util = await fetch(`${base}/api/operations/enterprise/utilization?date=${today}`, { headers: auth });
  const utilBody = await util.json().catch(() => ({}));
  if (!util.ok || !Array.isArray(utilBody.fleet)) fail(`utilization ${util.status}`);
  console.log('OK utilization', utilBody.fleet.length);

  let flightId = feed.flights[0]?.id;
  if (!flightId) {
    console.warn('SKIP flight-scoped tests (no flights today)');
    console.log('All enterprise checks passed (limited).');
    return;
  }

  const compat = await fetch(`${base}/api/operations/enterprise/assignments/compatible?flightId=${flightId}`, {
    headers: auth
  });
  const compatBody = await compat.json().catch(() => ({}));
  if (!compat.ok || !Array.isArray(compatBody.aircraft)) fail(`compatible ${compat.status}`);
  console.log('OK compatible aircraft', compatBody.aircraft.length);

  const dr = await fetch(`${base}/api/operations/enterprise/dispatch-releases/flight/${flightId}`, { headers: auth });
  const drBody = await dr.json().catch(() => ({}));
  if (!dr.ok || !drBody.release?.id) fail(`dispatch get ${dr.status}`);
  const releaseId = drBody.release.id;
  console.log('OK dispatch release', drBody.release.release_number);

  const pdf = await fetch(`${base}/api/operations/enterprise/dispatch-releases/${releaseId}/pdf`, { headers: auth });
  if (!pdf.ok) fail(`dispatch pdf ${pdf.status}`);
  const buf = await pdf.arrayBuffer();
  if (buf.byteLength < 500) fail(`dispatch pdf too small ${buf.byteLength}`);
  console.log('OK dispatch PDF bytes', buf.byteLength);

  const ta = await fetch(`${base}/api/operations/enterprise/turnaround/${flightId}/live`, { headers: auth });
  const taBody = await ta.json().catch(() => ({}));
  if (!ta.ok) fail(`turnaround live ${ta.status}`);
  console.log('OK turnaround live', { events: taBody.events?.length, readiness: taBody.departureReadinessPct });

  const audit = await fetch(`${base}/api/operations/enterprise/audit?limit=5`, { headers: auth });
  const auditBody = await audit.json().catch(() => ({}));
  if (!audit.ok || !Array.isArray(auditBody.audit)) fail(`audit ${audit.status}`);
  console.log('OK audit trail sample', auditBody.audit.length);

  const f = feed.flights[0];
  const dep = new Date(f.departure_time);
  dep.setUTCHours(dep.getUTCHours() + 1);
  const arr = new Date(f.arrival_time);
  arr.setUTCHours(arr.getUTCHours() + 1);
  const resched = await fetch(`${base}/api/operations/enterprise/flights/${flightId}/reschedule`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ departureTime: dep.toISOString(), arrivalTime: arr.toISOString() })
  });
  if (!resched.ok) {
    const rb = await resched.json().catch(() => ({}));
    console.warn('WARN reschedule (may conflict)', resched.status, rb.message);
  } else {
    console.log('OK drag/reschedule persist');
    const back = await fetch(`${base}/api/operations/enterprise/flights/${flightId}/reschedule`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ departureTime: f.departure_time, arrivalTime: f.arrival_time })
    });
    if (back.ok) console.log('OK reschedule reverted');
  }

  console.log('All enterprise flight ops checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
