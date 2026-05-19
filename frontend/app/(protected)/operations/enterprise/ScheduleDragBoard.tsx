'use client';

import { useCallback, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import type { EnterpriseFlight } from '@/lib/flight-ops-enterprise';
import { rescheduleFlightDrag } from '@/lib/flight-ops-enterprise';

const SLOT_MIN = 15;
const DAY_MIN = 24 * 60;

function minutesFromMidnightUtc(iso: string) {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function isoFromMinutes(opsDate: string, minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return new Date(`${opsDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`).toISOString();
}

type Props = {
  opsDate: string;
  flights: EnterpriseFlight[];
  selectedFlightId: string;
  onSelect: (id: string) => void;
  onRescheduled: () => void;
};

export function ScheduleDragBoard({ opsDate, flights, selectedFlightId, onSelect, onRescheduled }: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const blocks = useMemo(() => {
    return flights.map((f) => {
      const start = minutesFromMidnightUtc(f.departure_time);
      const end = minutesFromMidnightUtc(f.arrival_time);
      const duration = Math.max(SLOT_MIN, end > start ? end - start : end + DAY_MIN - start);
      return { flight: f, start, duration };
    });
  }, [flights]);

  const onDropAt = useCallback(
    async (flight: EnterpriseFlight, targetMin: number) => {
      const start = minutesFromMidnightUtc(flight.departure_time);
      const end = minutesFromMidnightUtc(flight.arrival_time);
      const duration = end > start ? end - start : end + DAY_MIN - start;
      const newDep = isoFromMinutes(opsDate, targetMin);
      const newArr = isoFromMinutes(opsDate, targetMin + duration);
      setSaving(true);
      try {
        await rescheduleFlightDrag(flight.id, newDep, newArr);
        toast.success(`${flight.flight_number} rescheduled.`);
        onRescheduled();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Reschedule failed');
      } finally {
        setSaving(false);
        setDraggingId(null);
      }
    },
    [opsDate, onRescheduled]
  );

  return (
    <div className="ops-drag-board" aria-busy={saving}>
      <p className="ops-muted" style={{ margin: '0 0 0.5rem' }}>
        Drag flights on the UTC timeline to reschedule (15-minute snap). Conflicts are validated server-side.
      </p>
      <div className="ops-drag-ruler" aria-hidden>
        {Array.from({ length: 25 }, (_, h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>
      <div
        className="ops-drag-lane"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData('text/flight-id');
          const flight = flights.find((f) => f.id === id);
          if (!flight) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const targetMin = Math.round((ratio * DAY_MIN) / SLOT_MIN) * SLOT_MIN;
          void onDropAt(flight, targetMin);
        }}
      >
        {blocks.map(({ flight, start, duration }) => {
          const left = (start / DAY_MIN) * 100;
          const width = Math.max((duration / DAY_MIN) * 100, 2);
          return (
            <button
              key={flight.id}
              type="button"
              draggable
              className={`ops-drag-block${flight.id === selectedFlightId ? ' selected' : ''}${
                draggingId === flight.id ? ' dragging' : ''
              }`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${flight.flight_number} ${flight.departure_airport}→${flight.arrival_airport}`}
              onClick={() => onSelect(flight.id)}
              onDragStart={(e) => {
                setDraggingId(flight.id);
                e.dataTransfer.setData('text/flight-id', flight.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDraggingId(null)}
            >
              <span className="ops-drag-fn">{flight.flight_number}</span>
              <span className="ops-drag-route">
                {flight.departure_airport}→{flight.arrival_airport}
              </span>
            </button>
          );
        })}
        {flights.length === 0 && <p className="ops-drag-empty">No flights to display for this ops day.</p>}
      </div>
    </div>
  );
}

