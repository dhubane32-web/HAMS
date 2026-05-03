import Link from 'next/link';

/** Root path: `next.config.mjs` also redirects `/` → `/login`; this is a fallback if that redirect is skipped. */
export default function HomePage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeContent: 'center', padding: '2rem', background: '#f1f5f9' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ margin: '0 0 1rem', fontSize: '1.35rem', color: '#001f5b' }}>Hawana HAMS</h1>
        <p style={{ margin: '0 0 1rem', color: '#64748b' }}>Sign in to continue.</p>
        <Link href="/login" style={{ fontWeight: 700, color: '#1d4ed8' }}>
          Go to sign in →
        </Link>
      </div>
    </main>
  );
}
