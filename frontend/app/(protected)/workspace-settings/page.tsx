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
      </section>
    </main>
  );
}
