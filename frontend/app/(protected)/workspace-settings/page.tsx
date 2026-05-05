'use client';

import Link from 'next/link';

/** Personal workspace preferences (sidebar profile link). */
export default function WorkspaceSettingsPage() {
  return (
    <main className="module-page">
      <section className="module-card">
        <h1>Workspace settings</h1>
        <p style={{ marginTop: 0, color: '#64748b', maxWidth: '40rem' }}>
          Profile, theme, and display preferences for your HAMS session. Master reference data is maintained under{' '}
          <Link href="/settings" className="dashboard-text-link">
            Settings &amp; master data
          </Link>
          .
        </p>
        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
          Use the header profile menu or system notifications to manage your account. Further personalization controls
          will appear here in a future release.
        </p>
        <div className="module-form-grid" style={{ marginTop: '1rem', maxWidth: 360 }}>
          <button type="button" onClick={() => window.dispatchEvent(new Event('hams:theme-toggle'))}>
            Toggle light / dark theme
          </button>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
            Affects shell chrome and the top bar logo variant. Preference is saved in this browser.
          </p>
        </div>
      </section>
    </main>
  );
}
