#!/usr/bin/env node
/**
 * Verifies finance dashboard API. Usage: BASE_URL=http://127.0.0.1:5013 node backend/scripts/verify-finance-api.mjs
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

  const dashRes = await fetch(`${base}/api/finance/dashboard`, { headers: auth });
  const dash = await dashRes.json().catch(() => ({}));
  if (!dashRes.ok) {
    console.error('FAIL /api/finance/dashboard', dashRes.status, dash);
    process.exit(1);
  }
  const c = dash.cards || {};
  console.log('OK /api/finance/dashboard', {
    scope: dash.scope,
    netPaymentsToday: c.netPaymentsToday,
    outstandingBookings: c.outstandingBookings,
    expensesMonth: c.expensesMonth
  });

  const today = new Date().toISOString().slice(0, 10);
  const dailyRes = await fetch(`${base}/api/finance/reports/daily?date=${today}`, { headers: auth });
  const daily = await dailyRes.json().catch(() => ({}));
  if (!dailyRes.ok) {
    console.error('FAIL /api/finance/reports/daily', dailyRes.status, daily);
    process.exit(1);
  }
  console.log('OK /api/finance/reports/daily', daily.totals);

  console.log('All finance API checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
