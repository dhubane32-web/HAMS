'use client';

import BrandLogo from '@/components/BrandLogo';
import { BRAND } from '@/lib/brand';

type Props = {
  documentTitle: string;
  /** Defaults to “now” in the user’s locale. */
  generatedAt?: Date;
  className?: string;
};

/**
 * Branded block for print-friendly pages and exports: logo, airline, HAMS, title, generated timestamp.
 * Logo asset follows app theme (`hawana-logo-dark.png` in dark mode when using `variant="light"`).
 */
export default function DocumentHeader({ documentTitle, generatedAt, className }: Props) {
  const when = generatedAt ?? new Date();
  const generatedLabel = when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <header
      className={[
        'flex flex-wrap items-start gap-4 border-b border-slate-200 pb-4 dark:border-slate-600',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="shrink-0">
        <BrandLogo variant="light" placement="marketing" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-[#001f5b] dark:text-white">{BRAND.companyName}</p>
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">{BRAND.systemName}</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{documentTitle}</h1>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Generated: {generatedLabel}</p>
      </div>
    </header>
  );
}
