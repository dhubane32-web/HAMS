import Link from 'next/link';
import { BRAND } from '@/lib/brand';

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
          The link may be outdated or typed incorrectly. Return to the {BRAND.companyName} traveler site or use staff
          sign-in.
        </p>
        <ul style={{ margin: '0 0 1rem', paddingLeft: '1.1rem', color: '#475569', fontSize: '0.88rem' }}>
          <li>
            <Link href="/" style={{ color: '#1d4ed8', fontWeight: 600 }}>
              Home
            </Link>
          </li>
          <li>
            <Link href="/login" style={{ color: '#1d4ed8', fontWeight: 600 }}>
              Staff sign-in
            </Link>
          </li>
        </ul>
        {process.env.NODE_ENV === 'development' ? (
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#94a3b8' }}>
            Development: Next.js UI is usually port <code>3000</code>; API is typically <code>5013</code>.
          </p>
        ) : null}
      </div>
    </main>
  );
}
