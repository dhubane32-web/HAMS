'use client';

export function SkeletonBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="glass-card">
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="skeleton-row" />
      ))}
    </div>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="empty-state glass-card">
      <div className="empty-illustration">✈️</div>
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}
