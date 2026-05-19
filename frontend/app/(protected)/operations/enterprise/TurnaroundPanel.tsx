'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiFetchJson } from '@/lib/api-client';

type TurnaroundEvent = {
  id: string;
  event_type: string;
  event_status: string;
  planned_at?: string | null;
  actual_at?: string | null;
};

const STEP_LABELS: Record<string, string> = {
  ARRIVAL: 'Arrival',
  CLEANING: 'Cleaning',
  CATERING: 'Catering',
  FUELING: 'Fueling',
  BOARDING: 'Boarding',
  BAGGAGE: 'Baggage loading',
  TECHNICAL: 'Technical checks',
  GATE: 'Gate coordination',
  READY: 'Ready for departure',
  DEPARTURE: 'Departure'
};

type Props = { flightId: string; stationCode?: string };

export function TurnaroundPanel({ flightId, stationCode }: Props) {
  const [events, setEvents] = useState<TurnaroundEvent[]>([]);
  const [readiness, setReadiness] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [nextEvent, setNextEvent] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!flightId) return;
    try {
      const live = await apiFetchJson<{
        events: TurnaroundEvent[];
        departureReadinessPct: number;
        countdownSec: number | null;
        nextEventType: string | null;
      }>(`/api/operations/enterprise/turnaround/${flightId}/live`);
      setEvents(live.events || []);
      setReadiness(live.departureReadinessPct || 0);
      setCountdown(live.countdownSec);
      setNextEvent(live.nextEventType);
    } catch {
      const summary = await apiFetchJson<{ events: TurnaroundEvent[]; departureReadinessPct?: number }>(
        `/api/operations/enterprise/turnaround/${flightId}`
      );
      setEvents(summary.events || []);
      setReadiness(summary.departureReadinessPct || 0);
    }
  }, [flightId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function init() {
    try {
      await apiFetchJson(`/api/operations/enterprise/turnaround/${flightId}/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationCode })
      });
      toast.success('Turnaround checklist initialized.');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Init failed');
    }
  }

  async function complete(eventId: string) {
    try {
      await apiFetchJson(`/api/operations/enterprise/turnaround/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventStatus: 'COMPLETE', actualAt: new Date().toISOString() })
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    }
  }

  if (!flightId) return <p className="ops-muted">Select a flight for turnaround monitoring.</p>;

  return (
    <div className="ops-enterprise-turnaround">
      <div className="ops-enterprise-toolbar">
        <button type="button" className="secondary" onClick={() => void init()}>
          Initialize checklist
        </button>
      </div>
      <div className="ops-enterprise-kpis">
        <div>
          <strong>{readiness}%</strong>
          <span>Departure readiness</span>
        </div>
        {countdown != null && (
          <div>
            <strong>
              {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
            </strong>
            <span>Next: {STEP_LABELS[nextEvent || ''] || nextEvent || '—'}</span>
          </div>
        )}
      </div>
      <ul className="ops-turnaround-steps">
        {events.length === 0 && <li className="ops-muted">No turnaround events — initialize checklist.</li>}
        {events.map((ev) => (
          <li key={ev.id} className={ev.event_status === 'COMPLETE' ? 'done' : ''}>
            <span>{STEP_LABELS[ev.event_type] || ev.event_type}</span>
            <span>{ev.event_status}</span>
            {ev.event_status !== 'COMPLETE' && (
              <button type="button" className="secondary" onClick={() => void complete(ev.id)}>
                Complete
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
