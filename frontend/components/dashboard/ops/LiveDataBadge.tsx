'use client';

import { RefreshCw } from 'lucide-react';

type Props = {
  updatedAt: string | null;
  onRefresh?: () => void;
  loading?: boolean;
};

function formatUtcTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(11, 19);
}

export function LiveDataBadge({ updatedAt, onRefresh, loading }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50/90 px-3 py-1 text-xs font-semibold text-emerald-900">
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
        </span>
        Live ops feed
      </span>
      <span className="text-xs text-slate-500">
        Updated <strong className="font-semibold text-slate-700">{formatUtcTime(updatedAt)}</strong> UTC
      </span>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-hawana-blue/40 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Sync
        </button>
      )}
    </div>
  );
}

