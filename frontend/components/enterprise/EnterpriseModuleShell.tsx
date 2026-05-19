'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { EnterpriseModuleMeta } from '@/lib/enterprise-modules';
import '@/styles/airline-enterprise.css';

type Props = {
  meta: EnterpriseModuleMeta;
  children: ReactNode;
  /** Default dark OCC-style shell */
  dark?: boolean;
  toolbar?: ReactNode;
  tabs?: { id: string; label: string; active: boolean; onSelect: () => void }[];
  liveSyncLabel?: string | null;
};

export function EnterpriseModuleShell({ meta, children, dark = false, toolbar, tabs, liveSyncLabel }: Props) {
  const [occDark, setOccDark] = useState(dark);

  useEffect(() => {
    if (!dark) return;
    const saved = localStorage.getItem('hams_occ_dark');
    if (saved === '1') setOccDark(true);
  }, [dark]);

  useEffect(() => {
    if (dark) localStorage.setItem('hams_occ_dark', occDark ? '1' : '0');
  }, [dark, occDark]);

  return (
    <div className={`aep-shell${occDark ? ' aep-shell--dark' : ''}`}>
      <header className="aep-hero">
        <div>
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-sky-300/90">Hawana Airways</p>
          <h1>{meta.title}</h1>
          <p>{meta.subtitle}</p>
          {meta.legacyHref ? (
            <p style={{ marginTop: '0.35rem', fontSize: '0.75rem' }}>
              <Link href={meta.legacyHref} className="text-sky-300 hover:underline">
                Open legacy view →
              </Link>
            </p>
          ) : null}
        </div>
        <div className="aep-toolbar">
          {liveSyncLabel ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
              <span className="aep-live-dot" aria-hidden />
              {liveSyncLabel}
            </span>
          ) : null}
          {dark ? (
            <button type="button" className="secondary" onClick={() => setOccDark((v) => !v)}>
              {occDark ? 'Light mode' : 'Dark OCC'}
            </button>
          ) : null}
          {toolbar}
        </div>
      </header>

      {tabs && tabs.length > 0 ? (
        <div className="aep-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.active}
              className={t.active ? '' : 'secondary'}
              onClick={t.onSelect}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {children}
    </div>
  );
}
