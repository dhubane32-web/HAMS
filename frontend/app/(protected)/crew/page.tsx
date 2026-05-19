'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiFetchJson } from '@/lib/api-client';

type CrewListRow = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active?: boolean;
  crew_category: string | null;
  employee_number: string | null;
  base_airport: string | null;
  hire_date: string | null;
  has_profile: boolean;
};

type RosterRow = {
  assignment_id: string;
  duty_role: string;
  assigned_at: string;
  flight_id: string;
  flight_number: string;
  departure_airport: string;
  arrival_airport: string;
  departure_time: string;
  arrival_time: string;
  flight_status: string;
  user_id: string;
  full_name: string;
  email: string;
  crew_category: string | null;
  employee_number: string | null;
};

type AlertRow = {
  id: string;
  user_id: string;
  full_name: string;
  alert_kind: string;
  expiry_date?: string;
  license_type?: string;
  medical_class?: string;
  training_code?: string;
  title?: string;
  doc_type?: string;
};

type AlertsPayload = {
  withinDays: number;
  expiringSoon: {
    licenses: AlertRow[];
    medicals: AlertRow[];
    training: AlertRow[];
    documents: AlertRow[];
  };
  expired: {
    licenses: AlertRow[];
    medicals: AlertRow[];
    training: AlertRow[];
    documents: AlertRow[];
  };
};

type CrewDetail = {
  user: { id: string; full_name: string; email: string; role: string; is_active?: boolean };
  profile: Record<string, unknown> | null;
  licenses: Array<Record<string, unknown>>;
  medicals: Array<Record<string, unknown>>;
  training: Array<Record<string, unknown>>;
  availability: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  dutyLogs: Array<Record<string, unknown>>;
  assignments: Array<Record<string, unknown>>;
  cabinSafetyTrainingCode?: string;
};

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('hams_token') : null;
}

function fmtDate(s: string | undefined | null) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return s;
  }
}

