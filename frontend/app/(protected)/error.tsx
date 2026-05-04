'use client';

export default function ProtectedSegmentError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        maxWidth: 640,
        margin: '2rem auto',
        padding: '1.5rem',
        borderRadius: 12,
        border: '1px solid #e2e8f0',
        background: '#fff',
        boxShadow: '0 1px 3px rgba(15,23,42,0.08)',
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        color: '#0f172a'
      }}
    >
      <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem', fontWeight: 700 }}>This section could not be displayed</h2>
      <p style={{ margin: '0 0 1rem', fontSize: '0.88rem', color: '#64748b' }}>
        {error.message || 'Something went wrong while loading this page.'}
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: '0.45rem 0.9rem',
            borderRadius: 8,
            border: 'none',
            background: '#1e3a5f',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.85rem'
          }}
        >
          Retry
        </button>
        <a
          href="/"
          style={{
            padding: '0.45rem 0.9rem',
            borderRadius: 8,
            border: '1px solid #cbd5e1',
            color: '#1e293b',
            fontWeight: 600,
            textDecoration: 'none',
            fontSize: '0.85rem',
            display: 'inline-block'
          }}
        >
          Dashboard
        </a>
      </div>
    </div>
  );
}
