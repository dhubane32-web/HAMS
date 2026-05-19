'use client';

type AlertLine = { id: string; text: string; severity?: 'info' | 'warn' | 'crit' };

type Props = {
  alerts: AlertLine[];
};

export function AlertTicker({ alerts }: Props) {
  if (!alerts.length) return null;
  const doubled = [...alerts, ...alerts];
  return (
    <div className="aep-alert-ticker" role="status" aria-live="polite">
      <div className="aep-alert-ticker__track">
        {doubled.map((a, i) => (
          <span key={`${a.id}-${i}`}>{a.text}</span>
        ))}
      </div>
    </div>
  );
}
