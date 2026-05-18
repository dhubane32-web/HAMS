'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import ConfirmModal from '@/components/ui/ConfirmModal';

type Flight = { no: string; route: string; aircraft: string; std: string; status: string };

const initialFlights: Flight[] = [
  { no: 'H9 101', route: 'MGQ → JIB', aircraft: 'B737-800', std: '07:30', status: 'Departed' },
  { no: 'H9 102', route: 'JIB → MGQ', aircraft: 'B737-800', std: '09:45', status: 'On Time' },
  { no: 'H9 201', route: 'MGQ → NBO', aircraft: 'A320-200', std: '11:20', status: 'On Time' }
];

export default function FlightsPage() {
  const [rows, setRows] = useState(initialFlights);
  const [selected, setSelected] = useState<Flight | null>(null);
  const [delayReason, setDelayReason] = useState('');

  function createFlight() {
    const no = `H9 ${300 + rows.length}`;
    setRows((prev) => [...prev, { no, route: 'MGQ → DXB', aircraft: 'B787-9', std: '18:10', status: 'Scheduled' }]);
    toast.success(`Flight ${no} created`);
  }

  function assignAircraft(flight: Flight) {
    setRows((prev) => prev.map((f) => (f.no === flight.no ? { ...f, aircraft: 'A320-200' } : f)));
    toast.success(`Aircraft assigned to ${flight.no}`);
  }

  function assignCrew(flight: Flight) {
    toast.success(`Crew assigned to ${flight.no}`);
  }

  function releaseDispatch(flight: Flight) {
    setRows((prev) => prev.map((f) => (f.no === flight.no ? { ...f, status: 'Released' } : f)));
    toast.success(`Dispatch released for ${flight.no}`);
  }

  function logDelay() {
    if (!selected) return;
    setRows((prev) => prev.map((f) => (f.no === selected.no ? { ...f, status: 'Delayed' } : f)));
    toast.success(`Delay logged for ${selected.no}: ${delayReason || 'Operational reason'}`);
    setDelayReason('');
    setSelected(null);
  }

  return (
    <main className="module-page">
      <section className="module-card">
        <div className="row-between">
          <h1>Flight Operations</h1>
          <button onClick={createFlight}>Create New Flight</button>
        </div>
        <table className="module-table">
          <thead>
            <tr><th>Flight</th><th>Route</th><th>Aircraft</th><th>STD</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.no}>
                <td>{row.no}</td><td>{row.route}</td><td>{row.aircraft}</td><td>{row.std}</td>
                <td><span className={`badge ${row.status.toLowerCase().replace(' ', '-')}`}>{row.status}</span></td>
                <td className="actions">
                  <button className="secondary" onClick={() => assignAircraft(row)}>Assign Aircraft</button>
                  <button className="secondary" onClick={() => assignCrew(row)}>Assign Crew</button>
                  <button className="secondary" onClick={() => releaseDispatch(row)}>Dispatch Release</button>
                  <button className="secondary" onClick={() => setSelected(row)}>Delay Log</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="module-card">
        <h2>Flight Status Board</h2>
        <div className="flight-board">
          {rows.map((row) => (
            <article key={row.no}>
              <strong>{row.no}</strong>
              <span>{row.route}</span>
              <em className={`badge ${row.status.toLowerCase().replace(' ', '-')}`}>{row.status}</em>
            </article>
          ))}
        </div>
      </section>

      <ConfirmModal
        open={Boolean(selected)}
        title={selected ? `Log Delay - ${selected.no}` : 'Log Delay'}
        message={selected ? `Route ${selected.route}. Click confirm after adding reason.` : ''}
        onCancel={() => setSelected(null)}
        onConfirm={logDelay}
        confirmText="Log delay"
      />
      {selected && (
        <section className="module-card">
          <input value={delayReason} onChange={(e) => setDelayReason(e.target.value)} placeholder="Delay reason" />
        </section>
      )}
    </main>
  );
}
