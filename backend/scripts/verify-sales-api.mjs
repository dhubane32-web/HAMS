#!/usr/bin/env node
/**
 * Verifies Sales & Marketing APIs. Usage:
 *   BASE_URL=http://127.0.0.1:5000 node backend/scripts/verify-sales-api.mjs
 */
const base = process.env.BASE_URL || 'http://127.0.0.1:5000';
const email = process.env.EMAIL || 'admin@hams.aero';
const password = process.env.PASSWORD || 'Admin123!';

function assertArrays(name, body) {
  for (const key of ['campaigns', 'leadPipeline', 'promoUsage']) {
    if (!Array.isArray(body[key])) {
      console.error(`FAIL ${name}: expected array ${key}, got`, typeof body[key]);
      process.exit(1);
    }
  }
}

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

  const mdRes = await fetch(`${base}/api/sales/marketing-dashboard`, { headers: auth });
  const md = await mdRes.json().catch(() => ({}));
  if (!mdRes.ok) {
    console.error('FAIL /api/sales/marketing-dashboard', mdRes.status, md);
    process.exit(1);
  }
  assertArrays('marketing-dashboard', md);
  console.log('OK /api/sales/marketing-dashboard', {
    campaigns: md.campaigns.length,
    leadPipeline: md.leadPipeline.length,
    promoUsage: md.promoUsage.length
  });

  const campRes = await fetch(`${base}/api/sales/campaigns`, { headers: auth });
  const camp = await campRes.json().catch(() => ({}));
  if (!campRes.ok || !Array.isArray(camp.campaigns)) {
    console.error('FAIL /api/sales/campaigns', campRes.status, camp);
    process.exit(1);
  }
  console.log('OK /api/sales/campaigns', camp.campaigns.length);

  const pipeRes = await fetch(`${base}/api/sales/leads/pipeline`, { headers: auth });
  const pipe = await pipeRes.json().catch(() => ({}));
  if (!pipeRes.ok || !Array.isArray(pipe.pipeline)) {
    console.error('FAIL /api/sales/leads/pipeline', pipeRes.status, pipe);
    process.exit(1);
  }
  console.log('OK /api/sales/leads/pipeline', pipe.pipeline.length);

  const promoRes = await fetch(`${base}/api/sales/promo-codes`, { headers: auth });
  const promo = await promoRes.json().catch(() => ({}));
  if (!promoRes.ok || !Array.isArray(promo.promoCodes)) {
    console.error('FAIL /api/sales/promo-codes', promoRes.status, promo);
    process.exit(1);
  }
  console.log('OK /api/sales/promo-codes', promo.promoCodes.length);

  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const perfRes = await fetch(`${base}/api/sales/reports/agent-performance?from=${from}&to=${to}`, { headers: auth });
  const perf = await perfRes.json().catch(() => ({}));
  if (!perfRes.ok || !Array.isArray(perf.agents)) {
    console.error('FAIL /api/sales/reports/agent-performance', perfRes.status, perf);
    process.exit(1);
  }
  console.log('OK /api/sales/reports/agent-performance', perf.agents.length);

  console.log('All sales & marketing API checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
