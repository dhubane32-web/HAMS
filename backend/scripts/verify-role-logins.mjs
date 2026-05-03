const base = 'http://localhost:5006';
const accounts = [
  ['admin@hams.aero', 'admin'],
  ['finance@hams.aero', 'finance'],
  ['ops@hams.aero', 'operations'],
  ['agent@hams.aero', 'agent'],
  ['crew@hams.aero', 'crew'],
  ['mx@hams.aero', 'maintenance']
];
const pages = ['/dashboard', '/booking', '/checkin', '/finance', '/operations', '/maintenance'];

let ok = true;

for (const [email, role] of accounts) {
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Admin123!' })
  });

  const body = await loginRes.json().catch(() => ({}));
  const token = body.token;
  const roleOk = loginRes.ok && body?.user?.role === role && Boolean(token);

  console.log(`${email} login=${roleOk ? 'OK' : 'FAIL'} role=${body?.user?.role || 'none'}`);
  if (!roleOk) {
    ok = false;
    continue;
  }

  const dashRes = await fetch(`${base}/api/dashboard/${role}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  console.log(`  dashboard/${role}=${dashRes.status}`);
  if (!dashRes.ok) ok = false;
}

for (const p of pages) {
  const r = await fetch(`http://localhost:3006${p}`, { method: 'GET', redirect: 'manual' });
  console.log(`page ${p} status=${r.status}`);
  if (!(r.status >= 200 && r.status < 400)) ok = false;
}

process.exit(ok ? 0 : 1);
