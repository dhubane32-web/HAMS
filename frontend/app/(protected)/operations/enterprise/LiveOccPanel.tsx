'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import {
  ackEnterpriseAlert,
  cancelEnterpriseFlight,
  type EnterpriseConflict,
  type EnterpriseFeed,
  type EnterpriseFlight
} from '@/lib/flight-ops-enterprise';

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return iso;
  }
}

type Props = {
  flights: EnterpriseFlight[];
  alerts: EnterpriseFeed['alerts'];
  conflicts: EnterpriseConflict[];
  dispatchQueue: EnterpriseFeed['dispatchQueue'];
  activeSchedules: number;
  selectedFlightId: string;
  onSelectFlight: (id: string) => void;
  onRefresh: () => void;
  loading?: boolean;
};

export function LiveOccPanel({
  flights,
  alerts,
  conflicts,
  dispatchQueue,
  activeSchedules,
  selectedFlightId,
  onSelectFlight,
  onRefresh,
  loading
}: Props) {
  const [cancelReason, setCancelReason] = useState('');

  async function handleCancel() {
    if (!selectedFlightId || cancelReason.trim().length < 3) return;
    try {
      await cancelEnterpriseFlight(selectedFlightId, cancelReason.trim());
      toast.success('Flight cancelled.');
      setCancelReason('');
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cancel failed');
    }
  }

  return (
    <div className="ops-enterprise-live">
      <div className="ops-enterprise-kpis">
        <div>
          <strong>{flights.length}</strong>
          <span>Flights</span>
        </div>
        <div>
          <strong>{activeSchedules}</strong>
          <span>Schedules</span>
        </div>
        <div>
          <strong>{conflicts.length}</strong>
          <span>Conflicts</span>
        </div>
        <div>
          <strong>{alerts.length}</strong>
          <span>Alerts</span>
        </div>
      </div>

      {conflicts.length > 0 && (
        <div className="ops-enterprise-conflicts">
          <h3>Operational conflicts</h3>
          <ul>
            {conflicts.map((c, i) => (
              <li key={`${c.kind}-${i}`} className={`ops-alert-sev-${(c.severity || 'info').toLowerCase()}`}>
                {c.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {dispatchQueue.filter((d) => d.needsRelease).length > 0 && (
        <div className="ops-enterprise-dispatch-queue">
          <h3>Dispatch queue</h3>
          <ul>
            {dispatchQueue
              .filter((d) => d.needsRelease)
              .map((d) => (
                <li key={d.id}>
                  {d.flight_number} · {fmtTime(d.departure_time)} · {d.release_status || 'DRAFT'}
                </li>
              ))}
          </ul>
        </div>
      )}

      {selectedFlightId && (
        <div className="ops-enterprise-cancel" style={{ marginBottom: '0.75rem' }}>
          <label>
            Cancellation reason
            <input
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="IROP / commercial decision"
            />
          </label>
          <button type="button" className="secondary" disabled={cancelReason.trim().length < 3} onClick={() => void handleCancel()}>
            Cancel flight
          </button>
        </div>
      )}

      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Flight</th>
              <th>Route</th>
              <th>STD</th>
              <th>Delay</th>
              <th>Tail</th>
              <th>Status</th>
              <th>Dispatch</th>
            </tr>
          </thead>
          <tbody>
            {flights.length === 0 && !loading && (
              <tr>
                <td colSpan={7}>No flights for this UTC ops day.</td>
              </tr>
            )}
            {flights.map((f) => (
              <tr
                key={f.id}
                className={f.id === selectedFlightId ? 'ops-row-selected' : ''}
                onClick={() => onSelectFlight(f.id)}
              >
                <td>{f.flight_number}</td>
                <td>
                  {f.departure_airport}→{f.arrival_airport}
                </td>
                <td>{fmtTime(f.departure_time)}</td>
                <td>{f.total_delay_min ? `${f.total_delay_min}m` : '—'}</td>
                <td>{f.tail_number || '—'}</td>
                <td>
                  <span className={`ops-pill ops-pill-${f.status.toLowerCase()}`}>{f.status}</span>
                </td>
                <td>{f.dispatch_release_status || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {alerts.length > 0 && (
        <div className="ops-enterprise-alerts">
          <h3>Live alerts</h3>
          <ul>
            {alerts.map((a) => (
              <li key={a.id} className={`ops-alert-sev-${a.severity.toLowerCase()}`}>
                <strong>{a.severity}</strong> {a.message}
                <button
                  type="button"
                  className="secondary"
                  style={{ marginLeft: '0.5rem', fontSize: '0.72rem' }}
                  onClick={() => void ackEnterpriseAlert(a.id).then(onRefresh)}
                >
                  Ack
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
