#!/usr/bin/env node
/**
 * Verifies Flight Operations APIs (OCC dashboard, details, status rules, delays, dispatch checklist).
 * Usage:
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
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const today = new Date().toISOString().slice(0, 10);

  const dashToday = await fetch(`${base}/api/operations/dashboard/today`, { headers: auth });
  const dashTodayBody = await dashToday.json().catch(() => ({}));
  if (!dashToday.ok || !Array.isArray(dashTodayBody.flights) || typeof dashTodayBody.summaryByStatus !== 'object') {
    console.error('FAIL /api/operations/dashboard/today', dashToday.status, dashTodayBody);
    process.exit(1);
  }
  console.log('OK /api/operations/dashboard/today', { date: dashTodayBody.date, count: dashTodayBody.flights.length });

  const dashDate = await fetch(`${base}/api/operations/dashboard?date=${encodeURIComponent(today)}`, { headers: auth });
  const dashDateBody = await dashDate.json().catch(() => ({}));
  if (!dashDate.ok || !Array.isArray(dashDateBody.flights) || dashDateBody.date !== today) {
    console.error('FAIL /api/operations/dashboard?date=', dashDate.status, dashDateBody);
    process.exit(1);
  }
  console.log('OK /api/operations/dashboard?date=', { date: dashDateBody.date, count: dashDateBody.flights.length });

  const badDate = await fetch(`${base}/api/operations/dashboard?date=not-a-date`, { headers: auth });
  if (badDate.status !== 400) {
    console.error('FAIL dashboard invalid date expected 400', badDate.status);
    process.exit(1);
  }
  console.log('OK /api/operations/dashboard invalid date → 400');

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

  if (schedBody.flights.length !== dashDateBody.flights.length) {
    console.error('FAIL dashboard vs flights list count mismatch', {
      flights: schedBody.flights.length,
      dashboard: dashDateBody.flights.length
    });
    process.exit(1);
  }
  console.log('OK dashboard and /flights counts match for', today);

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
    if (!detBody.operationalSummary || typeof detBody.operationalSummary.load !== 'object') {
      console.error('FAIL details missing operationalSummary.load', detBody);
      process.exit(1);
    }
    if (!Array.isArray(detBody.operationalSummary.alerts)) {
      console.error('FAIL details missing operationalSummary.alerts', detBody);
      process.exit(1);
    }
    if (!detBody.operationalSummary.constants || typeof detBody.operationalSummary.constants.minTurnaroundMinutes !== 'number') {
      console.error('FAIL details missing operationalSummary.constants.minTurnaroundMinutes', detBody);
      process.exit(1);
    }
    if (!Array.isArray(detBody.auditTimeline)) {
      console.error('FAIL details missing auditTimeline', detBody);
      process.exit(1);
    }
    console.log('OK /api/operations/flights/:id/details', {
      flight: detBody.flight.flight_number,
      crew: detBody.crew.length,
      alerts: detBody.operationalSummary.alerts.length
    });

    const fullChecklist = {
      aircraftRelease: true,
      crewRelease: true,
      weatherOk: true,
      notamOk: true,
      captainApproval: true,
      dispatcherApproval: true
    };

    const relBad = await fetch(`${base}/api/operations/flights/${fid}/dispatch-release`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ remarks: 'test', checklist: { ...fullChecklist, aircraftRelease: false } })
    });
    if (relBad.status !== 400) {
      console.error('FAIL dispatch-release incomplete checklist expected 400', relBad.status, await relBad.text());
      process.exit(1);
    }
    console.log('OK POST dispatch-release rejects incomplete checklist');

    const patchCancel = await fetch(`${base}/api/operations/flights/${fid}/status`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    if (patchCancel.status !== 400) {
      console.error('FAIL PATCH status to CANCELLED should be blocked', patchCancel.status, await patchCancel.text());
      process.exit(1);
    }
    console.log('OK PATCH status cannot set CANCELLED without cancel endpoint');

    const delayBody = {
      delayMinutes: 15,
      reason: 'ATC flow verification',
      operationalNotes: 'verify-operations-api.mjs'
    };
    const delayRes = await fetch(`${base}/api/operations/flights/${fid}/delays`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(delayBody)
    });
    const delayJson = await delayRes.json().catch(() => ({}));
    if (!delayRes.ok) {
      console.error('FAIL POST delays', delayRes.status, delayJson);
      process.exit(1);
    }
    console.log('OK POST delays', { status: delayJson.flight?.status });

    if (delayJson.flight?.status === 'DELAYED') {
      const patchRevert = await fetch(`${base}/api/operations/flights/${fid}/status`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ status: 'SCHEDULED' })
      });
      if (!patchRevert.ok) {
        console.error('FAIL PATCH DELAYED→SCHEDULED recovery', patchRevert.status, await patchRevert.text());
        process.exit(1);
      }
      console.log('OK PATCH status DELAYED→SCHEDULED recovery');
    }

    const badTransition = await fetch(`${base}/api/operations/flights/${fid}/status`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ status: 'IN_AIR' })
    });
    if (badTransition.status !== 400) {
      console.error('FAIL PATCH SCHEDULED→IN_AIR should be rejected', badTransition.status, await badTransition.text());
      process.exit(1);
    }
    console.log('OK PATCH rejects invalid transition to IN_AIR');
  } else {
    console.log('SKIP deep checks (no flights for UTC today — run npm run db:fix)');
  }

  const entHealth = await fetch(`${base}/api/operations/enterprise/health`, { headers: auth });
  const entHealthBody = await entHealth.json().catch(() => ({}));
  if (!entHealth.ok || entHealthBody.module !== 'flight-ops-enterprise') {
    console.error('FAIL /api/operations/enterprise/health', entHealth.status, entHealthBody);
    process.exit(1);
  }
  console.log('OK /api/operations/enterprise/health');

  const entFeed = await fetch(`${base}/api/operations/enterprise/feed?date=${today}`, { headers: auth });
  const entFeedBody = await entFeed.json().catch(() => ({}));
  if (entFeed.status === 503) {
    console.warn('WARN enterprise feed: schema not applied — run database/migrations/005_flight_ops_enterprise.sql');
  } else if (!entFeed.ok || !Array.isArray(entFeedBody.flights)) {
    console.error('FAIL /api/operations/enterprise/feed', entFeed.status, entFeedBody);
    process.exit(1);
  } else {
    console.log('OK /api/operations/enterprise/feed', {
      flights: entFeedBody.flights.length,
      conflicts: entFeedBody.conflictCount
    });
  }

  console.log('All operations API checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
