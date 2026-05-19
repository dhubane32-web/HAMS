'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiFetchJson } from '@/lib/api-client';
import { fetchRouteTemplates, type EnterpriseFlight, type OpsRouteTemplate } from '@/lib/flight-ops-enterprise';
import { ScheduleDragBoard } from './ScheduleDragBoard';

const WEEKDAYS = [
  { v: 0, l: 'Sun' },
  { v: 1, l: 'Mon' },
  { v: 2, l: 'Tue' },
  { v: 3, l: 'Wed' },
  { v: 4, l: 'Thu' },
  { v: 5, l: 'Fri' },
  { v: 6, l: 'Sat' }
];

type ScheduleRow = {
  id: string;
  schedule_code: string;
  flight_number: string;
  origin_airport: string;
  dest_airport: string;
  schedule_status: string;
  recurrence_type: string;
};

type Props = {
  opsDate: string;
  flights: EnterpriseFlight[];
  selectedFlightId: string;
  onSelectFlight: (id: string) => void;
  onRefresh: () => void;
};

export function SchedulingPanel({ opsDate, flights, selectedFlightId, onSelectFlight, onRefresh }: Props) {
  const [routes, setRoutes] = useState<OpsRouteTemplate[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [form, setForm] = useState({
    routeId: '',
    scheduleCode: '',
    flightNumber: '',
    originAirport: '',
    destAirport: '',
    depTime: '08:00',
    arrTime: '10:30',
    effectiveFrom: opsDate,
    effectiveTo: '',
    recurrenceType: 'DAILY',
    seatCapacityRequired: '',
    daysOfWeek: [1, 2, 3, 4, 5] as number[]
  });

  const load = useCallback(async () => {
    try {
      const [r, list] = await Promise.all([
        fetchRouteTemplates(),
        apiFetchJson<{ schedules: ScheduleRow[] }>('/api/operations/enterprise/schedules')
      ]);
      setRoutes(r);
      setSchedules(list.schedules || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load schedules');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setForm((f) => ({ ...f, effectiveFrom: opsDate }));
  }, [opsDate]);

  function applyRoute(routeId: string) {
    const r = routes.find((x) => x.id === routeId);
    if (!r) return;
    setForm((f) => ({
      ...f,
      routeId,
      originAirport: r.origin_airport,
      destAirport: r.dest_airport
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = {
      scheduleCode: form.scheduleCode,
      flightNumber: form.flightNumber,
      originAirport: form.originAirport,
      destAirport: form.destAirport,
      routeId: form.routeId || null,
      scheduledDepTime: form.depTime,
      scheduledArrTime: form.arrTime,
      effectiveFrom: form.effectiveFrom,
      effectiveTo: form.effectiveTo || null,
      recurrenceType: form.recurrenceType,
      daysOfWeek: form.recurrenceType === 'WEEKLY' ? form.daysOfWeek : [],
      seatCapacityRequired: form.seatCapacityRequired ? Number(form.seatCapacityRequired) : null
    };
    try {
      const val = await apiFetchJson<{ valid: boolean; errors: string[] }>(
        '/api/operations/enterprise/schedules/validate',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );
      if (!val.valid) {
        toast.error(val.errors.join(' '));
        return;
      }
      await apiFetchJson('/api/operations/enterprise/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      toast.success('Schedule template saved.');
      setForm((f) => ({ ...f, scheduleCode: '', flightNumber: '' }));
      await load();
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <div className="ops-enterprise-scheduling">
      <form className="ops-enterprise-form" onSubmit={onSubmit}>
        <h3>Schedule template</h3>
        <div className="ops-enterprise-form-grid">
          <label>
            Route template
            <select value={form.routeId} onChange={(e) => applyRoute(e.target.value)}>
              <option value="">— manual —</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label || `${r.origin_airport}→${r.dest_airport}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Schedule code
            <input required value={form.scheduleCode} onChange={(e) => setForm((f) => ({ ...f, scheduleCode: e.target.value.toUpperCase() }))} />
          </label>
          <label>
            Flight #
            <input required value={form.flightNumber} onChange={(e) => setForm((f) => ({ ...f, flightNumber: e.target.value.toUpperCase() }))} />
          </label>
          <label>
            Origin
            <input required value={form.originAirport} onChange={(e) => setForm((f) => ({ ...f, originAirport: e.target.value.toUpperCase() }))} />
          </label>
          <label>
            Dest
            <input required value={form.destAirport} onChange={(e) => setForm((f) => ({ ...f, destAirport: e.target.value.toUpperCase() }))} />
          </label>
          <label>
            Dep
            <input type="time" value={form.depTime} onChange={(e) => setForm((f) => ({ ...f, depTime: e.target.value }))} />
          </label>
          <label>
            Arr
            <input type="time" value={form.arrTime} onChange={(e) => setForm((f) => ({ ...f, arrTime: e.target.value }))} />
          </label>
          <label>
            Effective from
            <input type="date" value={form.effectiveFrom} onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))} />
          </label>
          <label>
            Recurrence
            <select value={form.recurrenceType} onChange={(e) => setForm((f) => ({ ...f, recurrenceType: e.target.value }))}>
              <option value="NONE">One-off</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="SEASONAL">Seasonal</option>
            </select>
          </label>
          <label>
            Min seats
            <input type="number" min={0} value={form.seatCapacityRequired} onChange={(e) => setForm((f) => ({ ...f, seatCapacityRequired: e.target.value }))} />
          </label>
        </div>
        {form.recurrenceType === 'WEEKLY' && (
          <div className="ops-weekday-picker">
            {WEEKDAYS.map((d) => (
              <label key={d.v} className="ops-check-row">
                <input
                  type="checkbox"
                  checked={form.daysOfWeek.includes(d.v)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      daysOfWeek: e.target.checked ? [...f.daysOfWeek, d.v] : f.daysOfWeek.filter((x) => x !== d.v)
                    }))
                  }
                />
                {d.l}
              </label>
            ))}
          </div>
        )}
        <button type="submit">Save schedule</button>
      </form>

      <ScheduleDragBoard
        opsDate={opsDate}
        flights={flights}
        selectedFlightId={selectedFlightId}
        onSelect={onSelectFlight}
        onRescheduled={onRefresh}
      />

      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Flight</th>
              <th>Route</th>
              <th>Recurrence</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id}>
                <td>{s.schedule_code}</td>
                <td>{s.flight_number}</td>
                <td>
                  {s.origin_airport}→{s.dest_airport}
                </td>
                <td>{s.recurrence_type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
