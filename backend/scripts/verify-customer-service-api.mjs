#!/usr/bin/env node
/**
 * Smoke-test Customer Service APIs.
 *   BASE_URL=http://127.0.0.1:5013 node backend/scripts/verify-customer-service-api.mjs
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

  const dash = await fetch(`${base}/api/customer-service/dashboard`, { headers: auth });
  const dashBody = await dash.json().catch(() => ({}));
  if (!dash.ok || dashBody.summary == null) {
    console.error('FAIL GET /api/customer-service/dashboard', dash.status, dashBody);
    process.exit(1);
  }
  console.log('OK GET dashboard', dashBody.summary);

  const cases = await fetch(`${base}/api/customer-service/cases`, { headers: auth });
  const casesBody = await cases.json().catch(() => ({}));
  if (!cases.ok || !Array.isArray(casesBody.cases)) {
    console.error('FAIL GET /api/customer-service/cases', cases.status, casesBody);
    process.exit(1);
  }
  console.log('OK GET cases', casesBody.cases.length);

  const create = await fetch(`${base}/api/customer-service/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      caseType: 'GENERAL',
      subject: 'API smoke test case',
      description: 'Created by verify-customer-service-api.mjs',
      priority: 'LOW'
    })
  });
  const createBody = await create.json().catch(() => ({}));
  if (!create.ok || !createBody.case?.id) {
    console.error('FAIL POST /api/customer-service/cases', create.status, createBody);
    process.exit(1);
  }
  console.log('OK POST cases', createBody.case.case_ref || createBody.case.id);

  console.log('Customer service API checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
