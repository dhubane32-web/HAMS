'use client';

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';

const passengers = [
  { id: 'PAX001', name: 'Ahmed Noor', email: 'ahmed@example.com', tier: 'Gold' },
  { id: 'PAX002', name: 'Hodan Ali', email: 'hodan@example.com', tier: 'Silver' }
];

export default function CustomersPage() {
  const [query, setQuery] = useState('Ahmed');
  const [complaint, setComplaint] = useState('Delayed baggage delivery');
  const [logs, setLogs] = useState<string[]>(['Seat change request resolved', 'Refund follow-up pending']);

  const passenger = useMemo(() => passengers.find((p) => p.name.toLowerCase().includes(query.toLowerCase())) ?? passengers[0], [query]);

  function addComplaint() {
    setLogs((prev) => [`Complaint: ${complaint}`, ...prev]);
    toast.success('Complaint logged');
    setComplaint('');
  }

  return (
    <main className="module-page">
      <section className="module-card">
        <h1>Customer Service</h1>
        <div className="module-form-grid">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Passenger search" />
          <button onClick={() => toast.success(`Loaded ${passenger.name}`)}>Search Passenger</button>
        </div>
      </section>

      <section className="module-card two-col">
        <div>
          <h2>Passenger Profile</h2>
          <p><strong>ID:</strong> {passenger.id}</p>
          <p><strong>Name:</strong> {passenger.name}</p>
          <p><strong>Email:</strong> {passenger.email}</p>
          <p><strong>Tier:</strong> {passenger.tier}</p>
          <h3>Booking History</h3>
          <ul className="simple-list">
            <li>HAW001 - MGQ → JIB - Completed</li>
            <li>HAW119 - MGQ → NBO - Pending</li>
          </ul>
        </div>
        <div>
          <h2>Complaint Log</h2>
          <div className="module-form-grid">
            <input value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="Complaint details" />
            <button onClick={addComplaint}>Add Complaint</button>
          </div>
          <ul className="simple-list">
            {logs.map((log) => (
              <li key={log}>{log}</li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
