'use client';

export default function AppError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        background: '#0f172a',
        color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif'
      }}
    >
      <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 600 }}>Application error</h1>
      <p style={{ margin: '0 0 1.25rem', maxWidth: 520, textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem' }}>
        {error.message || 'An unexpected error occurred. You can try again or return to the home page.'}
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: '0.55rem 1.1rem',
            borderRadius: 8,
            border: 'none',
            background: '#3b82f6',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Try again
        </button>
        <a
          href="/"
          style={{
            padding: '0.55rem 1.1rem',
            borderRadius: 8,
            border: '1px solid #334155',
            color: '#e2e8f0',
            fontWeight: 600,
            textDecoration: 'none'
          }}
        >
          Home
        </a>
      </div>
      {error.digest ? (
        <p style={{ marginTop: '1.5rem', fontSize: '0.7rem', color: '#475569' }}>Ref: {error.digest}</p>
      ) : null}
    </div>
  );
}
