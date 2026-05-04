'use client';

/**
 * Root-level error UI when the root layout fails. Must define its own <html> and <body>.
 */
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
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
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 600 }}>HAMS — critical error</h1>
        <p style={{ margin: '0 0 1.25rem', maxWidth: 520, textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem' }}>
          {error.message || 'The application could not load. Please refresh the page.'}
        </p>
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
      </body>
    </html>
  );
}
