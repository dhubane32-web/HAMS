'use client';

import { FormEvent, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { getPublicApiBaseUrl } from '@/lib/api-base';

type Aircraft = { id: string; tail_number: string; model: string; release_status: string };
type Defect = {
  id: string;
  tail_number: string;
  defect_code: string | null;
  defect_description: string;
  severity: string;
  status: string;
  opened_at: string;
};
type Inspection = {
  id: string;
  tail_number: string;
  inspection_type: string;
  scheduled_for: string;
  status: string;
};

const API_BASE_URL = getPublicApiBaseUrl();

export default function MaintenancePage() {
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [historyDefects, setHistoryDefects] = useState<Defect[]>([]);
  const [historyInspections, setHistoryInspections] = useState<Inspection[]>([]);
  const [selectedAircraftId, setSelectedAircraftId] = useState('');
  const [defectCode, setDefectCode] = useState('MEL-001');
  const [defectDescription, setDefectDescription] = useState('Hydraulic pressure fluctuation observed.');
  const [severity, setSeverity] = useState('HIGH');
  const [inspectionType, setInspectionType] = useState('A-CHECK');
  const [scheduledFor, setScheduledFor] = useState('');
  const [inspectionRemarks, setInspectionRemarks] = useState('');
  const [releaseStatus, setReleaseStatus] = useState('RELEASED');
  const [closeDefectId, setCloseDefectId] = useState('');
  const [completeInspectionId, setCompleteInspectionId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function getToken() {
    return localStorage.getItem('hams_token');
  }

  async function api(path: string, init?: RequestInit) {
    const token = getToken();
    if (!token) {
      throw new Error('Please login first from /login.');
    }
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.message || 'Request failed.');
    }
    return body;
  }

  async function loadData() {
    setIsLoading(true);
    setError('');
    try {
      const [aircraftRes, historyRes] = await Promise.all([
        api('/api/maintenance/aircraft'),
        api('/api/maintenance/history')
      ]);
      const aircraftRows = aircraftRes.aircraft || [];
      setAircraft(aircraftRows);
      setHistoryDefects(historyRes.defects || []);
      setHistoryInspections(historyRes.inspections || []);
      if (!selectedAircraftId && aircraftRows.length > 0) {
        setSelectedAircraftId(aircraftRows[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load maintenance data.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // Initial fetch on mount for maintenance workspace data.
    void loadData();
    // loadData is intentionally mount-only here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitDefect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      await api('/api/maintenance/defects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aircraftId: selectedAircraftId, defectCode, defectDescription, severity })
      });
      setSuccess('Defect logged successfully.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log defect.');
    } finally {
      setIsLoading(false);
    }
  }

  async function submitInspection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      await api('/api/maintenance/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aircraftId: selectedAircraftId,
          inspectionType,
          scheduledFor,
          remarks: inspectionRemarks
        })
      });
      setSuccess('Inspection scheduled successfully.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule inspection.');
    } finally {
      setIsLoading(false);
    }
  }

  async function updateReleaseStatus() {
    if (!selectedAircraftId) return;
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      await api(`/api/maintenance/aircraft/${selectedAircraftId}/release-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ releaseStatus })
      });
      setSuccess('Aircraft release status updated.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update release status.');
    } finally {
      setIsLoading(false);
    }
  }

  async function closeDefect() {
    if (!closeDefectId) return;
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      await api(`/api/maintenance/defects/${closeDefectId}/close`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ releaseAircraft: true })
      });
      setSuccess('Defect closed.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close defect.');
    } finally {
      setIsLoading(false);
    }
  }

  async function completeInspection() {
    if (!completeInspectionId) return;
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      await api(`/api/maintenance/inspections/${completeInspectionId}/complete`, { method: 'PATCH' });
      setSuccess('Inspection completed.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete inspection.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main style={{ padding: '2rem', display: 'grid', gap: '1rem' }}>
      <h1 style={{ margin: 0, color: '#0d47a1' }}>Aircraft Maintenance</h1>
      <p style={{ marginTop: 0 }}>
        MEL/CDL, deferred defects, AOG tracking, inspections, technical logbook, and fleet serviceability.
      </p>

      <section style={cardStyle}>
        <h2 style={h2Style}>Fleet serviceability</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.5rem' }}>
          {aircraft.map((a) => {
            const st = String(a.release_status || '').toUpperCase();
            const tone =
              st === 'RELEASED'
                ? { bg: '#dcfce7', border: '#86efac', label: 'Serviceable' }
                : st === 'HOLD'
                  ? { bg: '#fee2e2', border: '#fca5a5', label: 'AOG / Hold' }
                  : st === 'IN_MAINTENANCE'
                    ? { bg: '#fef3c7', border: '#fcd34d', label: 'Maintenance' }
                    : { bg: '#f1f5f9', border: '#cbd5e1', label: st || 'Unknown' };
            return (
              <div
                key={a.id}
                style={{
                  padding: '0.5rem',
                  borderRadius: 8,
                  border: `1px solid ${tone.border}`,
                  background: tone.bg,
                  fontSize: '0.78rem'
                }}
              >
                <strong>{a.tail_number}</strong>
                <div>{a.model}</div>
                <motion.div style={{ marginTop: 4, fontWeight: 700 }}>{tone.label}</div>
              </div>
            );
          })}
        </div>
        {aircraft.length === 0 ? <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No aircraft in master data.</p> : null}
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>1) Aircraft Control</h2>
        <div style={gridStyle}>
          <select value={selectedAircraftId} onChange={(e) => setSelectedAircraftId(e.target.value)} style={inputStyle}>
            <option value="">Select aircraft</option>
            {aircraft.map((a) => (
              <option key={a.id} value={a.id}>
                {a.tail_number} | {a.model} | {a.release_status}
              </option>
            ))}
          </select>
          <select value={releaseStatus} onChange={(e) => setReleaseStatus(e.target.value)} style={inputStyle}>
            <option value="RELEASED">RELEASED</option>
            <option value="HOLD">HOLD</option>
            <option value="IN_MAINTENANCE">IN_MAINTENANCE</option>
          </select>
          <button type="button" onClick={updateReleaseStatus} style={buttonStyle} disabled={isLoading}>
            Update Release
          </button>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>2) Defect Log</h2>
        <form onSubmit={submitDefect} style={gridStyle}>
          <input value={defectCode} onChange={(e) => setDefectCode(e.target.value)} style={inputStyle} placeholder="Defect code" />
          <input value={severity} onChange={(e) => setSeverity(e.target.value)} style={inputStyle} placeholder="Severity" />
          <input value={defectDescription} onChange={(e) => setDefectDescription(e.target.value)} style={inputStyle} placeholder="Defect description" required />
          <button type="submit" style={buttonStyle} disabled={isLoading}>Log Defect</button>
        </form>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>3) Inspection Scheduling</h2>
        <form onSubmit={submitInspection} style={gridStyle}>
          <input value={inspectionType} onChange={(e) => setInspectionType(e.target.value)} style={inputStyle} placeholder="Inspection type" required />
          <input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} style={inputStyle} required />
          <input value={inspectionRemarks} onChange={(e) => setInspectionRemarks(e.target.value)} style={inputStyle} placeholder="Remarks" />
          <button type="submit" style={buttonStyle} disabled={isLoading}>Schedule Inspection</button>
        </form>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>4) Maintenance History</h2>
        <div style={historyGridStyle}>
          <div>
            <strong>Defects</strong>
            {historyDefects.slice(0, 8).map((d) => (
              <p key={d.id} style={lineStyle}>
                {d.tail_number} | {d.severity} | {d.status} | {d.defect_description}
              </p>
            ))}
          </div>
          <div>
            <strong>Inspections</strong>
            {historyInspections.slice(0, 8).map((i) => (
              <p key={i.id} style={lineStyle}>
                {i.tail_number} | {i.inspection_type} | {i.status}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>5) Quick Actions</h2>
        <div style={gridStyle}>
          <input value={closeDefectId} onChange={(e) => setCloseDefectId(e.target.value)} style={inputStyle} placeholder="Defect ID to close" />
          <button type="button" onClick={closeDefect} style={buttonStyle} disabled={isLoading}>Close Defect</button>
          <input value={completeInspectionId} onChange={(e) => setCompleteInspectionId(e.target.value)} style={inputStyle} placeholder="Inspection ID to complete" />
          <button type="button" onClick={completeInspection} style={buttonStyle} disabled={isLoading}>Complete Inspection</button>
        </div>
      </section>

      {error && <p style={errorStyle}>{error}</p>}
      {success && <p style={successStyle}>{success}</p>}
    </main>
  );
}

const cardStyle: CSSProperties = {
  background: '#ffffff',
  borderRadius: 12,
  padding: '1rem',
  boxShadow: '0 8px 30px rgba(13, 71, 161, 0.1)'
};
const h2Style: CSSProperties = { marginTop: 0, color: '#0d47a1' };
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem' };
const historyGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' };
const inputStyle: CSSProperties = { width: '100%', padding: '0.65rem', borderRadius: 8, border: '1px solid #bfdbfe' };
const buttonStyle: CSSProperties = { border: 'none', borderRadius: 8, padding: '0.65rem 0.9rem', fontWeight: 700, background: '#0d47a1', color: '#fff', cursor: 'pointer' };
const lineStyle: CSSProperties = { margin: '0.25rem 0' };
const errorStyle: CSSProperties = { color: '#b91c1c', margin: 0 };
const successStyle: CSSProperties = { color: '#166534', margin: 0 };