export default function CrewPage() {
  const defaultFrom = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const defaultTo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  }, []);

  const [crewList, setCrewList] = useState<CrewListRow[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CrewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [rosterFrom, setRosterFrom] = useState(defaultFrom);
  const [rosterTo, setRosterTo] = useState(defaultTo);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState('');

  const [alertsWithinDays, setAlertsWithinDays] = useState(30);
  const [alerts, setAlerts] = useState<AlertsPayload | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState('');

  const [profileForm, setProfileForm] = useState({
    crewCategory: 'PILOT' as 'PILOT' | 'CABIN',
    employeeNumber: '',
    baseAirport: '',
    phone: '',
    emergencyContact: '',
    hireDate: '',
    notes: ''
  });

  const [licenseForm, setLicenseForm] = useState({
    licenseType: 'ATPL',
    licenseNumber: '',
    issuingAuthority: '',
    issueDate: '',
    expiryDate: ''
  });
  const [medicalForm, setMedicalForm] = useState({
    medicalClass: 'Class 1',
    expiryDate: '',
    examinerName: ''
  });
  const [trainingForm, setTrainingForm] = useState({
    trainingCode: 'CABIN_SAFETY',
    title: 'Cabin safety',
    completedDate: '',
    expiryDate: '',
    instructor: ''
  });
  const [availForm, setAvailForm] = useState({
    periodStart: '',
    periodEnd: '',
    status: 'UNAVAILABLE' as 'AVAILABLE' | 'UNAVAILABLE',
    reason: ''
  });
  const [docForm, setDocForm] = useState({
    docType: 'PASSPORT',
    title: '',
    referenceNumber: '',
    issueDate: '',
    expiryDate: '',
    storageUrl: ''
  });

  const fetchJson = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const token = getToken();
    if (!token) throw new Error('Please login first from /login.');
    return apiFetchJson<T>(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`
      },
      endpointTag: `crew:${path}`
    });
  }, []);

  const loadCrewList = useCallback(async () => {
    setDirectoryLoading(true);
    setDirectoryError('');
    try {
      const data = await fetchJson<{ crew: CrewListRow[] }>('/api/crew');
      setCrewList(data.crew || []);
    } catch (e) {
      const msg = (e as Error).message;
      setDirectoryError(msg);
      setCrewList([]);
      toast.error(msg);
    } finally {
      setDirectoryLoading(false);
    }
  }, [fetchJson]);

  const loadRoster = useCallback(async () => {
    setRosterLoading(true);
    setRosterError('');
    try {
      const q = new URLSearchParams({ from: rosterFrom, to: rosterTo });
      const data = await fetchJson<{ assignments: RosterRow[] }>(`/api/crew/roster?${q}`);
      setRoster(data.assignments || []);
    } catch (e) {
      const msg = (e as Error).message;
      setRosterError(msg);
      setRoster([]);
      toast.error(msg);
    } finally {
      setRosterLoading(false);
    }
  }, [fetchJson, rosterFrom, rosterTo]);

  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsError('');
    try {
      const q = new URLSearchParams({ withinDays: String(alertsWithinDays) });
      const data = await fetchJson<AlertsPayload>(`/api/crew/alerts?${q}`);
      setAlerts(data);
    } catch (e) {
      const msg = (e as Error).message;
      setAlerts(null);
      setAlertsError(msg);
      toast.error(msg);
    } finally {
      setAlertsLoading(false);
    }
  }, [fetchJson, alertsWithinDays]);

  const loadDetail = useCallback(
    async (userId: string) => {
      setDetailLoading(true);
      try {
        const data = await fetchJson<CrewDetail>(`/api/crew/${userId}`);
        setDetail(data);
        const p = data.profile as Record<string, string | null> | null;
        if (p) {
          setProfileForm({
            crewCategory: (String(p.crew_category || 'PILOT').toUpperCase() as 'PILOT' | 'CABIN') || 'PILOT',
            employeeNumber: String(p.employee_number || ''),
            baseAirport: String(p.base_airport || ''),
            phone: String(p.phone || ''),
            emergencyContact: String(p.emergency_contact || ''),
            hireDate: p.hire_date ? String(p.hire_date).slice(0, 10) : '',
            notes: String(p.notes || '')
          });
        } else {
          setProfileForm({
            crewCategory: 'PILOT',
            employeeNumber: '',
            baseAirport: '',
            phone: '',
            emergencyContact: '',
            hireDate: '',
            notes: ''
          });
        }
      } catch (e) {
        toast.error((e as Error).message);
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [fetchJson]
  );

  useEffect(() => {
    void loadCrewList();
    void loadAlerts();
  }, [loadCrewList, loadAlerts]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  async function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    try {
      await fetchJson('/api/crew/profiles', {
        method: 'POST',
        body: JSON.stringify({
          userId: selectedId,
          crewCategory: profileForm.crewCategory,
          employeeNumber: profileForm.employeeNumber || undefined,
          baseAirport: profileForm.baseAirport || undefined,
          phone: profileForm.phone || undefined,
          emergencyContact: profileForm.emergencyContact || undefined,
          hireDate: profileForm.hireDate || undefined,
          notes: profileForm.notes || undefined
        })
      });
      toast.success('Profile saved.');
      await loadCrewList();
      await loadDetail(selectedId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onAddLicense(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || !licenseForm.expiryDate) return;
    try {
      await fetchJson(`/api/crew/${selectedId}/licenses`, {
        method: 'POST',
        body: JSON.stringify(licenseForm)
      });
      toast.success('License added.');
      setLicenseForm((f) => ({ ...f, licenseNumber: '', issueDate: '' }));
      await loadDetail(selectedId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onAddMedical(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || !medicalForm.expiryDate) return;
    try {
      await fetchJson(`/api/crew/${selectedId}/medicals`, {
        method: 'POST',
        body: JSON.stringify({
          medicalClass: medicalForm.medicalClass,
          expiryDate: medicalForm.expiryDate,
          examinerName: medicalForm.examinerName || undefined
        })
      });
      toast.success('Medical record added.');
      setMedicalForm((f) => ({ ...f, expiryDate: '' }));
      await loadDetail(selectedId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onAddTraining(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    try {
      await fetchJson(`/api/crew/${selectedId}/training`, {
        method: 'POST',
        body: JSON.stringify(trainingForm)
      });
      toast.success('Training recorded.');
      await loadDetail(selectedId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onAddAvailability(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || !availForm.periodStart || !availForm.periodEnd) return;
    try {
      await fetchJson(`/api/crew/${selectedId}/availability`, {
        method: 'POST',
        body: JSON.stringify(availForm)
      });
      toast.success('Availability saved.');
      await loadDetail(selectedId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onAddDocument(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    try {
      await fetchJson(`/api/crew/${selectedId}/documents`, {
        method: 'POST',
        body: JSON.stringify(docForm)
      });
      toast.success('Document recorded.');
      setDocForm((f) => ({ ...f, title: '', referenceNumber: '', storageUrl: '' }));
      await loadDetail(selectedId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function deactivateLicense(id: string) {
    if (!confirm('Deactivate this license?')) return;
    try {
      await fetchJson(`/api/crew/licenses/${id}`, { method: 'DELETE' });
      toast.success('License deactivated.');
      if (selectedId) await loadDetail(selectedId);
      void loadAlerts();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function deactivateMedical(id: string) {
    if (!confirm('Deactivate this medical?')) return;
    try {
      await fetchJson(`/api/crew/medicals/${id}`, { method: 'DELETE' });
      toast.success('Medical deactivated.');
      if (selectedId) await loadDetail(selectedId);
      void loadAlerts();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function deleteAvailability(id: string) {
    if (!confirm('Remove this availability window?')) return;
    try {
      await fetchJson(`/api/crew/availability/${id}`, { method: 'DELETE' });
      toast.success('Removed.');
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function alertLabel(row: AlertRow) {
    if (row.license_type) return `${row.license_type} (license)`;
    if (row.medical_class) return `${row.medical_class} (medical)`;
    if (row.training_code) return `${row.training_code}: ${row.title || ''}`;
    if (row.doc_type) return `${row.doc_type}: ${row.title || ''}`;
    return row.alert_kind;
  }

  return (
    <main className="module-page">
      <section className="module-card">
        <h1>Crew management</h1>
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>
          Profiles, licenses, medicals, training, availability, documents, duty and rest logs, roster, and compliance
          alerts. Flight assignment from Operations enforces availability, valid license or medical, cabin safety
          training, rest between duties, and no overlapping flights.
        </p>
      </section>

      <section className="module-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2>Expiry and compliance alerts</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <label style={{ fontSize: '0.85rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              Within (days)
              <input
                type="number"
                min={1}
                max={365}
                value={alertsWithinDays}
                onChange={(e) => setAlertsWithinDays(Math.min(365, Math.max(1, Number(e.target.value) || 30)))}
                style={{ width: '4rem' }}
              />
            </label>
            <button type="button" className="secondary" onClick={() => void loadAlerts()} disabled={alertsLoading}>
              {alertsLoading ? 'Loading…' : 'Refresh alerts'}
            </button>
          </div>
        </div>
        {alertsError ? (
          <p style={{ margin: 0, color: '#b91c1c', fontSize: '0.85rem' }} role="alert">
            {alertsError}
          </p>
        ) : null}
        {alerts ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem' }}>
            <div>
              <h3 style={{ fontSize: '0.95rem' }}>Expiring within {alerts.withinDays} days</h3>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.82rem' }}>
                {alerts.expiringSoon.licenses.map((r) => (
                  <li key={`l-${r.id}`}>
                    {r.full_name}: {alertLabel(r)} — {r.expiry_date}
                  </li>
                ))}
                {alerts.expiringSoon.medicals.map((r) => (
                  <li key={`m-${r.id}`}>
                    {r.full_name}: {alertLabel(r)} — {r.expiry_date}
                  </li>
                ))}
                {alerts.expiringSoon.training.map((r) => (
                  <li key={`t-${r.id}`}>
                    {r.full_name}: {alertLabel(r)} — {r.expiry_date}
                  </li>
                ))}
                {alerts.expiringSoon.documents.map((r) => (
                  <li key={`d-${r.id}`}>
                    {r.full_name}: {alertLabel(r)} — {r.expiry_date}
                  </li>
                ))}
                {!alerts.expiringSoon.licenses.length &&
                !alerts.expiringSoon.medicals.length &&
                !alerts.expiringSoon.training.length &&
                !alerts.expiringSoon.documents.length ? (
                  <li style={{ color: '#64748b' }}>None in this window.</li>
                ) : null}
              </ul>
            </div>
            <div>
              <h3 style={{ fontSize: '0.95rem' }}>Already expired</h3>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.82rem', color: '#b91c1c' }}>
                {alerts.expired.licenses.map((r) => (
                  <li key={`el-${r.id}`}>
                    {r.full_name}: {alertLabel(r)} — {r.expiry_date}
                  </li>
                ))}
                {alerts.expired.medicals.map((r) => (
                  <li key={`em-${r.id}`}>
                    {r.full_name}: {alertLabel(r)} — {r.expiry_date}
                  </li>
                ))}
                {alerts.expired.training.map((r) => (
                  <li key={`et-${r.id}`}>
                    {r.full_name}: {alertLabel(r)} — {r.expiry_date}
                  </li>
                ))}
                {alerts.expired.documents.map((r) => (
                  <li key={`ed-${r.id}`}>
                    {r.full_name}: {alertLabel(r)} — {r.expiry_date}
                  </li>
                ))}
                {!alerts.expired.licenses.length &&
                !alerts.expired.medicals.length &&
                !alerts.expired.training.length &&
                !alerts.expired.documents.length ? (
                  <li style={{ color: '#64748b' }}>None.</li>
                ) : null}
              </ul>
            </div>
          </div>
        ) : alertsLoading ? (
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>Loading alerts…</p>
        ) : null}
      </section>

      <section className="module-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>Crew roster (assignments)</h2>
          <button type="button" className="secondary" onClick={() => void loadRoster()} disabled={rosterLoading}>
            {rosterLoading ? 'Loading…' : 'Refresh roster'}
          </button>
        </div>
        <div className="module-form-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginTop: '0.5rem' }}>
          <label>
            From
            <input type="date" value={rosterFrom} onChange={(e) => setRosterFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={rosterTo} onChange={(e) => setRosterTo(e.target.value)} />
          </label>
          <button type="button" onClick={() => void loadRoster()} disabled={rosterLoading}>
            Apply range
          </button>
        </div>
        {rosterError ? (
          <p style={{ margin: '0.5rem 0 0', color: '#b91c1c', fontSize: '0.85rem' }} role="alert">
            {rosterError}
          </p>
        ) : null}
        <div style={{ overflowX: 'auto' }}>
          <table className="module-table">
            <thead>
              <tr>
                <th>Departure</th>
                <th>Flight</th>
                <th>Route</th>
                <th>Crew</th>
                <th>Category</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.assignment_id}>
                  <td>{fmtDate(r.departure_time)}</td>
                  <td>{r.flight_number}</td>
                  <td>
                    {r.departure_airport} → {r.arrival_airport}
                  </td>
                  <td>{r.full_name}</td>
                  <td>{r.crew_category || '—'}</td>
                  <td>{r.duty_role}</td>
                  <td>{r.flight_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rosterLoading && !roster.length ? (
            <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>No assignments in this date range.</p>
          ) : null}
          {rosterLoading ? <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>Loading roster…</p> : null}
        </div>
      </section>

      <section className="module-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2>Crew directory</h2>
          <button type="button" className="secondary" onClick={() => void loadCrewList()} disabled={directoryLoading}>
            {directoryLoading ? 'Loading…' : 'Refresh directory'}
          </button>
        </div>
        {directoryError ? (
          <p style={{ margin: '0.5rem 0 0', color: '#b91c1c', fontSize: '0.85rem' }} role="alert">
            {directoryError}
          </p>
        ) : null}
        <div style={{ overflowX: 'auto' }}>
          <table className="module-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Category</th>
                <th>Employee #</th>
                <th>Profile</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {crewList.map((c) => (
                <tr key={c.id}>
                  <td>{c.full_name}</td>
                  <td>{c.email}</td>
                  <td>{c.is_active === false ? <span style={{ color: '#b91c1c' }}>Inactive</span> : 'Active'}</td>
                  <td>{c.crew_category || '—'}</td>
                  <td>{c.employee_number || '—'}</td>
                  <td>{c.has_profile ? 'Yes' : 'No'}</td>
                  <td>
                    <button type="button" className={selectedId === c.id ? '' : 'secondary'} onClick={() => setSelectedId(c.id)}>
                      {selectedId === c.id ? 'Selected' : 'Open'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!directoryLoading && !crewList.length ? (
            <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>
              No users with role &quot;crew&quot;. Run database seed or create crew accounts in system administration.
            </p>
          ) : null}
          {directoryLoading ? <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>Loading directory…</p> : null}
        </div>
      </section>

      {selectedId ? (
        <section className="module-card">
          <h2>Member record</h2>
          {detailLoading ? (
            <p style={{ margin: 0, color: '#64748b' }}>Loading…</p>
          ) : detail ? (
            <>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>
                <strong>{detail.user.full_name}</strong> · {detail.user.email}
                {detail.user.is_active === false ? (
                  <span style={{ color: '#b91c1c', marginLeft: '0.5rem' }}>(inactive)</span>
                ) : null}
              </p>

              <h3 style={{ fontSize: '0.95rem', marginTop: '0.75rem' }}>Profile</h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b' }}>
                A profile is required before assigning this crew member to flights. Pilots need an active ATPL, CPL, or
                FO license and a valid medical on the flight date. Cabin crew need training code{' '}
                <code>{detail.cabinSafetyTrainingCode || 'CABIN_SAFETY'}</code> with no expiry or a future expiry.
              </p>
              <form onSubmit={onSaveProfile} className="module-form-grid" style={{ display: 'grid', gap: '0.45rem', maxWidth: '520px' }}>
                <label>
                  Category
                  <select
                    value={profileForm.crewCategory}
                    onChange={(e) => setProfileForm((f) => ({ ...f, crewCategory: e.target.value as 'PILOT' | 'CABIN' }))}
                  >
                    <option value="PILOT">Pilot</option>
                    <option value="CABIN">Cabin</option>
                  </select>
                </label>
                <label>
                  Employee #
                  <input value={profileForm.employeeNumber} onChange={(e) => setProfileForm((f) => ({ ...f, employeeNumber: e.target.value }))} />
                </label>
                <label>
                  Base airport
                  <input value={profileForm.baseAirport} onChange={(e) => setProfileForm((f) => ({ ...f, baseAirport: e.target.value }))} maxLength={10} />
                </label>
                <label>
                  Phone
                  <input value={profileForm.phone} onChange={(e) => setProfileForm((f) => ({ ...f, phone: e.target.value }))} />
                </label>
                <label>
                  Emergency contact
                  <input value={profileForm.emergencyContact} onChange={(e) => setProfileForm((f) => ({ ...f, emergencyContact: e.target.value }))} />
                </label>
                <label>
                  Hire date
                  <input type="date" value={profileForm.hireDate} onChange={(e) => setProfileForm((f) => ({ ...f, hireDate: e.target.value }))} />
                </label>
                <label>
                  Notes
                  <textarea value={profileForm.notes} onChange={(e) => setProfileForm((f) => ({ ...f, notes: e.target.value }))} rows={3} style={{ width: '100%' }} />
                </label>
                <button type="submit">Save profile</button>
              </form>

              <h3 style={{ fontSize: '0.95rem', marginTop: '1rem' }}>Licenses</h3>
              <form onSubmit={onAddLicense} className="module-form-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'flex-end' }}>
                <label>
                  Type
                  <select value={licenseForm.licenseType} onChange={(e) => setLicenseForm((f) => ({ ...f, licenseType: e.target.value }))}>
                    <option value="ATPL">ATPL</option>
                    <option value="CPL">CPL</option>
                    <option value="FO">FO</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </label>
                <label>
                  Expiry
                  <input type="date" required value={licenseForm.expiryDate} onChange={(e) => setLicenseForm((f) => ({ ...f, expiryDate: e.target.value }))} />
                </label>
                <label>
                  Number
                  <input value={licenseForm.licenseNumber} onChange={(e) => setLicenseForm((f) => ({ ...f, licenseNumber: e.target.value }))} />
                </label>
                <label>
                  Authority
                  <input value={licenseForm.issuingAuthority} onChange={(e) => setLicenseForm((f) => ({ ...f, issuingAuthority: e.target.value }))} />
                </label>
                <label>
                  Issue date
                  <input type="date" value={licenseForm.issueDate} onChange={(e) => setLicenseForm((f) => ({ ...f, issueDate: e.target.value }))} />
                </label>
                <button type="submit">Add license</button>
              </form>
              <table className="module-table" style={{ marginTop: '0.35rem' }}>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Expiry</th>
                    <th>Active</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {detail.licenses.map((row) => (
                    <tr key={String(row.id)}>
                      <td>{String(row.license_type)}</td>
                      <td>{String(row.expiry_date)}</td>
                      <td>{row.is_active ? 'Yes' : 'No'}</td>
                      <td>
                        {row.is_active ? (
                          <button type="button" className="secondary" onClick={() => void deactivateLicense(String(row.id))}>
                            Deactivate
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 style={{ fontSize: '0.95rem', marginTop: '1rem' }}>Medicals</h3>
              <form onSubmit={onAddMedical} className="module-form-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'flex-end' }}>
                <label>
                  Class
                  <input value={medicalForm.medicalClass} onChange={(e) => setMedicalForm((f) => ({ ...f, medicalClass: e.target.value }))} />
                </label>
                <label>
                  Expiry
                  <input type="date" required value={medicalForm.expiryDate} onChange={(e) => setMedicalForm((f) => ({ ...f, expiryDate: e.target.value }))} />
                </label>
                <label>
                  Examiner
                  <input value={medicalForm.examinerName} onChange={(e) => setMedicalForm((f) => ({ ...f, examinerName: e.target.value }))} />
                </label>
                <button type="submit">Add medical</button>
              </form>
              <table className="module-table" style={{ marginTop: '0.35rem' }}>
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Expiry</th>
                    <th>Active</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {detail.medicals.map((row) => (
                    <tr key={String(row.id)}>
                      <td>{String(row.medical_class || '—')}</td>
                      <td>{String(row.expiry_date)}</td>
                      <td>{row.is_active ? 'Yes' : 'No'}</td>
                      <td>
                        {row.is_active ? (
                          <button type="button" className="secondary" onClick={() => void deactivateMedical(String(row.id))}>
                            Deactivate
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 style={{ fontSize: '0.95rem', marginTop: '1rem' }}>Training</h3>
              <form onSubmit={onAddTraining} className="module-form-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'flex-end' }}>
                <label>
                  Code
                  <input value={trainingForm.trainingCode} onChange={(e) => setTrainingForm((f) => ({ ...f, trainingCode: e.target.value }))} />
                </label>
                <label>
                  Title
                  <input value={trainingForm.title} onChange={(e) => setTrainingForm((f) => ({ ...f, title: e.target.value }))} />
                </label>
                <label>
                  Completed
                  <input type="date" value={trainingForm.completedDate} onChange={(e) => setTrainingForm((f) => ({ ...f, completedDate: e.target.value }))} />
                </label>
                <label>
                  Expiry
                  <input type="date" value={trainingForm.expiryDate} onChange={(e) => setTrainingForm((f) => ({ ...f, expiryDate: e.target.value }))} />
                </label>
                <label>
                  Instructor
                  <input value={trainingForm.instructor} onChange={(e) => setTrainingForm((f) => ({ ...f, instructor: e.target.value }))} />
                </label>
                <button type="submit">Add training</button>
              </form>
              <table className="module-table" style={{ marginTop: '0.35rem' }}>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Title</th>
                    <th>Completed</th>
                    <th>Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.training.map((row) => (
                    <tr key={String(row.id)}>
                      <td>{String(row.training_code)}</td>
                      <td>{String(row.title)}</td>
                      <td>{row.completed_date ? String(row.completed_date) : '—'}</td>
                      <td>{row.expiry_date ? String(row.expiry_date) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 style={{ fontSize: '0.95rem', marginTop: '1rem' }}>Availability</h3>
              <form onSubmit={onAddAvailability} className="module-form-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'flex-end' }}>
                <label>
                  Start
                  <input type="datetime-local" value={availForm.periodStart} onChange={(e) => setAvailForm((f) => ({ ...f, periodStart: e.target.value }))} />
                </label>
                <label>
                  End
                  <input type="datetime-local" value={availForm.periodEnd} onChange={(e) => setAvailForm((f) => ({ ...f, periodEnd: e.target.value }))} />
                </label>
                <label>
                  Status
                  <select value={availForm.status} onChange={(e) => setAvailForm((f) => ({ ...f, status: e.target.value as 'AVAILABLE' | 'UNAVAILABLE' }))}>
                    <option value="UNAVAILABLE">Unavailable</option>
                    <option value="AVAILABLE">Available</option>
                  </select>
                </label>
                <label>
                  Reason
                  <input value={availForm.reason} onChange={(e) => setAvailForm((f) => ({ ...f, reason: e.target.value }))} />
                </label>
                <button type="submit">Add window</button>
              </form>
              <table className="module-table" style={{ marginTop: '0.35rem' }}>
                <thead>
                  <tr>
                    <th>Start</th>
                    <th>End</th>
                    <th>Status</th>
                    <th>Reason</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {detail.availability.map((row) => (
                    <tr key={String(row.id)}>
                      <td>{fmtDate(String(row.period_start))}</td>
                      <td>{fmtDate(String(row.period_end))}</td>
                      <td>{String(row.status)}</td>
                      <td>{row.reason ? String(row.reason) : '—'}</td>
                      <td>
                        <button type="button" className="secondary" onClick={() => void deleteAvailability(String(row.id))}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 style={{ fontSize: '0.95rem', marginTop: '1rem' }}>Documents</h3>
              <form onSubmit={onAddDocument} className="module-form-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'flex-end' }}>
                <label>
                  Type
                  <input value={docForm.docType} onChange={(e) => setDocForm((f) => ({ ...f, docType: e.target.value }))} />
                </label>
                <label>
                  Title
                  <input required value={docForm.title} onChange={(e) => setDocForm((f) => ({ ...f, title: e.target.value }))} />
                </label>
                <label>
                  Ref #
                  <input value={docForm.referenceNumber} onChange={(e) => setDocForm((f) => ({ ...f, referenceNumber: e.target.value }))} />
                </label>
                <label>
                  Issue
                  <input type="date" value={docForm.issueDate} onChange={(e) => setDocForm((f) => ({ ...f, issueDate: e.target.value }))} />
                </label>
                <label>
                  Expiry
                  <input type="date" value={docForm.expiryDate} onChange={(e) => setDocForm((f) => ({ ...f, expiryDate: e.target.value }))} />
                </label>
                <label>
                  URL
                  <input value={docForm.storageUrl} onChange={(e) => setDocForm((f) => ({ ...f, storageUrl: e.target.value }))} style={{ minWidth: '200px' }} />
                </label>
                <button type="submit">Add document</button>
              </form>
              <table className="module-table" style={{ marginTop: '0.35rem' }}>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Title</th>
                    <th>Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.documents.map((row) => (
                    <tr key={String(row.id)}>
                      <td>{String(row.doc_type)}</td>
                      <td>{String(row.title)}</td>
                      <td>{row.expiry_date ? String(row.expiry_date) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 style={{ fontSize: '0.95rem', marginTop: '1rem' }}>Duty and rest (from assignments)</h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b' }}>
                Each assignment logs duty from departure to arrival and rest until 10 hours after arrival. Removing an
                assignment clears the duty row for that flight.
              </p>
              <table className="module-table" style={{ marginTop: '0.35rem' }}>
                <thead>
                  <tr>
                    <th>Duty start</th>
                    <th>Duty end</th>
                    <th>Minutes</th>
                    <th>Rest until</th>
                    <th>Flight</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.dutyLogs.map((row) => (
                    <tr key={String(row.id)}>
                      <td>{fmtDate(String(row.duty_start))}</td>
                      <td>{fmtDate(String(row.duty_end))}</td>
                      <td>{String(row.duty_minutes)}</td>
                      <td>{fmtDate(String(row.rest_until))}</td>
                      <td>{String(row.flight_id).slice(0, 8)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 style={{ fontSize: '0.95rem', marginTop: '1rem' }}>Recent flight assignments</h3>
              <table className="module-table">
                <thead>
                  <tr>
                    <th>Flight</th>
                    <th>Departure</th>
                    <th>Role</th>
                    <th>Flight status</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.assignments.map((row) => (
                    <tr key={String(row.id)}>
                      <td>{String(row.flight_number)}</td>
                      <td>{fmtDate(String(row.departure_time))}</td>
                      <td>{String(row.duty_role)}</td>
                      <td>{String(row.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p style={{ margin: 0, color: '#64748b' }}>Could not load this member.</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
