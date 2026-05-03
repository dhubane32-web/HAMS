'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, ChevronRight } from 'lucide-react';

import { clearClientSession } from '@/lib/auth-session';
import { getPublicApiBaseUrl } from '@/lib/api-base';

const API_BASE_URL = getPublicApiBaseUrl();

type Alert = {
  id: string;
  severity: string;
  title: string;
  detail: string;
  href: string;
  time: string | null;
};

export default function NotificationsPage() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('hams_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/dashboard/summary`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.status === 401) {
          clearClientSession();
          router.replace('/login');
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || 'Unable to load notifications.');
        }
        const data = (await res.json()) as { alerts: Alert[] };
        if (!cancelled) setAlerts(data.alerts || []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Load failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="module-page">
      <section className="module-card">
        <div className="row-between">
          <div>
            <h1>Alerts & notifications</h1>
            <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.88rem' }}>
              Operational, maintenance, and commercial signals from live HAMS data.
            </p>
          </div>
          <Link href="/dashboard" className="mini-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Back to dashboard <ChevronRight size={14} />
          </Link>
        </div>
      </section>

      <section className="module-card">
        {loading && <p style={{ margin: 0, color: '#64748b' }}>Loading…</p>}
        {error && <p style={{ margin: 0, color: '#b91c1c' }}>{error}</p>}
        {!loading && !error && alerts.length === 0 && (
          <p style={{ margin: 0, color: '#64748b' }}>No active alerts for your access scope.</p>
        )}
        {!loading && alerts.length > 0 && (
          <ul className="notifications-feed">
            {alerts.map((a) => (
              <li key={a.id}>
                <span className={`notif-severity ${a.severity}`} aria-hidden>
                  <Bell size={14} />
                </span>
                <div>
                  <strong>{a.title}</strong>
                  <p>{a.detail}</p>
                  {a.time && <small>{new Date(a.time).toLocaleString()}</small>}
                </div>
                <Link href={a.href} className="notif-open">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
