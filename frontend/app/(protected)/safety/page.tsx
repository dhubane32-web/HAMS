'use client';

import { useCallback, useEffect, useState } from 'react';
import { EnterpriseModuleShell } from '@/components/enterprise/EnterpriseModuleShell';
import { ENTERPRISE_MODULES } from '@/lib/enterprise-modules';
import { apiFetchJson } from '@/lib/api-client';

type Incident = {
  id: string;
  title: string;
  severity: string;
  status: string;
  reported_at: string;
};

export default function SafetyCompliancePage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('MEDIUM');

  const load = useCallback(async () => {
    try {
      const d = await apiFetchJson<{ incidents: Incident[] }>('/api/safety/incidents');
      setIncidents(d.incidents || []);
    } catch {
      setIncidents([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function report(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 3) return;
    try {
      await apiFetchJson('/api/safety/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), severity })
      });
      setTitle('');
      void load();
    } catch {
      /* toast handled by api client if configured */
    }
  }

  return (
    <EnterpriseModuleShell meta={ENTERPRISE_MODULES.safety}>
      <section className="module-card">
        <h2 style={{ marginTop: 0 }}>Safety management (SMS)</h2>
        <p style={{ color: '#64748b', fontSize: '0.88rem' }}>
          Incident reporting, risk register, audits, and corrective actions — incremental SMS layer on PostgreSQL.
        </p>
        <form onSubmit={report} className="module-form-grid" style={{ maxWidth: '28rem', marginBottom: '1rem' }}>
          <label>
            Incident title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Brief description" />
          </label>
          <label>
            Severity
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Report incident</button>
        </form>
        <ul style={{ fontSize: '0.85rem' }}>
          {incidents.length === 0 ? <li style={{ color: '#64748b' }}>No incidents logged.</li> : null}
          {incidents.map((i) => (
            <li key={i.id}>
              <strong>{i.title}</strong> — {i.severity} / {i.status} · {new Date(i.reported_at).toLocaleString()}
            </li>
          ))}
        </ul>
      </section>
    </EnterpriseModuleShell>
  );
}
