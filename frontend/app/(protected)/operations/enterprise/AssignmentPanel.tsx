'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiFetchJson } from '@/lib/api-client';
import { fetchCompatibleAircraft, type CompatibleAircraft } from '@/lib/flight-ops-enterprise';

type Aircraft = { id: string; tail_number: string; model: string; release_status: string };

type Props = {
  selectedFlightId: string;
  onAssigned: () => void;
};

export function AssignmentPanel({ selectedFlightId, onAssigned }: Props) {
  const [compatible, setCompatible] = useState<CompatibleAircraft[]>([]);
  const [distanceNm, setDistanceNm] = useState<number | null>(null);
  const [assignId, setAssignId] = useState('');
  const [autoReassign, setAutoReassign] = useState(false);
  const [isReserve, setIsReserve] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!selectedFlightId) {
      setCompatible([]);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchCompatibleAircraft(selectedFlightId);
      setCompatible(data.aircraft || []);
      setDistanceNm(data.distanceNm);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load fleet');
      setCompatible([]);
    } finally {
      setLoading(false);
    }
  }, [selectedFlightId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function assign() {
    if (!selectedFlightId || !assignId) return;
    try {
      await apiFetchJson('/api/operations/enterprise/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flightId: selectedFlightId,
          aircraftId: assignId,
          autoReassign,
          isReserve
        })
      });
      toast.success('Aircraft assigned.');
      onAssigned();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Assignment failed');
    }
  }

  if (!selectedFlightId) {
    return <p className="ops-muted">Select a flight to view compatible aircraft.</p>;
  }

  return (
    <div className="ops-enterprise-assign">
      <p className="ops-muted">
        Fleet compatibility: release status, seat capacity, route range{distanceNm != null ? ` (${distanceNm} NM)` : ''}, rotation
        overlap (45 min).
      </p>
      {loading && <p className="ops-muted">Loading fleet…</p>}
      <div className="ops-compatible-list">
        {compatible.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`ops-compatible-row${a.compatible ? '' : ' incompatible'}${assignId === a.id ? ' selected' : ''}`}
            onClick={() => setAssignId(a.id)}
          >
            <span>
              {a.tail_number} · {a.model} · {a.seat_capacity} seats · {a.release_status}
            </span>
            <span>{a.compatible ? 'Compatible' : a.errors[0] || 'Not compatible'}</span>
          </button>
        ))}
      </div>
      <div className="ops-enterprise-toolbar">
        <label className="ops-check-row">
          <input type="checkbox" checked={autoReassign} onChange={(e) => setAutoReassign(e.target.checked)} />
          Auto-reassign on conflict
        </label>
        <label className="ops-check-row">
          <input type="checkbox" checked={isReserve} onChange={(e) => setIsReserve(e.target.checked)} />
          Reserve aircraft
        </label>
        <button type="button" disabled={!assignId} onClick={() => void assign()}>
          Assign selected tail
        </button>
      </div>
    </div>
  );
}
