'use client';

import { memo } from 'react';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import type { OccDispatchItem } from './occ-phase3-types';

type Props = { queue: OccDispatchItem[] };

export const DispatchQueuePanel = memo(function DispatchQueuePanel({ queue }: Props) {
  return (
    <div className="occ-glass occ-card-lift flex h-full min-h-[280px] flex-col rounded-2xl border border-slate-200/90 p-4 shadow-sm ring-1 ring-slate-900/5 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
        <ClipboardList className="h-5 w-5 text-hawana-blue" aria-hidden />
        Dispatch queue
      </h2>
      <p className="mt-0.5 text-xs text-slate-500">Legs awaiting release — crew legality and MX status feed dispatch readiness</p>
      <ul className="occ-feed-scroll mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
        {queue.length === 0 ? (
          <li className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-6 text-center text-sm text-slate-500">
            No pending dispatch actions
          </li>
        ) : (
          queue.map((item) => (
            <li
              key={item.id}
              className={`flex items-center justify-between gap-2 rounded-xl border bg-white/90 px-3 py-2.5 ${
                item.priority === 'critical'
                  ? 'occ-severity-critical'
                  : item.priority === 'warning'
                    ? 'occ-severity-warning'
                    : 'occ-severity-normal'
              }`}
            >
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{item.flightNumber}</p>
                <p className="text-xs text-slate-600">
                  {item.route} · Gate {item.gate} · {item.status}
                </p>
              </div>
              <Link href={item.href} className="shrink-0 text-xs font-semibold text-hawana-blue hover:underline">
                {item.actionLabel}
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
});
