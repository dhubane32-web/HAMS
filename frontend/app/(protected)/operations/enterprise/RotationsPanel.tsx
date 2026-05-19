'use client';

import toast from 'react-hot-toast';
import { apiFetchJson } from '@/lib/api-client';
import type { EnterpriseFeed } from '@/lib/flight-ops-enterprise';

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return iso;
  }
}

type Props = {
  opsDate: string;
  rotations: NonNullable<EnterpriseFeed['rotations']>;
  utilization: EnterpriseFeed['utilization'];
  onRebuilt: () => void;
};

export function RotationsPanel({ opsDate, rotations, utilization, onRebuilt }: Props) {
  const byTail = new Map<string, typeof rotations>();
  for (const r of rotations) {
    const key = r.tail_number || 'unknown';
    if (!byTail.has(key)) byTail.set(key, []);
    byTail.get(key)!.push(r);
  }

  async function rebuild() {
    try {
      await apiFetchJson('/api/operations/enterprise/rotations/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: opsDate })
      });
      toast.success('Rotations rebuilt from flight assignments.');
      onRebuilt();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rebuild failed');
    }
  }

  return (
    <div className="ops-enterprise-rotations">
      <div className="ops-enterprise-toolbar">
        <button type="button" onClick={() => void rebuild()}>
          Rebuild rotations
        </button>
      </div>
      {utilization.length > 0 && (
        <div className="ops-utilization-grid">
          <h3>Fleet utilization</h3>
          {utilization.map((u) => (
            <div key={u.id} className="ops-util-bar">
              <span>
                {u.tail_number} · {Number(u.block_hours).toFixed(1)}h · {u.flight_count} flt
              </span>
              <div className="ops-util-track">
                <div className="ops-util-fill" style={{ width: `${u.utilizationPct}%` }} />
              </div>
              <span>{u.utilizationPct}%</span>
            </div>
          ))}
        </div>
      )}
      {byTail.size === 0 && <p className="ops-muted">No rotations. Assign aircraft and rebuild.</p>}
      {[...byTail.entries()].map(([tail, legs]) => (
        <div key={tail} className="ops-rotation-card">
          <h3>
            {tail}
            {legs[legs.length - 1]?.overnight_station
              ? ` · overnight ${legs[legs.length - 1].overnight_station}`
              : ''}
          </h3>
          <ol className="ops-rotation-seq">
            {legs.map((leg) => (
              <li key={leg.id} className={leg.rotation_status === 'CONFLICT' ? 'ops-rotation-conflict' : ''}>
                <span>
                  {leg.sequence_no}. {leg.flight_number || '—'}
                </span>
                <span>
                  Block {leg.planned_block_min ?? '—'} min
                  {leg.planned_turnaround_min != null ? ` · TA ${leg.planned_turnaround_min} min` : ''}
                </span>
                {leg.conflict_reason && <em>{leg.conflict_reason}</em>}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
