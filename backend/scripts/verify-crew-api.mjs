#!/usr/bin/env node
/**
 * Verifies Crew Management API after DB migrations.
 * Usage: BASE_URL=http://127.0.0.1:5013 EMAIL=admin@hams.aero PASSWORD='Admin123!' node backend/scripts/verify-crew-api.mjs
 */
const base = process.env.BASE_URL || 'http://127.0.0.1:5013';
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

  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10);

  const checks = [
    ['GET /api/crew', `${base}/api/crew`],
    ['GET /api/crew/roster', `${base}/api/crew/roster?from=${from}&to=${to}`],
    ['GET /api/crew/alerts', `${base}/api/crew/alerts?withinDays=30`]
  ];

  let failed = false;
  for (const [name, url] of checks) {
    const r = await fetch(url, { headers: auth });
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    const ok = r.ok;
    if (!ok) {
      failed = true;
      console.error(`FAIL ${name} -> ${r.status}`, json);
      continue;
    }
    if (name.includes('roster')) {
      const n = Array.isArray(json.assignments) ? json.assignments.length : -1;
      console.log(`OK ${name} -> assignments=${n}`);
    } else if (name.includes('alerts')) {
      const es = json.expiringSoon || {};
      const sum =
        (es.licenses?.length || 0) +
        (es.medicals?.length || 0) +
        (es.training?.length || 0) +
        (es.documents?.length || 0);
      console.log(`OK ${name} -> expiring-soon rows=${sum}`);
    } else {
      const n = Array.isArray(json.crew) ? json.crew.length : -1;
      console.log(`OK ${name} -> crew directory=${n}`);
    }
  }

  if (failed) process.exit(1);
  console.log('All crew API checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
