'use client';

type FlightStrip = {
  id: string;
  flight_number: string;
  departure_airport: string;
  arrival_airport: string;
  departure_time: string;
  status: string;
  phase?: string;
  tail_number?: string | null;
  eta?: string | null;
};

function phaseClass(phase: string, status: string) {
  const p = (phase || status || '').toUpperCase();
  if (p === 'DELAYED') return 'aep-flight-strip--delayed';
  if (p === 'AIRBORNE' || p === 'IN_AIR') return 'aep-flight-strip--airborne';
  return '';
}

function countdownTo(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

type Props = {
  flights: FlightStrip[];
  onSelect?: (id: string) => void;
  selectedId?: string;
};

export function FlightStripBoard({ flights, onSelect, selectedId }: Props) {
  if (!flights.length) {
    return <p style={{ fontSize: '0.85rem', color: '#64748b' }}>No active flight strips for this ops day.</p>;
  }
  return (
    <div className="aep-flight-strips" aria-label="Active flight strips">
      {flights.map((f) => {
        const phase = f.phase || f.status;
        const cls = phaseClass(phase, f.status);
        return (
          <button
            key={f.id}
            type="button"
            className={`aep-flight-strip ${cls}${selectedId === f.id ? ' ring-2 ring-sky-400' : ''}`}
            onClick={() => onSelect?.(f.id)}
            style={{ textAlign: 'left', cursor: onSelect ? 'pointer' : 'default' }}
          >
            <strong>{f.flight_number}</strong>
            <span>
              {f.departure_airport}→{f.arrival_airport}
            </span>
            <span style={{ display: 'block', marginTop: 4 }}>
              {phase} · DEP {countdownTo(f.departure_time)}
              {f.eta ? ` · ETA ${new Date(f.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
            {f.tail_number ? <span style={{ opacity: 0.8 }}>Tail {f.tail_number}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
