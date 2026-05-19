'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiFetchJson } from '@/lib/api-client';
import { getPublicApiBaseUrl } from '@/lib/api-base';

type DispatchRelease = {
  id: string;
  release_number: string;
  release_status: string;
  weather_notes?: string | null;
  mel_cdl_notes?: string | null;
  operational_remarks?: string | null;
  crew_validated?: boolean;
  fuel_plan_json?: { tripFuelKg?: number; reserveKg?: number; taxiKg?: number };
  checklist_json?: Record<string, boolean>;
};

const CHECKLIST_KEYS = [
  'aircraftRelease',
  'crewRelease',
  'weatherOk',
  'notamOk',
  'fuelPlanOk',
  'captainApproval',
  'dispatcherApproval'
] as const;

type Props = { flightId: string };

export function DispatchPanel({ flightId }: Props) {
  const [release, setRelease] = useState<DispatchRelease | null>(null);
  const [saving, setSaving] = useState(false);
  const [tripFuel, setTripFuel] = useState('');
  const [reserveFuel, setReserveFuel] = useState('');
  const [taxiFuel, setTaxiFuel] = useState('');

  const load = useCallback(async () => {
    if (!flightId) return;
    try {
      const data = await apiFetchJson<{ release: DispatchRelease }>(
        `/api/operations/enterprise/dispatch-releases/flight/${flightId}`
      );
      setRelease(data.release);
      const fp = data.release.fuel_plan_json || {};
      setTripFuel(fp.tripFuelKg != null ? String(fp.tripFuelKg) : '');
      setReserveFuel(fp.reserveKg != null ? String(fp.reserveKg) : '');
      setTaxiFuel(fp.taxiKg != null ? String(fp.taxiKg) : '');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dispatch load failed');
    }
  }, [flightId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!release) return;
    setSaving(true);
    try {
      const data = await apiFetchJson<{ release: DispatchRelease }>(
        `/api/operations/enterprise/dispatch-releases/${release.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            releaseStatus: release.release_status,
            weatherNotes: release.weather_notes,
            melCdlNotes: release.mel_cdl_notes,
            operationalRemarks: release.operational_remarks,
            crewValidated: release.crew_validated,
            fuelPlan: {
              tripFuelKg: tripFuel ? Number(tripFuel) : null,
              reserveKg: reserveFuel ? Number(reserveFuel) : null,
              taxiKg: taxiFuel ? Number(taxiFuel) : null
            },
            checklist: release.checklist_json || {}
          })
        }
      );
      setRelease(data.release);
      toast.success('Dispatch release saved.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function printPdf() {
    if (!release) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('hams_token') : '';
    const res = await fetch(
      `${getPublicApiBaseUrl()}/api/operations/enterprise/dispatch-releases/${release.id}/pdf`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    if (!res.ok) {
      toast.error('PDF failed');
      return;
    }
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank', 'noopener');
  }

  if (!flightId) return <p className="ops-muted">Select a flight for dispatch release.</p>;
  if (!release) return <p className="ops-muted">Loading dispatch release…</p>;

  return (
    <div className="ops-enterprise-dispatch">
      <p>
        <strong>{release.release_number}</strong>
      </p>
      <label>
        Status
        <select
          value={release.release_status}
          onChange={(e) => setRelease((r) => (r ? { ...r, release_status: e.target.value } : r))}
        >
          {['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'DEPARTED', 'CLOSED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <div className="ops-enterprise-form-grid">
        <label>
          Trip fuel (kg)
          <input type="number" value={tripFuel} onChange={(e) => setTripFuel(e.target.value)} />
        </label>
        <label>
          Reserve (kg)
          <input type="number" value={reserveFuel} onChange={(e) => setReserveFuel(e.target.value)} />
        </label>
        <label>
          Taxi (kg)
          <input type="number" value={taxiFuel} onChange={(e) => setTaxiFuel(e.target.value)} />
        </label>
      </div>
      <label>
        Weather
        <textarea rows={2} value={release.weather_notes || ''} onChange={(e) => setRelease((r) => (r ? { ...r, weather_notes: e.target.value } : r))} />
      </label>
      <label>
        MEL / CDL
        <textarea rows={2} value={release.mel_cdl_notes || ''} onChange={(e) => setRelease((r) => (r ? { ...r, mel_cdl_notes: e.target.value } : r))} />
      </label>
      <label>
        Remarks
        <textarea rows={2} value={release.operational_remarks || ''} onChange={(e) => setRelease((r) => (r ? { ...r, operational_remarks: e.target.value } : r))} />
      </label>
      <fieldset className="ops-checklist-field">
        <legend>Release checklist</legend>
        {CHECKLIST_KEYS.map((key) => (
          <label key={key} className="ops-check-row">
            <input
              type="checkbox"
              checked={Boolean(release.checklist_json?.[key])}
              onChange={(e) =>
                setRelease((r) =>
                  r ? { ...r, checklist_json: { ...(r.checklist_json || {}), [key]: e.target.checked } } : r
                )
              }
            />
            {key}
          </label>
        ))}
      </fieldset>
      <label className="ops-check-row">
        <input
          type="checkbox"
          checked={Boolean(release.crew_validated)}
          onChange={(e) => setRelease((r) => (r ? { ...r, crew_validated: e.target.checked } : r))}
        />
        Crew validated
      </label>
      <div className="ops-enterprise-toolbar">
        <button type="button" onClick={() => void save()} disabled={saving}>
          Save release
        </button>
        <button type="button" className="secondary" onClick={() => void printPdf()}>
          Print PDF
        </button>
      </div>
    </div>
  );
}
