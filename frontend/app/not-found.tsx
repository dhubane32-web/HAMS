import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeContent: 'center',
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        background: '#f1f5f9',
        color: '#0f172a'
      }}
    >
      <div
        style={{
          maxWidth: 420,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 16,
          padding: '1.75rem',
          boxShadow: '0 12px 40px rgba(15,23,42,.08)'
        }}
      >
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem' }}>Page not found</h1>
        <p style={{ margin: '0 0 1rem', color: '#64748b', fontSize: '0.9rem', lineHeight: 1.5 }}>
          This URL is not part of Hawana HAMS. Use the <strong>Next.js</strong> app port (often{' '}
          <code style={{ fontSize: '0.85em' }}>3000</code> or <code style={{ fontSize: '0.85em' }}>3001</code>) — not the
          API port (<code style={{ fontSize: '0.85em' }}>5013</code>).
        </p>
        <ul style={{ margin: '0 0 1rem', paddingLeft: '1.1rem', color: '#475569', fontSize: '0.88rem' }}>
          <li>
            <Link href="/login" style={{ color: '#1d4ed8', fontWeight: 600 }}>
              Sign in
            </Link>
          </li>
          <li>
            <Link href="/dashboard" style={{ color: '#1d4ed8', fontWeight: 600 }}>
              Dashboard
            </Link>
          </li>
        </ul>
        <p style={{ margin: 0, fontSize: '0.78rem', color: '#94a3b8' }}>
          From the repo: <code>cd HAMS && npm run dev</code> — check the terminal for the exact &quot;Local:&quot; URL.
        </p>
      </div>
    </main>
  );
}
